// world-parlor 基础契约：模块元信息、默认设置与设置项定义。
// 只导出纯数据；真实工具、连接与凭据逻辑在 lib/coopanion.mjs。

export const MODULE_ID = 'world-parlor'
export const MODULE_VERSION = '0.2.0'
export const WAKE_TIERS = ['full', 'digest', 'quiet', 'off']

// 面板绝不暴露 pluginPath：任意路径不得成为 import() 的来源。
export const DEFAULTS = {
  enabled: true,
  targetChat: '',
  coopanionHome: '',
  seatName: '',
  room: 'hall',
  wakeTier: 'digest',
  // 通知分项开关：默认全开，保持既有行为；关闭只在投递层过滤，不影响插件内部状态与游标。
  // 例外是 news：请求层在 createAdapter 时按 settings.news 定型，运行中关闭只停投递，
  // 插件仍会拉取新闻并推进自己的 newsCursor，重开不补推。
  notifyStarted: true,
  notifyLink: true,
  notifyMessage: true,
  notifyStory: true,
  notifyDigest: true,
  notifyAnnouncement: true,
  notifyTurn: true,
  news: true,
  recruitNotice: true,
  // 牌桌行为：只在投递层挡掉非回合事件，不改变插件内部状态与游标；关掉后回到「每条事件都投递」的旧行为。
  silentDuringGame: true,
}

export const SETTINGS = [
  { key: 'enabled', label: '启用客厅', type: 'switch', hint: '关闭后不加载 Coopanion 客厅插件，也不注册任何工具或提示词' },
  { key: 'targetChat', label: '目标会话', type: 'text', hint: '格式 private:QQ号 或 group:群号（数字至少 3 位）；留空不唤醒，事件只记日志', placeholder: 'group:123456' },
  { key: 'coopanionHome', label: 'Coopanion 数据目录（可选）', type: 'text', hint: '留空读 data-location.json；填写时只允许已知 Coopanion 数据目录内的路径' },
  { key: 'seatName', label: '我的席位名', type: 'text', hint: '会馆里显示的名字，留空用默认值', placeholder: 'Coo' },
  { key: 'room', label: '默认房间', type: 'text', hint: '启动时所在的房间 ID', placeholder: 'hall' },
  {
    key: 'wakeTier', label: '自动唤醒档位', type: 'select',
    hint: 'full 每条闲聊 / digest 点名+周期摘要 / quiet 只点名或私聊 / off 不叫',
    options: [
      { value: 'full', label: 'full · 每条闲聊' },
      { value: 'digest', label: 'digest · 点名 + 周期摘要' },
      { value: 'quiet', label: 'quiet · 只点名或私聊' },
      { value: 'off', label: 'off · 不叫' },
    ],
  },
  { key: 'notifyStarted', label: '通知：连接与重连', type: 'switch', hint: 'Bot 启动或重连到会馆时发一条' },
  { key: 'notifyLink', label: '通知：连接状态变化', type: 'switch', hint: '断线、恢复、重新入座、回大厅、跨厅入桌等' },
  { key: 'notifyMessage', label: '通知：点名与私聊', type: 'switch', hint: '被点名、私聊、同桌对话；关闭后普通内容仍可能进摘要' },
  { key: 'notifyStory', label: '通知：说书提醒', type: 'switch', hint: '说书轮到/收尾提醒与搭车；关闭后不再入队，已入队的搭车提示会被丢弃，重开不补推' },
  { key: 'notifyDigest', label: '通知：房间摘要', type: 'switch', hint: '普通闲聊的周期摘要与牌局结算；关闭后只保留点名/私聊，账本、邀请、招募等内容随摘要一起消失，无法单独开关' },
  { key: 'notifyAnnouncement', label: '通知：运营公告', type: 'switch', hint: '运营公告；关闭后不推送，重开不补推' },
  { key: 'notifyTurn', label: '通知：牌桌回合', type: 'switch', hint: '在牌桌上收到本人回合时唤醒会话去出牌；关闭后局内不再因回合唤醒（只推进游标，重开不补推），需保持「游戏中静默」开启才生效' },
  { key: 'news', label: '新闻提醒', type: 'switch', hint: '有新新闻时提醒；关闭后不再推送，重开不补推（请求层在启动时定型）' },
  { key: 'recruitNotice', label: '招募通知', type: 'switch', hint: '有人开桌招募或发来邀请时提醒' },
  { key: 'silentDuringGame', label: '游戏中保持安静', type: 'switch', hint: '在牌桌上时只放行牌桌回合/动作请求（只调工具、不在 QQ 接话），其余客厅通知不推送、不主动发言；离桌后恢复' },
]
