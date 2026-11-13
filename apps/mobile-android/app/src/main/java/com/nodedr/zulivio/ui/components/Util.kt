package com.nodedr.zulivio.ui.components

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

object Fmt {
    private val zone get() = ZoneId.systemDefault()
    private val time = DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault())
    private val dayMonth = DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())
    private val full = DateTimeFormatter.ofPattern("d MMM yyyy, h:mm a", Locale.getDefault())

    fun parse(s: String?): Instant? = if (s.isNullOrBlank()) null else runCatching { Instant.parse(s) }.getOrNull()

    /** "Today, 3:30 PM", "Tomorrow, 10:00 AM", "14 Nov, 3:30 PM". */
    fun whenText(s: String?): String {
        val i = parse(s) ?: return ""
        val dt = LocalDateTime.ofInstant(i, zone)
        val today = LocalDate.now(zone)
        val d = dt.toLocalDate()
        return when (d) {
            today -> "Today, ${dt.format(time)}"
            today.plusDays(1) -> "Tomorrow, ${dt.format(time)}"
            today.minusDays(1) -> "Yesterday, ${dt.format(time)}"
            else -> if (d.year == today.year) "${dt.format(dayMonth)}, ${dt.format(time)}" else dt.format(full)
        }
    }

    fun ago(s: String?): String {
        val i = parse(s) ?: return ""
        val m = Duration.between(i, Instant.now()).toMinutes()
        return when {
            m < 1 -> "just now"
            m < 60 -> "${m}m ago"
            m < 60 * 24 -> "${m / 60}h ago"
            m < 60 * 24 * 7 -> "${m / (60 * 24)}d ago"
            else -> LocalDateTime.ofInstant(i, zone).format(dayMonth)
        }
    }

    fun isPast(s: String?): Boolean = parse(s)?.isBefore(Instant.now()) == true

    fun duration(seconds: Int?): String? {
        if (seconds == null || seconds <= 0) return null
        return if (seconds < 60) "${seconds}s" else "${seconds / 60}m ${seconds % 60}s"
    }

    /** Groups a number for reading while keeping every digit selectable and never truncating it. */
    fun phone(p: String?): String {
        if (p.isNullOrBlank()) return ""
        val d = p.filter { it.isDigit() }
        return when {
            p.startsWith("+") && d.length > 10 -> "+${d.dropLast(10)} ${d.takeLast(10).take(5)} ${d.takeLast(5)}"
            d.length == 10 -> "${d.take(5)} ${d.takeLast(5)}"
            else -> p
        }
    }

    fun initials(name: String): String = name.trim().split(" ").filter { it.isNotEmpty() }.take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "?" }
    fun enumLabel(code: String?): String = code.orEmpty().lowercase().split('_').joinToString(" ") { it.replaceFirstChar(Char::uppercase) }
}

object Intents {
    private fun launch(ctx: Context, intent: Intent, failMessage: String) {
        try {
            ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(ctx, failMessage, Toast.LENGTH_SHORT).show()
        }
    }

    /** Opens the system dialer with the number filled in. The user presses call — Zulivio holds no call permission. */
    fun dial(ctx: Context, phone: String) = launch(ctx, Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", phone, null)), "No phone app found")
    fun sms(ctx: Context, phone: String) = launch(ctx, Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", phone, null)), "No messaging app found")
    fun email(ctx: Context, address: String) = launch(ctx, Intent(Intent.ACTION_SENDTO, Uri.fromParts("mailto", address, null)), "No email app found")
    fun whatsapp(ctx: Context, phone: String) {
        val digits = phone.filter { it.isDigit() }
        launch(ctx, Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits")), "WhatsApp isn't available")
    }
    fun appSettings(ctx: Context) = launch(ctx, Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null)), "Can't open settings")
}

/** Two-step date then time picker. Returns the chosen instant in the user's time zone. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateTimeDialog(title: String, initial: Instant = Instant.now().plusSeconds(3600), onConfirm: (Instant) -> Unit, onDismiss: () -> Unit) {
    val zone = ZoneId.systemDefault()
    val start = LocalDateTime.ofInstant(initial, zone)
    var step by remember { mutableStateOf(0) }
    val dateState = rememberDatePickerState(initialSelectedDateMillis = start.toLocalDate().atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli())
    val timeState = rememberTimePickerState(initialHour = start.hour, initialMinute = start.minute, is24Hour = false)
    if (step == 0) {
        DatePickerDialog(
            onDismissRequest = onDismiss,
            confirmButton = { TextButton(onClick = { step = 1 }, enabled = dateState.selectedDateMillis != null) { Text("Next") } },
            dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        ) { DatePicker(state = dateState, title = { Text(title, modifier = Modifier.padding(start = 24.dp, top = 16.dp)) }) }
    } else {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("Pick a time") },
            text = { Column { TimePicker(state = timeState) } },
            confirmButton = {
                TextButton(onClick = {
                    val date = Instant.ofEpochMilli(dateState.selectedDateMillis ?: 0).atZone(java.time.ZoneOffset.UTC).toLocalDate()
                    onConfirm(LocalDateTime.of(date, LocalTime.of(timeState.hour, timeState.minute)).atZone(zone).toInstant())
                }) { Text("Set") }
            },
            dismissButton = { TextButton(onClick = { step = 0 }) { Text("Back") } },
        )
    }
}
