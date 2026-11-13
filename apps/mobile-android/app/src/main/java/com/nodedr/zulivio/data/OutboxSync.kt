package com.nodedr.zulivio.data

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.encodeToString

enum class DrainOutcome { DONE, OFFLINE, AUTH_REQUIRED, PARTIAL }

data class DrainResult(val sent: Int, val failed: Int, val outcome: DrainOutcome)

/**
 * Sends queued actions oldest-first. Rules that keep data safe:
 *  - an action is deleted only after the server answered 2xx
 *  - network errors / 5xx / 429 keep it PENDING and stop the run (try again later)
 *  - the server refusing it (400/403/404/422) marks it FAILED with the server's
 *    message, so it is never retried blindly and never silently dropped
 *  - the row id is the Idempotency-Key, so a retry can't duplicate it
 */
class OutboxSync(private val dao: OutboxDao, private val api: ApiClient, private val session: SessionStore, private val box: SecureBox) {
    private val lock = Mutex()
    private val _running = MutableStateFlow(false)
    val running: StateFlow<Boolean> = _running.asStateFlow()

    /** Increments whenever queued changes reach the server, so screens know to reload. */
    private val _tick = MutableStateFlow(0)
    val tick: StateFlow<Int> = _tick.asStateFlow()

    suspend fun enqueue(accountId: String, kind: String, payload: OutboxPayload, id: String = java.util.UUID.randomUUID().toString()): String {
        val now = System.currentTimeMillis()
        dao.upsert(
            OutboxItem(
                id = id, accountId = accountId, kind = kind,
                payloadEnc = box.encrypt(AppJson.encodeToString(payload)),
                state = OutboxState.PENDING, attempts = 0, lastCode = null, lastError = null, createdAt = now, updatedAt = now,
            ),
        )
        return id
    }

    fun decode(item: OutboxItem): OutboxPayload? = box.decrypt(item.payloadEnc)?.let { runCatching { AppJson.decodeFromString<OutboxPayload>(it) }.getOrNull() }

    suspend fun retry(id: String) {
        val item = dao.get(id) ?: return
        dao.upsert(item.copy(state = OutboxState.PENDING, lastError = null, lastCode = null, updatedAt = System.currentTimeMillis()))
    }

    suspend fun discard(id: String) = dao.delete(id)

    suspend fun drain(accountId: String): DrainResult = lock.withLock {
        _running.value = true
        try {
            val account = session.snapshot.accounts.firstOrNull { it.id == accountId }
            if (account == null || account.needsLogin) return DrainResult(0, 0, DrainOutcome.AUTH_REQUIRED)
            var sent = 0
            var failed = 0
            for (item in dao.pending(accountId)) {
                val payload = decode(item)
                if (payload == null) {
                    // Cannot be decrypted (key was reset): surface it instead of looping forever.
                    dao.upsert(item.copy(state = OutboxState.FAILED, lastCode = "UNREADABLE", lastError = "This item can't be read any more and can't be sent.", updatedAt = System.currentTimeMillis()))
                    failed++
                    continue
                }
                try {
                    api.call(payload.method, payload.path, payload.body, idempotencyKey = item.id, account = account)
                    dao.delete(item.id)
                    sent++
                } catch (e: ApiException) {
                    val now = System.currentTimeMillis()
                    when {
                        e.status == 401 -> return DrainResult(sent, failed, DrainOutcome.AUTH_REQUIRED)
                        e.retryable || e.isOffline -> {
                            dao.upsert(item.copy(attempts = item.attempts + 1, lastCode = e.code, lastError = e.message, updatedAt = now))
                            return DrainResult(sent, failed, if (e.isOffline) DrainOutcome.OFFLINE else DrainOutcome.PARTIAL)
                        }
                        else -> {
                            dao.upsert(item.copy(state = OutboxState.FAILED, attempts = item.attempts + 1, lastCode = e.code, lastError = e.message, updatedAt = now))
                            failed++
                        }
                    }
                }
            }
            if (sent > 0) _tick.value += 1
            if (sent > 0 || failed == 0) session.putLong("last_sync_$accountId", System.currentTimeMillis())
            DrainResult(sent, failed, if (failed > 0) DrainOutcome.PARTIAL else DrainOutcome.DONE)
        } finally {
            _running.value = false
        }
    }
}
