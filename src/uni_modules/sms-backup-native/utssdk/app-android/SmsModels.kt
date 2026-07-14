package uts.sdk.modules.smsBackupNative

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

data class BlacklistRule(
    val id: String,
    val kind: String,
    val value: String,
    val enabled: Boolean
)

data class QueueStats(
    val pendingCount: Int,
    val uploadedCount: Int,
    val filteredCount: Int
)
