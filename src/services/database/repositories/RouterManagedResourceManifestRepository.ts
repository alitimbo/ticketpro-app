import type {
  RouterManagedResourceManifestRecord,
  RouterManagedResourceManifestStatus
} from "../../../domain/database";
import type { RouterManagedResourceManifest } from "../../../domain/router";
import type { DatabaseClient } from "../DatabaseClient";

export type StoredRouterManagedResourceManifest = {
  manifest: RouterManagedResourceManifest;
  record: RouterManagedResourceManifestRecord;
};

/**
 * Persists the latest secret-free RouterOS ownership observation per router.
 * Each successful observation increments a monotonic local revision.
 */
export class RouterManagedResourceManifestRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findByRouter(routerId: string): Promise<StoredRouterManagedResourceManifest | null> {
    const rows = await this.database.query<RouterManagedResourceManifestRecord>(
      "SELECT * FROM router_managed_resource_manifests WHERE router_id = ?1",
      [routerId]
    );
    const record = rows[0];
    if (!record) return null;
    return {
      manifest: parseManifest(record),
      record: { ...record }
    };
  }

  async save(
    accountId: string,
    routerId: string,
    manifest: RouterManagedResourceManifest
  ): Promise<StoredRouterManagedResourceManifest> {
    const existing = await this.findByRouter(routerId);
    const now = new Date().toISOString();
    const revision = (existing?.record.revision ?? 0) + 1;
    const status = manifest.resources.some((resource) => resource.state !== "present")
      ? "drift"
      : "synced";
    const desiredJson = JSON.stringify(manifest.desired);
    const observedJson = JSON.stringify({
      resources: manifest.resources,
      routerOsVersion: manifest.routerOsVersion
    });
    const warningsJson = JSON.stringify(manifest.warnings);

    if (existing) {
      await this.database.execute(
        `UPDATE router_managed_resource_manifests SET
          account_id = ?1, schema_version = ?2, revision = ?3, status = ?4,
          desired_json = ?5, observed_json = ?6, warnings_json = ?7,
          last_error = ?8, observed_at = ?9, updated_at = ?10
        WHERE router_id = ?11`,
        [
          accountId,
          manifest.schemaVersion,
          revision,
          status,
          desiredJson,
          observedJson,
          warningsJson,
          null,
          manifest.capturedAt,
          now,
          routerId
        ]
      );
    } else {
      await this.database.execute(
        `INSERT INTO router_managed_resource_manifests (
          router_id, account_id, schema_version, revision, status,
          desired_json, observed_json, warnings_json, last_error,
          observed_at, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        [
          routerId,
          accountId,
          manifest.schemaVersion,
          revision,
          status,
          desiredJson,
          observedJson,
          warningsJson,
          null,
          manifest.capturedAt,
          now,
          now
        ]
      );
    }

    const saved = await this.findByRouter(routerId);
    if (!saved) throw new Error("Le manifeste RouterOS n'a pas pu être enregistré.");
    return saved;
  }

  async markError(accountId: string, routerId: string, error: unknown): Promise<void> {
    const existing = await this.findByRouter(routerId);
    if (!existing) return;
    const now = new Date().toISOString();
    const message = sanitizeError(error);
    await this.database.execute(
      `UPDATE router_managed_resource_manifests SET
        account_id = ?1, revision = ?2, status = ?3, last_error = ?4,
        updated_at = ?5
      WHERE router_id = ?6`,
      [accountId, existing.record.revision + 1, "error", message, now, routerId]
    );
  }
}

function parseManifest(record: RouterManagedResourceManifestRecord): RouterManagedResourceManifest {
  const desired = JSON.parse(record.desired_json) as RouterManagedResourceManifest["desired"];
  const observed = JSON.parse(record.observed_json) as Pick<
    RouterManagedResourceManifest,
    "resources" | "routerOsVersion"
  >;
  const warnings = JSON.parse(record.warnings_json) as string[];
  return {
    capturedAt: record.observed_at,
    desired,
    resources: observed.resources,
    routerOsVersion: observed.routerOsVersion,
    schemaVersion: 1,
    warnings
  };
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 300);
}

export function manifestStatus(
  manifest: RouterManagedResourceManifest
): RouterManagedResourceManifestStatus {
  return manifest.resources.some((resource) => resource.state !== "present")
    ? "drift"
    : "synced";
}
