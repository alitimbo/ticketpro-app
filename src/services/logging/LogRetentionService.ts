import type { DatabaseClient } from "../database";
import {
  AppLogRepository,
  AppSettingsRepository
} from "../database/repositories";

export const defaultLogRetentionDays = 30;
export const allowedLogRetentionDays = [7, 30, 90, 180, 365] as const;
const automaticCleanupIntervalMs = 24 * 60 * 60 * 1000;

export type LogRetentionPolicy = {
  days: number;
  lastCleanupAt: string | null;
};

export type LogCleanupResult = {
  cutoff: string;
  removedCount: number;
  runAt: string;
};

export class LogRetentionService {
  private readonly logs: AppLogRepository;
  private readonly settings: AppSettingsRepository;

  constructor(database: DatabaseClient) {
    this.logs = new AppLogRepository(database);
    this.settings = new AppSettingsRepository(database);
  }

  async getPolicy(accountId: string): Promise<LogRetentionPolicy> {
    const [storedDays, lastCleanupAt] = await Promise.all([
      this.settings.get(retentionDaysKey(accountId)),
      this.settings.get(lastCleanupKey(accountId))
    ]);
    return {
      days: normalizeRetentionDays(storedDays),
      lastCleanupAt: validDateOrNull(lastCleanupAt)
    };
  }

  async setRetentionDays(accountId: string, days: number): Promise<number> {
    const normalized = normalizeRetentionDays(String(days));
    await this.settings.set(retentionDaysKey(accountId), String(normalized));
    return normalized;
  }

  async countEligible(
    accountId: string,
    days: number,
    now = new Date()
  ): Promise<number> {
    return this.logs.countBefore(accountId, cutoffFor(now, days));
  }

  async cleanNow(
    accountId: string,
    days: number,
    now = new Date()
  ): Promise<LogCleanupResult> {
    const normalizedDays = normalizeRetentionDays(String(days));
    const cutoff = cutoffFor(now, normalizedDays);
    const removedCount = await this.logs.deleteBefore(accountId, cutoff);
    const runAt = now.toISOString();
    await this.settings.set(lastCleanupKey(accountId), runAt);
    return { cutoff, removedCount, runAt };
  }

  async runAutomatic(
    accountId: string,
    now = new Date()
  ): Promise<(LogCleanupResult & { ran: true }) | { ran: false; removedCount: 0 }> {
    const policy = await this.getPolicy(accountId);
    const lastRun = policy.lastCleanupAt
      ? new Date(policy.lastCleanupAt).getTime()
      : null;

    if (
      lastRun !== null &&
      Number.isFinite(lastRun) &&
      now.getTime() - lastRun < automaticCleanupIntervalMs
    ) {
      return { ran: false, removedCount: 0 };
    }

    return {
      ...(await this.cleanNow(accountId, policy.days, now)),
      ran: true
    };
  }
}

function retentionDaysKey(accountId: string): string {
  return `logs.retention_days.${accountId}`;
}

function lastCleanupKey(accountId: string): string {
  return `logs.last_cleanup_at.${accountId}`;
}

function normalizeRetentionDays(value: string | null): number {
  const parsed = Number(value);
  return allowedLogRetentionDays.includes(
    parsed as (typeof allowedLogRetentionDays)[number]
  )
    ? parsed
    : defaultLogRetentionDays;
}

function cutoffFor(now: Date, days: number): string {
  return new Date(
    now.getTime() - normalizeRetentionDays(String(days)) * 24 * 60 * 60 * 1000
  ).toISOString();
}

function validDateOrNull(value: string | null): string | null {
  if (!value) return null;
  return Number.isFinite(new Date(value).getTime()) ? value : null;
}
