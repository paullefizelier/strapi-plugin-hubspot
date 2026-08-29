/**
 * The builder's own API — admin routes consumed by the Forms page. CRUD over
 * `plugin::hubspot.form` through the Document Service (drafts, locales,
 * publish), with the structural check and the mapping check applied where the
 * Content Manager middleware can't reach: this content type is hidden there,
 * the builder is its only editor.
 */

import type { Core } from "@strapi/strapi";
import { validateDefinition, type FormDefinition } from "./conditions";
import { mappingProblems, type FormEntry } from "./forms";
import { convertLegacyForm, type ImportMap } from "./importLegacy";
import { loadSchema, resolveObjects, type Problem } from "./properties";
import { resolveApiKey } from "./settings";

export const FORM_UID = "plugin::hubspot.form";

const EMPTY_DEFINITION: FormDefinition = { version: 1, steps: [] };

export interface Ctx {
  params: { documentId?: string };
  query: { locale?: string };
  request: { body?: Record<string, unknown> };
  body: unknown;
  throw: (status: number, message: string) => never;
}

/** Attributes the builder may write. `definition` is validated separately. */
const WRITABLE = [
  "name",
  "title",
  "subtitle",
  "nextLabel",
  "submitLabel",
  "successMessage",
] as const;

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "form";

