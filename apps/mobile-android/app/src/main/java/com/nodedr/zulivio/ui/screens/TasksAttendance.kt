package com.nodedr.zulivio.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nodedr.zulivio.AppContainer
import com.nodedr.zulivio.data.ApiException
import com.nodedr.zulivio.data.Assignment
import com.nodedr.zulivio.data.WorkState
import com.nodedr.zulivio.ui.components.AppCard
import com.nodedr.zulivio.ui.components.Chip
import com.nodedr.zulivio.ui.components.EmptyState
import com.nodedr.zulivio.ui.components.Fmt
import com.nodedr.zulivio.ui.components.LoadView
import com.nodedr.zulivio.ui.components.Loader
import com.nodedr.zulivio.ui.components.PrimaryButton
import com.nodedr.zulivio.ui.components.ScreenBar
import com.nodedr.zulivio.ui.components.SecondaryButton
import com.nodedr.zulivio.ui.components.Tone
import com.nodedr.zulivio.ui.containerViewModel
import kotlinx.coroutines.launch

// Mirrors the server's task state machine; the server stays the authority and rejects anything else.
private val NEXT = mapOf(
    "ASSIGNED" to listOf("IN_PROGRESS" to "Start"),
    "IN_PROGRESS" to listOf("FOLLOW_UP" to "Needs follow-up", "BLOCKED" to "Blocked", "COMPLETED" to "Complete"),
    "FOLLOW_UP" to listOf("IN_PROGRESS" to "Resume", "COMPLETED" to "Complete"),
    "BLOCKED" to listOf("IN_PROGRESS" to "Unblock"),
)

class TasksVM(private val c: AppContainer) : ViewModel() {
    val tasks = Loader<List<Assignment>>(viewModelScope) { c.repo.tasks() }
    init { tasks.refresh() }
    fun move(a: Assignment, to: String) = viewModelScope.launch { c.repo.transitionTask(a, to) }
}

@Composable
fun TasksScreen(c: AppContainer, onBack: () -> Unit) {
    val vm: TasksVM = containerViewModel(c, key = "tasks:${c.session.active?.id}") { TasksVM(it) }
    val state by vm.tasks.state.collectAsState()
    val tick by c.outbox.tick.collectAsState()
    LaunchedEffect(tick) { if (tick > 0) vm.tasks.refresh() }
    Column(Modifier.fillMaxSize()) {
        ScreenBar("Tasks", onBack = onBack)
        LoadView(state, onRetry = vm.tasks::refresh) { list ->
            val open = list.filter { it.status != "COMPLETED" && it.status != "CANCELED" }
            if (open.isEmpty()) EmptyState("No open tasks", "Work assigned to you will appear here.")
            else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(open, key = { it.id }) { a ->
                    AppCard {
                        Column {
                            Row { Text("#${a.assignmentNumber} ${a.title}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f)) }
                            a.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Chip(Fmt.enumLabel(a.status), if (a.status == "BLOCKED") Tone.Danger else if (a.status == "IN_PROGRESS") Tone.Brand else Tone.Neutral)
                                a.dueAt?.let { Chip("Due ${Fmt.whenText(it)}", if (Fmt.isPast(it)) Tone.Danger else Tone.Neutral) }
                            }
                            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                NEXT[a.status].orEmpty().forEach { (to, label) -> SecondaryButton(label, onClick = { vm.move(a, to) }) }
                            }
                        }
                    }
                }
            }
        }
    }
}

class AttendanceVM(private val c: AppContainer) : ViewModel() {
    val work = Loader<WorkState>(viewModelScope) { c.repo.workState() }
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    init { work.refresh() }

    private fun act(block: suspend () -> Unit) = viewModelScope.launch {
        busy = true; error = null
        try { block() } catch (e: ApiException) { error = e.message }
        busy = false; work.refresh()
    }
    fun start() = act { c.repo.startShift() }
    fun end(w: WorkState) = act { w.sessionId?.let { c.repo.endShift(it) } }
    fun startBreak(w: WorkState) = act { w.sessionId?.let { c.repo.startBreak(it) } }
    fun endBreak(w: WorkState) = act { if (w.sessionId != null && w.currentBreakId != null) c.repo.endBreak(w.sessionId, w.currentBreakId) }
}

@Composable
fun AttendanceScreen(c: AppContainer, onBack: () -> Unit) {
    val vm: AttendanceVM = containerViewModel(c, key = "att:${c.session.active?.id}") { AttendanceVM(it) }
    val state by vm.work.state.collectAsState()
    Column(Modifier.fillMaxSize()) {
        ScreenBar("Attendance", onBack = onBack)
        LoadView(state, onRetry = vm.work::refresh) { w ->
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                AppCard {
                    Column {
                        Text(when (w.state) { "working" -> "You're clocked in"; "on_break" -> "You're on a break"; else -> "You're not clocked in" }, style = MaterialTheme.typography.titleLarge)
                        w.startedAt?.let { Text("Since ${Fmt.whenText(it)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
                vm.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                when (w.state) {
                    "working" -> { PrimaryButton("Start a break", { vm.startBreak(w) }, loading = vm.busy, modifier = Modifier.fillMaxSize().let { Modifier }); SecondaryButton("End shift", { vm.end(w) }, enabled = !vm.busy) }
                    "on_break" -> { PrimaryButton("End break", { vm.endBreak(w) }, loading = vm.busy); SecondaryButton("End shift", { vm.end(w) }, enabled = !vm.busy) }
                    else -> PrimaryButton("Start shift", { vm.start() }, loading = vm.busy)
                }
                Text("Attendance uses the server's clock, so it needs a connection and isn't queued offline.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
