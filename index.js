/**
 * dsh-media-viewer — host half.
 *
 * Two routes, both under the single prefix `/mp`:
 *
 *   GET|HEAD /mp/f/<sessionId>/<absolute path segments>
 *       Streams one file from the session working directory. Supports HTTP
 *       Range (206), so <video>/<audio> can seek, and has NO size cap (the
 *       built-in /sidebar/file route reads whole files into memory and refuses
 *       anything over 20MB).
 *       The path is encoded into the URL PATH (not the query) so that a
 *       previewed HTML page's relative assets (./style.css, clip.mp4, img/a.png)
 *       resolve back into this same route with the session intact.
 *
 *   GET /mp/list?sessionId=<id>[&dir=<path>][&recursive=1]
 *       JSON listing of the media files (video/audio/image/html) in a folder,
 *       for the gallery tab.
 *
 * Security posture:
 *  - Host header must be loopback or a configured trusted authority (DNS
 *    rebinding defence), same as the /api gateway.
 *  - Every path must resolve (symlinks included) inside the session's working
 *    directory.
 *  - The listing route and top-level document loads keep the strict
 *    same-origin fence. The FILE route relaxes exactly one rule: a sandboxed
 *    preview iframe has an opaque origin, so its sub-resource requests carry
 *    `Sec-Fetch-Site: cross-site` and `Origin: null`. Those are accepted for
 *    sub-resource destinations only, and only for a live session id, which
 *    acts as the capability.
 *  - Every file response carries a CSP `sandbox` directive, so even a
 *    top-level load of an HTML file stays in an opaque origin.
 */
import { createReadStream } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'

export const name = 'dsh-media-viewer'

/** Services required before mounting. */
export const inject = ['webServer', 'sessions', 'webRuntime']

// ── content types ───────────────────────────────────────────────────────────

const TYPES = {
  // video
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg',
  '.mov': 'video/quicktime', '.qt': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo', '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv',
  '.mpeg': 'video/mpeg', '.mpg': 'video/mpeg', '.3gp': 'video/3gpp', '.m2ts': 'video/mp2t',
  // audio
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.oga': 'audio/ogg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
  '.weba': 'audio/webm', '.aif': 'audio/aiff', '.aiff': 'audio/aiff',
  // image
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  // web
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8', '.srt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wasm': 'application/wasm',
}

const KINDS = {
  video: new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov', '.qt', '.mkv', '.avi', '.wmv', '.flv', '.mpeg', '.mpg', '.3gp', '.m2ts']),
  audio: new Set(['.mp3', '.wav', '.m4a', '.aac', '.oga', '.ogg', '.opus', '.flac', '.weba', '.aif', '.aiff']),
  image: new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif']),
  html: new Set(['.html', '.htm']),
}

function kindOfExt(ext) {
  for (const kind of Object.keys(KINDS)) if (KINDS[kind].has(ext)) return kind
  return undefined
}

const SANDBOX_CSP = "sandbox allow-scripts allow-popups allow-downloads allow-modals allow-forms; object-src 'none'"

// ── browser-trust fence ─────────────────────────────────────────────────────

const header = (headers, key) => (typeof headers[key] === 'string' ? headers[key] : undefined)

function parseAuthority(authority) {
  try { return new URL(`http://${authority}`) } catch { return undefined }
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127'
    && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

function isTrustedAuthority(hostUrl, trustedHosts) {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return entryUrl.port === '' ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host
  })
}

/** Sub-resource destinations a previewed page legitimately requests. */
const SUBRESOURCE_DESTS = new Set([
  '', 'image', 'script', 'style', 'video', 'audio', 'track', 'font', 'manifest',
  'worker', 'sharedworker', 'empty', 'iframe', 'frame', 'object', 'embed',
])

/**
 * @param relaxed - true for the file route: also admit opaque-origin
 *   (sandboxed iframe) sub-resource requests.
 */
function trusted(req, trustedHosts, relaxed) {
  const host = header(req.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false

  const site = header(req.headers, 'sec-fetch-site')
  const origin = header(req.headers, 'origin')
  if (site === 'cross-site') {
    if (!relaxed) return false
    if (!SUBRESOURCE_DESTS.has(header(req.headers, 'sec-fetch-dest') ?? '')) return false
    return origin === undefined || origin === 'null'
  }
  if (origin === undefined) return true
  if (relaxed && origin === 'null') return true
  try { return new URL(origin).hostname === hostUrl.hostname } catch { return false }
}

// ── paths ───────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const norm = (v) => v.replace(/[\\/]+/g, '/').replace(/\/$/, '')

function isWithin(base, target) {
  const b = norm(base)
  const t = norm(target)
  if (process.platform === 'win32') {
    const lb = b.toLowerCase()
    const lt = t.toLowerCase()
    return lt === lb || lt.startsWith(`${lb}/`)
  }
  return t === b || t.startsWith(`${b}/`)
}

function requireAbsolute(path) {
  if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) {
    throw new HttpError(400, `"${path}" is not an absolute path`)
  }
  return resolve(path)
}

