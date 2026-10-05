/**
 * Durable record of a raw training-plan import attempt.
 *
 * Two things must survive a lost response or a closed popup:
 *
 * - the **client operation id**, so that repeating `begin` after its response
 *   was lost returns the same import instead of tripping the one-active-import
 *   rule on our own half-started attempt;
 * - the **server's import id**, so that a poll can resume against the same
 *   import instead of starting another.
 *
 * One record per `environment:planId`. A record is reused only while its
 * attempt has not been completed: once `complete` was acknowledged, the next
 * import of the same plan is a new attempt with a fresh operation id, because
 * repeating the old id with the same body would hand back the finished import
 * and nothing would be re-imported.
 *
 * Written only by the background worker.
 */

import { STORAGE_KEYS, type TrainingPeaksEnvironment } from '@/utils/constants';

export interface PlanImportOperationRecord {
  clientOperationId: string;
  environment: TrainingPeaksEnvironment;
  planId: number;
  /** Set once begin has answered. */
  importId: string | null;
  /** `completed` once the server acknowledged `complete`. */
  phase: 'begun' | 'completed';
  updatedAt: number;
}

type OperationsStorage = Record<string, PlanImportOperationRecord>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function operationKey(
  environment: TrainingPeaksEnvironment,
  planId: number
): string {
  return `${environment}:${planId}`;
}

async function readAll(): Promise<OperationsStorage> {
  const data = await chrome.storage.local.get(
    STORAGE_KEYS.PLAN_IMPORT_OPERATIONS
  );
  const raw = data[STORAGE_KEYS.PLAN_IMPORT_OPERATIONS];
  return isRecord(raw) ? (raw as OperationsStorage) : {};
}

async function writeAll(all: OperationsStorage): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.PLAN_IMPORT_OPERATIONS]: all,
  });
}

/** A fresh operation id. UUIDs fit the server's 1–100 character bound. */
export function mintClientOperationId(): string {
  return crypto.randomUUID();
}

/**
 * The operation to use for an import of this plan: the unfinished attempt if
 * there is one, otherwise a new record with a fresh id.
 */
export async function acquirePlanImportOperation(
  environment: TrainingPeaksEnvironment,
  planId: number
): Promise<PlanImportOperationRecord> {
  const all = await readAll();
  const key = operationKey(environment, planId);
  const existing = all[key];

  if (existing && existing.phase === 'begun') {
    return existing;
  }

  const record: PlanImportOperationRecord = {
    clientOperationId: mintClientOperationId(),
    environment,
    planId,
    importId: null,
    phase: 'begun',
    updatedAt: Date.now(),
  };
  all[key] = record;
  await writeAll(all);
  return record;
}

/**
 * Replace the operation id, keeping nothing of the old attempt. Used when the
 * server reports that the id was already used with a different body.
 */
export async function renewPlanImportOperation(
  environment: TrainingPeaksEnvironment,
  planId: number
): Promise<PlanImportOperationRecord> {
  const all = await readAll();
  const record: PlanImportOperationRecord = {
    clientOperationId: mintClientOperationId(),
    environment,
    planId,
    importId: null,
    phase: 'begun',
    updatedAt: Date.now(),
  };
  all[operationKey(environment, planId)] = record;
  await writeAll(all);
  return record;
}

export async function updatePlanImportOperation(
  environment: TrainingPeaksEnvironment,
  planId: number,
  patch: Partial<Pick<PlanImportOperationRecord, 'importId' | 'phase'>>
): Promise<void> {
  const all = await readAll();
  const key = operationKey(environment, planId);
  const existing = all[key];
  if (!existing) {
    return;
  }

  all[key] = { ...existing, ...patch, updatedAt: Date.now() };
  await writeAll(all);
}

/** The last attempt for this plan, if any, so a reopened popup can poll it. */
export async function getPlanImportOperation(
  environment: TrainingPeaksEnvironment,
  planId: number
): Promise<PlanImportOperationRecord | null> {
  const all = await readAll();
  return all[operationKey(environment, planId)] ?? null;
}
