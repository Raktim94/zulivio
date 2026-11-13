package com.nodedr.zulivio.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import java.util.UUID

/** One signed-in (server, employee) pair. Several can be saved for account switching. */
@Serializable data class Account(
    val id: String,
    val serverUrl: String,
    val allowInsecure: Boolean = false,
    val employeeId: String,
    val fullName: String,
    val email: String,
    val role: String,
    val mustChangePassword: Boolean = false,
    val orgName: String = "",
    val deviceId: String = "",
    val accessToken: String = "",
    val accessExpiresAtMs: Long = 0,
    val refreshToken: String = "",
    /** True once the server told us the refresh token is no longer valid; the account stays listed so the user can sign in again. */
    val needsLogin: Boolean = false,
)

@Serializable private data class Persisted(val accounts: List<Account> = emptyList(), val activeId: String? = null)

/** What the network layer needs from the session store (lets the API client be tested without Android). */
interface SessionAccess {
    val installId: String
    val snapshot: SessionSnapshot
    val active: Account?
    fun update(id: String, change: (Account) -> Account)
}

/**
 * Accounts and tokens, encrypted at rest with a Keystore key. Everything
 * non-secret (the random install id, UI choices) lives in plain preferences.
 */
class SessionStore(context: Context, private val box: SecureBox = SecureBox()) : SessionAccess {
    private val secure = context.getSharedPreferences("zulivio_session", Context.MODE_PRIVATE)
    private val plain = context.getSharedPreferences("zulivio_plain", Context.MODE_PRIVATE)

    private val _state = MutableStateFlow(load())
    val state: StateFlow<SessionSnapshot> = _state.asStateFlow()

    override val snapshot: SessionSnapshot get() = _state.value
    override val active: Account? get() = _state.value.active

    /** A random id created on first launch. It identifies this installation to the server; it is not a hardware identifier. */
    override val installId: String
        get() = plain.getString("install_id", null) ?: UUID.randomUUID().toString().also { plain.edit().putString("install_id", it).apply() }

    private fun load(): SessionSnapshot {
        val blob = secure.getString("blob", null)?.let { box.decrypt(it) }
        val p = blob?.let { runCatching { AppJson.decodeFromString<Persisted>(it) }.getOrNull() } ?: Persisted()
        return SessionSnapshot(p.accounts, p.activeId)
    }

    @Synchronized
    private fun commit(next: SessionSnapshot) {
        secure.edit().putString("blob", box.encrypt(AppJson.encodeToString(Persisted(next.accounts, next.activeId)))).apply()
        _state.value = next
    }

    @Synchronized
    fun upsert(account: Account, makeActive: Boolean = true) {
        val cur = _state.value
        val list = cur.accounts.filterNot { it.id == account.id } + account
        commit(SessionSnapshot(list, if (makeActive) account.id else cur.activeId))
    }

    @Synchronized
    override fun update(id: String, change: (Account) -> Account) {
        val cur = _state.value
        val target = cur.accounts.firstOrNull { it.id == id } ?: return
        commit(cur.copy(accounts = cur.accounts.map { if (it.id == id) change(target) else it }))
    }

    @Synchronized
    fun switchTo(id: String) {
        val cur = _state.value
        if (cur.accounts.any { it.id == id }) commit(cur.copy(activeId = id))
    }

    /** Removes an account and its tokens from this phone. */
    @Synchronized
    fun remove(id: String) {
        val cur = _state.value
        val rest = cur.accounts.filterNot { it.id == id }
        commit(SessionSnapshot(rest, if (cur.activeId == id) rest.firstOrNull { !it.needsLogin }?.id ?: rest.firstOrNull()?.id else cur.activeId))
    }

    @Synchronized
    fun wipeAll() {
        secure.edit().clear().apply()
        _state.value = SessionSnapshot(emptyList(), null)
    }

    // ---- small, non-secret preferences ----
    fun getBool(key: String, default: Boolean = false) = plain.getBoolean(key, default)
    fun putBool(key: String, value: Boolean) = plain.edit().putBoolean(key, value).apply()
    fun getString(key: String): String? = plain.getString(key, null)
    fun putString(key: String, value: String?) = plain.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    fun getLong(key: String, default: Long = 0) = plain.getLong(key, default)
    fun putLong(key: String, value: Long) = plain.edit().putLong(key, value).apply()
    fun clearPlainExceptInstall() {
        val id = plain.getString("install_id", null)
        plain.edit().clear().apply { if (id != null) putString("install_id", id) }.apply()
    }
}

data class SessionSnapshot(val accounts: List<Account>, val activeId: String?) {
    val active: Account? get() = accounts.firstOrNull { it.id == activeId }
}
