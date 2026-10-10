// 0.2.0 stands on the host's public surfaces only. This pins what the plugin asks of the host:
// - the host half needs only webServer and sessions (trusted hosts are read from whichever startup service exists);
// - the client half registers the gallery page and the three previews with the host's right sidebar, and registers
//   with dsh-better-sidebar only when that plugin is there.
// Run: node test/host-surface.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inject as hostInject, trustedHostsOf } from "../index.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };

t("the host half needs only the web server and the sessions", () => {
  assert.deepEqual(hostInject, ["webServer", "sessions"]);
});
t("trusted hosts come from webStartup (DSH alpha.2+) or webRuntime (earlier), when present", () => {
  assert.deepEqual(trustedHostsOf({ get: (name) => (name === "webStartup" ? { trustedHosts: ["tv.lan:3180"] } : undefined) }), ["tv.lan:3180"]);
  assert.deepEqual(trustedHostsOf({ get: (name) => (name === "webRuntime" ? { trustedHosts: ["old.lan"] } : undefined) }), ["old.lan"]);
  assert.deepEqual(trustedHostsOf({ get: () => { throw new Error("cannot get property without inject"); } }), []);
  assert.deepEqual(trustedHostsOf({ webRuntime: { trustedHosts: ["plain.lan"] } }), ["plain.lan"]);
  assert.deepEqual(trustedHostsOf({}), []);
});

// Load the browser bundle the way the shell does, with just enough of React for registration (nothing renders here).
const source = readFileSync(fileURLToPath(new URL("../client.js", import.meta.url)), "utf8");
function loadClient() {
  let definition;
  globalThis.window = { __ModuleLoader__: { load: (d) => { definition = d; } } };
  new Function(source)();
  const react = { createElement: () => null, useState: () => [undefined, () => {}], useEffect: () => {}, useRef: () => ({}), useMemo: (f) => f(), useCallback: (f) => f, Fragment: "f" };
  return definition.factory((name) => { if (name === "react") return react; throw new Error("unexpected require " + name); });
}

function fakeHost({ documentPreviews = true, betterSidebar = false } = {}) {
  const calls = { tabs: [], slots: [], previews: [], bs: [], effects: [] };
  const slots = {
    inject: (name, fn) => { const r = fn(); return typeof r === "function" ? r : () => {}; },
    register: (decl, component) => { calls.slots.push({ ...decl, component }); return () => {}; },
  };
  const services = {
    ...(documentPreviews ? { documentPreviews: { register: (d) => { calls.previews.push(d); return () => {}; } } } : {}),
    ...(betterSidebar ? { betterSidebar: {
      registerFileViewer: (d) => { calls.bs.push(["viewer", d.id]); return () => {}; },
      registerTab: (d) => { calls.bs.push(["tab", d.id]); return () => {}; },
    } } : {}),
  };
  const ctx = {
    slots,
    sidebarRightTabs: { register: (d) => { calls.tabs.push(d); return () => {}; } },
    effect: (fn, label) => { calls.effects.push(label); const r = fn(); return r; },
    get: () => undefined,
    // Like the host: the callback runs only when every named service is there.
    inject: (names, cb) => { if (names.every((name) => name in services)) cb({ ...ctx, ...services }); },
  };
  return { ctx, calls };
}

const client = loadClient();

t("the client half needs only the slots and the right sidebar's tab registry", () => {
  assert.deepEqual(client.inject, ["slots", "sidebarRightTabs"]);
});
t("registers the gallery as a page of the host's right sidebar, with a guide entry", () => {
  const { ctx, calls } = fakeHost();
  client.apply(ctx);
  assert.equal(calls.tabs.length, 1);
  const tab = calls.tabs[0];
  assert.equal(tab.kind, "vibedev-media-gallery");
  assert.equal(tab.patterns, undefined, "a page type, opened by kind");
  assert.equal(tab.title(), "媒体画廊");
  assert.equal(tab.guide[0].title(), "媒体画廊");
  const names = calls.slots.map((slot) => slot.name);
  assert.ok(names.includes("sidebar.right.pane.tab"), "gallery body");
  assert.ok(names.includes("sidebar.right.tab.files.actions"), "file tree button");
  assert.ok(names.includes("sidebar.right.tab.document.actions"), "document toolbar button");
  const body = calls.slots.find((slot) => slot.name === "sidebar.right.pane.tab");
  assert.equal(body.key, tab.id, "the body registers under the type's id");
});
t("registers video, audio and HTML as host document previews that load their own content", () => {
  const { ctx, calls } = fakeHost();
  client.apply(ctx);
  assert.deepEqual(calls.previews.map((p) => p.id), ["@vibedev-si/dsh-media-viewer/video", "@vibedev-si/dsh-media-viewer/audio", "@vibedev-si/dsh-media-viewer/html"]);
  for (const preview of calls.previews) {
    assert.equal(preview.loading, "renderer");
    assert.equal(preview.priority, "extension");
    assert.equal(calls.slots.some((slot) => slot.name === "sidebar.right.tab.document" && slot.key === preview.id), true, preview.id + " body");
  }
  assert.ok(calls.previews[0].extensions.includes("mp4") && calls.previews[0].binaryExtensions.includes("mp4"));
  assert.ok(calls.previews[1].extensions.includes("mp3"));
  assert.deepEqual(calls.previews[2].binaryExtensions, [], "HTML source stays readable as text");
});
t("without dsh-better-sidebar nothing waits for it, and nothing is registered with it", () => {
  const { ctx, calls } = fakeHost({ betterSidebar: false });
  client.apply(ctx);
  assert.deepEqual(calls.bs, []);
});
t("with dsh-better-sidebar the viewers also live inside it (its editor claims every file first); the gallery stays one host page", () => {
  const { ctx, calls } = fakeHost({ betterSidebar: true });
  client.apply(ctx);
  assert.deepEqual(calls.bs, [["viewer", "mp:video"], ["viewer", "mp:audio"], ["viewer", "mp:html"]]);
  assert.equal(calls.tabs.length, 1, "the native gallery is still there");
});
t("without the host's preview package the gallery still registers", () => {
  const { ctx, calls } = fakeHost({ documentPreviews: false });
  client.apply(ctx);
  assert.equal(calls.previews.length, 0);
  assert.equal(calls.tabs.length, 1);
});
t("reads the host's file addresses (session scope; Windows drives, spaces, CJK)", () => {
  const parse = client.internals.parseSessionAddress;
  assert.deepEqual(parse("dsh-resource://file/session/s1/C:/Users/me/%E8%A7%86%E9%A2%91/a%20b.mp4"), { sessionId: "s1", path: "C:/Users/me/视频/a b.mp4" });
  assert.deepEqual(parse("dsh-resource://file/session/s%2F2/clips/x.mp3?line=1"), { sessionId: "s/2", path: "clips/x.mp3" });
  assert.equal(parse("dsh-resource://file/absolute/C:/x.mp4"), null);
  assert.equal(parse("sidebar://guide"), null);
  assert.equal(parse("dsh-resource://file/session/s1/%E0%A4%A"), null);
});

console.log("\n" + n + " host-surface tests passed");
