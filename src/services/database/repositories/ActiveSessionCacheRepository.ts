import type { ActiveHotspotUser } from "../../../domain/router";
import type { ActiveSessionCacheRecord } from "../../../domain/database";
import type { DatabaseClient, DatabaseStatement } from "../DatabaseClient";

export class ActiveSessionCacheRepository {
  constructor(private readonly database: DatabaseClient) {}

  async replaceForRouter(routerId: string, activeUsers: ActiveHotspotUser[], cachedAt = new Date().toISOString()): Promise<void> {
    const statements: DatabaseStatement[] = [
      { params: [routerId], sql: "DELETE FROM active_sessions_cache WHERE router_id = ?1" },
      ...activeUsers.map((user) => ({
        params: [
          `${routerId}:${user.id}`,
          routerId,
          user.username,
          user.ipAddress,
          user.macAddress,
          user.uptime,
          user.sessionTimeLeft,
          user.downloadedBytes,
          user.uploadedBytes,
          cachedAt,
          "local"
        ],
        sql: `INSERT INTO active_sessions_cache (
          id, router_id, username, ip_address, mac_address, uptime, session_time_left,
          downloaded_bytes, uploaded_bytes, cached_at, sync_status
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
      }))
    ];

    await this.database.transaction(statements);
  }

  async listByRouter(routerId: string): Promise<ActiveSessionCacheRecord[]> {
    return this.database.query<ActiveSessionCacheRecord>(
      "SELECT * FROM active_sessions_cache WHERE router_id = ?1 AND deleted_at IS NULL ORDER BY cached_at DESC",
      [routerId]
    );
  }

  async removeByUsername(routerId: string, username: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM active_sessions_cache WHERE router_id = ?1 AND username = ?2",
      [routerId, username]
    );
  }
}
