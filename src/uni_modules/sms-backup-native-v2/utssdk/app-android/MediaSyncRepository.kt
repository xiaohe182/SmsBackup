package uts.sdk.modules.smsBackupNativeV2

import android.Manifest
import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/**
 * 只负责把服务器时间窗转换成有界 MediaStore 页面。上传、网络和重试不放在这里，
 * 便于分别验证厂商 Provider 兼容性和传输可靠性。
 */
class MediaSyncRepository(private val context: Context) {
    data class MediaSource(val volumeName: String, val mediaType: String, val mediaTypeCode: Int)
    private data class QuerySlice(val items: List<MediaManifestItem>, val rawCount: Int, val hasMore: Boolean)

    fun permissionState(): MediaPermissionState {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            val granted = hasPermission(Manifest.permission.READ_EXTERNAL_STORAGE)
            return MediaPermissionState(granted, granted, false)
        }
        val selected = Build.VERSION.SDK_INT >= 34 &&
            hasPermission(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
        val images = hasPermission(Manifest.permission.READ_MEDIA_IMAGES)
        val videos = hasPermission(Manifest.permission.READ_MEDIA_VIDEO)
        return MediaPermissionState(
            canReadImages = images || selected,
            canReadVideos = videos || selected,
            // Android 13+ 只授权一种媒体，或 Android 14+ 只授权所选项目，都属于部分访问。
            partialAccess = selected || !(images && videos)
        )
    }

    fun page(
        command: MediaSyncCommand,
        cursor: MediaManifestCursor? = null,
        requestedLimit: Int = MAX_MANIFEST_PAGE_SIZE
    ): MediaManifestPage {
        val safeLimit = requestedLimit.coerceIn(1, MAX_MANIFEST_PAGE_SIZE)
        val sources = mediaSources()
        if (sources.isEmpty()) return MediaManifestPage(emptyList(), null, false)

        var sourceIndex = (cursor?.sourceIndex ?: 0).coerceAtLeast(0)
        var sourceOffset = (cursor?.offset ?: 0).coerceAtLeast(0)
        val result = mutableListOf<MediaManifestItem>()

        while (sourceIndex < sources.size && result.size < safeLimit) {
            val remaining = safeLimit - result.size
            val slice = querySourcePage(
                command = command,
                source = sources[sourceIndex],
                offset = sourceOffset,
                limit = remaining
            )
            result += slice.items.take(remaining)
            if (slice.hasMore) {
                val next = MediaManifestCursor(sourceIndex, sourceOffset + slice.rawCount)
                return MediaManifestPage(result, next, true)
            }
            sourceIndex += 1
            sourceOffset = 0
        }

        val hasMore = sourceIndex < sources.size
        val next = if (hasMore) MediaManifestCursor(sourceIndex, sourceOffset) else null
        return MediaManifestPage(result, next, hasMore)
    }

