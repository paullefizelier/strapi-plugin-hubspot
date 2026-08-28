// `strapi-plugin build` only bundles the strapi-admin/strapi-server entries;
// the `./types` export is types-only, so its artifacts are assembled here:
// the .d.ts is the source itself, the .js/.mjs are empty runtime stubs.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";

mkdirSync("dist/shared", { recursive: true });
copyFileSync("shared/types.ts", "dist/shared/types.d.ts");
writeFileSync("dist/shared/types.js", "// types-only entry\nmodule.exports = {};\n");
writeFileSync("dist/shared/types.mjs", "// types-only entry\nexport default {};\n");
