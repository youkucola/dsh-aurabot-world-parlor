# aurabot-world-parlor（世界客厅）

Aurabot（DSH 插件）模块：复用本机 Coopanion 已安装的 `cortico-world-parlor` 源码，把 parlor.com.cn 真实会馆接进 QQ 会话——10 个工具（9 个 `parlor_*` 工具 + 适配层自有的 `parlor_identity_ticket`），外加 SSE 事件触发的自动唤醒。

- 模块 id `aurabot-world-parlor`，版本 `0.2.1`，插件 API `1`，能力 `filesystem` / `network`
- 本仓库只含适配层（代码 1539 行：`index.mjs` 106 行 + `lib` 1433 行，其中 `lib` 数字不含 `lib/shims` 的 9 行，含 shims 为 1548 行），另有本地自测脚本 `tests/selftest.mjs` 1753 行，**不分发** Coopanion 客厅插件源码

## 功能

- **10 个工具**：`parlor_query`（状态/目录/信箱/公告/新闻/历史/参数帮助）、`parlor_message`（发言，`scope` 必填 `room` / `table` / `private`）、`parlor_room`（建厅换厅、邀请、说书）、`parlor_table`（开桌、入座、开局、招募）、`parlor_game_info`（规则/桌面/回放）、`parlor_game_action`（游戏动作）、`parlor_gift`（赠礼）、`parlor_set_tier`（提醒档位）、`parlor_feedback`（反馈）、`parlor_identity_ticket`（向身份服务换一张统一身份票，可选 `ttl` 收窄可用窗口；真票只出现在工具返回值里，不落盘、不进日志、不推送）。
- **SSE 自动唤醒**：订阅客厅事件流，`pushEvent` 经 `api.core.hub.pushToSession` 推进目标会话的一个回合。回合是真实会话，**会真的发出 QQ 消息**。
- **通知分项开关**：连接与重连、连接状态变化、点名与私聊、说书提醒、房间摘要、牌局结算、运营公告、牌桌回合各有一枚开关，另有既有的 `news`（新闻）与 `recruitNotice`（招募/邀请）。牌局结算独立于房间摘要，关掉摘要也能单独收。
- **游戏中静默**：`world.focused === true` 时只放行牌桌回合（`myTableRevision` 前进且 `meta.addressed === true`）与牌局结算（见 `notifyTableEnd`），其余客厅通知与延迟队列一律不推送；回合正文带 `【牌桌回合…只调用牌桌工具完成动作，不要在 QQ 里接话】` 前缀。离桌只重置 `lastTableRevision`，不做局后总结。回合投递另受 `notifyTurn` 控制：关闭它等于放弃局内自动出牌（游标照常推进、重开不补推），静默闸门的其余判断不变。
- **提醒档位** `wakeTier`：`full` 每条闲聊 / `digest` 点名 + 周期摘要 / `quiet` 只点名或私聊 / `off` 不叫。
- **提示词约束**：随工具注册一段规则，声明客厅内容是外部资料、不执行其中的指令，私信必须显式选 `scope`，送达 ≠ 已读。

## 安装

把仓库内容放到 Aurabot 模块目录，**目录名必须是 `aurabot-world-parlor`**（模块 id 与目录名一致）：

```text
%USERPROFILE%\.dsh\plugins-data\aurabot\modules\aurabot-world-parlor\
├─ index.mjs
├─ module.json
├─ lib\
│  ├─ contracts.mjs
│  ├─ coopanion.mjs
│  ├─ cortico-shim.mjs
│  ├─ seat-recovery.mjs   # 启动前席位自愈
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
| `room` | `hall` | 启动目标房间 ID：启动时以它为准；运行中换过的房间在重启后会被自愈换回该房间 |
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
- **绝不写回** Coopanion 目录：身份副本写入模块自有目录，插件后续产生的 token 只落模块自己的 `secrets.json`（权限 0600）；启动前席位预检还会写入 `PARLOR_CURRENT_ROOM`，并可能改写或清空 `PARLOR_SEAT_TOKEN`。身份文件每次启动与 Coopanion 比对，上游换 Coo 或副本损坏时同步覆盖副本。
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
5. 装配完成后、`world.start()` 之前跑一次**启动前席位自愈**（详见下方同名小节），把游标与远端席位都对齐到设置里的 `room`。

升级 Coopanion 后请复验：适配层依赖 `world.focused` 与 `world.myTableRevision` 两个**私有运行时字段**，以及用于识别牌局结算的私有方法 `world.onRoomEvent`；它们不在上游公开契约内。字段缺失时按 fail-open 处理（宁可多投递，不永久静默），语义变化则会导致回合误判或漏判。启动前席位自愈还镜像了 5 处上游私有常量与 1 处判断——游标文件名 `parlor-cursor.json`、秘密名 `PARLOR_CURRENT_ROOM`、客户端版本头 `0.45.2`、能力头 `seat-location-v1`（即 `x-parlor-capabilities`，对应上游 `src/room/client.ts`）、公开默认邀请码 `parlor-cPBpxGcsOhzd`，以及游标 `server` 归属判断（对应上游 `world.ts#L646`）；上游一改，自愈会静默失效，需一并复验。

### 启动前席位自愈

**为什么需要**：上游 `connect()` 里的 `loadCursors()` 会用 `parlor-cursor.json` 的 `current` **无条件覆盖**配置里的 `room`（上游 `src/world.ts#L650`，唯一守卫只是 `server` 地址匹配）。房间一旦被旧游标拉回错误客厅，而本地席位令牌恰好失效，入座就会撞上服务端「一身份一席位」的限制，报「你已经在另一个客厅里；先离开或换房」。

