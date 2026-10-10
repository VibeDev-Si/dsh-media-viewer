// The gallery's "加入画布" talks to the 影视工作台 plugin (dsh-film-studio) through one
// DOM event only. This pins that contract, so a rename on either side is caught here
// instead of as a silent no-op in the gallery.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../client.js", import.meta.url)), "utf8");
const checks = [
  ["dispatches the workbench event", /new CustomEvent\("vibedev-film:add-media", \{ detail: detail \}\)/],
  ["sends absolute paths and the gallery session", /var detail = \{ paths: paths, sessionId: sessionId, accepted: false, respond: resolve \}/],
  ["reports a missing workbench instead of waiting forever", /if \(!detail\.accepted\) resolve\(\{ ok: false/],
  ["only offers what the canvas takes (image, video, audio)", /function canAddToCanvas\(it\) \{ return it\.kind === "image" \|\| it\.kind === "video" \|\| it\.kind === "audio"; \}/],
];
let failed = 0;
for (const [name, pattern] of checks) {
  if (pattern.test(source)) console.log("ok  " + name);
  else { console.error("FAIL " + name); failed++; }
}
if (failed) process.exit(1);
console.log("\n" + checks.length + " add-to-canvas tests passed");
