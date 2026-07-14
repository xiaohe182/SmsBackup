package uts.sdk.modules.smsBackupNative

import org.json.JSONArray
import java.util.Locale

object SmsFilter {
    private val defaultRules = listOf(
        BlacklistRule("sender-taobao", "sender", "淘宝", true),
        BlacklistRule("sender-pinduoduo", "sender", "拼多多", true),
        BlacklistRule("body-unsubscribe", "body", "退订", true),
        BlacklistRule("body-promotion", "body", "促销", true),
        BlacklistRule("body-coupon", "body", "优惠券", true)
    )

    fun match(sender: String, body: String, rulesJson: String?): BlacklistRule? {
        val normalizedSender = sender.lowercase(Locale.ROOT)
        val normalizedBody = body.lowercase(Locale.ROOT)
        return parseRules(rulesJson).firstOrNull { rule ->
            if (!rule.enabled || rule.value.isBlank()) {
                false
            } else {
                val target = if (rule.kind == "sender") normalizedSender else normalizedBody
                target.contains(rule.value.trim().lowercase(Locale.ROOT))
            }
        }
    }

    private fun parseRules(rulesJson: String?): List<BlacklistRule> {
        if (rulesJson.isNullOrBlank()) return defaultRules
        return try {
            val array = JSONArray(rulesJson)
            buildList {
                for (index in 0 until array.length()) {
                    val item = array.optJSONObject(index) ?: continue
                    val kind = item.optString("kind")
                    val value = item.optString("value")
                    if ((kind == "sender" || kind == "body") && value.isNotBlank()) {
                        add(
                            BlacklistRule(
                                id = item.optString("id", "rule-$index"),
                                kind = kind,
                                value = value,
                                enabled = item.optBoolean("enabled", true)
                            )
                        )
                    }
                }
            }
        } catch (_: Exception) {
            defaultRules
        }
    }
}
