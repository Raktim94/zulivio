package com.nodedr.zulivio.contacts

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import com.nodedr.zulivio.data.ApiException
import com.nodedr.zulivio.data.ContactImportItem
import com.nodedr.zulivio.data.ContactPreviewItem
import com.nodedr.zulivio.data.ContactUpload
import com.nodedr.zulivio.data.Repository
import com.nodedr.zulivio.data.SessionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** A contact as shown in the picker: name and numbers only. Nothing else is read until the user has chosen what to share. */
data class DeviceContact(val id: String, val name: String, val phones: List<String>)

enum class Decision { IMPORT, LINK, UPDATE, SKIP }

data class ReviewItem(val preview: ContactPreviewItem, val upload: ContactUpload, val decision: Decision, val options: List<Decision>)

enum class FlowMode { PICK, ALL, RESYNC }

data class ReviewUi(
    val mode: FlowMode = FlowMode.PICK,
    val loading: Boolean = false,
    val items: List<ReviewItem> = emptyList(),
    val hidden: Int = 0,           // NEW contacts left out of a re-sync, unchanged contacts, contacts without numbers
    val error: ApiException? = null,
    val importing: Boolean = false,
    val progress: Int = 0,
    val total: Int = 0,
    val result: Result? = null,
) {
    data class Result(val created: Int, val linked: Int, val updated: Int, val skipped: Int, val rejected: Int, val messages: List<String>)
}

class ContactsFlow(private val appContext: Context, private val repo: Repository, private val session: SessionStore, private val scope: CoroutineScope) {
    private val _device = MutableStateFlow<List<DeviceContact>>(emptyList())
    val device: StateFlow<List<DeviceContact>> = _device.asStateFlow()
    private val _loadingDevice = MutableStateFlow(false)
    val loadingDevice: StateFlow<Boolean> = _loadingDevice.asStateFlow()
    private val _selected = MutableStateFlow<Set<String>>(emptySet())
    val selected: StateFlow<Set<String>> = _selected.asStateFlow()
    private val _review = MutableStateFlow(ReviewUi())
    val review: StateFlow<ReviewUi> = _review.asStateFlow()
    private val _fields = MutableStateFlow(loadFields())
    val fields: StateFlow<Set<String>> = _fields.asStateFlow()
    private var job: Job? = null

    fun hasPermission(): Boolean = ContextCompat.checkSelfPermission(appContext, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

    // ---- which optional fields the user agreed to share ("company", "emails") ----
    private fun loadFields(): Set<String> = session.getString("contacts_fields")?.split(",")?.filter { it.isNotBlank() }?.toSet() ?: emptySet()
    fun setField(name: String, on: Boolean) {
        val next = if (on) _fields.value + name else _fields.value - name
        _fields.value = next
        session.putString("contacts_fields", next.joinToString(","))
    }

    fun toggle(id: String) = _selected.update { if (id in it) it - id else it + id }
    fun selectAll(ids: Collection<String>) = _selected.update { it + ids }
    fun clearSelection() { _selected.value = emptySet() }

    /** Reads names and phone numbers only — enough to let the user choose. */
    fun loadDevice() {
        if (!hasPermission()) return
        scope.launch {
            _loadingDevice.value = true
            val list = withContext(Dispatchers.IO) { readNamesAndPhones() }
            _device.value = list
            _loadingDevice.value = false
        }
    }

    private fun readNamesAndPhones(): List<DeviceContact> {
        val map = LinkedHashMap<String, Pair<String, MutableList<String>>>()
        val cols = arrayOf(ContactsContract.CommonDataKinds.Phone.CONTACT_ID, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER)
        appContext.contentResolver.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, cols, null, null, "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} COLLATE NOCASE ASC")?.use { c ->
            while (c.moveToNext()) {
                val id = c.getString(0) ?: continue
                val number = c.getString(2)?.trim().orEmpty()
                if (number.isEmpty()) continue
                val entry = map.getOrPut(id) { (c.getString(1)?.trim().orEmpty()) to mutableListOf() }
                if (number !in entry.second) entry.second.add(number)
            }
        }
        return map.map { (id, v) -> DeviceContact(id, v.first.ifBlank { v.second.first() }, v.second) }
    }

    /** Reads emails / company ONLY for the chosen contacts and ONLY for fields the user switched on. */
    private fun buildUploads(ids: Set<String>, fields: Set<String>): List<ContactUpload> {
        val base = _device.value.filter { it.id in ids }
        val emails = HashMap<String, MutableList<String>>()
        val companies = HashMap<String, String>()
        if ("emails" in fields) appContext.contentResolver.query(
            ContactsContract.CommonDataKinds.Email.CONTENT_URI, arrayOf(ContactsContract.CommonDataKinds.Email.CONTACT_ID, ContactsContract.CommonDataKinds.Email.ADDRESS), null, null, null,
        )?.use { c -> while (c.moveToNext()) { val id = c.getString(0) ?: continue; if (id in ids) c.getString(1)?.let { emails.getOrPut(id) { mutableListOf() }.add(it) } } }
        if ("company" in fields) appContext.contentResolver.query(
            ContactsContract.Data.CONTENT_URI, arrayOf(ContactsContract.Data.CONTACT_ID, ContactsContract.CommonDataKinds.Organization.COMPANY),
            "${ContactsContract.Data.MIMETYPE} = ?", arrayOf(ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE), null,
        )?.use { c -> while (c.moveToNext()) { val id = c.getString(0) ?: continue; if (id in ids) c.getString(1)?.takeIf { it.isNotBlank() }?.let { companies.putIfAbsent(id, it) } } }
        return base.map { ContactUpload(sourceId = it.id, displayName = it.name, phones = it.phones, company = companies[it.id], emails = if ("emails" in fields) emails[it.id].orEmpty() else null) }
    }

