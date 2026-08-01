package com.kumonscan.gateway

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** Snapshot of the gateway service status, rendered by [MainActivity]. */
data class GatewayStatus(
    val running: Boolean = false,
    val lastPollAtMillis: Long? = null,
    val lastResult: String = "",
    val sentSinceStart: Int = 0
)

/**
 * In-process status bridge between [SmsGatewayService] and [MainActivity].
 * Both run in the same process, so a singleton StateFlow is sufficient.
 */
object GatewayState {

    private val mutableStatus = MutableStateFlow(GatewayStatus())
    val status: StateFlow<GatewayStatus> = mutableStatus.asStateFlow()

    fun serviceStarted() {
        mutableStatus.value = GatewayStatus(running = true, lastResult = "Waiting for first poll")
    }

    fun serviceStopped() {
        mutableStatus.update { it.copy(running = false) }
    }

    fun pollCompleted(result: String, sentThisCycle: Int) {
        mutableStatus.update {
            it.copy(
                lastPollAtMillis = System.currentTimeMillis(),
                lastResult = result,
                sentSinceStart = it.sentSinceStart + sentThisCycle
            )
        }
    }
}
