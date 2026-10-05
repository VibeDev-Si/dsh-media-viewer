/*!
 * dsh-media-viewer — client half (browser bundle, no build step).
 *
 * Registers with dsh-better-sidebar through `ctx.betterSidebar`:
 *   - file viewers: video (mp4/webm/mov/...), audio (mp3/wav/...), html
 *   - a tab: "媒体画廊", a thumbnail grid of the media in a folder
 *
 * Bundle format: the official DSH client-bundle shape, a CommonJS-style
 * factory registered through window.__ModuleLoader__.load. `react` is resolved
 * from the shell's module table; everything else is inlined.
 */
window.__ModuleLoader__.load({
  id: "@vibedev-si/dsh-media-viewer",
  factory: (require) => {
    var module = { exports: {} };
    "use strict";

    var R = require("react");
    var h = R.createElement;
    var useState = R.useState;
    var useEffect = R.useEffect;
    var useRef = R.useRef;
    var useMemo = R.useMemo;
    var useCallback = R.useCallback;

    // ── file kinds ──────────────────────────────────────────────────────────

    var VIDEO_EXTS = ["mp4", "m4v", "webm", "ogv", "mov", "qt", "mkv", "avi", "wmv", "flv", "mpeg", "mpg", "3gp", "m2ts"];
    var AUDIO_EXTS = ["mp3", "wav", "m4a", "aac", "oga", "ogg", "opus", "flac", "weba", "aif", "aiff"];
    var HTML_EXTS = ["html", "htm"];
    var IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"];

    function extOf(p) {
      var m = /\.([^.\\/]+)$/.exec(p || "");
      return m ? m[1].toLowerCase() : "";
    }
    function kindOf(p) {
      var e = extOf(p);
      if (VIDEO_EXTS.indexOf(e) >= 0) return "video";
      if (AUDIO_EXTS.indexOf(e) >= 0) return "audio";
      if (HTML_EXTS.indexOf(e) >= 0) return "html";
      if (IMAGE_EXTS.indexOf(e) >= 0) return "image";
      return "other";
    }
    function isAbs(p) { return /^([A-Za-z]:[\\/]|[\\/])/.test(p); }
    function absOf(scope, p) {
      if (isAbs(p)) return p;
      var c = (scope && scope.cwd) || "";
      return c ? c.replace(/[\\/]+$/, "") + "/" + p : p;
    }
    function baseName(p) { return (p || "").split(/[\\/]/).filter(Boolean).pop() || p; }
    function dirName(p) { return (p || "").replace(/[\\/][^\\/]*$/, ""); }

    /** Path-encoded route URL (relative assets of an HTML page resolve inside it). */
    function fileUrl(scope, abs, query) {
      var unc = /^[\\/]{2}[^\\/]/.test(abs);
      var segs = abs.split(/[\\/]+/).filter(Boolean);
      return "/mp/f/" + encodeURIComponent(scope.sessionId) + "/" + (unc ? "/" : "") +
        segs.map(encodeURIComponent).join("/") + (query ? "?" + query : "");
    }

    function fmtSize(n) {
      if (n == null) return "";
      if (n < 1024) return n + " B";
      if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
      if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
      return (n / 1073741824).toFixed(2) + " GB";
    }
    function fmtTime(ms) {
      if (!ms) return "";
      var d = new Date(ms);
      function p(x) { return x < 10 ? "0" + x : "" + x; }
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    }
    function fmtDur(s) {
      if (!isFinite(s)) return "";
      s = Math.round(s);
      var m = Math.floor(s / 60), r = s % 60;
      return m + ":" + (r < 10 ? "0" + r : r);
    }

    // ── styling helpers ─────────────────────────────────────────────────────

    // Colours: ONLY variables the host really defines (--dsw-alias-bg-base, -bg-layer-1/2, -bg-overlay, -border-l1/l2,
    // -brand-primary, -label-primary/secondary, -state-*). An earlier version used three names it had guessed
    // (a "bg-primary", a "surface-primary" and a "link-normal"): the host has none of them, so the fallback (#fff)
    // was always used and the gallery lightbox came out white, with light text on it, in the dark theme.
    // test/tokens.test.mjs now rejects any --dsw-* name that is not on the real list.
    var C = {
      bg: "var(--dsw-alias-bg-base, #fff)",
      fg: "var(--dsw-alias-label-primary, #1b1d24)",
      muted: "var(--dsw-alias-label-secondary, #6c7080)",
      link: "var(--dsw-alias-brand-primary, #2f6fe0)",
      line: "rgba(127,127,127,.28)",
      soft: "rgba(127,127,127,.10)",
      softer: "rgba(127,127,127,.06)",
      accent: "#7254f5", // a white label on it is 4.88:1 (the old #7c5cff gave 4.35:1)
    };

    var btnBase = {
      display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 9px",
      fontSize: "12px", lineHeight: "18px", borderRadius: "6px", cursor: "pointer",
      border: "1px solid " + C.line, background: "transparent", color: "inherit",
      textDecoration: "none", whiteSpace: "nowrap", flex: "none",
    };
    function btn(extra) {
      var o = {};
      for (var k in btnBase) o[k] = btnBase[k];
      if (extra) for (var j in extra) o[j] = extra[j];
      return o;
    }
    function Btn(p) {
      return h("button", {
        type: "button", title: p.title, onClick: p.onClick, disabled: p.disabled,
        style: btn(p.active ? { background: C.accent, borderColor: C.accent, color: "#fff" } : p.disabled ? { opacity: 0.5, cursor: "default" } : null),
      }, p.children);
    }

    function svg(size, children) {
      return h("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", style: { flex: "none" } }, children);
    }
    function pathEl(d, extra) {
      var o = { d: d, stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };
      if (extra) for (var k in extra) o[k] = extra[k];
      return h("path", o);
    }
    function IconVideo(size) {
      return svg(size, [
        h("rect", { key: "a", x: 1.5, y: 3, width: 13, height: 10, rx: 2, stroke: "currentColor", strokeWidth: 1.5 }),
        h("path", { key: "b", d: "m6.5 5.9 3.9 2.1-3.9 2.1z", fill: "currentColor" }),
      ]);
    }
    function IconAudio(size) {
      return svg(size, [
        pathEl("M6 11.5V3.5l7-1.5v8", { key: "a" }),
        h("circle", { key: "b", cx: 4.5, cy: 11.5, r: 1.8, stroke: "currentColor", strokeWidth: 1.5 }),
        h("circle", { key: "c", cx: 11.5, cy: 10, r: 1.8, stroke: "currentColor", strokeWidth: 1.5 }),
      ]);
    }
    function IconHtml(size) {
      return svg(size, [pathEl("m5.5 4.5-3.2 3.5 3.2 3.5M10.5 4.5l3.2 3.5-3.2 3.5M9 3l-2 10", { key: "a" })]);
    }
    function IconImage(size) {
      return svg(size, [
        h("rect", { key: "a", x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, stroke: "currentColor", strokeWidth: 1.5 }),
        h("circle", { key: "b", cx: 5.5, cy: 6, r: 1.2, fill: "currentColor" }),
        pathEl("m2 12 4-3.5 3 2.5 2-1.5 3 2.5", { key: "c" }),
      ]);
    }
    function IconFolder(size) {
      return svg(size, [pathEl("M1.8 4.2c0-.7.5-1.2 1.2-1.2h3l1.5 1.7H13c.7 0 1.2.5 1.2 1.2v6.1c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z", { key: "a" })]);
    }
    function IconGrid(size) {
      return svg(size, [
        h("rect", { key: "a", x: 2, y: 2, width: 5, height: 5, rx: 1, stroke: "currentColor", strokeWidth: 1.5 }),
        h("rect", { key: "b", x: 9, y: 2, width: 5, height: 5, rx: 1, stroke: "currentColor", strokeWidth: 1.5 }),
        h("rect", { key: "c", x: 2, y: 9, width: 5, height: 5, rx: 1, stroke: "currentColor", strokeWidth: 1.5 }),
        h("rect", { key: "d", x: 9, y: 9, width: 5, height: 5, rx: 1, stroke: "currentColor", strokeWidth: 1.5 }),
      ]);
    }
    function kindIcon(kind, size) {
      return kind === "video" ? IconVideo(size) : kind === "audio" ? IconAudio(size) : kind === "html" ? IconHtml(size) : IconImage(size);
    }

    // ── shared pieces ───────────────────────────────────────────────────────

    /** Header row: title (ellipsis) + actions. */
    function Bar(p) {
      return h("div", {
        style: { display: "flex", alignItems: "center", gap: "6px", flex: "none", fontSize: "12px", minWidth: 0, flexWrap: "wrap" },
      }, [
        h("span", { key: "t", title: p.path, style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1 1 120px", minWidth: 0, color: C.muted } }, p.title),
        p.children,
      ]);
    }

    function openGallery(props, abs) {
      try {
        props.ctx.betterSidebar.openTab({ type: "mp:gallery", path: dirName(abs), title: baseName(dirName(abs)) || "媒体画廊" }, props.scope);
      } catch (e) { console.error("[dsh-media-viewer] open gallery failed", e); }
    }

    function CommonActions(props, abs, url) {
      var out = [
        h("a", { key: "new", href: url, target: "_blank", rel: "noopener", style: btn(), title: "在新窗口打开" }, "新窗口"),
        h("a", { key: "dl", href: fileUrl(props.scope, abs, "download=1"), download: baseName(abs), style: btn(), title: "下载原文件" }, "下载"),
      ];
      if (!props.hideGallery) {
        out.push(h(Btn, { key: "gal", title: "浏览所在文件夹的全部媒体", onClick: function () { openGallery(props, abs); } }, [IconGrid(12), "画廊"]));
      }
      return out;
    }

    var RATES = [0.5, 1, 1.5, 2];

    function RatePicker(p) {
      return RATES.map(function (r) {
        return h(Btn, { key: r, active: p.rate === r, title: "播放速度 " + r + "x", onClick: function () { p.set(r); } }, r + "x");
      });
    }

    function Shell(p) {
      return h("div", {
        style: { display: "flex", flexDirection: "column", gap: "8px", padding: "10px", minWidth: 0, minHeight: 0, height: "100%", boxSizing: "border-box" },
      }, p.children);
    }

    // ── video ───────────────────────────────────────────────────────────────

    function VideoView(props) {
      var abs = absOf(props.scope, props.path);
      var url = fileUrl(props.scope, abs);
      var vref = useRef(null);
      var st = useState(1), rate = st[0], setRate = st[1];
      var lp = useState(false), loop = lp[0], setLoop = lp[1];
      var er = useState(null), err = er[0], setErr = er[1];
      var du = useState(null), dur = du[0], setDur = du[1];
      var dims = useState(null), dim = dims[0], setDim = dims[1];

      useEffect(function () { setErr(null); setDur(null); setDim(null); }, [url]);
      useEffect(function () { if (vref.current) vref.current.playbackRate = rate; }, [rate, url]);

      var info = [dur != null ? fmtDur(dur) : null, dim ? dim : null, extOf(abs).toUpperCase()].filter(Boolean).join(" · ");

      return h(Shell, null, [
        h("div", { key: "stage", style: { flex: "1 1 auto", minHeight: 0, display: "flex", background: "#000", borderRadius: "8px", overflow: "hidden" } },
          err
            ? h("div", { style: { margin: "auto", padding: "20px", textAlign: "center", color: "#ddd", fontSize: "13px", lineHeight: 1.7 } }, [
                h("div", { key: 1 }, "浏览器无法解码这个视频"),
                h("div", { key: 2, style: { color: "#999", fontSize: "12px" } }, err),
                h("div", { key: 3, style: { marginTop: "8px" } }, h("a", { href: fileUrl(props.scope, abs, "download=1"), download: baseName(abs), style: { color: C.link } }, "下载后用本地播放器打开")),
              ])
            : h("video", {
                key: url, ref: vref, src: url, controls: true, loop: loop, preload: "metadata", playsInline: true,
                style: { width: "100%", height: "100%", objectFit: "contain", background: "#000", outline: "none" },
                onLoadedMetadata: function (e) {
                  setDur(e.target.duration);
                  if (e.target.videoWidth) setDim(e.target.videoWidth + "×" + e.target.videoHeight);
                },
                onError: function (e) {
                  var code = e.target && e.target.error ? e.target.error.code : 0;
                  setErr(code === 4 ? "格式或编码不受支持（常见于 H.265 / 非标准封装）" : "加载失败（错误码 " + code + "）");
                },
              })),
        h(Bar, { key: "bar", title: baseName(abs) + (info ? "  ·  " + info : ""), path: abs }, [
          h(RatePicker, { key: "rate", rate: rate, set: setRate }),
          h(Btn, { key: "loop", active: loop, title: "循环播放", onClick: function () { setLoop(!loop); } }, "循环"),
          CommonActions(props, abs, url),
        ]),
      ]);
    }

    // ── audio ───────────────────────────────────────────────────────────────

    function AudioView(props) {
      var abs = absOf(props.scope, props.path);
      var url = fileUrl(props.scope, abs);
      var aref = useRef(null);
      var cref = useRef(null);
      var st = useState(1), rate = st[0], setRate = st[1];
      var lp = useState(false), loop = lp[0], setLoop = lp[1];
      var er = useState(null), err = er[0], setErr = er[1];
      var du = useState(null), dur = du[0], setDur = du[1];

      useEffect(function () { setErr(null); setDur(null); }, [url]);
      useEffect(function () { if (aref.current) aref.current.playbackRate = rate; }, [rate, url]);

      // Spectrum bars. Same-origin media, so the analyser is allowed to read it.
      useEffect(function () {
        var a = aref.current, cv = cref.current;
        if (!a || !cv) return undefined;
        var ac, an, data, raf = 0, dead = false;
        function draw() {
          if (dead) return;
          raf = requestAnimationFrame(draw);
          var g = cv.getContext("2d");
          var w = cv.width, hh = cv.height;
          g.clearRect(0, 0, w, hh);
          var n = data.length, bw = w / n;
          an.getByteFrequencyData(data);
          var grad = g.createLinearGradient(0, hh, 0, 0);
          grad.addColorStop(0, "#7c5cff");
          grad.addColorStop(1, "#22d3ee");
          g.fillStyle = grad;
          for (var i = 0; i < n; i++) {
            var bh = Math.max(2, (data[i] / 255) * hh);
            g.fillRect(i * bw + 1, hh - bh, Math.max(1, bw - 2), bh);
          }
        }
        function start() {
          if (ac) { if (ac.state === "suspended") ac.resume(); return; }
          try {
            var AC = window.AudioContext || window.webkitAudioContext;
            ac = new AC();
            var src = ac.createMediaElementSource(a);
            an = ac.createAnalyser();
            an.fftSize = 128;
            an.smoothingTimeConstant = 0.8;
            src.connect(an);
            an.connect(ac.destination);
            data = new Uint8Array(an.frequencyBinCount);
            draw();
          } catch (e) { /* visualiser is decoration; playback must not depend on it */ }
        }
        a.addEventListener("play", start);
        return function () {
          dead = true;
          cancelAnimationFrame(raf);
          a.removeEventListener("play", start);
          try { if (ac) ac.close(); } catch (e) { /* ignore */ }
        };
      }, [url]);

      return h(Shell, null, [
        h("div", {
          key: "stage",
          style: {
            flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: "14px", padding: "16px", borderRadius: "10px", background: "linear-gradient(145deg, rgba(124,92,255,.14), rgba(34,211,238,.10))",
          },
        }, [
          h("div", { key: "ic", style: { width: "72px", height: "72px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#7c5cff,#22d3ee)", color: "#fff" } }, IconAudio(34)),
          h("div", { key: "nm", style: { fontSize: "14px", fontWeight: 600, textAlign: "center", wordBreak: "break-all" } }, baseName(abs)),
          h("canvas", { key: "cv", ref: cref, width: 320, height: 64, style: { width: "100%", maxWidth: "320px", height: "64px" } }),
          err
            ? h("div", { key: "er", style: { color: C.muted, fontSize: "12px" } }, err)
            : h("audio", {
                key: url, ref: aref, src: url, controls: true, loop: loop, preload: "metadata", style: { width: "100%", maxWidth: "420px" },
                onLoadedMetadata: function (e) { setDur(e.target.duration); },
                onError: function () { setErr("这个音频浏览器无法解码"); },
              }),
        ]),
        h(Bar, { key: "bar", title: baseName(abs) + "  ·  " + [dur != null ? fmtDur(dur) : null, extOf(abs).toUpperCase()].filter(Boolean).join(" · "), path: abs }, [
          h(RatePicker, { key: "rate", rate: rate, set: setRate }),
          h(Btn, { key: "loop", active: loop, title: "循环播放", onClick: function () { setLoop(!loop); } }, "循环"),
          CommonActions(props, abs, url),
        ]),
      ]);
    }

    // ── html ────────────────────────────────────────────────────────────────

    var VIEWPORTS = [
      { id: "fit", label: "自适应", w: null },
      { id: "phone", label: "手机 390", w: 390 },
      { id: "pad", label: "平板 768", w: 768 },
      { id: "desk", label: "桌面 1280", w: 1280 },
    ];

    function HtmlView(props) {
      var abs = absOf(props.scope, props.path);
      var url = fileUrl(props.scope, abs);
      var md = useState("render"), mode = md[0], setMode = md[1];
      var sc = useState(true), scripts = sc[0], setScripts = sc[1];
      var vp = useState("fit"), view = vp[0], setView = vp[1];
      var rk = useState(0), reloadKey = rk[0], setReloadKey = rk[1];
      var sr = useState({ state: "idle", text: "" }), source = sr[0], setSource = sr[1];

      var frameRef = useRef(null);

      useEffect(function () { setMode("render"); setSource({ state: "idle", text: "" }); }, [url]);

      // Navigate the frame only after it exists WITH its sandbox attribute.
      // The iframe is re-keyed whenever url / reloadKey / scripts change, so
      // this runs against the fresh element each time.
      useEffect(function () {
        if (mode === "render" && frameRef.current) frameRef.current.src = url + "?v=" + reloadKey;
      }, [mode, url, reloadKey, scripts]);

      useEffect(function () {
        if (mode !== "source") return undefined;
        var ctl = new AbortController();
        setSource({ state: "loading", text: "" });
        fetch(url + "?v=" + reloadKey, { signal: ctl.signal })
          .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
          .then(function (t) { setSource({ state: "ok", text: t.length > 2000000 ? t.slice(0, 2000000) + "\n\n… (已截断，文件过大)" : t }); })
          .catch(function (e) { if (e.name !== "AbortError") setSource({ state: "error", text: String(e.message || e) }); });
        return function () { ctl.abort(); };
      }, [mode, url, reloadKey]);

      var sandbox = "allow-popups allow-downloads allow-modals allow-forms allow-pointer-lock" + (scripts ? " allow-scripts" : "");
      var vw = VIEWPORTS.filter(function (v) { return v.id === view; })[0].w;

      var stage;
      if (mode === "source") {
        stage = h("pre", {
          style: { margin: 0, padding: "10px", flex: "1 1 auto", minHeight: 0, overflow: "auto", fontSize: "12px", lineHeight: 1.55, whiteSpace: "pre", tabSize: 2, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", background: C.softer, borderRadius: "8px" },
        }, source.state === "loading" ? "加载中…" : source.state === "error" ? "读取失败：" + source.text : source.text);
      } else {
        stage = h("div", {
          style: { flex: "1 1 auto", minHeight: 0, overflow: "auto", display: "flex", justifyContent: "center", background: vw ? C.soft : "transparent", borderRadius: "8px" },
        }, h("iframe", {
          key: url + ":" + reloadKey + ":" + (scripts ? "s" : "n"),
          ref: frameRef,
          // NO src here: the browser snapshots the sandbox flags when the
          // frame first navigates, so `src` must be assigned only after the
          // element exists with its sandbox attribute (see the effect above).
          title: baseName(abs),
          sandbox: sandbox,
          allow: "autoplay; fullscreen; clipboard-write",
          allowFullScreen: true,
          referrerPolicy: "no-referrer",
          style: { width: vw ? vw + "px" : "100%", maxWidth: "none", height: "100%", border: "1px solid " + C.line, borderRadius: "8px", background: "#fff", flex: "none" },
        }));
      }

      return h(Shell, null, [
        stage,
        h(Bar, { key: "bar", title: baseName(abs), path: abs }, [
          h(Btn, { key: "m1", active: mode === "render", title: "渲染预览", onClick: function () { setMode("render"); } }, "预览"),
          h(Btn, { key: "m2", active: mode === "source", title: "查看源码", onClick: function () { setMode("source"); } }, "源码"),
          mode === "render" ? VIEWPORTS.map(function (v) {
            return h(Btn, { key: v.id, active: view === v.id, title: "预览宽度：" + v.label, onClick: function () { setView(v.id); } }, v.label);
          }) : null,
          h(Btn, { key: "js", active: scripts, title: scripts ? "脚本已允许，点击关闭（页面将重新加载）" : "脚本已禁用，点击允许", onClick: function () { setScripts(!scripts); } }, scripts ? "脚本 开" : "脚本 关"),
          h(Btn, { key: "rl", title: "重新加载", onClick: function () { setReloadKey(reloadKey + 1); } }, "刷新"),
          CommonActions(props, abs, url),
        ]),
      ]);
    }

    // ── gallery ─────────────────────────────────────────────────────────────

    function Thumb(p) {
      var it = p.item, scope = p.scope;
      var ref = useRef(null);
      var vs = useState(false), vis = vs[0], setVis = vs[1];
      var vid = useRef(null);
      useEffect(function () {
        var el = ref.current;
        if (!el || typeof IntersectionObserver === "undefined") { setVis(true); return undefined; }
        var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { setVis(true); io.disconnect(); } }, { rootMargin: "240px" });
        io.observe(el);
        return function () { io.disconnect(); };
      }, []);

      var url = fileUrl(scope, it.abs);
      var inner;
      if (!vis) inner = null;
      else if (it.kind === "image") inner = h("img", { src: url, loading: "lazy", draggable: false, style: { width: "100%", height: "100%", objectFit: "cover" } });
      else if (it.kind === "video") inner = h("video", { ref: vid, src: url + "#t=0.5", muted: true, preload: "metadata", playsInline: true, style: { width: "100%", height: "100%", objectFit: "cover", background: "#000" } });
      else inner = h("div", {
        style: { width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "6px",
          background: it.kind === "audio" ? "linear-gradient(145deg, rgba(124,92,255,.35), rgba(34,211,238,.25))" : "linear-gradient(145deg, rgba(255,140,60,.28), rgba(255,80,120,.2))" },
      }, [kindIcon(it.kind, 28), h("span", { key: "e", style: { fontSize: "11px", opacity: 0.8, fontWeight: 600 } }, it.ext.toUpperCase())]);

      return h("div", {
        ref: ref,
        onMouseEnter: function () { var v = vid.current; if (v) { v.currentTime = 0; var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } },
        onMouseLeave: function () { var v = vid.current; if (v) { v.pause(); v.currentTime = 0.5; } },
        style: { position: "relative", width: "100%", aspectRatio: "16 / 10", background: C.soft, overflow: "hidden", borderRadius: "8px 8px 0 0" },
      }, [
        inner,
        h("span", { key: "badge", style: { position: "absolute", left: "6px", top: "6px", display: "inline-flex", alignItems: "center", gap: "3px", padding: "1px 6px", borderRadius: "10px", fontSize: "10px", background: "rgba(0,0,0,.55)", color: "#fff" } }, [kindIcon(it.kind, 10), it.ext.toUpperCase()]),
      ]);
    }

    var FILTERS = [
      { id: "all", label: "全部" },
      { id: "video", label: "视频" },
      { id: "audio", label: "音频" },
      { id: "image", label: "图片" },
      { id: "html", label: "网页" },
    ];
    var SIZES = [{ id: 150, label: "小" }, { id: 210, label: "中" }, { id: 300, label: "大" }];

    function Lightbox(p) {
      var it = p.item;
      var vprops = { ctx: p.ctx, store: p.store, scope: p.scope, path: it.abs, title: it.name, hideGallery: true };
      var body;
      if (it.kind === "video") body = h(VideoView, vprops);
      else if (it.kind === "audio") body = h(AudioView, vprops);
      else if (it.kind === "html") body = h(HtmlView, vprops);
      else body = h("div", { style: { height: "100%", display: "flex", padding: "10px", boxSizing: "border-box" } },
        h("img", { src: fileUrl(p.scope, it.abs), style: { margin: "auto", maxWidth: "100%", maxHeight: "100%", objectFit: "contain" } }));

      var nav = { position: "absolute", top: "50%", transform: "translateY(-50%)", width: "30px", height: "56px", border: "none", borderRadius: "6px", background: "rgba(127,127,127,.35)", color: "inherit", cursor: "pointer", fontSize: "18px", zIndex: 2 };
      return h("div", {
        style: { position: "absolute", inset: 0, zIndex: 20, display: "flex", flexDirection: "column", background: C.bg, color: C.fg },
      }, [
        h("div", { key: "top", style: { display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderBottom: "1px solid " + C.line, fontSize: "12px", flex: "none" } }, [
          h(Btn, { key: "x", title: "返回画廊 (Esc)", onClick: p.onClose }, "← 返回"),
          h("span", { key: "t", style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 } }, it.name),
          h("span", { key: "n", style: { color: C.muted } }, (p.index + 1) + " / " + p.total + "  ·  " + fmtSize(it.size)),
        ]),
        h("div", { key: "body", style: { position: "relative", flex: "1 1 auto", minHeight: 0 } }, [
          p.index > 0 ? h("button", { key: "prev", type: "button", title: "上一个 (←)", onClick: p.onPrev, style: Object.assign({ left: "4px" }, nav) }, "‹") : null,
          p.index < p.total - 1 ? h("button", { key: "next", type: "button", title: "下一个 (→)", onClick: p.onNext, style: Object.assign({ right: "4px" }, nav) }, "›") : null,
          h("div", { key: "c", style: { position: "absolute", inset: 0 } }, body),
        ]),
      ]);
    }

    function GalleryTab(props) {
      var scope = props.scope;
      var seed = (props.tab && props.tab.path) || "";
      var cu = useState(seed), cur = cu[0], setCur = cu[1];
      var rc = useState(false), recursive = rc[0], setRecursive = rc[1];
      var dt = useState(null), data = dt[0], setData = dt[1];
      var ls = useState(true), loading = ls[0], setLoading = ls[1];
      var er = useState(null), error = er[0], setError = er[1];
      var fl = useState("all"), filter = fl[0], setFilter = fl[1];
      var qs = useState(""), query = qs[0], setQuery = qs[1];
      var so = useState("mtime"), sort = so[0], setSort = so[1];
      var sz = useState(210), size = sz[0], setSize = sz[1];
      var se = useState(-1), sel = se[0], setSel = se[1];
      var tk = useState(0), tick = tk[0], setTick = tk[1];

      // Follow a re-seeded tab (opened again for another folder).
      useEffect(function () { setCur(seed); }, [seed]);

      useEffect(function () {
        var ctl = new AbortController();
        setLoading(true);
        setError(null);
        var q = "sessionId=" + encodeURIComponent(scope.sessionId) + (cur ? "&dir=" + encodeURIComponent(cur) : "") + (recursive ? "&recursive=1" : "");
        fetch("/mp/list?" + q, { signal: ctl.signal })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error((j && j.error && j.error.message) || "HTTP " + r.status); return j; }); })
          .then(function (j) { setData(j); setLoading(false); })
          .catch(function (e) { if (e.name !== "AbortError") { setError(String(e.message || e)); setLoading(false); } });
        return function () { ctl.abort(); };
      }, [scope.sessionId, cur, recursive, tick]);

      var items = useMemo(function () {
        if (!data) return [];
        var q = query.trim().toLowerCase();
        var list = data.files.filter(function (f) {
          return (filter === "all" || f.kind === filter) && (q === "" || f.rel.toLowerCase().indexOf(q) >= 0);
        });
        list.sort(function (a, b) {
          if (sort === "name") return a.rel.localeCompare(b.rel, "zh", { numeric: true });
          if (sort === "size") return b.size - a.size;
          return b.mtime - a.mtime;
        });
        return list;
      }, [data, filter, query, sort]);

      var counts = useMemo(function () {
        var c = { all: 0, video: 0, audio: 0, image: 0, html: 0 };
        if (data) data.files.forEach(function (f) { c.all++; c[f.kind]++; });
        return c;
      }, [data]);

      // Keyboard: Esc / arrows while the lightbox is open.
      useEffect(function () {
        if (sel < 0 || props.visible === false) return undefined;
        function onKey(e) {
          if (e.key === "Escape") { setSel(-1); e.stopPropagation(); }
          else if (e.key === "ArrowLeft") setSel(function (s) { return Math.max(0, s - 1); });
          else if (e.key === "ArrowRight") setSel(function (s) { return Math.min(items.length - 1, s + 1); });
        }
        window.addEventListener("keydown", onKey, true);
        return function () { window.removeEventListener("keydown", onKey, true); };
      }, [sel, items.length, props.visible]);

      useEffect(function () { setSel(-1); }, [cur, recursive, filter, query]);

      var dir = data ? data.dir : cur;
      var root = data ? data.cwd : "";
      var crumbs = [];
      if (data) {
        var rel = data.dir.replace(/\\/g, "/").slice(data.cwd.replace(/\\/g, "/").length).split("/").filter(Boolean);
        var acc = data.cwd;
        crumbs.push({ name: baseName(data.cwd) || data.cwd, abs: data.cwd });
        rel.forEach(function (seg) { acc = acc.replace(/[\\/]+$/, "") + "/" + seg; crumbs.push({ name: seg, abs: acc }); });
      }

      var chip = function (active) {
        return btn(active ? { background: C.accent, borderColor: C.accent, color: "#fff" } : null);
      };

      var header = h("div", { key: "head", style: { flex: "none", display: "flex", flexDirection: "column", gap: "7px", padding: "9px 10px", borderBottom: "1px solid " + C.line } }, [
        h("div", { key: "r1", style: { display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", flexWrap: "wrap", minWidth: 0 } }, [
          crumbs.map(function (c, i) {
            return h(R.Fragment, { key: c.abs }, [
              i > 0 ? h("span", { key: "s", style: { color: C.muted } }, "/") : null,
              h("button", { key: "b", type: "button", onClick: function () { setCur(c.abs); }, title: c.abs, style: { border: "none", background: "transparent", color: i === crumbs.length - 1 ? "inherit" : C.link, cursor: "pointer", padding: "1px 3px", fontSize: "12px", fontWeight: i === crumbs.length - 1 ? 600 : 400 } }, c.name),
            ]);
          }),
          h("span", { key: "sp", style: { flex: 1 } }),
          h(Btn, { key: "rf", title: "重新扫描文件夹", onClick: function () { setTick(tick + 1); } }, "刷新"),
        ]),
        h("div", { key: "r2", style: { display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap" } }, [
          FILTERS.map(function (f) {
            return h("button", { key: f.id, type: "button", onClick: function () { setFilter(f.id); }, style: chip(filter === f.id) }, f.label + " " + (counts[f.id] || 0));
          }),
          h("input", { key: "q", type: "search", placeholder: "搜索文件名", value: query, onChange: function (e) { setQuery(e.target.value); }, style: { flex: "1 1 110px", minWidth: "90px", padding: "3px 8px", fontSize: "12px", borderRadius: "6px", border: "1px solid " + C.line, background: "transparent", color: "inherit" } }),
        ]),
        h("div", { key: "r3", style: { display: "flex", alignItems: "center", gap: "10px", fontSize: "12px", flexWrap: "wrap", color: C.muted } }, [
          h("label", { key: "rec", style: { display: "inline-flex", alignItems: "center", gap: "4px", cursor: "pointer" } }, [
            h("input", { key: "i", type: "checkbox", checked: recursive, onChange: function (e) { setRecursive(e.target.checked); } }), "包含子文件夹",
          ]),
          h("label", { key: "so", style: { display: "inline-flex", alignItems: "center", gap: "4px" } }, [
            "排序",
            h("select", { key: "s", value: sort, onChange: function (e) { setSort(e.target.value); }, style: { fontSize: "12px", background: "transparent", color: "inherit", border: "1px solid " + C.line, borderRadius: "5px", padding: "1px 4px" } }, [
              h("option", { key: 1, value: "mtime" }, "最近修改"), h("option", { key: 2, value: "name" }, "名称"), h("option", { key: 3, value: "size" }, "大小"),
            ]),
          ]),
          h("span", { key: "sz", style: { display: "inline-flex", alignItems: "center", gap: "4px" } }, ["缩略图", SIZES.map(function (s) {
            return h("button", { key: s.id, type: "button", onClick: function () { setSize(s.id); }, style: chip(size === s.id) }, s.label);
          })]),
          h("span", { key: "ct", style: { marginLeft: "auto" } }, items.length + " 项" + (data && data.truncated ? "（已达上限，结果被截断）" : "")),
        ]),
      ]);

      var body;
      if (error) {
        body = h("div", { key: "body", style: { margin: "auto", padding: "24px", textAlign: "center", color: C.muted, fontSize: "13px", lineHeight: 1.7 } }, ["读取文件夹失败", h("br", { key: "b" }), error]);
      } else if (!data && loading) {
        body = h("div", { key: "body", style: { margin: "auto", color: C.muted, fontSize: "13px" } }, "扫描中…");
      } else {
        var dirCards = recursive ? [] : data.dirs.map(function (d) {
          return h("button", { key: "d:" + d.abs, type: "button", onClick: function () { setCur(d.abs); }, title: d.abs, style: { display: "flex", alignItems: "center", gap: "8px", padding: "10px", borderRadius: "8px", border: "1px dashed " + C.line, background: C.softer, color: "inherit", cursor: "pointer", textAlign: "left", fontSize: "12px", minWidth: 0 } }, [
            IconFolder(16), h("span", { key: "n", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, d.name),
          ]);
        });
        var cards = items.map(function (it, i) {
          return h("div", { key: it.abs, onClick: function () { setSel(i); }, title: it.rel, style: { cursor: "pointer", borderRadius: "8px", border: "1px solid " + C.line, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 } }, [
            h(Thumb, { key: "t", item: it, scope: scope }),
            h("div", { key: "m", style: { padding: "5px 8px 6px", fontSize: "12px", minWidth: 0 } }, [
              h("div", { key: "n", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 } }, recursive ? it.rel : it.name),
              h("div", { key: "i", style: { color: C.muted, fontSize: "11px", marginTop: "1px" } }, fmtSize(it.size) + "  ·  " + fmtTime(it.mtime)),
            ]),
          ]);
        });
        body = h("div", { key: "body", style: { flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: "10px" } }, [
          dirCards.length > 0 ? h("div", { key: "dirs", style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "8px", marginBottom: "10px" } }, dirCards) : null,
          cards.length > 0
            ? h("div", { key: "grid", style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(" + size + "px, 1fr))", gap: "10px", opacity: loading ? 0.55 : 1 } }, cards)
            : h("div", { key: "empty", style: { padding: "40px 10px", textAlign: "center", color: C.muted, fontSize: "13px" } }, data.files.length === 0 ? "这个文件夹里没有视频、音频、图片或网页文件" : "没有符合筛选条件的文件"),
        ]);
      }

      return h("div", { style: { position: "relative", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 } }, [
        header,
        body,
        sel >= 0 && items[sel]
          ? h(Lightbox, {
              key: "lb", ctx: props.ctx, store: props.store, scope: scope, item: items[sel], index: sel, total: items.length,
              onClose: function () { setSel(-1); },
              onPrev: function () { setSel(Math.max(0, sel - 1)); },
              onNext: function () { setSel(Math.min(items.length - 1, sel + 1)); },
            })
          : null,
      ]);
    }

    // ── registration ────────────────────────────────────────────────────────

    var inject = ["betterSidebar"];

    function apply(ctx) {
      // Each registration returns a disposer; wrapping in ctx.effect makes
      // cordis call it on teardown (HMR / plugin disable) so re-activation
      // does not throw "already registered".
      ctx.effect(function () {
        return ctx.betterSidebar.registerFileViewer({
          id: "mp:video", title: "视频播放器", icon: IconVideo, exts: VIDEO_EXTS, priority: 10, fetchStrategy: "none", component: VideoView,
        });
      });
      ctx.effect(function () {
        return ctx.betterSidebar.registerFileViewer({
          id: "mp:audio", title: "音频播放器", icon: IconAudio, exts: AUDIO_EXTS, priority: 10, fetchStrategy: "none", component: AudioView,
        });
      });
      ctx.effect(function () {
        return ctx.betterSidebar.registerFileViewer({
          id: "mp:html", title: "网页预览（允许脚本）", icon: IconHtml, exts: HTML_EXTS, priority: 10, fetchStrategy: "none", component: HtmlView,
        });
      });
      ctx.effect(function () {
        return ctx.betterSidebar.registerTab({
          id: "mp:gallery",
          title: "媒体画廊",
          description: "以缩略图浏览文件夹里的视频、音频、图片和网页",
          icon: IconGrid,
          order: 60,
          dedupeKey: function (tab) { return tab.path || "mp:gallery"; },
          component: GalleryTab,
        });
      });
    }

    module.exports = { inject: inject, apply: apply };
    return module.exports;
  },
});
