import type {
  CreateHotspotPlanInput,
  HotspotPlanHistoryRecord,
  HotspotPlanRecord
} from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";

export type HotspotPlanMutationContext = {
  action?: HotspotPlanHistoryRecord["action"];
  actorProfileId?: string | null;
  source?: string;
};

export class HotspotPlanRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(
    input: CreateHotspotPlanInput,
    context: HotspotPlanMutationContext = {}
  ): Promise<HotspotPlanRecord> {
    const now = new Date().toISOString();
    const currency = normalizePlanCurrency(input.currency);
    const syncStatus = input.sync_status ?? "local";
    const createdBy = context.actorProfileId ?? input.created_by_profile_id ?? null;
    const updatedBy = context.actorProfileId ?? input.updated_by_profile_id ?? createdBy;
    const revision = Math.max(1, input.revision ?? 1);
    const createdAt = input.created_at ?? now;
    const updatedAt = input.updated_at ?? createdAt;
    const lastSyncedAt = input.last_synced_at ?? (syncStatus === "synced" ? now : null);

    await this.database.execute(
      `INSERT INTO hotspot_plans (
        id, router_id, name, duration_minutes, validity_minutes, data_limit_mb,
        download_limit, upload_limit, shared_users, price_hint, currency,
        mikrotik_id, mikrotik_profile_name, created_by_profile_id,
        updated_by_profile_id, revision, last_synced_at, status, sync_status,
        created_at, updated_at, deleted_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
        ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22
      )`,
      [
        input.id,
        input.router_id,
        input.name,
        input.duration_minutes,
        input.validity_minutes,
        input.data_limit_mb,
        input.download_limit,
        input.upload_limit,
        input.shared_users,
        input.price_hint,
        currency,
        normalizeOptionalText(input.mikrotik_id),
        normalizeOptionalText(input.mikrotik_profile_name),
        createdBy,
        updatedBy,
        revision,
        lastSyncedAt,
        input.status,
        syncStatus,
        createdAt,
        updatedAt,
        input.deleted_at ?? null
      ]
    );

    const created = await this.findById(input.id);
    if (!created) throw new Error("Le plan n'a pas pu être créé.");

    await this.appendHistory(created, context.action ?? "created", context);
    return created;
  }

  async findById(id: string): Promise<HotspotPlanRecord | null> {
    const rows = await this.database.query<HotspotPlanRecord>(
      "SELECT * FROM hotspot_plans WHERE id = ?1 AND deleted_at IS NULL",
      [id]
    );
    return rows[0] ?? null;
  }

  async listByRouter(routerId: string): Promise<HotspotPlanRecord[]> {
    return this.database.query<HotspotPlanRecord>(
      "SELECT * FROM hotspot_plans WHERE router_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [routerId]
    );
  }

  async listHistory(planId: string): Promise<HotspotPlanHistoryRecord[]> {
    return this.database.query<HotspotPlanHistoryRecord>(
      "SELECT * FROM hotspot_plan_history WHERE plan_id = ?1 ORDER BY revision DESC, created_at DESC",
      [planId]
    );
  }

  async update(
    input: CreateHotspotPlanInput,
    context: HotspotPlanMutationContext = {}
  ): Promise<HotspotPlanRecord> {
    const before = await this.findById(input.id);
    if (!before) throw new Error("Le plan à modifier est introuvable.");

    const now = new Date().toISOString();
    const currency = normalizePlanCurrency(input.currency ?? before.currency);
    const mikrotikId = normalizeOptionalText(input.mikrotik_id ?? before.mikrotik_id);
    const profileName = normalizeOptionalText(input.mikrotik_profile_name);
    const materialChange = hasMaterialPlanChange(before, {
      ...input,
      currency,
      mikrotik_id: mikrotikId,
      mikrotik_profile_name: profileName
    });
    const nextLocalRevision = before.revision + (materialChange ? 1 : 0);
    const revision = context.action === "restored"
      ? Math.max(nextLocalRevision, input.revision ?? 1)
      : nextLocalRevision;
    const actorProfileId = context.actorProfileId ?? input.updated_by_profile_id ?? before.updated_by_profile_id;
    const syncStatus = input.sync_status ?? before.sync_status;
    const lastSyncedAt = input.last_synced_at
      ?? (syncStatus === "synced" ? now : before.last_synced_at);

    await this.database.execute(
      `UPDATE hotspot_plans SET
        name = ?1, duration_minutes = ?2, validity_minutes = ?3, data_limit_mb = ?4,
        download_limit = ?5, upload_limit = ?6, shared_users = ?7, price_hint = ?8,
        currency = ?9, mikrotik_id = ?10, mikrotik_profile_name = ?11,
        updated_by_profile_id = ?12, revision = ?13, last_synced_at = ?14,
        status = ?15, sync_status = ?16, updated_at = ?17
      WHERE id = ?18`,
      [
        input.name,
        input.duration_minutes,
        input.validity_minutes,
        input.data_limit_mb,
        input.download_limit,
        input.upload_limit,
        input.shared_users,
        input.price_hint,
        currency,
        mikrotikId,
        profileName,
        actorProfileId,
        revision,
        lastSyncedAt,
        input.status,
        syncStatus,
        input.updated_at ?? now,
        input.id
      ]
    );

    const updated = await this.findById(input.id);
    if (!updated) throw new Error("Le plan n'a pas pu être mis à jour.");

    if (materialChange || context.action === "synchronized") {
      await this.appendHistory(
        updated,
        context.action ?? "updated",
        context
      );
    }
    return updated;
  }

  async remove(id: string, context: HotspotPlanMutationContext = {}): Promise<void> {
    const before = await this.findById(id);
    if (!before) return;
    const now = new Date().toISOString();
    const removed: HotspotPlanRecord = {
      ...before,
      deleted_at: now,
      revision: before.revision + 1,
      updated_at: now,
      updated_by_profile_id: context.actorProfileId ?? before.updated_by_profile_id
    };
    await this.database.execute(
      `UPDATE hotspot_plans SET
        deleted_at = ?1, updated_at = ?2, updated_by_profile_id = ?3, revision = ?4
      WHERE id = ?5`,
      [now, now, removed.updated_by_profile_id, removed.revision, id]
    );
    await this.appendHistory(removed, context.action ?? "deleted", context);
  }

  async importHistory(entries: HotspotPlanHistoryRecord[]): Promise<void> {
    const existingIds = new Set(
      (await this.database.query<Pick<HotspotPlanHistoryRecord, "id">>(
        "SELECT * FROM hotspot_plan_history"
      )).map((entry) => entry.id)
    );
    for (const entry of entries) {
      if (existingIds.has(entry.id)) continue;
      await this.insertHistory(entry);
      existingIds.add(entry.id);
    }
  }

  private async appendHistory(
    plan: HotspotPlanRecord,
    action: HotspotPlanHistoryRecord["action"],
    context: HotspotPlanMutationContext
  ): Promise<void> {
    await this.insertHistory({
      action,
      actor_profile_id: context.actorProfileId ?? plan.updated_by_profile_id ?? plan.created_by_profile_id,
      created_at: new Date().toISOString(),
      currency: plan.currency,
      id: `plan-history-${crypto.randomUUID()}`,
      mikrotik_id: plan.mikrotik_id,
      mikrotik_profile_name: plan.mikrotik_profile_name,
      name: plan.name,
      plan_id: plan.id,
      price_hint: plan.price_hint,
      revision: plan.revision,
      router_id: plan.router_id,
      snapshot_json: JSON.stringify(plan),
      source: context.source?.trim() || "ticketpro"
    });
  }

  private async insertHistory(entry: HotspotPlanHistoryRecord): Promise<void> {
    await this.database.execute(
      `INSERT INTO hotspot_plan_history (
        id, plan_id, router_id, action, revision, actor_profile_id, source,
        mikrotik_id, mikrotik_profile_name, name, currency, price_hint,
        snapshot_json, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      [
        entry.id,
        entry.plan_id,
        entry.router_id,
        entry.action,
        entry.revision,
        entry.actor_profile_id,
        entry.source,
        entry.mikrotik_id,
        entry.mikrotik_profile_name,
        entry.name,
        normalizePlanCurrency(entry.currency),
        entry.price_hint,
        entry.snapshot_json,
        entry.created_at
      ]
    );
  }
}

export function normalizePlanCurrency(value: string | null | undefined): string {
  const currency = value?.trim().toUpperCase() || "CFA";
  if (!/^[A-Z0-9]{2,12}$/.test(currency)) {
    throw new Error("La devise doit contenir entre 2 et 12 lettres ou chiffres (ex. CFA, XOF, EUR, USD).");
  }
  return currency;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function hasMaterialPlanChange(
  before: HotspotPlanRecord,
  next: CreateHotspotPlanInput & {
    currency: string;
    mikrotik_id: string | null;
    mikrotik_profile_name: string | null;
  }
): boolean {
  return before.name !== next.name
    || before.duration_minutes !== next.duration_minutes
    || before.validity_minutes !== next.validity_minutes
    || before.data_limit_mb !== next.data_limit_mb
    || before.download_limit !== next.download_limit
    || before.upload_limit !== next.upload_limit
    || before.shared_users !== next.shared_users
    || before.price_hint !== next.price_hint
    || before.currency !== next.currency
    || before.mikrotik_id !== next.mikrotik_id
    || before.mikrotik_profile_name !== next.mikrotik_profile_name
    || before.status !== next.status;
}
