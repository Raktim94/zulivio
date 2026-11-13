package com.nodedr.zulivio.ui.screens

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import com.nodedr.zulivio.AppContainer
import com.nodedr.zulivio.contacts.Decision
import com.nodedr.zulivio.contacts.FlowMode
import com.nodedr.zulivio.contacts.ReviewItem
import com.nodedr.zulivio.data.ApiException
import com.nodedr.zulivio.data.ContactSummary
import com.nodedr.zulivio.data.RemoteContact
import com.nodedr.zulivio.ui.Routes
import com.nodedr.zulivio.ui.components.AppCard
import com.nodedr.zulivio.ui.components.Chip
import com.nodedr.zulivio.ui.components.EmptyState
import com.nodedr.zulivio.ui.components.ErrorPanel
import com.nodedr.zulivio.ui.components.Fmt
import com.nodedr.zulivio.ui.components.Intents
import com.nodedr.zulivio.ui.components.LoadView
import com.nodedr.zulivio.ui.components.Loader
import com.nodedr.zulivio.ui.components.PrimaryButton
import com.nodedr.zulivio.ui.components.ScreenBar
import com.nodedr.zulivio.ui.components.SecondaryButton
import com.nodedr.zulivio.ui.components.SectionTitle
import com.nodedr.zulivio.ui.components.Tone
import com.nodedr.zulivio.ui.containerViewModel
import kotlinx.coroutines.launch

class ContactsHomeVM(private val c: AppContainer) : ViewModel() {
    val summary = Loader<ContactSummary>(viewModelScope) { c.repo.contactSummary() }
    var message by mutableStateOf<String?>(null)
    init { summary.refresh() }

    fun deleteUploaded() = viewModelScope.launch {
        try {
            val r = c.repo.deleteContacts()
            message = "Removed ${r.deleted} uploaded contact${if (r.deleted == 1) "" else "s"} from your company's server."
            summary.refresh()
        } catch (e: ApiException) { message = e.message }
    }
}

private const val EXPLAIN = "Zulivio needs access to your phone's contacts so you can choose which ones to add to your company's CRM.\n\n" +
    "• Only the contacts you choose are uploaded.\n• They go to your company's Zulivio server and nowhere else.\n" +
    "• Names and phone numbers are always included; company and email only if you switch them on.\n• You can stop, and delete everything you uploaded, at any time."

