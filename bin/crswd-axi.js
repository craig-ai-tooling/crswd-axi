#!/usr/bin/env node
// The compiled entry point lives in dist/, which is not in git. `prepare` in
// package.json builds it on install, including a `npm install github:...`.
//
// If it is missing anyway -- a checkout someone has never built, an install
// where `prepare` was skipped -- say that, with the command that fixes it. The
// bare `import()` this replaced failed with a module-resolver stack trace
// naming a dist path, which is not a sentence anyone can act on.
import { fileURLToPath } from "node:url";

try {
  await import(new URL("../dist/index.js", import.meta.url).href);
} catch (err) {
  if (err && err.code === "ERR_MODULE_NOT_FOUND") {
    const root = fileURLToPath(new URL("..", import.meta.url));
    process.stdout.write(
      "error: crswd-axi is not built -- dist/ is missing\n" +
        `suggestion: npm install --prefix ${root} && npm run build --prefix ${root}\n`,
    );
    process.exit(1);
  }
  throw err;
}
