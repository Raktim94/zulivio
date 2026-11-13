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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nodedr.zulivio.AppContainer
import com.nodedr.zulivio.data.ApiException
import com.nodedr.zulivio.data.Lead
import com.nodedr.zulivio.data.Stage
import com.nodedr.zulivio.ui.components.AppCard
import com.nodedr.zulivio.ui.components.Chip
import com.nodedr.zulivio.ui.components.EmptyState
import com.nodedr.zulivio.ui.components.ErrorPanel
import com.nodedr.zulivio.ui.components.Fmt
import com.nodedr.zulivio.ui.components.NoticeBanner
import com.nodedr.zulivio.ui.components.ScreenBar
import com.nodedr.zulivio.ui.components.Tone
import com.nodedr.zulivio.ui.containerViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LeadsUi(
    val query: String = "",
    val stageId: String? = null,
    val priority: String? = null,
    val sort: String = "followUp",
    val items: List<Lead> = emptyList(),
    val page: Int = 0,
    val totalPages: Int = 1,
    val total: Int = 0,
    val loading: Boolean = true,
    val loadingMore: Boolean = false,
    val error: ApiException? = null,
    val stages: List<Stage> = emptyList(),
)

class LeadsVM(private val c: AppContainer) : ViewModel() {
    private val _ui = MutableStateFlow(LeadsUi())
    val ui: StateFlow<LeadsUi> = _ui.asStateFlow()
    private var job: Job? = null

    init {
        viewModelScope.launch { runCatching { c.repo.leadStages() }.onSuccess { s -> _ui.update { it.copy(stages = s) } } }
        reload()
    }

    fun setQuery(q: String) { _ui.update { it.copy(query = q) }; debounced() }
    fun setStage(id: String?) { _ui.update { it.copy(stageId = id) }; reload() }
    fun setPriority(p: String?) { _ui.update { it.copy(priority = p) }; reload() }
    fun setSort(s: String) { _ui.update { it.copy(sort = s) }; reload() }

    private fun debounced() { job?.cancel(); job = viewModelScope.launch { delay(350); reload() } }

    fun reload() {
        job?.cancel()
        job = viewModelScope.launch { load(1, append = false) }
    }

    fun loadMore() {
        val u = _ui.value
        if (u.loading || u.loadingMore || u.page >= u.totalPages) return
        job = viewModelScope.launch { load(u.page + 1, append = true) }
    }

