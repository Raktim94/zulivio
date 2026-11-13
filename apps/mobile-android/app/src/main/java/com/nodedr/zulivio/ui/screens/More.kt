package com.nodedr.zulivio.ui.screens

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.CloudSync
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.nodedr.zulivio.AppContainer
import com.nodedr.zulivio.BuildConfig
import com.nodedr.zulivio.data.Account
import com.nodedr.zulivio.data.ApiException
import com.nodedr.zulivio.data.LogoutRequest
import com.nodedr.zulivio.data.OutboxItem
import com.nodedr.zulivio.data.OutboxState
import com.nodedr.zulivio.sync.ReminderWorker
import com.nodedr.zulivio.sync.SyncWorker
import com.nodedr.zulivio.ui.Routes
import com.nodedr.zulivio.ui.components.AppCard
import com.nodedr.zulivio.ui.components.Chip
import com.nodedr.zulivio.ui.components.EmptyState
import com.nodedr.zulivio.ui.components.Fmt
import com.nodedr.zulivio.ui.components.Intents
import com.nodedr.zulivio.ui.components.ListRow
import com.nodedr.zulivio.ui.components.PrimaryButton
import com.nodedr.zulivio.ui.components.ScreenBar
import com.nodedr.zulivio.ui.components.SecondaryButton
import com.nodedr.zulivio.ui.components.SectionTitle
import com.nodedr.zulivio.ui.components.Tone
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import com.nodedr.zulivio.data.AppJson

