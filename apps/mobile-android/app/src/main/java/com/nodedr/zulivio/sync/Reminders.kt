package com.nodedr.zulivio.sync

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.Constraints
import androidx.work.NetworkType
import com.nodedr.zulivio.MainActivity
import com.nodedr.zulivio.ZulivioApp
import com.nodedr.zulivio.data.ApiException
import java.util.concurrent.TimeUnit

/**
 * Follow-up reminders without any push service: every 15 minutes (when online) the phone asks YOUR
 * company's server what is due and shows a local notification. No third-party push provider is
 * involved and nothing is sent anywhere but your own server. (Delivery is therefore best-effort and
 * can lag by up to ~15 minutes; a self-hosted push channel such as UnifiedPush can be added later.)
 */
class ReminderWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val c = (applicationContext as ZulivioApp).container
        val acc = c.session.snapshot.active?.takeIf { !it.needsLogin } ?: return Result.success()
        if (!c.session.getBool("reminders_on") || !canNotify(applicationContext)) return Result.success()
        val dash = try { c.repo.followUps() } catch (e: ApiException) { return if (e.retryable) Result.retry() else Result.success() }
        val due = (dash.buckets.overdue + dash.buckets.dueNow).filter { it.status == "PENDING" }
        val seen = c.session.getString("reminded_ids")?.split(",")?.toMutableSet() ?: mutableSetOf()
        val fresh = due.filter { it.id !in seen }
        if (fresh.isEmpty()) return Result.success()
        ensureChannel(applicationContext)
        val open = PendingIntent.getActivity(applicationContext, 0, Intent(applicationContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val text = fresh.take(3).joinToString("\n") { "${it.lead?.fullName ?: "Lead"}${it.note?.takeIf { n -> n.isNotBlank() }?.let { n -> " — $n" } ?: ""}" }
        val n = NotificationCompat.Builder(applicationContext, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_my_calendar)
            .setContentTitle("${fresh.size} follow-up${if (fresh.size == 1) "" else "s"} due")
            .setContentText(text.lineSequence().first())
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(NotificationCompat.Builder(applicationContext, CHANNEL).setSmallIcon(android.R.drawable.ic_menu_my_calendar).setContentTitle("Follow-ups due").build())
            .build()
        applicationContext.getSystemService(NotificationManager::class.java).notify(1001, n)
        seen += fresh.map { it.id }
        c.session.putString("reminded_ids", seen.toList().takeLast(200).joinToString(","))
        return Result.success()
    }

    companion object {
        const val CHANNEL = "followups"
        fun canNotify(ctx: Context) = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        fun ensureChannel(ctx: Context) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL) == null) nm.createNotificationChannel(NotificationChannel(CHANNEL, "Follow-up reminders", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Tells you when a follow-up is due" })
        }
        fun enable(ctx: Context) {
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("zulivio-reminders", ExistingPeriodicWorkPolicy.UPDATE,
                PeriodicWorkRequestBuilder<ReminderWorker>(15, TimeUnit.MINUTES).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        }
        fun disable(ctx: Context) { WorkManager.getInstance(ctx).cancelUniqueWork("zulivio-reminders") }
    }
}
