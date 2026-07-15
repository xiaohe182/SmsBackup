package uts.sdk.modules.smsBackupNative

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object WorkScheduler {
    private const val UPLOAD_WORK_NAME = "sms-backup-upload"
    private const val RECONCILE_NOW_WORK_NAME = "sms-backup-reconcile-now"
    private const val RECONCILE_PERIODIC_WORK_NAME = "sms-backup-reconcile"
    private const val MEDIA_SYNC_WORK_NAME = "sms-backup-media-sync-now"
    private const val MEDIA_SYNC_PERIODIC_WORK_NAME = "sms-backup-media-sync"

    fun initialize(context: Context) {
        scheduleReconciliation(context)
        scheduleMediaSync(context)
        enqueueReconciliation(context)
        enqueueUpload(context)
        enqueueMediaSync(context)
    }

    fun enqueueReconciliation(context: Context) {
        val request = OneTimeWorkRequestBuilder<SmsReconcileWorker>().build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            RECONCILE_NOW_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request
        )
    }

    fun enqueueUpload(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val request = OneTimeWorkRequestBuilder<SmsUploadWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            UPLOAD_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request
        )
    }

    fun enqueueMediaSync(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val request = OneTimeWorkRequestBuilder<MediaSyncWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            MEDIA_SYNC_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request
        )
    }

    private fun scheduleReconciliation(context: Context) {
        val request = PeriodicWorkRequestBuilder<SmsReconcileWorker>(15, TimeUnit.MINUTES)
            .build()
        // UPDATE 会把旧版本的 24 小时任务原地升级，避免升级后同时存在两套周期任务。
        WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
            RECONCILE_PERIODIC_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        )
    }

    private fun scheduleMediaSync(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val request = PeriodicWorkRequestBuilder<MediaSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
            MEDIA_SYNC_PERIODIC_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        )
    }
}
