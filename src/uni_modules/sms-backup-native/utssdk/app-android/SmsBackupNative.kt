package uts.sdk.modules.smsBackupNative

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import io.dcloud.uts.UTSAndroid
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object SmsBackupNative {
    fun initialize() {
        appContext()?.let {
            SmsRepository(it).deviceId()
            WorkScheduler.initialize(it)
        }
    }

    fun getPermissionStateJson(): String {
        val context = appContext()
        val readGranted = hasPermission(context, Manifest.permission.READ_SMS)
        val receiveGranted = hasPermission(context, Manifest.permission.RECEIVE_SMS)
        return JSONObject().apply {
            put("readSms", readGranted)
            put("receiveSms", receiveGranted)
            put("allGranted", readGranted && receiveGranted)
        }.toString()
    }

    fun scanExistingMessages(): Int = appContext()?.let {
        SmsRepository(it).scanExistingMessages()
    } ?: 0

    fun getAllMessagesJson(password: String): String {
        val context = appContext()
        val permissionGranted = hasPermission(context, Manifest.permission.READ_SMS)
        if (password != VIEW_PASSWORD) {
            return viewerResponse(false, permissionGranted, JSONArray())
        }
        if (context == null || !permissionGranted) {
            return viewerResponse(true, false, JSONArray())
        }
        val repository = SmsRepository(context)
        return viewerResponse(true, true, repository.getAllMessages())
    }

    fun getAllMmsMessagesJson(password: String): String {
        val context = appContext()
        val permissionGranted = hasPermission(context, Manifest.permission.READ_SMS)
        if (password != VIEW_PASSWORD) {
            return viewerResponse(false, permissionGranted, JSONArray())
        }
        if (context == null || !permissionGranted) {
            return viewerResponse(true, false, JSONArray())
        }
        val repository = SmsRepository(context)
        return viewerResponse(true, true, repository.getAllMmsMessages())
    }

    fun getGalleryPhotosJson(password: String): String {
        val context = appContext()
        val permissionGranted = hasImagePermission(context)
        if (password != VIEW_PASSWORD) {
            return galleryResponse(false, permissionGranted, JSONArray())
        }
        if (context == null || !permissionGranted) {
            return galleryResponse(true, false, JSONArray())
        }
        val repository = SmsRepository(context)
        return galleryResponse(true, true, repository.getGalleryPhotos())
    }

    fun getBackupStatusJson(): String = appContext()?.let {
        SmsRepository(it).getStatusJson()
    } ?: "{\"available\":false,\"permissionGranted\":false,\"pendingCount\":0,\"uploadedCount\":0,\"filteredCount\":0,\"lastSyncAt\":null,\"message\":\"Android 上下文不可用\"}"

    fun saveSettings(json: String) {
        appContext()?.let {
            SmsRepository(it).saveSettings(json)
            WorkScheduler.enqueueUpload(it)
        }
    }

    fun saveRules(json: String) {
        appContext()?.let { SmsRepository(it).saveRules(json) }
    }

    fun clearQueue() {
        appContext()?.let { SmsRepository(it).clearQueue() }
    }

    fun syncNow() {
        appContext()?.let { WorkScheduler.enqueueUpload(it) }
    }

    fun testConnection(serverUrl: String): Boolean {
        if (serverUrl.isBlank()) return false
        val connection = URL(serverUrl.trimEnd('/') + "/api/health")
            .openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "GET"
            connection.connectTimeout = 8_000
            connection.readTimeout = 8_000
            connection.responseCode in 200..299
        } catch (_: Exception) {
            false
        } finally {
            connection.disconnect()
        }
    }

    private fun appContext(): Context? = UTSAndroid.getAppContext()

    private fun hasPermission(context: Context?, permission: String): Boolean =
        context != null && ContextCompat.checkSelfPermission(
            context,
            permission
        ) == PackageManager.PERMISSION_GRANTED

    private fun hasImagePermission(context: Context?): Boolean = hasPermission(
        context,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_IMAGES
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
    )

    private fun viewerResponse(
        authorized: Boolean,
        permissionGranted: Boolean,
        messages: JSONArray
    ): String = JSONObject().apply {
        put("authorized", authorized)
        put("permissionGranted", permissionGranted)
        put("messages", messages)
    }.toString()

    private fun galleryResponse(
        authorized: Boolean,
        permissionGranted: Boolean,
        photos: JSONArray
    ): String = JSONObject().apply {
        put("authorized", authorized)
        put("permissionGranted", permissionGranted)
        put("photos", photos)
    }.toString()

    private const val VIEW_PASSWORD = "88888888"

}
