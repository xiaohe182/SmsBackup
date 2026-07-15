package uts.sdk.modules.smsBackupNative

import android.content.ContentResolver
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class MediaSyncException(
    message: String,
    val retryable: Boolean
) : Exception(message)

/**
 * 服务端媒体协议客户端。它只处理鉴权、JSON 和二进制分块，不持有页面或短信正文，
 * 也不记录 Token、文件名和内容，避免敏感数据进入系统日志。
 */
class MediaSyncClient(
    private val settings: MediaClientSettings,
    private val contentResolver: ContentResolver
) {
    fun pollCommand(deviceId: String, appVersion: String): MediaSyncCommand? {
        val endpoint = settings.serverUrl + "/api/device/${path(deviceId)}/commands/next" +
            "?deviceName=${query(settings.deviceName)}&appVersion=${query(appVersion)}"
        val connection = open(endpoint, "GET")
        return try {
            val code = connection.responseCode
            when {
                code == HttpURLConnection.HTTP_NO_CONTENT -> null
                code in 200..299 -> MediaSyncCommand.fromJson(JSONObject(readResponse(connection)))
                    ?: throw MediaSyncException("invalid sync command", true)
                else -> throw httpError("command polling", code)
            }
        } finally {
            connection.disconnect()
        }
    }

    fun submitManifest(
        command: MediaSyncCommand,
        page: MediaManifestPage
    ): MediaManifestResponse {
        val payload = JSONObject().apply {
            put("requestId", command.id)
            put("deviceId", command.deviceId)
            put("items", page.itemsJson())
        }
        val response = requestJson("/api/media/manifest", "POST", payload)
        val missingJson = response.optJSONArray("missing") ?: JSONArray()
        val missing = buildList {
            for (index in 0 until missingJson.length()) {
                val value = missingJson.optJSONObject(index) ?: continue
                val mediaId = value.optString("mediaId", "")
                val offset = value.optLong("offset", -1L)
                val size = value.optLong("size", -1L)
                if (mediaId.isNotBlank() && offset >= 0L && size > 0L && offset <= size) {
                    add(MissingMedia(mediaId, offset, size))
                }
            }
        }
        return MediaManifestResponse(
            missing = missing,
            rejectedCount = response.optJSONArray("rejected")?.length() ?: 0
        )
    }

    /** 返回本次实际发送的字节数；已在服务器上的前缀不重复计数。 */
    fun uploadMedia(deviceId: String, item: MediaManifestItem, missing: MissingMedia): Long {
        if (missing.offset >= item.size) return 0L
        val input = contentResolver.openInputStream(Uri.parse(item.contentUri))
            ?: throw MediaSyncException("media stream unavailable", false)
        return input.use { stream ->
            skipFully(stream, missing.offset)
            var offset = missing.offset
            var uploaded = 0L
            val buffer = ByteArray(CHUNK_SIZE_BYTES)
            while (offset < item.size) {
                val wanted = minOf(buffer.size.toLong(), item.size - offset).toInt()
                val read = stream.read(buffer, 0, wanted)
                if (read < 0) throw MediaSyncException("media ended before declared size", false)
                if (read == 0) continue
                val nextOffset = uploadChunk(deviceId, item, offset, buffer, read)
                if (nextOffset != offset + read) {
                    throw MediaSyncException("server returned an unexpected media offset", true)
                }
                offset = nextOffset
                uploaded += read
            }
            uploaded
        }
    }

    fun complete(command: MediaSyncCommand, result: MediaSyncResult) {
        requestJson(
            "/api/device/${path(command.deviceId)}/commands/${path(command.id)}/complete",
            "POST",
            result.toJson()
        )
    }

    private fun uploadChunk(
        deviceId: String,
        item: MediaManifestItem,
        offset: Long,
        buffer: ByteArray,
        length: Int
    ): Long {
        val end = offset + length - 1L
        val connection = open(
            settings.serverUrl + "/api/media/${path(item.mediaId)}/content",
            "PUT"
        )
        return try {
            connection.doOutput = true
            connection.setFixedLengthStreamingMode(length.toLong())
            connection.setRequestProperty("Content-Type", "application/octet-stream")
            connection.setRequestProperty("X-Device-Id", deviceId)
            connection.setRequestProperty("Content-Range", "bytes $offset-$end/${item.size}")
            connection.outputStream.use { output -> output.write(buffer, 0, length) }
            val code = connection.responseCode
            if (code !in 200..299) throw httpError("media upload", code)
            JSONObject(readResponse(connection)).optLong("offset", -1L)
        } finally {
            connection.disconnect()
        }
    }

    private fun requestJson(path: String, method: String, payload: JSONObject): JSONObject {
        val connection = open(settings.serverUrl + path, method)
        return try {
            val bytes = payload.toString().toByteArray(StandardCharsets.UTF_8)
            connection.doOutput = true
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.outputStream.use { it.write(bytes) }
            val code = connection.responseCode
            if (code !in 200..299) throw httpError(path, code)
            JSONObject(readResponse(connection))
        } finally {
            connection.disconnect()
        }
    }

    private fun open(endpoint: String, method: String): HttpURLConnection {
        if (endpoint.startsWith("http://") && !settings.allowInsecureHttp) {
            throw MediaSyncException("insecure HTTP is disabled", false)
        }
        return (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 20_000
            readTimeout = 60_000
            useCaches = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Authorization", "Bearer ${settings.apiToken}")
        }
    }

    private fun readResponse(connection: HttpURLConnection): String {
        val stream = if (connection.responseCode >= 400) connection.errorStream else connection.inputStream
        if (stream == null) return "{}"
        return stream.use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                if (read > 0) output.write(buffer, 0, read)
            }
            output.toString(StandardCharsets.UTF_8.name())
        }
    }

    private fun skipFully(input: InputStream, byteCount: Long) {
        var remaining = byteCount
        while (remaining > 0L) {
            val skipped = input.skip(remaining)
            if (skipped > 0L) {
                remaining -= skipped
            } else if (input.read() >= 0) {
                remaining -= 1L
            } else {
                throw MediaSyncException("resume offset is beyond local media", false)
            }
        }
    }

    private fun httpError(operation: String, code: Int): MediaSyncException = MediaSyncException(
        "$operation failed with HTTP $code",
        retryable = code == 408 || code == 409 || code == 425 || code == 429 || code >= 500
    )

    private fun path(value: String): String = Uri.encode(value)

    private fun query(value: String): String = URLEncoder.encode(
        value,
        StandardCharsets.UTF_8.name()
    )

    companion object {
        private const val CHUNK_SIZE_BYTES = 1024 * 1024
    }
}
