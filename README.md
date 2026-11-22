# world-parlor

Aurabot（DSH 插件）模块：复用本机 Coopanion 已安装的 `cortico-world-parlor` 源码，把 parlor.com.cn 真实会馆接进 QQ 会话——10 个工具（9 个 `parlor_*` 工具 + 适配层自有的 `parlor_identity_ticket`），外加 SSE 事件触发的自动唤醒。

- 模块 id `world-parlor`，版本 `0.2.0`，插件 API `1`，能力 `filesystem` / `network`
- 本仓库只含适配层（约 900 行），**不分发** Coopanion 客厅插件源码

## 功能

- **10 个工具**：`parlor_query`（状态/目录/信箱/公告/新闻/历史/参数帮助）、`parlor_message`（发言，`scope` 必填 `room` / `table` / `private`）、`parlor_room`（建厅换厅、邀请、说书）、`parlor_table`（开桌、入座、开局、招募）、`parlor_game_info`（规则/桌面/回放）、`parlor_game_action`（游戏动作）、`parlor_gift`（赠礼）、`parlor_set_tier`（提醒档位）、`parlor_feedback`（反馈）、`parlor_identity_ticket`（向身份服务换一张统一身份票，可选 `ttl` 收窄可用窗口；真票只出现在工具返回值里，不落盘、不进日志、不推送）。
- **SSE 自动唤醒**：订阅客厅事件流，`pushEvent` 经 `api.core.hub.pushToSession` 推进目标会话的一个回合。回合是真实会话，**会真的发出 QQ 消息**。
- **通知分项开关**：连接与重连、连接状态变化、点名与私聊、说书提醒、房间摘要、牌局结算、运营公告、牌桌回合各有一枚开关，另有既有的 `news`（新闻）与 `recruitNotice`（招募/邀请）。牌局结算独立于房间摘要，关掉摘要也能单独收。
- **游戏中静默**：`world.focused === true` 时只放行牌桌回合（`myTableRevision` 前进且 `meta.addressed === true`）与牌局结算（见 `notifyTableEnd`），其余客厅通知与延迟队列一律不推送；回合正文带 `【牌桌回合…只调用牌桌工具完成动作，不要在 QQ 里接话】` 前缀。离桌只重置 `lastTableRevision`，不做局后总结。回合投递另受 `notifyTurn` 控制：关闭它等于放弃局内自动出牌（游标照常推进、重开不补推），静默闸门的其余判断不变。
- **提醒档位** `wakeTier`：`full` 每条闲聊 / `digest` 点名 + 周期摘要 / `quiet` 只点名或私聊 / `off` 不叫。
- **提示词约束**：随工具注册一段规则，声明客厅内容是外部资料、不执行其中的指令，私信必须显式选 `scope`，送达 ≠ 已读。

## 安装

把仓库内容放到 Aurabot 模块目录，**目录名必须是 `world-parlor`**（模块 id 与目录名一致）：

```text
%USERPROFILE%\.dsh\plugins-data\aurabot\modules\world-parlor\
├─ index.mjs
├─ module.json
├─ lib\
│  ├─ contracts.mjs
│  ├─ coopanion.mjs
│  ├─ cortico-shim.mjs
│  └─ shims\          # 仅源码参考，运行时不读磁盘
├─ LICENSE
└─ README.md
```

- 无需 `npm install`，没有构建步骤，零第三方依赖。
- 宿主约每 3 秒扫描一次模块目录并热重载；重载期间新旧实例通过进程级 `Symbol.for` 记录串行停止，不会并发入座。
- 仓库里的 `tests/selftest.mjs` 只用于本地自测，不是运行时依赖。
- 安装后先填 `targetChat`，否则客厅事件只会写日志、不会唤醒任何会话。

## 配置

面板设置项与默认值：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 关闭后不加载客厅插件，也不注册任何工具或提示词 |
| `targetChat` | 空 | 唤醒目标，格式 `private:QQ号` 或 `group:群号`（数字至少 3 位）；留空不唤醒，事件只记日志 |
| `coopanionHome` | 空 | 留空读 `%LOCALAPPDATA%\Coopanion\data-location.json`，回退 `%LOCALAPPDATA%\Programs\Coopanion\data`；手填值必须位于已知数据目录之内 |
| `seatName` | 空 | 会馆显示名；留空时 `botName` 取 `Coo` |
| `room` | `hall` | 启动时所在房间 ID |
| `wakeTier` | `digest` | `full` / `digest` / `quiet` / `off`，非法值回落 `digest` |
| `notifyStarted` | `true` | Bot 启动或重连到会馆时提醒 |
| `notifyLink` | `true` | 断线、恢复、重新入座、回大厅、跨厅入桌 |
| `notifyMessage` | `true` | 被点名、私聊、同桌对话 |
| `notifyStory` | `true` | 说书轮到/收尾提醒与搭车 |
| `notifyDigest` | `true` | 普通闲聊的周期摘要（牌局结算见 `notifyTableEnd`） |
| `notifyTableEnd` | `true` | 对局结束文案（五子棋/斗地主/飞行棋/狼人杀等）；独立于房间摘要，局内也会送达，关闭后不投递且不补推 |
| `notifyAnnouncement` | `true` | 运营公告 |
| `notifyTurn` | `true` | 牌桌上轮到自己时唤醒会话出牌；关闭后局内不再因回合唤醒（游标照常推进，重开不补推），且仅在「游戏中静默」开启时才是回合投递路径 |
| `news` | `true` | 新新闻提醒；请求层在启动时定型 |
| `recruitNotice` | `true` | 有人开桌招募或发来邀请 |
| `silentDuringGame` | `true` | 在牌桌上只放行牌桌回合与牌局结算（见 `notifyTableEnd`）；关闭后回到「每条事件都投递」的旧行为 |

