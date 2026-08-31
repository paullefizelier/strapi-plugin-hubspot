import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { CompanyMap } from "../types";
import { render } from "./testUtils";

// The schema hook fetches through the admin client — canned portal instead.
vi.mock("@strapi/strapi/admin", () => ({
  useFetchClient: () => ({
    get: async () => ({
      data: {
        configured: true,
        objects: ["contact", "company"],
        unavailable: [],
        properties: [
          { name: "name", label: "Name", object: "company", options: [] },
          { name: "siret_custom", label: "SIRET", object: "company", options: [] },
          { name: "city", label: "City", object: "contact", options: [] },
        ],
      },
    }),
  }),
}));

import CompanyMapEditor from "../CompanyMapEditor";

describe("CompanyMapEditor", () => {
  it("renders one row per MAPPED datum only, plus the add-select", () => {
    const map: CompanyMap = {
      name: { object: "company", property: "name" },
      siret: { object: "company", property: "siret_custom" },
    };
    render(<CompanyMapEditor map={map} onChange={() => {}} />);
    expect(screen.getByText("Legal name")).toBeDefined();
    expect(screen.getByText("SIRET")).toBeDefined();
    // Unmapped data don't clutter the 380px sidebar…
    expect(screen.queryByText("Postal code")).toBeNull();
    // …they live behind the add-select.
    expect(screen.getAllByText(/send another datum/i).length).toBeGreaterThan(0);
  });

  it("removing a row drops the datum from the map", () => {
    const onChange = vi.fn();
    const map: CompanyMap = {
      name: { object: "company", property: "name" },
      city: { object: "contact", property: "city" },
    };
    render(<CompanyMapEditor map={map} onChange={onChange} />);
    const removeButtons = screen.getAllByRole("button", { name: /stop sending this datum/i });
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]!);
    expect(onChange).toHaveBeenCalledWith({ city: { object: "contact", property: "city" } });
  });

  it("hides the add-select once every datum is mapped", () => {
    const all: CompanyMap = Object.fromEntries(
      ["name", "siret", "siren", "address", "zip", "city", "headquarters", "naf", "nafLabel", "headcount"].map(
        (d) => [d, { object: "company", property: "x" }],
      ),
    ) as CompanyMap;
    render(<CompanyMapEditor map={all} onChange={() => {}} />);
    expect(screen.queryByText(/send another datum/i)).toBeNull();
  });
});
