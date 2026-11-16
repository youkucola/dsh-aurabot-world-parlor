// Node 24 直载 Coopanion 插件 TS 源码所需的 cortico/* 解析钩子与最小 SDK shim。
// 运行时 shim 一律内联成 data: URL，绝不读取 lib/shims/*.mjs 的磁盘路径（旧
// .aurabot-cache 快照随时会被删）；那三个文件只保留作源码参考。
// 这里只默认导入 module：具名导入 registerHooks 在旧 Node 上会让整个模块加载失败，
// 反而让 assertNodeSupport() 没机会给出清晰错误。
import module from 'node:module'

// 插件里除 describeTools / nowIso 外的 cortico/* 导入全是 import type，类型擦除后不会加载。
// 单一实现来源：本模块导出的函数与 resolve 返回的内联 shim 共用同一份函数源码，避免漂移。
export function describeTools(decls, summaries = {}) {
  return (Array.isArray(decls) ? decls : []).map(({ name, description, parameters, tags }) => ({
    name, description, parameters, tags, summary: summaries?.[name],
  }))
}

/** 对应 SDK core/util.ts：目标时区相对 UTC 的偏移（分钟）。 */
export function getTimezoneOffsetMinutes(timezone, d = new Date()) {
  const parts = {}
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(d)) parts[p.type] = Number(p.value)
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return (Math.floor(d.getTime() / 1000) * 1000 - wall) / 60_000
}

/** 对应 SDK core/util.ts：带本地时区偏移的 ISO 时间戳。 */
export function nowIso(timezone, d = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d).replace(' ', 'T')
  const stamp = `${parts}.${String(d.getMilliseconds()).padStart(3, '0')}`
  const offMin = -getTimezoneOffsetMinutes(timezone, d)
  const sign = offMin >= 0 ? '+' : '-'
  const abs = Math.abs(offMin)
  return `${stamp}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

const dataUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`

// 只认 3 个已知 specifier；源码内联，URL 稳定且不带任何磁盘路径。
const SHIM_URLS = {
  'cortico/world.ts': dataUrl(`export ${describeTools.toString()}\n`),
  'cortico/core/util.ts': dataUrl(`export ${getTimezoneOffsetMinutes.toString()}\nexport ${nowIso.toString()}\n`),
  'cortico/core/types.ts': dataUrl('export {}\n'),
}

/** 同步 resolve 钩子：非 cortico/ 与未知 cortico/* 一律交给默认解析器（后者会明确报 ERR_MODULE_NOT_FOUND）。 */
export function corticoResolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('cortico/')) return nextResolve(specifier, context)
  const url = SHIM_URLS[specifier]
  if (!url) return nextResolve(specifier, context)
  return { url, format: 'module', shortCircuit: true }
}

/** start() 前的 Node 能力探测：主版本 >=24 且具备同步 registerHooks，不满足抛明确错误。 */
export function assertNodeSupport() {
  const major = Number.parseInt(String(process.versions.node).split('.')[0], 10)
  if (!(major >= 24) || typeof module.registerHooks !== 'function') {
    throw new Error(`客厅适配层需要 Node >= 24 且支持 module.registerHooks()，当前为 ${process.versions.node}`)
  }
}

// Symbol.for 走全局注册表：跨 .aurabot-cache 快照重载仍是同一个键，模块级变量会重置而它不会。
const HOOK_KEY = Symbol.for('world-parlor.cortico-hooks.v1')

function hookState() {
  let state = globalThis[HOOK_KEY]
  if (!state) {
    // registrations / deregistrations 只用于自测观测「只注册一次、归零才注销」，不参与生命周期判断。
    state = { count: 0, deregister: null, registrations: 0, deregistrations: 0 }
    globalThis[HOOK_KEY] = state
  }
  return state
}

/**
 * 进程级幂等 + 可注销：install() 计数 +1 并返回 release()；release() 计数 -1，
 * 归零才 deregister()。同一进程里无论快照重载多少次，钩子只注册一次。
 */
export function installCorticoHooks() {
  const state = hookState()
  if (state.count === 0) {
    const handle = module.registerHooks({ resolve: corticoResolve })
    state.deregister = typeof handle === 'function' ? handle : () => handle?.deregister?.()
    state.registrations += 1
  }
  state.count += 1
  let released = false
  return function release() {
    if (released) return false
    released = true
    state.count = Math.max(0, state.count - 1)
    if (state.count > 0) return false
    const done = state.deregister
    state.deregister = null
    state.deregistrations += 1
    try { done?.() } catch {}
    return true
  }
}

/** 只读快照，供 selftest 断言「只注册一次、归零才注销」；不参与生命周期判断。 */
export function corticoHookSnapshot() {
  const s = hookState()
  return {
    count: s.count,
    registered: typeof s.deregister === 'function',
    registrations: s.registrations,
    deregistrations: s.deregistrations,
  }
}
