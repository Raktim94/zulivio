package com.nodedr.zulivio.data

import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Every failure the UI can show, in one type.
 *  - [retryable]: the same request may succeed later (offline, timeout, 5xx, 429)
 *  - [code]: the server's machine-readable code, or NETWORK / TIMEOUT / TLS / INSECURE_URL locally
 */
class ApiException(val status: Int, val code: String, override val message: String, val retryable: Boolean = false) : Exception(message) {
    val isAuth get() = status == 401
    val isForbidden get() = status == 403
    val isOffline get() = code == "NETWORK" || code == "TIMEOUT"
}

object UrlRules {
    /** Normalises what the user typed. Returns null if it is not a usable server address. */
    fun normalise(input: String, allowInsecure: Boolean): Result<String> {
        val raw = input.trim()
        if (raw.isEmpty()) return Result.failure(IllegalArgumentException("Enter your Zulivio server address."))
        val withScheme = if (raw.contains("://")) raw else "https://$raw"
        val url = withScheme.toHttpUrlOrNull() ?: return Result.failure(IllegalArgumentException("That doesn't look like a valid address."))
        if (url.scheme == "http" && !allowInsecure) {
            return Result.failure(IllegalArgumentException("This server uses plain HTTP. Zulivio only connects over HTTPS unless you explicitly allow an insecure local connection."))
        }
        if (url.encodedPath != "/" || url.query != null || url.fragment != null) {
            return Result.failure(IllegalArgumentException("Enter only the server address, for example https://crm.example.com"))
        }
        return Result.success(url.newBuilder().encodedPath("/").build().toString().trimEnd('/'))
    }
}

class ApiClient(private val session: SessionAccess, private val http: OkHttpClient = defaultHttp()) {
    private val refreshLock = Mutex()
    private val _events = MutableSharedFlow<AuthEvent>(extraBufferCapacity = 4)
    val events: SharedFlow<AuthEvent> = _events.asSharedFlow()

    sealed interface AuthEvent {
        data class SessionExpired(val accountId: String) : AuthEvent
        data class DeviceDisabled(val accountId: String) : AuthEvent
    }

    // ---- unauthenticated (onboarding) ----

    suspend fun serverInfo(baseUrl: String): ServerInfo =
        send(baseUrl, "GET", "/api/v1/mobile/server-info", null, null, null).let { AppJson.decodeFromString(it) }

    suspend fun login(baseUrl: String, email: String, password: String): AuthResponse {
        val body = AppJson.encodeToString(LoginRequest.serializer(), LoginRequest(email.trim(), password, DeviceInfo(session.installId, deviceName(), "android", appVersion)))
        return AppJson.decodeFromString(send(baseUrl, "POST", "/api/v1/mobile/auth/login", body, null, null))
    }

    var appVersion: String = "0.1.0"
    var deviceNameProvider: () -> String = { "Android phone" }
    private fun deviceName() = deviceNameProvider().take(80)

    // ---- authenticated ----

    /**
     * Sends [method] [path] as the active account. A 401 triggers exactly one
     * token refresh (serialised, so parallel calls share it) and a single
     * retry. If the refresh is refused the account is marked as needing sign-in.
     */
    suspend fun call(method: String, path: String, body: String? = null, idempotencyKey: String? = null, account: Account? = session.active): String {
        val acc = account ?: throw ApiException(401, "NOT_SIGNED_IN", "Sign in to continue.")
        ensureFresh(acc)
        val current = session.snapshot.accounts.firstOrNull { it.id == acc.id } ?: acc
        return try {
            send(current.serverUrl, method, path, body, current.accessToken, idempotencyKey, current.allowInsecure)
        } catch (e: ApiException) {
            if (e.status != 401) throw e
            val refreshed = refresh(current, force = true)
            send(refreshed.serverUrl, method, path, body, refreshed.accessToken, idempotencyKey, refreshed.allowInsecure)
        }
    }

    private suspend fun ensureFresh(acc: Account) {
        if (acc.accessExpiresAtMs - System.currentTimeMillis() > 30_000) return
        refresh(acc, force = false)
    }

    private suspend fun refresh(acc: Account, force: Boolean): Account = refreshLock.withLock {
        val latest = session.snapshot.accounts.firstOrNull { it.id == acc.id } ?: acc
        // Another caller already refreshed while we waited for the lock.
        if (!force && latest.accessExpiresAtMs - System.currentTimeMillis() > 30_000) return latest
        if (force && latest.accessToken != acc.accessToken) return latest
        if (latest.needsLogin || latest.refreshToken.isEmpty()) {
            _events.tryEmit(AuthEvent.SessionExpired(latest.id))
            throw ApiException(401, "SESSION_EXPIRED", "Your session has expired. Please sign in again.")
        }
        try {
            val body = AppJson.encodeToString(RefreshRequest.serializer(), RefreshRequest(latest.refreshToken))
            val res: AuthResponse = AppJson.decodeFromString(send(latest.serverUrl, "POST", "/api/v1/mobile/auth/refresh", body, null, null, latest.allowInsecure))
            val next = latest.copy(
                accessToken = res.accessToken,
                accessExpiresAtMs = parseIso(res.accessExpiresAt) ?: (System.currentTimeMillis() + 14 * 60_000),
                refreshToken = res.refreshToken,
                needsLogin = false,
            )
            session.update(latest.id) { next }
            next
        } catch (e: ApiException) {
            when {
                e.code == "DEVICE_DISABLED" -> {
                    session.update(latest.id) { it.copy(accessToken = "", refreshToken = "", needsLogin = true) }
                    _events.tryEmit(AuthEvent.DeviceDisabled(latest.id))
                }
                e.status == 401 || e.status == 403 -> {
                    session.update(latest.id) { it.copy(accessToken = "", refreshToken = "", needsLogin = true) }
                    _events.tryEmit(AuthEvent.SessionExpired(latest.id))
                }
            }
            throw e
        }
    }