@Composable
fun MoreScreen(c: AppContainer, nav: NavHostController) {
    val acc = c.session.state.collectAsState().value.active
    val items by (acc?.id?.let { c.repo.outboxItems(it) } ?: kotlinx.coroutines.flow.flowOf(emptyList<OutboxItem>())).collectAsState(initial = emptyList())
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ScreenBar("More")
        acc?.let {
            AppCard(Modifier.padding(horizontal = 16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.AccountCircle, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(it.fullName, style = MaterialTheme.typography.titleMedium)
                        Text("${Fmt.enumLabel(it.role)} · ${it.orgName.ifBlank { it.serverUrl.removePrefix("https://") }}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        SectionTitle("Work")
        ListRow("Contacts", "Choose phone contacts to share with your team", Icons.Filled.Contacts, onClick = { nav.navigate(Routes.CONTACTS) }, trailing = { Icon(Icons.Filled.ChevronRight, null) })
        ListRow("Tasks", "Work assigned to you", Icons.Filled.TaskAlt, onClick = { nav.navigate(Routes.TASKS) }, trailing = { Icon(Icons.Filled.ChevronRight, null) })
        ListRow("Attendance", "Start or end your shift, take breaks", Icons.Filled.AccessTime, onClick = { nav.navigate(Routes.ATTENDANCE) }, trailing = { Icon(Icons.Filled.ChevronRight, null) })
        SectionTitle("This phone")
        ListRow("Sync status", "${items.count { it.state == OutboxState.PENDING }} waiting · ${items.count { it.state == OutboxState.FAILED }} need attention", Icons.Filled.CloudSync, onClick = { nav.navigate(Routes.SYNC) }, trailing = { Icon(Icons.Filled.ChevronRight, null) })
        ListRow("Permission center", "What Zulivio can and can't access", Icons.Filled.Security, onClick = { nav.navigate(Routes.PERMISSIONS) }, trailing = { Icon(Icons.Filled.ChevronRight, null) })
        ListRow("Privacy", "What is collected, where it goes, how to remove it", Icons.Filled.Lock, onClick = { nav.navigate(Routes.PRIVACY) }, trailing = { Icon(Icons.Filled.ChevronRight, null) })
        ListRow("Accounts & servers", "Switch account, add a server, sign out", Icons.Filled.AccountCircle, onClick = { nav.navigate(Routes.ACCOUNTS) }, trailing = { Icon(Icons.Filled.ChevronRight, null) })
        Text("Zulivio for Android ${BuildConfig.VERSION_NAME}", Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun PermissionCenterScreen(c: AppContainer, nav: NavHostController) {
    val ctx = LocalContext.current
    var contacts by remember { mutableStateOf(c.contacts.hasPermission()) }
    var reminders by remember { mutableStateOf(c.session.getBool("reminders_on") && ReminderWorker.canNotify(ctx)) }
    var showCall by remember { mutableStateOf(false) }
    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        reminders = ok; c.session.putBool("reminders_on", ok); if (ok) ReminderWorker.enable(ctx) else ReminderWorker.disable(ctx)
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ScreenBar("Permission center", onBack = { nav.popBackStack() })
        Text("Each permission is separate and optional. Zulivio asks only when you use the feature that needs it.", Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        PermCard("Contacts", if (contacts) "Allowed" else "Not allowed", if (contacts) Tone.Ok else Tone.Neutral,
            "Lets you pick phone contacts to share with your company's CRM. Only the contacts you choose are uploaded.") {
            if (contacts) SecondaryButton("Revoke in Android settings", { Intents.appSettings(ctx) })
            else SecondaryButton("Set up contact import", { nav.navigate(Routes.CONTACTS) })
        }
        PermCard("Follow-up reminders", if (reminders) "On" else "Off", if (reminders) Tone.Ok else Tone.Neutral,
            "Shows a notification when a follow-up is due. Zulivio checks with your own server every ~15 minutes; no third-party push service is used.") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (reminders) "Reminders enabled" else "Enable reminders", Modifier.weight(1f))
                Switch(checked = reminders, onCheckedChange = { on ->
                    if (!on) { reminders = false; c.session.putBool("reminders_on", false); ReminderWorker.disable(ctx) }
                    else if (Build.VERSION.SDK_INT >= 33 && !ReminderWorker.canNotify(ctx)) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    else { reminders = true; c.session.putBool("reminders_on", true); ReminderWorker.enable(ctx) }
                })
            }
        }
        PermCard("Phone calls & call history", "Not requested", Tone.Neutral,
            "Zulivio does not ask to read your call log or your phone state. Android and Google Play restrict that access to default phone apps, so Zulivio uses safer options instead.") {
            SecondaryButton("What Zulivio does instead", { showCall = true })
        }
    }
    if (showCall) AlertDialog(
        onDismissRequest = { showCall = false }, confirmButton = { TextButton(onClick = { showCall = false }) { Text("OK") } }, title = { Text("Calls without the call log") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("• Tapping Call opens your normal dialer. Zulivio notes that you started a call — not that it connected.")
                Text("• When you come back, Zulivio asks how it went, so the result and length are what you say, never a guess.")
                Text("• You can log missed or manual calls in a couple of taps on the Calls tab.")
                Text("• For automatic capture of every call, your administrator can connect a business phone system (PBX/telephony provider) to your server.")
            }
        },
    )
}

@Composable
private fun PermCard(title: String, status: String, tone: Tone, body: String, action: @Composable () -> Unit) {
    AppCard(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f)); Chip(status, tone) }
            Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            action()
        }
    }
}

@Composable
fun PrivacyScreen(c: AppContainer, nav: NavHostController) {
    val acc = c.session.state.collectAsState().value.active
    val host = acc?.serverUrl?.removePrefix("https://")?.removePrefix("http://") ?: "your company's server"
    var confirmClear by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ScreenBar("Privacy", onBack = { nav.popBackStack() })
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            AppCard { Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Where your data goes", style = MaterialTheme.typography.titleMedium)
                Text("Only to $host — the Zulivio server your company runs. Zulivio's developers don't receive it, and the app contains no analytics, advertising or crash-reporting services.", style = MaterialTheme.typography.bodyMedium)
            } }
            AppCard { Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("What is collected", style = MaterialTheme.typography.titleMedium)
                Bullet("Your sign-in (stored encrypted on this phone, never in plain text).")
                Bullet("Leads, notes, follow-ups and call results you enter.")
                Bullet("Calls you start from Zulivio and calls you log by hand: number, time, type, and the length you enter.")
                Bullet("Phone contacts — only the ones you choose, and only the fields you switch on (name and numbers always; company and email optional).")
                Bullet("A random installation id and your phone model, so your administrator can recognise and remove this device.")
            } }
            AppCard { Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("What is not collected", style = MaterialTheme.typography.titleMedium)
                Bullet("Your call log, call recordings or call audio.")
                Bullet("Text messages, location, photos, or contacts you didn't choose.")
            } }
            AppCard { Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("On this phone", style = MaterialTheme.typography.titleMedium)
                Text("Sign-in tokens and unsent changes are encrypted with a key in the Android Keystore. They are excluded from cloud backup. Lead lists are held in memory only and aren't saved to disk.", style = MaterialTheme.typography.bodyMedium)
            } }
            AppCard { Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Retention and deletion", style = MaterialTheme.typography.titleMedium)
                Text("Uploaded contacts and call records stay on your company's server until you or an administrator delete them, or until your company's retention period removes them. You can delete your uploaded contacts under Contacts, and your administrator can remove this device at any time.", style = MaterialTheme.typography.bodyMedium)
            } }
            SecondaryButton("Delete my uploaded contacts…", { nav.navigate(Routes.CONTACTS) }, modifier = Modifier.fillMaxWidth())
            SecondaryButton("Sign out and clear data on this phone…", { confirmClear = true }, modifier = Modifier.fillMaxWidth())
        }
    }
    if (confirmClear) SignOutDialog(c, scopeAll = true, onDone = { confirmClear = false }, onDismiss = { confirmClear = false })
}

