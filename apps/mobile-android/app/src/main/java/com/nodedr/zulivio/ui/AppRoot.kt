package com.nodedr.zulivio.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CloudSync
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.People
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.nodedr.zulivio.AppContainer
import com.nodedr.zulivio.data.ApiClient
import com.nodedr.zulivio.data.OutboxState
import com.nodedr.zulivio.sync.SyncWorker
import com.nodedr.zulivio.ui.screens.*
import com.nodedr.zulivio.ui.theme.LocalSemantic

object Routes {
    const val CONNECT = "connect"
    const val LOGIN = "login"
    const val HOME = "home"
    const val LEADS = "leads"
    const val FOLLOWUPS = "followups"
    const val ACTIVITY = "activity"
    const val MORE = "more"
    const val LEAD = "lead/{id}?log={log}"
    fun lead(id: String, log: Boolean = false) = "lead/$id?log=$log"
    const val CONTACTS = "contacts"
    const val CONTACTS_PICK = "contacts/pick"
    const val CONTACTS_REVIEW = "contacts/review"
    const val CONTACTS_IMPORTED = "contacts/imported"
    const val TASKS = "tasks"
    const val ATTENDANCE = "attendance"
    const val PERMISSIONS = "permissions"
    const val PRIVACY = "privacy"
    const val SYNC = "sync"
    const val ACCOUNTS = "accounts"
    const val PASSWORD_GATE = "password"
}

private data class Tab(val route: String, val label: String, val on: ImageVector, val off: ImageVector)

private val TABS = listOf(
    Tab(Routes.HOME, "My Day", Icons.Filled.Home, Icons.Outlined.Home),
    Tab(Routes.LEADS, "Leads", Icons.Filled.People, Icons.Outlined.People),
    Tab(Routes.FOLLOWUPS, "Follow-ups", Icons.Filled.CalendarMonth, Icons.Outlined.CalendarMonth),
    Tab(Routes.ACTIVITY, "Calls", Icons.Filled.History, Icons.Outlined.History),
    Tab(Routes.MORE, "More", Icons.Filled.Menu, Icons.Outlined.Menu),
)

