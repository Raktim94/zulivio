package com.nodedr.zulivio.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Whatshot
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nodedr.zulivio.AppContainer
import com.nodedr.zulivio.data.FollowUp
import com.nodedr.zulivio.data.Lead
import com.nodedr.zulivio.data.MyDay
import com.nodedr.zulivio.data.WorkState
import com.nodedr.zulivio.ui.components.AppCard
import com.nodedr.zulivio.ui.components.Chip
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

class HomeVM(private val c: AppContainer) : ViewModel() {
    val day = Loader(viewModelScope) { c.repo.myDay() }
    val work = Loader(viewModelScope) { c.repo.workState() }
    fun refresh() { day.refresh(); work.refresh() }
    init { refresh() }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(c: AppContainer, onLead: (String) -> Unit, onFollowUps: () -> Unit, onAttendance: () -> Unit) {
    val vm: HomeVM = containerViewModel(c, key = "home:${c.session.active?.id}") { HomeVM(it) }
    val state by vm.day.state.collectAsState()
    val work by vm.work.state.collectAsState()
    val tick by c.outbox.tick.collectAsState()
    LaunchedEffect(tick) { if (tick > 0) vm.refresh() }
    val ctx = LocalContext.current
    val name = c.session.active?.fullName?.split(" ")?.firstOrNull().orEmpty()

    Column(Modifier.fillMaxSize()) {
        ScreenBar(if (name.isEmpty()) "My Day" else "Hi, $name")
        PullToRefreshBox(isRefreshing = (state as? LoadState.Ready)?.refreshing == true, onRefresh = vm::refresh, modifier = Modifier.weight(1f)) {
            LoadView(state, onRetry = vm::refresh) { day ->
                DayContent(c, day, (work as? LoadState.Ready<WorkState>)?.data, onLead, onFollowUps, onAttendance)
            }
        }
    }
}

@Composable
private fun DayContent(c: AppContainer, day: MyDay, work: WorkState?, onLead: (String) -> Unit, onFollowUps: () -> Unit, onAttendance: () -> Unit) {
    val ctx = LocalContext.current
    val due = (day.followUps.buckets.overdue + day.followUps.buckets.dueNow + day.followUps.buckets.dueToday).filter { it.status == "PENDING" }
    val nextFollowUp = due.firstOrNull()
    val nextLead: Lead? = nextFollowUp?.let { f -> day.toContact.firstOrNull { it.id == f.leadId } } ?: day.toContact.firstOrNull()

    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // The one thing to do next, as big as the screen allows.
        item {
            Column(Modifier.padding(horizontal = 16.dp)) {
                if (nextLead != null) {
                    AppCard(onClick = { onLead(nextLead.id) }) {
                        Column {
                            Text(if (nextFollowUp != null) (if (Fmt.isPast(nextFollowUp.dueAt)) "Follow-up overdue" else "Follow-up due") else "Next to call", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                            Spacer(Modifier.size(4.dp))
                            Text(nextLead.fullName, style = MaterialTheme.typography.titleLarge)
                            Text(listOfNotNull(nextLead.company, nextFollowUp?.let { Fmt.whenText(it.dueAt) }).joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            nextFollowUp?.note?.takeIf { it.isNotBlank() }?.let { Text("“$it”", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp)) }
                            Spacer(Modifier.size(12.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (!nextLead.phone.isNullOrBlank()) PrimaryButton("Call ${Fmt.phone(nextLead.phone)}", onClick = { LeadActions.call(c, ctx, nextLead) }, icon = Icons.Filled.Call, modifier = Modifier.weight(1f))
                                SecondaryButton("Open", onClick = { onLead(nextLead.id) })
                            }
                        }
                    }
                } else {
                    AppCard { EmptyState("You're all caught up", "No follow-ups are due and no leads are waiting to be contacted.") }
                }
            }
        }
        item {
            Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Stat("Calls today", day.stats.callsToday, Modifier.weight(1f))
                Stat("Connected", day.stats.connectedToday, Modifier.weight(1f))
                Stat("Due", day.followUps.counts.overdue + day.followUps.counts.dueNow + day.followUps.counts.dueToday, Modifier.weight(1f))
            }
        }
        item { ShiftCard(c, work, onAttendance) }
        if (due.size > 1) {
            item { SectionTitle("Follow-ups due (${due.size})") }
            items(due.drop(1).take(4), key = { it.id }) { f -> FollowUpRow(f, onClick = { onLead(f.leadId) }) }
            if (due.size > 5) item { Row(Modifier.padding(horizontal = 16.dp)) { SecondaryButton("See all follow-ups", onClick = onFollowUps) } }
        }
        if (day.hotLeads.isNotEmpty()) {
            item { SectionTitle("Hot leads") }
            items(day.hotLeads.take(5), key = { "hot-${it.id}" }) { l -> LeadCard(l, onClick = { onLead(l.id) }, onCall = { LeadActions.call(c, ctx, l) }) }
        }
        if (day.toContact.isNotEmpty()) {
            item { SectionTitle("To contact today (${day.toContact.size})") }
            items(day.toContact.take(15), key = { "c-${it.id}" }) { l -> LeadCard(l, onClick = { onLead(l.id) }, onCall = { LeadActions.call(c, ctx, l) }) }
        }
    }
}

@Composable
private fun Stat(label: String, value: Int, modifier: Modifier) {
    AppCard(modifier) {
        Column(Modifier.semantics(mergeDescendants = true) { contentDescription = "$label: $value" }) {
            Text(value.toString(), style = MaterialTheme.typography.headlineSmall)
            Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ShiftCard(c: AppContainer, work: WorkState?, onOpen: () -> Unit) {
    if (work == null) return
    Column(Modifier.padding(horizontal = 16.dp)) {
        AppCard(onClick = onOpen) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.AccessTime, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Your shift", style = MaterialTheme.typography.titleSmall)
                    Text(
                        when (work.state) { "working" -> "Working since ${Fmt.whenText(work.startedAt)}"; "on_break" -> "On a break"; else -> "Not clocked in" },
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Chip(when (work.state) { "working" -> "Working"; "on_break" -> "On break"; else -> "Off" }, if (work.state == "working") Tone.Ok else if (work.state == "on_break") Tone.Warn else Tone.Neutral)
            }
        }
    }
}

@Composable
fun FollowUpRow(f: FollowUp, onClick: () -> Unit) {
    Column(Modifier.padding(horizontal = 16.dp)) {
        AppCard(onClick = onClick) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.CalendarMonth, null, tint = if (Fmt.isPast(f.dueAt)) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(f.lead?.fullName ?: "Lead", style = MaterialTheme.typography.titleSmall)
                    Text(listOfNotNull(Fmt.whenText(f.dueAt), f.note?.takeIf { it.isNotBlank() }).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (Fmt.isPast(f.dueAt)) Chip("Overdue", Tone.Danger)
            }
        }
    }
}

object LeadActions {
    /** Records "call started" (never "call completed"), then opens the system dialer. The result is asked for when the user returns. */
    fun call(c: AppContainer, ctx: android.content.Context, lead: Lead) {
        val phone = lead.phone ?: return
        c.scope.launch { runCatching { c.repo.callInitiated(lead) } }
        c.session.putString("pending_dial", "${lead.id}|${lead.fullName}|${System.currentTimeMillis()}")
        com.nodedr.zulivio.ui.components.Intents.dial(ctx, phone)
    }
}