@Composable
private fun Bullet(t: String) = Row { Text("•", Modifier.width(16.dp)); Text(t, style = MaterialTheme.typography.bodyMedium) }

@Composable
fun SyncScreen(c: AppContainer, onBack: () -> Unit) {
    val acc = c.session.state.collectAsState().value.active
    val items by (acc?.id?.let { c.repo.outboxItems(it) } ?: kotlinx.coroutines.flow.flowOf(emptyList<OutboxItem>())).collectAsState(initial = emptyList())
    val running by c.outbox.running.collectAsState()
    val tick by c.outbox.tick.collectAsState()
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var last by remember(tick, acc?.id) { mutableStateOf(acc?.id?.let { c.repo.lastSync(it) } ?: 0L) }
    var message by remember { mutableStateOf<String?>(null) }
    val pending = items.filter { it.state == OutboxState.PENDING }
    val failed = items.filter { it.state == OutboxState.FAILED }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ScreenBar("Sync status", onBack = onBack)
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            AppCard { Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(if (running) "Syncing…" else if (pending.isEmpty() && failed.isEmpty()) "Everything is synced" else "Changes are waiting", style = MaterialTheme.typography.titleLarge)
                Text(if (last > 0) "Last successful sync ${Fmt.ago(java.time.Instant.ofEpochMilli(last).toString())}" else "No sync yet", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("${pending.size} waiting to upload · ${failed.size} failed", style = MaterialTheme.typography.bodyMedium)
            } }
            PrimaryButton("Sync now", onClick = {
                scope.launch {
                    val r = acc?.let { c.outbox.drain(it.id) }
                    last = acc?.id?.let { c.repo.lastSync(it) } ?: 0L
                    message = when (r?.outcome) { com.nodedr.zulivio.data.DrainOutcome.OFFLINE -> "Can't reach the server. Your changes are safe and will send when you're back online."; com.nodedr.zulivio.data.DrainOutcome.AUTH_REQUIRED -> "Please sign in again to sync."; else -> "Sync finished." }
                }
            }, loading = running, modifier = Modifier.fillMaxWidth())
            message?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            if (items.isEmpty()) EmptyState("Nothing pending", "Notes, call results and follow-ups you make offline are listed here until they reach the server.")
            if (failed.isNotEmpty()) { Text("Needs attention", style = MaterialTheme.typography.titleSmall); failed.forEach { OutboxRow(c, it, scope) } }
            if (pending.isNotEmpty()) { Text("Waiting to upload", style = MaterialTheme.typography.titleSmall); pending.forEach { OutboxRow(c, it, scope) } }
        }
    }
}