    // ---- review ----

    fun startReview(mode: FlowMode) {
        job?.cancel()
        val fields = _fields.value
        _review.value = ReviewUi(mode = mode, loading = true)
        job = scope.launch {
            try {
                // "All" and "re-sync" start from whatever is on the phone right now; make sure it's been read before we count it.
                if (mode != FlowMode.PICK || _device.value.isEmpty()) _device.value = withContext(Dispatchers.IO) { readNamesAndPhones() }
                val ids = when (mode) { FlowMode.PICK -> _selected.value; else -> _device.value.map { it.id }.toSet() }
                val uploads = withContext(Dispatchers.IO) { buildUploads(ids, fields) }
                val previews = ArrayList<ContactPreviewItem>()
                uploads.chunked(200).forEach { chunk ->
                    val r = repo.previewContacts(chunk, fields.toList())
                    // The server indexes within the chunk; re-key by sourceId so batches can't be confused.
                    previews += r.results
                }
                val byId = uploads.associateBy { it.sourceId }
                var hidden = 0
                val items = previews.mapNotNull { p ->
                    val up = byId[p.sourceId] ?: return@mapNotNull null
                    when (p.state) {
                        "NO_PHONE", "UNCHANGED" -> { hidden++; null }
                        "NEW" -> if (mode == FlowMode.RESYNC) { hidden++; null } else ReviewItem(p, up, Decision.IMPORT, listOf(Decision.IMPORT, Decision.SKIP))
                        "CHANGED" -> ReviewItem(p, up, Decision.UPDATE, listOf(Decision.UPDATE, Decision.SKIP))
                        "DUPLICATE_LEAD" -> if (mode == FlowMode.RESYNC) { hidden++; null } else ReviewItem(p, up, Decision.LINK, listOf(Decision.LINK, Decision.SKIP))
                        "DUPLICATE_CONTACT" -> if (mode == FlowMode.RESYNC) { hidden++; null } else ReviewItem(p, up, Decision.SKIP, listOf(Decision.SKIP, Decision.IMPORT))
                        else -> if (mode == FlowMode.RESYNC) { hidden++; null } else ReviewItem(p, up, Decision.SKIP, listOf(Decision.SKIP)) // hidden + in-batch duplicates
                    }
                }
                _review.update { it.copy(loading = false, items = items, hidden = hidden) }
            } catch (e: ApiException) {
                _review.update { it.copy(loading = false, error = e) }
            }
        }
    }

    fun decide(sourceId: String, d: Decision) = _review.update { r -> r.copy(items = r.items.map { if (it.upload.sourceId == sourceId) it.copy(decision = d) else it }) }
    fun setAll(d: Decision) = _review.update { r -> r.copy(items = r.items.map { if (d in it.options) it.copy(decision = d) else it }) }

    fun confirmImport() {
        val r = _review.value
        val fields = _fields.value.toList()
        val work = r.items
        job?.cancel()
        _review.update { it.copy(importing = true, progress = 0, total = work.size, error = null) }
        job = scope.launch {
            var created = 0; var linked = 0; var updated = 0; var skipped = 0; var rejected = 0
            val messages = mutableListOf<String>()
            try {
                work.chunked(100).forEach { chunk ->
                    val req = chunk.map { ri ->
                        ContactImportItem(
                            sourceId = ri.upload.sourceId, displayName = ri.upload.displayName, phones = ri.upload.phones, company = ri.upload.company, emails = ri.upload.emails,
                            decision = when (ri.decision) { Decision.SKIP -> "SKIP"; Decision.LINK -> "LINK"; else -> "IMPORT" },
                            linkLeadId = if (ri.decision == Decision.LINK) ri.preview.matchLeadId else null,
                        )
                    }
                    val res = repo.importContacts(req, fields)
                    created += res.created; linked += res.linked; skipped += res.skipped; rejected += res.rejected
                    updated += res.results.count { it.status == "updated" }
                    res.results.filter { it.code != null }.take(5).forEach { messages += "${it.sourceId.take(6)}: ${it.message}" }
                    _review.update { it.copy(progress = it.progress + chunk.size) }
                }
                _selected.value = emptySet()
                _review.update { it.copy(importing = false, result = ReviewUi.Result(created, linked, updated, skipped, rejected, messages)) }
            } catch (e: ApiException) {
                // Safe to retry: the server treats every contact idempotently, so already-sent ones come back "unchanged".
                _review.update { it.copy(importing = false, error = e) }
            }
        }
    }

    fun reset() { job?.cancel(); _review.value = ReviewUi() }
    fun forgetDeviceData() { _device.value = emptyList(); _selected.value = emptySet(); _review.value = ReviewUi() }
}
