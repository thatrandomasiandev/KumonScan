package com.kumonscan.gateway

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

class MainActivity : AppCompatActivity() {

    private lateinit var prefs: Prefs
    private lateinit var serverUrlInput: EditText
    private lateinit var apiKeyInput: EditText
    private lateinit var serviceStateText: TextView
    private lateinit var lastPollText: TextView
    private lateinit var lastResultText: TextView
    private lateinit var sentCountText: TextView
    private lateinit var startButton: Button
    private lateinit var stopButton: Button

    private val timeFormat = DateFormat.getTimeInstance(DateFormat.MEDIUM)
    private var statusScope: CoroutineScope? = null

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        val smsGranted = results[Manifest.permission.SEND_SMS]
            ?: hasPermission(Manifest.permission.SEND_SMS)
        if (smsGranted) {
            startGatewayService()
        } else {
            Toast.makeText(this, R.string.toast_sms_permission_required, Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = Prefs(this)
        serverUrlInput = findViewById(R.id.input_server_url)
        apiKeyInput = findViewById(R.id.input_api_key)
        serviceStateText = findViewById(R.id.text_service_state)
        lastPollText = findViewById(R.id.text_last_poll)
        lastResultText = findViewById(R.id.text_last_result)
        sentCountText = findViewById(R.id.text_sent_count)
        startButton = findViewById(R.id.button_start)
        stopButton = findViewById(R.id.button_stop)

        serverUrlInput.setText(prefs.serverUrl)
        apiKeyInput.setText(prefs.apiKey)

        findViewById<Button>(R.id.button_save).setOnClickListener { saveSettings() }
        startButton.setOnClickListener { requestPermissionsThenStart() }
        stopButton.setOnClickListener { SmsGatewayService.stop(this) }
    }

    override fun onStart() {
        super.onStart()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        statusScope = scope
        scope.launch {
            GatewayState.status.collect { status -> render(status) }
        }
    }

    override fun onStop() {
        statusScope?.cancel()
        statusScope = null
        super.onStop()
    }

    private fun saveSettings() {
        prefs.serverUrl = serverUrlInput.text.toString()
        prefs.apiKey = apiKeyInput.text.toString()
        serverUrlInput.setText(prefs.serverUrl)
        apiKeyInput.setText(prefs.apiKey)
        Toast.makeText(this, R.string.toast_settings_saved, Toast.LENGTH_SHORT).show()
    }

    private fun requestPermissionsThenStart() {
        if (!prefs.isConfigured()) {
            Toast.makeText(this, R.string.toast_configure_first, Toast.LENGTH_LONG).show()
            return
        }
        val needed = mutableListOf<String>()
        if (!hasPermission(Manifest.permission.SEND_SMS)) {
            needed += Manifest.permission.SEND_SMS
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !hasPermission(Manifest.permission.POST_NOTIFICATIONS)
        ) {
            needed += Manifest.permission.POST_NOTIFICATIONS
        }
        if (needed.isEmpty()) {
            startGatewayService()
        } else {
            permissionLauncher.launch(needed.toTypedArray())
        }
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun startGatewayService() {
        SmsGatewayService.start(this)
    }

    private fun render(status: GatewayStatus) {
        serviceStateText.setText(
            if (status.running) R.string.status_running else R.string.status_stopped
        )
        lastPollText.text = status.lastPollAtMillis
            ?.let { timeFormat.format(Date(it)) }
            ?: getString(R.string.status_never)
        lastResultText.text = status.lastResult.ifBlank { getString(R.string.status_none) }
        sentCountText.text = status.sentSinceStart.toString()
        startButton.isEnabled = !status.running
        stopButton.isEnabled = status.running
    }
}