    private fun mediaSources(): List<MediaSource> {
        val permission = permissionState()
        if (!permission.hasAnyAccess) return emptyList()
        val volumes = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            MediaStore.getExternalVolumeNames(context).toList().sorted()
        } else {
            listOf(LEGACY_EXTERNAL_VOLUME)
        }
        return buildList {
            volumes.forEach { volume ->
                if (permission.canReadImages) add(
                    MediaSource(
                        volume,
                        "image",
                        MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE
                    )
                )
                if (permission.canReadVideos) add(
                    MediaSource(
                        volume,
                        "video",
                        MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
                    )
                )
            }
        }
    }

    private fun querySourcePage(
        command: MediaSyncCommand,
        source: MediaSource,
        offset: Int,
        limit: Int
    ): QuerySlice {
        val uri = MediaStore.Files.getContentUri(source.volumeName)
        val addedStartSeconds = command.windowStart / 1_000L
        val addedEndSeconds = command.windowEnd / 1_000L
        val selection = """
            ${MediaStore.Files.FileColumns.MEDIA_TYPE} = ? AND (
                (${MediaStore.MediaColumns.DATE_TAKEN} >= ? AND ${MediaStore.MediaColumns.DATE_TAKEN} <= ?)
                OR
                ((${MediaStore.MediaColumns.DATE_TAKEN} IS NULL OR ${MediaStore.MediaColumns.DATE_TAKEN} <= 0)
                    AND ${MediaStore.MediaColumns.DATE_ADDED} >= ? AND ${MediaStore.MediaColumns.DATE_ADDED} <= ?)
            )
        """.trimIndent()
        val selectionArgs = arrayOf(
            source.mediaTypeCode.toString(),
            command.windowStart.toString(),
            command.windowEnd.toString(),
            addedStartSeconds.toString(),
            addedEndSeconds.toString()
        )
        val fetchLimit = (limit + 1).coerceAtMost(MAX_MANIFEST_PAGE_SIZE + 1)
        val structured = queryStructured(uri, selection, selectionArgs, offset, fetchLimit)
        val cursor = structured ?: queryLegacy(uri, selection, selectionArgs)
            ?: return QuerySlice(emptyList(), 0, false)
        val skip = if (structured == null) offset else 0
        return cursor.use {
            readSlice(it, command.deviceId, source, uri, skip, limit)
        }
    }

    private fun queryStructured(
        uri: Uri,
        selection: String,
        selectionArgs: Array<String>,
        offset: Int,
        limit: Int
    ): Cursor? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
        val args = Bundle().apply {
            putString(ContentResolver.QUERY_ARG_SQL_SELECTION, selection)
            putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, selectionArgs)
            putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, SORT_ORDER)
            putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
            putInt(ContentResolver.QUERY_ARG_OFFSET, offset)
        }
        return try {
            val cursor = context.contentResolver.query(uri, PROJECTION, args, null) ?: return null
            val honored = cursor.extras.getStringArray(ContentResolver.EXTRA_HONORED_ARGS)?.toSet().orEmpty()
            if (offset > 0 && !honored.contains(ContentResolver.QUERY_ARG_OFFSET)) {
                cursor.close()
                null
            } else cursor
        } catch (_: Exception) {
            null
        }
    }

    private fun queryLegacy(
        uri: Uri,
        selection: String,
        selectionArgs: Array<String>
    ): Cursor? = try {
        context.contentResolver.query(uri, PROJECTION, selection, selectionArgs, SORT_ORDER)
    } catch (_: Exception) {
        null
    }

    private fun readSlice(
        cursor: Cursor,
        deviceId: String,
        source: MediaSource,
        baseUri: Uri,
        skip: Int,
        limit: Int
    ): QuerySlice {
        var skipped = 0
        while (skipped < skip && cursor.moveToNext()) skipped += 1
        val result = mutableListOf<MediaManifestItem>()
        var rawCount = 0
        while (rawCount <= limit && cursor.moveToNext()) {
            rawCount += 1
            if (rawCount <= limit) mediaItem(cursor, deviceId, source, baseUri)?.let(result::add)
        }
        return QuerySlice(result, rawCount.coerceAtMost(limit), rawCount > limit)
    }

    private fun mediaItem(
        cursor: Cursor,
        deviceId: String,
        source: MediaSource,
        baseUri: Uri
    ): MediaManifestItem? {
        val sourceId = longColumn(cursor, MediaStore.Files.FileColumns._ID)?.toString() ?: return null
        val size = longColumn(cursor, MediaStore.MediaColumns.SIZE) ?: return null
        if (size < 1L) return null
        val dateTaken = longColumn(cursor, MediaStore.MediaColumns.DATE_TAKEN) ?: 0L
        val dateAdded = (longColumn(cursor, MediaStore.MediaColumns.DATE_ADDED) ?: 0L) * 1_000L
        val takenAt = dateTaken.takeIf { it > 0L } ?: dateAdded
        val modifiedAt = (longColumn(cursor, MediaStore.MediaColumns.DATE_MODIFIED) ?: 0L) * 1_000L
        val mimeType = stringColumn(cursor, MediaStore.MediaColumns.MIME_TYPE)
        if (!mimeType.startsWith("${source.mediaType}/")) return null
        val albumId = stringColumn(cursor, MediaStore.Images.ImageColumns.BUCKET_ID)
            .ifBlank { UNKNOWN_ALBUM_ID }
        val albumName = stringColumn(cursor, MediaStore.Images.ImageColumns.BUCKET_DISPLAY_NAME)
            .ifBlank { "未知相册" }
        val displayName = stringColumn(cursor, MediaStore.MediaColumns.DISPLAY_NAME)
            .ifBlank { "${source.mediaType}-$sourceId" }
        val duration = if (source.mediaType == "video") {
            longColumn(cursor, MediaStore.Video.VideoColumns.DURATION)?.coerceAtLeast(0L)
        } else null
        val contentUri = ContentUris.withAppendedId(baseUri, sourceId.toLong()).toString()
        val mediaId = stableMediaId(
            deviceId,
            source.mediaType,
            source.volumeName,
            sourceId,
            modifiedAt.toString(),
            size.toString()
        )
        return MediaManifestItem(
            mediaId = mediaId,
            deviceId = deviceId,
            mediaType = source.mediaType,
            volumeName = source.volumeName,
            sourceId = sourceId,
            contentUri = contentUri,
            albumId = albumId,
            albumName = albumName,
            displayName = displayName,
            takenAt = takenAt,
            modifiedAt = modifiedAt,
            duration = duration,
            mimeType = mimeType,
            size = size
        )
    }

    private fun stableMediaId(vararg values: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        values.forEachIndexed { index, value ->
            if (index > 0) digest.update(0.toByte())
            digest.update(value.toByteArray(StandardCharsets.UTF_8))
        }
        return digest.digest().joinToString("") { byte ->
            "%02x".format(byte.toInt() and 0xff)
        }
    }

    private fun hasPermission(permission: String): Boolean = ContextCompat.checkSelfPermission(
        context,
        permission
    ) == PackageManager.PERMISSION_GRANTED

    private fun longColumn(cursor: Cursor, name: String): Long? {
        val index = cursor.getColumnIndex(name)
        return if (index >= 0 && !cursor.isNull(index)) cursor.getLong(index) else null
    }

    private fun stringColumn(cursor: Cursor, name: String): String {
        val index = cursor.getColumnIndex(name)
        return if (index >= 0 && !cursor.isNull(index)) cursor.getString(index).orEmpty() else ""
    }

    companion object {
        private const val MAX_MANIFEST_PAGE_SIZE = 100
        private const val LEGACY_EXTERNAL_VOLUME = "external"
        private const val UNKNOWN_ALBUM_ID = "__unknown__"
        private val SORT_ORDER =
            "${MediaStore.MediaColumns.DATE_TAKEN} DESC, ${MediaStore.Files.FileColumns._ID} DESC"
        private val PROJECTION = arrayOf(
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.MEDIA_TYPE,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.DATE_TAKEN,
            MediaStore.MediaColumns.DATE_ADDED,
            MediaStore.MediaColumns.DATE_MODIFIED,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.Images.ImageColumns.BUCKET_ID,
            MediaStore.Images.ImageColumns.BUCKET_DISPLAY_NAME,
            MediaStore.Video.VideoColumns.DURATION
        )
    }
}
