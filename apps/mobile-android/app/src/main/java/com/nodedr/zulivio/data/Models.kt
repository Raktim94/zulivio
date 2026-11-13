package com.nodedr.zulivio.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** One lenient parser for every server payload: unknown fields are ignored so a newer server never breaks an older app. */
val AppJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    encodeDefaults = true
}

@Serializable data class ServerInfo(
    val product: String = "",
    val apiVersion: Int = 0,
    val serverVersion: String = "",
    val serverTime: String = "",
)

@Serializable data class DeviceInfo(val installId: String, val name: String, val platform: String = "android", val appVersion: String)
@Serializable data class LoginRequest(val email: String, val password: String, val device: DeviceInfo)
@Serializable data class RefreshRequest(val refreshToken: String)
@Serializable data class LogoutRequest(val purgeContacts: Boolean = false)

@Serializable data class DeviceRef(val id: String = "", val name: String = "")
@Serializable data class OrgRef(val name: String = "")
@Serializable data class EmployeeDto(
    val id: String,
    val fullName: String = "",
    val email: String = "",
    val role: String = "EMPLOYEE",
    val mustChangePassword: Boolean = false,
)

@Serializable data class AuthResponse(
    val accessToken: String,
    val accessExpiresAt: String = "",
    val refreshToken: String,
    val refreshExpiresAt: String = "",
    val device: DeviceRef? = null,
    val employee: EmployeeDto? = null,
    val organization: OrgRef? = null,
)

@Serializable data class MeResponse(val device: DeviceRef = DeviceRef(), val employee: EmployeeDto, val organization: OrgRef = OrgRef())

@Serializable data class PersonRef(val id: String = "", val fullName: String = "")
@Serializable data class Stage(
    val id: String,
    val name: String = "",
    val sortOrder: Int = 0,
    val isWon: Boolean = false,
    val isLost: Boolean = false,
)

@Serializable data class Pipeline(val id: String, val name: String = "", val kind: String = "", val stages: List<Stage> = emptyList())

@Serializable data class Lead(
    val id: String,
    val fullName: String = "",
    val email: String? = null,
    val phone: String? = null,
    val company: String? = null,
    val source: String? = null,
    val status: String = "NEW",
    val stageId: String? = null,
    val stage: Stage? = null,
    val priority: String = "NORMAL",
    val score: Int = 0,
    val nextFollowUpAt: String? = null,
    val lastContactedAt: String? = null,
    val callCount: Int = 0,
    val ownerId: String? = null,
    val owner: PersonRef? = null,
    val tags: List<String> = emptyList(),
    val notes: String? = null,
    val createdAt: String = "",
)

@Serializable data class LeadPage(val items: List<Lead> = emptyList(), val total: Int = 0, val page: Int = 1, val pageSize: Int = 25, val totalPages: Int = 1)

@Serializable data class LeadRef(
    val id: String = "",
    val fullName: String = "",
    val company: String? = null,
    val phone: String? = null,
    val status: String = "",
    val score: Int = 0,
)

@Serializable data class FollowUp(
    val id: String,
    val leadId: String = "",
    val dueAt: String = "",
    val note: String? = null,
    val status: String = "PENDING",
    val lead: LeadRef? = null,
)

@Serializable data class FollowUpBuckets(
    val overdue: List<FollowUp> = emptyList(),
    val dueNow: List<FollowUp> = emptyList(),
    val dueToday: List<FollowUp> = emptyList(),
    val tomorrow: List<FollowUp> = emptyList(),
    val upcoming: List<FollowUp> = emptyList(),
)

@Serializable data class FollowUpCounts(
    val overdue: Int = 0,
    val dueNow: Int = 0,
    val dueToday: Int = 0,
    val tomorrow: Int = 0,
    val upcoming: Int = 0,
    val completedThisWeek: Int = 0,
)

@Serializable data class FollowUpDashboard(val buckets: FollowUpBuckets = FollowUpBuckets(), val counts: FollowUpCounts = FollowUpCounts())

@Serializable data class DayStats(val callsToday: Int = 0, val connectedToday: Int = 0, val meetingsToday: Int = 0, val openLeads: Int = 0)

@Serializable data class MyDay(
    val toContact: List<Lead> = emptyList(),
    val hotLeads: List<Lead> = emptyList(),
    val recentlyAssigned: List<Lead> = emptyList(),
    val followUps: FollowUpDashboard = FollowUpDashboard(),
    val stats: DayStats = DayStats(),
)

@Serializable data class Activity(
    val id: String,
    val type: String = "NOTE",
    val body: String? = null,
    val metadata: JsonObject? = null,
    val callOutcome: String? = null,
    val callDisposition: String? = null,
    val callDurationSeconds: Int? = null,
    val createdAt: String = "",
    val actor: PersonRef? = null,
) {
    /** Where this entry came from, as stored by the server (never inferred on the phone). */
    val source: String? get() = metadata?.get("source")?.jsonPrimitive?.contentOrNull
    val event: String? get() = metadata?.get("event")?.jsonPrimitive?.contentOrNull
}

