package uts.sdk.modules.smsBackupNative

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class SmsQueueDatabase private constructor(context: Context) :
    SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    override fun onCreate(database: SQLiteDatabase) {
        database.execSQL(
            """
            CREATE TABLE sms_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                record_id TEXT NOT NULL UNIQUE,
                content_key TEXT NOT NULL UNIQUE,
                source_id TEXT NOT NULL,
                sender TEXT NOT NULL,
                body TEXT NOT NULL,
                received_at INTEGER NOT NULL,
                direction TEXT NOT NULL,
                sim_subscription_id INTEGER,
                state TEXT NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at INTEGER NOT NULL,
                uploaded_at INTEGER
            )
            """.trimIndent()
        )
        database.execSQL(
            "CREATE TABLE metadata (meta_key TEXT PRIMARY KEY, meta_value TEXT NOT NULL)"
        )
        database.execSQL("CREATE INDEX idx_sms_queue_state ON sms_queue(state, id)")
    }

    override fun onUpgrade(database: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            database.execSQL("CREATE INDEX IF NOT EXISTS idx_sms_queue_state ON sms_queue(state, id)")
        }
        if (oldVersion < 3) {
            database.execSQL("ALTER TABLE sms_queue ADD COLUMN content_key TEXT")
            database.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_queue_content_key ON sms_queue(content_key)")
        }
        if (oldVersion < 4) {
            // 旧版过滤记录必须删除，否则曾被过滤的短信重新扫描时仍可能被历史状态误判。
            database.execSQL("DROP TABLE IF EXISTS filtered_records")
        }
    }

    @Synchronized
    fun enqueue(record: SmsRecord): Boolean {
        val values = ContentValues().apply {
            put("record_id", record.recordId)
            put("content_key", record.contentKey)
            put("source_id", record.sourceId)
            put("sender", record.sender)
            put("body", record.body)
            put("received_at", record.receivedAt)
            put("direction", record.direction)
            record.simSubscriptionId?.let { put("sim_subscription_id", it) }
            put("state", "pending")
            put("created_at", System.currentTimeMillis())
        }
        return writableDatabase.insertWithOnConflict(
            "sms_queue",
            null,
            values,
            SQLiteDatabase.CONFLICT_IGNORE
        ) != -1L
    }

    fun containsRecord(recordId: String, contentKey: String): Boolean {
        readableDatabase.rawQuery(
            "SELECT 1 FROM sms_queue WHERE record_id = ? OR content_key = ? LIMIT 1",
            arrayOf(recordId, contentKey)
        ).use { cursor -> return cursor.moveToFirst() }
    }

    fun getStats(): QueueStats = QueueStats(
        pendingCount = count("sms_queue", "state = 'pending'"),
        uploadedCount = count("sms_queue", "state = 'uploaded'")
    )

    fun getPending(limit: Int = 50): List<QueuedSms> {
        val result = mutableListOf<QueuedSms>()
        readableDatabase.query(
            "sms_queue",
            arrayOf(
                "record_id", "source_id", "sender", "body", "received_at",
                "direction", "sim_subscription_id", "attempts"
            ),
            "state = ?",
            arrayOf("pending"),
            null,
            null,
            "id ASC",
            limit.coerceIn(1, 200).toString()
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val simIndex = cursor.getColumnIndex("sim_subscription_id")
                result += QueuedSms(
                    recordId = cursor.getString(cursor.getColumnIndexOrThrow("record_id")),
                    sourceId = cursor.getString(cursor.getColumnIndexOrThrow("source_id")),
                    sender = cursor.getString(cursor.getColumnIndexOrThrow("sender")),
                    body = cursor.getString(cursor.getColumnIndexOrThrow("body")),
                    receivedAt = cursor.getLong(cursor.getColumnIndexOrThrow("received_at")),
                    direction = cursor.getString(cursor.getColumnIndexOrThrow("direction")),
                    simSubscriptionId = if (simIndex >= 0 && !cursor.isNull(simIndex)) cursor.getInt(simIndex) else null,
                    attempts = cursor.getInt(cursor.getColumnIndexOrThrow("attempts"))
                )
            }
        }
        return result
    }

    @Synchronized
    fun markUploaded(recordId: String) {
        val values = ContentValues().apply {
            put("state", "uploaded")
            put("uploaded_at", System.currentTimeMillis())
            putNull("last_error")
        }
        writableDatabase.update("sms_queue", values, "record_id = ?", arrayOf(recordId))
    }

    @Synchronized
    fun markFailed(recordId: String, errorCode: String) {
        writableDatabase.execSQL(
            "UPDATE sms_queue SET attempts = attempts + 1, last_error = ? WHERE record_id = ?",
            arrayOf(errorCode.take(120), recordId)
        )
    }

    @Synchronized
    fun putMetadata(key: String, value: String) {
        val values = ContentValues().apply {
            put("meta_key", key)
            put("meta_value", value)
        }
        writableDatabase.insertWithOnConflict(
            "metadata",
            null,
            values,
            SQLiteDatabase.CONFLICT_REPLACE
        )
    }

    fun getMetadata(key: String): String? {
        readableDatabase.query(
            "metadata",
            arrayOf("meta_value"),
            "meta_key = ?",
            arrayOf(key),
            null,
            null,
            null
        ).use { cursor -> return if (cursor.moveToFirst()) cursor.getString(0) else null }
    }

    @Synchronized
    fun clearAll() {
        writableDatabase.beginTransaction()
        try {
            writableDatabase.delete("sms_queue", null, null)
            writableDatabase.delete("metadata", null, null)
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    private fun count(table: String, selection: String?): Int {
        val where = if (selection.isNullOrBlank()) "" else " WHERE $selection"
        readableDatabase.rawQuery("SELECT COUNT(*) FROM $table$where", null).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
    }

    companion object {
        private const val DATABASE_NAME = "sms_backup.db"
        private const val DATABASE_VERSION = 4

        @Volatile
        private var instance: SmsQueueDatabase? = null

        fun getInstance(context: Context): SmsQueueDatabase =
            instance ?: synchronized(this) {
                instance ?: SmsQueueDatabase(context.applicationContext).also { instance = it }
            }
    }
}
