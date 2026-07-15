package uts.sdk.modules.smsBackupNative

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.PhoneNumberUtils
import androidx.core.content.ContextCompat
import android.provider.ContactsContract.CommonDataKinds.Phone
import org.json.JSONObject
import java.util.Locale

data class ResolvedSmsContact(
    val key: String,
    val displayName: String?,
    val phoneNumber: String,
    val phoneLabel: String?,
    val avatarUri: String?,
    val isResolved: Boolean
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("key", key)
        put("displayName", displayName ?: JSONObject.NULL)
        put("phoneNumber", phoneNumber)
        put("phoneLabel", phoneLabel ?: JSONObject.NULL)
        put("avatarUri", avatarUri ?: JSONObject.NULL)
        put("isResolved", isResolved)
    }
}

class SmsContactResolver(private val context: Context) {
    fun hasPermission(): Boolean = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.READ_CONTACTS
    ) == PackageManager.PERMISSION_GRANTED

    fun loadContacts(): Map<String, ResolvedSmsContact> {
        if (!hasPermission()) return emptyMap()

        val contacts = linkedMapOf<String, ResolvedSmsContact>()
        val projection = arrayOf(
            Phone.NUMBER,
            Phone.NORMALIZED_NUMBER,
            Phone.DISPLAY_NAME,
            Phone.TYPE,
            Phone.LABEL,
            Phone.PHOTO_THUMBNAIL_URI
        )
        context.contentResolver.query(
            Phone.CONTENT_URI,
            projection,
            null,
            null,
            "${Phone.DISPLAY_NAME} COLLATE LOCALIZED ASC"
        )?.use { cursor ->
            val numberIndex = cursor.getColumnIndex(Phone.NUMBER)
            val normalizedIndex = cursor.getColumnIndex(Phone.NORMALIZED_NUMBER)
            val nameIndex = cursor.getColumnIndex(Phone.DISPLAY_NAME)
            val typeIndex = cursor.getColumnIndex(Phone.TYPE)
            val labelIndex = cursor.getColumnIndex(Phone.LABEL)
            val photoIndex = cursor.getColumnIndex(Phone.PHOTO_THUMBNAIL_URI)
            while (cursor.moveToNext()) {
                val number = if (numberIndex >= 0) cursor.getString(numberIndex).orEmpty() else ""
                if (number.isBlank()) continue
                val normalized = if (normalizedIndex >= 0) {
                    cursor.getString(normalizedIndex).orEmpty()
                } else ""
                val displayName = if (nameIndex >= 0) cursor.getString(nameIndex) else null
                val customLabel = if (labelIndex >= 0) cursor.getString(labelIndex) else null
                val type = if (typeIndex >= 0) cursor.getInt(typeIndex) else Phone.TYPE_OTHER
                val contact = ResolvedSmsContact(
                    key = "contact:${canonicalNumber(normalized.ifBlank { number })}",
                    displayName = displayName,
                    phoneNumber = number,
                    phoneLabel = Phone.getTypeLabel(context.resources, type, customLabel).toString(),
                    avatarUri = if (photoIndex >= 0) cursor.getString(photoIndex) else null,
                    isResolved = true
                )
                lookupKeys(number, normalized).forEach { key -> contacts.putIfAbsent(key, contact) }
            }
        }
        return contacts
    }

    fun resolve(
        address: String,
        contacts: Map<String, ResolvedSmsContact>
    ): ResolvedSmsContact {
        lookupKeys(address).forEach { key -> contacts[key]?.let { return it } }
        val phoneNumber = address.trim().ifBlank { "未知号码" }
        return ResolvedSmsContact(
            key = "number:${canonicalNumber(phoneNumber)}",
            displayName = null,
            phoneNumber = phoneNumber,
            phoneLabel = null,
            avatarUri = null,
            isResolved = false
        )
    }

    /**
     * 联系人和短信 Provider 对中国区号的保存方式可能不同，同时保留完整号码和去掉 +86/86 的别名，
     * 只用于当前查看会话匹配，不写数据库，也不会进入上传内容。
     */
    private fun lookupKeys(number: String, providerNormalized: String = ""): Set<String> {
        val keys = linkedSetOf<String>()
        listOf(providerNormalized, number).forEach { candidate ->
            val canonical = canonicalNumber(candidate)
            if (canonical.isNotBlank()) {
                keys += canonical
                if (canonical.startsWith("+86") && canonical.length > 3) keys += canonical.drop(3)
                if (canonical.startsWith("86") && canonical.length == 13) keys += canonical.drop(2)
            }
        }
        return keys
    }

    private fun canonicalNumber(number: String): String {
        val normalized = PhoneNumberUtils.normalizeNumber(number)
        return normalized.ifBlank { number.trim().lowercase(Locale.ROOT) }
    }
}