    private suspend fun load(page: Int, append: Boolean) {
        val u = _ui.value
        _ui.update { it.copy(loading = !append && it.items.isEmpty(), loadingMore = append, error = null) }
        try {
            val r = c.repo.leads(u.query, u.stageId, u.priority, u.sort, page)
            _ui.update { it.copy(items = if (append) it.items + r.items else r.items, page = r.page, totalPages = r.totalPages, total = r.total, loading = false, loadingMore = false) }
        } catch (e: ApiException) {
            _ui.update { it.copy(loading = false, loadingMore = false, error = e) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LeadsScreen(c: AppContainer, onLead: (String) -> Unit) {
    val vm: LeadsVM = containerViewModel(c, key = "leads:${c.session.active?.id}") { LeadsVM(it) }
    val ui by vm.ui.collectAsState()
    val tick by c.outbox.tick.collectAsState()
    LaunchedEffect(tick) { if (tick > 0) vm.reload() }
    val ctx = LocalContext.current
    val listState = rememberLazyListState()
    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }.collect { last -> if (last >= ui.items.size - 4) vm.loadMore() }
    }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Leads")
        OutlinedTextField(
            value = ui.query, onValueChange = vm::setQuery, singleLine = true, label = { Text("Search name, phone or company") },
            leadingIcon = { Icon(Icons.Filled.Search, null) },
            trailingIcon = { if (ui.query.isNotEmpty()) IconButton(onClick = { vm.setQuery("") }) { Icon(Icons.Filled.Clear, "Clear search") } },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        FlowRow(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Dropdown("Stage: ${ui.stages.firstOrNull { it.id == ui.stageId }?.name ?: "All"}", listOf<Pair<String?, String>>(null to "All stages") + ui.stages.map { it.id to it.name }) { vm.setStage(it) }
            Dropdown("Priority: ${ui.priority?.let { Fmt.enumLabel(it) } ?: "All"}", listOf<Pair<String?, String>>(null to "All priorities") + listOf("URGENT", "HIGH", "NORMAL", "LOW").map { it to Fmt.enumLabel(it) }) { vm.setPriority(it) }
            val sorts = listOf("followUp" to "Next follow-up", "score" to "Highest score", "lastContacted" to "Recently contacted", "createdAt" to "Newest")
            Dropdown("Sort: ${sorts.first { it.first == ui.sort }.second}", sorts.map { it.first as String? to it.second }) { it?.let(vm::setSort) }
        }
        when {
            ui.loading -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) { androidx.compose.material3.CircularProgressIndicator(Modifier.semantics { contentDescription = "Loading leads" }) }
            ui.error != null && ui.items.isEmpty() -> ErrorPanel(ui.error!!, onRetry = vm::reload)
            else -> {
                ui.error?.let { NoticeBanner(it, vm::reload) }
                if (ui.items.isEmpty()) EmptyState("No leads found", if (ui.query.isNotBlank() || ui.stageId != null || ui.priority != null) "Try clearing the search or filters." else "Leads assigned to you will appear here.")
                else LazyColumn(state = listState, contentPadding = PaddingValues(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    itemsIndexed(ui.items, key = { _, l -> l.id }) { _, l -> LeadCard(l, onClick = { onLead(l.id) }, onCall = { LeadActions.call(c, ctx, l) }) }
                    if (ui.loadingMore) item { Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.Center) { androidx.compose.material3.CircularProgressIndicator(Modifier.size(24.dp)) } }
                }
            }
        }
    }
}

@Composable
private fun Dropdown(label: String, options: List<Pair<String?, String>>, onPick: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    androidx.compose.foundation.layout.Box {
        FilterChip(selected = false, onClick = { open = true }, label = { Text(label, maxLines = 1) })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (value, text) -> DropdownMenuItem(text = { Text(text) }, onClick = { open = false; onPick(value) }) }
        }
    }
}

@Composable
fun scoreTone(score: Int): Tone = when { score >= 80 -> Tone.Ok; score >= 50 -> Tone.Warn; else -> Tone.Neutral }

@Composable
fun LeadCard(lead: Lead, onClick: () -> Unit, onCall: () -> Unit) {
    Column(Modifier.padding(horizontal = 16.dp)) {
        AppCard(onClick = onClick) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(lead.fullName, style = MaterialTheme.typography.titleMedium)
                    val sub = listOfNotNull(lead.company, Fmt.phone(lead.phone).ifBlank { null }).joinToString(" · ")
                    if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.size(8.dp))
                    FlowRowChips(lead)
                    val next = lead.nextFollowUpAt
                    if (next != null) {
                        Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.CalendarMonth, null, Modifier.size(16.dp), tint = if (Fmt.isPast(next)) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.width(6.dp))
                            Text("Follow-up ${Fmt.whenText(next)}", style = MaterialTheme.typography.bodySmall, color = if (Fmt.isPast(next)) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    } else if (lead.lastContactedAt != null) {
                        Text("Last contacted ${Fmt.ago(lead.lastContactedAt)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                    } else Text("Not contacted yet", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                }
                if (!lead.phone.isNullOrBlank()) {
                    IconButton(onClick = onCall, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.Call, "Call ${lead.fullName}", tint = MaterialTheme.colorScheme.primary) }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FlowRowChips(lead: Lead) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        lead.stage?.name?.let { Chip(it, Tone.Brand) }
        if (lead.priority != "NORMAL") Chip(Fmt.enumLabel(lead.priority), if (lead.priority == "URGENT" || lead.priority == "HIGH") Tone.Danger else Tone.Neutral)
        Chip("Score ${lead.score}", scoreTone(lead.score))
        lead.owner?.fullName?.let { Chip(it, Tone.Neutral) }
    }
}
