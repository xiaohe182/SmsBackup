package uts.sdk.modules.smsBackupNative

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.Telephony
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID

class SmsRepository(private val context: Context) {
    private val database = SmsQueueDatabase.getInstance(context)
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun hasReadPermission(): Boolean = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.READ_SMS
    ) == PackageManager.PERMISSION_GRANTED

    fun hasReceivePermission(): Boolean = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.RECEIVE_SMS
    ) == PackageManager.PERMISSION_GRANTED

    fun saveSettings(json: String) {
        preferences.edit().putString(KEY_SETTINGS, json).apply()
    }

    fun saveRules(json: String) {
        preferences.edit().putString(KEY_RULES, json).apply()
    }

    fun getSettingsJson(): String = preferences.getString(KEY_SETTINGS, "{}") ?: "{}"

    fun scanExistingMessages(): Int {
        if (!hasReadPermission()) return 0
        var inserted = 0
        context.contentResolver.query(
            Telephony.Sms.CONTENT_URI,
            null,
            null,
            null,
            "${Telephony.Sms.DATE} ASC"
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndex(Telephony.Sms._ID)
            val addressIndex = cursor.getColumnIndex(Telephony.Sms.ADDRESS)
            val bodyIndex = cursor.getColumnIndex(Telephony.Sms.BODY)
            val dateIndex = cursor.getColumnIndex(Telephony.Sms.DATE)
            val dateSentIndex = cursor.getColumnIndex(Telephony.Sms.DATE_SENT)
            val typeIndex = cursor.getColumnIndex(Telephony.Sms.TYPE)
            val subscriptionIndex = cursor.getColumnIndex("sub_id")
            if (idIndex < 0 || bodyIndex < 0 || dateIndex < 0 || typeIndex < 0) return 0

            while (cursor.moveToNext()) {
                val type = cursor.getInt(typeIndex)
                val direction = when (type) {
                    Telephony.Sms.MESSAGE_TYPE_INBOX -> "inbox"
                    Telephony.Sms.MESSAGE_TYPE_SENT -> "sent"
                    else -> continue
                }
                val sourceId = cursor.getString(idIndex) ?: continue
                val sender = if (addressIndex >= 0) cursor.getString(addressIndex).orEmpty() else ""
                val body = cursor.getString(bodyIndex).orEmpty()
                val receivedAt = cursor.getLong(dateIndex)
                val fingerprintTime = if (
                    dateSentIndex >= 0 && !cursor.isNull(dateSentIndex) && cursor.getLong(dateSentIndex) > 0
                ) cursor.getLong(dateSentIndex) else receivedAt
                val record = SmsRecord(
                    recordId = createRecordId(sourceId, direction),
                    contentKey = createContentKey(sender, body, fingerprintTime, direction),
                    sourceId = sourceId,
                    sender = sender,
                    body = body,
                    receivedAt = receivedAt,
                    direction = direction,
                    simSubscriptionId = if (
                        subscriptionIndex >= 0 && !cursor.isNull(subscriptionIndex)
                    ) cursor.getInt(subscriptionIndex) else null
                )
                if (queueRecord(record)) inserted += 1
            }
        }
        database.putMetadata(KEY_LAST_SYNC_AT, System.currentTimeMillis().toString())
        return inserted
    }

    fun getAllMessages(): JSONArray {
        val messages = JSONArray()
        if (!hasReadPermission()) return messages

        context.contentResolver.query(
            Telephony.Sms.CONTENT_URI,
            null,
            null,
            null,
            "${Telephony.Sms.DATE} DESC"
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndex(Telephony.Sms._ID)
            val threadIdIndex = cursor.getColumnIndex(Telephony.Sms.THREAD_ID)
            val addressIndex = cursor.getColumnIndex(Telephony.Sms.ADDRESS)
            val bodyIndex = cursor.getColumnIndex(Telephony.Sms.BODY)
            val dateIndex = cursor.getColumnIndex(Telephony.Sms.DATE)
            val dateSentIndex = cursor.getColumnIndex(Telephony.Sms.DATE_SENT)
            val typeIndex = cursor.getColumnIndex(Telephony.Sms.TYPE)
            val readIndex = cursor.getColumnIndex(Telephony.Sms.READ)
            val seenIndex = cursor.getColumnIndex(Telephony.Sms.SEEN)
            val statusIndex = cursor.getColumnIndex(Telephony.Sms.STATUS)
            val serviceCenterIndex = cursor.getColumnIndex(Telephony.Sms.SERVICE_CENTER)
            val subscriptionIndex = cursor.getColumnIndex("sub_id")
            if (idIndex < 0 || bodyIndex < 0 || dateIndex < 0 || typeIndex < 0) {
                return messages
            }

            while (cursor.moveToNext()) {
                val type = cursor.getInt(typeIndex)
                val direction = when (type) {
                    Telephony.Sms.MESSAGE_TYPE_INBOX -> "inbox"
                    Telephony.Sms.MESSAGE_TYPE_SENT -> "sent"
                    Telephony.Sms.MESSAGE_TYPE_DRAFT -> "draft"
                    Telephony.Sms.MESSAGE_TYPE_OUTBOX -> "outbox"
                    Telephony.Sms.MESSAGE_TYPE_FAILED -> "failed"
                    Telephony.Sms.MESSAGE_TYPE_QUEUED -> "queued"
                    else -> "unknown"
                }
                val sentAt = if (
                    dateSentIndex >= 0 &&
                    !cursor.isNull(dateSentIndex) &&
                    cursor.getLong(dateSentIndex) > 0
                ) cursor.getLong(dateSentIndex) else null
                val threadId = if (
                    threadIdIndex >= 0 && !cursor.isNull(threadIdIndex)
                ) cursor.getLong(threadIdIndex) else null
                val status = if (
                    statusIndex >= 0 && !cursor.isNull(statusIndex)
                ) cursor.getInt(statusIndex) else null
                val serviceCenter = if (
                    serviceCenterIndex >= 0 && !cursor.isNull(serviceCenterIndex)
                ) cursor.getString(serviceCenterIndex) else null
                val simSubscriptionId = if (
                    subscriptionIndex >= 0 && !cursor.isNull(subscriptionIndex)
                ) cursor.getInt(subscriptionIndex) else null

                messages.put(JSONObject().apply {
                    put("sourceId", cursor.getString(idIndex).orEmpty())
                    put("threadId", threadId ?: JSONObject.NULL)
                    put(
                        "address",
                        if (addressIndex >= 0) cursor.getString(addressIndex).orEmpty() else ""
                    )
                    put("body", cursor.getString(bodyIndex).orEmpty())
                    put("receivedAt", cursor.getLong(dateIndex))
                    put("sentAt", sentAt ?: JSONObject.NULL)
                    put("type", type)
                    put("direction", direction)
                    put("read", readIndex >= 0 && cursor.getInt(readIndex) == 1)
                    put("seen", seenIndex >= 0 && cursor.getInt(seenIndex) == 1)
                    put("status", status ?: JSONObject.NULL)
                    put("serviceCenter", serviceCenter ?: JSONObject.NULL)
                    put("simSubscriptionId", simSubscriptionId ?: JSONObject.NULL)
                })
            }
        }
        return messages
    }

    fun getAllMmsMessages(): JSONArray {
        val messages = JSONArray()
        if (!hasReadPermission()) return messages

        context.contentResolver.query(
            Telephony.Mms.CONTENT_URI,
            null,
            null,
            null,
            "date DESC"
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndex("_id")
            val threadIdIndex = cursor.getColumnIndex("thread_id")
            val boxIndex = cursor.getColumnIndex("msg_box")
            val dateIndex = cursor.getColumnIndex("date")
            val dateSentIndex = cursor.getColumnIndex("date_sent")
            val readIndex = cursor.getColumnIndex("read")
            val seenIndex = cursor.getColumnIndex("seen")
            if (idIndex < 0 || boxIndex < 0 || dateIndex < 0) return messages

            while (cursor.moveToNext()) {
                val sourceId = cursor.getString(idIndex).orEmpty()
                if (sourceId.isBlank()) continue
                val messageBox = cursor.getInt(boxIndex)
                val direction = mmsDirection(messageBox)
                val parts = getMmsParts(sourceId)
                val receivedAt = cursor.getLong(dateIndex) * 1_000
                val sentAt = if (
                    dateSentIndex >= 0 &&
                    !cursor.isNull(dateSentIndex) &&
                    cursor.getLong(dateSentIndex) > 0
                ) cursor.getLong(dateSentIndex) * 1_000 else null
                val threadId = if (
                    threadIdIndex >= 0 && !cursor.isNull(threadIdIndex)
                ) cursor.getLong(threadIdIndex) else null

                messages.put(JSONObject().apply {
                    put("sourceId", sourceId)
                    put("threadId", threadId ?: JSONObject.NULL)
                    put("address", getMmsAddress(sourceId, direction))
                    put("body", parts.body)
                    put("receivedAt", receivedAt)
                    put("sentAt", sentAt ?: JSONObject.NULL)
                    put("type", messageBox)
                    put("direction", direction)
                    put("read", readIndex >= 0 && cursor.getInt(readIndex) == 1)
                    put("seen", seenIndex >= 0 && cursor.getInt(seenIndex) == 1)
                    put("attachments", parts.attachments)
                })
            }
        }
        return messages
    }

    fun getGalleryPhotos(): JSONArray {
        val photos = JSONArray()
        if (!hasImagePermission()) return photos

        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.BUCKET_ID,
            MediaStore.Images.Media.BUCKET_DISPLAY_NAME,
            MediaStore.Images.Media.MIME_TYPE
        )
        context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            projection,
            null,
            null,
            "${MediaStore.Images.Media.DATE_TAKEN} DESC"
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndex(MediaStore.Images.Media._ID)
            val nameIndex = cursor.getColumnIndex(MediaStore.Images.Media.DISPLAY_NAME)
            val takenIndex = cursor.getColumnIndex(MediaStore.Images.Media.DATE_TAKEN)
            val addedIndex = cursor.getColumnIndex(MediaStore.Images.Media.DATE_ADDED)
            val albumIdIndex = cursor.getColumnIndex(MediaStore.Images.Media.BUCKET_ID)
            val albumNameIndex = cursor.getColumnIndex(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)
            val mimeTypeIndex = cursor.getColumnIndex(MediaStore.Images.Media.MIME_TYPE)
            if (idIndex < 0) return photos

            while (cursor.moveToNext()) {
                val id = cursor.getLong(idIndex)
                val takenAt = if (takenIndex >= 0 && cursor.getLong(takenIndex) > 0) {
                    cursor.getLong(takenIndex)
                } else if (addedIndex >= 0) {
                    cursor.getLong(addedIndex) * 1_000
                } else {
                    0L
                }
                photos.put(JSONObject().apply {
                    put("id", id.toString())
                    put("uri", Uri.withAppendedPath(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        id.toString()
                    ).toString())
                    put("albumId", if (albumIdIndex >= 0) {
                        cursor.getString(albumIdIndex).orEmpty()
                    } else "")
                    put("albumName", if (albumNameIndex >= 0) {
                        cursor.getString(albumNameIndex).orEmpty()
                    } else "未知相册")
                    put("displayName", if (nameIndex >= 0) {
                        cursor.getString(nameIndex).orEmpty()
                    } else "")
                    put("takenAt", takenAt)
                    put("mimeType", if (mimeTypeIndex >= 0) {
                        cursor.getString(mimeTypeIndex).orEmpty()
                    } else "")
                })
            }
        }
        return photos
    }

    fun queueRecord(record: SmsRecord): Boolean {
        if (database.containsRecord(record.recordId, record.contentKey)) return false
        val match = SmsFilter.match(
            record.sender,
            record.body,
            preferences.getString(KEY_RULES, null)
        )
        return if (match != null) {
            database.recordFiltered(record.recordId, record.contentKey, match.id)
        } else {
            database.enqueue(record)
        }
    }

    fun queueIncoming(
        sender: String,
        body: String,
        timestamp: Long,
        simSubscriptionId: Int?
    ): Boolean {
        val contentKey = createContentKey(sender, body, timestamp, "inbox")
        val sourceId = "incoming-${timestamp}-${contentKey.take(16)}"
        return queueRecord(
            SmsRecord(
                recordId = createRecordId(sourceId, "inbox"),
                contentKey = contentKey,
                sourceId = sourceId,
                sender = sender,
                body = body,
                receivedAt = timestamp,
                direction = "inbox",
                simSubscriptionId = simSubscriptionId
            )
        )
    }

    fun getStatusJson(): String {
        val stats = database.getStats()
        val lastSyncAt = database.getMetadata(KEY_LAST_SYNC_AT)?.toLongOrNull()
        return JSONObject().apply {
            put("available", true)
            put("permissionGranted", hasReadPermission() && hasReceivePermission())
            put("pendingCount", stats.pendingCount)
            put("uploadedCount", stats.uploadedCount)
            put("filteredCount", stats.filteredCount)
            put("lastSyncAt", lastSyncAt ?: JSONObject.NULL)
            put("message", if (hasReadPermission()) "短信服务已就绪" else "等待短信授权")
        }.toString()
    }

    fun clearQueue() = database.clearAll()

    fun database(): SmsQueueDatabase = database

    fun deviceId(): String {
        val existing = preferences.getString(KEY_DEVICE_ID, null)
        if (!existing.isNullOrBlank()) return existing
        val created = UUID.randomUUID().toString()
        preferences.edit().putString(KEY_DEVICE_ID, created).apply()
        return created
    }

    private fun createRecordId(sourceId: String, direction: String): String {
        val encodedDevice = URLEncoder.encode(deviceId(), StandardCharsets.UTF_8.name())
        val encodedSource = URLEncoder.encode(sourceId, StandardCharsets.UTF_8.name())
        return "$encodedDevice:$encodedSource:$direction"
    }

    private fun mmsDirection(messageBox: Int): String = when (messageBox) {
        1 -> "inbox"
        2 -> "sent"
        3 -> "draft"
        4 -> "outbox"
        else -> "unknown"
    }

    private fun getMmsAddress(messageId: String, direction: String): String {
        val expectedAddressType = if (direction == "sent") 151 else 137
        context.contentResolver.query(
            Uri.parse("content://mms/$messageId/addr"),
            arrayOf("address", "type"),
            null,
            null,
            null
        )?.use { cursor ->
            val addressIndex = cursor.getColumnIndex("address")
            val typeIndex = cursor.getColumnIndex("type")
            while (cursor.moveToNext()) {
                val address = if (addressIndex >= 0) cursor.getString(addressIndex).orEmpty() else ""
                val type = if (typeIndex >= 0) cursor.getInt(typeIndex) else 0
                if (type == expectedAddressType && address != "insert-address-token") {
                    return address
                }
            }
        }
        return ""
    }

    private fun getMmsParts(messageId: String): MmsParts {
        val attachments = JSONArray()
        val body = StringBuilder()
        context.contentResolver.query(
            Uri.parse("content://mms/part"),
            arrayOf("_id", "ct", "text"),
            "mid=?",
            arrayOf(messageId),
            null
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndex("_id")
            val contentTypeIndex = cursor.getColumnIndex("ct")
            val textIndex = cursor.getColumnIndex("text")
            while (cursor.moveToNext()) {
                val id = if (idIndex >= 0) cursor.getString(idIndex).orEmpty() else ""
                val mimeType = if (contentTypeIndex >= 0) {
                    cursor.getString(contentTypeIndex).orEmpty()
                } else ""
                if (mimeType.startsWith("image/") && id.isNotBlank()) {
                    attachments.put(JSONObject().apply {
                        put("id", id)
                        put("uri", "content://mms/part/$id")
                        put("mimeType", mimeType)
                    })
                } else if (mimeType.startsWith("text/") && textIndex >= 0) {
                    val text = cursor.getString(textIndex).orEmpty()
                    if (text.isNotBlank()) {
                        if (body.isNotEmpty()) body.append('\n')
                        body.append(text)
                    }
                }
            }
        }
        return MmsParts(body.toString(), attachments)
    }

    private fun hasImagePermission(): Boolean = ContextCompat.checkSelfPermission(
        context,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_IMAGES
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
    ) == PackageManager.PERMISSION_GRANTED

    private data class MmsParts(val body: String, val attachments: JSONArray)

    private fun createContentKey(
        sender: String,
        body: String,
        timestamp: Long,
        direction: String
    ): String {
        val normalized = listOf(
            direction,
            sender.trim().lowercase(Locale.ROOT),
            body,
            timestamp.toString()
        ).joinToString("\u001f")
        return MessageDigest.getInstance("SHA-256")
            .digest(normalized.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { byte -> "%02x".format(byte) }
    }

    companion object {
        private const val PREFERENCES_NAME = "sms_backup_native"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_SETTINGS = "settings_json"
        private const val KEY_RULES = "rules_json"
        private const val KEY_LAST_SYNC_AT = "last_sync_at"
    }
}
