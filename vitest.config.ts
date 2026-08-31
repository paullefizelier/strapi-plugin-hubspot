import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // RTL's auto-cleanup hooks into the global afterEach.
    globals: true,
    environment: "node",
    include: ["server/src/**/*.test.ts", "admin/src/**/*.test.tsx"],
    // Admin component tests run in a DOM; server logic stays on node.
    environmentMatchGlobs: [["admin/**", "jsdom"]],
    // The Strapi admin packages ship "type": "module" with CJS entry files,
    // and pull CJS deps (lodash…) through named imports: the web optimizer
    // prebundles the whole graph with proper interop, like a browser build.
    deps: {
      optimizer: {
        web: {
          enabled: true,
          include: [
            "@strapi/design-system",
            "@strapi/ui-primitives",
            "@strapi/icons",
            "styled-components",
            "react-intl",
            "@testing-library/react",
            "react",
            "react-dom",
            "react/jsx-runtime",
            "react-dom/client",
          ],
        },
      },
    },
  },
});
