package com.nodedr.zulivio

import com.nodedr.zulivio.data.Account
import com.nodedr.zulivio.data.ApiClient
import com.nodedr.zulivio.data.ApiException
import com.nodedr.zulivio.data.SessionAccess
import com.nodedr.zulivio.data.SessionSnapshot
import com.nodedr.zulivio.data.UrlRules
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

private class FakeSession(initial: Account) : SessionAccess {
    @Volatile private var snap = SessionSnapshot(listOf(initial), initial.id)
    override val installId = "install-test-0123456789"
    override val snapshot get() = snap
    override val active get() = snap.active
    @Synchronized override fun update(id: String, change: (Account) -> Account) {
        snap = snap.copy(accounts = snap.accounts.map { if (it.id == id) change(it) else it })
    }
}

class UrlRulesTest {
    @Test fun `bare host becomes https`() = assertEquals("https://crm.example.com", UrlRules.normalise("crm.example.com", false).getOrThrow())
    @Test fun `trailing slash and whitespace are trimmed`() = assertEquals("https://crm.example.com", UrlRules.normalise("  https://crm.example.com/ ", false).getOrThrow())
    @Test fun `port is kept`() = assertEquals("https://crm.example.com:8443", UrlRules.normalise("crm.example.com:8443", false).getOrThrow())
    @Test fun `plain http is refused by default`() = assertTrue(UrlRules.normalise("http://192.168.1.5:4100", false).isFailure)
    @Test fun `plain http is allowed only when explicitly permitted`() = assertEquals("http://10.0.2.2:4100", UrlRules.normalise("http://10.0.2.2:4100", true).getOrThrow())
    @Test fun `paths and queries are rejected`() {
        assertTrue(UrlRules.normalise("https://crm.example.com/app", false).isFailure)
        assertTrue(UrlRules.normalise("https://crm.example.com?x=1", false).isFailure)
    }
    @Test fun `empty and garbage are rejected`() {
        assertTrue(UrlRules.normalise("", false).isFailure)
        assertTrue(UrlRules.normalise("http://", true).isFailure)
        assertTrue(UrlRules.normalise("not a url at all", false).isFailure)
    }
}

class ApiClientTest {
    private lateinit var server: MockWebServer
    private val refreshHits = AtomicInteger()

    private fun account(accessExpiresInMs: Long = 600_000) = Account(
        id = "s|e1", serverUrl = server.url("/").toString().trimEnd('/'), allowInsecure = true, employeeId = "e1", fullName = "Eli", email = "eli@x.test", role = "EMPLOYEE",
        accessToken = "zla_old", accessExpiresAtMs = System.currentTimeMillis() + accessExpiresInMs, refreshToken = "zlr_old",
    )

    @Before fun up() { server = MockWebServer(); refreshHits.set(0) }
    @After fun down() { runCatching { server.shutdown() } }

    private fun authBody(access: String, refresh: String) =
        """{"accessToken":"$access","accessExpiresAt":"2099-01-01T00:00:00Z","refreshToken":"$refresh","refreshExpiresAt":"2099-02-01T00:00:00Z"}"""

