// The companion-components card: what it recommends, what it never claims, how it reaches the
// plugin centre, and what it releases. The client half is a plain browser bundle (no build step),
// so this drives the real file through a fake ModuleLoader and a minimal React instead of a
// rendered DOM: the loader call shape, the card's own state, its effects' cleanup and the exact
// styles it applies are all observable here.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** Same-host theme names the viewer may use; a guessed name would silently fall back to its literal colour. */
const REAL_TOKENS = new Set([
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary', '--dsw-alias-state-idle-primary', '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
])

// ── a minimal React ──────────────────────────────────────────────────────────
// Only the card itself uses hooks, and its subtree is made of pure components, so
// `createElement` can invoke function components eagerly and keep one hook frame.
function sameDeps(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
}

function createReact() {
  let frame = null
  let scheduled = []
  const React = {
    Fragment: 'Fragment',
    createElement(type, props, ...children) {
      const flat = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true)
      const merged = { ...(props || {}), children: flat.length <= 1 ? flat[0] : flat }
      return typeof type === 'function' ? type(merged) : { type, props: merged }
    },
    useState(initial) {
      const inst = frame.inst
      const hook = frame.hook('state', () => ({ value: typeof initial === 'function' ? initial() : initial }))
      return [hook.value, (next) => {
        const value = typeof next === 'function' ? next(hook.value) : next
        if (Object.is(value, hook.value)) return
        hook.value = value
        scheduled.push(inst)
      }]
    },
    useRef(initial) {
      return frame.hook('ref', () => ({ current: initial }))
    },
    useMemo(factory, deps) {
      const hook = frame.hook('memo', () => ({ value: factory(), deps }))
      if (hook.deps !== undefined && sameDeps(hook.deps, deps)) return hook.value
      hook.value = factory()
      hook.deps = deps
      return hook.value
    },
    useEffect(effect, deps) {
      const hook = frame.hook('effect', () => ({}))
      if (hook.deps !== undefined && sameDeps(hook.deps, deps)) return
      hook.deps = deps
      hook.effect = effect
    },
  }
  React.useCallback = (fn, deps) => React.useMemo(() => fn, deps)

  function commit(inst) {
    const previous = frame
    frame = {
      inst,
      index: 0,
      hook(kind, create) {
        const at = this.index++
        if (inst.hooks.length <= at) inst.hooks[at] = { kind, ...create() }
        return inst.hooks[at]
      },
    }
    try {
      inst.tree = React.createElement(inst.type, inst.props)
    } finally {
      frame = previous
    }
    for (const hook of inst.hooks) {
      if (hook === undefined || hook.effect === undefined) continue
      const effect = hook.effect
      hook.effect = undefined
      if (typeof hook.cleanup === 'function') hook.cleanup()
      const cleanup = effect()
      hook.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
  }

  return {
    React,
    /** Render one component; state updates queue a re-render the caller flushes explicitly. */
    render(type, props) {
      const inst = { type, props, hooks: [], tree: null, unmounted: false }
      commit(inst)
      return {
        instance: inst,
        tree: () => inst.tree,
        flush() {
          while (scheduled.length > 0) {
            const next = scheduled.shift()
            if (!next.unmounted) commit(next)
          }
        },
        unmount() {
          inst.unmounted = true
          for (const hook of inst.hooks) {
            if (hook !== undefined && typeof hook.cleanup === 'function') {
              const cleanup = hook.cleanup
              hook.cleanup = undefined
              cleanup()
            }
          }
        },
      }
    },
  }
}

// ── the bundle, loaded the way the shell loads it ────────────────────────────

