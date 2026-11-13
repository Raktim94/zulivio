package com.nodedr.zulivio.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.nodedr.zulivio.ZulivioApp
import com.nodedr.zulivio.data.DrainOutcome
import java.util.concurrent.TimeUnit

/** Sends queued actions whenever a connection is available. WorkManager retries with backoff if the server was unreachable. */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val c = (applicationContext as ZulivioApp).container
        var retry = false
        for (acc in c.session.snapshot.accounts.filter { !it.needsLogin }) {
            val r = c.outbox.drain(acc.id)
            if (r.outcome == DrainOutcome.OFFLINE || r.outcome == DrainOutcome.PARTIAL && r.failed == 0) retry = true
        }
        return if (retry) Result.retry() else Result.success()
    }

    companion object {
        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(ctx: Context) {
            val wm = WorkManager.getInstance(ctx)
            wm.enqueueUniquePeriodicWork("zulivio-sync-periodic", ExistingPeriodicWorkPolicy.KEEP, PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(online).build())
        }

        /** Called right after the user queues something: runs as soon as there is a connection. */
        fun kick(ctx: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(online).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("zulivio-sync-now", ExistingWorkPolicy.REPLACE, req)
        }

        fun cancelAll(ctx: Context) {
            WorkManager.getInstance(ctx).cancelUniqueWork("zulivio-sync-periodic")
            WorkManager.getInstance(ctx).cancelUniqueWork("zulivio-sync-now")
            WorkManager.getInstance(ctx).cancelUniqueWork("zulivio-reminders")
        }
    }
}
