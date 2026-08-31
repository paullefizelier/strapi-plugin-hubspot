import * as React from "react";
import { IntlProvider } from "react-intl";
import { DesignSystemProvider } from "@strapi/design-system";
import { render as rtlRender, type RenderResult } from "@testing-library/react";

/** Render under the providers every builder component assumes. */
export function render(ui: React.ReactElement): RenderResult {
  return rtlRender(
    <DesignSystemProvider>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        {ui}
      </IntlProvider>
    </DesignSystemProvider>,
  );
}
