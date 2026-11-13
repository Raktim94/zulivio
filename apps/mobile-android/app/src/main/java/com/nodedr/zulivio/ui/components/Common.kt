package com.nodedr.zulivio.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.nodedr.zulivio.data.ApiException
import com.nodedr.zulivio.ui.theme.LocalSemantic
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What a screen knows about one network read. Previously loaded data is kept when a refresh fails (shown with an offline notice). */
sealed interface LoadState<out T> {
    data object Loading : LoadState<Nothing>
    data class Ready<T>(val data: T, val error: ApiException? = null, val refreshing: Boolean = false) : LoadState<T>
    data class Failed(val error: ApiException) : LoadState<Nothing>
}

class Loader<T>(private val scope: CoroutineScope, private val fetch: suspend () -> T) {
    private val _state = MutableStateFlow<LoadState<T>>(LoadState.Loading)
    val state: StateFlow<LoadState<T>> = _state.asStateFlow()
    val value: T? get() = (_state.value as? LoadState.Ready)?.data

    fun refresh() {
        val prev = _state.value
        if (prev is LoadState.Ready) _state.value = prev.copy(refreshing = true)
        scope.launch {
            try {
                _state.value = LoadState.Ready(fetch())
            } catch (e: ApiException) {
                _state.value = if (prev is LoadState.Ready) prev.copy(error = e, refreshing = false) else LoadState.Failed(e)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                // Debug builds only: the exception type + first line, never the payload (it may contain customer data).
                if (com.nodedr.zulivio.BuildConfig.DEBUG) android.util.Log.w("ZulivioLoad", "${e::class.java.simpleName}: ${e.message?.lineSequence()?.firstOrNull()?.take(160)}")
                val err = ApiException(0, "UNEXPECTED", "Something unexpected happened.")
                _state.value = if (prev is LoadState.Ready) prev.copy(error = err, refreshing = false) else LoadState.Failed(err)
            }
        }
    }
}

@Composable
fun <T> LoadView(state: LoadState<T>, onRetry: () -> Unit, modifier: Modifier = Modifier, content: @Composable (T) -> Unit) {
    when (state) {
        is LoadState.Loading -> Box(modifier.fillMaxSize(), Alignment.Center) {
            CircularProgressIndicator(modifier = Modifier.semantics { contentDescription = "Loading" })
        }
        is LoadState.Failed -> ErrorPanel(state.error, onRetry, modifier)
        is LoadState.Ready -> Column(modifier) {
            state.error?.let { NoticeBanner(it, onRetry) }
            content(state.data)
        }
    }
}

