package com.nodedr.zulivio.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.CloudQueue
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Message
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Sms
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nodedr.zulivio.AppContainer
import com.nodedr.zulivio.data.Activity
import com.nodedr.zulivio.data.DispositionBody
import com.nodedr.zulivio.data.Dispositions
import com.nodedr.zulivio.data.Lead
import com.nodedr.zulivio.data.LeadDetail
import com.nodedr.zulivio.data.OutboxItem
import com.nodedr.zulivio.data.OutboxState
import com.nodedr.zulivio.data.Stage
import com.nodedr.zulivio.ui.components.ActionTile
import com.nodedr.zulivio.ui.components.AppCard
import com.nodedr.zulivio.ui.components.Chip
import com.nodedr.zulivio.ui.components.DateTimeDialog
import com.nodedr.zulivio.ui.components.Fmt
import com.nodedr.zulivio.ui.components.Intents
import com.nodedr.zulivio.ui.components.LoadState
import com.nodedr.zulivio.ui.components.LoadView
import com.nodedr.zulivio.ui.components.Loader
import com.nodedr.zulivio.ui.components.PrimaryButton
import com.nodedr.zulivio.ui.components.ScreenBar
import com.nodedr.zulivio.ui.components.SecondaryButton
import com.nodedr.zulivio.ui.components.SectionTitle
import com.nodedr.zulivio.ui.components.SelectChip
import com.nodedr.zulivio.ui.components.Tone
import com.nodedr.zulivio.ui.containerViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.time.Instant

class LeadDetailVM(private val c: AppContainer, private val id: String) : ViewModel() {
    val detail = Loader(viewModelScope) { c.repo.leadDetail(id) }
    init { detail.refresh() }

    /** Unsent actions for this lead, newest last — shown above the timeline so nothing the user did ever looks lost. */
    fun pending(): Flow<List<Pair<OutboxItem, String>>> {
        val acc = c.session.active?.id ?: return kotlinx.coroutines.flow.flowOf(emptyList())
        return c.repo.outboxItems(acc).map { list ->
            list.mapNotNull { item -> c.outbox.decode(item)?.takeIf { it.leadId == id }?.let { item to it.title } }
        }
    }

