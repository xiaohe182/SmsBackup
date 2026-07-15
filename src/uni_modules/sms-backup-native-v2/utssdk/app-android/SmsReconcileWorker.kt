package uts.sdk.modules.smsBackupNativeV2

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

class SmsReconcileWorker(
    context: Context,
    parameters: WorkerParameters
) : Worker(context, parameters) {
    override fun doWork(): Result = try {
        val repository = SmsRepository(applicationContext)
        if (repository.hasReadPermission()) {
            repository.scanExistingMessages()
            WorkScheduler.enqueueUpload(applicationContext)
        }
        Result.success()
    } catch (_: Exception) {
        Result.retry()
    }
}