@Composable
fun AppRoot(c: AppContainer) {
    val nav = rememberNavController()
    val snap by c.session.state.collectAsState()
    val active = snap.active
    val signedIn = active != null && !active.needsLogin
    val onboarding: OnboardingVM = containerViewModel(c) { OnboardingVM(it) }

    // Signed out (logout, revoked device, expired refresh token). An account whose session ended keeps its server + email,
    // so the user lands on a pre-filled sign-in with an explanation; with no accounts at all they start at "Connect".
    LaunchedEffect(signedIn, active?.id) {
        if (signedIn) return@LaunchedEffect
        val route = nav.currentBackStackEntry?.destination?.route
        val expired = snap.accounts.firstOrNull { it.needsLogin }
        if (expired != null) {
            if (route != Routes.LOGIN) {
                onboarding.resume(expired, onboarding.ui.value.notice ?: "Your session has ended. Please sign in again.")
                nav.navigate(Routes.LOGIN) { popUpTo(0) }
            }
        } else if (route != Routes.CONNECT && route != Routes.LOGIN) {
            nav.navigate(Routes.CONNECT) { popUpTo(0) }
        }
    }
    LaunchedEffect(Unit) {
        c.api.events.collect { ev ->
            if (ev is ApiClient.AuthEvent.DeviceDisabled) onboarding.setNotice("This phone was disabled by your administrator.")
        }
    }

    // After the user starts a call and comes back, offer to record how it went.
    var dialPrompt by remember { mutableStateOf<Pair<String, String>?>(null) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        val raw = c.session.getString("pending_dial") ?: return@LifecycleEventEffect
        val parts = raw.split("|", limit = 3)
        val ts = parts.getOrNull(2)?.toLongOrNull() ?: 0
        if (parts.size == 3 && System.currentTimeMillis() - ts < 3 * 3600_000 && signedIn) dialPrompt = parts[0] to parts[1]
        else c.session.putString("pending_dial", null)
    }
    dialPrompt?.let { (leadId, name) ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text("How did the call with $name go?") },
            text = { Text("Zulivio can't see whether the call connected or how long it lasted, so please record the result. Skip this if you didn't place the call.") },
            confirmButton = { TextButton(onClick = { c.session.putString("pending_dial", null); dialPrompt = null; nav.navigate(Routes.lead(leadId, log = true)) }) { Text("Record result") } },
            dismissButton = { TextButton(onClick = { c.session.putString("pending_dial", null); dialPrompt = null }) { Text("I didn't call") } },
        )
    }

    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val showBars = route in TABS.map { it.route }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            if (showBars) NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                TABS.forEach { t ->
                    val selected = route == t.route
                    NavigationBarItem(
                        selected = selected,
                        onClick = { if (!selected) nav.navigate(t.route) { popUpTo(Routes.HOME) { saveState = true }; launchSingleTop = true; restoreState = true } },
                        icon = { Icon(if (selected) t.on else t.off, null) },
                        label = { Text(t.label) },
                    )
                }
            }
        },
    ) { pad ->
        // On tablets and large phones in landscape, keep content at a readable width instead of stretching a phone layout edge to edge.
        Box(Modifier.padding(pad).consumeWindowInsets(pad).fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 640.dp).fillMaxSize()) {
            if (signedIn) StatusStrip(c, onOpenSync = { nav.navigate(Routes.SYNC) })
            NavHost(nav, startDestination = if (signedIn) Routes.HOME else Routes.CONNECT, modifier = Modifier.weight(1f)) {
                composable(Routes.CONNECT) {
                    ConnectScreen(onboarding, canCancel = signedIn, onCancel = { nav.popBackStack() }, onContinue = { nav.navigate(Routes.LOGIN) })
                }
                composable(Routes.LOGIN) {
                    LoginScreen(onboarding, onBack = { if (!nav.popBackStack()) nav.navigate(Routes.CONNECT) }, onDone = {
                        SyncWorker.schedule(c.appContext)
                        nav.navigate(Routes.HOME) { popUpTo(0) }
                    })
                }
                composable(Routes.HOME) { HomeScreen(c, onLead = { nav.navigate(Routes.lead(it)) }, onFollowUps = { nav.navigate(Routes.FOLLOWUPS) }, onAttendance = { nav.navigate(Routes.ATTENDANCE) }) }
                composable(Routes.LEADS) { LeadsScreen(c, onLead = { nav.navigate(Routes.lead(it)) }) }
                composable(Routes.FOLLOWUPS) { FollowUpsScreen(c, onLead = { nav.navigate(Routes.lead(it)) }) }
                composable(Routes.ACTIVITY) { ActivityScreen(c, onLead = { nav.navigate(Routes.lead(it)) }) }
                composable(Routes.MORE) { MoreScreen(c, nav) }
                composable(Routes.LEAD, arguments = listOf(navArgument("id") { type = NavType.StringType }, navArgument("log") { type = NavType.BoolType; defaultValue = false })) { e ->
                    LeadDetailScreen(c, e.arguments?.getString("id").orEmpty(), openLog = e.arguments?.getBoolean("log") == true, onBack = { nav.popBackStack() })
                }
                composable(Routes.CONTACTS) { ContactsHomeScreen(c, nav) }
                composable(Routes.CONTACTS_PICK) { ContactPickerScreen(c, nav) }
                composable(Routes.CONTACTS_REVIEW) { ContactReviewScreen(c, nav) }
                composable(Routes.CONTACTS_IMPORTED) { ImportedContactsScreen(c, onBack = { nav.popBackStack() }) }
                composable(Routes.TASKS) { TasksScreen(c, onBack = { nav.popBackStack() }) }
                composable(Routes.ATTENDANCE) { AttendanceScreen(c, onBack = { nav.popBackStack() }) }
                composable(Routes.PERMISSIONS) { PermissionCenterScreen(c, nav) }
                composable(Routes.PRIVACY) { PrivacyScreen(c, nav) }
                composable(Routes.SYNC) { SyncScreen(c, onBack = { nav.popBackStack() }) }
                composable(Routes.ACCOUNTS) { AccountsScreen(c, nav, onAdd = { onboarding.setUrl(""); nav.navigate(Routes.CONNECT) }) }
            }
        }
        }
    }

    // If the account must change its password, the web app is where that happens.
    if (signedIn && active?.mustChangePassword == true) PasswordGate(c)
}

/** Thin banner above every screen: unsent changes, failures, and plain-HTTP connections. */
@Composable
private fun StatusStrip(c: AppContainer, onOpenSync: () -> Unit) {
    val acc = c.session.state.collectAsState().value.active ?: return
    val items by c.repo.outboxItems(acc.id).collectAsState(initial = emptyList())
    val running by c.outbox.running.collectAsState()
    val pending = items.count { it.state == OutboxState.PENDING }
    val failed = items.count { it.state == OutboxState.FAILED }
    val sem = LocalSemantic.current

    LaunchedEffect(pending) { if (pending > 0) { c.outbox.drain(acc.id); SyncWorker.kick(c.appContext) } }

    Column {
        if (acc.serverUrl.startsWith("http://")) {
            Surface(color = sem.warnSoft, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Warning, null, Modifier.size(16.dp), tint = sem.warn)
                    Spacer(Modifier.width(8.dp))
                    Text("Insecure connection (HTTP) — not encrypted", style = MaterialTheme.typography.labelMedium)
                }
            }
        }
        if (pending > 0 || failed > 0) {
            Surface(color = if (failed > 0) MaterialTheme.colorScheme.errorContainer else sem.infoSoft, modifier = Modifier.fillMaxWidth().clickable(onClick = onOpenSync)) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (failed > 0) Icons.Filled.ErrorOutline else Icons.Filled.CloudSync, null, Modifier.size(18.dp), tint = if (failed > 0) MaterialTheme.colorScheme.error else sem.info)
                    Spacer(Modifier.width(8.dp))
                    Text(
                        buildString {
                            if (pending > 0) append(if (running) "Syncing $pending change${if (pending == 1) "" else "s"}…" else "$pending change${if (pending == 1) "" else "s"} waiting to sync")
                            if (pending > 0 && failed > 0) append(" · ")
                            if (failed > 0) append("$failed need attention")
                        },
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
            }
        }
    }
}
