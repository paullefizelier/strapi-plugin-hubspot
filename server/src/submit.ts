import type { Core } from "@strapi/strapi";
import {
  checkMapping,
  loadSchema,
  resolveObjects,
  type Problem,
} from "./properties";
import { resolveApiKey } from "./settings";

/**
 * Sending submissions to HubSpot, with the plugin's whole point applied on the
 * way out: a payload is validated against the portal schema *before* it is
 * sent, because one unknown property loses the entire upsert.
 *
 * Failures split in two:
 *  - permanent (4xx): the payload is wrong; retrying cannot fix it, so the
 *    result says why and nothing is queued;
 *  - transient (429, 5xx, network): retried with backoff, then parked in the
 *    `plugin::hubspot.failure` collection — visible in the Content Manager —
 *    for `retryFailures()` to replay.
 */

const HS_BASE = "https://api.hubapi.com";

export const FAILURE_UID = "plugin::hubspot.failure";

/** Waits between retries: immediate first try, then patient. */
const RETRY_DELAYS_MS = [500, 2000];

export interface UpsertInput {
  /** Target object (`contact`, `company`, a custom type id…). */
  object: string;
  /** Unique property used to find-or-create — `email` for contacts. */
  idProperty: string;
  /** Property name → value. Values are coerced to strings; empty ones are dropped. */
  properties: Record<string, unknown>;
}

export interface UpsertResult {
  ok: boolean;
  /** HubSpot record id, on success. */
  id?: string;
  /** Pre-validation refusals — the payload never left the server. */
  problems?: Problem[];
  /** True when the payload was parked for `retryFailures()`. */
  queued?: boolean;
  error?: string;
}

interface FailureRow {
  documentId: string;
  object: string;
  idProperty: string;
  properties: Record<string, unknown>;
  attempts?: number;
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `null`, `undefined` and `""` say "nothing to write" — HubSpot wants strings. */
function coerceProperties(properties: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === null || value === undefined || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

class HsError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const isTransient = (err: unknown) =>
  !(err instanceof HsError) || err.status === 429 || err.status >= 500;

export function createSubmitService(
  strapi: Core.Strapi,
  { sleep = sleepFor }: { sleep?: (ms: number) => Promise<void> } = {},
) {
  const objectPath = (object: string) =>
    resolveObjects(strapi.plugin("hubspot").config("objects", [])).find(
      (o) => o.name === object,
    )?.path ?? object;

  async function sendOnce(
    apiKey: string,
    input: UpsertInput,
    properties: Record<string, string>,
  ): Promise<string> {
    const res = await fetch(`${HS_BASE}/crm/v3/objects/${objectPath(input.object)}/batch/upsert`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: [{ idProperty: input.idProperty, id: properties[input.idProperty], properties }],
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      results?: { id?: string }[];
    };
    if (!res.ok) throw new HsError(body.message || `HubSpot ${res.status}`, res.status);
    return body.results?.[0]?.id ?? "";
  }

  async function sendWithRetries(
    apiKey: string,
    input: UpsertInput,
    properties: Record<string, string>,
  ): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
      try {
        return await sendOnce(apiKey, input, properties);
      } catch (err) {
        lastError = err;
        if (!isTransient(err)) throw err; // A 400 will 400 again — fail now.
      }
    }
    throw lastError;
  }

  /**
   * Mappings the portal would reject, checked against the cached schema. An
   * unreachable schema skips the check — the send itself will tell — and a
   * multi-select value is split on `;`, HubSpot's own separator.
   */
  async function validateAgainstSchema(
    apiKey: string,
    input: UpsertInput,
    properties: Record<string, string>,
  ): Promise<Problem[] | null> {
    let schema;
    try {
      schema = await loadSchema(
        strapi,
        apiKey,
        resolveObjects(strapi.plugin("hubspot").config("objects", [])),
      );
    } catch {
      return null;
    }
    const problems: Problem[] = [];
    for (const [name, value] of Object.entries(properties)) {
      const problem = checkMapping(schema.properties, {
        object: input.object,
        property: name,
        values: value.split(";").map((v) => v.trim()).filter(Boolean),
      });
      if (problem) problems.push(problem);
    }
    return problems;
  }

  async function upsert(
    input: UpsertInput,
    { queueOnFailure = true }: { queueOnFailure?: boolean } = {},
  ): Promise<UpsertResult> {
    const { apiKey } = await resolveApiKey(strapi);
    if (!apiKey) return { ok: false, error: "No HubSpot API key configured" };

    const properties = coerceProperties(input.properties);
    if (!properties[input.idProperty]) {
      return { ok: false, error: `Missing value for idProperty "${input.idProperty}"` };
    }

    const problems = await validateAgainstSchema(apiKey, input, properties);
    if (problems?.length) return { ok: false, problems };

    try {
      const id = await sendWithRetries(apiKey, input, properties);
      return { ok: true, id };
    } catch (err) {
      const message = (err as Error).message;
      // A permanent refusal is a bug to fix, not a payload to replay.
      if (!isTransient(err) || !queueOnFailure) {
        strapi.log.error(`[hubspot] upsert refused — ${message}`);
        return { ok: false, error: message };
      }
      strapi.log.warn(`[hubspot] upsert failed, queued for retry — ${message}`);
      try {
        await strapi.documents(FAILURE_UID as never).create({
          data: {
            object: input.object,
            idProperty: input.idProperty,
            properties: input.properties,
            error: message,
            attempts: 1,
          } as never,
        });
        return { ok: false, queued: true, error: message };
      } catch (storeErr) {
        strapi.log.error(`[hubspot] could not queue the failure — ${(storeErr as Error).message}`);
        return { ok: false, queued: false, error: message };
      }
    }
  }

  /**
   * Replays parked submissions, oldest first. A replay that succeeds removes
   * the row; one that fails updates its error and attempt count and leaves it
   * for next time — or for an admin to delete from the Content Manager.
   */
  async function retryFailures({ limit = 50 }: { limit?: number } = {}) {
    const rows = (await strapi.documents(FAILURE_UID as never).findMany({
      limit,
      sort: "createdAt:asc",
    } as never)) as unknown as FailureRow[];

    let succeeded = 0;
    for (const row of rows) {
      const result = await upsert(
        { object: row.object, idProperty: row.idProperty, properties: row.properties ?? {} },
        { queueOnFailure: false }, // Already queued — don't duplicate the row.
      );
      if (result.ok) {
        await strapi.documents(FAILURE_UID as never).delete({ documentId: row.documentId });
        succeeded += 1;
      } else {
        await strapi.documents(FAILURE_UID as never).update({
          documentId: row.documentId,
          data: {
            attempts: (row.attempts ?? 1) + 1,
            error:
              result.error ??
              (result.problems ? `invalid mapping: ${JSON.stringify(result.problems)}` : "unknown"),
          } as never,
        });
      }
    }
    return { retried: rows.length, succeeded, failed: rows.length - succeeded };
  }

  return { upsert, retryFailures };
}
