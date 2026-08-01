package com.kumonscan.gateway

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

/**
 * Thin HTTP client for the KumonScan gateway API. All calls are blocking and
 * must run on a background dispatcher. Non-2xx responses raise [IOException];
 * the caller retries on the next poll cycle because the queue lives server-side.
 */
class GatewayClient(baseUrl: String, private val apiKey: String) {

    data class PendingMessage(val id: Long, val phone: String, val body: String)

    private val baseUrl: String = baseUrl.trim().trimEnd('/')

    /** GET /api/gateway/pending. The server marks returned rows as `sending`. */
    fun fetchPending(): List<PendingMessage> {
        val response = request("GET", "/api/gateway/pending", body = null)
        val messages: JSONArray = JSONObject(response).optJSONArray("messages") ?: JSONArray()
        return (0 until messages.length()).mapNotNull { index ->
            val item = messages.optJSONObject(index) ?: return@mapNotNull null
            val id = item.optLong("id", -1L)
            val phone = item.optString("parent_phone", "")
            val body = item.optString("message", "")
            if (id < 0 || phone.isBlank() || body.isBlank()) null
            else PendingMessage(id, phone, body)
        }
    }

    /** POST /api/gateway/{id}/ack with the send outcome. */
    fun ack(id: Long, success: Boolean, error: String? = null) {
        val payload = JSONObject().put("success", success)
        if (!success) payload.put("error", error ?: "unknown")
        request("POST", "/api/gateway/$id/ack", payload.toString())
    }

    /** POST /api/gateway/heartbeat, once per poll cycle. */
    fun heartbeat() {
        request("POST", "/api/gateway/heartbeat", "{}")
    }

    private fun request(method: String, path: String, body: String?): String {
        val connection = URL(baseUrl + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.setRequestProperty("Authorization", "Bearer $apiKey")
            connection.setRequestProperty("Accept", "application/json")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
            }
            val code = connection.responseCode
            if (code !in 200..299) throw IOException("HTTP $code from $method $path")
            return connection.inputStream.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val TIMEOUT_MS = 10_000
    }
}