    fun note(lead: Lead, text: String) = viewModelScope.launch { c.repo.addNote(lead, text) }
    fun disposition(lead: Lead, body: DispositionBody) = viewModelScope.launch { c.repo.logDisposition(lead, body) }
    fun stage(lead: Lead, stage: Stage, lossReason: String?) = viewModelScope.launch { c.repo.changeStage(lead, stage, lossReason) }
    fun followUp(lead: Lead, at: Instant, note: String?) = viewModelScope.launch { c.repo.scheduleFollowUp(lead, at, note) }
    fun retry(id: String) = viewModelScope.launch { c.outbox.retry(id) }
    fun discard(id: String) = viewModelScope.launch { c.outbox.discard(id) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LeadDetailScreen(c: AppContainer, id: String, openLog: Boolean, onBack: () -> Unit) {
    val vm: LeadDetailVM = containerViewModel(c, key = "lead:$id") { LeadDetailVM(it, id) }
    val state by vm.detail.state.collectAsState()
    val pending by vm.pending().collectAsState(initial = emptyList())
    val tick by c.outbox.tick.collectAsState()
    LaunchedEffect(tick) { if (tick > 0) vm.detail.refresh() }
    val title = (state as? LoadState.Ready<LeadDetail>)?.data?.lead?.fullName ?: "Lead"

    Column(Modifier.fillMaxSize()) {
        ScreenBar(title, onBack = onBack)
        LoadView(state, onRetry = vm.detail::refresh) { d -> DetailContent(c, vm, d, pending, openLog) }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun DetailContent(c: AppContainer, vm: LeadDetailVM, d: LeadDetail, pending: List<Pair<OutboxItem, String>>, openLog: Boolean) {
    val lead = d.lead
    val ctx = LocalContext.current
    var showDisposition by remember { mutableStateOf(openLog) }
    var showFollowUp by remember { mutableStateOf(false) }
    var lossFor by remember { mutableStateOf<Stage?>(null) }
    var noteText by remember { mutableStateOf("") }
    var scoreOpen by remember { mutableStateOf(false) }

    LazyColumn(contentPadding = PaddingValues(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Column(Modifier.padding(horizontal = 16.dp)) {
                AppCard {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.size(48.dp)) {
                                Box(contentAlignment = Alignment.Center) { Text(Fmt.initials(lead.fullName), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onPrimaryContainer) }
                            }
                            Spacer(Modifier.width(12.dp))
                            Column {
                                Text(lead.fullName, style = MaterialTheme.typography.titleLarge)
                                lead.company?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                        }
                        Spacer(Modifier.size(12.dp))
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            lead.stage?.name?.let { Chip(it, Tone.Brand) }
                            Chip("Score ${lead.score}${if (d.scoreBand.isNotBlank()) " · ${Fmt.enumLabel(d.scoreBand)}" else ""}", scoreTone(lead.score))
                            Chip(Fmt.enumLabel(lead.priority), if (lead.priority == "URGENT" || lead.priority == "HIGH") Tone.Danger else Tone.Neutral)
                            lead.source?.let { Chip(it, Tone.Neutral) }
                        }
                        Spacer(Modifier.size(12.dp))
                        InfoLine("Owner", lead.owner?.fullName ?: "Unassigned")
                        lead.phone?.let { InfoLine("Phone", Fmt.phone(it)) }
                        lead.email?.let { InfoLine("Email", it) }
                        InfoLine("Last contacted", lead.lastContactedAt?.let { Fmt.ago(it) } ?: "Never")
                    }
                }
            }
        }
        // Contact actions
        item {
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!lead.phone.isNullOrBlank()) {
                    PrimaryButton("Call ${Fmt.phone(lead.phone)}", onClick = { LeadActions.call(c, ctx, lead) }, icon = Icons.Filled.Call, modifier = Modifier.fillMaxWidth())
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ActionTile("SMS", Icons.Filled.Sms, onClick = { Intents.sms(ctx, lead.phone) }, modifier = Modifier.weight(1f))
                        ActionTile("WhatsApp", Icons.Filled.Message, onClick = { Intents.whatsapp(ctx, lead.phone) }, modifier = Modifier.weight(1f))
                        if (!lead.email.isNullOrBlank()) ActionTile("Email", Icons.Filled.Email, onClick = { Intents.email(ctx, lead.email) }, modifier = Modifier.weight(1f))
                    }
                } else if (!lead.email.isNullOrBlank()) {
                    SecondaryButton("Email ${lead.email}", onClick = { Intents.email(ctx, lead.email) }, icon = Icons.Filled.Email, modifier = Modifier.fillMaxWidth())
                } else {
                    Text("This lead has no phone number or email yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                SecondaryButton("Record call result", onClick = { showDisposition = true }, icon = Icons.Filled.Edit, modifier = Modifier.fillMaxWidth())
            }
        }
        // Next follow-up
        item {
            val next = d.followUps.firstOrNull { it.status == "PENDING" }
            Column(Modifier.padding(horizontal = 16.dp)) {
                AppCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.CalendarMonth, null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text("Next follow-up", style = MaterialTheme.typography.titleSmall)
                            Text(next?.let { Fmt.whenText(it.dueAt) + (it.note?.takeIf { n -> n.isNotBlank() }?.let { n -> " · $n" } ?: "") } ?: "Nothing scheduled", style = MaterialTheme.typography.bodyMedium, color = if (next != null && Fmt.isPast(next.dueAt)) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        TextButton(onClick = { showFollowUp = true }) { Text(if (next == null) "Schedule" else "Add another") }
                    }
                }
            }
        }
        // Pipeline stage — a tap target for every stage, no drag required.
        item {
            Column {
                SectionTitle("Pipeline stage")
                FlowRow(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    d.stages.sortedBy { it.sortOrder }.forEach { s ->
                        SelectChip(
                            selected = s.id == lead.stageId,
                            onClick = { if (s.id != lead.stageId) { if (s.isLost) lossFor = s else vm.stage(lead, s, null) } },
                            label = s.name,
                        )
                    }
                }
            }
        }
        // Add note
        item {
            Column(Modifier.padding(horizontal = 16.dp)) {
                OutlinedTextField(
                    value = noteText, onValueChange = { noteText = it }, label = { Text("Add a note") }, modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 5,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                )
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.End) {
                    PrimaryButton("Save note", onClick = { vm.note(lead, noteText); noteText = "" }, enabled = noteText.isNotBlank())
                }
            }
        }
        // Pending / failed uploads for this lead
        if (pending.isNotEmpty()) {
            item { SectionTitle("Waiting to sync") }
            items(pending, key = { it.first.id }) { (item, title) -> PendingRow(item, title, onRetry = { vm.retry(item.id) }, onDiscard = { vm.discard(item.id) }) }
        }
        // Score explanation
        if (d.scoreBreakdown.isNotEmpty()) {
            item {
                Column(Modifier.padding(horizontal = 16.dp)) {
                    AppCard(onClick = { scoreOpen = !scoreOpen }) {
                        Column {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Why this score?", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                                Icon(if (scoreOpen) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, if (scoreOpen) "Collapse" else "Expand")
                            }
                            if (scoreOpen) d.scoreBreakdown.forEach { s ->
                                Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(if (s.earned) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, if (s.earned) "Earned" else "Not earned", Modifier.size(18.dp), tint = if (s.earned) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline)
                                    Spacer(Modifier.width(8.dp))
                                    Text("${s.label} (+${s.weight})", style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                    }
                }
            }
        }
        // Timeline
        item { SectionTitle("Activity") }
        if (d.activities.isEmpty()) item { Text("No activity yet.", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        items(d.activities, key = { it.id }) { a -> TimelineRow(a) }
    }

    if (showDisposition) DispositionSheet(
        leadName = lead.fullName,
        onDismiss = { showDisposition = false },
        onSave = { body -> vm.disposition(lead, body); showDisposition = false },
    )
    if (showFollowUp) DateTimeDialog("Follow-up date", onConfirm = { at -> showFollowUp = false; vm.followUp(lead, at, null) }, onDismiss = { showFollowUp = false })
    lossFor?.let { stage ->
        LossReasonDialog(stage.name, onPick = { r -> vm.stage(lead, stage, r); lossFor = null }, onDismiss = { lossFor = null })
    }
}

@Composable
private fun InfoLine(label: String, value: String) {
    Row(Modifier.padding(vertical = 2.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(104.dp))
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun PendingRow(item: OutboxItem, title: String, onRetry: () -> Unit, onDiscard: () -> Unit) {
    val failed = item.state == OutboxState.FAILED
    Column(Modifier.padding(horizontal = 16.dp)) {
        AppCard {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.CloudQueue, null, tint = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(title, style = MaterialTheme.typography.titleSmall)
                        Text(if (failed) "Not saved: ${item.lastError ?: "the server refused it"}" else if (item.attempts > 0) "Will retry — ${item.lastError ?: "offline"}" else "Waiting to send", style = MaterialTheme.typography.bodySmall, color = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Chip(if (failed) "Failed" else "Pending", if (failed) Tone.Danger else Tone.Info)
                }
                if (failed) Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SecondaryButton("Retry", onRetry)
                    TextButton(onClick = onDiscard) { Text("Discard", color = MaterialTheme.colorScheme.error) }
                }
            }
        }
    }
}

/** Source labels make clear who recorded a call: the user, the app (call started only), or an importer. */
@Composable
fun SourceChip(source: String?, event: String? = null) {
    when {
        event == "call_initiated" -> Chip("Started in app · result unknown", Tone.Info)
        source == "user_entered" -> Chip("Entered by you", Tone.Brand)
        source == "app_observed" -> Chip("Observed by app", Tone.Info)
        source == "provider_imported" -> Chip("Imported from provider", Tone.Neutral)
        source == "device_imported" -> Chip("Imported from device", Tone.Neutral)
    }
}

@Composable
private fun TimelineRow(a: Activity) {
    Column(Modifier.padding(horizontal = 16.dp)) {
        AppCard {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        when (a.type) {
                            "CALL" -> if (a.event == "call_initiated") "Call started" else "Call · ${Fmt.enumLabel(a.callOutcome)}"
                            else -> Fmt.enumLabel(a.type)
                        },
                        style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f),
                    )
                    Text(Fmt.ago(a.createdAt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (a.type == "CALL") {
                    val bits = listOfNotNull(a.callDisposition?.let { Fmt.enumLabel(it) }, Fmt.duration(a.callDurationSeconds))
                    if (bits.isNotEmpty()) Text(bits.joinToString(" · "), style = MaterialTheme.typography.bodyMedium)
                }
                a.body?.takeIf { it.isNotBlank() && a.event != "call_initiated" }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 2.dp)) }
                Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (a.type == "CALL") SourceChip(a.source, a.event)
                    a.actor?.fullName?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun DispositionSheet(leadName: String, onDismiss: () -> Unit, onSave: (DispositionBody) -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var connected by remember { mutableStateOf(true) }
    var disposition by remember { mutableStateOf<String?>(null) }
    var minutes by remember { mutableStateOf("") }
    var seconds by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var callback by remember { mutableStateOf<Instant?>(null) }
    var pickCallback by remember { mutableStateOf(false) }
    val options = if (connected) Dispositions.connected else Dispositions.notConnected

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        // Scrollable body + pinned Save button, so the action is always reachable on a small phone.
        Column(Modifier.fillMaxSize()) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Call with $leadName", style = MaterialTheme.typography.titleLarge)
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    SegmentedButton(selected = connected, onClick = { connected = true; disposition = null }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text("Connected") }
                    SegmentedButton(selected = !connected, onClick = { connected = false; disposition = null }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text("Not connected") }
                }
                Text("Result", style = MaterialTheme.typography.titleSmall)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    options.forEach { o -> SelectChip(selected = disposition == o, onClick = { disposition = o; if (o == "CALLBACK" && callback == null) pickCallback = true }, label = Dispositions.label(o)) }
                }
                if (connected) {
                    Text("Call length (optional)", style = MaterialTheme.typography.titleSmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(minutes, { minutes = it.filter(Char::isDigit).take(3) }, label = { Text("Min") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                        OutlinedTextField(seconds, { seconds = it.filter(Char::isDigit).take(2) }, label = { Text("Sec") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                    }
                    Text("Leave blank if you're not sure — Zulivio never guesses a duration.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                OutlinedTextField(notes, { notes = it }, label = { Text("Notes (optional)") }, minLines = 2, maxLines = 4, modifier = Modifier.fillMaxWidth())
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Call back later", style = MaterialTheme.typography.titleSmall)
                        Text(callback?.let { Fmt.whenText(it.toString()) } ?: "No callback set", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    TextButton(onClick = { pickCallback = true }) { Text(if (callback == null) "Set time" else "Change") }
                    if (callback != null) TextButton(onClick = { callback = null }) { Text("Clear") }
                }
            }
            Surface(tonalElevation = 3.dp, modifier = Modifier.fillMaxWidth()) {
                PrimaryButton("Save result", enabled = disposition != null, modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), onClick = {
                    val dur = if (connected && (minutes.isNotEmpty() || seconds.isNotEmpty())) (minutes.toIntOrNull() ?: 0) * 60 + (seconds.toIntOrNull() ?: 0) else null
                    onSave(DispositionBody(outcome = if (connected) "CONNECTED" else "NOT_CONNECTED", disposition = disposition!!, durationSeconds = dur, notes = notes.takeIf { it.isNotBlank() }, followUpAt = callback?.toString(), followUpNote = if (callback != null) "Call back" else null))
                })
            }
        }
    }
    if (pickCallback) DateTimeDialog("Call back on", onConfirm = { callback = it; pickCallback = false }, onDismiss = { pickCallback = false })
}

@Composable
private fun LossReasonDialog(stage: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val reasons = listOf("NOT_INTERESTED", "NO_BUDGET", "WRONG_NUMBER", "DUPLICATE", "COMPETITOR", "NOT_NOW", "LOST")
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Why is this lead going to “$stage”?") },
        text = { Column { reasons.forEach { r -> Text(Fmt.enumLabel(r), Modifier.fillMaxWidth().clickable { onPick(r) }.padding(vertical = 12.dp), style = MaterialTheme.typography.bodyLarge) } } },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