export function createFormsAdminController(strapi: Core.Strapi) {
  const documents = () => strapi.documents(FORM_UID as never);

  /** Portal mapping check — skipped (null) when HubSpot is unreachable. */
  async function checkMappings(
    definition: FormDefinition,
  ): Promise<(Problem & { fieldId: string })[] | null> {
    const { apiKey } = await resolveApiKey(strapi);
    if (!apiKey) return null;
    try {
      const schema = await loadSchema(
        strapi,
        apiKey,
        resolveObjects(strapi.plugin("hubspot").config("objects", [])),
      );
      return mappingProblems(definition, schema.properties);
    } catch {
      return null;
    }
  }

  function pickWritable(body: Record<string, unknown>) {
    const data: Record<string, unknown> = {};
    for (const key of WRITABLE) {
      if (key in body) data[key] = body[key];
    }
    return data;
  }

  /** 400 with the structural errors when the definition can't run. */
  function requireValidDefinition(ctx: Ctx, definition: unknown): FormDefinition {
    const def = (definition ?? EMPTY_DEFINITION) as FormDefinition;
    const errors = validateDefinition(def);
    if (errors.length) {
      (ctx as unknown as { status: number }).status = 400;
      ctx.body = { errors };
      throw Object.assign(new Error("invalid definition"), { handled: true });
    }
    return def;
  }

  const handled = (err: unknown) => (err as { handled?: boolean })?.handled === true;

  return {
    async list(ctx: Ctx) {
      const locale = ctx.query.locale;
      const drafts = (await documents().findMany({
        locale,
        status: "draft",
        sort: "updatedAt:desc",
      } as never)) as unknown as (FormEntry & { documentId: string; updatedAt: string })[];
      const published = (await documents().findMany({
        locale,
        status: "published",
        fields: ["slug"],
      } as never)) as unknown as { documentId: string }[];
      const publishedIds = new Set(published.map((e) => e.documentId));
      ctx.body = {
        forms: drafts.map((entry) => ({
          documentId: entry.documentId,
          name: entry.name,
          slug: entry.slug,
          updatedAt: entry.updatedAt,
          published: publishedIds.has(entry.documentId),
          steps: (entry.definition?.steps ?? []).length,
          fields: (entry.definition?.steps ?? []).reduce(
            (n, step) => n + (step.fields?.length ?? 0),
            0,
          ),
        })),
      };
    },

    async findOne(ctx: Ctx) {
      const entry = await documents().findOne({
        documentId: ctx.params.documentId!,
        locale: ctx.query.locale,
        status: "draft",
      } as never);
      if (!entry) ctx.throw(404, "Form not found");
      const published = await documents().findOne({
        documentId: ctx.params.documentId!,
        locale: ctx.query.locale,
        status: "published",
      } as never);
      ctx.body = { form: entry, published: Boolean(published) };
    },

    async create(ctx: Ctx) {
      const body = ctx.request.body ?? {};
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) ctx.throw(400, "A form needs a name");

      // Unique slug: suffix until free. Forms are few; the loop is fine.
      const base = slugify(name);
      let slug = base;
      for (let i = 2; ; i += 1) {
        const clash = await documents().findFirst({ filters: { slug } } as never);
        if (!clash) break;
        slug = `${base}-${i}`;
      }

      let definition: FormDefinition;
      try {
        definition = requireValidDefinition(ctx, body.definition);
      } catch (err) {
        if (handled(err)) return;
        throw err;
      }
      const entry = await documents().create({
        locale: ctx.query.locale,
        data: { ...pickWritable(body), name, slug, definition } as never,
      } as never);
      ctx.body = { form: entry };
    },

    async update(ctx: Ctx) {
      const body = ctx.request.body ?? {};
      let definition: FormDefinition | undefined;
      if ("definition" in body) {
        try {
          definition = requireValidDefinition(ctx, body.definition);
        } catch (err) {
          if (handled(err)) return;
          throw err;
        }
      }
      const entry = await documents().update({
        documentId: ctx.params.documentId!,
        locale: ctx.query.locale,
        data: { ...pickWritable(body), ...(definition ? { definition } : {}) } as never,
      } as never);
      if (!entry) ctx.throw(404, "Form not found");
      // Mapping problems don't block a draft — they block publish. Returned
      // here so the builder can flag the field while the editor still has
      // their hands in it.
      const problems = definition ? await checkMappings(definition) : null;
      ctx.body = { form: entry, problems: problems ?? [] };
    },

    async publish(ctx: Ctx) {
      const entry = (await documents().findOne({
        documentId: ctx.params.documentId!,
        locale: ctx.query.locale,
        status: "draft",
      } as never)) as unknown as FormEntry | null;
      if (!entry) ctx.throw(404, "Form not found");

      const structural = validateDefinition(entry.definition ?? EMPTY_DEFINITION);
      const mappings = (await checkMappings(entry.definition ?? EMPTY_DEFINITION)) ?? [];
      if (structural.length || mappings.length) {
        (ctx as unknown as { status: number }).status = 400;
        ctx.body = { errors: structural, problems: mappings };
        return;
      }
      await documents().publish({
        documentId: ctx.params.documentId!,
        locale: ctx.query.locale,
      } as never);
      ctx.body = { ok: true };
    },

    async unpublish(ctx: Ctx) {
      await documents().unpublish({
        documentId: ctx.params.documentId!,
        locale: ctx.query.locale,
      } as never);
      ctx.body = { ok: true };
    },

    /**
     * Feeds the `hubspot.form-picker` custom field: every form of the builder
     * as { name, slug, published }. Open to any authenticated admin — like the
     * properties route — because editors pick forms from the Content Manager,
     * not from the builder. `name`/`slug` are shared across locales.
     */
    async options(ctx: Ctx) {
      const drafts = (await documents().findMany({
        fields: ["name", "slug"],
        sort: "name:asc",
        status: "draft",
      } as never)) as unknown as { name?: string; slug?: string }[];
      const published = (await documents().findMany({
        fields: ["slug"],
        status: "published",
      } as never)) as unknown as { slug?: string }[];
      const publishedSlugs = new Set(published.map((e) => e.slug));
      ctx.body = {
        forms: drafts
          .filter((e) => e.slug)
          .map((e) => ({
            name: e.name ?? e.slug,
            slug: e.slug,
            published: publishedSlugs.has(e.slug),
          })),
      };
    },

    /** Entries of the configured legacy content type, offered for import. */
    async listSources(ctx: Ctx) {
      const config = (strapi.plugin("hubspot").config("forms", {}) as {
        import?: { uid?: string } & ImportMap;
      }).import;
      if (!config?.uid) {
        ctx.body = { configured: false, sources: [] };
        return;
      }
      try {
        const entries = (await strapi.documents(config.uid as never).findMany({
          fields: ["name", "slug"],
          sort: "name:asc",
        } as never)) as unknown as { documentId: string; name?: string; slug?: string }[];
        ctx.body = {
          configured: true,
          sources: entries.map((e) => ({
            documentId: e.documentId,
            name: e.name ?? e.slug ?? e.documentId,
            slug: e.slug ?? "",
          })),
        };
      } catch (err) {
        strapi.log.warn(`[hubspot] import sources unavailable — ${(err as Error).message}`);
        ctx.body = { configured: true, sources: [] };
      }
    },

    /**
     * Converts one legacy entry (every locale of it) into a plugin form
     * draft. Same slug: re-importing overwrites the draft, never touches the
     * published version, and never modifies the source.
     */
    async runImport(ctx: Ctx) {
      const config = (strapi.plugin("hubspot").config("forms", {}) as {
        import?: { uid?: string } & ImportMap;
      }).import;
      if (!config?.uid) ctx.throw(400, "No import source configured (forms.import.uid)");
      const sourceId = ctx.request.body?.documentId;
      if (typeof sourceId !== "string" || !sourceId) ctx.throw(400, "documentId is required");

      const { uid, ...map } = config!;
      const populate = {
        [map.steps ?? "steps"]: {
          populate: {
            [map.fields ?? "fields"]: { populate: [map.field?.options ?? "options"] },
          },
        },
      };

      let locales: (string | undefined)[] = [undefined];
      try {
        const found = (await strapi
          .plugin("i18n")
          .service("locales")
          .find()) as { code: string; isDefault?: boolean }[];
        if (Array.isArray(found) && found.length) {
          // Default locale first: it creates the document, the others localize it.
          locales = [...found].sort((a, b) => Number(b.isDefault ?? false) - Number(a.isDefault ?? false)).map((l) => l.code);
        }
      } catch {
        /* i18n unavailable — single pass */
      }

      let targetId: string | null = null;
      let imported = 0;
      for (const locale of locales) {
        const source = (await strapi.documents(uid as never).findOne({
          documentId: sourceId,
          locale,
          populate,
        } as never)) as unknown as Record<string, unknown> | null;
        if (!source) continue;

        const converted = convertLegacyForm(source, map);
        if (!targetId) {
          const existing = (await documents().findFirst({
            filters: { slug: converted.slug },
          } as never)) as unknown as { documentId: string } | null;
          targetId = existing?.documentId ?? null;
        }
        const data = { ...converted } as Record<string, unknown>;
        if (targetId) {
          // The slug is shared across locales; only the meta + definition move.
          delete data.slug;
          await documents().update({ documentId: targetId, locale, data: data as never } as never);
        } else {
          const created = (await documents().create({
            locale,
            data: data as never,
          } as never)) as unknown as { documentId: string };
          targetId = created.documentId;
        }
        imported += 1;
      }

      if (!targetId) ctx.throw(404, "Source entry not found");
      ctx.body = { documentId: targetId, locales: imported };
    },

    async remove(ctx: Ctx) {
      await documents().delete({
        documentId: ctx.params.documentId!,
        // No locale: deleting a form deletes all its locales.
      } as never);
      ctx.body = { ok: true };
    },
  };
}
