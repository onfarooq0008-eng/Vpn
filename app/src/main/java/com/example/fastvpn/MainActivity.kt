package com.example.fastvpn

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.IBinder
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import de.blinkt.openvpn.api.IOpenVPNAPIService
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Connect flow: ask backend for fastest server -> hand config to the OpenVPN engine
 * ("OpenVPN for Android", package de.blinkt.openvpn) through its official remote API.
 */
class MainActivity : Activity() {
    private companion object {
        const val ENGINE = "de.blinkt.openvpn"
        const val REQ_API = 1
        const val REQ_VPN = 2
    }

    private var api: IOpenVPNAPIService? = null
    private var pendingConfig: String? = null
    private var connected = false
    private lateinit var status: TextView
    private lateinit var info: TextView
    private lateinit var btn: Button

    private val conn = object : ServiceConnection {
        override fun onServiceConnected(n: ComponentName?, b: IBinder?) { api = IOpenVPNAPIService.Stub.asInterface(b) }
        override fun onServiceDisconnected(n: ComponentName?) { api = null }
    }

    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48); setBackgroundColor(Color.parseColor("#0F172A"))
        }
        status = TextView(this).apply { text = "Disconnected"; textSize = 26f; setTextColor(Color.WHITE); gravity = Gravity.CENTER }
        info = TextView(this).apply { textSize = 14f; setTextColor(Color.LTGRAY); gravity = Gravity.CENTER; setPadding(0, 16, 0, 48) }
        btn = Button(this).apply { text = "CONNECT"; textSize = 20f; setOnClickListener { onTap() } }
        root.addView(status); root.addView(info); root.addView(btn)
        setContentView(root)
        bindEngine()
    }

    private fun bindEngine() {
        val i = Intent("de.blinkt.openvpn.api.IOpenVPNAPIService").setPackage(ENGINE)
        try { bindService(i, conn, Context.BIND_AUTO_CREATE) } catch (_: Exception) {}
    }

    override fun onDestroy() { try { unbindService(conn) } catch (_: Exception) {}; super.onDestroy() }

    private fun ui(f: () -> Unit) = runOnUiThread(f)

    private fun onTap() {
        if (connected) { try { api?.disconnect() } catch (_: Exception) {}; setState(false, "Disconnected", ""); return }
        if (api == null) {
            info.text = "Install 'OpenVPN for Android' (the engine), then tap again."
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$ENGINE"))) } catch (_: Exception) {}
            bindEngine(); return
        }
        btn.isEnabled = false; status.text = "Finding fastest server…"
        thread {
            try {
                val j = fetchBest()
                pendingConfig = j.getString("config")
                val desc = "${j.optString("country")} • ${j.optInt("speedMbps")} Mbps • ${j.optInt("ping")} ms • ${j.optString("proto").uppercase()}"
                ui { status.text = "Connecting…"; info.text = desc; askPermissions() }
            } catch (e: Exception) {
                ui { btn.isEnabled = true; status.text = "Error"; info.text = e.message ?: "failed" }
            }
        }
    }

    private fun fetchBest(): JSONObject {
        val c = URL(BuildConfig.BACKEND_URL.trimEnd('/') + "/api/best").openConnection() as HttpURLConnection
        c.connectTimeout = 15000; c.readTimeout = 30000
        if (BuildConfig.API_KEY.isNotEmpty()) c.setRequestProperty("x-api-key", BuildConfig.API_KEY)
        if (c.responseCode != 200) throw RuntimeException("Backend HTTP ${c.responseCode}")
        return JSONObject(c.inputStream.bufferedReader().readText())
    }

    private fun askPermissions() {
        try {
            val a = api!!.prepare(packageName)
            if (a != null) startActivityForResult(a, REQ_API) else vpnPermission()
        } catch (e: Exception) { fail(e) }
    }

    private fun vpnPermission() {
        try {
            val v = api!!.prepareVPNService()
            if (v != null) startActivityForResult(v, REQ_VPN) else start()
        } catch (e: Exception) { fail(e) }
    }

    private fun start() {
        try {
            api!!.startVPN(pendingConfig)
            setState(true, "Connected", info.text.toString())
        } catch (e: Exception) { fail(e) }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(req: Int, res: Int, d: Intent?) {
        if (res != RESULT_OK) { setState(false, "Permission denied", ""); return }
        if (req == REQ_API) vpnPermission() else if (req == REQ_VPN) start()
    }

    private fun fail(e: Exception) = setState(false, "Error", e.message ?: "failed")

    private fun setState(on: Boolean, s: String, i: String) {
        connected = on; status.text = s; info.text = i
        btn.isEnabled = true; btn.text = if (on) "DISCONNECT" else "CONNECT"
    }
}
