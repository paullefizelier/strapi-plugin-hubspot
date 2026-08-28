// Guards the packaging bug that shipped in 0.6.0: a module used by the admin
// but absent from dependencies/peerDependencies gets INLINED into the bundle
// instead of externalized. For context-based libraries (react-router-dom,
// react…) a second copy means a second React context — the plugin's <Routes>
// can't see the host's <Router> and the admin page crashes with a bare
// production "Error" (the stripped react-router invariant).
//
// Runs after `strapi-plugin build`. Fails when a dist chunk carries an inlined
// copy of a library that must stay external.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Source markers that only appear when the library's code was inlined. */
const INLINED_MARKERS = {
  "react-router-dom": ["v7_relativeSplatPath", "useRoutes() may be used only"],
  react: ["react.development.js", "react.production.min.js"],
};

const dirs = ["dist/admin", "dist/_chunks"];
const offenders = [];

for (const dir of dirs) {
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    continue;
  }
  for (const file of files) {
    if (!/\.(js|mjs)$/.test(file)) continue;
    const content = readFileSync(join(dir, file), "utf8");
    for (const [lib, markers] of Object.entries(INLINED_MARKERS)) {
      if (markers.some((marker) => content.includes(marker))) {
        offenders.push(`${join(dir, file)} inlines ${lib}`);
      }
    }
  }
}

if (offenders.length) {
  console.error(
    "Externalization check failed — add the library to peerDependencies so the host provides it:\n" +
      offenders.map((o) => `  - ${o}`).join("\n"),
  );
  process.exit(1);
}
console.log("check-externals: no inlined copy of a must-be-external library.");
