package uts.sdk.modules.smsBackupNative

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.provider.ContactsContract
import org.json.JSONArray
import org.json.JSONObject

class DeviceDataRepository(private val context: Context) {
    fun getContacts(): JSONArray {
        val contacts = JSONArray()
        val seen = mutableSetOf<String>()
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.NORMALIZED_NUMBER,
            ContactsContract.CommonDataKinds.Phone.PHOTO_URI
        )
        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            projection,
            null,
            null,
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} COLLATE LOCALIZED ASC"
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)
            val nameIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
            val numberIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)
            val normalizedIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NORMALIZED_NUMBER)
            val photoIndex = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.PHOTO_URI)
            while (cursor.moveToNext()) {
                val contactId = cursor.getLong(idIndex).toString()
                val number = cursor.getString(numberIndex).orEmpty().trim()
                val dedupeKey = "$contactId:${number.filterNot { it.isWhitespace() }}"
                if (number.isBlank() || !seen.add(dedupeKey)) continue
                contacts.put(JSONObject().apply {
                    put("contactId", contactId)
                    put("displayName", cursor.getString(nameIndex).orEmpty().ifBlank { number })
                    put("phoneNumber", number)
                    put("normalizedNumber", cursor.nullableString(normalizedIndex))
                    put("photoUri", cursor.nullableString(photoIndex))
                })
            }
        }
        return contacts
    }

    fun getDeviceSnapshot(): JSONObject {
        val batteryIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val memoryInfo = ActivityManager.MemoryInfo().also {
            (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(it)
        }
        val storageStats = StatFs(Environment.getDataDirectory().absolutePath)
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val capabilities = connectivityManager.getNetworkCapabilities(connectivityManager.activeNetwork)
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val batteryLevel = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val batteryScale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val status = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, BatteryManager.BATTERY_STATUS_UNKNOWN)
            ?: BatteryManager.BATTERY_STATUS_UNKNOWN
        return JSONObject().apply {
            put("manufacturer", Build.MANUFACTURER.orEmpty())
            put("model", Build.MODEL.orEmpty())
            put("androidVersion", Build.VERSION.RELEASE.orEmpty())
            put("apiLevel", Build.VERSION.SDK_INT)
            put("batteryLevel", if (batteryLevel >= 0 && batteryScale > 0) batteryLevel * 100 / batteryScale else -1)
            put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL)
            put("batteryStatus", batteryStatus(status))
            put("batteryHealth", batteryHealth(batteryIntent?.getIntExtra(
                BatteryManager.EXTRA_HEALTH,
                BatteryManager.BATTERY_HEALTH_UNKNOWN
            ) ?: BatteryManager.BATTERY_HEALTH_UNKNOWN))
            putNullableNumber("batteryTemperatureCelsius", batteryIntent?.getIntExtra(
                BatteryManager.EXTRA_TEMPERATURE,
                Int.MIN_VALUE
            )?.takeUnless { it == Int.MIN_VALUE }?.div(10.0))
            putNullableNumber("batteryVoltageMillivolts", batteryIntent?.getIntExtra(
                BatteryManager.EXTRA_VOLTAGE,
                Int.MIN_VALUE
            )?.takeUnless { it == Int.MIN_VALUE })
            put("batteryTechnology", batteryIntent?.getStringExtra(BatteryManager.EXTRA_TECHNOLOGY) ?: JSONObject.NULL)
            put("memoryTotalBytes", memoryInfo.totalMem)
            put("memoryAvailableBytes", memoryInfo.availMem)
            put("storageTotalBytes", storageStats.totalBytes)
            put("storageAvailableBytes", storageStats.availableBytes)
            put("networkConnected", capabilities != null)
            put("networkTransport", networkTransport(capabilities))
            put("ignoringBatteryOptimizations", powerManager.isIgnoringBatteryOptimizations(context.packageName))
            put("capturedAt", System.currentTimeMillis())
        }
    }

    private fun networkTransport(capabilities: NetworkCapabilities?): String = when {
        capabilities == null -> "none"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) -> "bluetooth"
        else -> "other"
    }

    private fun batteryStatus(value: Int): String = when (value) {
        BatteryManager.BATTERY_STATUS_CHARGING -> "charging"
        BatteryManager.BATTERY_STATUS_DISCHARGING -> "discharging"
        BatteryManager.BATTERY_STATUS_FULL -> "full"
        BatteryManager.BATTERY_STATUS_NOT_CHARGING -> "not_charging"
        else -> "unknown"
    }

    private fun batteryHealth(value: Int): String = when (value) {
        BatteryManager.BATTERY_HEALTH_GOOD -> "good"
        BatteryManager.BATTERY_HEALTH_OVERHEAT -> "overheat"
        BatteryManager.BATTERY_HEALTH_DEAD -> "dead"
        BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "over_voltage"
        BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE -> "failure"
        BatteryManager.BATTERY_HEALTH_COLD -> "cold"
        else -> "unknown"
    }

    private fun JSONObject.putNullableNumber(key: String, value: Number?) {
        put(key, value ?: JSONObject.NULL)
    }

    private fun android.database.Cursor.nullableString(index: Int): Any =
        if (isNull(index)) JSONObject.NULL else getString(index)
}
