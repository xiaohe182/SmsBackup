package uts.sdk.modules.smsBackupNative

import org.json.JSONArray
import org.json.JSONObject

data class MediaSyncCommand(
    val id: String,
    val deviceId: String,
    val windowStart: Long,
    val windowEnd: Long,
    val lookbackHours: Int,
    val wifiOnly: Boolean
) {
    companion object {
        fun fromJson(value: JSONObject): MediaSyncCommand? {
            val id = value.optString("id", "")
            val deviceId = value.optString("deviceId", "")
            val windowStart = value.optLong("windowStart", -1L)
            val windowEnd = value.optLong("windowEnd", -1L)
            val lookbackHours = value.optInt("lookbackHours", 0)
            if (id.isBlank() || deviceId.isBlank() || windowStart < 0L ||
                windowEnd < windowStart || lookbackHours < 1
            ) return null
            return MediaSyncCommand(
                id = id,
                deviceId = deviceId,
                windowStart = windowStart,
                windowEnd = windowEnd,
                lookbackHours = lookbackHours,
                wifiOnly = value.optBoolean("wifiOnly", false)
            )
        }
    }
}

data class MediaManifestCursor(
    val sourceIndex: Int = 0,
    val offset: Int = 0
)

data class MediaManifestItem(
    val mediaId: String,
    val deviceId: String,
    val mediaType: String,
    val volumeName: String,
    val sourceId: String,
    val contentUri: String,
    val albumId: String,
    val albumName: String,
    val displayName: String,
    val takenAt: Long,
    val modifiedAt: Long,
    val duration: Long?,
    val mimeType: String,
    val size: Long
) {
    /** contentUri 只在手机内使用，绝不上传本机 URI 或真实路径。 */
    fun toServerJson(): JSONObject = JSONObject().apply {
        put("mediaId", mediaId)
        put("deviceId", deviceId)
        put("mediaType", mediaType)
        put("volumeName", volumeName)
        put("sourceId", sourceId)
        put("albumId", albumId)
        put("albumName", albumName)
        put("displayName", displayName)
        put("takenAt", takenAt)
        put("modifiedAt", modifiedAt)
        put("duration", duration ?: JSONObject.NULL)
        put("mimeType", mimeType)
        put("size", size)
    }
}

data class MediaManifestPage(
    val items: List<MediaManifestItem>,
    val nextCursor: MediaManifestCursor?,
    val hasMore: Boolean
) {
    fun itemsJson(): JSONArray = JSONArray().apply {
        items.forEach { put(it.toServerJson()) }
    }
}

data class MediaPermissionState(
    val canReadImages: Boolean,
    val canReadVideos: Boolean,
    val partialAccess: Boolean
) {
    val hasAnyAccess: Boolean get() = canReadImages || canReadVideos
    val fullAccess: Boolean get() = canReadImages && canReadVideos && !partialAccess
}

data class MissingMedia(
    val mediaId: String,
    val offset: Long,
    val size: Long
)

data class MediaManifestResponse(
    val missing: List<MissingMedia>,
    val rejectedCount: Int
)

data class MediaSyncResult(
    var status: String = "completed",
    var smsQueued: Int = 0,
    var imageUploaded: Int = 0,
    var videoUploaded: Int = 0,
    var mediaBytesUploaded: Long = 0L,
    var error: String? = null
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("status", status)
        put("smsQueued", smsQueued)
        put("imageUploaded", imageUploaded)
        put("videoUploaded", videoUploaded)
        put("mediaBytesUploaded", mediaBytesUploaded)
        put("error", error ?: JSONObject.NULL)
    }
}
