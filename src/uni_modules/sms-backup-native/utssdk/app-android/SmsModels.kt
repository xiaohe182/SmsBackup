package uts.sdk.modules.smsBackupNative

import org.json.JSONArray
import org.json.JSONObject

data class SmsRecord(
    val recordId: String,
    val contentKey: String,
    val sourceId: String,
    val sender: String,
    val body: String,
    val receivedAt: Long,
    val direction: String,
    val simSubscriptionId: Int?
)

data class QueuedSms(
    val recordId: String,
    val sourceId: String,
    val sender: String,
    val body: String,
    val receivedAt: Long,
    val direction: String,
    val simSubscriptionId: Int?,
    val attempts: Int
)

data class QueueStats(
    val pendingCount: Int,
    val uploadedCount: Int
)

data class ViewerMessageRecord(
    val sourceId: String,
    val threadId: Long?,
    val address: String,
    val body: String,
    val receivedAt: Long,
    val sentAt: Long?,
    val type: Int,
    val direction: String,
    val kind: String,
    val read: Boolean,
    val seen: Boolean,
    val status: Int?,
    val serviceCenter: String?,
    val simSubscriptionId: Int?,
    val attachments: JSONArray = JSONArray()
) {
    // 游标必须与 Provider 的 date 排序列一致；sentAt 仅作为展示详情，不能参与分页定位。
    val timestamp: Long get() = receivedAt

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", "$kind:$sourceId")
        put("sourceId", sourceId)
        put("threadId", threadId ?: JSONObject.NULL)
        put("address", address)
        put("body", body)
        put("timestamp", timestamp)
        put("receivedAt", receivedAt)
        put("sentAt", sentAt ?: JSONObject.NULL)
        put("type", type)
        put("direction", direction)
        put("kind", kind)
        put("read", read)
        put("seen", seen)
        put("status", status ?: JSONObject.NULL)
        put("serviceCenter", serviceCenter ?: JSONObject.NULL)
        put("simSubscriptionId", simSubscriptionId ?: JSONObject.NULL)
        put("attachments", attachments)
    }
}

data class MessageCursorRecord(
    val timestamp: Long,
    val kind: String,
    val sourceId: String
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("timestamp", timestamp)
        put("kind", kind)
        put("sourceId", sourceId)
    }

    companion object {
        fun fromJson(raw: String?): MessageCursorRecord? {
            if (raw.isNullOrBlank()) return null
            return try {
                val value = JSONObject(raw)
                MessageCursorRecord(
                    timestamp = value.optLong("timestamp", -1L),
                    kind = value.optString("kind", "sms"),
                    sourceId = value.optString("sourceId", "")
                ).takeIf { it.timestamp >= 0 && it.sourceId.isNotBlank() }
            } catch (_: Exception) {
                null
            }
        }
    }
}

data class ConversationSummaryRecord(
    val key: String,
    val threadId: Long?,
    var address: String,
    var preview: String,
    var latestAt: Long,
    var messageCount: Int,
    var unreadCount: Int
)