@Composable
private fun OutboxRow(c: AppContainer, item: OutboxItem, scope: kotlinx.coroutines.CoroutineScope) {
    val payload = remember(item.id, item.payloadEnc) { c.outbox.decode(item) }
    val failed = item.state == OutboxState.FAILED
    AppCard { Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(payload?.title ?: "Unreadable item", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Chip(if (failed) "Failed" else "Pending", if (failed) Tone.Danger else Tone.Info)
        }
        Text("Created ${Fmt.ago(java.time.Instant.ofEpochMilli(item.createdAt).toString())} · ${item.attempts} attempt${if (item.attempts == 1) "" else "s"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        item.lastError?.let { Text("${if (failed) "Server said" else "Last error"}: $it${item.lastCode?.let { code -> " ($code)" } ?: ""}", style = MaterialTheme.typography.bodySmall, color = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (failed) SecondaryButton("Retry", { scope.launch { c.outbox.retry(item.id); c.session.snapshot.active?.let { c.outbox.drain(it.id) } } })
            TextButton(onClick = { scope.launch { c.outbox.discard(item.id) } }) { Text("Discard", color = MaterialTheme.colorScheme.error) }
        }
    } }
}

@Composable
fun AccountsScreen(c: AppContainer, nav: NavHostController, onAdd: () -> Unit) {
    val snap by c.session.state.collectAsState()
    var signOutFor by remember { mutableStateOf<Account?>(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ScreenBar("Accounts & servers", onBack = { nav.popBackStack() })
        snap.accounts.forEach { a ->
            AppCard(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(a.fullName, style = MaterialTheme.typography.titleMedium)
                            Text(a.email, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(a.serverUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        when { a.id == snap.activeId && !a.needsLogin -> Chip("Active", Tone.Ok); a.needsLogin -> Chip("Signed out", Tone.Warn) }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (a.id != snap.activeId && !a.needsLogin) SecondaryButton("Switch", { c.session.switchTo(a.id); nav.navigate(Routes.HOME) { popUpTo(0) } })
                        TextButton(onClick = { signOutFor = a }) { Text("Sign out", color = MaterialTheme.colorScheme.error) }
                    }
                }
            }
        }
        Column(Modifier.padding(16.dp)) { PrimaryButton("Add account or server", onAdd, modifier = Modifier.fillMaxWidth()) }
    }
    signOutFor?.let { SignOutDialog(c, accountOverride = it, scopeAll = false, onDone = { signOutFor = null }, onDismiss = { signOutFor = null }) }
}

/**
 * Sign out of one account (or, from Privacy, wipe everything on this phone). Tells the server to revoke the
 * session first when it can; either way the tokens and queued data are removed from the phone.
 */
@Composable
fun SignOutDialog(c: AppContainer, accountOverride: Account? = null, scopeAll: Boolean, onDone: () -> Unit, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val targets = if (scopeAll) c.session.snapshot.accounts else listOfNotNull(accountOverride ?: c.session.snapshot.active)
    var purge by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    val ctx = LocalContext.current
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(if (scopeAll) "Sign out of everything?" else "Sign out?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("This removes your sign-in and any unsent changes from this phone. Anything you haven't synced yet will be lost.")
                Row(Modifier.toggleable(value = purge, role = Role.Checkbox, onValueChange = { purge = it }).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) { Checkbox(purge, null); Spacer(Modifier.width(8.dp)); Text("Also delete the contacts I uploaded from the server") }
                note?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                busy = true
                scope.launch {
                    var offline = false
                    targets.forEach { a ->
                        try { c.api.call("POST", "/api/v1/mobile/auth/logout", AppJson.encodeToString(LogoutRequest(purge)), account = a) } catch (e: ApiException) { offline = offline || e.isOffline }
                        c.db.outbox().deleteForAccount(a.id)
                        c.session.remove(a.id)
                    }
                    if (scopeAll) { c.session.clearPlainExceptInstall(); c.contacts.forgetDeviceData(); SyncWorker.cancelAll(ctx); ReminderWorker.disable(ctx) }
                    busy = false
                    onDone()
                }
            }) { Text("Sign out", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun PasswordGate(c: AppContainer) {
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = {}, title = { Text("Change your password first") },
        text = { Text("Your administrator requires you to choose a new password before you can use Zulivio. Open the Zulivio web app in a browser, change it, then sign in here again.") },
        confirmButton = { TextButton(onClick = { c.session.snapshot.active?.let { a -> scope.launch { runCatching { c.api.call("POST", "/api/v1/mobile/auth/logout", "{}", account = a) }; c.session.remove(a.id) } } }) { Text("Sign out") } },
    )
}
