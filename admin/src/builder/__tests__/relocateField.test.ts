import { describe, expect, it } from "vitest";
import { relocateField } from "../relocateField";

const steps = (
  bags: { id: string; fields: string[] }[],
) => bags.map((bag) => ({ id: bag.id, fields: bag.fields.map((id) => ({ id })) }));

const ids = (result: { fields: { id: string }[] }[]) =>
  result.map((step) => step.fields.map((field) => field.id));

describe("relocateField", () => {
  it("reorders a field inside its step", () => {
    expect(
      ids(
        relocateField(steps([{ id: "s1", fields: ["a", "b", "c"] }]), "a", "c"),
      ),
    ).toEqual([["b", "c", "a"]]);
  });

  it("moves a field before a field of another step", () => {
    expect(
      ids(
        relocateField(
          steps([
            { id: "s1", fields: ["a", "b"] },
            { id: "s2", fields: ["c", "d"] },
          ]),
          "b",
          "c",
        ),
      ),
    ).toEqual([["a"], ["b", "c", "d"]]);
  });

  it("appends a field onto an empty step via its container droppable", () => {
    expect(
      ids(
        relocateField(
          steps([
            { id: "s1", fields: ["a"] },
            { id: "s2", fields: [] },
          ]),
          "a",
          "container:s2",
        ),
      ),
    ).toEqual([[], ["a"]]);
  });

  it("appends onto a step when the drop target is the step card itself", () => {
    expect(
      ids(
        relocateField(
          steps([
            { id: "s1", fields: ["a", "b"] },
            { id: "s2", fields: ["c"] },
          ]),
          "a",
          "s2",
        ),
      ),
    ).toEqual([["b"], ["c", "a"]]);
  });

  it("is a no-op when the field or the target is unknown", () => {
    const input = steps([{ id: "s1", fields: ["a"] }]);
    expect(relocateField(input, "missing", "a")).toBe(input);
    expect(relocateField(input, "a", "nope")).toBe(input);
  });
});
