package com.nodedr.zulivio.data

import kotlinx.serialization.encodeToString
import java.net.URLEncoder
import java.time.Instant

class Repository(private val api: ApiClient, private val session: SessionStore, val outbox: OutboxSync, private val dao: OutboxDao) {
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private val accountId get() = session.active?.id ?: throw ApiException(401, "NOT_SIGNED_IN", "Sign in to continue.")

    // ---- reads (online; callers keep last good data when offline) ----

    suspend fun myDay(): MyDay = api.get("/api/v1/leads/my-day")

    suspend fun leads(q: String, stageId: String?, priority: String?, sort: String, page: Int): LeadPage {
        val p = buildList {
            if (q.isNotBlank()) add("q=${enc(q.trim())}")
            if (stageId != null) add("stageId=$stageId")
            if (priority != null) add("priority=$priority")
            add("sort=$sort"); add("page=$page"); add("pageSize=25")
        }.joinToString("&")
        return api.get("/api/v1/leads/search?$p")
    }

    suspend fun leadDetail(id: String): LeadDetail = api.get("/api/v1/leads/$id/detail")
    suspend fun leadStages(): List<Stage> = api.get<List<Pipeline>>("/api/v1/pipelines?kind=LEAD").firstOrNull()?.stages.orEmpty()
    suspend fun followUps(): FollowUpDashboard = api.get("/api/v1/follow-ups")
    suspend fun tasks(): List<Assignment> = api.get("/api/v1/assignments")
    suspend fun workState(): WorkState = api.get("/api/v1/work-sessions/me")
    suspend fun activity(before: String?): ActivityFeed = api.get("/api/v1/mobile/activity?limit=40" + (before?.let { "&before=${enc(it)}" } ?: ""))
    suspend fun me(): MeResponse = api.get("/api/v1/mobile/auth/me")

    // ---- contacts ----
    suspend fun contactSummary(): ContactSummary = api.get("/api/v1/mobile/contacts/summary")
    suspend fun importedContacts(cursor: String?, q: String): RemoteContactPage =
        api.get("/api/v1/mobile/contacts?limit=50" + (cursor?.let { "&cursor=$it" } ?: "") + if (q.isNotBlank()) "&q=${enc(q)}" else "")
    suspend fun previewContacts(contacts: List<ContactUpload>, fields: List<String>): ContactPreviewResponse =
        api.post("/api/v1/mobile/contacts/preview", ContactPreviewRequest(contacts, fields))
    suspend fun importContacts(items: List<ContactImportItem>, fields: List<String>): ContactImportResponse =
        api.post("/api/v1/mobile/contacts/import", ContactImportRequest(items, fields))
    suspend fun deleteContacts(allDevices: Boolean = false): DeleteResult =
        AppJson.decodeFromString(api.call("DELETE", "/api/v1/mobile/contacts" + if (allDevices) "?scope=employee" else ""))
    suspend fun deleteContact(id: String) { api.call("DELETE", "/api/v1/mobile/contacts/$id") }

    // ---- writes: always go through the outbox so nothing is lost offline ----

    private suspend fun queue(kind: String, title: String, leadId: String?, method: String, path: String, body: String?): String {
        val id = outbox.enqueue(accountId, kind, OutboxPayload(title, leadId, method, path, body))
        return id
    }

    suspend fun addNote(lead: Lead, text: String) =
        queue("NOTE", "Note on ${lead.fullName}", lead.id, "POST", "/api/v1/leads/${lead.id}/notes", AppJson.encodeToString(NoteBody(text.trim())))

    suspend fun logDisposition(lead: Lead, body: DispositionBody) =
        queue("DISPOSITION", "Call result for ${lead.fullName}", lead.id, "POST", "/api/v1/leads/${lead.id}/calls/disposition", AppJson.encodeToString(body))

    suspend fun callInitiated(lead: Lead) =
        queue("CALL_INITIATED", "Call started to ${lead.fullName}", lead.id, "POST", "/api/v1/leads/${lead.id}/call-initiated", "{}")

    suspend fun changeStage(lead: Lead, stage: Stage, lossReason: String? = null) =
        queue("STAGE", "Move ${lead.fullName} to ${stage.name}", lead.id, "PATCH", "/api/v1/leads/${lead.id}/stage", AppJson.encodeToString(StageBody(stage.id, lossReason)))

    suspend fun scheduleFollowUp(lead: Lead, dueAt: Instant, note: String?) =
        queue("FOLLOW_UP", "Follow-up for ${lead.fullName}", lead.id, "POST", "/api/v1/leads/${lead.id}/follow-ups", AppJson.encodeToString(FollowUpBody(dueAt.toString(), note?.takeIf { it.isNotBlank() })))

    suspend fun completeFollowUp(f: FollowUp) =
        queue("FOLLOW_UP_DONE", "Complete follow-up for ${f.lead?.fullName ?: "lead"}", f.leadId, "PATCH", "/api/v1/follow-ups/${f.id}/complete", "{}")

    suspend fun rescheduleFollowUp(f: FollowUp, dueAt: Instant) =
        queue("FOLLOW_UP_MOVE", "Reschedule follow-up for ${f.lead?.fullName ?: "lead"}", f.leadId, "PATCH", "/api/v1/follow-ups/${f.id}/reschedule", AppJson.encodeToString(FollowUpBody(dueAt.toString())))

    suspend fun logManualCall(phone: String, type: String, durationSeconds: Int, note: String?, contactName: String?, leadId: String?, leadName: String?) {
        val id = java.util.UUID.randomUUID().toString()
        val body = ManualCallBody(
            phone_number = phone, call_type = type, started_at = Instant.now().toString(), duration_seconds = durationSeconds,
            external_id = id.take(36), contact_name = contactName, metadata = buildMap { put("entry", if (type == "missed") "missed_quick" else "manual"); note?.takeIf { it.isNotBlank() }?.let { put("note", it.take(180)) } },
        )
        outbox.enqueue(accountId, "MANUAL_CALL", OutboxPayload("Logged ${type} call${leadName?.let { " (${it})" } ?: ""}", leadId, "POST", "/api/v1/mobile/calls", AppJson.encodeToString(body)), id)
    }

    suspend fun transitionTask(a: Assignment, toStatus: String) =
        queue("TASK", "Task #${a.assignmentNumber}: ${toStatus.lowercase().replace('_', ' ')}", null, "POST", "/api/v1/assignments/${a.id}/transitions", AppJson.encodeToString(TransitionBody(toStatus)))

    // attendance is time-critical and not queued: it must reflect the server's clock
    suspend fun startShift(): WorkState { api.call("POST", "/api/v1/work-sessions/start", "{}"); return workState() }
    suspend fun endShift(sessionId: String): WorkState { api.call("POST", "/api/v1/work-sessions/$sessionId/end", "{}"); return workState() }
    suspend fun startBreak(sessionId: String): WorkState { api.call("POST", "/api/v1/work-sessions/$sessionId/breaks/start", "{}"); return workState() }
    suspend fun endBreak(sessionId: String, breakId: String): WorkState { api.call("POST", "/api/v1/work-sessions/$sessionId/breaks/$breakId/end", "{}"); return workState() }

    // ---- sync state ----
    fun outboxItems(accountId: String) = dao.observe(accountId)
    suspend fun drainNow() = outbox.drain(accountId)
    fun lastSync(accountId: String): Long = session.getLong("last_sync_$accountId")
}
