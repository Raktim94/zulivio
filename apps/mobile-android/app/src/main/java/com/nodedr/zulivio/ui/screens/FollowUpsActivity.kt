package com.nodedr.zulivio.ui.screens

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.nodedr.zulivio.data.ActivityFeed
import com.nodedr.zulivio.data.ActivityFeedItem
import com.nodedr.zulivio.data.FollowUp
import com.nodedr.zulivio.data.FollowUpDashboard
import com.nodedr.zulivio.ui.components.AppCard
import com.nodedr.zulivio.ui.components.Chip
import com.nodedr.zulivio.ui.components.DateTimeDialog
import com.nodedr.zulivio.ui.components.EmptyState
import com.nodedr.zulivio.ui.components.Fmt
import com.nodedr.zulivio.ui.components.LoadState
import com.nodedr.zulivio.ui.components.LoadView
import com.nodedr.zulivio.ui.components.Loader
import com.nodedr.zulivio.ui.components.PrimaryButton
import com.nodedr.zulivio.ui.components.ScreenBar
import com.nodedr.zulivio.ui.components.SecondaryButton
import com.nodedr.zulivio.ui.components.SectionTitle
import com.nodedr.zulivio.ui.components.Tone
import com.nodedr.zulivio.ui.containerViewModel
import kotlinx.coroutines.launch
import java.time.Instant

class FollowUpsVM(private val c: AppContainer) : ViewModel() {
    val data = Loader(viewModelScope) { c.repo.followUps() }
    init { data.refresh() }
    fun complete(f: FollowUp) = viewModelScope.launch { c.repo.completeFollowUp(f) }
    fun reschedule(f: FollowUp, at: Instant) = viewModelScope.launch { c.repo.rescheduleFollowUp(f, at) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FollowUpsScreen(c: AppContainer, onLead: (String) -> Unit) {
    val vm: FollowUpsVM = containerViewModel(c, key = "fu:${c.session.active?.id}") { FollowUpsVM(it) }
    val state by vm.data.state.collectAsState()
    val tick by c.outbox.tick.collectAsState()
    LaunchedEffect(tick) { if (tick > 0) vm.data.refresh() }
    Column(Modifier.fillMaxSize()) {
        ScreenBar("Follow-ups")
        PullToRefreshBox(isRefreshing = (state as? LoadState.Ready)?.refreshing == true, onRefresh = vm.data::refresh, modifier = Modifier.weight(1f)) {
            LoadView(state, onRetry = vm.data::refresh) { d -> FollowUpList(c, vm, d, onLead) }
        }
    }
}

@Composable
private fun FollowUpList(c: AppContainer, vm: FollowUpsVM, d: FollowUpDashboard, onLead: (String) -> Unit) {
    val b = d.buckets
    val sections = listOf("Overdue" to b.overdue, "Due now" to b.dueNow, "Today" to b.dueToday, "Tomorrow" to b.tomorrow, "Upcoming" to b.upcoming).filter { it.second.isNotEmpty() }
    var moving by remember { mutableStateOf<FollowUp?>(null) }
    val ctx = LocalContext.current
    if (sections.isEmpty()) { EmptyState("Nothing scheduled", "Follow-ups you schedule from a lead will show up here."); return }
    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        sections.forEach { (title, list) ->
            item(key = "h-$title") { SectionTitle("$title (${list.size})") }
            items(list, key = { it.id }) { f ->
                Column(Modifier.padding(horizontal = 16.dp)) {
                    AppCard(onClick = { onLead(f.leadId) }) {
                        Column {
                            Text(f.lead?.fullName ?: "Lead", style = MaterialTheme.typography.titleMedium)
                            Text(listOfNotNull(f.lead?.company, Fmt.whenText(f.dueAt)).joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = if (Fmt.isPast(f.dueAt)) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                            f.note?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp)) }
                            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                f.lead?.phone?.takeIf { it.isNotBlank() }?.let { _ ->
                                    SecondaryButton("Call", onClick = {
                                        val lead = com.nodedr.zulivio.data.Lead(id = f.leadId, fullName = f.lead.fullName, phone = f.lead.phone)
                                        LeadActions.call(c, ctx, lead)
                                    }, icon = Icons.Filled.Call)
                                }
                                SecondaryButton("Done", onClick = { vm.complete(f) }, icon = Icons.Filled.CheckCircle)
                                TextButton(onClick = { moving = f }) { Icon(Icons.Filled.Schedule, null, Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("Reschedule") }
                            }
                        }
                    }
                }
            }
        }
    }
    moving?.let { f -> DateTimeDialog("Reschedule follow-up", onConfirm = { vm.reschedule(f, it); moving = null }, onDismiss = { moving = null }) }
}

// ---------------- Activity / Calls ----------------

