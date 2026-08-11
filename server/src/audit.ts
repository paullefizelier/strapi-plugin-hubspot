import type { Core } from "@strapi/strapi";
import { checkMapping, type Problem, type Schema } from "./properties";
import { collectMappings, type ValidateTarget } from "./validation";

/**
 * Full-content audit of HubSpot mappings.
 *
 * Save-time validation only protects entries as they are written: a property
 * deleted in HubSpot afterwards leaves invalid mappings dormant in content
 * that nobody re-saves. The audit walks every entry of every validated content
 * type and reports the mappings the portal would reject today.
 *
 * Problems are returned as structured codes — the admin UI renders and
 * translates them, symmetrical with save-time validation's `details`.
 */

interface AttributeSchema {
  type: string;
  component?: string;
  components?: string[];
}

interface EntitySchema {
  attributes: Record<string, AttributeSchema>;
  options?: { draftAndPublish?: boolean };
  pluginOptions?: { i18n?: { localized?: boolean } };
}

/**
 * A populate object reaching every component and dynamic zone of a schema, at
 * any depth. Mappings live inside form components nested in dynamic zones —
 * without deep populate they are simply absent from the entry and the audit
 * would happily report a clean bill.
 *
 * Relations and media are deliberately not followed: mappings belong to the
 * entry itself, and following relations would drag in unrelated documents.
 */
export function buildPopulate(
  components: Record<string, EntitySchema | undefined>,
  schema: EntitySchema,
  depth = 0,
): Record<string, unknown> {
  // Strapi refuses circular component nesting, so this only guards corrupt schemas.
  if (depth > 8) return {};

  const populate: Record<string, unknown> = {};
  for (const [key, attr] of Object.entries(schema.attributes ?? {})) {
    if (attr.type === "component" && attr.component) {
      const child = components[attr.component];
      const nested = child ? buildPopulate(components, child, depth + 1) : {};
      populate[key] = { populate: Object.keys(nested).length ? nested : "*" };
    } else if (attr.type === "dynamiczone" && attr.components?.length) {
      const on: Record<string, unknown> = {};
      for (const uid of attr.components) {
        const child = components[uid];
        const nested = child ? buildPopulate(components, child, depth + 1) : {};
        on[uid] = { populate: Object.keys(nested).length ? nested : "*" };
      }
      populate[key] = { on };
    }
  }
  return populate;
}

/** Something to show for an entry — better than a bare documentId when possible. */
export function entryLabel(entry: Record<string, unknown>): string {
  for (const key of ["title", "name", "label", "heading", "slug"]) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return String(entry.documentId ?? entry.id ?? "?");
}

export interface AuditEntry {
  documentId: string;
  locale?: string;
  label: string;
  problems: Problem[];
}

export interface AuditTargetReport {
  uid: string;
  /** Entries scanned, across locales. */
  entries: number;
  /** Mappings found in them. */
  mappings: number;
  invalid: AuditEntry[];
  /** Set when the content type itself couldn't be scanned. */
  error?: string;
}

/** Every draft entry of the content type, across locales when localized. */
async function fetchEntries(
  strapi: Core.Strapi,
  uid: string,
  schema: EntitySchema,
  populate: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const params: Record<string, unknown> = {};
  if (Object.keys(populate).length) params.populate = populate;
  // The draft is the working copy — what the next save will validate. When
  // draft & publish is off there is only one version, no status to pick.
  if (schema.options?.draftAndPublish) params.status = "draft";

  let locales: (string | undefined)[] = [undefined];
  if (schema.pluginOptions?.i18n?.localized) {
    try {
      const known = (await strapi
        .plugin("i18n")
        .service("locales")
        .find()) as { code: string }[];
      if (known.length) locales = known.map((l) => l.code);
    } catch {
      // i18n unavailable — scan the default locale rather than nothing.
    }
  }

  const out: Record<string, unknown>[] = [];
  for (const locale of locales) {
    const docs = (await strapi.documents(uid as never).findMany({
      ...params,
      ...(locale ? { locale } : {}),
    })) as unknown as Record<string, unknown>[];
    for (const doc of docs ?? []) out.push(locale ? { ...doc, __auditLocale: locale } : doc);
  }
  return out;
}

export async function runAudit(
  strapi: Core.Strapi,
  targets: ValidateTarget[],
  schema: Schema,
): Promise<AuditTargetReport[]> {
  const reports: AuditTargetReport[] = [];

  for (const target of targets) {
    const contentType = strapi.contentType(target.uid as never) as unknown as
      | EntitySchema
      | undefined;
    if (!contentType) {
      reports.push({
        uid: target.uid,
        entries: 0,
        mappings: 0,
        invalid: [],
        error: `unknown content type "${target.uid}"`,
      });
      continue;
    }

    const populate = buildPopulate(
      strapi.components as unknown as Record<string, EntitySchema>,
      contentType,
    );

    let entries: Record<string, unknown>[];
    try {
      entries = await fetchEntries(strapi, target.uid, contentType, populate);
    } catch (err) {
      reports.push({
        uid: target.uid,
        entries: 0,
        mappings: 0,
        invalid: [],
        error: (err as Error).message,
      });
      continue;
    }

    const report: AuditTargetReport = {
      uid: target.uid,
      entries: entries.length,
      mappings: 0,
      invalid: [],
    };

    for (const entry of entries) {
      const mappings = collectMappings(entry, target);
      report.mappings += mappings.length;
      // The audit is a diagnostic: it reports `unknown` even on non-strict
      // targets — strict only decides whether a save is blocked, not whether
      // the mapping would reach the CRM.
      const problems = mappings
        .map((m) => checkMapping(schema.properties, m))
        .filter((p): p is Problem => Boolean(p));
      if (problems.length) {
        report.invalid.push({
          documentId: String(entry.documentId ?? entry.id ?? "?"),
          locale: (entry.__auditLocale as string | undefined) ?? undefined,
          label: entryLabel(entry),
          problems,
        });
      }
    }

    reports.push(report);
  }

  return reports;
}
