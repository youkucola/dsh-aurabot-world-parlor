// 启动前席位自愈：只读身份/游标 + 少量 HTTP，不改上游插件源码，也不依赖上游类实例。
// 解决的问题：
//   1) 上游 connect() 先读 PARLOR_CURRENT_ROOM，随后被 parlor-cursor.json 里的 current 无条件覆盖，
//      于是「面板配置了目标客厅」每次启动都会被旧游标拉回旧房间；
//   2) 远端仍挂着旧席位时，服务端会回「你已经在另一个客厅里；先离开或换房」，而这条错误不在上游
//      的两条兼容分支（已归档 / 客厅不存在）里，会直接上抛导致启动失败。
// 这里的两个动作都只做「尽力而为」：任何异常都只降级为原流程，绝不阻断启动。
import fs from 'node:fs'
import path from 'node:path'

/** 上游 world.ts 的 CURSOR_NAME / CURRENT_ROOM_SECRET：文件名与客厅号变量名必须与插件一致。 */
export const CURSOR_NAME = 'parlor-cursor.json'
export const CURRENT_ROOM_SECRET = 'PARLOR_CURRENT_ROOM'
/** 与上游 ParlorClient 相同的客户端版本/能力头：服务端按这两项走多客厅兼容分支。 */
const CLIENT_VERSION = '0.45.2'
const CAPABILITIES = 'seat-location-v1'
/** 本机仍未配置会馆地址时的兜底权威（与适配层其余部分同一口径）。 */
export const PARLOR_DEFAULT_ORIGIN = 'https://parlor.com.cn'
/**
 * 镜像自上游 `src/config.ts#L40` 的 `DEFAULT_INVITE_CODE`（包内公开默认邀请码，不是密钥）。
 * 上游 `join()` 在配置文件与 `.env` 都没有码时用它；自愈预检必须与 join 同源，否则生产配置下
 * 预检会因「未配置邀请码」被永久跳过。**上游变更时需同步**。
 */
export const DEFAULT_INVITE_CODE = 'parlor-cPBpxGcsOhzd'
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']
/** 预检预算：单次启动最多花这么久，超时就按失败降级——启动不能被预检拖住。 */
const BUDGET_MS = 25_000
const REQUEST_MS = 8_000
const PROBE_MS = 5_000

const str = (v) => (v === undefined || v === null ? '' : String(v).trim())

function readJson(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch { return null }
}

/** 与 coopanion.writeJson 同一风格（单行 JSON + 0o600）；写失败只返回 false，不抛。 */
function writeJson(file, value) {
  try {
    fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 })
    return true
  } catch { return false }
}

/** 预检日志只留首行，并遮掉长串（可能是令牌），确保任何情况下都不会把凭据写进日志。 */
function brief(err) {
  return String(err?.message ?? err ?? '')
    .split(/\r?\n/)[0]
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[已隐藏]')
    .trim()
    .slice(0, 160) || '未知原因'
}

/** 远端文本只用于日志/错误文案：压成一行并限长，避免带换行或超长的名字污染日志。 */
const oneLineName = (v) => str(v).replace(/\s+/g, ' ').slice(0, 24)

/** 目录里的客厅名：与远端席位名套用同一套净化规则。 */
function roomNameOf(rooms, id) {
  const room = str(id)
  if (!room || !Array.isArray(rooms)) return ''
  const hit = rooms.find((r) => str(r?.id) === room)
  return hit ? oneLineName(hit.name) : ''
}

/** 日志里描述一个客厅：有名字时带上名字，便于用户去会馆网页找它。 */
const roomText = (id, name) => (name ? `${id}「${name}」` : `${id}`)

/**
 * 换票地址只接受纯 origin：无凭据、无 path/query/fragment；除本机回环外必须 https。
 * 不满足返回空串，由调用方直接给出失败文案——绝不把带路径或明文地址悄悄拼成请求。
 */
