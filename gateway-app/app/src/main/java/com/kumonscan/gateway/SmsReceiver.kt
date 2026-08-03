package com.kumonscan.gateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Receives every incoming SMS system-wide (the phone's default messaging
 * app also gets it independently -- this is a passive listener, not an
 * interceptor) and forwards each one to the KumonScan backend so parent
 * replies land in the staff messaging panel instead of only in the phone's
 * own SMS app.
 *
 * Manifest-registered (not dynamically registered in [MainActivity]) so it
 * fires on every boot without the activity ever being opened, matching how
 * [SmsGatewayService] is meant to run unattended. `onReceive` runs on the
 * main thread with a short execution budget, so the network forward happens
 * on a background coroutine behind `goAsync()`, mirroring the never-crash,
 * log-and-continue error posture used throughout the gateway app: an
 * unforwarded message is a lost reply, not a lost SMS -- it still sits in
 * the phone's default messaging app for manual recovery.
 */
class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isNullOrEmpty()) return

        val fromPhone = messages.first().originatingAddress
        if (fromPhone.isNullOrBlank()) return

        // Multipart messages arrive as separate parts sharing one sender;
        // concatenate bodies in delivery order into one logical message.
        val body = messages.joinToString(separator = "") { it.messageBody ?: "" }
        if (body.isBlank()) return

        val receivedAtIso = Instant.ofEpochMilli(messages.first().timestampMillis).toString()

        val pendingResult = goAsync()
        val appContext = context.applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val prefs = Prefs(appContext)
                if (!prefs.isConfigured()) {
                    Log.w(TAG, "Inbound SMS from $fromPhone dropped: gateway not configured")
                    return@launch
                }
                GatewayClient(prefs.serverUrl, prefs.apiKey).inbound(fromPhone, body, receivedAtIso)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to forward inbound SMS: ${e.javaClass.simpleName}")
            } finally {
                pendingResult.finish()
            }
        }
    }

    private companion object {
        const val TAG = "SmsReceiver"
    }
}