@Composable
fun ContactsHomeScreen(c: AppContainer, nav: NavHostController) {
    val vm: ContactsHomeVM = containerViewModel(c, key = "ch:${c.session.active?.id}") { ContactsHomeVM(it) }
    val flow = c.contacts
    val state by vm.summary.state.collectAsState()
    val fields by flow.fields.collectAsState()
    val ctx = LocalContext.current
    var granted by remember { mutableStateOf(flow.hasPermission()) }
    var explain by remember { mutableStateOf<FlowMode?>(null) }   // which action asked for the permission
    var confirmAll by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var denied by remember { mutableStateOf(false) }
    var pendingMode by remember { mutableStateOf<FlowMode?>(null) }

    fun proceed(mode: FlowMode) {
        flow.loadDevice()
        when (mode) {
            FlowMode.PICK -> nav.navigate(Routes.CONTACTS_PICK)
            else -> { flow.startReview(mode); nav.navigate(Routes.CONTACTS_REVIEW) }
        }
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        granted = ok; denied = !ok
        if (ok) pendingMode?.let { m -> if (m == FlowMode.ALL) confirmAll = true else proceed(m) }
    }
    fun begin(mode: FlowMode) {
        pendingMode = mode
        if (granted) { if (mode == FlowMode.ALL) confirmAll = true else proceed(mode) } else explain = mode
    }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Contacts", onBack = { nav.popBackStack() })
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                AppCard {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Contacts access", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                            Chip(if (granted) "Allowed" else "Not allowed", if (granted) Tone.Ok else Tone.Neutral)
                        }
                        Text(if (granted) "Zulivio can read your contacts only while you're choosing what to import." else "Zulivio hasn't asked for your contacts yet. It only asks when you start an import.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                        if (denied) Text("Permission was denied. You can allow it in Android settings if you change your mind.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp))
                        if (granted || denied) TextButton(onClick = { Intents.appSettings(ctx) }) { Text(if (granted) "Revoke in Android settings" else "Open Android settings") }
                    }
                }
            }
            item {
                AppCard {
                    LoadView(state, onRetry = vm.summary::refresh, modifier = Modifier) { s ->
                        Column {
                            Text("Uploaded to your company server", style = MaterialTheme.typography.titleMedium)
                            val imported = s.counts["IMPORTED"] ?: 0; val linked = s.counts["LINKED"] ?: 0
                            Text("$imported added as leads · $linked linked to existing leads", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
                            Text(s.lastSyncedAt?.let { "Last sync ${Fmt.ago(it)}" } ?: "Nothing uploaded yet", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryButton("Choose contacts to import", { begin(FlowMode.PICK) }, modifier = Modifier.fillMaxWidth())
                    SecondaryButton("Re-sync changes to uploaded contacts", { begin(FlowMode.RESYNC) }, modifier = Modifier.fillMaxWidth())
                    SecondaryButton("View uploaded contacts", { nav.navigate(Routes.CONTACTS_IMPORTED) }, modifier = Modifier.fillMaxWidth())
                }
            }
            item {
                AppCard {
                    Column {
                        Text("What gets uploaded", style = MaterialTheme.typography.titleMedium)
                        Text("Name and phone numbers are always included — they're how duplicates are found. Choose the rest:", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        ToggleRow("Company name", "company" in fields) { flow.setField("company", it) }
                        ToggleRow("Email addresses", "emails" in fields) { flow.setField("emails", it) }
                    }
                }
            }
            item {
                AppCard {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Sync everything", style = MaterialTheme.typography.titleMedium)
                        Text("Uploads every contact on this phone that has a number, after you review and confirm. Most people should choose contacts individually instead.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        SecondaryButton("Review all contacts…", { begin(FlowMode.ALL) })
                    }
                }
            }
            item {
                AppCard {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Delete my uploaded contacts", style = MaterialTheme.typography.titleMedium)
                        Text("Removes the contact records you uploaded from the server. Leads that were created from them stay in the CRM like any other lead.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        SecondaryButton("Delete uploaded contacts", { confirmDelete = true }, icon = Icons.Filled.Delete)
                        vm.message?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary) }
                    }
                }
            }
        }
    }

    explain?.let { mode ->
        AlertDialog(
            onDismissRequest = { explain = null }, title = { Text("Allow access to contacts?") }, text = { Text(EXPLAIN) },
            confirmButton = { TextButton(onClick = { explain = null; launcher.launch(Manifest.permission.READ_CONTACTS) }) { Text("Continue") } },
            dismissButton = { TextButton(onClick = { explain = null; pendingMode = null }) { Text("Not now") } },
        )
    }
    if (confirmAll) AlertDialog(
        onDismissRequest = { confirmAll = false }, title = { Text("Review every contact?") },
        text = { Text("You'll see every contact with a phone number and can untick any before anything is uploaded. Nothing is sent until you confirm on the next screen.") },
        confirmButton = { TextButton(onClick = { confirmAll = false; proceed(FlowMode.ALL) }) { Text("Review all") } },
        dismissButton = { TextButton(onClick = { confirmAll = false }) { Text("Cancel") } },
    )
    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false }, title = { Text("Delete uploaded contacts?") },
        text = { Text("This removes your uploaded contact records from the server. It can't be undone, but you can import again later.") },
        confirmButton = { TextButton(onClick = { confirmDelete = false; vm.deleteUploaded() }) { Text("Delete", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
    )
}

@Composable
private fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 4.dp).semantics(mergeDescendants = true) { contentDescription = "$label, ${if (checked) "on" else "off"}" }, verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
fun ContactPickerScreen(c: AppContainer, nav: NavHostController) {
    val flow = c.contacts
    val all by flow.device.collectAsState()
    val loading by flow.loadingDevice.collectAsState()
    val selected by flow.selected.collectAsState()
    var q by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { if (all.isEmpty()) flow.loadDevice() }
    val shown = remember(all, q) { if (q.isBlank()) all else all.filter { it.name.contains(q, true) || it.phones.any { p -> p.contains(q) } } }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Choose contacts", onBack = { flow.clearSelection(); nav.popBackStack() })
        OutlinedTextField(q, { q = it }, singleLine = true, label = { Text("Search contacts") }, leadingIcon = { Icon(Icons.Filled.Search, null) },
            trailingIcon = { if (q.isNotEmpty()) IconButton(onClick = { q = "" }) { Icon(Icons.Filled.Clear, "Clear search") } }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp))
        Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${selected.size} selected", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            TextButton(onClick = { flow.selectAll(shown.map { it.id }) }, enabled = shown.isNotEmpty()) { Text("Select shown") }
            TextButton(onClick = { flow.clearSelection() }, enabled = selected.isNotEmpty()) { Text("Clear") }
        }
        Column(Modifier.weight(1f)) {
            when {
                loading -> Column(Modifier.fillMaxSize(), Arrangement.Center, Alignment.CenterHorizontally) { androidx.compose.material3.CircularProgressIndicator() }
                shown.isEmpty() -> EmptyState("No contacts found", if (q.isBlank()) "Contacts with a phone number will appear here." else "Nothing matches “$q”.")
                else -> LazyColumn {
                    items(shown, key = { it.id }) { ct ->
                        val on = ct.id in selected
                        Row(Modifier.fillMaxWidth().clickable(role = Role.Checkbox) { flow.toggle(ct.id) }.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = on, onCheckedChange = null)
                            Spacer(Modifier.width(12.dp))
                            Column { Text(ct.name, style = MaterialTheme.typography.bodyLarge); Text(ct.phones.joinToString(", ") { Fmt.phone(it) }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryButton("Cancel", { flow.clearSelection(); nav.popBackStack() })
            PrimaryButton("Review ${selected.size}", { flow.startReview(FlowMode.PICK); nav.navigate(Routes.CONTACTS_REVIEW) }, enabled = selected.isNotEmpty(), modifier = Modifier.weight(1f))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ContactReviewScreen(c: AppContainer, nav: NavHostController) {
    val flow = c.contacts
    val r by flow.review.collectAsState()
    var confirm by remember { mutableStateOf(false) }
    val toSend = r.items.count { it.decision != Decision.SKIP }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Review before importing", onBack = { flow.reset(); nav.popBackStack() })
        when {
            r.result != null -> ResultPanel(r.result!!, onDone = { flow.reset(); nav.popBackStack(Routes.CONTACTS, false) })
            r.loading -> Column(Modifier.fillMaxSize(), Arrangement.Center, Alignment.CenterHorizontally) { androidx.compose.material3.CircularProgressIndicator(); Text("Checking for duplicates…", Modifier.padding(top = 12.dp)) }
            r.error != null && r.items.isEmpty() -> ErrorPanel(r.error!!, onRetry = { flow.startReview(r.mode) })
            r.importing -> Column(Modifier.fillMaxSize().padding(32.dp), Arrangement.Center) {
                Text("Importing ${r.progress} of ${r.total}…", style = MaterialTheme.typography.titleMedium)
                LinearProgressIndicator(progress = { if (r.total == 0) 0f else r.progress.toFloat() / r.total }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            }
            r.items.isEmpty() -> EmptyState("Nothing to import", if (r.mode == FlowMode.RESYNC) "Everything you uploaded is already up to date." else "These contacts are already uploaded, have no usable number, or were left out.")
            else -> {
                Text("Nothing has been uploaded yet. Choose what happens to each contact.", Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                r.error?.let { Text("Upload interrupted: ${it.message} Tap Import to continue — contacts already sent won't be duplicated.", Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                FlowRow(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { flow.setAll(Decision.IMPORT) }) { Text("Import all new") }
                    TextButton(onClick = { flow.setAll(Decision.SKIP) }) { Text("Skip all") }
                }
                LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(r.items, key = { it.upload.sourceId }) { ri -> ReviewCard(ri) { flow.decide(ri.upload.sourceId, it) } }
                    if (r.hidden > 0) item { Text("${r.hidden} more left out (already uploaded, no usable number, or not part of a re-sync).", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SecondaryButton("Cancel", { flow.reset(); nav.popBackStack() })
                    PrimaryButton("Import $toSend", { confirm = true }, enabled = toSend > 0, modifier = Modifier.weight(1f))
                }
            }
        }
    }
    if (confirm) AlertDialog(
        onDismissRequest = { confirm = false }, title = { Text("Upload $toSend contacts?") },
        text = { Text("Their names and numbers${if ("company" in flow.fields.value) ", company" else ""}${if ("emails" in flow.fields.value) ", email" else ""} will be sent to your company's Zulivio server.") },
        confirmButton = { TextButton(onClick = { confirm = false; flow.confirmImport() }) { Text("Upload") } },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ReviewCard(ri: ReviewItem, onDecide: (Decision) -> Unit) {
    val (label, tone) = when (ri.preview.state) {
        "NEW" -> "New" to Tone.Ok
        "CHANGED" -> "Changed since last upload" to Tone.Info
        "DUPLICATE_LEAD" -> "Already a lead: ${ri.preview.matchLeadName ?: ""}" to Tone.Warn
        "DUPLICATE_HIDDEN" -> "Already in the CRM (another team's lead)" to Tone.Warn
        "DUPLICATE_IN_BATCH" -> "Same number as another selected contact" to Tone.Warn
        "DUPLICATE_CONTACT" -> "Same number as an uploaded contact" to Tone.Warn
        else -> ri.preview.state to Tone.Neutral
    }
    AppCard {
        Column {
            Text(ri.upload.displayName, style = MaterialTheme.typography.titleMedium)
            Text(ri.upload.phones.joinToString(", ") { Fmt.phone(it) }, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Chip(label, tone, modifier = Modifier.padding(top = 6.dp))
            if (ri.preview.normalizationUnreliable) Text("This number's format is unusual, so duplicate checks may miss it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ri.options.forEach { d ->
                    FilterChip(selected = ri.decision == d, onClick = { onDecide(d) }, label = {
                        Text(when (d) { Decision.IMPORT -> "Add as lead"; Decision.LINK -> "Link to existing lead"; Decision.UPDATE -> "Update"; Decision.SKIP -> "Skip" })
                    })
                }
            }
        }
    }
}

@Composable
private fun ResultPanel(res: com.nodedr.zulivio.contacts.ReviewUi.Result, onDone: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Import finished", style = MaterialTheme.typography.headlineSmall)
        Text("${res.created} added as leads · ${res.linked} linked · ${res.updated} updated · ${res.skipped} skipped" + if (res.rejected > 0) " · ${res.rejected} couldn't be imported" else "", style = MaterialTheme.typography.bodyLarge)
        res.messages.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.size(8.dp))
        PrimaryButton("Done", onDone)
    }
}

class ImportedVM(private val c: AppContainer) : ViewModel() {
    var q by mutableStateOf("")
    val items = Loader(viewModelScope) { c.repo.importedContacts(null, q).items }
    init { items.refresh() }
    fun remove(rc: RemoteContact) = viewModelScope.launch { runCatching { c.repo.deleteContact(rc.id) }; items.refresh() }
}

@Composable
fun ImportedContactsScreen(c: AppContainer, onBack: () -> Unit) {
    val vm: ImportedVM = containerViewModel(c, key = "imp:${c.session.active?.id}") { ImportedVM(it) }
    val state by vm.items.state.collectAsState()
    Column(Modifier.fillMaxSize()) {
        ScreenBar("Uploaded contacts", onBack = onBack)
        OutlinedTextField(vm.q, { vm.q = it; vm.items.refresh() }, singleLine = true, label = { Text("Search") }, leadingIcon = { Icon(Icons.Filled.Search, null) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp))
        LoadView(state, onRetry = vm.items::refresh) { list ->
            if (list.isEmpty()) EmptyState("No uploaded contacts", "Contacts you import will be listed here, and you can remove any of them.")
            else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(list, key = { it.id }) { rc ->
                    AppCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(rc.displayName, style = MaterialTheme.typography.titleMedium)
                                rc.company?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                Chip(if (rc.status == "LINKED") "Linked to a lead" else "Added as lead", Tone.Neutral, modifier = Modifier.padding(top = 4.dp))
                            }
                            IconButton(onClick = { vm.remove(rc) }, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.Delete, "Delete ${rc.displayName} from the server") }
                        }
                    }
                }
            }
        }
    }
}
