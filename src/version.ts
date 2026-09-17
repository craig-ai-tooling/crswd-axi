// The version, read from package.json rather than written twice.
//
// A hard-coded string here is a string that goes stale at the first release
// and reports the wrong tool to whoever is debugging it.

import { readFileSync } from "node:fs";

export const VERSION: string = (() => {
  try {
    const path = new URL("../package.json", import.meta.url);
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object") {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === "string" && version) return version;
    }
  } catch {
    // Falls through to the honest answer below.
  }
  return "unknown";
})();