    @Test fun `401 triggers one refresh then retries with the new token and stores the rotated pair`() = runBlocking {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when {
                request.path == "/api/v1/mobile/auth/refresh" -> { refreshHits.incrementAndGet(); MockResponse().setBody(authBody("zla_new", "zlr_new")) }
                request.getHeader("Authorization") == "Bearer zla_new" -> MockResponse().setBody("""{"ok":true}""")
                else -> MockResponse().setResponseCode(401).setBody("""{"success":false,"error":{"code":"INVALID_TOKEN","message":"expired"}}""")
            }
        }
        val session = FakeSession(account())
        val api = ApiClient(session)
        val out = api.call("GET", "/api/v1/leads/my-day")
        assertEquals("""{"ok":true}""", out)
        assertEquals(1, refreshHits.get())
        assertEquals("zla_new", session.active!!.accessToken)
        assertEquals("zlr_new", session.active!!.refreshToken)
    }

    @Test fun `parallel calls with an expired token share a single refresh`() = runBlocking {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when {
                request.path == "/api/v1/mobile/auth/refresh" -> { refreshHits.incrementAndGet(); Thread.sleep(150); MockResponse().setBody(authBody("zla_new", "zlr_new")) }
                request.getHeader("Authorization") == "Bearer zla_new" -> MockResponse().setBody("{}")
                else -> MockResponse().setResponseCode(401)
            }
        }
        val session = FakeSession(account(accessExpiresInMs = -1000)) // already expired
        val api = ApiClient(session)
        (1..5).map { async { api.call("GET", "/api/v1/x$it") } }.awaitAll()
        assertEquals("the single-use refresh token must be spent exactly once", 1, refreshHits.get())
    }

    @Test fun `refused refresh marks the account signed out and emits SessionExpired`() = runBlocking {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                if (request.path == "/api/v1/mobile/auth/refresh") MockResponse().setResponseCode(401).setBody("""{"success":false,"error":{"code":"TOKEN_REUSED","message":"Session was invalidated"}}""")
                else MockResponse().setResponseCode(401)
        }
        val session = FakeSession(account())
        val api = ApiClient(session)
        val ev = async { withTimeout(2000) { api.events.first() } }
        kotlinx.coroutines.yield()
        try { api.call("GET", "/api/v1/leads/my-day"); fail("expected ApiException") } catch (e: ApiException) { assertEquals("TOKEN_REUSED", e.code) }
        assertTrue(session.active!!.needsLogin)
        assertEquals("", session.active!!.refreshToken)
        assertTrue(ev.await() is ApiClient.AuthEvent.SessionExpired)
    }

    @Test fun `a disabled device is reported distinctly`() = runBlocking {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                if (request.path == "/api/v1/mobile/auth/refresh") MockResponse().setResponseCode(403).setBody("""{"success":false,"error":{"code":"DEVICE_DISABLED","message":"disabled"}}""")
                else MockResponse().setResponseCode(401)
        }
        val api = ApiClient(FakeSession(account()))
        val ev = async { withTimeout(2000) { api.events.first() } }
        kotlinx.coroutines.yield()
        try { api.call("GET", "/api/v1/x") } catch (_: ApiException) {}
        assertTrue(ev.await() is ApiClient.AuthEvent.DeviceDisabled)
    }

    @Test fun `unreachable server is an offline retryable error`() = runBlocking {
        val acc = account(); server.shutdown()
        try { ApiClient(FakeSession(acc)).call("GET", "/api/v1/x"); fail() } catch (e: ApiException) {
            assertTrue(e.isOffline); assertTrue(e.retryable)
        }
    }

    @Test fun `server errors are retryable, validation errors are not`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(MockResponse().setResponseCode(422).setBody("""{"success":false,"error":{"code":"VALIDATION_FAILED","message":"bad"}}"""))
        val api = ApiClient(FakeSession(account()))
        try { api.call("GET", "/a"); fail() } catch (e: ApiException) { assertTrue(e.retryable) }
        try { api.call("POST", "/b", "{}"); fail() } catch (e: ApiException) { assertFalse(e.retryable); assertEquals("VALIDATION_FAILED", e.code) }
    }

    @Test fun `sends bearer token and idempotency key`() = runBlocking {
        server.enqueue(MockResponse().setBody("{}"))
        ApiClient(FakeSession(account())).call("POST", "/api/v1/leads/1/notes", """{"body":"x"}""", idempotencyKey = "key-1234567890")
        val r = server.takeRequest()
        assertEquals("Bearer zla_old", r.getHeader("Authorization"))
        assertEquals("key-1234567890", r.getHeader("Idempotency-Key"))
        assertEquals("""{"body":"x"}""", r.body.readUtf8())
    }

    @Test fun `redirects are never followed so the token cannot leak to another host`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "http://evil.example/steal"))
        try { ApiClient(FakeSession(account())).call("GET", "/api/v1/x"); fail() } catch (e: ApiException) { assertEquals(302, e.status) }
        assertEquals(1, server.requestCount)
    }

    @Test fun `plain http is refused for an account that did not opt in`() = runBlocking {
        val acc = account().copy(allowInsecure = false)
        try { ApiClient(FakeSession(acc)).call("GET", "/api/v1/x"); fail() } catch (e: ApiException) { assertEquals("INSECURE_URL", e.code) }
        assertEquals(0, server.requestCount)
    }

    @Test fun `error bodies from the server are surfaced`() {
        val e = ApiClient.parseError(403, """{"success":false,"error":{"code":"FORBIDDEN","message":"Not authorized to view this lead"}}""")
        assertEquals("Not authorized to view this lead", e.message); assertTrue(e.isForbidden)
        val nest = ApiClient.parseError(400, """{"statusCode":400,"message":"fullName must be a string"}""")
        assertEquals("fullName must be a string", nest.message)
    }
}