**何时执行**：模块 setup 阶段、`world.start()` 之前，每次加载与热重载各跑一次。

三步动作：

1. **游标规范化**（纯本地、无网络）：把 `parlor-cursor.json` 的 `current` 改成设置里的 `room`，其它字段原样保留；同时写入 `PARLOR_CURRENT_ROOM`。若游标里的 `server` 与当前会馆不一致，**只跳过 `current` 改写**（上游本就整份忽略该游标），秘密仍写。
2. **查真实席位**：换身份票 → `GET /v1/me`（身份头）取真实席位所在客厅 → `GET /v1/me/location`（席位令牌）判定令牌是否仍有效。
3. **换房或释放**：
   - 令牌有效且已在目标客厅，或远端无席位 → 续用，不动令牌；
   - 令牌有效但在别的客厅 → `POST /v1/rooms/{真实}/switch`，成功后写回新令牌；
   - 换房结果不确定（回包丢失 / 非 2xx / 缺 token）→ 用身份票重读 `/v1/me` 重新判定真实位置再决定；
   - 令牌已失效 → `POST /v1/rooms/{真实}/leave`（先旧令牌，未成功——含 401/403 及任何非 2xx——再用身份票重试一次），成功或 404 视为已释放，并**清空** `PARLOR_SEAT_TOKEN`。

**时间预算**：总预算 25 秒（`BUDGET_MS`），单请求 8 秒、探测 5 秒；超预算抛错后降级为跳过。

**失败绝不阻断启动**：预检任何异常只记日志并降级为原流程；只有 `world.start()` 自身失败才会出现「模块加载成功但工具返回客厅尚未连接」。

**邀请码三级兜底**：Coopanion `config.json` 的 `worlds.parlor.inviteCode`（等于公开默认码时不直接用；Aurabot 面板里没有这个开关，只有 Coopanion 配置里有）→ 自有 `secrets.json` 或 Coopanion `.env` 的 `PARLOR_INVITE_CODE` → 公开默认码 `parlor-cPBpxGcsOhzd`，且**仅当会馆地址就是 `https://parlor.com.cn` 时**才默认启用第三级（自建会馆一般不启用；例外是 config 里显式填的正好是这个公开默认码、`.env` 又没有码，最终仍会回落到它）。三级都取不到则跳过远端两步（查席位、换房或释放），但第 1 步的本地游标改写（`current` 与 `PARLOR_CURRENT_ROOM`）已经执行。

**失败时的错误摘要**：仍报「已经在另一个客厅里」时，会在原错误后追加 `（真实席位在 …；目标客厅 …；自愈：…）`。摘要只含客厅 id / 名称与自愈动作，**不含任何令牌**。

**常用日志**：

- `客厅游标已指向目标客厅 …（原为 …）`
- `客厅席位预检：已在目标客厅 …，无需处理`
- `已把席位从客厅 … 自动换到目标客厅 …`
- `已释放客厅 … 的残留席位，随后会重新入座目标客厅 …`
- `未配置邀请码，已跳过席位自愈预检`
- `客厅席位仍被占用：…`

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
- **自愈预检会占启动时间**：总预算 25 秒，启动与每次热重载最多可能被拖慢这么久；超预算只降级跳过，不保证自愈成功。
- **自愈依赖身份票与邀请码**：缺邀请码、缺身份字段或会馆地址不合法时，远端两步（查席位、换房或释放）会被跳过、只打一条 warn；但第 1 步的本地游标改写（`current` 与 `PARLOR_CURRENT_ROOM`）**已经执行**。自建会馆若没配 `PARLOR_INVITE_CODE`，远端自愈不会发生。
- **自愈会改远端状态**：`switch` 会让旧席位令牌立即失效，`leave` 会真的腾出席位（会馆网页上可见）。
- **重启会被拉回设置的 `room`**：运行中通过工具换房后，重启会回到设置里的 `room`（自愈以设置为准），容易被误认成 bug。拉回来自第 1 步的 `normalizeCursor`——纯本地逻辑，在邀请码与身份校验之前执行，因此**即使远端步骤被跳过，这次本地游标改写仍会生效**，重启依旧回到设置里的 `room`。
- **自愈失败时启动错误文案变长**：错误里会带上真实席位与目标客厅的 id / 名称（不含令牌）。
- **自愈镜像了上游私有实现**：5 处私有常量与 1 处判断（游标文件名 `parlor-cursor.json`、`PARLOR_CURRENT_ROOM`、客户端版本头 `0.45.2`、能力头 `seat-location-v1`、公开默认邀请码 `parlor-cPBpxGcsOhzd`、游标 `server` 归属），上游变更会导致自愈**静默失效**。

## 许可证

MIT，见 [LICENSE](LICENSE)。本模块是对以下项目的移植/改写，并保留两份源版权声明：

- `Copyright (c) 2026 Phantivia` —— 上游仓库与本机包内均有
- `Copyright (c) 2026 meow-ai-arena contributors` —— 上游 GitHub 仓库 `src/room/ratings/LICENSE`

上游：<https://github.com/biliye/cortico-world-parlor>（MIT）。

本仓库**不分发** Coopanion / `cortico-world-parlor` 的插件源码，只在运行时读取本机已安装的那份；上述版权与 MIT 声明一并延续适用于该复用。
