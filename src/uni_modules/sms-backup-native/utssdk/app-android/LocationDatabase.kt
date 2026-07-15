package uts.sdk.modules.smsBackupNative

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.location.Location
import java.util.UUID

data class StoredLocationPoint(
    val id: Long,
    val sessionId: String,
    val capturedAt: Long,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float,
    val altitude: Double?,
    val speed: Float?,
    val bearing: Float?,
    val provider: String
)

class LocationDatabase private constructor(context: Context) :
    SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    override fun onConfigure(database: SQLiteDatabase) {
        database.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(database: SQLiteDatabase) {
        database.execSQL(
            """
            CREATE TABLE route_sessions (
                session_id TEXT PRIMARY KEY,
                started_at INTEGER NOT NULL,
                stopped_at INTEGER
            )
            """.trimIndent()
        )
        database.execSQL(
            """
            CREATE TABLE location_points (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                captured_at INTEGER NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                accuracy REAL NOT NULL,
                altitude REAL,
                speed REAL,
                bearing REAL,
                provider TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES route_sessions(session_id) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        database.execSQL(
            "CREATE TABLE location_metadata (meta_key TEXT PRIMARY KEY, meta_value TEXT NOT NULL)"
        )
        database.execSQL(
            "CREATE INDEX idx_location_points_time ON location_points(captured_at DESC)"
        )
        database.execSQL(
            "CREATE INDEX idx_location_points_session ON location_points(session_id, captured_at)"
        )
    }

    override fun onUpgrade(database: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    @Synchronized
    fun startOrResumeSession(now: Long = System.currentTimeMillis()): String {
        activeSessionId()?.let { return it }
        val sessionId = UUID.randomUUID().toString()
        writableDatabase.beginTransaction()
        try {
            writableDatabase.insertOrThrow("route_sessions", null, ContentValues().apply {
                put("session_id", sessionId)
                put("started_at", now)
            })
            putMetadataInternal(writableDatabase, KEY_ACTIVE_SESSION_ID, sessionId)
            putMetadataInternal(writableDatabase, KEY_TRACKING_REQUESTED, "1")
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
        return sessionId
    }

    @Synchronized
    fun stopSession(now: Long = System.currentTimeMillis()) {
        val sessionId = activeSessionId()
        writableDatabase.beginTransaction()
        try {
            if (!sessionId.isNullOrBlank()) {
                writableDatabase.update(
                    "route_sessions",
                    ContentValues().apply { put("stopped_at", now) },
                    "session_id = ?",
                    arrayOf(sessionId)
                )
            }
            writableDatabase.delete(
                "location_metadata",
                "meta_key IN (?, ?)",
                arrayOf(KEY_ACTIVE_SESSION_ID, KEY_TRACKING_REQUESTED)
            )
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    fun isTrackingRequested(): Boolean = getMetadata(KEY_TRACKING_REQUESTED) == "1"

    fun activeSessionId(): String? = getMetadata(KEY_ACTIVE_SESSION_ID)

    fun activeSessionStartedAt(): Long? {
        val sessionId = activeSessionId() ?: return null
        readableDatabase.query(
            "route_sessions",
            arrayOf("started_at"),
            "session_id = ?",
            arrayOf(sessionId),
            null,
            null,
            null
        ).use { cursor -> return if (cursor.moveToFirst()) cursor.getLong(0) else null }
    }

    @Synchronized
    fun insertPoint(sessionId: String, location: Location): Long {
        val capturedAt = location.time.takeIf { it > 0 } ?: System.currentTimeMillis()
        return writableDatabase.insertOrThrow("location_points", null, ContentValues().apply {
            put("session_id", sessionId)
            put("captured_at", capturedAt)
            put("latitude", location.latitude)
            put("longitude", location.longitude)
            put("accuracy", location.accuracy)
            if (location.hasAltitude()) put("altitude", location.altitude) else putNull("altitude")
            if (location.hasSpeed()) put("speed", location.speed) else putNull("speed")
            if (location.hasBearing()) put("bearing", location.bearing) else putNull("bearing")
            put("provider", location.provider.orEmpty())
        })
    }

    fun getLastPoint(): StoredLocationPoint? {
        readableDatabase.query(
            "location_points",
            POINT_COLUMNS,
            null,
            null,
            null,
            null,
            "captured_at DESC, id DESC",
            "1"
        ).use { cursor -> return if (cursor.moveToFirst()) cursor.toPoint() else null }
    }

    fun getPoints(limit: Int): List<StoredLocationPoint> {
        val points = mutableListOf<StoredLocationPoint>()
        readableDatabase.query(
            "location_points",
            POINT_COLUMNS,
            null,
            null,
            null,
            null,
            "captured_at DESC, id DESC",
            limit.coerceIn(1, 20_000).toString()
        ).use { cursor -> while (cursor.moveToNext()) points += cursor.toPoint() }
        return points
    }

    fun pointCount(): Int {
        readableDatabase.rawQuery("SELECT COUNT(*) FROM location_points", null).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
    }

    @Synchronized
    fun clearHistory(): Boolean {
        if (isTrackingRequested()) return false
        writableDatabase.beginTransaction()
        return try {
            writableDatabase.delete("location_points", null, null)
            writableDatabase.delete("route_sessions", null, null)
            writableDatabase.delete("location_metadata", null, null)
            writableDatabase.setTransactionSuccessful()
            true
        } finally {
            writableDatabase.endTransaction()
        }
    }

    private fun getMetadata(key: String): String? {
        readableDatabase.query(
            "location_metadata",
            arrayOf("meta_value"),
            "meta_key = ?",
            arrayOf(key),
            null,
            null,
            null
        ).use { cursor -> return if (cursor.moveToFirst()) cursor.getString(0) else null }
    }

    private fun putMetadataInternal(database: SQLiteDatabase, key: String, value: String) {
        database.insertWithOnConflict(
            "location_metadata",
            null,
            ContentValues().apply {
                put("meta_key", key)
                put("meta_value", value)
            },
            SQLiteDatabase.CONFLICT_REPLACE
        )
    }

    private fun Cursor.toPoint(): StoredLocationPoint = StoredLocationPoint(
        id = getLong(getColumnIndexOrThrow("id")),
        sessionId = getString(getColumnIndexOrThrow("session_id")),
        capturedAt = getLong(getColumnIndexOrThrow("captured_at")),
        latitude = getDouble(getColumnIndexOrThrow("latitude")),
        longitude = getDouble(getColumnIndexOrThrow("longitude")),
        accuracy = getFloat(getColumnIndexOrThrow("accuracy")),
        altitude = nullableDouble("altitude"),
        speed = nullableFloat("speed"),
        bearing = nullableFloat("bearing"),
        provider = getString(getColumnIndexOrThrow("provider"))
    )

    private fun Cursor.nullableDouble(column: String): Double? {
        val index = getColumnIndexOrThrow(column)
        return if (isNull(index)) null else getDouble(index)
    }

    private fun Cursor.nullableFloat(column: String): Float? {
        val index = getColumnIndexOrThrow(column)
        return if (isNull(index)) null else getFloat(index)
    }

    companion object {
        private const val DATABASE_NAME = "location_tracking.db"
        private const val DATABASE_VERSION = 1
        private const val KEY_ACTIVE_SESSION_ID = "active_session_id"
        private const val KEY_TRACKING_REQUESTED = "tracking_requested"
        private val POINT_COLUMNS = arrayOf(
            "id", "session_id", "captured_at", "latitude", "longitude", "accuracy",
            "altitude", "speed", "bearing", "provider"
        )

        @Volatile
        private var instance: LocationDatabase? = null

        fun getInstance(context: Context): LocationDatabase =
            instance ?: synchronized(this) {
                instance ?: LocationDatabase(context.applicationContext).also { instance = it }
            }
    }
}