@Composable
fun ErrorPanel(e: ApiException, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    val (icon, title) = when {
        e.isOffline -> Icons.Filled.CloudOff to "You're offline"
        e.isForbidden -> Icons.Filled.Lock to "No access"
        else -> Icons.Filled.ErrorOutline to "Couldn't load this"
    }
    Column(modifier.fillMaxSize().padding(32.dp), Arrangement.Center, Alignment.CenterHorizontally) {
        Icon(icon, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.size(12.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
        Spacer(Modifier.size(4.dp))
        Text(e.message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (!e.isForbidden) {
            Spacer(Modifier.size(16.dp))
            Button(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) { Icon(Icons.Filled.Refresh, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Try again") }
        }
    }
}

/** Shown above previously loaded data when a refresh failed. */
@Composable
fun NoticeBanner(e: ApiException, onRetry: () -> Unit) {
    val sem = LocalSemantic.current
    Surface(color = sem.warnSoft, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (e.isOffline) Icons.Filled.CloudOff else Icons.Filled.ErrorOutline, null, Modifier.size(18.dp), tint = sem.warn)
            Spacer(Modifier.width(8.dp))
            Text(if (e.isOffline) "Offline — showing what was loaded earlier." else e.message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            androidx.compose.material3.TextButton(onClick = onRetry) { Text("Retry") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScreenBar(title: String, onBack: (() -> Unit)? = null, actions: @Composable () -> Unit = {}) {
    TopAppBar(
        title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleLarge) },
        navigationIcon = { if (onBack != null) IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        actions = { actions() },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
    )
}

@Composable
fun AppCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    val colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    val border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    if (onClick != null) {
        Card(onClick = onClick, modifier = modifier.fillMaxWidth(), colors = colors, border = border, elevation = CardDefaults.cardElevation(0.dp)) { Box(Modifier.padding(16.dp)) { content() } }
    } else {
        Card(modifier = modifier.fillMaxWidth(), colors = colors, border = border, elevation = CardDefaults.cardElevation(0.dp)) { Box(Modifier.padding(16.dp)) { content() } }
    }
}

enum class Tone { Neutral, Brand, Ok, Warn, Danger, Info }

/** A pill that always carries text (and optionally an icon) — status is never conveyed by colour alone. */
@Composable
fun Chip(text: String, tone: Tone = Tone.Neutral, icon: ImageVector? = null, modifier: Modifier = Modifier) {
    val sem = LocalSemantic.current
    val cs = MaterialTheme.colorScheme
    val (bg, fg) = when (tone) {
        Tone.Neutral -> cs.surfaceVariant to cs.onSurfaceVariant
        Tone.Brand -> cs.primaryContainer to cs.onPrimaryContainer
        Tone.Ok -> sem.okSoft to sem.ok
        Tone.Warn -> sem.warnSoft to sem.warn
        Tone.Danger -> cs.errorContainer to cs.error
        Tone.Info -> sem.infoSoft to sem.info
    }
    Surface(color = bg, shape = CircleShape, modifier = modifier) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) { Icon(icon, null, Modifier.size(14.dp), tint = fg); Spacer(Modifier.width(4.dp)) }
            Text(text, style = MaterialTheme.typography.labelMedium, color = fg, maxLines = 1)
        }
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier.padding(horizontal = 16.dp, vertical = 8.dp).semantics { heading() })
}

@Composable
fun EmptyState(title: String, body: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(modifier.fillMaxWidth().padding(32.dp), Arrangement.Center, Alignment.CenterHorizontally) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.size(4.dp))
        Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (action != null) { Spacer(Modifier.size(16.dp)); action() }
    }
}

@Composable
fun ListRow(title: String, subtitle: String? = null, leading: ImageVector? = null, trailing: @Composable (() -> Unit)? = null, onClick: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).let { if (onClick != null) it.clickable(onClick = onClick) else it }.padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) { Icon(leading, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant); Spacer(Modifier.width(16.dp)) }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (trailing != null) { Spacer(Modifier.width(8.dp)); trailing() }
    }
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, loading: Boolean = false, icon: ImageVector? = null) {
    Button(onClick = onClick, enabled = enabled && !loading, modifier = modifier.heightIn(min = 48.dp), contentPadding = PaddingValues(horizontal = 20.dp, vertical = 10.dp)) {
        if (loading) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary); Spacer(Modifier.width(8.dp)) }
        else if (icon != null) { Icon(icon, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text)
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, icon: ImageVector? = null) {
    OutlinedButton(onClick = onClick, enabled = enabled, modifier = modifier.heightIn(min = 48.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.6f))) {
        if (icon != null) { Icon(icon, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text)
    }
}

/** Icon-over-label tile for secondary contact actions; stays readable at 320dp wide and keeps a 56dp touch target. */
@Composable
fun ActionTile(text: String, icon: ImageVector, onClick: () -> Unit, modifier: Modifier = Modifier) {
    OutlinedButton(
        onClick = onClick, modifier = modifier.heightIn(min = 64.dp), contentPadding = PaddingValues(horizontal = 4.dp, vertical = 8.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.6f)),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, null, Modifier.size(22.dp))
            Text(text, style = MaterialTheme.typography.labelMedium, maxLines = 1, softWrap = false)
        }
    }
}

/** A toggle chip that shows a check mark when selected, so state is never conveyed by colour alone. */
@Composable
fun SelectChip(selected: Boolean, onClick: () -> Unit, label: String, modifier: Modifier = Modifier) {
    androidx.compose.material3.FilterChip(
        selected = selected, onClick = onClick, modifier = modifier,
        label = { Text(label) },
        leadingIcon = if (selected) ({ Icon(androidx.compose.material.icons.Icons.Filled.Check, null, Modifier.size(18.dp)) }) else null,
    )
}
