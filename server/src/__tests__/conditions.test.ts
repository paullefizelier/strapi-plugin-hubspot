import { describe, expect, it } from "vitest";
import {
  evaluateCondition,
  resolveSubmission,
  type Condition,
  type FormDefinition,
  type FormFieldDef,
} from "../conditions";

/** Terse field factory — only what a test cares about. */
const field = (id: string, name: string, extra: Partial<FormFieldDef> = {}): FormFieldDef => ({
  id,
  name,
  label: name,
  type: "text",
  ...extra,
});

const form = (steps: FormDefinition["steps"]): FormDefinition => ({ version: 1, steps });

/** One-step form, the common case. */
const oneStep = (fields: FormFieldDef[]): FormDefinition =>
  form([{ id: "stp_1", fields }]);

const cond = (
  logic: Condition["logic"],
  ...rules: Condition["rules"]
): Condition => ({ logic, rules });

describe("evaluateCondition", () => {
  const get = (values: Record<string, unknown>) => (fieldId: string) => values[fieldId];

  it("eq matches the exact value, after trimming both sides", () => {
    const c = cond("and", { field: "fld_a", operator: "eq", value: "entreprise" });
    expect(evaluateCondition(c, get({ fld_a: "entreprise" }))).toBe(true);
    expect(evaluateCondition(c, get({ fld_a: " entreprise " }))).toBe(true);
    expect(evaluateCondition(c, get({ fld_a: "particulier" }))).toBe(false);
  });

  it("eq compares checkbox booleans against 'true'/'false'", () => {
    const c = cond("and", { field: "fld_a", operator: "eq", value: "true" });
    expect(evaluateCondition(c, get({ fld_a: true }))).toBe(true);
    expect(evaluateCondition(c, get({ fld_a: false }))).toBe(false);
  });

  it("neq is the negation of eq, and holds for an absent value", () => {
    const c = cond("and", { field: "fld_a", operator: "neq", value: "entreprise" });
    expect(evaluateCondition(c, get({ fld_a: "particulier" }))).toBe(true);
    expect(evaluateCondition(c, get({ fld_a: "entreprise" }))).toBe(false);
    expect(evaluateCondition(c, get({}))).toBe(true);
  });

  it("contains is case-insensitive substring match", () => {
    const c = cond("and", { field: "fld_a", operator: "contains", value: "Acme" });
    expect(evaluateCondition(c, get({ fld_a: "groupe ACME sas" }))).toBe(true);
    expect(evaluateCondition(c, get({ fld_a: "autre" }))).toBe(false);
    expect(evaluateCondition(c, get({}))).toBe(false);
  });

  it("empty holds for undefined, null, '', whitespace-only and false", () => {
    const c = cond("and", { field: "fld_a", operator: "empty" });
    for (const v of [undefined, null, "", "   ", false]) {
      expect(evaluateCondition(c, get({ fld_a: v }))).toBe(true);
    }
    expect(evaluateCondition(c, get({ fld_a: "x" }))).toBe(false);
    expect(evaluateCondition(c, get({ fld_a: 0 }))).toBe(false);
    expect(evaluateCondition(c, get({ fld_a: true }))).toBe(false);
  });

  it("notEmpty is the negation of empty", () => {
    const c = cond("and", { field: "fld_a", operator: "notEmpty" });
    expect(evaluateCondition(c, get({ fld_a: "x" }))).toBe(true);
    expect(evaluateCondition(c, get({ fld_a: "" }))).toBe(false);
  });

  it("gt / lt compare numerically and refuse non-numbers", () => {
    const gt = cond("and", { field: "fld_a", operator: "gt", value: "10" });
    expect(evaluateCondition(gt, get({ fld_a: 11 }))).toBe(true);
    expect(evaluateCondition(gt, get({ fld_a: "11" }))).toBe(true);
    expect(evaluateCondition(gt, get({ fld_a: 10 }))).toBe(false);
    expect(evaluateCondition(gt, get({ fld_a: "abc" }))).toBe(false);
    expect(evaluateCondition(gt, get({}))).toBe(false);

    const lt = cond("and", { field: "fld_a", operator: "lt", value: "10" });
    expect(evaluateCondition(lt, get({ fld_a: 9 }))).toBe(true);
    expect(evaluateCondition(lt, get({ fld_a: 10 }))).toBe(false);
  });

  it("and requires every rule, or requires at least one", () => {
    const rules = [
      { field: "fld_a", operator: "eq" as const, value: "x" },
      { field: "fld_b", operator: "notEmpty" as const },
    ];
    expect(evaluateCondition({ logic: "and", rules }, get({ fld_a: "x", fld_b: "y" }))).toBe(true);
    expect(evaluateCondition({ logic: "and", rules }, get({ fld_a: "x" }))).toBe(false);
    expect(evaluateCondition({ logic: "or", rules }, get({ fld_a: "x" }))).toBe(true);
    expect(evaluateCondition({ logic: "or", rules }, get({}))).toBe(false);
  });

  it("an absent or empty condition is always true", () => {
    expect(evaluateCondition(null, get({}))).toBe(true);
    expect(evaluateCondition(undefined, get({}))).toBe(true);
    expect(evaluateCondition({ logic: "and", rules: [] }, get({}))).toBe(true);
  });

  it("a rule pointing at a deleted field reads as empty instead of crashing", () => {
    const c = cond("and", { field: "fld_gone", operator: "empty" });
    expect(evaluateCondition(c, get({}))).toBe(true);
  });
});

