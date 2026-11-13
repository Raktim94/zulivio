package com.nodedr.zulivio.data

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable

object OutboxState {
    const val PENDING = "PENDING"
    const val FAILED = "FAILED"
}

/**
 * An action the user took that has not reached the server yet. The row id is
 * also the request's Idempotency-Key, so a retry after a lost response can
 * never create a second note / call / follow-up. Everything describing the
 * action (lead names, note text, phone numbers) is inside [payloadEnc],
 * encrypted with the Keystore key; only bookkeeping is stored in clear.
 */
@Entity(tableName = "outbox")
data class OutboxItem(
    @PrimaryKey val id: String,
    val accountId: String,
    val kind: String,
    val payloadEnc: String,
    val state: String,
    val attempts: Int,
    val lastCode: String?,
    val lastError: String?,
    val createdAt: Long,
    val updatedAt: Long,
)

@Serializable data class OutboxPayload(
    val title: String,
    val leadId: String? = null,
    val method: String,
    val path: String,
    val body: String? = null,
)

@Dao interface OutboxDao {
    @Query("SELECT * FROM outbox WHERE accountId = :accountId ORDER BY createdAt ASC")
    fun observe(accountId: String): Flow<List<OutboxItem>>

    @Query("SELECT * FROM outbox WHERE accountId = :accountId AND state = 'PENDING' ORDER BY createdAt ASC")
    suspend fun pending(accountId: String): List<OutboxItem>

    @Query("SELECT * FROM outbox WHERE id = :id")
    suspend fun get(id: String): OutboxItem?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(item: OutboxItem)

    @Query("DELETE FROM outbox WHERE id = :id")
    suspend fun delete(id: String)

    @Query("DELETE FROM outbox WHERE accountId = :accountId")
    suspend fun deleteForAccount(accountId: String)

    @Query("DELETE FROM outbox")
    suspend fun deleteAll()
}

@Database(entities = [OutboxItem::class], version = 1, exportSchema = true)
abstract class AppDatabase : RoomDatabase() {
    abstract fun outbox(): OutboxDao
}