export function identityOrigin(raw) {
  let url
  try { url = new URL(str(raw)) } catch { return '' }
  if (url.username || url.password || url.search || url.hash) return ''
  if (url.pathname !== '/') return ''
  if (url.protocol === 'https:') return url.origin
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname)) return url.origin
  return ''
}

/**
 * 换取统一身份票：与 parlor_identity_ticket 工具同一套请求形状、校验和超时，供启动前自愈复用。
 * 返回 { token, expiresAt, person }；异常一律抛给调用方（工具转成失败文案，自愈转成跳过）。
 * 票只在内存里用，绝不落盘、不进日志。
 */
export async function requestIdentityTicket({
  source, identity, name, audience, invite, fetchImpl = null, timeoutMs = 15_000,
}) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args))
  const res = await doFetch(`${source}/v1/identity/session`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(Math.max(500, Math.round(timeoutMs))),
    // 换票请求不带任何已有凭据头：身份由 body 里的 cooId / cooSecret 证明。
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cooId: identity.cooId, cooSecret: identity.cooSecret, name, audience, invite }),
  })
  if (res.status >= 500) throw new Error(`身份服务暂时不可用（HTTP ${res.status}），请稍后重试`)
  if (!res.ok) throw new Error(`换取身份票被拒绝（HTTP ${res.status}），请检查 Coopanion 配置里的邀请码与会馆地址`)
  let body = null
  try { body = await res.json() } catch { body = null }
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const expiresAt = body?.expiresAt
  // 上游契约是 Unix 毫秒绝对时间：只接受有限正数毫秒，不猜测单位（猜错会让过期票被当成长期票）。
  if (!token || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error('身份服务返回的身份票格式不正确（缺少 token 或 expiresAt）')
  }
  const p = body?.person && typeof body.person === 'object' ? body.person : {}
  return {
    token,
    expiresAt,
    person: { cooId: str(p.cooId), handle: str(p.handle), name: str(p.name), kind: str(p.kind) },
  }
}

/**
 * 游标规范化：把「目标客厅」写回上游游标与客厅号秘密。
 * 上游 connect() 里 PARLOR_CURRENT_ROOM 先决定房间，随后 loadCursors() 用游标 current 无条件覆盖它，
 * 因此两处都要改：只改游标，游标缺失时会回落到旧房间；只改秘密，则每次都被游标改回去。
 * 只在值确实不同时写盘；任何失败只告警，绝不阻断启动。
 */
export function normalizeCursor({
  dataDir, targetRoom, serverUrl = null, secret = null, storeSecret = null, log = null,
} = {}) {
  const room = str(targetRoom)
  if (!room) return false
  const warn = (msg) => { try { log?.warn?.(msg) } catch {} }
  const info = (msg) => { try { log?.info?.(msg) } catch {} }
  let changed = false

  const file = path.join(str(dataDir), CURSOR_NAME)
  const raw = readJson(file)
  /**
   * 上游 `world.ts#L646` 是 `if (raw.server && raw.server !== this.baseUrl) return;`：游标里记的会馆地址
   * 与当前会馆不一致时**整份游标作废**。这种游标改了上游也不会读，日志不能报成功。
   * 只有两边地址都已知时才判定；老调用方不传 serverUrl 时保持原行为。
   */
  const cursorServer = str(raw?.server).replace(/\/+$/, '')
  const currentServer = str(serverUrl).replace(/\/+$/, '')
  const foreignCursor = Boolean(cursorServer && currentServer && cursorServer !== currentServer)
  if (raw && foreignCursor) {
    info(`客厅游标属于另一个会馆，上游不会读取它，已跳过 current 改写（目标客厅 ${room}）`)
  } else if (raw && raw.current !== room) {
    // 游标 current 来自磁盘，可能是远端写回的房间号：进日志前先压成一行并限长。
    const before = oneLineName(raw.current)
    // 只动 current，其它字段（rooms / announcements / news / storyHint）原样保留。
    raw.current = room
    if (writeJson(file, raw)) {
      changed = true
      info(`客厅游标已指向目标客厅 ${room}${before ? `（原为 ${before}）` : ''}`)
    } else {
      warn(`客厅游标写入失败，目标客厅 ${room} 可能仍被旧游标覆盖`)
    }
  }

  let current = ''
  try { current = str(secret?.(CURRENT_ROOM_SECRET)) } catch { current = '' }
  if (current !== room) {
    try {
      storeSecret?.(CURRENT_ROOM_SECRET, room)
      changed = true
    } catch (err) {
      warn(`客厅号写入自有凭据失败：${brief(err)}`)
    }
  }
  return changed
}

