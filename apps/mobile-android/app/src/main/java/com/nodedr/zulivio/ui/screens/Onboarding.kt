package com.nodedr.zulivio.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nodedr.zulivio.AppContainer
import com.nodedr.zulivio.BuildConfig
import com.nodedr.zulivio.R
import com.nodedr.zulivio.data.Account
import com.nodedr.zulivio.data.ApiClient
import com.nodedr.zulivio.data.ApiException
import com.nodedr.zulivio.data.ServerInfo
import com.nodedr.zulivio.data.UrlRules
import com.nodedr.zulivio.ui.components.Chip
import com.nodedr.zulivio.ui.components.PrimaryButton
import com.nodedr.zulivio.ui.components.Tone
import com.nodedr.zulivio.ui.theme.LocalSemantic
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class OnboardingUi(
    val url: String = "",
    val allowInsecure: Boolean = false,
    val checking: Boolean = false,
    val info: ServerInfo? = null,
    val checkedUrl: String? = null,
    val urlError: String? = null,
    val email: String = "",
    val signingIn: Boolean = false,
    val loginError: String? = null,
    val notice: String? = null,
)

class OnboardingVM(private val c: AppContainer) : ViewModel() {
    private val _ui = MutableStateFlow(OnboardingUi())
    val ui: StateFlow<OnboardingUi> = _ui.asStateFlow()

    fun setUrl(v: String) = _ui.update { it.copy(url = v, urlError = null, info = null, checkedUrl = null) }
    fun setInsecure(v: Boolean) = _ui.update { it.copy(allowInsecure = v, urlError = null, info = null, checkedUrl = null) }
    fun setEmail(v: String) = _ui.update { it.copy(email = v, loginError = null) }
    fun setNotice(v: String?) = _ui.update { it.copy(notice = v) }

    /** Pre-fills the form for an account whose session expired. */
    fun resume(acc: Account, notice: String) = _ui.update {
        it.copy(url = acc.serverUrl, allowInsecure = acc.allowInsecure, email = acc.email, checkedUrl = acc.serverUrl, notice = notice, loginError = null)
    }

    fun check(onOk: () -> Unit) {
        val cur = _ui.value
        val normalised = UrlRules.normalise(cur.url, cur.allowInsecure && BuildConfig.DEBUG)
        if (normalised.isFailure) { _ui.update { it.copy(urlError = normalised.exceptionOrNull()?.message) }; return }
        val base = normalised.getOrThrow()
        _ui.update { it.copy(checking = true, urlError = null, info = null) }
        viewModelScope.launch {
            try {
                val info = c.api.serverInfo(base)
                if (info.product != "zulivio") {
                    _ui.update { it.copy(checking = false, urlError = "That address answered, but it isn't a Zulivio server.") }
                } else if (info.apiVersion > SUPPORTED_API) {
                    _ui.update { it.copy(checking = false, urlError = "This server is newer than this version of the app. Please update the Zulivio app.") }
                } else {
                    _ui.update { it.copy(checking = false, info = info, checkedUrl = base, url = base) }
                    onOk()
                }
            } catch (e: ApiException) {
                _ui.update { it.copy(checking = false, urlError = friendly(e)) }
            }
        }
    }

    fun login(password: String, onDone: () -> Unit) {
        val cur = _ui.value
        val base = cur.checkedUrl ?: return
        if (cur.email.isBlank() || password.isEmpty()) { _ui.update { it.copy(loginError = "Enter your email and password.") }; return }
        _ui.update { it.copy(signingIn = true, loginError = null) }
        viewModelScope.launch {
            try {
                val res = c.api.login(base, cur.email, password)
                val emp = res.employee ?: throw ApiException(0, "BAD_RESPONSE", "The server sent an unexpected reply.")
                val acc = Account(
                    id = "$base|${emp.id}", serverUrl = base, allowInsecure = base.startsWith("http://"), employeeId = emp.id,
                    fullName = emp.fullName, email = emp.email, role = emp.role, mustChangePassword = emp.mustChangePassword,
                    orgName = res.organization?.name.orEmpty(), deviceId = res.device?.id.orEmpty(),
                    accessToken = res.accessToken, accessExpiresAtMs = ApiClient.parseIso(res.accessExpiresAt) ?: (System.currentTimeMillis() + 14 * 60_000),
                    refreshToken = res.refreshToken,
                )
                c.session.upsert(acc, makeActive = true)
                _ui.value = OnboardingUi()
                onDone()
            } catch (e: ApiException) {
                _ui.update { it.copy(signingIn = false, loginError = friendly(e)) }
            }
        }
    }

