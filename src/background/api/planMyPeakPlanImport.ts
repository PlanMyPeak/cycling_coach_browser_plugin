/**
 * PlanMyPeak raw training-plan import client (background only).
 *
 * Five routes under `/imports/training-peaks/plans`: begin, record a part,
 * complete, abandon, read. The extension forwards TrainingPeaks' JSON as it
 * came off the wire; the server records it, converts it asynchronously and
 * reports per-item outcomes, which the extension polls for.
 *
 * Failures here keep the HTTP status and the error body's `details`, because
 * the transport decides what to do from them: a 404 on begin means the
 * destination predates the routes (legacy path), a 409 names an active
 * import to join or abandon, a thrown fetch is a network failure worth
 * retrying since every route is idempotent.
 */

import { z } from 'zod';
import {
  credentialFailure,
  makeApiRequest,
  type PlanMyPeakRequestAuth,
} from '@/background/api/planMyPeak';
import {
  PlanImportErrorBodySchema,
  PlanImportPartResponseSchema,
  PlanImportResponseSchema,
  type PlanImportCounts,
  type PlanImportPartKind,
  type PlanImportPartResponse,
  type PlanImportResponse,
} from '@/schemas/planMyPeakPlanImport.schema';
import type { TrainingPeaksEnvironment } from '@/utils/constants';
import { PLANMYPEAK_AUTH_MESSAGES } from '@/utils/uiStrings';
import { logger } from '@/utils/logger';

const PLAN_IMPORTS_ENDPOINT = '/backend/imports/training-peaks/plans';

/** Thrown fetch or unreadable response: nothing reached the server for sure. */
export const PLAN_IMPORT_NETWORK_ERROR = 'NETWORK_ERROR';

export interface PlanImportApiFailure {
  message: string;
  status?: number;
  code?: string;
  /** The error body's `details`, route-specific; parsed by the caller. */
  details?: unknown;
}

export type PlanImportApiResult<T> =
  | { success: true; data: T; status: number }
  | { success: false; error: PlanImportApiFailure };

/** Body of begin. `plan` and `planFolders` are native TrainingPeaks values. */
export interface PlanImportBeginRequest {
  clientOperationId: string;
  environment: TrainingPeaksEnvironment;
  extensionVersion?: string | null;
  plan: unknown;
  planFolders: unknown[];
  declaredCounts: PlanImportCounts;
  targetWorkoutLibraryId?: string | null;
}

export interface PlanImportPartRequest {
  kind: PlanImportPartKind;
  /** Zero-based, per kind. */
  partIndex: number;
  /** Native TrainingPeaks items, never reshaped. */
  items: unknown[];
}

function importPath(importId: string, suffix = ''): string {
  return `${PLAN_IMPORTS_ENDPOINT}/${encodeURIComponent(importId)}${suffix}`;
}

async function failureFromResponse(
  response: Response
): Promise<PlanImportApiFailure> {
  if (response.status === 401) {
    return {
      message: PLANMYPEAK_AUTH_MESSAGES.SIGN_IN_REQUIRED,
      status: 401,
      code: 'UNAUTHORIZED',
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const parsed = PlanImportErrorBodySchema.safeParse(body);
  if (!parsed.success) {
    return { message: `HTTP ${response.status}`, status: response.status };
  }

  return {
    message:
      parsed.data.message || parsed.data.error || `HTTP ${response.status}`,
    status: response.status,
    ...(parsed.data.code ? { code: parsed.data.code } : {}),
    ...(parsed.data.details !== undefined
      ? { details: parsed.data.details }
      : {}),
  };
}

async function requestImportApi<T>(
  endpoint: string,
  schema: z.ZodSchema<T>,
  operationName: string,
  init: RequestInit,
  auth?: PlanMyPeakRequestAuth
): Promise<PlanImportApiResult<T>> {
  let response: Response;
  try {
    logger.debug(`[PlanMyPeak plan import] ${operationName}`);
    response = await makeApiRequest(endpoint, init, auth);
  } catch (error) {
    const authFailure = credentialFailure(error);
    if (authFailure) {
      return authFailure;
    }

    logger.warn(
      `[PlanMyPeak plan import] ${operationName} did not reach the server:`,
      error
    );
    return {
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Network error',
        code: PLAN_IMPORT_NETWORK_ERROR,
      },
    };
  }

  if (!response.ok) {
    return { success: false, error: await failureFromResponse(response) };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    // The server answered but the body was lost in transit: same as a
    // dropped request from the caller's point of view, and just as safe to
    // repeat.
    logger.warn(
      `[PlanMyPeak plan import] ${operationName} body unreadable:`,
      error
    );
    return {
      success: false,
      error: {
        message: 'PlanMyPeak answered with an unreadable response',
        code: PLAN_IMPORT_NETWORK_ERROR,
        status: response.status,
      },
    };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path =
      issue && issue.path.length > 0 ? issue.path.join('.') : 'response';
    logger.error(
      `[PlanMyPeak plan import] ${operationName} response validation failed:`,
      parsed.error
    );
    return {
      success: false,
      error: {
        message: `Response validation failed (${path}: ${issue?.message ?? 'unknown'})`,
        code: 'VALIDATION_ERROR',
        status: response.status,
      },
    };
  }

  return { success: true, data: parsed.data, status: response.status };
}

/** POST begin. 201 for a new import, 200 for a repeat of the same operation. */
export async function beginPlanImport(
  body: PlanImportBeginRequest,
  auth?: PlanMyPeakRequestAuth
): Promise<PlanImportApiResult<PlanImportResponse>> {
  return requestImportApi(
    PLAN_IMPORTS_ENDPOINT,
    PlanImportResponseSchema,
    `begin import of plan ${String(
      (body.plan as { planId?: unknown } | null)?.planId ?? '?'
    )}`,
    { method: 'POST', body: JSON.stringify(body) },
    auth
  );
}

/** POST one part. Repeating a part with the same content is a no-op. */
export async function recordPlanImportPart(
  importId: string,
  part: PlanImportPartRequest,
  auth?: PlanMyPeakRequestAuth
): Promise<PlanImportApiResult<PlanImportPartResponse>> {
  return requestImportApi(
    importPath(importId, '/parts'),
    PlanImportPartResponseSchema,
    `record ${part.kind} part ${part.partIndex} (${part.items.length} items)`,
    { method: 'POST', body: JSON.stringify(part) },
    auth
  );
}

/** POST complete: queues processing. 202 with status `queued`. */
export async function completePlanImport(
  importId: string,
  auth?: PlanMyPeakRequestAuth
): Promise<PlanImportApiResult<PlanImportResponse>> {
  return requestImportApi(
    importPath(importId, '/complete'),
    PlanImportResponseSchema,
    `complete import ${importId}`,
    { method: 'POST' },
    auth
  );
}

/** POST abandon: only a `staging` import can be abandoned. */
export async function abandonPlanImport(
  importId: string,
  auth?: PlanMyPeakRequestAuth
): Promise<PlanImportApiResult<PlanImportResponse>> {
  return requestImportApi(
    importPath(importId, '/abandon'),
    PlanImportResponseSchema,
    `abandon import ${importId}`,
    { method: 'POST' },
    auth
  );
}

/** GET the import: status, summary and non-clean item outcomes. */
export async function fetchPlanImport(
  importId: string,
  auth?: PlanMyPeakRequestAuth
): Promise<PlanImportApiResult<PlanImportResponse>> {
  return requestImportApi(
    importPath(importId),
    PlanImportResponseSchema,
    `read import ${importId}`,
    { method: 'GET' },
    auth
  );
}
