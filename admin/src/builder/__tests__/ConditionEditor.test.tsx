import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import ConditionEditor from "../ConditionEditor";
import type { Condition, FormField } from "../types";
import { render } from "./testUtils";

const candidates: FormField[] = [
  { id: "fld_type", name: "type", label: "Type de contact", type: "select",
    options: [{ value: "pme", label: "PME" }, { value: "eti", label: "ETI" }] },
  { id: "fld_email", name: "email", label: "Email", type: "email" },
];

describe("ConditionEditor", () => {
  it("explains itself when no earlier field can be referenced", () => {
    render(<ConditionEditor condition={null} candidates={[]} onChange={() => {}} />);
    expect(
      screen.getByText(/Conditions can only read fields placed earlier/i),
    ).toBeDefined();
  });

  it("adds a first rule targeting the first earlier field", () => {
    const onChange = vi.fn();
    render(<ConditionEditor condition={null} candidates={candidates} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add a rule/i }));
    expect(onChange).toHaveBeenCalledWith({
      logic: "and",
      rules: [{ field: "fld_type", operator: "eq", value: "" }],
    });
  });

  it("renders an existing rule and removes it back to null", () => {
    const onChange = vi.fn();
    const condition: Condition = {
      logic: "and",
      rules: [{ field: "fld_type", operator: "eq", value: "pme" }],
    };
    render(
      <ConditionEditor condition={condition} candidates={candidates} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove this rule/i }));
    // Last rule removed → the condition itself dissolves.
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows the AND/OR selector only from the second rule on", () => {
    const one: Condition = { logic: "and", rules: [{ field: "fld_type", operator: "eq", value: "pme" }] };
    const { rerender: _r, unmount } = render(
      <ConditionEditor condition={one} candidates={candidates} onChange={() => {}} />,
    );
    expect(screen.queryByText(/All rules \(AND\)/i)).toBeNull();
    unmount();

    const two: Condition = {
      logic: "and",
      rules: [
        { field: "fld_type", operator: "eq", value: "pme" },
        { field: "fld_email", operator: "notEmpty" },
      ],
    };
    render(<ConditionEditor condition={two} candidates={candidates} onChange={() => {}} />);
    expect(screen.getAllByText(/All rules \(AND\)/i).length).toBeGreaterThan(0);
  });

  it("value cell: no input for presence operators, list input for in/notIn without options", () => {
    const presence: Condition = {
      logic: "and",
      rules: [{ field: "fld_email", operator: "notEmpty" }],
    };
    const { unmount } = render(
      <ConditionEditor condition={presence} candidates={candidates} onChange={() => {}} />,
    );
    expect(screen.queryByRole("textbox", { name: /^value(s)?$/i })).toBeNull();
    unmount();

    // `in` targeting a field WITHOUT declared options → free comma list.
    const listRule: Condition = {
      logic: "and",
      rules: [{ field: "fld_email", operator: "in", values: ["a", "b"] }],
    };
    render(<ConditionEditor condition={listRule} candidates={candidates} onChange={() => {}} />);
    const input = screen.getByPlaceholderText("value1, value2…") as HTMLInputElement;
    expect(input.defaultValue).toBe("a, b");
  });

  it("commits the comma list on blur, trimmed and de-emptied", () => {
    const onChange = vi.fn();
    const condition: Condition = {
      logic: "and",
      rules: [{ field: "fld_email", operator: "in", values: [] }],
    };
    render(
      <ConditionEditor condition={condition} candidates={candidates} onChange={onChange} />,
    );
    const input = screen.getByPlaceholderText("value1, value2…");
    fireEvent.blur(input, { target: { value: " pme ,  , eti " } });
    expect(onChange).toHaveBeenCalledWith({
      logic: "and",
      rules: [{ field: "fld_email", operator: "in", values: ["pme", "eti"] }],
    });
  });
});