/** `/mp/f/<sid>/<segments>` -> { sessionId, path }. UNC marker and drive letter handled like better-sidebar. */
function decodeFilePath(pathname) {
  const PREFIX = '/mp/f/'
  if (!pathname.startsWith(PREFIX)) throw new HttpError(404, 'not a file route')
  let segments
  try {
    segments = pathname.slice(PREFIX.length).split('/').map((s) => decodeURIComponent(s))
  } catch {
    throw new HttpError(400, 'malformed URL encoding')
  }
  const [sessionId, ...rest] = segments
  if (!sessionId) throw new HttpError(400, 'sessionId is required')
  const unc = rest[0] === ''
  const tail = unc ? rest.slice(1) : rest
  if (tail.length === 0 || tail.some((s) => s === '')) throw new HttpError(400, 'file path is required')
  let path
  if (unc) path = `//${tail.join('/')}`
  else if (/^[A-Za-z]:$/.test(tail[0])) path = tail.join('/')
  else path = `/${tail.join('/')}`
  return { sessionId, path }
}

/** The live session's authoritative working directory. */
function liveCwd(ctx, sessionId) {
  const cwd = ctx.sessions.get(sessionId)?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') {
    throw new HttpError(409, 'session is not attached; reload the page and reopen the file')
  }
  return cwd
}

/** Resolve `target` and prove (symlinks included) that it lives inside `cwd`. */
async function confine(cwd, target) {
  const abs = requireAbsolute(target)
  if (!isWithin(cwd, abs)) throw new HttpError(403, 'path is outside the session working directory')
  let real
  let realCwd
  try {
    real = await realpath(abs)
    realCwd = await realpath(cwd)
  } catch {
    throw new HttpError(404, 'not found')
  }
  if (!isWithin(realCwd, real)) throw new HttpError(403, 'path resolves outside the session working directory')
  return real
}

// ── responses ───────────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(buf.length),
    'cache-control': 'no-store',
  })
  res.end(buf)
}

function sendError(res, error) {
  const status = error instanceof HttpError ? error.status : 500
  if (res.headersSent) { res.destroy(); return }
  sendJson(res, status, { ok: false, error: { message: error?.message ?? String(error) } })
}

/** Single `Range: bytes=` header -> {start,end} | null | {unsatisfiable:true}. */
function parseRange(raw, size) {
  if (raw === undefined) return null
  const m = /^bytes=(.+)$/i.exec(raw.trim())
  if (!m) return null
  const spec = m[1].split(',')[0].trim()
  if (spec === '') return null
  if (spec.startsWith('-')) {
    const suffix = Number(spec.slice(1))
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    return suffix >= size ? { start: 0, end: size - 1 } : { start: size - suffix, end: size - 1 }
  }
  const dash = spec.indexOf('-')
  if (dash === -1) return null
  const start = spec.slice(0, dash) === '' ? 0 : Number(spec.slice(0, dash))
  const end = spec.slice(dash + 1) === '' ? size - 1 : Number(spec.slice(dash + 1))
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(end)) return null
  if (start >= size) return { unsatisfiable: true }
  return { start, end: Math.min(end, size - 1) }
}

function serveFile(req, res, path, size, type, extra) {
  const base = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': SANDBOX_CSP,
    'cross-origin-resource-policy': 'cross-origin',
    ...extra,
  }
  const range = parseRange(header(req.headers, 'range'), size)
  if (range?.unsatisfiable) {
    res.writeHead(416, { ...base, 'content-range': `bytes */${size}` })
    res.end()
    return
  }
  const stream = (opts) => {
    const s = createReadStream(path, opts)
    s.on('error', () => res.destroy())
    res.on('close', () => s.destroy())
    s.pipe(res)
  }
  if (range) {
    res.writeHead(206, { ...base, 'content-range': `bytes ${range.start}-${range.end}/${size}`, 'content-length': String(range.end - range.start + 1) })
    if (req.method === 'HEAD') { res.end(); return }
    stream({ start: range.start, end: range.end })
    return
  }
  res.writeHead(200, { ...base, 'content-length': String(size) })
  if (req.method === 'HEAD') { res.end(); return }
  stream({})
}

