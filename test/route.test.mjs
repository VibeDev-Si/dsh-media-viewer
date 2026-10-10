// Real-HTTP test of the host half against a fake cordis ctx.
// Run: node test/route.test.mjs
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, MEDIA_CHUNK_BYTES } from '../index.js'

const root = mkdtempSync(join(tmpdir(), 'mv-'))
const cwd = join(root, '工作区')
const outside = join(root, 'outside')
mkdirSync(join(cwd, 'sub'), { recursive: true })
mkdirSync(outside)
writeFileSync(join(cwd, 'clip.mp4'), Buffer.from('0123456789'.repeat(100)))
writeFileSync(join(cwd, 'sub', '页面 1.html'), '<h1>hi</h1>')
writeFileSync(join(cwd, 'sub', 'a.wav'), Buffer.alloc(64))
writeFileSync(join(cwd, 'sub', 'style.css'), 'body{}')
writeFileSync(join(cwd, 'note.txt'), 'x')
writeFileSync(join(outside, 'secret.txt'), 'secret')
let linked = true
try { symlinkSync(outside, join(cwd, 'link'), 'junction') } catch { linked = false }

let handler
const ctx = {
  sessions: { get: (id) => (id === 'S1' ? { header: { cwd } } : undefined) },
  webRuntime: { trustedHosts: [] },
  webServer: { register: (route) => { handler = route.handler; return () => {} } },
  effect: (fn) => fn(),
}
apply(ctx)

