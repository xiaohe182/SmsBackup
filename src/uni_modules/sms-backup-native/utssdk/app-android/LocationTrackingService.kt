package uts.sdk.modules.smsBackupNative

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class LocationTrackingService : Service(), LocationListener {
    private lateinit var repository: LocationRepository
    private lateinit var locationManager: LocationManager
    private var sessionId: String? = null
    private var lastSavedAt = 0L

    override fun onCreate() {
        super.onCreate()
        repository = LocationRepository(applicationContext)
        locationManager = getSystemService(LOCATION_SERVICE) as LocationManager
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopTracking()
            return START_NOT_STICKY
        }
        showForegroundNotification()
        sessionId = repository.startOrResumeSession()
        val previousPoint = repository.lastPoint()
        lastSavedAt = if (previousPoint?.sessionId == sessionId) previousPoint.capturedAt else 0L
        requestLocationUpdates()
        return START_STICKY
    }

    override fun onLocationChanged(location: Location) {
        if (location.latitude !in -90.0..90.0 || location.longitude !in -180.0..180.0) return
        val capturedAt = location.time.takeIf { it > 0 } ?: System.currentTimeMillis()
        if (lastSavedAt == 0L || capturedAt - lastSavedAt >= SAMPLE_INTERVAL_MS) {
            persistLocation(location, capturedAt)
        }
    }

    override fun onProviderEnabled(provider: String) = Unit

    override fun onProviderDisabled(provider: String) = Unit

    @Deprecated("Deprecated in Android")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    override fun onDestroy() {
        locationManager.removeUpdates(this)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun persistLocation(location: Location, fallbackTime: Long) {
        val activeSessionId = sessionId ?: return
        val point = Location(location)
        if (point.time <= 0) point.time = fallbackTime
        repository.record(activeSessionId, point)
        lastSavedAt = point.time
    }

    private fun requestLocationUpdates() {
        val fineGranted = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
        val coarseGranted = hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
        if (!fineGranted && !coarseGranted) {
            stopTracking()
            return
        }
        try {
            locationManager.removeUpdates(this)
            if (fineGranted && locationManager.allProviders.contains(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    CANDIDATE_INTERVAL_MS,
                    0f,
                    this,
                    Looper.getMainLooper()
                )
            }
            if (locationManager.allProviders.contains(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    CANDIDATE_INTERVAL_MS,
                    0f,
                    this,
                    Looper.getMainLooper()
                )
            }
        } catch (_: SecurityException) {
            stopTracking()
        } catch (_: IllegalArgumentException) {
            stopTracking()
        }
    }

    private fun stopTracking() {
        locationManager.removeUpdates(this)
        repository.stopSession()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    private fun showForegroundNotification() {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.ic_menu_mylocation)
            .setContentTitle("SmsBackup 正在记录位置")
            .setContentText("每 3 分钟保存一次轨迹点，点击停止可立即锁定记录")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(0, "停止记录", stopPendingIntent())
            .apply {
                packageManager.getLaunchIntentForPackage(packageName)?.let { launchIntent ->
                    setContentIntent(PendingIntent.getActivity(
                        this@LocationTrackingService,
                        0,
                        launchIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    ))
                }
            }
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun stopPendingIntent(): PendingIntent = PendingIntent.getService(
        this,
        1,
        Intent(this, LocationTrackingService::class.java).setAction(ACTION_STOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    private fun createNotificationChannel() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(
            CHANNEL_ID,
            "位置轨迹记录",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "显示持续位置记录状态和停止操作"
            setShowBadge(false)
        })
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    companion object {
        const val SAMPLE_INTERVAL_MS = 180_000L
        private const val CANDIDATE_INTERVAL_MS = 30_000L
        private const val CHANNEL_ID = "sms_backup_location_tracking"
        private const val NOTIFICATION_ID = 18201
        const val ACTION_START = "uts.sdk.modules.smsBackupNative.action.START_LOCATION"
        const val ACTION_STOP = "uts.sdk.modules.smsBackupNative.action.STOP_LOCATION"
    }
}
