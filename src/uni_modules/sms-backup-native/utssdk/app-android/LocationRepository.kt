package uts.sdk.modules.smsBackupNative

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

class LocationRepository(private val context: Context) {
    private val database = LocationDatabase.getInstance(context)

    fun startOrResumeSession(): String = database.startOrResumeSession()

    fun stopSession() = database.stopSession()

    fun record(sessionId: String, location: Location): Long =
        database.insertPoint(sessionId, location)

    fun lastPoint(): StoredLocationPoint? = database.getLastPoint()

    fun clearHistory(): Boolean = database.clearHistory()

    fun statusJson(): String {
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val coarseGranted = hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
        val fineGranted = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
        val notificationGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            hasPermission(Manifest.permission.POST_NOTIFICATIONS)
        val lastPoint = database.getLastPoint()
        return JSONObject().apply {
            put("available", true)
            put("permissionGranted", coarseGranted || fineGranted)
            put("precisePermissionGranted", fineGranted)
            put("notificationPermissionGranted", notificationGranted)
            put("locationEnabled", isLocationEnabled(locationManager))
            put("tracking", database.isTrackingRequested())
            put("sampleIntervalMs", LocationTrackingService.SAMPLE_INTERVAL_MS)
            put("pointCount", database.pointCount())
            put("currentSessionId", database.activeSessionId() ?: JSONObject.NULL)
            put("startedAt", database.activeSessionStartedAt() ?: JSONObject.NULL)
            put("lastPoint", lastPoint?.toJson() ?: JSONObject.NULL)
            put("message", statusMessage(coarseGranted || fineGranted, isLocationEnabled(locationManager)))
        }.toString()
    }

    fun pointsJson(limit: Int): String = JSONObject().apply {
        put("points", JSONArray().apply {
            database.getPoints(limit).asReversed().forEach { put(it.toJson()) }
        })
    }.toString()

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    @Suppress("DEPRECATION")
    private fun isLocationEnabled(locationManager: LocationManager): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            locationManager.isLocationEnabled
        } else {
            locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        }

    private fun statusMessage(permissionGranted: Boolean, locationEnabled: Boolean): String = when {
        !permissionGranted -> "请先授予位置权限"
        !locationEnabled -> "请打开系统定位服务"
        database.isTrackingRequested() -> "正在记录轨迹"
        else -> "轨迹记录未启动"
    }

    private fun StoredLocationPoint.toJson(): JSONObject = JSONObject().apply {
        put("id", id.toString())
        put("sessionId", sessionId)
        put("capturedAt", capturedAt)
        put("latitude", latitude)
        put("longitude", longitude)
        put("accuracy", accuracy.toDouble())
        put("altitude", altitude ?: JSONObject.NULL)
        put("speed", speed?.toDouble() ?: JSONObject.NULL)
        put("bearing", bearing?.toDouble() ?: JSONObject.NULL)
        put("provider", provider)
    }
}