    private fun friendly(e: ApiException) = when (e.code) {
        "NETWORK" -> "Can't reach that server. Check the address and your connection."
        "DEVICE_DISABLED" -> "This phone has been blocked by your administrator."
        "RATE_LIMITED" -> "Too many attempts. Wait a few minutes and try again."
        else -> e.message
    }

    companion object { const val SUPPORTED_API = 1 }
}

@Composable
fun ConnectScreen(vm: OnboardingVM, canCancel: Boolean, onCancel: () -> Unit, onContinue: () -> Unit) {
    val ui by vm.ui.collectAsState()
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Image(painterResource(R.mipmap.ic_launcher_foreground), null, Modifier.size(88.dp).align(Alignment.CenterHorizontally))
        Spacer(Modifier.size(8.dp))
        Text("Connect to your Zulivio server", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.size(8.dp))
        Text(
            "Zulivio is self-hosted: your company runs its own server, and this app talks only to that server. " +
                "Your leads, contacts and call notes are sent there — never to NodeDR or anyone else.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.size(24.dp))
        OutlinedTextField(
            value = ui.url, onValueChange = vm::setUrl, label = { Text("Server address") }, placeholder = { Text("crm.yourcompany.com") },
            singleLine = true, isError = ui.urlError != null, modifier = Modifier.fillMaxWidth(),
            supportingText = { Text(ui.urlError ?: "Ask your administrator if you're not sure. HTTPS is required.") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { vm.check(onContinue) }),
        )
        if (BuildConfig.DEBUG) {
            Row(Modifier.fillMaxWidth().toggleable(value = ui.allowInsecure, role = Role.Checkbox, onValueChange = vm::setInsecure).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(ui.allowInsecure, null)
                Column {
                    Text("Allow insecure local connection (debug build)", style = MaterialTheme.typography.bodyMedium)
                    Text("For development on a trusted local network only.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (ui.allowInsecure) InsecureWarning()
        }
        Spacer(Modifier.size(16.dp))
        PrimaryButton("Check connection", onClick = { vm.check(onContinue) }, loading = ui.checking, modifier = Modifier.fillMaxWidth())
        ui.info?.let {
            Spacer(Modifier.size(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.CheckCircle, null, tint = LocalSemantic.current.ok, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text("Zulivio server found (version ${it.serverVersion.ifBlank { "dev" }})", style = MaterialTheme.typography.bodyMedium)
            }
        }
        if (canCancel) TextButton(onClick = onCancel, modifier = Modifier.padding(top = 8.dp)) { Text("Cancel") }
    }
}

@Composable
fun InsecureWarning(modifier: Modifier = Modifier) {
    val sem = LocalSemantic.current
    Surface(color = sem.warnSoft, shape = MaterialTheme.shapes.small, modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp)) {
            Icon(Icons.Filled.Warning, null, tint = sem.warn, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text("Plain HTTP is not encrypted. Anyone on the network can read your password and your customers' details. Use this only for local testing.", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
fun LoginScreen(vm: OnboardingVM, onBack: () -> Unit, onDone: () -> Unit) {
    val ui by vm.ui.collectAsState()
    var password by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Image(painterResource(R.mipmap.ic_launcher_foreground), null, Modifier.size(72.dp).align(Alignment.CenterHorizontally))
        Text("Sign in", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.size(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Chip(ui.checkedUrl.orEmpty().removePrefix("https://"), Tone.Brand, Icons.Filled.CheckCircle)
            TextButton(onClick = onBack) { Text("Change") }
        }
        ui.notice?.let {
            Surface(color = LocalSemantic.current.infoSoft, shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(12.dp))
            }
        }
        if (ui.checkedUrl?.startsWith("http://") == true) InsecureWarning(Modifier.padding(bottom = 8.dp))
        Spacer(Modifier.size(8.dp))
        OutlinedTextField(
            value = ui.email, onValueChange = vm::setEmail, label = { Text("Work email") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
        )
        Spacer(Modifier.size(12.dp))
        OutlinedTextField(
            value = password, onValueChange = { password = it }, label = { Text("Password") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            visualTransformation = if (show) VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = { IconButton(onClick = { show = !show }) { Icon(if (show) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, if (show) "Hide password" else "Show password") } },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { vm.login(password, onDone) }),
        )
        ui.loginError?.let {
            Row(Modifier.padding(top = 8.dp).semantics { contentDescription = "Error: $it" }, verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.ErrorOutline, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
        }
        Spacer(Modifier.size(20.dp))
        PrimaryButton("Sign in", onClick = { vm.login(password, onDone) }, loading = ui.signingIn, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.size(16.dp))
        Text(
            "This phone will be registered as a device on your company's server. An administrator can see it and remove it at any time.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