@Serializable data class ScoreItem(val key: String = "", val label: String = "", val weight: Int = 0, val earned: Boolean = false)

@Serializable data class LeadDetail(
    val lead: Lead,
    val scoreBand: String = "",
    val scoreBreakdown: List<ScoreItem> = emptyList(),
    val stages: List<Stage> = emptyList(),
    val activities: List<Activity> = emptyList(),
    val followUps: List<FollowUp> = emptyList(),
    val dialUri: String? = null,
)

@Serializable data class ActivityFeedItem(
    val id: String,
    val at: String = "",
    val kind: String = "",
    val outcome: String? = null,
    val disposition: String? = null,
    val durationSeconds: Int? = null,
    val note: String? = null,
    val lead: PersonRef? = null,
    val phone: String? = null,
    val sourceLabel: String = "device_imported",
)

@Serializable data class ActivityFeed(val items: List<ActivityFeedItem> = emptyList(), val nextBefore: String? = null)

@Serializable data class Assignment(
    val id: String,
    val assignmentNumber: Int = 0,
    val title: String = "",
    val description: String? = null,
    val status: String = "",
    val dueAt: String? = null,
)

@Serializable data class WorkState(val state: String = "logged_out", val sessionId: String? = null, val startedAt: String? = null, val currentBreakId: String? = null)

// ---- contacts ----

@Serializable data class ContactUpload(
    val sourceId: String,
    val displayName: String,
    val phones: List<String>,
    val company: String? = null,
    val emails: List<String>? = null,
)

@Serializable data class ContactPreviewRequest(val contacts: List<ContactUpload>, val fields: List<String>)

@Serializable data class ContactPreviewItem(
    val index: Int = 0,
    val sourceId: String = "",
    val displayName: String = "",
    val state: String = "NEW",
    val phones: List<String> = emptyList(),
    val matchLeadId: String? = null,
    val matchLeadName: String? = null,
    val normalizationUnreliable: Boolean = false,
)

@Serializable data class ContactPreviewResponse(val results: List<ContactPreviewItem> = emptyList(), val counts: Map<String, Int> = emptyMap())

@Serializable data class ContactImportItem(
    val sourceId: String,
    val displayName: String,
    val phones: List<String>,
    val company: String? = null,
    val emails: List<String>? = null,
    val decision: String,
    val linkLeadId: String? = null,
)

@Serializable data class ContactImportRequest(val contacts: List<ContactImportItem>, val fields: List<String>)

@Serializable data class ContactImportResult(val sourceId: String = "", val status: String = "", val code: String? = null, val message: String? = null, val leadId: String? = null)

@Serializable data class ContactImportResponse(
    val received: Int = 0,
    val created: Int = 0,
    val linked: Int = 0,
    val skipped: Int = 0,
    val unchanged: Int = 0,
    val rejected: Int = 0,
    val results: List<ContactImportResult> = emptyList(),
)

@Serializable data class RemoteContact(
    val id: String,
    val displayName: String = "",
    val company: String? = null,
    val status: String = "",
    val leadId: String? = null,
    val lastSyncedAt: String = "",
)

@Serializable data class RemoteContactPage(val items: List<RemoteContact> = emptyList(), val nextCursor: String? = null)
@Serializable data class ContactSummary(val counts: Map<String, Int> = emptyMap(), val lastSyncedAt: String? = null)
@Serializable data class DeleteResult(val ok: Boolean = true, val deleted: Int = 0, val purgedContacts: Int = 0)

// ---- request bodies queued by the app ----

@Serializable data class NoteBody(val body: String)
@Serializable data class DispositionBody(
    val outcome: String,
    val disposition: String,
    val durationSeconds: Int? = null,
    val notes: String? = null,
    val followUpAt: String? = null,
    val followUpNote: String? = null,
)
@Serializable data class StageBody(val stageId: String, val lossReason: String? = null)
@Serializable data class FollowUpBody(val dueAt: String, val note: String? = null)
@Serializable data class CompleteFollowUpBody(val outcome: String? = null)
@Serializable data class TransitionBody(val toStatus: String, val note: String? = null)
@Serializable data class ManualCallBody(
    val phone_number: String,
    val call_type: String,
    val started_at: String,
    val duration_seconds: Int,
    val external_id: String,
    val source: String = "app_manual",
    val contact_name: String? = null,
    val metadata: Map<String, String>? = null,
)

// Dispositions allowed for each outcome — mirrors the server's own table (the server remains the authority).
object Dispositions {
    val connected = listOf("INTERESTED", "QUALIFIED", "MEETING_BOOKED", "CALLBACK", "PROPOSAL_REQUESTED", "NOT_INTERESTED", "NO_BUDGET", "COMPETITOR", "WRONG_PERSON")
    val notConnected = listOf("NO_ANSWER", "BUSY", "SWITCHED_OFF", "INVALID_NUMBER", "OUT_OF_COVERAGE")
    fun label(code: String): String = code.lowercase().split('_').joinToString(" ") { it.replaceFirstChar(Char::uppercase) }
}
