package uts.sdk.modules.smsBackupNative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.telephony.SubscriptionManager

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val pendingResult = goAsync()
        Thread {
            try {
                val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
                if (messages.isEmpty()) return@Thread
                val sender = messages.first().displayOriginatingAddress.orEmpty()
                val body = messages.joinToString(separator = "") { it.displayMessageBody.orEmpty() }
                val timestamp = messages.first().timestampMillis
                val subscriptionId = intent.getIntExtra(
                    SubscriptionManager.EXTRA_SUBSCRIPTION_INDEX,
                    -1
                ).takeIf { it >= 0 }
                val queued = SmsRepository(context.applicationContext).queueIncoming(
                    sender = sender,
                    body = body,
                    timestamp = timestamp,
                    simSubscriptionId = subscriptionId
                )
                if (queued) {
                    WorkScheduler.enqueueUpload(context.applicationContext)
                }
            } finally {
                pendingResult.finish()
            }
        }.start()
    }
}