    // ---- transport ----

    private suspend fun send(
        baseUrl: String,
        method: String,
        path: String,
        body: String?,
        token: String?,
        idempotencyKey: String?,
        allowInsecure: Boolean = baseUrl.startsWith("http://"),
    ): String {
        if (baseUrl.startsWith("http://") && !allowInsecure) throw ApiException(0, "INSECURE_URL", "Refusing to send data over plain HTTP.")
        val url = (baseUrl.trimEnd('/') + path).toHttpUrlOrNull() ?: throw ApiException(0, "BAD_URL", "Invalid server address.")
        val req = Request.Builder().url(url)
            .header("Accept", "application/json")
            .header("User-Agent", "Zulivio-Android/$appVersion")
            .apply {
                if (token != null) header("Authorization", "Bearer $token")
                if (idempotencyKey != null) header("Idempotency-Key", idempotencyKey)
                val rb = body?.toRequestBody(JSON)
                when (method) {
                    "GET" -> get()
                    "DELETE" -> if (rb != null) delete(rb) else delete()
                    else -> method(method, rb ?: "".toRequestBody(JSON))
                }
            }.build()
        val (code, text) = try {
            // Request AND body read both happen on the IO dispatcher; reading the body is a blocking network call.
            withContext(Dispatchers.IO) { http.newCall(req).await().use { r -> r.code to r.body?.string().orEmpty() } }
        } catch (e: javax.net.ssl.SSLException) {
            throw ApiException(0, "TLS", "Couldn't make a secure connection. Check the server's HTTPS certificate.")
        } catch (e: java.net.SocketTimeoutException) {
            throw ApiException(0, "TIMEOUT", "The server took too long to answer.", retryable = true)
        } catch (e: IOException) {
            throw ApiException(0, "NETWORK", "Can't reach the server. Check your connection.", retryable = true)
        }
        if (code in 200..299) return text
        throw parseError(code, text)
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()

        fun defaultHttp(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .followRedirects(false) // a redirect to another host must never carry the bearer token
            .followSslRedirects(false)
            .build()

        fun parseError(status: Int, text: String): ApiException {
            var code = when (status) {
                400 -> "INVALID_REQUEST"; 401 -> "INVALID_TOKEN"; 403 -> "FORBIDDEN"; 404 -> "NOT_FOUND"
                409 -> "CONFLICT"; 422 -> "VALIDATION_FAILED"; 429 -> "RATE_LIMITED"; else -> "ERROR"
            }
            var message = when (status) {
                401 -> "Please sign in again."
                403 -> "You don't have permission to do that."
                404 -> "That item no longer exists."
                429 -> "Too many requests. Try again in a minute."
                in 500..599 -> "The server had a problem. Try again shortly."
                else -> "Something went wrong."
            }
            runCatching {
                val root: JsonObject = Json.parseToJsonElement(text).jsonObject
                val err = root["error"]
                if (err is JsonObject) {
                    err["code"]?.jsonPrimitive?.contentOrNull?.let { code = it }
                    err["message"]?.jsonPrimitive?.contentOrNull?.let { message = it }
                } else {
                    root["message"]?.let { m ->
                        message = runCatching { m.jsonPrimitive.contentOrNull }.getOrNull() ?: message
                    }
                }
            }
            val retryable = status == 429 || status in 500..599 || status == 408 || status == 409 && code == "IDEMPOTENCY_IN_PROGRESS"
            return ApiException(status, code, message, retryable)
        }

        fun parseIso(s: String): Long? = runCatching { java.time.Instant.parse(s).toEpochMilli() }.getOrNull()
    }
}

private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont: CancellableContinuation<Response> ->
    cont.invokeOnCancellation { runCatching { cancel() } }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { if (cont.isActive) cont.resumeWithException(e) }
        override fun onResponse(call: Call, response: Response) { if (cont.isActive) cont.resume(response) else response.close() }
    })
}

suspend inline fun <reified T> ApiClient.get(path: String): T = AppJson.decodeFromString(call("GET", path))

suspend inline fun <reified B, reified T> ApiClient.post(path: String, body: B, idempotencyKey: String? = null): T =
    AppJson.decodeFromString(call("POST", path, AppJson.encodeToString(body), idempotencyKey))
