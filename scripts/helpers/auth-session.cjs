const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const pinia = require('pinia')
const root = path.resolve(__dirname, '../..')

function harness(saved = new Map()) {
  let now = Date.now(), handler = async () => { throw new Error('Unexpected network request') }
  const cache = new Map(), timers = new Map(), events = {}, requests = [], reloads = []
  const activePinia = pinia.createPinia()
  pinia.setActivePinia(activePinia)
  const localStorage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, String(v)), removeItem: k => saved.delete(k) }
  class Clock extends Date { static now() { return now } }
  const context = {
    console, Date: Clock, process: { client: true }, atob, URL, Request, Response, Headers, AbortController, AbortSignal, DOMException,
    window: { localStorage, location: { reload: () => reloads.push(true) }, addEventListener: (n, cb) => { (events[n] ||= []).push(cb) } },
    document: { visibilityState: 'visible', body: { style: {} }, addEventListener: (n, cb) => { (events[n] ||= []).push(cb) } },
    localStorage, setTimeout: (cb, ms) => { const id = Symbol(); timers.set(id, { cb, ms }); return id },
    clearTimeout: id => timers.delete(id), setInterval: () => 1, clearInterval() {},
    fetch: async (url, options) => { requests.push({ url, options }); return handler(url, options) },
    defineNuxtRouteMiddleware: fn => fn, navigateTo: value => value
  }
  const vueMock = { ...vue, onMounted() {}, onUnmounted() {} }
  function load(file, overrides = {}) {
    if (cache.has(file)) return cache.get(file)
    const module = { exports: {} }
    cache.set(file, module.exports)
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    vm.runInNewContext(code, { ...context, ...overrides, module, exports: module.exports, require: id => {
      if (id === 'vue') return vueMock
      if (id === 'pinia') return pinia
      if (id.startsWith('~/')) return load(id.slice(2) + '.ts')
      if (id.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), id)) + '.ts')
      return require(id)
    } }, { filename: file })
    cache.set(file, module.exports)
    return module.exports
  }
  const store = load('stores/user.ts').useUserStore(activePinia)
  function tokens(userId = 'test-user', accessSeconds = 1800, refreshSeconds = 604800, claims = {}) {
    const encode = (type, seconds) => 'header.' + Buffer.from(JSON.stringify({ ...claims, userId, ...(type ? { type } : {}), exp: Math.floor(now / 1000) + seconds })).toString('base64url') + '.synthetic'
    return { accessToken: encode(undefined, accessSeconds), refreshToken: encode('refresh', refreshSeconds), expiresIn: accessSeconds }
  }
  return { store, saved, timers, events, requests, reloads, load, tokens, now: () => now, advance: ms => { now += ms }, handle: fn => { handler = fn }, login: (userId = 'test-user') => store.acceptSession({ user: { id: userId, name: 'Synthetic' }, tokens: tokens(userId) }) }
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })


module.exports = { harness, json };