describe("resolveSubmission", () => {
  it("keeps visible values keyed by name and drops keys the form doesn't declare", () => {
    const def = oneStep([field("fld_a", "email"), field("fld_b", "firstname")]);
    const out = resolveSubmission(def, { email: "a@b.co", firstname: "Ana", injected: "x" });
    expect(out.values).toEqual({ email: "a@b.co", firstname: "Ana" });
    expect(out.unknown).toEqual(["injected"]);
    expect(out.missingRequired).toEqual([]);
  });

  it("drops the value of a field hidden by its condition, even if the browser sent it", () => {
    const def = oneStep([
      field("fld_a", "type"),
      field("fld_b", "company", {
        visibleIf: cond("and", { field: "fld_a", operator: "eq", value: "entreprise" }),
      }),
    ]);
    const out = resolveSubmission(def, { type: "particulier", company: "Acme" });
    expect(out.values).toEqual({ type: "particulier" });
    expect(out.hidden).toEqual(["company"]);
  });

  it("ignores required on a hidden field", () => {
    const def = oneStep([
      field("fld_a", "type"),
      field("fld_b", "company", {
        required: true,
        visibleIf: cond("and", { field: "fld_a", operator: "eq", value: "entreprise" }),
      }),
    ]);
    const out = resolveSubmission(def, { type: "particulier" });
    expect(out.missingRequired).toEqual([]);
  });

  it("reports a visible required field left empty", () => {
    const def = oneStep([field("fld_a", "email", { required: true, label: "Email" })]);
    const out = resolveSubmission(def, {});
    expect(out.missingRequired).toEqual([{ id: "fld_a", name: "email", label: "Email" }]);
  });

  it("requires a conditional field once its condition holds", () => {
    const def = oneStep([
      field("fld_a", "type"),
      field("fld_b", "company", {
        required: true,
        visibleIf: cond("and", { field: "fld_a", operator: "eq", value: "entreprise" }),
      }),
    ]);
    const out = resolveSubmission(def, { type: "entreprise" });
    expect(out.missingRequired).toEqual([{ id: "fld_b", name: "company", label: "company" }]);
  });

  it("cascades: a field depending on a hidden field sees it as empty", () => {
    const def = oneStep([
      field("fld_a", "type"),
      // B only shows for companies…
      field("fld_b", "size", {
        visibleIf: cond("and", { field: "fld_a", operator: "eq", value: "entreprise" }),
      }),
      // …and C only shows when B is filled. A hidden B must read as empty,
      // even though the browser sent a stale value for it.
      field("fld_c", "budget", {
        visibleIf: cond("and", { field: "fld_b", operator: "notEmpty" }),
      }),
    ]);
    const out = resolveSubmission(def, { type: "particulier", size: "10-50", budget: "5k" });
    expect(out.values).toEqual({ type: "particulier" });
    expect(out.hidden).toEqual(["size", "budget"]);
  });

  it("a hidden step hides every field it contains", () => {
    const def = form([
      { id: "stp_1", fields: [field("fld_a", "type")] },
      {
        id: "stp_2",
        visibleIf: cond("and", { field: "fld_a", operator: "eq", value: "entreprise" }),
        fields: [field("fld_b", "company"), field("fld_c", "size", { required: true })],
      },
    ]);
    const out = resolveSubmission(def, { type: "particulier", company: "Acme", size: "10" });
    expect(out.values).toEqual({ type: "particulier" });
    expect(out.hidden).toEqual(["company", "size"]);
    expect(out.missingRequired).toEqual([]);
  });

  it("normalizes primitives: strings trimmed, booleans and numbers kept as-is", () => {
    const def = oneStep([
      field("fld_a", "email"),
      field("fld_b", "optin", { type: "checkbox" }),
      field("fld_c", "size", { type: "number" }),
    ]);
    const out = resolveSubmission(def, { email: "  a@b.co ", optin: true, size: 12 });
    expect(out.values).toEqual({ email: "a@b.co", optin: true, size: 12 });
  });

  it("treats an empty submitted value as absent — not kept in values", () => {
    const def = oneStep([field("fld_a", "email"), field("fld_b", "phone")]);
    const out = resolveSubmission(def, { email: "a@b.co", phone: "" });
    expect(out.values).toEqual({ email: "a@b.co" });
  });

  it("refuses non-primitive values instead of forwarding them", () => {
    const def = oneStep([field("fld_a", "email")]);
    const out = resolveSubmission(def, { email: { nested: "object" } as never });
    expect(out.values).toEqual({});
    expect(out.unknown).toEqual([]);
  });
});
