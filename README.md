# @vibedev-si/dsh-media-viewer · 右侧栏媒体预览

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
| 加入画布 | 画廊里点「多选」，勾选图片 / 视频 / 音频（Shift 连选、全选），点「加入画布」放进**影视工作台**当前打开的画布；没打开时先在侧栏打开它 |

**在哪里打开**

- 在文件树里点开视频、音频或网页文件，就用本插件的播放器打开（文件预览顶部的切换菜单里可以换回内置预览）。
- 媒体画廊：右侧栏「开始」页的「媒体画廊」、文件树顶部的「媒体画廊」按钮（打开当前文件夹），或文件预览顶部的「画廊」按钮（打开文件所在的文件夹）。

「加入画布」需要同时启用影视工作台插件（`dsh-film-studio`）：文件由工作台复制进项目的 `assets/`，在画布中央排成节点，整批一次撤销。两个插件只通过一个页面事件 `vibedev-film:add-media` 联系，没装工作台时画廊会直接提示。

## 本版变更（0.2.0）

- **不再依赖 `dsh-better-sidebar`**：预览器、画廊和入口都直接用 DSH 自带的右侧栏（DSH 0.2.1-alpha.2 及以后），应用更新不会再因为第三方插件没跟上而失效。
  - 视频、音频、HTML 注册为 DSH 的文件预览；画廊是右侧栏的一个页面。
  - 装了 `dsh-better-sidebar` 时，播放器也会注册进它的编辑器（它会先接管所有文件），画廊仍是同一个。
  - 宿主侧只需要 Web 服务和会话，受信主机从 DSH 新旧两种启动服务中按实际提供的读取（DSH 0.2.1-alpha.2 把 `webRuntime` 改名为 `webStartup` 后，0.1.x 无法加载）。
- **画廊多选与加入画布**（原 0.1.4 未单独发布，并入本版）。
- **更稳的播放**：
  - 视频缩略图截取一帧后就释放播放器；
  - 播放请求分段返回、不进浏览器缓存。
  - 页面上视频多时，浏览器每个主机只有 6 个连接，不再出现后面的视频一直转圈、不发请求的情况。

## 0.1.3

撤回了 0.1.2 加进预览工具栏和画廊底部的「组件 / 插件中心」入口，它影响了侧栏观感，等重新设计后再考虑；预览、画廊与安全说明不受影响。

## 安装

需要 DSH 0.2.1-alpha.2 或更新版本（VibeDev Next 已满足）。不需要其他插件；`dsh-better-sidebar` 可装可不装。

在 VibeDev / DSH 的插件管理里按包名 `@vibedev-si/dsh-media-viewer` 安装即可，或用命令行：

```sh
dsh plugin --profile <你的 profile 名> add @vibedev-si/dsh-media-viewer
```

安装后**刷新页面**。

> **从旧包名迁移**：本插件原先以无作用域的 `dsh-media-viewer` 发布（0.1.0），现已迁到官方作用域 `@vibedev-si/dsh-media-viewer`，旧包名已标记弃用。已装旧包的用户请卸载后改装新包名。

## 为什么自带 `/mp` 路由

DSH 自带预览读取整个文件；`dsh-better-sidebar` 的 `/sidebar/file`、`/sidebar/html` 有 20MB 上限、不支持 HTTP Range，安全围栏还会拒绝沙箱 iframe 里的子资源请求。本插件自带 `/mp/*` 路由：大视频可以流式播放、拖进度条，带样式、脚本、视频的 HTML 能完整加载，并在沙箱里保持对 GUI 的隔离。

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
npm test    # host 路由（Range、分段、越界、符号链接、Host 伪造、沙箱子资源）与宿主接口登记
```

client 是无需构建的纯 JS（`client.js`），host 是 `index.js`，没有构建步骤。

## English

**@vibedev-si/dsh-media-viewer** adds inline previews to the DSH right sidebar (DSH 0.2.1-alpha.2 or later) and needs no other plugin:

- **Video** — mp4 / webm / mov / mkv…, seekable, playback speed, loop, no file-size cap (HTTP Range streaming).
- **Audio** — mp3 / wav / m4a / flac…, live spectrum, playback speed, loop.
- **HTML** — scripts allowed by default; relative CSS / JS / images / video / `fetch()` all load; preview ⇄ source, phone / tablet / desktop widths, script toggle. Runs in an opaque-origin sandboxed iframe, so a previewed page cannot reach the GUI.
- **Media gallery** — a right-sidebar page: thumbnail grid for a folder with type filters, search, sort, optional recursion, a lightbox with ← / → navigation, and multi-select to add media to the Film Studio canvas.

0.2.0 stands on the host's own surfaces (document previews, the right sidebar's page registry, the file tree and document toolbars) instead of `dsh-better-sidebar`; when that plugin is installed the players also register inside its editor, which claims files first. Install it by package name from your DSH plugin manager, or `dsh plugin --profile <name> add @vibedev-si/dsh-media-viewer`, then reload the page.

## License

[MIT](./LICENSE) © CrisLIUning