// ── listing ─────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg'])
const MAX_ENTRIES = 3000
const MAX_DEPTH = 6

async function statMany(items) {
  const out = []
  for (let i = 0; i < items.length; i += 32) {
    const chunk = items.slice(i, i + 32)
    const rows = await Promise.all(chunk.map(async (it) => {
      try {
        const info = await stat(it.abs)
        return { ...it, size: info.size, mtime: info.mtimeMs }
      } catch {
        return undefined
      }
    }))
    for (const r of rows) if (r) out.push(r)
  }
  return out
}

async function listMedia(root, recursive) {
  const files = []
  const dirs = []
  let truncated = false
  const queue = [{ abs: root, depth: 0 }]
  while (queue.length > 0 && !truncated) {
    const { abs, depth } = queue.shift()
    let names
    try {
      names = await readdir(abs, { withFileTypes: true })
    } catch {
      continue
    }
    for (const d of names) {
      const child = resolve(abs, d.name)
      if (d.isDirectory()) {
        if (depth === 0) dirs.push({ name: d.name, abs: child })
        if (recursive && depth < MAX_DEPTH && !SKIP_DIRS.has(d.name)) queue.push({ abs: child, depth: depth + 1 })
      } else if (d.isFile()) {
        const kind = kindOfExt(extname(d.name).toLowerCase())
        if (kind === undefined) continue
        if (files.length >= MAX_ENTRIES) { truncated = true; break }
        files.push({ name: d.name, abs: child, kind })
      }
    }
  }
  const rows = await statMany(files)
  const rootNorm = norm(root)
  for (const r of rows) {
    r.rel = norm(r.abs).slice(rootNorm.length).replace(/^\//, '')
    r.ext = extname(r.name).slice(1).toLowerCase()
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return { files: rows, dirs: dirs.filter((d) => !SKIP_DIRS.has(d.name)), truncated }
}

// ── plugin body ─────────────────────────────────────────────────────────────

export function apply(ctx) {
  const trustedHosts = () => ctx.webRuntime.trustedHosts

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/mp',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const isFile = url.pathname.startsWith('/mp/f/')

        if (!trusted(req, trustedHosts(), isFile)) throw new HttpError(403, 'forbidden')

        if (req.method === 'OPTIONS' && isFile) {
          res.writeHead(204, {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET, HEAD, OPTIONS',
            'access-control-allow-headers': 'range, if-range',
            'access-control-max-age': '600',
          })
          res.end()
          return
        }
        if (req.method !== 'GET' && !(req.method === 'HEAD' && isFile)) throw new HttpError(405, 'method not allowed')

        if (isFile) {
          const { sessionId, path } = decodeFilePath(url.pathname)
          const real = await confine(liveCwd(ctx, sessionId), path)
          const info = await stat(real)
          if (!info.isFile()) throw new HttpError(400, 'not a file')
          const type = TYPES[extname(real).toLowerCase()] ?? 'application/octet-stream'
          const extra = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-length, content-range, accept-ranges' }
          if (url.searchParams.get('download') === '1') {
            extra['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(basename(real))}`
          }
          if (info.size === 0) {
            res.writeHead(200, { 'content-type': type, 'content-length': '0', 'content-security-policy': SANDBOX_CSP, ...extra })
            res.end()
            return
          }
          serveFile(req, res, real, info.size, type, extra)
          return
        }

        if (url.pathname === '/mp/list') {
          const sessionId = url.searchParams.get('sessionId')
          if (!sessionId) throw new HttpError(400, 'sessionId is required')
          const cwd = liveCwd(ctx, sessionId)
          const dirParam = url.searchParams.get('dir')
          const dir = await confine(cwd, dirParam ? resolve(cwd, dirParam) : cwd)
          const info = await stat(dir)
          if (!info.isDirectory()) throw new HttpError(400, 'not a directory')
          const { files, dirs, truncated } = await listMedia(dir, url.searchParams.get('recursive') === '1')
          sendJson(res, 200, { ok: true, cwd: resolve(cwd), dir, files, dirs, truncated })
          return
        }

        throw new HttpError(404, 'unknown route')
      } catch (error) {
        sendError(res, error)
      }
    },
  }), 'dsh-media-viewer: /mp file + list routes')
}