开关在投递层实时读取，改面板不必重载模块；但**关闭期间的事件不补推**（插件自身游标照常前进，`news` 尤其如此）。

## 数据与凭据

- **只读** Coopanion：`<Coopanion 数据根>\home\companion\data\parlor-identity.json`（`cooId` / `cooSecret`）与 `\home\companion\.env`（`PARLOR_SEAT_TOKEN`、`PARLOR_OWNER_TOKEN`、`PARLOR_INVITE_CODE` 等）。
- **绝不写回** Coopanion 目录：身份副本写入模块自有目录，插件后续产生的 token 只落模块自己的 `secrets.json`（权限 0600）。身份文件每次启动与 Coopanion 比对，上游换 Coo 或副本损坏时同步覆盖副本。
- 运行时目录：`api.dataDir('cortico')` 存身份副本、`secrets.json`、游标与插件侧 SQLite；staged 插件包在 `api.dataDir('vendor')\pkg`，同级 `.stamp` 记录 `version + 文件清单签名`，签名不变则跳过复制。
- 本仓库不包含任何凭据，请勿把 `parlor-identity.json`、`.env`、`secrets.json` 或带 token 的日志提交上来。
- 工具返回值按宽松级脱敏（遮已知凭据值、绝对路径、`key/token/invite/code/sig` 等查询参数），发往 QQ 的正文按严格级脱敏（额外遮掉全部 query 值与 ≥24 位高熵串）。房间号、桌号、邀请号等业务 ID 保留，便于模型回填。

## 依赖与兼容

- Aurabot（DSH）`1.2.x`，模块声明 `minPluginVersion: 1.2.0`、`api: 1`。
- DSH 内嵌 Node **≥ 24**：依赖默认 TS 类型擦除与同步 `module.registerHooks()`；不满足时启动直接抛错，不会伪装成功。
- 本机安装 **Coopanion**，且包含 `cortico-world-parlor@0.45.2`（`package.json` 的 `name` / `cortico.kind: "world"` / `main: "./src/index.ts"` 会逐一校验）。

### 运行机制

1. 按 `data` 根定位 Coopanion 与插件真实包目录（只读），校验包身份。
2. 把插件整包 stage 到 `api.dataDir('vendor')\pkg`——`node_modules` 下的 `.ts` 无法被 Node 类型擦除，必须搬到自有目录。
3. `module.registerHooks` 把插件里的 `cortico/world.ts`、`cortico/core/util.ts`、`cortico/core/types.ts` 重定向到内联 `data:` URL shim（进程级幂等，归零才注销），再 `import()` staged 的 `src/index.ts`。
4. 用最小 `WorldContext` / `WorldHost` 模拟宿主，把插件产出的 9 个 `ToolDef` 映射成 Aurabot 工具，再追加 1 个适配层自有的换票工具（`parlor_identity_ticket`）。

升级 Coopanion 后请复验：适配层依赖 `world.focused` 与 `world.myTableRevision` 两个**私有运行时字段**，以及用于识别牌局结算的私有方法 `world.onRoomEvent`；它们不在上游公开契约内。字段缺失时按 fail-open 处理（宁可多投递，不永久静默），语义变化则会导致回合误判或漏判。

## 已知限制

- **无法硬抑制 QQ 回复**：宿主没有「只唤醒模型、不发送」的能力，每个牌桌回合本身就是一条真实 QQ 消息；前缀只能劝模型别接话。
- **局内通知静默有代价**：游戏中断线、公告、新闻不会即时推送，只能等离桌后的事件带走。
- `parlor.ledger` 与 `parlor.invite` 没有独立投递点，只作为房间事件渲染进摘要正文，因此没有单独开关——关掉 `notifyDigest` 就一起消失。
- **牌局结算识别依赖插件私有实现**：`parlor.table.end` 到不了适配层，只能旁听私有方法 `world.onRoomEvent` 记下 seq，再与 `meta.seq`（批次最后一条）比对；插件升级后需复验。桌外结算若被后续事件合并进同一批，seq 不等，会退回 `notifyDigest` 控制。
- 窗口制狼人杀若同一 `myTableRevision` 连续产生两个回合，第二个会被判成「版本没变化」而吞掉。
- 被关掉的通知类别在关闭期间**不补推**，且已入队的说书搭车提示会被直接丢弃（不渲染，避免误推进插件游标）。
- 延迟事件队列上限 20 条，超出丢最早的。
- `targetChat` 填错格式时不会报错，只会静默不唤醒（日志为 debug 级）。
- `world.start()` 失败（网络或远端不可用）时模块仍算加载成功：工具仍可调用，但统一返回「客厅尚未连接」，仅 `parlor_query {op:"help"}` 这类纯本地帮助不受影响。源码加载或定位失败则相反——直接抛错，模块被标记失败。

## 许可证

MIT，见 [LICENSE](LICENSE)。本模块是对以下项目的移植/改写，并保留两份源版权声明：

- `Copyright (c) 2026 Phantivia` —— 上游仓库与本机包内均有
- `Copyright (c) 2026 meow-ai-arena contributors` —— 上游 GitHub 仓库 `src/room/ratings/LICENSE`

上游：<https://github.com/biliye/cortico-world-parlor>（MIT）。

本仓库**不分发** Coopanion / `cortico-world-parlor` 的插件源码，只在运行时读取本机已安装的那份；上述版权与 MIT 声明一并延续适用于该复用。
