package uts.sdk.modules.smsBackupNative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (
            intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) return

        // WorkManager 使用唯一任务；开机和应用升级连续触发时也不会并发重复扫描。
        WorkScheduler.initialize(context.applicationContext)
    }
}
