package com.nodedr.zulivio

import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.nodedr.zulivio.ui.AppRoot
import com.nodedr.zulivio.ui.theme.ZulivioTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private var callback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = (application as ZulivioApp).container
        setContent { ZulivioTheme { AppRoot(container) } }
    }

    /** The moment a connection comes back, send whatever was queued while offline. */
    override fun onStart() {
        super.onStart()
        val c = (application as ZulivioApp).container
        val cm = getSystemService(ConnectivityManager::class.java)
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                c.scope.launch { c.session.snapshot.active?.let { if (!it.needsLogin) c.outbox.drain(it.id) } }
            }
        }
        callback = cb
        runCatching { cm.registerDefaultNetworkCallback(cb) }
    }

    override fun onStop() {
        callback?.let { runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } }
        callback = null
        super.onStop()
    }
}
