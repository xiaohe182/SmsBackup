package uts.sdk.modules.smsBackupNative

import android.Manifest
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Bundle
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

    fun getConversationSummaries(): JSONArray {
        val summaries = linkedMapOf<String, ConversationSummaryRecord>()
        if (!hasReadPermission()) return JSONArray()

        context.contentResolver.query(
            Telephony.Sms.CONTENT_URI,
            arrayOf(
                Telephony.Sms.THREAD_ID,
                Telephony.Sms.ADDRESS,
                Telephony.Sms.BODY,
                Telephony.Sms.DATE,
                Telephony.Sms.TYPE,
                Telephony.Sms.READ
            ),
            null,
            null,
            "${Telephony.Sms.DATE} DESC"
        )?.use { cursor ->
            val threadIndex = cursor.getColumnIndex(Telephony.Sms.THREAD_ID)
            val addressIndex = cursor.getColumnIndex(Telephony.Sms.ADDRESS)
            val bodyIndex = cursor.getColumnIndex(Telephony.Sms.BODY)
            val dateIndex = cursor.getColumnIndex(Telephony.Sms.DATE)
            val typeIndex = cursor.getColumnIndex(Telephony.Sms.TYPE)
            val readIndex = cursor.getColumnIndex(Telephony.Sms.READ)
            while (cursor.moveToNext()) {
                val threadId = nullableLong(cursor, threadIndex)
                val address = nullableString(cursor, addressIndex).orEmpty()
                val timestamp = if (dateIndex >= 0) cursor.getLong(dateIndex) else 0L
                val type = if (typeIndex >= 0) cursor.getInt(typeIndex) else 0
                accumulateConversation(
                    summaries,
                    threadId,
                    address,
                    nullableString(cursor, bodyIndex).orEmpty(),
                    timestamp,
                    type == Telephony.Sms.MESSAGE_TYPE_INBOX &&
                        (readIndex < 0 || cursor.getInt(readIndex) != 1)
                )
            }
        }

        context.contentResolver.query(
            Telephony.Mms.CONTENT_URI,
            arrayOf("_id", "thread_id", "date", "msg_box", "read"),
            null,
            null,
            "date DESC"
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndex("_id")
            val threadIndex = cursor.getColumnIndex("thread_id")
            val dateIndex = cursor.getColumnIndex("date")
            val boxIndex = cursor.getColumnIndex("msg_box")
            val readIndex = cursor.getColumnIndex("read")
            while (cursor.moveToNext()) {
                val sourceId = nullableString(cursor, idIndex).orEmpty()
                val threadId = nullableLong(cursor, threadIndex)
                val direction = mmsDirection(if (boxIndex >= 0) cursor.getInt(boxIndex) else 0)
                val key = conversationKey(threadId, "")
                val knownAddress = summaries[key]?.address.orEmpty()
                val address = knownAddress.ifBlank { getMmsAddress(sourceId, direction) }
                accumulateConversation(
                    summaries,
                    threadId,
                    address,
                    "[彩信]",
                    (if (dateIndex >= 0) cursor.getLong(dateIndex) else 0L) * 1_000,
                    direction == "inbox" && (readIndex < 0 || cursor.getInt(readIndex) != 1)
                )
            }
        }

        val contactResolver = SmsContactResolver(context)
        val contacts = contactResolver.loadContacts()
        val result = JSONArray()
        summaries.values.sortedByDescending { it.latestAt }.forEach { summary ->
            result.put(JSONObject().apply {
                put("key", summary.key)
                put("threadId", summary.threadId ?: JSONObject.NULL)
                put("address", summary.address)
                put("contact", contactResolver.resolve(summary.address, contacts).toJson())
                put("preview", summary.preview)
                put("latestAt", summary.latestAt)
                put("messageCount", summary.messageCount)
                put("unreadCount", summary.unreadCount)
            })
        }
        return result
    }

    fun getMessagePage(
        filter: String,
        threadId: Long?,
        address: String?,
        cursorJson: String?,
        limit: Int
    ): JSONObject {
        val safeLimit = limit.coerceIn(1, 100)
        val cursor = MessageCursorRecord.fromJson(cursorJson)
        val queryLimit = safeLimit + 1
        val candidates = mutableListOf<ViewerMessageRecord>()
        candidates += querySmsPage(filter, threadId, address, cursor, queryLimit)
        candidates += queryMmsPage(filter, threadId, address, cursor, queryLimit)
        val ordered = candidates
            .filter { cursor == null || isAfterCursor(it, cursor) }
            .sortedWith(messageComparator)
        val page = ordered.take(safeLimit)
        val hasMore = ordered.size > safeLimit
        val messages = JSONArray().apply { page.forEach { put(it.toJson()) } }
        val nextCursor = if (hasMore && page.isNotEmpty()) {
            MessageCursorRecord(page.last().timestamp, page.last().kind, page.last().sourceId).toJson()
        } else {
            null
        }

        return JSONObject().apply {
            put("messages", messages)
            put("nextCursor", nextCursor ?: JSONObject.NULL)
            put("hasMore", hasMore)
            put("totalCount", countSms(filter, threadId, address) + countMms(filter, threadId, address))
        }
    }

    fun getGalleryAlbums(): JSONArray {
        val albums = linkedMapOf<String, Triple<String, Int, String?>>()
        if (!hasImagePermission()) return JSONArray()
        context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            arrayOf(
                MediaStore.Images.Media._ID,
                MediaStore.Images.Media.BUCKET_ID,
                MediaStore.Images.Media.BUCKET_DISPLAY_NAME
            ),
            null,
            null,
            "${MediaStore.Images.Media.DATE_TAKEN} DESC, ${MediaStore.Images.Media._ID} DESC"
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndex(MediaStore.Images.Media._ID)
            val albumIdIndex = cursor.getColumnIndex(MediaStore.Images.Media.BUCKET_ID)
            val albumNameIndex = cursor.getColumnIndex(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)
            while (cursor.moveToNext()) {
                val albumId = nullableString(cursor, albumIdIndex).orEmpty().ifBlank { UNKNOWN_ALBUM_ID }
                val albumName = nullableString(cursor, albumNameIndex).orEmpty().ifBlank { "未知相册" }
                val imageId = nullableString(cursor, idIndex)
                val cover = imageId?.let {
                    Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, it).toString()
                }
                val existing = albums[albumId]
                albums[albumId] = Triple(albumName, (existing?.second ?: 0) + 1, existing?.third ?: cover)
            }
        }
        return JSONArray().apply {
            albums.forEach { (id, album) ->
                put(JSONObject().apply {
                    put("id", id)
                    put("name", album.first)
                    put("photoCount", album.second)
                    put("coverUri", album.third ?: JSONObject.NULL)
                })
            }
        }
    }

    fun getGalleryPage(albumId: String, offset: Int, limit: Int): JSONObject {
        val safeOffset = offset.coerceAtLeast(0)
        val safeLimit = limit.coerceIn(1, 120)
        if (!hasImagePermission()) return emptyGalleryPage(albumId, safeOffset)
        val (selection, selectionArgs) = gallerySelection(albumId)
        val totalCount = countRows(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            MediaStore.Images.Media._ID,
            selection,
            selectionArgs
        )
        val photos = queryStructuredGalleryPage(
            selection,
            selectionArgs,
            safeOffset,
            safeLimit
        ) ?: queryLegacyGalleryPage(selection, selectionArgs, safeOffset, safeLimit)
        return JSONObject().apply {
            put("albumId", albumId)
            put("offset", safeOffset)
            put("totalCount", totalCount)
            put("photos", photos)
        }
    }

    private fun querySmsPage(
        filter: String,
        threadId: Long?,
        address: String?,
        cursor: MessageCursorRecord?,
        limit: Int
    ): List<ViewerMessageRecord> {
        val (selection, selectionArgs) = smsSelection(filter, threadId, address, cursor)
        val result = mutableListOf<ViewerMessageRecord>()
        queryProviderPage(
            Telephony.Sms.CONTENT_URI,
            arrayOf(
                Telephony.Sms._ID,
                Telephony.Sms.THREAD_ID,
                Telephony.Sms.ADDRESS,
                Telephony.Sms.BODY,
                Telephony.Sms.DATE,
                Telephony.Sms.DATE_SENT,
                Telephony.Sms.TYPE,
                Telephony.Sms.READ,
                Telephony.Sms.SEEN,
                Telephony.Sms.STATUS,
                Telephony.Sms.SERVICE_CENTER,
                "sub_id"
            ),
            selection,
            selectionArgs,
            "${Telephony.Sms.DATE} DESC, ${Telephony.Sms._ID} DESC",
            limit
        )?.use { cursorRows ->
            while (cursorRows.moveToNext() && result.size < limit) {
                val sourceId = columnString(cursorRows, Telephony.Sms._ID)
                val receivedAt = columnLong(cursorRows, Telephony.Sms.DATE)
                val sentValue = nullableLong(cursorRows, cursorRows.getColumnIndex(Telephony.Sms.DATE_SENT))
                val sentAt = sentValue?.takeIf { it > 0 }
                val type = columnInt(cursorRows, Telephony.Sms.TYPE)
                result += ViewerMessageRecord(
                    sourceId = sourceId,
                    threadId = nullableLong(cursorRows, cursorRows.getColumnIndex(Telephony.Sms.THREAD_ID)),
                    address = columnString(cursorRows, Telephony.Sms.ADDRESS),
                    body = columnString(cursorRows, Telephony.Sms.BODY),
                    receivedAt = receivedAt,
                    sentAt = sentAt,
                    type = type,
                    direction = smsDirection(type),
                    kind = "sms",
                    read = columnInt(cursorRows, Telephony.Sms.READ) == 1,
                    seen = columnInt(cursorRows, Telephony.Sms.SEEN) == 1,
                    status = nullableInt(cursorRows, cursorRows.getColumnIndex(Telephony.Sms.STATUS)),
                    serviceCenter = nullableString(cursorRows, cursorRows.getColumnIndex(Telephony.Sms.SERVICE_CENTER)),
                    simSubscriptionId = nullableInt(cursorRows, cursorRows.getColumnIndex("sub_id"))
                )
            }
        }
        return result
    }

    private fun queryMmsPage(
        filter: String,
        threadId: Long?,
        address: String?,
        cursor: MessageCursorRecord?,
        limit: Int
    ): List<ViewerMessageRecord> {
        val (selection, selectionArgs) = mmsSelection(filter, threadId, cursor)
        val result = mutableListOf<ViewerMessageRecord>()
        queryProviderPage(
            Telephony.Mms.CONTENT_URI,
            arrayOf("_id", "thread_id", "date", "date_sent", "msg_box", "read", "seen"),
            selection,
            selectionArgs,
            "date DESC, _id DESC",
            limit
        )?.use { cursorRows ->
            while (cursorRows.moveToNext() && result.size < limit) {
                val sourceId = columnString(cursorRows, "_id")
                val messageBox = columnInt(cursorRows, "msg_box")
                val direction = mmsDirection(messageBox)
                val resolvedAddress = getMmsAddress(sourceId, direction)
                if (!address.isNullOrBlank() && threadId == null && resolvedAddress != address) continue
                val parts = getMmsParts(sourceId)
                val receivedAt = columnLong(cursorRows, "date") * 1_000
                val sentValue = nullableLong(cursorRows, cursorRows.getColumnIndex("date_sent"))
                val sentAt = sentValue?.takeIf { it > 0 }?.times(1_000)
                result += ViewerMessageRecord(
                    sourceId = sourceId,
                    threadId = nullableLong(cursorRows, cursorRows.getColumnIndex("thread_id")),
                    address = resolvedAddress,
                    body = parts.body,
                    receivedAt = receivedAt,
                    sentAt = sentAt,
                    type = messageBox,
                    direction = direction,
                    kind = "mms",
                    read = columnInt(cursorRows, "read") == 1,
                    seen = columnInt(cursorRows, "seen") == 1,
                    status = null,
                    serviceCenter = null,
                    simSubscriptionId = null,
                    attachments = parts.attachments
                )
            }
        }
        return result
    }

    /**
     * API 26 起优先使用结构化查询参数；部分厂商 Provider 会忽略 limit，读取循环仍会在页上限停止，
     * 因此单次调用不会构造全量短信 JSON。
     */
    private fun queryProviderPage(
        uri: Uri,
        projection: Array<String>,
        selection: String?,
        selectionArgs: Array<String>?,
        sortOrder: String,
        limit: Int
    ): Cursor? {
        val queryArgs = Bundle().apply {
            selection?.let { putString(ContentResolver.QUERY_ARG_SQL_SELECTION, it) }
            selectionArgs?.let { putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, it) }
            putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, sortOrder)
            putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
        }
        return try {
            context.contentResolver.query(uri, projection, queryArgs, null)
        } catch (_: Exception) {
            context.contentResolver.query(uri, projection, selection, selectionArgs, sortOrder)
        }
    }

    private fun smsSelection(
        filter: String,
        threadId: Long?,
        address: String?,
        cursor: MessageCursorRecord?
    ): Pair<String?, Array<String>?> {
        val clauses = mutableListOf<String>()
        val args = mutableListOf<String>()
        if (threadId != null) {
            clauses += "${Telephony.Sms.THREAD_ID} = ?"
            args += threadId.toString()
        } else if (!address.isNullOrBlank()) {
            clauses += "${Telephony.Sms.ADDRESS} = ?"
            args += address
        }
        when (filter) {
            "inbox" -> clauses += "${Telephony.Sms.TYPE} = ${Telephony.Sms.MESSAGE_TYPE_INBOX}"
            "sent" -> clauses += "${Telephony.Sms.TYPE} = ${Telephony.Sms.MESSAGE_TYPE_SENT}"
        }
        cursor?.let {
            if (it.kind == "sms") {
                clauses += "(${Telephony.Sms.DATE} < ? OR (${Telephony.Sms.DATE} = ? AND ${Telephony.Sms._ID} < ?))"
                args += it.timestamp.toString()
                args += it.timestamp.toString()
                args += it.sourceId
            } else {
                clauses += "${Telephony.Sms.DATE} <= ?"
                args += it.timestamp.toString()
            }
        }
        return clauses.takeIf { it.isNotEmpty() }?.joinToString(" AND ") to
            args.takeIf { it.isNotEmpty() }?.toTypedArray()
    }

    private fun mmsSelection(
        filter: String,
        threadId: Long?,
        cursor: MessageCursorRecord?
    ): Pair<String?, Array<String>?> {
        val clauses = mutableListOf<String>()
        val args = mutableListOf<String>()
        threadId?.let {
            clauses += "thread_id = ?"
            args += it.toString()
        }
        when (filter) {
            "inbox" -> clauses += "msg_box = 1"
            "sent" -> clauses += "msg_box = 2"
        }
        cursor?.let {
            val seconds = it.timestamp / 1_000
            if (it.kind == "mms") {
                clauses += "(date < ? OR (date = ? AND _id < ?))"
                args += seconds.toString()
                args += seconds.toString()
                args += it.sourceId
            } else {
                clauses += "date < ?"
                args += seconds.toString()
            }
        }
        return clauses.takeIf { it.isNotEmpty() }?.joinToString(" AND ") to
            args.takeIf { it.isNotEmpty() }?.toTypedArray()
    }

    private fun countSms(filter: String, threadId: Long?, address: String?): Int {
        val (selection, args) = smsSelection(filter, threadId, address, null)
        return countRows(Telephony.Sms.CONTENT_URI, Telephony.Sms._ID, selection, args)
    }

    private fun countMms(filter: String, threadId: Long?, address: String?): Int {
        val (selection, args) = mmsSelection(filter, threadId, null)
        if (threadId == null && !address.isNullOrBlank()) {
            var matched = 0
            context.contentResolver.query(
                Telephony.Mms.CONTENT_URI,
                arrayOf("_id", "msg_box"),
                selection,
                args,
                null
            )?.use { cursor ->
                val idIndex = cursor.getColumnIndex("_id")
                val boxIndex = cursor.getColumnIndex("msg_box")
                while (cursor.moveToNext()) {
                    val sourceId = nullableString(cursor, idIndex).orEmpty()
                    val direction = mmsDirection(if (boxIndex >= 0) cursor.getInt(boxIndex) else 0)
                    if (getMmsAddress(sourceId, direction) == address) matched += 1
                }
            }
            return matched
        }
        return countRows(Telephony.Mms.CONTENT_URI, "_id", selection, args)
    }

    private fun countRows(
        uri: Uri,
        idColumn: String,
        selection: String?,
        selectionArgs: Array<String>?
    ): Int = context.contentResolver.query(
        uri,
        arrayOf(idColumn),
        selection,
        selectionArgs,
        null
    )?.use { it.count } ?: 0

    private fun queryStructuredGalleryPage(
        selection: String?,
        selectionArgs: Array<String>?,
        offset: Int,
        limit: Int
    ): JSONArray? {
        val queryArgs = Bundle().apply {
            selection?.let { putString(ContentResolver.QUERY_ARG_SQL_SELECTION, it) }
            selectionArgs?.let { putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, it) }
            putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, GALLERY_SORT_ORDER)
            putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
            putInt(ContentResolver.QUERY_ARG_OFFSET, offset)
        }
        return try {
            context.contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                galleryProjection,
                queryArgs,
                null
            )?.use { cursor ->
                val honored = cursor.extras
                    .getStringArray(ContentResolver.EXTRA_HONORED_ARGS)
                    ?.toSet()
                    .orEmpty()
                val offsetHonored = honored.contains(ContentResolver.QUERY_ARG_OFFSET)
                if (offset > 0 && !offsetHonored) return@use null
                if (!honored.contains(ContentResolver.QUERY_ARG_LIMIT)) {
                    // 厂商未确认 limit 时由读取循环强制截断，仍只创建一页图片 JSON。
                    return@use galleryRows(cursor, 0, limit)
                }
                galleryRows(cursor, 0, limit)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun queryLegacyGalleryPage(
        selection: String?,
        selectionArgs: Array<String>?,
        offset: Int,
        limit: Int
    ): JSONArray = context.contentResolver.query(
        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
        galleryProjection,
        selection,
        selectionArgs,
        GALLERY_SORT_ORDER
    )?.use { cursor -> galleryRows(cursor, offset, limit) } ?: JSONArray()

    private fun galleryRows(cursor: Cursor, skip: Int, limit: Int): JSONArray {
        val result = JSONArray()
        var skipped = 0
        while (cursor.moveToNext() && result.length() < limit) {
            if (skipped < skip) {
                skipped += 1
                continue
            }
            result.put(galleryPhotoJson(cursor))
        }
        return result
    }

    private fun galleryPhotoJson(cursor: Cursor): JSONObject {
        val id = columnLong(cursor, MediaStore.Images.Media._ID)
        val takenAt = nullableLong(cursor, cursor.getColumnIndex(MediaStore.Images.Media.DATE_TAKEN))
            ?.takeIf { it > 0 }
            ?: (nullableLong(cursor, cursor.getColumnIndex(MediaStore.Images.Media.DATE_ADDED)) ?: 0L) * 1_000
        return JSONObject().apply {
            put("id", id.toString())
            put("uri", Uri.withAppendedPath(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                id.toString()
            ).toString())
            put("albumId", nullableString(cursor, cursor.getColumnIndex(MediaStore.Images.Media.BUCKET_ID)).orEmpty())
            put("albumName", nullableString(cursor, cursor.getColumnIndex(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)).orEmpty().ifBlank { "未知相册" })
            put("displayName", nullableString(cursor, cursor.getColumnIndex(MediaStore.Images.Media.DISPLAY_NAME)).orEmpty())
            put("takenAt", takenAt)
            put("mimeType", nullableString(cursor, cursor.getColumnIndex(MediaStore.Images.Media.MIME_TYPE)).orEmpty())
        }
    }

    private fun gallerySelection(albumId: String): Pair<String?, Array<String>?> =
        if (albumId == UNKNOWN_ALBUM_ID) {
            "(${MediaStore.Images.Media.BUCKET_ID} IS NULL OR ${MediaStore.Images.Media.BUCKET_ID} = '')" to null
        } else {
            "${MediaStore.Images.Media.BUCKET_ID} = ?" to arrayOf(albumId)
        }

    private fun emptyGalleryPage(albumId: String, offset: Int): JSONObject = JSONObject().apply {
        put("albumId", albumId)
        put("offset", offset)
        put("totalCount", 0)
        put("photos", JSONArray())
    }

    private fun accumulateConversation(
        summaries: MutableMap<String, ConversationSummaryRecord>,
        threadId: Long?,
        address: String,
        preview: String,
        timestamp: Long,
        unread: Boolean
    ) {
        val key = conversationKey(threadId, address)
        val normalizedAddress = address.trim().ifBlank { "未知号码" }
        val existing = summaries[key]
        if (existing == null) {
            summaries[key] = ConversationSummaryRecord(
                key,
                threadId,
                normalizedAddress,
                preview,
                timestamp,
                1,
                if (unread) 1 else 0
            )
            return
        }
        existing.messageCount += 1
        if (unread) existing.unreadCount += 1
        if (timestamp > existing.latestAt) {
            existing.latestAt = timestamp
            existing.preview = preview
            existing.address = normalizedAddress
        }
    }

    private fun conversationKey(threadId: Long?, address: String): String =
        threadId?.let { "thread:$it" } ?: "address:${address.trim().ifBlank { "unknown" }}"

    private fun isAfterCursor(message: ViewerMessageRecord, cursor: MessageCursorRecord): Boolean =
        messageComparator.compare(
            message,
            ViewerMessageRecord(
                sourceId = cursor.sourceId,
                threadId = null,
                address = "",
                body = "",
                receivedAt = cursor.timestamp,
                sentAt = null,
                type = 0,
                direction = "unknown",
                kind = cursor.kind,
                read = true,
                seen = true,
                status = null,
                serviceCenter = null,
                simSubscriptionId = null
            )
        ) > 0

    private val messageComparator = Comparator<ViewerMessageRecord> { left, right ->
        when {
            left.timestamp != right.timestamp -> right.timestamp.compareTo(left.timestamp)
            left.kind != right.kind -> left.kind.compareTo(right.kind)
            else -> {
                val leftId = left.sourceId.toLongOrNull()
                val rightId = right.sourceId.toLongOrNull()
                if (leftId != null && rightId != null) rightId.compareTo(leftId)
                else right.sourceId.compareTo(left.sourceId)
            }
        }
    }

    private fun smsDirection(type: Int): String = when (type) {
        Telephony.Sms.MESSAGE_TYPE_INBOX -> "inbox"
        Telephony.Sms.MESSAGE_TYPE_SENT -> "sent"
        Telephony.Sms.MESSAGE_TYPE_DRAFT -> "draft"
        Telephony.Sms.MESSAGE_TYPE_OUTBOX -> "outbox"
        Telephony.Sms.MESSAGE_TYPE_FAILED -> "failed"
        Telephony.Sms.MESSAGE_TYPE_QUEUED -> "queued"
        else -> "unknown"
    }

    private fun columnString(cursor: Cursor, column: String): String =
        nullableString(cursor, cursor.getColumnIndex(column)).orEmpty()

    private fun columnLong(cursor: Cursor, column: String): Long =
        nullableLong(cursor, cursor.getColumnIndex(column)) ?: 0L

    private fun columnInt(cursor: Cursor, column: String): Int =
        nullableInt(cursor, cursor.getColumnIndex(column)) ?: 0

    private fun nullableString(cursor: Cursor, index: Int): String? =
        if (index >= 0 && !cursor.isNull(index)) cursor.getString(index) else null

    private fun nullableLong(cursor: Cursor, index: Int): Long? =
        if (index >= 0 && !cursor.isNull(index)) cursor.getLong(index) else null

    private fun nullableInt(cursor: Cursor, index: Int): Int? =
        if (index >= 0 && !cursor.isNull(index)) cursor.getInt(index) else null

    fun queueRecord(record: SmsRecord): Boolean {
        if (database.containsRecord(record.recordId, record.contentKey)) return false
        return database.enqueue(record)
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

    private val galleryProjection = arrayOf(
        MediaStore.Images.Media._ID,
        MediaStore.Images.Media.DISPLAY_NAME,
        MediaStore.Images.Media.DATE_TAKEN,
        MediaStore.Images.Media.DATE_ADDED,
        MediaStore.Images.Media.BUCKET_ID,
        MediaStore.Images.Media.BUCKET_DISPLAY_NAME,
        MediaStore.Images.Media.MIME_TYPE
    )

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
        private const val KEY_LAST_SYNC_AT = "last_sync_at"
        private const val UNKNOWN_ALBUM_ID = "__unknown__"
        private const val GALLERY_SORT_ORDER =
            "date_taken DESC, date_added DESC, _id DESC"
    }
}
