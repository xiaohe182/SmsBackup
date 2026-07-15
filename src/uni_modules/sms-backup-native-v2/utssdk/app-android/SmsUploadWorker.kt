package uts.sdk.modules.smsBackupNativeV2

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class SmsUploadWorker(
    context: Context,
    parameters: WorkerParameters
) : Worker(context, parameters) {

    override fun doWork(): Result {
        val repository = SmsRepository(applicationContext)
        val settings = UploadSettings.fromJson(repository.getSettingsJson())
        if (!settings.syncEnabled || settings.serverUrl.isBlank()) return Result.success()
        if (settings.serverUrl.startsWith("http://") && !settings.allowInsecureHttp) {
            return Result.success()
        }

        val pending = repository.database().getPending(BATCH_SIZE)
        if (pending.isEmpty()) return Result.success()
        var shouldRetry = false
        for (record in pending) {
            try {
                val responseCode = upload(repository, settings, record)
                when {
                    responseCode in 200..299 -> repository.database().markUploaded(record.recordId)
                    responseCode >= 500 -> {
                        repository.database().markFailed(record.recordId, "HTTP_$responseCode")
                        shouldRetry = true
                    }
                    else -> repository.database().markFailed(record.recordId, "HTTP_$responseCode")
                }
            } catch (_: Exception) {
                repository.database().markFailed(record.recordId, "NETWORK_ERROR")
                shouldRetry = true
            }
        }

        repository.database().putMetadata("last_sync_at", System.currentTimeMillis().toString())
        if (shouldRetry || repository.database().getStats().pendingCount > 0) {
            return Result.retry()
        }
        return Result.success()
    }

    private fun upload(
        repository: SmsRepository,
        settings: UploadSettings,
        record: QueuedSms
    ): Int {
        val endpoint = settings.serverUrl.trimEnd('/') + "/api/sms"
        val payload = JSONObject().apply {
            put("recordId", record.recordId)
            put("deviceId", repository.deviceId())
            put("deviceName", settings.deviceName)
            put("sourceId", record.sourceId)
            put("sender", record.sender)
            put("body", record.body)
            put("receivedAt", record.receivedAt)
            put("direction", record.direction)
            put("simSubscriptionId", record.simSubscriptionId ?: JSONObject.NULL)
        }.toString()

        val connection = URL(endpoint).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 20_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Idempotency-Key", record.recordId)
            connection.setRequestProperty("Authorization", "Bearer ${settings.apiToken}")
            connection.outputStream.use { output ->
                output.write(payload.toByteArray(Charsets.UTF_8))
            }
            connection.responseCode
        } finally {
            connection.disconnect()
        }
    }

    private data class UploadSettings(
        val serverUrl: String,
        val apiToken: String,
        val deviceName: String,
        val syncEnabled: Boolean,
        val allowInsecureHttp: Boolean
    ) {
        companion object {
            fun fromJson(json: String): UploadSettings = try {
                val value = JSONObject(json)
                UploadSettings(
                    serverUrl = value.optString("serverUrl").trimEnd('/'),
                    apiToken = value.optString("apiToken", "88888888")
                        .ifBlank { "88888888" },
                    deviceName = value.optString("deviceName", "家人手机"),
                    syncEnabled = value.optBoolean("syncEnabled", true),
                    allowInsecureHttp = value.optBoolean("allowInsecureHttp", false)
                )
            } catch (_: Exception) {
                UploadSettings("", "88888888", "家人手机", true, false)
            }
        }
    }

    companion object {
        private const val BATCH_SIZE = 50
    }
}