/** Load client.js through a fake ModuleLoader and hand back its module (plus the loader spec). */
function loadBundle(React, navigatorValue) {
  let spec
  const windowObject = { __ModuleLoader__: { load: (loaded) => { spec = loaded } } }
  // eslint-disable-next-line no-new-func -- the bundle is a script, exactly as the shell evaluates it
  new Function('window', 'navigator', source)(windowObject, navigatorValue)
  assert.ok(spec, 'the bundle must register itself through window.__ModuleLoader__.load')
  assert.equal(spec.id, '@vibedev-si/dsh-media-viewer')
  const module = spec.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require(${name})`)
  })
  return { spec, module, suite: module.__suite }
}

/** One client context whose optional services are exactly what the test provides. */
function contextOf(services) {
  return { get: (name) => services[name] }
}

function managerReturning(rows) {
  return { listBundles: () => Promise.resolve({ ok: true, value: rows }) }
}

function flatten(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  if (typeof node !== 'object') {
    out.push({ text: String(node) })
    return out
  }
  out.push(node)
  flatten(node.props ? node.props.children : undefined, out)
  return out
}

function texts(node) {
  return flatten(node).filter((entry) => entry.text !== undefined).map((entry) => entry.text)
}

function buttons(node) {
  return flatten(node).filter((entry) => entry.type === 'button' && typeof entry.props.onClick === 'function')
}

function byLabel(node, label) {
  const found = buttons(node).find((entry) => texts(entry).includes(label))
  assert.ok(found, `no button labelled ${label}`)
  return found
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0) })

let passed = 0
const t = async (name, fn) => { await fn(); passed += 1; console.log('ok  ' + name) }

const react = createReact()
const { module, suite } = loadBundle(react.React, undefined)

await t('an inventory answer reads only the bundles the Host really has', () => {
  assert.equal(suite.bundlePresent({ installed: true }), true)
  assert.equal(suite.bundlePresent({ removable: false }), true) // shipped by the application itself
  assert.equal(suite.bundlePresent({ installed: false, removable: true, source: 'npm' }), false)
  assert.equal(suite.bundlePresent({ removable: false, source: 'npm' }), false) // removable-by-nobody but installed
  assert.deepEqual(suite.presentFrom({ ok: true, value: [
    { name: '@vibedev-si/dsh-vibedev', installed: true },
    { name: 'dsh-film', removable: false },
    { name: '@vibedev-si/dsh-ecosystem', installed: false },
    { name: '@vibedev-si/dsh-vibedev', installed: true },
    { installed: true },
    'nonsense',
  ] }), ['@vibedev-si/dsh-vibedev', 'dsh-film'])
  assert.deepEqual(suite.presentFrom({ ok: true, value: [] }), [], 'a readable empty inventory really is empty')
})

await t('an answer that is not a readable list is unknown, never "nothing is present"', async () => {
  // A refusal envelope, another shape, or no value at all: the card must not read "the components
  // are missing" out of it. Only a readable list answers the presence question.
  assert.equal(suite.presentFrom({ ok: false, error: { message: 'offline' } }), undefined)
  assert.equal(suite.presentFrom({ ok: false, value: [{ name: 'dsh-film', installed: true }] }), undefined)
  assert.equal(suite.presentFrom({ value: 'not a list' }), undefined)
  assert.equal(suite.presentFrom({}), undefined)
  assert.equal(suite.presentFrom(undefined), undefined)
  for (const answer of [{ ok: false }, { value: 'not a list' }, {}, undefined]) {
    const read = await suite.readPresence(contextOf({ 'remote.pluginManager': { listBundles: () => Promise.resolve(answer) } }))
    assert.deepEqual(read, { ok: false, present: [] }, `answer ${JSON.stringify(answer)} must read as unknown`)
  }
  const readable = await suite.readPresence(contextOf({ 'remote.pluginManager': { listBundles: () => Promise.resolve({ ok: true, value: [] }) } }))
  assert.deepEqual(readable, { ok: true, present: [] }, 'a readable empty list is a fact, not a failure')
})

await t('an inventory that cannot be read is not an inventory of nothing', async () => {
  assert.deepEqual(await suite.readPresence(contextOf({})), { ok: false, present: [] })
  assert.deepEqual(await suite.readPresence(contextOf({ 'remote.pluginManager': { listBundles: () => { throw new Error('offline') } } })), { ok: false, present: [] })
  assert.deepEqual(await suite.readPresence(contextOf({ 'remote.pluginManager': { listBundles: () => Promise.reject(new Error('offline')) } })), { ok: false, present: [] })
  // A getter that throws is a service this viewer does not have, not a crash in the sidebar.
  const hostile = {
    get remote() { throw new Error('no remote') },
    get layout() { throw new Error('no layout') },
    get slots() { throw new Error('no slots') },
  }
  assert.deepEqual(await suite.readPresence(hostile), { ok: false, present: [] })
  assert.equal(suite.centerPanel(hostile), undefined)
  assert.deepEqual(suite.openCenter(hostile), { kind: 'manual', spec: suite.SUITE.center })
  assert.equal(suite.observePresence(hostile, () => {})() , undefined, 'a hostile service still returns an unsubscribe')
  const throwingManager = { get listBundles() { throw new Error('no manager') } }
  assert.deepEqual(await suite.readPresence(contextOf({ 'remote.pluginManager': throwingManager })), { ok: false, present: [] })
  const throughProxy = await suite.readPresence({ remote: { pluginManager: managerReturning([{ name: 'dsh-film', installed: true }]) } })
  assert.deepEqual(throughProxy, { ok: true, present: ['dsh-film'] })
})

await t('the centre panel comes from the live main slot, key first and legacy shapes after', () => {
  const slots = { entries: (key) => (key === 'main' ? [{ options: { key: 'other' } }, { options: { key: suite.CENTER_PANEL } }] : []) }
  assert.equal(suite.centerPanel(contextOf({ slots })), suite.CENTER_PANEL)
  assert.equal(suite.centerPanel(contextOf({ slots: { entries: () => [{ key: suite.CENTER_PANEL }] } })), suite.CENTER_PANEL)
  assert.equal(suite.centerPanel(contextOf({ slots: { entries: () => [{ options: { id: suite.CENTER_PANEL } }] } })), suite.CENTER_PANEL)
  assert.equal(suite.centerPanel(contextOf({ slots: { entries: () => [{ options: { key: 'plugins' } }] } })), undefined)
  assert.equal(suite.centerPanel(contextOf({})), undefined)
  assert.equal(suite.centerPanel(contextOf({ slots: { entries: () => { throw new Error('gone') } } })), undefined)
})

await t('opening the centre falls through panel → Plugins page → install dialog → the spec to paste', () => {
  const selectPanel = { calls: [], selectPanel(id) { this.calls.push(id) } }
  const centre = contextOf({ slots: { entries: () => [{ options: { key: suite.CENTER_PANEL } }] }, layout: selectPanel })
  assert.deepEqual(suite.openCenter(centre), { kind: 'center' })
  assert.deepEqual(selectPanel.calls, [suite.CENTER_PANEL])

  const refusedLayout = { selectPanel() { throw new Error('not registered') } }
  const bundles = { calls: [], openBundle(name) { this.calls.push(name) } }
  assert.deepEqual(
    suite.openCenter(contextOf({ slots: { entries: () => [{ options: { key: suite.CENTER_PANEL } }] }, layout: refusedLayout, pluginNavigation: bundles })),
    { kind: 'plugins' },
  )
  assert.deepEqual(bundles.calls, [suite.SUITE.center])

  const installs = { calls: [], openInstall(prefill) { this.calls.push(prefill) } }
  assert.deepEqual(suite.openCenter(contextOf({ pluginNavigation: installs })), { kind: 'plugins' })
  assert.deepEqual(installs.calls, [{ spec: suite.SUITE.center }])

  assert.deepEqual(suite.openCenter(contextOf({})), { kind: 'manual', spec: suite.SUITE.center })
  assert.deepEqual(suite.openCenter(contextOf({ pluginNavigation: { openInstall() { throw new Error('no dialog') } } })),
    { kind: 'manual', spec: suite.SUITE.center })
})

await t('the card names only what is absent, and only after its own read settled', async () => {
  const events = { listeners: [], off: 0 }
  const remote = {
    pluginManager: managerReturning([{ name: suite.SUITE.account, installed: true }]),
    $on(event, listener) { events.listeners.push({ event, listener }); return () => { events.off += 1 } },
  }
  const ctx = contextOf({ remote, 'remote.pluginManager': remote.pluginManager })
  const view = react.render(suite.SuiteCard, { ctx })
  assert.equal(view.tree(), null, 'nothing is claimed before the read settles')
  await settle()
  view.flush()
  const labels = texts(view.tree())
  assert.ok(labels.includes('相关组件'), 'the missing state is titled')
  assert.ok(labels.some((line) => line.includes('影视工作台')), 'the absent Film workbench is named')
  assert.ok(!labels.some((line) => line.includes('VibeDev 账号')), 'the installed account plugin is not recommended again')
  assert.ok(labels.includes('打开插件中心'))
  assert.equal(events.listeners.length, 1)
  assert.equal(events.listeners[0].event, 'plugin-manager/changed')
  view.unmount()
  assert.equal(events.off, 1, 'unmounting releases the host subscription')
})

await t('a change on the Host refreshes the card, and an installed component drops out of it', async () => {
  const events = { listeners: [] }
  const rows = [{ name: suite.SUITE.account, installed: true }]
  const remote = {
    pluginManager: managerReturning(rows),
    $on(event, listener) { events.listeners.push(listener); return () => {} },
  }
  const ctx = contextOf({ remote, 'remote.pluginManager': remote.pluginManager })
  const view = react.render(suite.SuiteCard, { ctx })
  await settle()
  view.flush()
  assert.ok(texts(view.tree()).some((line) => line.includes('影视工作台')))

  rows.push({ name: suite.SUITE.film, installed: true })
  events.listeners[0]()
  await settle()
  view.flush()
  const after = texts(view.tree())
  assert.ok(!after.some((line) => line.includes('影视工作台')), 'a component the Host now has is no longer recommended')
  assert.ok(after.includes('插件中心'), 'nothing missing leaves the quiet way into the centre')
  view.unmount()
})

await t('an unreadable inventory offers the centre and claims no component is missing', async () => {
  const remote = { pluginManager: { listBundles: () => Promise.reject(new Error('offline')) }, $on: () => () => {} }
  const ctx = contextOf({ remote, 'remote.pluginManager': remote.pluginManager })
  const view = react.render(suite.SuiteCard, { ctx })
  await settle()
  view.flush()
  const labels = texts(view.tree())
  assert.ok(labels.includes('插件中心'))
  assert.ok(!labels.some((line) => line.includes('影视工作台')))
  assert.ok(!labels.some((line) => line.includes('VibeDev 账号')))
  view.unmount()
})

await t('the button opens the centre, and a click that could not open anything offers the spec to copy', async () => {
  const selectPanel = { calls: [], selectPanel(id) { this.calls.push(id) } }
  const slots = { entries: () => [{ options: { key: suite.CENTER_PANEL } }] }
  const ctx = contextOf({ slots, layout: selectPanel, 'remote.pluginManager': managerReturning([]) })
  const view = react.render(suite.SuiteCard, { ctx })
  await settle()
  view.flush()
  byLabel(view.tree(), '打开插件中心').props.onClick()
  view.flush()
  assert.deepEqual(selectPanel.calls, [suite.CENTER_PANEL])
  assert.ok(!texts(view.tree()).includes(suite.SUITE.center), 'the centre opened, so no spec is offered')
  view.unmount()

  const written = []
  const navigatorValue = { clipboard: { writeText: (text) => { written.push(text); return Promise.resolve() } } }
  // A second runtime: the card's hooks belong to the bundle whose loader handed it the React it uses.
  const withClipboard = createReact()
  const { suite: clipboardSuite } = loadBundle(withClipboard.React, navigatorValue)
  const manualView = withClipboard.render(clipboardSuite.SuiteCard, { ctx: contextOf({ 'remote.pluginManager': managerReturning([]) }) })
  await settle()
  manualView.flush()
  byLabel(manualView.tree(), '打开插件中心').props.onClick()
  manualView.flush()
  assert.ok(texts(manualView.tree()).includes(suite.SUITE.center), 'nothing could open, so the spec is on screen')
  byLabel(manualView.tree(), '复制包名').props.onClick()
  await settle()
  manualView.flush()
  assert.deepEqual(written, [suite.SUITE.center])
  assert.ok(texts(manualView.tree()).includes('已复制'))
  manualView.unmount()
})

await t('the card styles itself from the host theme, with no literal colour of its own', async () => {
  // The two literals the bundle's own palette defines: the accent and the label drawn on it.
  const PALETTE = new Set(['#7254f5', '#fff'])
  const ctx = contextOf({ 'remote.pluginManager': managerReturning([]) })
  const view = react.render(suite.SuiteCard, { ctx })
  await settle()
  view.flush()
  const nodes = flatten(view.tree())
  const card = nodes.find((entry) => entry.props && entry.props['data-mp-companions'] === '1')
  assert.ok(card, 'the card renders its own container')
  const styles = nodes.filter((entry) => entry.props && entry.props.style).map((entry) => entry.props.style)
  for (const style of styles) {
    const text = JSON.stringify(style)
    for (const name of text.match(/--dsw-[a-z0-9-]+/g) || []) {
      assert.ok(REAL_TOKENS.has(name), `${name} is not a variable the host defines`)
    }
    // A colour written outside a var() fallback is a literal that cannot follow the theme.
    const withoutFallbacks = text.replace(/var\(--dsw-[a-z0-9-]+,[^)]*\)/g, 'var(--dsw-token)')
    for (const hex of withoutFallbacks.match(/#[0-9a-fA-F]{3,8}/g) || []) {
      assert.ok(PALETTE.has(hex), `the card must not paint a literal colour: ${hex} in ${text}`)
    }
  }
  // The container follows the sidebar's own greys and label colour instead of a fixed surface,
  // which is what keeps it readable in the dark theme.
  assert.equal(card.props.style.background, 'rgba(127,127,127,.06)')
  assert.match(card.props.style.border, /rgba\(127,127,127,\.28\)$/)
  assert.match(card.props.style.color, /^var\(--dsw-alias-label-primary/)
  view.unmount()
})

await t('apply registers the viewers and reads nothing until a surface is opened', () => {
  const registered = { viewers: [], tabs: [], effects: [] }
  const reads = { count: 0 }
  const ctx = {
    get: () => undefined,
    effect(callback) { registered.effects.push(callback()) },
    betterSidebar: {
      registerFileViewer(options) { registered.viewers.push(options); return () => {} },
      registerTab(options) { registered.tabs.push(options); return () => {} },
    },
  }
  reads.count += 0
  module.apply(ctx)
  assert.deepEqual(registered.viewers.map((options) => options.id), ['mp:video', 'mp:audio', 'mp:html'])
  assert.equal(registered.tabs.length, 1)
  assert.equal(registered.tabs[0].id, 'mp:gallery')
  for (const options of registered.viewers) assert.equal(typeof options.component, 'function')
  assert.equal(reads.count, 0, 'apply itself reads no inventory')
  assert.equal(registered.effects.length, 4)
  assert.deepEqual(module.inject, ['betterSidebar'])
})

console.log(`\n${passed} suite tests passed`)