class ActivityVM(private val c: AppContainer) : ViewModel() {
    val feed = Loader<ActivityFeed>(viewModelScope) { c.repo.activity(null) }
    init { feed.refresh() }
    fun logCall(phone: String, type: String, minutes: Int, note: String?, name: String?) =
        viewModelScope.launch { c.repo.logManualCall(phone, type, minutes * 60, note, name, null, null) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActivityScreen(c: AppContainer, onLead: (String) -> Unit) {
    val vm: ActivityVM = containerViewModel(c, key = "act:${c.session.active?.id}") { ActivityVM(it) }
    val state by vm.feed.state.collectAsState()
    val tick by c.outbox.tick.collectAsState()
    LaunchedEffect(tick) { if (tick > 0) vm.feed.refresh() }
    var showLog by remember { mutableStateOf(false) }
    var showInfo by remember { mutableStateOf(false) }
    var presetMissed by remember { mutableStateOf(false) }

    androidx.compose.material3.Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = { ScreenBar("Calls", actions = { IconButton(onClick = { showInfo = true }) { Icon(Icons.Filled.Info, "How call activity is recorded") } }) },
        floatingActionButton = { ExtendedFloatingActionButton(onClick = { presetMissed = false; showLog = true }, icon = { Icon(Icons.Filled.Add, null) }, text = { Text("Log a call") }) },
    ) { pad ->
        PullToRefreshBox(isRefreshing = (state as? LoadState.Ready)?.refreshing == true, onRefresh = vm.feed::refresh, modifier = Modifier.padding(pad)) {
            LoadView(state, onRetry = vm.feed::refresh) { f ->
                LazyColumn(contentPadding = PaddingValues(bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    item {
                        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SecondaryButton("Missed call", onClick = { presetMissed = true; showLog = true }, modifier = Modifier.weight(1f))
                        }
                    }
                    if (f.items.isEmpty()) item { EmptyState("No call activity yet", "Calls you start from a lead, record a result for, or log by hand appear here.") }
                    items(f.items, key = { it.id }) { it -> ActivityRow(it, onLead) }
                }
            }
        }
    }
    if (showLog) LogCallSheet(missed = presetMissed, onDismiss = { showLog = false }, onSave = { phone, type, min, note, name -> vm.logCall(phone, type, min, note, name); showLog = false })
    if (showInfo) AlertDialog(
        onDismissRequest = { showInfo = false }, confirmButton = { TextButton(onClick = { showInfo = false }) { Text("OK") } }, title = { Text("How calls are recorded") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Entered by you — you recorded the result or logged the call yourself.")
                Text("Observed by app — you tapped Call in Zulivio. The app only knows a call was started, not whether it connected or how long it lasted.")
                Text("Imported — came from a phone's call log or a business phone system connected by your administrator.")
                Text("Android doesn't let ordinary apps read every call, so Zulivio doesn't claim to catch all calls. Missed calls can be logged here in two taps.")
            }
        },
    )
}

@Composable
private fun ActivityRow(i: ActivityFeedItem, onLead: (String) -> Unit) {
    Column(Modifier.padding(horizontal = 16.dp)) {
        AppCard(onClick = i.lead?.id?.takeIf { it.isNotEmpty() }?.let { id -> { onLead(id) } }) {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(i.lead?.fullName ?: Fmt.phone(i.phone).ifBlank { "Unknown number" }, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    Text(Fmt.ago(i.at), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                val line = when (i.kind) {
                    "CALL_INITIATED" -> "Call started (result not recorded)"
                    "CALL_LOGGED" -> listOfNotNull(Fmt.enumLabel(i.outcome), i.disposition?.let { Fmt.enumLabel(it) }, Fmt.duration(i.durationSeconds)).joinToString(" · ")
                    else -> listOfNotNull(Fmt.enumLabel(i.kind.removePrefix("CALL_")), Fmt.duration(i.durationSeconds)).joinToString(" · ")
                }
                Text(line, style = MaterialTheme.typography.bodyMedium)
                i.note?.takeIf { it.isNotBlank() && it != "manual" && it != "missed_quick" }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Row(Modifier.padding(top = 6.dp)) { SourceChip(i.sourceLabel, if (i.kind == "CALL_INITIATED") "call_initiated" else null) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun LogCallSheet(missed: Boolean, onDismiss: () -> Unit, onSave: (String, String, Int, String?, String?) -> Unit) {
    var phone by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var type by remember { mutableStateOf(if (missed) "missed" else "outgoing") }
    var minutes by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(if (missed) "Log a missed call" else "Log a call", style = MaterialTheme.typography.titleLarge)
            Text("This is recorded as entered by you. If the number matches a lead, it's linked to it automatically.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(phone, { phone = it.filter { ch -> ch.isDigit() || ch in "+ -()" }.take(32) }, label = { Text("Phone number") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(name, { name = it.take(120) }, label = { Text("Name (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("missed" to "Missed", "incoming" to "Incoming", "outgoing" to "Outgoing").forEach { (v, l) -> FilterChip(selected = type == v, onClick = { type = v }, label = { Text(l) }) }
            }
            if (type != "missed") OutlinedTextField(minutes, { minutes = it.filter(Char::isDigit).take(3) }, label = { Text("Length in minutes (optional)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(note, { note = it.take(180) }, label = { Text("Note (optional)") }, minLines = 2, modifier = Modifier.fillMaxWidth())
            PrimaryButton("Save", enabled = phone.count { it.isDigit() } >= 6, modifier = Modifier.fillMaxWidth(), onClick = { onSave(phone.trim(), type, minutes.toIntOrNull() ?: 0, note.takeIf { it.isNotBlank() }, name.takeIf { it.isNotBlank() }) })
        }
    }
}
