# dsh-media-viewer · 右侧栏媒体预览

> 在右侧栏**直接预览视频、音频和 HTML**，并提供**文件夹媒体画廊**。
> Inline video / audio / HTML preview and a folder media gallery for the DSH right sidebar.

之前点开 `.mp4`、`.wav`、`.html` 只能看到"无法预览"或一个下载面板；装上它之后，这些文件在右侧栏里直接就能播放和渲染。

## 功能

| 能力 | 说明 |
|---|---|
| 视频 | mp4 / webm / mov / mkv 等；可拖进度条；倍速、循环；**不限文件大小**（Range 流式传输） |
| 音频 | mp3 / wav / m4a / flac 等；实时频谱；倍速、循环 |
| HTML | 默认**允许脚本**；相对路径的 CSS / JS / 图片 / 视频 / `fetch` 都能加载；预览 / 源码切换；手机、平板、桌面宽度；脚本开关 |
| 媒体画廊 | 缩略图网格；按视频 / 音频 / 图片 / 网页筛选、搜索、排序；可包含子文件夹；点开是带上一个 / 下一个（← →）的灯箱 |

画廊在右侧栏的 **+ 菜单**里叫「媒体画廊」；每个播放器工具栏里的「画廊」按钮会直接打开它所在的文件夹。

## 安装

**前置依赖：[`dsh-better-sidebar`](https://www.npmjs.com/package/dsh-better-sidebar)**（≥ 0.24.0）。它接管了右侧栏的文件打开，本插件通过它的 `registerFileViewer` / `registerTab` 接入。没装它，本插件不会生效。

在 VibeDev / DSH 的插件管理里按包名 `dsh-media-viewer` 安装即可，或用命令行：

```sh
dsh plugin --profile <你的 profile 名> add dsh-media-viewer
```

安装后**刷新页面**。

## 为什么需要它

`dsh-better-sidebar` 内置的 `/sidebar/file`、`/sidebar/html` 路由：

- 有 **20MB 上限**，整文件读入内存，不支持 HTTP Range，所以大视频打不开、也不能拖进度条；
- 安全围栏会拒绝沙箱 iframe 里的子资源请求（它们带 `Sec-Fetch-Site: cross-site`），所以带样式、脚本、视频的 HTML 只能加载一半。

本插件自带 `/mp/*` 路由解决这两点，并在沙箱里保持对 GUI 的隔离。

## 安全

- Host 头必须是回环地址或受信任主机（防 DNS rebinding）。
- 所有路径必须落在**当前会话工作目录**内（符号链接解析之后也一样）。
- HTML 在**不透明来源**沙箱 iframe 中运行（无 `allow-same-origin`），无法访问 GUI 的 `parent` / `localStorage` / `cookie`。
- 文件路由只对"子资源类型"的请求放宽 cross-site，且需要有效的会话 id；列表接口始终严格同源。
- 每个响应都带 CSP `sandbox`，即使在新窗口里直接打开也保持不透明来源。

> HTML 默认允许脚本。预览**不可信**的 HTML 时，请点工具栏的「脚本 开」关掉脚本。

## 已知限制

- HTML 里以 `/` 开头的根相对路径（如 `/logo.png`）会指向 GUI 服务器根，加载不到；请用相对路径。
- 浏览器本身不支持的编码（常见：H.265 / HEVC）无法播放，会提示并给出下载链接。
- 画廊单次最多列出 3000 个文件，递归最深 6 层，跳过 `node_modules` 与 `.git`。
- 目前主要在 Windows 上测试；路径处理按 Windows / POSIX 两种写法实现，但 macOS / Linux 尚未实机验证。

## 开发

```sh
npm test    # host 路由：Range、越界、符号链接、Host 伪造、沙箱子资源
```

client 是无需构建的纯 JS（`client.js`），host 是 `index.js`，没有构建步骤。

## English

**dsh-media-viewer** adds inline previews to the [`dsh-better-sidebar`](https://www.npmjs.com/package/dsh-better-sidebar) right column, which requires it (≥ 0.24.0):

- **Video** — mp4 / webm / mov / mkv…, seekable, playback speed, loop, no file-size cap (HTTP Range streaming).
- **Audio** — mp3 / wav / m4a / flac…, live spectrum, playback speed, loop.
- **HTML** — scripts allowed by default; relative CSS / JS / images / video / `fetch()` all load; preview ⇄ source, phone / tablet / desktop widths, script toggle. Runs in an opaque-origin sandboxed iframe, so a previewed page cannot reach the GUI.
- **Media gallery** — thumbnail grid for a folder with type filters, search, sort, optional recursion, and a lightbox with ← / → navigation.

Why it exists: the built-in `/sidebar/file` and `/sidebar/html` routes cap files at 20 MB, read them fully into memory, have no Range support, and their fence rejects the `cross-site` sub-resource requests a sandboxed iframe makes. This plugin ships its own `/mp/*` routes instead. Install it by package name from your DSH plugin manager, or `dsh plugin --profile <name> add dsh-media-viewer`, then reload the page.

## License

[MIT](./LICENSE) © CrisLIUning
