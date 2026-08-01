package com.kumonscan.gateway

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.telephony.SmsManager
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.IOException
import java.net.SocketTimeoutException

/**
 * Foreground service that polls the KumonScan backend every 15 seconds,
 * sends queued messages as real SMS via [SmsManager], and acknowledges each
 * result. Every cycle-level exception is caught and surfaced through
 * [GatewayState]; the loop never crashes on network or SMS errors.
 */
class SmsGatewayService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground()
        if (!pollingStarted) {
            pollingStarted = true
            GatewayState.serviceStarted()
            scope.launch { pollLoop() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        pollingStarted = false
        scope.cancel()
        GatewayState.serviceStopped()
        super.onDestroy()
    }

    private fun startInForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            )
        )

        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.notification_title))
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private suspend fun pollLoop() {
        val prefs = Prefs(this)
        while (scope.isActive) {
            runCycle(prefs)
            delay(POLL_INTERVAL_MS)
        }
    }

    private fun runCycle(prefs: Prefs) {
        if (!prefs.isConfigured()) {
            GatewayState.pollCompleted("Not configured: set server URL and API key", 0)
            return
        }
        val client = GatewayClient(prefs.serverUrl, prefs.apiKey)
        try {
            client.heartbeat()
            val pending = client.fetchPending()
            if (pending.isEmpty()) {
                GatewayState.pollCompleted("No pending messages", 0)
                return
            }

            var sent = 0
            var failed = 0
            for (message in pending) {
                val error = sendSms(message.phone, message.body)
                if (error == null) sent++ else failed++
                try {
                    client.ack(message.id, success = error == null, error = error)
                } catch (e: IOException) {
                    // Ack failure leaves the row in `sending` server-side; the
                    // backend reconciles stale rows, so continue with the batch.
                    Log.w(TAG, "Ack failed: ${e.javaClass.simpleName}")
                }
            }
            GatewayState.pollCompleted("Sent $sent, failed $failed", sent)
            Log.i(TAG, "Cycle done: sent=$sent failed=$failed")
        } catch (e: Exception) {
            val category = when (e) {
                is SocketTimeoutException -> "timeout"
                is IOException -> e.message ?: "network error"
                else -> e.javaClass.simpleName
            }
            GatewayState.pollCompleted("Poll failed: $category", 0)
            Log.w(TAG, "Poll cycle failed: ${e.javaClass.simpleName}")
        }
    }

    /**
     * Sends one SMS synchronously from the gateway's perspective: an exception
     * from SmsManager counts as failure, otherwise the message is handed to the
     * radio and treated as sent. Returns null on success or an error category
     * string (never the body or phone number).
     */
    private fun sendSms(phone: String, body: String): String? {
        return try {
            val smsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                getSystemService(SmsManager::class.java)
            } else {
                @Suppress("DEPRECATION")
                SmsManager.getDefault()
            } ?: return "sms_manager_unavailable"

            val parts = smsManager.divideMessage(body)
            if (parts.size > 1) {
                smsManager.sendMultipartTextMessage(phone, null, parts, null, null)
            } else {
                smsManager.sendTextMessage(phone, null, body, null, null)
            }
            null
        } catch (e: Exception) {
            Log.w(TAG, "SMS send failed: ${e.javaClass.simpleName}")
            "sms_send_failed: ${e.javaClass.simpleName}"
        }
    }

    companion object {
        private const val TAG = "SmsGatewayService"
        private const val CHANNEL_ID = "gateway_service"
        private const val NOTIFICATION_ID = 1
        private const val POLL_INTERVAL_MS = 15_000L

        @Volatile
        private var pollingStarted = false

        fun start(context: Context) {
            context.startForegroundService(Intent(context, SmsGatewayService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, SmsGatewayService::class.java))
        }
    }
}
