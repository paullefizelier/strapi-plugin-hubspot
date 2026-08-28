import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * Correctness-focused lint — style stays the editor's business. The two
 * rules relaxed below are deliberate: Strapi's document-service generics are
 * unusable without `as never` casts, and interop types lean on `any` at the
 * plugin boundary.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["admin/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    // Only the two historical rules: the v6 additions (set-state-in-effect…)
    // flag load-then-setState patterns that are deliberate here.
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
);
