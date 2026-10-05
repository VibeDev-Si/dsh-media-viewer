// The host defines a fixed set of theme variables. Using a name that is not on it silently falls back to the
// hard-coded colour in var(--x, fallback): that is how the gallery lightbox came out white in the dark theme.
// This guard fails the build when client.js references any --dsw-* name that the host does not define.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// The names read from the real host (self-check on VibeDev Next 0.2.1-alpha.1, light and dark), plus the sidebar fill.
const REAL = new Set([
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary', '--dsw-alias-state-idle-primary', '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
])
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'client.js'), 'utf8')
const used = [...new Set([...src.matchAll(/--dsw-[a-z0-9-]+/g)].map((m) => m[0]))]
let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name) }

t('every --dsw-* variable the viewer uses is one the host really defines', () => {
  const unknown = used.filter((u) => !REAL.has(u))
  assert.deepEqual(unknown, [], `unknown host variable(s): ${unknown.join(', ')} (the fallback colour would always win)`)
})
t('the viewer does use the host theme (it is not all hard-coded)', () => { assert.ok(used.length >= 3, `only ${used.length} host variables used`) })
t('the lightbox background is the host background, not a literal colour', () => {
  assert.match(src, /bg:\s*"var\(--dsw-alias-bg-base,/)
  assert.doesNotMatch(src, /zIndex:\s*20[^}]*background:\s*"#/, 'lightbox must not hard-code its background')
})
console.log(`\n${n} token tests passed`)
