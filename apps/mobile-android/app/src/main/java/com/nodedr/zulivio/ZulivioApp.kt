package com.nodedr.zulivio

import android.app.Application
import android.os.Build
import androidx.room.Room
import com.nodedr.zulivio.data.ApiClient
import com.nodedr.zulivio.data.AppDatabase
import com.nodedr.zulivio.data.OutboxSync
import com.nodedr.zulivio.data.Repository
import com.nodedr.zulivio.data.SecureBox
import com.nodedr.zulivio.data.SessionStore
import com.nodedr.zulivio.sync.SyncWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** Tiny hand-rolled container: one instance of each long-lived piece. */
class AppContainer(app: Application) {
    val appContext: android.content.Context = app.applicationContext
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val box = SecureBox()
    val session = SessionStore(app, box)
    val api = ApiClient(session).also {
        it.appVersion = BuildConfig.VERSION_NAME
        it.deviceNameProvider = { listOf(Build.MANUFACTURER, Build.MODEL).filter { s -> !s.isNullOrBlank() }.joinToString(" ").ifBlank { "Android phone" } }
    }
    val db: AppDatabase = Room.databaseBuilder(app, AppDatabase::class.java, "zulivio.db").build()
    val outbox = OutboxSync(db.outbox(), api, session, box)
    val repo = Repository(api, session, outbox, db.outbox())
    val contacts by lazy { com.nodedr.zulivio.contacts.ContactsFlow(appContext, repo, session, scope) }
}

class ZulivioApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        SyncWorker.schedule(this)
    }
}