const server = createServer((req, res) => handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const enc = (abs) => abs.split(/[\\/]+/).filter(Boolean).map(encodeURIComponent).join('/')
const fileUrl = (abs, sid = 'S1') => `${base}/mp/f/${sid}/${enc(abs)}`
const get = (url, headers = {}) => fetch(url, { headers })

// 1. full file
let r = await get(fileUrl(join(cwd, 'clip.mp4')))
assert.equal(r.status, 200)
assert.equal(r.headers.get('accept-ranges'), 'bytes')
assert.equal(r.headers.get('content-type'), 'video/mp4')
assert.equal((await r.arrayBuffer()).byteLength, 1000)

// 2. range
r = await get(fileUrl(join(cwd, 'clip.mp4')), { range: 'bytes=10-19' })
assert.equal(r.status, 206)
assert.equal(r.headers.get('content-range'), 'bytes 10-19/1000')
assert.equal(await r.text(), '0123456789')

// 3. suffix + open-ended range + unsatisfiable
r = await get(fileUrl(join(cwd, 'clip.mp4')), { range: 'bytes=-5' })
assert.equal(r.status, 206); assert.equal(await r.text(), '56789')
r = await get(fileUrl(join(cwd, 'clip.mp4')), { range: 'bytes=995-' })
assert.equal(r.status, 206); assert.equal((await r.text()).length, 5)
r = await get(fileUrl(join(cwd, 'clip.mp4')), { range: 'bytes=5000-' })
assert.equal(r.status, 416)

// 4. html with CJK + space in name; CSP sandbox header present
r = await get(fileUrl(join(cwd, 'sub', '页面 1.html')))
assert.equal(r.status, 200)
assert.match(r.headers.get('content-type'), /text\/html; charset=utf-8/)
assert.match(r.headers.get('content-security-policy'), /^sandbox /)
assert.equal(await r.text(), '<h1>hi</h1>')

// 5. sandboxed-iframe sub-resource (opaque origin): cross-site + dest=style
r = await get(fileUrl(join(cwd, 'sub', 'style.css')), { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'style' })
assert.equal(r.status, 200, 'sub-resource from opaque origin must load')
r = await get(fileUrl(join(cwd, 'sub', 'style.css')), { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'empty', origin: 'null' })
assert.equal(r.status, 200, 'fetch() from opaque origin must load')
assert.equal(r.headers.get('access-control-allow-origin'), '*')

// 6. cross-site top-level document is refused; foreign origin is refused
r = await get(fileUrl(join(cwd, 'note.txt')), { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document' })
assert.equal(r.status, 403)
r = await get(fileUrl(join(cwd, 'note.txt')), { origin: 'http://evil.example' })
assert.equal(r.status, 403)

// 7. containment: ../ escape, absolute outside, symlink escape
r = await get(`${base}/mp/f/S1/${enc(cwd)}/../outside/secret.txt`)
assert.ok([403, 404].includes(r.status), `.. escape got ${r.status}`)
r = await get(fileUrl(join(outside, 'secret.txt')))
assert.equal(r.status, 403)
if (linked) {
  r = await get(fileUrl(join(cwd, 'link', 'secret.txt')))
  assert.equal(r.status, 403, 'symlink escape must be refused')
}

// 8. unknown / detached session, bad host
r = await get(fileUrl(join(cwd, 'note.txt'), 'NOPE'))
assert.equal(r.status, 409)
// fetch() cannot forge Host, so use node:http for the DNS-rebinding case.
const rebinding = await new Promise((resolve, reject) => {
  const u = new URL(fileUrl(join(cwd, 'note.txt')))
  const q = httpRequest({ host: '127.0.0.1', port: u.port, path: u.pathname, headers: { host: 'evil.example' } }, (res) => {
    res.resume()
    resolve(res.statusCode)
  })
  q.on('error', reject)
  q.end()
})
assert.equal(rebinding, 403, 'foreign Host header must be refused')

// 9. missing file
r = await get(fileUrl(join(cwd, 'nope.mp4')))
assert.equal(r.status, 404)

// 10. listing: non-recursive, recursive, strict fence, escape
r = await get(`${base}/mp/list?sessionId=S1`)
let j = await r.json()
assert.equal(r.status, 200)
assert.deepEqual(j.files.map((f) => f.name).sort(), ['clip.mp4'])
assert.deepEqual(j.dirs.map((d) => d.name).filter((n) => n !== 'link'), ['sub'])
assert.equal(j.files[0].kind, 'video')
r = await get(`${base}/mp/list?sessionId=S1&recursive=1`)
j = await r.json()
assert.deepEqual(j.files.map((f) => f.rel).sort(), ['clip.mp4', 'sub/a.wav', 'sub/页面 1.html'].sort())
r = await get(`${base}/mp/list?sessionId=S1&dir=${encodeURIComponent(outside)}`)
assert.equal(r.status, 403)
r = await get(`${base}/mp/list?sessionId=S1`, { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'empty' })
assert.equal(r.status, 403, 'listing keeps the strict fence')

// 11. HEAD + method guard
r = await fetch(fileUrl(join(cwd, 'clip.mp4')), { method: 'HEAD' })
assert.equal(r.status, 200); assert.equal(r.headers.get('content-length'), '1000')
r = await fetch(fileUrl(join(cwd, 'clip.mp4')), { method: 'POST' })
assert.equal(r.status, 405)

// 12. Open-ended media ranges are capped, so a player never holds a connection for the whole file
//     (several videos on screen would exhaust the browser's six connections per host).
writeFileSync(join(cwd, 'long.mp4'), Buffer.alloc(MEDIA_CHUNK_BYTES + 1000))
r = await get(fileUrl(join(cwd, 'long.mp4')), { range: 'bytes=0-' })
assert.equal(r.status, 206)
assert.equal(r.headers.get('content-range'), `bytes 0-${MEDIA_CHUNK_BYTES - 1}/${MEDIA_CHUNK_BYTES + 1000}`)
assert.equal((await r.arrayBuffer()).byteLength, MEDIA_CHUNK_BYTES)
r = await get(fileUrl(join(cwd, 'long.mp4')), { range: `bytes=${MEDIA_CHUNK_BYTES}-` })
assert.equal(r.headers.get('content-range'), `bytes ${MEDIA_CHUNK_BYTES}-${MEDIA_CHUNK_BYTES + 999}/${MEDIA_CHUNK_BYTES + 1000}`, 'the player continues where it stopped')
await r.arrayBuffer()
r = await get(fileUrl(join(cwd, 'long.mp4')), { range: 'bytes=10-19' })
assert.equal(r.headers.get('content-range'), `bytes 10-19/${MEDIA_CHUNK_BYTES + 1000}`, 'an explicit range is served as asked')
await r.arrayBuffer()
r = await get(fileUrl(join(cwd, 'long.mp4')) + '?download=1', { range: 'bytes=0-' })
assert.equal(r.headers.get('content-range'), `bytes 0-${MEDIA_CHUNK_BYTES + 999}/${MEDIA_CHUNK_BYTES + 1000}`, 'a download gets the whole file')
await r.arrayBuffer()

server.close()
console.log('all route tests passed' + (linked ? '' : ' (symlink case skipped)'))
