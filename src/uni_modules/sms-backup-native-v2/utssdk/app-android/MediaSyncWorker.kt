package uts.sdk.modules.smsBackupNativeV2

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.Executors

class MediaSyncWorker(
    context: Context,
    parameters: WorkerParameters
) : Worker(context, parameters) {

    override fun doWork(): Result {
        val smsRepository = SmsRepository(applicationContext)
        val settings = MediaClientSettings.fromJson(smsRepository.getSettingsJson())
        if (!settings.syncEnabled || settings.serverUrl.isBlank()) return Result.success()
        if (settings.serverUrl.startsWith("http://") && !settings.allowInsecureHttp) {
            return Result.failure()
        }

        val client = MediaSyncClient(settings, applicationContext.contentResolver)
        val command = try {
            client.pollCommand(smsRepository.deviceId(), appVersionLabel(settings.deviceName))
        } catch (error: MediaSyncException) {
            smsRepository.recordMediaSyncStatus(MediaSyncResult(status = "failed", error = error.message))
            return if (error.retryable) Result.retry() else Result.failure()
        } catch (_: Exception) {
            return Result.retry()
        } ?: return Result.success()

        // 服务器动态下发 Wi-Fi 策略；领取指令后再判断，不能在 App 中写死网络类型。
        if (command.wifiOnly && isMeteredNetwork()) return Result.retry()

        return try {
            setForegroundAsync(createForegroundInfo(command)).get()
            executeCommand(command, client, smsRepository)
        } catch (error: MediaSyncException) {
            smsRepository.recordMediaSyncStatus(MediaSyncResult(status = "failed", error = error.message))
            if (error.retryable) Result.retry() else Result.failure()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    private fun executeCommand(
        command: MediaSyncCommand,
        client: MediaSyncClient,
        smsRepository: SmsRepository
    ): Result {
        val result = MediaSyncResult()
        result.smsQueued = smsRepository.scanExistingMessages()
        WorkScheduler.enqueueUpload(applicationContext)

        val mediaRepository = MediaSyncRepository(applicationContext)
        val permission = mediaRepository.permissionState()
        if (!permission.hasAnyAccess) {
            result.status = "partial"
            result.error = "相册未授权，短信已同步"
            client.complete(command, result)
            smsRepository.recordMediaSyncStatus(result)
            return Result.success()
        }
        if (permission.partialAccess) {
            result.status = "partial"
            result.error = "系统仅授予部分照片或视频权限"
        }

        var cursor: MediaManifestCursor? = null
        var retryRequired = false
        val executor = Executors.newFixedThreadPool(2)
        try {
            do {
                // 时间范围完全来自服务器命令，Android 不计算“最近七天”。
                if (command.windowStart < 0L || command.windowEnd < command.windowStart) {
                    throw MediaSyncException("invalid server media window", false)
                }
                val page = mediaRepository.page(command, cursor, MANIFEST_PAGE_SIZE)
                val manifest = client.submitManifest(command, page)
                if (manifest.rejectedCount > 0) {
                    result.status = "partial"
                    result.error = "部分相册媒体被服务器拒绝"
                }

                val localById = page.items.associateBy { it.mediaId }
                val futures = manifest.missing.mapNotNull { missing ->
                    val item = localById[missing.mediaId] ?: return@mapNotNull null
                    executor.submit<MediaUploadOutcome> {
                        try {
                            MediaUploadOutcome(
                                item = item,
                                uploadedBytes = client.uploadMedia(command.deviceId, item, missing),
                                error = null
                            )
                        } catch (error: MediaSyncException) {
                            MediaUploadOutcome(item, 0L, error)
                        } catch (error: Exception) {
                            MediaUploadOutcome(
                                item,
                                0L,
                                MediaSyncException(error.message ?: "media upload failed", true)
                            )
                        }
                    }
                }
                for (future in futures) {
                    val outcome = future.get()
                    val error = outcome.error
                    if (error != null) {
                        if (outcome.item.mediaType == "video") result.pendingVideoCount += 1
                        else result.pendingImageCount += 1
                        if (error.retryable) retryRequired = true
                        else {
                            result.status = "partial"
                            result.error = error.message
                        }
                    } else {
                        result.mediaBytesUploaded += outcome.uploadedBytes
                        if (outcome.item.mediaType == "video") result.videoUploaded += 1
                        else result.imageUploaded += 1
                    }
                }
                cursor = page.nextCursor
            } while (cursor != null)
        } finally {
            executor.shutdown()
        }

        if (retryRequired) {
            result.status = "pending"
            result.error = "部分媒体上传未完成，将自动重试"
            smsRepository.recordMediaSyncStatus(result)
            return Result.retry()
        }
        client.complete(command, result)
        // 必须等服务端写入完成事件后再更新本机成功状态，避免界面提前显示完成。
        smsRepository.recordMediaSyncStatus(result)
        return Result.success()
    }

    private fun createForegroundInfo(command: MediaSyncCommand): ForegroundInfo {
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    NOTIFICATION_CHANNEL_ID,
                    "短信与相册备份",
                    NotificationManager.IMPORTANCE_LOW
                ).apply { description = "正在按服务器时间范围备份短信、图片和视频" }
            )
        }
        val launchIntent = applicationContext.packageManager
            .getLaunchIntentForPackage(applicationContext.packageName)
        val pendingIntent = launchIntent?.let {
            PendingIntent.getActivity(
                applicationContext,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
        val notification = NotificationCompat.Builder(applicationContext, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(applicationContext.applicationInfo.icon)
            .setContentTitle("SmsBackup 正在同步")
            .setContentText("获取服务器指定的最近 ${command.lookbackHours} 小时相册")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(pendingIntent)
            .build()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    private fun isMeteredNetwork(): Boolean {
        val manager = applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE)
            as ConnectivityManager
        return manager.isActiveNetworkMetered
    }

    private fun appVersionLabel(fallback: String): String = try {
        val info = applicationContext.packageManager.getPackageInfo(applicationContext.packageName, 0)
        info.versionName ?: fallback
    } catch (_: Exception) {
        fallback
    }

    private data class MediaUploadOutcome(
        val item: MediaManifestItem,
        val uploadedBytes: Long,
        val error: MediaSyncException?
    )

    companion object {
        private const val MANIFEST_PAGE_SIZE = 100
        private const val NOTIFICATION_CHANNEL_ID = "sms_backup_media_sync"
        private const val NOTIFICATION_ID = 8848
    }
}