/** 单次 HTTP：返回 { ok, status, body }；网络错误与超时照原样抛出，由上层降级。 */
async function httpJson(doFetch, url, init, timeoutMs) {
  const res = await doFetch(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(Math.max(500, Math.round(timeoutMs))),
  })
  let body = null
  try { body = await res.json() } catch { body = null }
  return { ok: res.ok === true, status: Number(res.status) || 0, body }
}

/** /v1/me 与身份头请求共用：与上游 headers() 同口径（带身份票时不带 authorization）。 */
const clientHeaders = () => ({
  'x-parlor-client': CLIENT_VERSION,
  'x-parlor-capabilities': CAPABILITIES,
})

/**
 * 启动前处理远端残留席位。返回值是一份摘要（永不抛出），供启动失败时拼出可操作文案：
 *   { ok, action, targetRoom, targetRoomName, realRoom, realRoomName, tokenValid, detail }
 * action 取值：switch（已换房）/ leave（已释放旧席位）/ switch-failed / leave-failed /
 *              none（无需处理，含「换房后重读确认远端已无席位」）/ skipped（预检没跑完，按原流程启动）。
 */
export async function recoverSeat({
  baseUrl, identity, identitySource, invite, seatName, targetRoom,
  secret = null, storeSecret = null, log = null, fetchImpl = null, budgetMs = BUDGET_MS,
} = {}) {
  const summary = {
    ok: false, action: '', targetRoom: str(targetRoom), targetRoomName: '',
    realRoom: '', realRoomName: '', tokenValid: false, detail: '',
  }
  const warn = (msg) => { try { log?.warn?.(msg) } catch {} }
  const info = (msg) => { try { log?.info?.(msg) } catch {} }
  const debug = (msg) => { try { log?.debug?.(msg) } catch {} }
  /** 凭据写入失败（磁盘问题）不能让已经成功的换房/释放被当成预检失败。 */
  const saveSecret = (name, value) => {
    try { storeSecret?.(name, value) } catch (err) { warn(`客厅凭据写入失败：${brief(err)}`) }
  }
  const readSecret = (name) => { try { return str(secret?.(name)) } catch { return '' } }
  /** 预检没跑完（地址/身份/邀请码缺失、读不到远端席位）：记为 skipped，启动照原流程继续。 */
  const skip = (reason) => {
    summary.action = 'skipped'
    summary.detail = summary.detail || reason
    return summary
  }

  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args))
  const deadline = Date.now() + (Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : BUDGET_MS)
  const left = (cap) => Math.max(500, Math.min(cap, deadline - Date.now()))
  const ensureBudget = () => {
    if (deadline - Date.now() < 500) throw new Error('预检超出时间预算')
  }

  try {
    const origin = identityOrigin(baseUrl)
    if (!origin) {
      warn('客厅服务器地址不是纯域名，已跳过席位自愈预检')
      return skip('服务器地址不是纯域名')
    }
    if (!str(identity?.cooId) || !str(identity?.cooSecret)) {
      warn('客厅身份文件缺少 cooId / cooSecret，已跳过席位自愈预检')
      return skip('身份文件缺少 cooId / cooSecret')
    }
    const inviteCode = str(invite)
    if (!inviteCode) {
      warn('未配置邀请码，已跳过席位自愈预检')
      return skip('未配置邀请码')
    }

    ensureBudget()
    const ticket = await requestIdentityTicket({
      source: identityOrigin(identitySource) || origin,
      identity,
      name: seatName,
      audience: origin,
      invite: inviteCode,
      fetchImpl,
      timeoutMs: left(REQUEST_MS),
    })

    // 1) 远端现在把我放在哪个客厅：me() 用身份票读，返回 seat 与客厅目录（可拿到客厅名）。
    ensureBudget()
    const me = await httpJson(doFetch, `${origin}/v1/me`, {
      headers: { ...clientHeaders(), 'x-parlor-identity': ticket.token },
    }, left(REQUEST_MS))
    const meBody = me.body && typeof me.body === 'object' ? me.body : null
    if (!me.ok || !meBody) {
      warn(`席位自愈预检读不到远端席位（HTTP ${me.status}），已按原流程启动`)
      return skip(`读取远端席位失败（HTTP ${me.status}）`)
    }
    const rooms = Array.isArray(meBody.rooms) ? meBody.rooms : []
    summary.targetRoomName = roomNameOf(rooms, summary.targetRoom)
    const seat = meBody.seat && typeof meBody.seat === 'object' ? meBody.seat : null
    // realRoom 还要拼进请求 URL，这里保留原值；进摘要/日志时再净化（见下方 summary.realRoom）。
    let realRoom = str(seat?.room)
    const remoteSeatName = oneLineName(seat?.name)

    // 2) 本地席位令牌是否还活着：/v1/me/location 只带 Bearer（上游 location() 同口径）。
    //    200 时用返回的 room 校正真实房间；401/403 说明本地令牌已失效。
    const token = readSecret('PARLOR_SEAT_TOKEN')
    if (token) {
      ensureBudget()
      const location = await httpJson(doFetch, `${origin}/v1/me/location`, {
        headers: { authorization: `Bearer ${token}` },
      }, left(PROBE_MS))
      if (location.ok) {
        summary.tokenValid = true
        const located = str(location.body?.room)
        if (located) realRoom = located
      } else if (location.status === 401 || location.status === 403) {
        summary.tokenValid = false
      } else {
        debug(`席位自愈预检读本地令牌位置失败（HTTP ${location.status}），按令牌不可用处理`)
      }
    }

    summary.realRoom = oneLineName(realRoom)
    if (!realRoom) {
      summary.action = 'none'
      debug('客厅席位预检：远端没有残留席位，按原流程入座')
      return summary
    }
    summary.realRoomName = roomNameOf(rooms, realRoom)
    let seatLabel = summary.realRoomName || remoteSeatName

    // 3a) 令牌有效且就在目标客厅：上游自己会恢复，什么都不用做。
    if (summary.tokenValid && realRoom === summary.targetRoom) {
      summary.ok = true
      summary.action = 'none'
      // realRoom 可能来自远端 seat.room：日志只用已净化的 summary.realRoom。
      debug(`客厅席位预检：已在目标客厅 ${summary.realRoom}，无需处理`)
      return summary
    }

    // 3b) 令牌有效但坐在别的客厅：一次 switch 完成「释放旧席位 + 拿新令牌」，旧令牌随即失效。
    //     回包丢失 / 非 2xx / 抛错都不能直接当「换房失败」：服务端可能已经换好，只是响应没回来。
    let switchUncertain = false
    if (summary.tokenValid) {
      ensureBudget()
      let swapped = null
      let switchErr = null
      try {
        swapped = await httpJson(doFetch, `${origin}/v1/rooms/${encodeURIComponent(realRoom)}/switch`, {
          method: 'POST',
          headers: {
            ...clientHeaders(), 'content-type': 'application/json', authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ to: summary.targetRoom, ...(str(seatName) ? { name: str(seatName) } : {}) }),
        }, left(REQUEST_MS))
      } catch (err) { switchErr = err }
      const newToken = str(swapped?.body?.token)
      if (swapped?.ok && newToken) {
        saveSecret('PARLOR_SEAT_TOKEN', newToken)
        summary.ok = true
        summary.action = 'switch'
        info(`已把席位从客厅 ${roomText(summary.realRoom, seatLabel)} 自动换到目标客厅 ${roomText(summary.targetRoom, summary.targetRoomName)}`)
        return summary
      }
      summary.action = 'switch-failed'
      summary.detail = swapped?.ok
        ? '换房成功但服务端未返回新席位令牌'
        : (switchErr ? `换房请求失败（${brief(switchErr)}）` : `换房 HTTP ${swapped.status}`)
      switchUncertain = true
      warn(`把席位从 ${roomText(summary.realRoom, seatLabel)} 换到 ${summary.targetRoom} 未拿到可用令牌（${summary.detail}），先确认当前所在客厅`)
    }

    // 3b-2) 换房结果未知：旧令牌此刻可能已经失效，先用身份票重读 /v1/me 定位真实席位，
    //       再决定要不要 leave、以及 leave 哪个客厅（回包丢失时服务端其实已经换到目标客厅）。
    if (switchUncertain) {
      let confirmed = false
      let confirmedRoom = ''
      const switchedTo = summary.targetRoom
      try {
        ensureBudget()
        const reread = await httpJson(doFetch, `${origin}/v1/me`, {
          headers: { ...clientHeaders(), 'x-parlor-identity': ticket.token },
        }, left(REQUEST_MS))
        if (reread.ok && reread.body && typeof reread.body === 'object') {
          confirmed = true
          confirmedRoom = str(reread.body?.seat?.room)
        } else {
          debug(`换房后重读远端席位失败（HTTP ${reread.status}），未能确认当前所在客厅`)
        }
      } catch (err) {
        debug(`换房后重读远端席位出错（${brief(err)}），未能确认当前所在客厅`)
      }
      if (!confirmed) {
        // 读不到就按原逻辑处理：旧令牌可能还有效，先尝试释放原客厅。
        warn(`换房结果未知，且未能确认当前所在客厅，按原流程尝试释放原客厅 ${summary.realRoom} 的席位`)
      } else if (!confirmedRoom) {
        // 远端已经没有席位：不必再 leave；旧令牌已失效，清掉让上游重新入座。
        // 摘要里的真实席位同步作废，免得启动仍失败时提示一个已经不存在的客厅；
        // 令牌同时被清空，tokenValid 必须一起复位，否则摘要会自称「令牌仍有效」而指向空客厅。
        if (token) saveSecret('PARLOR_SEAT_TOKEN', '')
        summary.ok = true
        summary.action = 'none'
        summary.realRoom = ''
        summary.realRoomName = ''
        summary.tokenValid = false
        summary.detail = '换房后远端已无席位，已清空旧席位令牌'
        info('客厅席位预检：换房后远端已没有席位，旧令牌已清空，无需再释放')
        return summary
      } else {
        // 以重读结果为准：可能真的换到了目标客厅（只是回包丢了），也可能仍停在原客厅或第三个客厅。
        const moved = confirmedRoom !== realRoom
        realRoom = confirmedRoom
        summary.realRoom = oneLineName(realRoom)
        summary.realRoomName = roomNameOf(rooms, realRoom)
        seatLabel = summary.realRoomName || remoteSeatName
        if (confirmedRoom === switchedTo) {
          summary.detail = '换房疑似已生效、回包丢失；已释放目标客厅席位等待重新入座'
          info(`换房疑似已生效、回包丢失：远端席位已在目标客厅 ${roomText(summary.realRoom, seatLabel)}，将释放该席位让上游重新入座拿新令牌`)
        } else if (moved) {
          summary.detail = `换房后席位实际在 ${summary.realRoom}，按该客厅释放`
          warn(`换房结果与预期不符：远端席位实际在 ${roomText(summary.realRoom, seatLabel)}，按该客厅释放`)
        }
      }
    }

    // 3c) 令牌失效（或换房失败）：先释放旧席位，让上游随后正常 join(targetRoom)。
    //     ① 旧令牌；② 401/403 时改用身份票重试一次（上游 headers() 里带身份票就不带 authorization）。
    //     404 表示那个客厅/席位本来就不在了，等同于已释放。
    ensureBudget()
    const leaveUrl = `${origin}/v1/rooms/${encodeURIComponent(realRoom)}/leave`
    let released = false
    let lastStatus = 0
    if (token) {
      const byToken = await httpJson(doFetch, leaveUrl, {
        method: 'POST',
        headers: {
          ...clientHeaders(), 'content-type': 'application/json', authorization: `Bearer ${token}`,
        },
        body: '{}',
      }, left(PROBE_MS))
      released = byToken.ok || byToken.status === 404
      lastStatus = byToken.status
    }
    if (!released) {
      ensureBudget()
      const byIdentity = await httpJson(doFetch, leaveUrl, {
        method: 'POST',
        headers: {
          ...clientHeaders(), 'content-type': 'application/json', 'x-parlor-identity': ticket.token,
        },
        body: '{}',
      }, left(PROBE_MS))
      released = byIdentity.ok || byIdentity.status === 404
      lastStatus = byIdentity.status
    }
    if (released) {
      // 旧令牌对应席位已释放：清空它（上游 `secret(...).trim() || ...` 见空即跳到重新入座）。
      if (token) saveSecret('PARLOR_SEAT_TOKEN', '')
      summary.ok = true
      summary.action = 'leave'
      info(`已释放客厅 ${roomText(summary.realRoom, seatLabel)} 的残留席位，随后会重新入座目标客厅 ${roomText(summary.targetRoom, summary.targetRoomName)}`)
      return summary
    }
    summary.action = 'leave-failed'
    summary.detail = `释放席位 HTTP ${lastStatus}`
    warn(`释放客厅 ${roomText(summary.realRoom, seatLabel)} 的残留席位失败（HTTP ${lastStatus}，目标 ${summary.targetRoom}）；继续按原流程启动，如仍报「已经在另一个客厅里」，请在会馆网页手动离开该客厅`)
    return summary
  } catch (err) {
    // 换票失败 / 网络错误 / 超时：只降级，不抛出，启动照原样继续。
    if (!summary.action) summary.action = 'skipped'
    summary.detail = summary.detail || brief(err)
    warn(`客厅席位自愈预检已跳过（按原流程启动）：${brief(err)}`)
    return summary
  }
}

const ACTION_TEXT = {
  switch: '已自动换房',
  leave: '已释放旧席位',
  'switch-failed': '换房失败',
  'leave-failed': '释放旧席位失败',
  none: '无需处理',
  skipped: '预检未完成',
}

/**
 * 启动仍失败（服务端回「已经在另一个客厅里」）时的补充说明：哪个客厅占着席位、目标客厅是哪个、
 * 自愈试过什么。只放客厅 id / 名称与动作，绝不含任何令牌。
 */
export function seatConflictHint(summary) {
  if (!summary) return ''
  const target = summary.targetRoom ? roomText(summary.targetRoom, summary.targetRoomName) : '未知'
  const real = summary.realRoom ? roomText(summary.realRoom, summary.realRoomName) : '未知'
  const bits = [`真实席位在 ${real}`, `目标客厅 ${target}`]
  const action = ACTION_TEXT[summary.action] || str(summary.action)
  if (action) bits.push(`自愈：${action}`)
  if (summary.detail) bits.push(str(summary.detail))
  return bits.join('；')
}
