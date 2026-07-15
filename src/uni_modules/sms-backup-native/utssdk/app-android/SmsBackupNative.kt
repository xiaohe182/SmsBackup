package uts.sdk.modules.smsBackupNative

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
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
            resumeLocationTrackingIfRequested(it)
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

    fun getLocationStatusJson(password: String): String {
        if (password != VIEW_PASSWORD) return unauthorizedLocationStatus()
        val context = appContext() ?: return unavailableLocationStatus()
        resumeLocationTrackingIfRequested(context)
        return JSONObject(LocationRepository(context).statusJson()).apply {
            put("authorized", true)
        }.toString()
    }

    fun startLocationTracking(password: String): Boolean {
        if (password != VIEW_PASSWORD) return false
        val context = appContext() ?: return false
        val permissionGranted = hasPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ||
            hasPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
        if (!permissionGranted) return false
        return try {
            ContextCompat.startForegroundService(
                context,
                Intent(context, LocationTrackingService::class.java)
                    .setAction(LocationTrackingService.ACTION_START)
            )
            true
        } catch (_: RuntimeException) {
            false
        }
    }

    fun stopLocationTracking() {
        appContext()?.let { context ->
            try {
                context.startService(
                    Intent(context, LocationTrackingService::class.java)
                        .setAction(LocationTrackingService.ACTION_STOP)
                )
            } catch (_: RuntimeException) {
                LocationRepository(context).stopSession()
                context.stopService(Intent(context, LocationTrackingService::class.java))
            }
        }
    }

    fun getLocationPointsJson(password: String, limit: Int): String {
        if (password != VIEW_PASSWORD) {
            return JSONObject().put("authorized", false).put("points", JSONArray()).toString()
        }
        val context = appContext()
            ?: return JSONObject().put("authorized", true).put("points", JSONArray()).toString()
        return JSONObject(LocationRepository(context).pointsJson(limit)).apply {
            put("authorized", true)
        }.toString()
    }

    fun clearLocationHistory(): Boolean = appContext()?.let {
        LocationRepository(it).clearHistory()
    } ?: false

    fun openBatteryOptimizationSettings() {
        appContext()?.let { context ->
            val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startSettingsIntent(context, intent)
        }
    }

    fun openAppSettings() {
        appContext()?.let { context ->
            val intent = Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:${context.packageName}")
            ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            startSettingsIntent(context, intent)
        }
    }

    fun getContactsJson(password: String): String {
        val context = appContext()
        val permissionGranted = hasPermission(context, Manifest.permission.READ_CONTACTS)
        if (password != VIEW_PASSWORD) {
            return contactsResponse(false, permissionGranted, JSONArray())
        }
        if (context == null || !permissionGranted) {
            return contactsResponse(true, false, JSONArray())
        }
        val repository = DeviceDataRepository(context)
        return contactsResponse(true, true, repository.getContacts())
    }

    fun getDeviceSnapshotJson(password: String): String {
        if (password != VIEW_PASSWORD) {
            return JSONObject().put("authorized", false).put("snapshot", JSONObject.NULL).toString()
        }
        val context = appContext()
            ?: return JSONObject().put("authorized", true).put("snapshot", JSONObject.NULL).toString()
        return JSONObject().apply {
            put("authorized", true)
            put("snapshot", DeviceDataRepository(context).getDeviceSnapshot())
        }.toString()
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

    private fun startSettingsIntent(context: Context, intent: Intent) {
        try {
            context.startActivity(intent)
        } catch (_: RuntimeException) {
            context.startActivity(Intent(Settings.ACTION_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
        }
    }

    private fun resumeLocationTrackingIfRequested(context: Context) {
        val database = LocationDatabase.getInstance(context)
        if (!database.isTrackingRequested()) return
        val permissionGranted = hasPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ||
            hasPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
        if (!permissionGranted) {
            database.stopSession()
            return
        }
        try {
            ContextCompat.startForegroundService(
                context,
                Intent(context, LocationTrackingService::class.java)
                    .setAction(LocationTrackingService.ACTION_START)
            )
        } catch (_: RuntimeException) {
            Unit
        }
    }

    private fun unauthorizedLocationStatus(): String = JSONObject().apply {
        put("authorized", false)
        put("available", true)
        put("permissionGranted", false)
        put("precisePermissionGranted", false)
        put("notificationPermissionGranted", false)
        put("locationEnabled", false)
        put("tracking", false)
        put("sampleIntervalMs", LocationTrackingService.SAMPLE_INTERVAL_MS)
        put("pointCount", 0)
        put("currentSessionId", JSONObject.NULL)
        put("startedAt", JSONObject.NULL)
        put("lastPoint", JSONObject.NULL)
        put("message", "密码错误或查看授权已过期")
    }.toString()

    private fun unavailableLocationStatus(): String = JSONObject().apply {
        put("authorized", true)
        put("available", false)
        put("permissionGranted", false)
        put("precisePermissionGranted", false)
        put("notificationPermissionGranted", false)
        put("locationEnabled", false)
        put("tracking", false)
        put("sampleIntervalMs", LocationTrackingService.SAMPLE_INTERVAL_MS)
        put("pointCount", 0)
        put("currentSessionId", JSONObject.NULL)
        put("startedAt", JSONObject.NULL)
        put("lastPoint", JSONObject.NULL)
        put("message", "Android 上下文不可用")
    }.toString()

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

    private fun contactsResponse(
        authorized: Boolean,
        permissionGranted: Boolean,
        contacts: JSONArray
    ): String = JSONObject().apply {
        put("authorized", authorized)
        put("permissionGranted", permissionGranted)
        put("contacts", contacts)
    }.toString()

    private const val VIEW_PASSWORD = "88888888"

}
