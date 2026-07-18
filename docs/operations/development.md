# 本地开发

## 环境

- Node.js 20 或更新版本。
- npm。
- Windows PowerShell 或兼容终端。
- 可选：VS Code 与 Microsoft Edge，用于一键全栈断点调试。

依赖和版本约束以根目录的 `package.json` 与 `package-lock.json` 为准。

## 安装

```powershell
npm install
python -m pip install -r akshare-bridge/requirements.txt
```

需要修改默认端口或风控参数时，将 `.env.example` 复制为未提交的 `.env.local`。任何供应商 Token 或密钥只能放在 `.env.local`，不得使用 `VITE_*` 暴露给浏览器。

登录保护默认强制启用。首次启动前运行：

```powershell
npm run auth:setup -- --username kjq
```

命令生成随机初始密码并只显示一次；`.env.local` 只保存 `scrypt` 密码散列，不保存明文密码。忘记密码时重新运行该命令会撤销旧密码；服务重启会清空现有会话，用户需要重新登录。认证不存在默认账号或默认密码，`AUTH_ENABLED=false` 只允许 `NODE_ENV=test` 的自动化测试构造器使用。

本地 HTTP 使用以下安全配置：

```text
RATE_LIMIT_MAX=120
RATE_LIMIT_WINDOW_MS=60000
AUTH_SESSION_TTL_SECONDS=28800
AUTH_COOKIE_SECURE=false
AUTH_MAX_SESSIONS=3
AUTH_LOGIN_RATE_LIMIT_MAX=5
```

`AUTH_COOKIE_SECURE=false` 只允许本机 `http://127.0.0.1` 开发。生产环境必须使用 HTTPS 并设置 `AUTH_COOKIE_SECURE=true`；否则 `NODE_ENV=production` 会拒绝启动。全局与登录限流都在应用进程内，公网部署还需要反向代理或 API 网关的独立限流。

交易状态默认使用内存仓储。需要在本地重启后保留模拟账户时，可在 `.env.local` 设置：

```text
STORE_BACKEND=json
DATA_DIR=./data
TRADING_HISTORY_RETENTION_DAYS=7
```

JSON 仓储仅用于本地单进程模拟，不具备数据库事务、多实例锁或合规审计能力。`data/` 已被 Git 忽略。默认只保留最近 7 天的已成交、已拒绝、已撤销订单和审计事件；账户现金、当前持仓、暂停状态、序列号以及仍处于 `pending`/`accepted` 的订单不会过期。清理会在服务加载状态和每次写盘时执行，因此不会每天生成一批无限增长的交易 JSON 文件。
研究数据缓存默认受上限控制，避免把大量低价值历史数据堆到本机：

```text
RESEARCH_DATA_DIR=./data/research
RESEARCH_MAX_SYMBOLS=200
RESEARCH_HISTORY_DAYS=756
RESEARCH_MAX_CACHE_MB=512
RESEARCH_STORE_RAW_NEWS=false
```

当前 `/api/research/self-optimization` 只声明 paper-only 自优化和留存策略；后续接入授权历史 K 线时，应只保存紧凑日线/特征、新闻元数据和全球市场特征，不默认保存原始 tick、完整新闻正文或无上限临时数据。

AkShare 桥接的板块与历史日线只保存在进程内短期缓存。普通研究响应默认保留 15 分钟且最多 64 个 key；单序列历史缓存最多 128 个 key，15 分钟内直接命中，最多 60 分钟可作为 stale-while-revalidate 回退：

```text
AKSHARE_BRIDGE_RESEARCH_CACHE_TTL=900
AKSHARE_BRIDGE_RESEARCH_CACHE_STALE_TTL=3600
AKSHARE_BRIDGE_RESEARCH_CACHE_MAX_ENTRIES=64
AKSHARE_BRIDGE_HISTORY_CACHE_MAX_ENTRIES=128
```

读写缓存时会主动清除过期项，超过容量后按 LRU 淘汰；正在拉取的历史序列不会在请求完成前被淘汰。`http://127.0.0.1:8800/health` 的 `researchCache` 和 `historyCache` 会返回当前条目数、上限、淘汰数和过期清理数。单次历史研究请求最多读取 20 个行业板块、12 只股票和 60 至 500 个交易日。行业日线为不复权，个股日线为前复权；该缓存不会在 `data/` 中长期堆积原始日线。

开发日志在执行 `npm run dev` 或 `npm run dev:a-share` 前自动清理，默认预算为：

```text
RUNTIME_LOG_DIR=./logs
RUNTIME_LOG_RETENTION_DAYS=7
RUNTIME_LOG_MAX_TOTAL_MB=100
RUNTIME_LOG_MAX_FILE_MB=20
```

清理器只扫描仓库内配置目录的普通 `*.log` 文件：先删除超过 7 天的日志，再删除超过 20 MB 的非活动单文件，最后从最旧文件开始把总量压到 100 MB。最近 5 分钟仍在写入的文件会跳过；锁定或删除失败只输出警告，不阻止项目启动。可先运行 `npm run runtime:cleanup:dry` 查看结果，再运行 `npm run runtime:cleanup` 执行。该流程不扫描 `data/`，不会删除 `paper-trading-state.json`、现金、持仓、开放订单或七天内审计，也不会自动删除正常依赖 `node_modules/`。

需要把本地纸面账户重置为 10000 元纯现金、并清空默认演示持仓时，在未提交的 `.env.local` 设置：

```text
TRADING_STARTING_CASH=10000
TRADING_SEED_PORTFOLIO=false
```

需要让项目在盘中自动执行本地 paper 计划时，再加：

```text
PAPER_AUTO_EXECUTION_ENABLED=true
PAPER_AUTO_EXECUTION_INTERVAL_MS=60000
PAPER_AUTO_EXECUTION_TRADE_WINDOW_ONLY=true
PAPER_AUTO_EXECUTION_MAX_ORDERS_PER_RUN=1
PAPER_AUTO_EXECUTION_MAX_DAILY_ORDERS=4
PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO=0.10
```

需要在可执行 paper 计划提交前发送 WxPusher 私人提醒时，在未提交的 `.env.local` 增加：

```text
WXPUSHER_ENABLED=true
WXPUSHER_SPT=SPT_从WxPusher重置后取得的新值
WXPUSHER_TIMEOUT_MS=5000
WXPUSHER_DAILY_MESSAGE_LIMIT=10
```

`WXPUSHER_SPT` 只允许存在于服务端 `.env.local`，不得写入源码、日志、提交记录或 `VITE_*` 变量。四条固定简报按北京时间分散发送：09:35 开盘定调、10:30 上午确认、13:30 午后风控、14:50 尾盘复核。每条显示“今日第 N/10 条”、固定简报序号、本条职责、下一时点、一眼结论、精确 paper 动作、权益/现金/仓位/当日模拟盈亏、当前与计划后持仓、策略盘面、前三板块、最多两条有效新闻、外围影响、当日成交/拒单/手续费和风险数据；尾盘条优先展示当日结果和下一交易日复核条件。服务若在目标时间后、对应交易阶段结束前启动，会在首次自动运行时补发该阶段固定简报；错过整个阶段不会集中补发。

每日硬上限为 10 条：四条固定简报加最多六条事件预留。事件预留只用于市场转为 `risk-off`、真实数据源降级、本地 paper 订单出现拒单或模拟交易暂停；同类事件同一交易日只提醒一次，多类事件同轮出现时合并成一条。普通参考价、候选排序和计划数量变化不触发消息，预留额度可以不用。成功和失败的提供方请求都会计入尝试次数，失败后不会在同一阶段循环重试。提供方失败只写入不含凭据的 `wxpusher.paper-plan.failed` 审计，不会改变本地 paper 风控或授权真实下单。微信 ClawBot 渠道每次激活后 24 小时内最多接收 10 条，额度用尽或失效后需要在微信中向 ClawBot 回复任意内容重新激活。

该自动执行器只会把 `paper-buy-plan` / `paper-sell-plan` 提交到本地 `PaperBroker`，不会连接同花顺、中信、SuperMind 或任何真实券商。盘外启动时会保持等待，直到 A 股交易时段才自动运行。默认每轮最多 1 笔、每天最多 4 笔；开盘、上午、下午和尾盘累计最多使用 2、3、4、4 笔，保留后续确认额度。`回撤控制` 硬止损可绕过阶段预算，但仍受全天上限和全部风控。当日笔数从持久化自动订单统计，服务重启不会重置；买入计划继续累计预留成交额、滑点和手续费，并保留当前 paper 权益的 10% 作为现金缓冲。

`TRADING_SEED_PORTFOLIO=true` 是默认演示模式，会在新账户中预置样例持仓；用于从下一个交易日开始观察或纸面买卖时，应设为 `false`，再停止旧服务并重新启动。若使用 `STORE_BACKEND=json`，还需要删除或移走 `DATA_DIR` 下已有的 `paper-trading-state.json`，否则系统会恢复旧账户状态而不是重新创建 10000 元纯现金账户。

## 开发服务器

同时启动 Fastify API 和 Vite：

```powershell
npm run dev
```

接入 A 股真实只读行情并继续使用模拟交易时，推荐使用：

```powershell
npm run dev:a-share
```

`npm run dev` 和 `npm run dev:a-share` 是稳定观察命令：API 以前台进程运行，任一服务异常退出后由 `concurrently` 等待 1 秒并自动重启。它们适合盘中本地 paper 观察，可避免 `tsx watch` 的父进程仍在、实际 API 子进程已经退出时，前端长期连接不到 `8787`。

修改服务端代码并需要热重载时，可单独运行：

```powershell
npm run dev:api:watch
```

该命令优先服务于开发时的代码重载；整日观察仍应使用 `npm run dev:a-share`，并配合健康检查确认 API、行情桥接和前端代理都可用。

启动后执行健康检查：

```powershell
npm run check:a-share
```

检查脚本会读取 `.env.local` 中的 `AUTH_USERNAME`，并在终端安全提示输入密码；也可为一次性非交互检查临时设置 `KAIROS_AUTH_USERNAME` 与 `KAIROS_AUTH_PASSWORD`，运行后立即删除这两个进程环境变量。密码不会写入脚本或日志。

该检查会同时验证 Fastify API、AkShare 桥接、Vite `/api` 代理、主要指数行情、个股行情和 KAIROS 行情快照。如果 4173、8787 或 8800 被旧进程占用，检查会明确标出失败项，避免页面看起来能打开但实际连到旧服务。

默认地址：

- 前端：`http://127.0.0.1:4173/`
- API：`http://127.0.0.1:8787/api/health`
- WebSocket：`ws://127.0.0.1:8787/ws`

也可以分别启动：

```powershell
npm run dev:api
npm run dev:web
```

Windows 受限目录环境下，`dev:web` 使用 Vite 的 `runner` 配置加载器，避免开发服务器在加载 `vite.config.ts` 时扫描项目父目录并触发权限错误。

如果控制台提示 `Port 4173 is already in use` 或 `EADDRINUSE 127.0.0.1:8787`，说明前端或 API 已经启动。先直接访问上述地址；需要重启时，应先停止之前运行 `npm run dev` 的终端，再重新执行命令，不要同时启动多套服务。

Vite 将 `/api` 和 `/ws` 代理到本地 Fastify 服务。当前 `MARKET_MODE` 只允许 `mock` 或 `paper`；配置为 `live` 会拒绝启动。

浏览器会显示登录页。需要从 PowerShell 调试受保护 API 时，先建立 Cookie 会话并保留 CSRF 值：

```powershell
$loginBody = @{ username = "kjq"; password = "<initial-password>" } | ConvertTo-Json
$auth = Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8787/api/auth/login `
  -ContentType "application/json" `
  -Body $loginBody `
  -SessionVariable KairosSession
$KairosHeaders = @{ "X-CSRF-Token" = $auth.csrfToken }
```

后续 GET 请求传入 `-WebSession $KairosSession`；POST/DELETE 请求还要传入 `-Headers $KairosHeaders`。Cookie 为 `HttpOnly`，不会写入 `localStorage` 或 WebSocket URL。

如果前端能打开但页面提示“页面渲染异常”、系统指标为空，或浏览器控制台出现“API 代理未命中”，优先检查是否连到了旧的 Vite 进程：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
Invoke-WebRequest http://127.0.0.1:4173/api/health -Headers @{ Accept = "application/json" }
```

第二条命令应该返回 JSON，而不是 `index.html`。如果返回 HTML，说明 4173 当前服务没有使用 `config/vite.app.config.js` 的代理配置；停止旧终端后重新执行 `npm run dev` 或 `npm run dev:a-share`。开发环境下前端会自动注销 PWA Service Worker 并清理当前站点缓存，避免旧 JS/CSS 继续渲染。

顶栏状态分为 REST 后端连接和 WebSocket 实时通道两层。若浏览器控制台在开发模式下偶发 `WebSocket is closed before the connection is established`，但 `/api/health`、`/api/market/snapshot` 与顶栏 REST 状态正常，通常是 React StrictMode 首次 effect 预演关闭了临时连接，不代表交易后端离线；应以顶栏的“交易后端已连接 · paper · AkShare 真实只读行情”以及 `npm run check:a-share` 为准。

只想单独启动前端并连接已有 API 时，可以在未提交的 `.env.local` 中显式指定：

```text
VITE_API_BASE_URL=http://127.0.0.1:8787
VITE_WS_URL=ws://127.0.0.1:8787/ws
```

这两个变量只能保存本地服务地址，不得放入任何账号、Token 或券商凭据。

使用 AkShare 只读行情时，在 `.env.local` 设置：

```text
MARKET_MODE=paper
MARKET_DATA_PROVIDER=akshare
AKSHARE_BRIDGE_URL=http://127.0.0.1:8800
AKSHARE_BRIDGE_TOKEN=
AKSHARE_BRIDGE_DISABLE_PROXY=true
TRADING_STARTING_CASH=10000
TRADING_SEED_PORTFOLIO=false
```

然后先运行 `python akshare-bridge/main.py`，或直接使用 `npm run dev:a-share` 同时启动行情桥、API 和前端。真实行情只替换行情提供者，订单仍由本地 `PaperBroker` 模拟执行。AkShare 模式会分别读取个股行情和主要指数行情；指数使用 `SH000001`、`SZ399001`、`SZ399006`、`SH000300`，避免和个股代码冲突。

AkShare 桥接还提供只读财经新闻和全球主要指数接口。Fastify 会通过 `/api/research/real-data-feed` 聚合这些数据，生成真实新闻、全球市场驱动和 A 股影响摘要；前端新闻面板优先展示该接口结果。若新闻或全球指数源暂不可用，页面会明确显示降级状态，不会使用静态模拟新闻冒充真实来源。

AkShare 桥接的 `/api/research/ipo-subscriptions` 读取真实新股申购表；Fastify 的同名受保护接口按北京时间保留前后 30 天记录，并只用申购时可见的发行价、发行市盈率和行业市盈率形成启发式规则分。市场页分为可申购、待上市和近期上市三个标签；未定价时显示等待定价，上游不可用时明确降级，不使用静态新股数据替代。

AkShare 桥接的 `/api/market/stock-search` 使用内存中的全 A 股行情按名称或代码返回最多 20 个匹配；Fastify `/api/research/stock-trend` 默认读取选中股票 360 日、最多 500 日前复权日线，生成 3/5/10 个交易日趋势规则分和同向滚动验证。该接口要求登录，只读，不会提交 paper 或真实订单。

`AKSHARE_BRIDGE_DISABLE_PROXY=true` 会让 AkShare 桥接绕过本机系统代理，避免东方财富行情接口被代理连接中断；如需显式走代理，可在 `.env.local` 中设为 `false`。

如果 AkShare 桥接健康检查中出现 `WinError 10013`，或 `/health` 显示 `cachedSymbols: 0`、`cachedIndices: 0`，说明本机 Python 进程可能被防火墙、代理或网络权限拦截。此时不要把页面上的候选或行情视为有效实时数据；先检查 Windows 防火墙/安全软件是否允许当前 Python 解释器访问网络，并在 `AKSHARE_BRIDGE_DISABLE_PROXY=true/false` 之间切换验证，再重新运行 `npm run check:a-share`。

前端视图可直接访问：

- `http://127.0.0.1:4173/`
- `http://127.0.0.1:4173/strategy`
- `http://127.0.0.1:4173/market`
- `http://127.0.0.1:4173/account`
- `http://127.0.0.1:4173/learning`

## 本地纸面观察日流程

2026-07-13（下周一，Asia/Shanghai）开始做本地一日观察时，推荐流程如下：

1. 交易日前确认 `.env.local` 使用 `MARKET_MODE=paper`、`MARKET_DATA_PROVIDER=akshare`、`TRADING_STARTING_CASH=10000`、`TRADING_SEED_PORTFOLIO=false`；如需自动本地 paper 执行，再打开 `PAPER_AUTO_EXECUTION_ENABLED=true`。
2. 启动 `npm run dev:a-share`，再运行 `npm run check:a-share`；只有 Fastify API、AkShare Bridge、Vite 代理、指数行情、个股行情和 KAIROS 快照都通过时，才把当天候选视为有效 paper 输入。
3. 开盘后在本地纸面账户观察 `/strategy`、`/learning`、`/account` 和 `/api/trading/auto-paper-execution/status`；自动执行器只提交本地模拟订单，不代表真实下单建议。
4. 收盘后导出订单、审计和候选结果，记录是否成交、最大回撤、胜率、盈亏比和数据质量异常；这些结果只能作为下一轮研究输入，不能描述为真实收益。

研究管线页会自动读取 `/api/research/paper-trading-plan`，展示当日纸面操作过程。该计划会合并策略排行榜、强势回踩候选、每日优质股和账户状态，并按 A 股规则检查 100 股一手、T+1、可用现金、单票仓位和 paper-only 边界。计划中的 `paper-buy-plan`、`paper-sell-plan`、`blocked` 或 `hold` 只是本地模拟/观察动作，不会自动连接真实券商或同花顺账户。

如需手动查看计划，可运行：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/research/paper-trading-plan -WebSession $KairosSession
```

如需查看自动执行器状态或手动触发一次本地 paper 执行，可运行：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/trading/auto-paper-execution/status -WebSession $KairosSession
Invoke-RestMethod -Method Post http://127.0.0.1:8787/api/trading/auto-paper-execution/run -WebSession $KairosSession -Headers $KairosHeaders
Invoke-RestMethod http://127.0.0.1:8787/api/research/daily-review -WebSession $KairosSession
```

手动触发接口仍会拒绝非 paper 模式，并继续通过本地风控检查；重复触发使用 `kairos-auto-paper:*` 幂等键，避免同一纸面动作重复建单。

自动执行会把状态变化、订单提交/拒绝、manual、startup 和至少每 15 分钟一次的无变化心跳写入 `paper-auto-execution.run`；相同的每分钟 timer 空结果只保留在运行内存状态，不再重复扩大 JSON。可用下面的命令判断“没有交易”究竟是没有机会还是服务没有运行：

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/api/audit?limit=50" -WebSession $KairosSession |
  Where-Object { $_.action -eq "paper-auto-execution.run" }
```

2026-07-13 的旧运行使用内存仓储，日志中没有 `kairos-auto-paper` 订单或 `POST /api/orders`，进程退出后也没有保留自动运行原因，因此只能确认“没有持久化的模拟订单”，不能从现有证据区分没有合格候选与执行器跳过。从 2026-07-14 起，本地配置改用 JSON 仓储并持久化每次运行原因，后续可以准确复盘。

2026-07-14 盘中曾在同一轮先成交包钢股份 400 股，再尝试中国银行 100 股；两笔计划分别使用了生成计划时的原始现金，第一笔成交后第二笔因只剩 412 元而被风控拒绝。修复后，同一批买单按顺序扣减预计成交额和手续费，自动执行前还会使用最新报价二次检查。每日复盘接口会明确显示该历史问题，但不会为修复前未保存的五笔成交虚构买入理由。

周末以及工作日 09:30 前，`/api/research/daily-review` 自动回看最近工作日，页面显示“最近交易日复盘”。复盘日收益按当前现金反推开盘现金、按当前持仓和当日成交反推开盘持仓，再用昨收和手续费重建；累计 paper 收益单独展示。缺少昨收时复盘日收益显示不可用，不能用累计收益替代。法定节假日识别仍需后续接入交易所日历。

如需把本地 paper 计划转成同花顺 SuperMind 可人工复核的模拟盘输入，可运行：

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/api/integrations/supermind/signal-package" -WebSession $KairosSession
```

该接口只输出信号行、CSV 和 SuperMind 云端策略模板示例。它不会登录同花顺、不会读取或保存密码/Cookie/浏览器 Token/短信验证码，也不会自动提交订单；复制到 SuperMind 前必须人工复核标的、数量、T+1、现金和一手 100 股约束。

## VS Code 一键启动

仓库提供共享的 `.vscode/launch.json`、`tasks.json` 和 `settings.json`。

1. 使用 VS Code 打开项目根目录。
2. 首次运行时执行 `npm install`。
3. 打开左侧“运行和调试”面板。
4. 选择 `▶ KAIROS：一键启动`。
5. 点击绿色启动按钮或按 `F5`。

VS Code 会：

- 通过 `npm run dev:a-share` 启动 AkShare 行情桥接、Fastify API 和 Vite 前端。
- 使用 Edge 打开 `http://127.0.0.1:4173/strategy`。
- 默认使用真实 A 股只读行情和 paper-only 模拟交易；不会启用真实下单。

若 4173、8787 或 8800 端口已被占用，请先停止已有进程。服务使用固定端口，避免浏览器或代理连接到错误实例。

## 质量检查

```powershell
npm test
npm run build
python -m pytest akshare-bridge/test_bridge.py -q
npm run check:a-share
```

- `npm test` 使用 Vitest，覆盖 `src/**/*.test.ts` 与 `server/**/*.test.ts`。
- `npm run build` 依次检查前端、Node.js 配置和服务端 TypeScript，再执行 Vite 生产构建。
- Python 测试验证 FastAPI 健康检查、只读接口令牌、参数边界和模型序列化。
- `npm run check:a-share` 需要三服务已经启动，用于确认本机真实只读行情链路没有连到旧进程或错误代理。

## API 快速检查

服务启动后可运行：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
Invoke-RestMethod http://127.0.0.1:8787/api/capabilities -WebSession $KairosSession
Invoke-RestMethod http://127.0.0.1:8787/api/account -WebSession $KairosSession
Invoke-RestMethod http://127.0.0.1:8787/api/market/snapshot -WebSession $KairosSession
Invoke-RestMethod http://127.0.0.1:8787/api/research/strategy-leaderboard -WebSession $KairosSession
Invoke-RestMethod http://127.0.0.1:8787/api/research/daily-candidates -WebSession $KairosSession
Invoke-RestMethod http://127.0.0.1:8787/api/research/daily-quality-stocks -WebSession $KairosSession
Invoke-RestMethod http://127.0.0.1:8787/api/integrations/supermind/signal-package -WebSession $KairosSession
Invoke-RestMethod http://127.0.0.1:8787/api/trading/auto-paper-execution/status -WebSession $KairosSession
Invoke-RestMethod http://127.0.0.1:8787/api/research/real-data-feed -WebSession $KairosSession
Invoke-RestMethod http://127.0.0.1:8787/api/research/ipo-subscriptions -WebSession $KairosSession

Invoke-RestMethod "http://127.0.0.1:8787/api/research/stock-trend?query=600519&days=360" -WebSession $KairosSession
```

OpenAPI 界面位于 `http://127.0.0.1:8787/documentation`。

策略排行榜端点会基于当前行情快照生成确定性研究样本并运行参数搜索。它用于验证研究流程和候选策略排序，不代表真实收益；接入授权历史行情缓存前，不应把它作为实盘策略依据。

今日候选端点会基于当前行情快照输出 A 股强势回踩确认战法的观察清单：

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/api/research/daily-candidates?limit=24" -WebSession $KairosSession
```

前端策略页和研究管线页会通过 TanStack Query 自动刷新该清单。当前自动更新机制是：AkShare/Mock 行情源按 `MARKET_TICK_MS` 更新后端快照并推送 WebSocket；研究排行榜按页面缓存策略刷新；今日候选扫描每 60 秒刷新一次，也可手动点击刷新。后端默认支持更大的候选池，便于 10000 元 paper 账户从更多标的里寻找满足一手约束的观察对象。它仍是只读研究与 paper 模拟信号，不会自动真实下单。

每日优质股端点用于生成更宽口径的观察池：

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/api/research/daily-quality-stocks?limit=30" -WebSession $KairosSession
```

当前评分使用实时行情快照中的价格、成交量/成交额、涨跌幅、振幅、换手率和日内位置。AkShare 模式下实时行情来源可以是真实只读行情，但历史 K 线、新闻、财务因子和同花顺模拟盘订单仍未接入。

如果页面大量显示 `blocked`，优先检查两个因素：`MARKET_SYMBOLS` 是否只有少量高价股，以及 10000 元 paper 账户是否无法买满 100 股一手。可以在 `.env.local` 扩大 `MARKET_SYMBOLS` 股票池，但应避免无上限拉取全市场临时数据；研究缓存仍应受 `RESEARCH_MAX_SYMBOLS`、`RESEARCH_HISTORY_DAYS` 和 `RESEARCH_MAX_CACHE_MB` 控制。

真实研究数据流端点用于查看新闻和外围市场输入：

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/api/research/real-data-feed" -WebSession $KairosSession
Invoke-RestMethod "http://127.0.0.1:8787/api/research/market-regime?sectorLimit=10&stockLimit=8&days=180" -WebSession $KairosSession
```

板块与形态研究接口会返回 `sourceStatus`、实际数据源、复权方式、滚动验证样本数和警告。`growthProbability3d/5d` 是启发式 0-100 研究评分，不是经过校准的获利概率；当 `sourceStatus=degraded` 时，应先处理 `warnings`，不得用旧静态数据补位。

该端点只读。它不会读取账户、不会提交订单，也不会连接同花顺或中信账户；全球市场对 A 股的影响摘要只是研究信号，需要后续历史样本验证。

本地开发不必须部署到服务器。只有需要无人值守长期运行、远程访问、固定公网/内网地址、监控告警或后续接入模拟盘网关时，才建议部署到服务器。部署前仍必须保持 `MARKET_MODE=paper`、`REAL_TRADING_ENABLED=false`，并把真实账户凭据留在独立服务端密钥系统中。

订单接口只执行模拟撮合。示例：

```powershell
$body = @{
  symbol = "300750"
  side = "buy"
  type = "market"
  quantity = 100
  clientOrderId = "manual-check-001"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8787/api/orders `
  -WebSession $KairosSession `
  -Headers $KairosHeaders `
  -ContentType "application/json" `
  -Body $body
```

模拟撮合遵守 A 股 T+1：当天买入后，持仓中的 `t1LockedQuantity` 会计入锁定数量，`availableQuantity` 为 0 或不足时，当天卖出请求会被拒绝。该规则只作用于本地 paper 账户，不代表真实券商回报。

## 最近验证

2026-07-15 的自适应策略与异常恢复验证结果：

1. `npm test`：30 个服务端测试文件、587 项服务端测试，以及 4 个前端测试文件、15 项前端测试全部通过。
2. `npm run build`：TypeScript 检查与 Vite 生产构建通过。
3. `python -m pytest akshare-bridge/test_bridge.py -q`：46 项桥接测试通过，只有一项依赖弃用警告。
4. 新 `npm run dev:a-share` 启动后，API、Vite 代理和 AkShare 桥接健康；后端为 `paper + akshare`，`authEnabled=true`，`REAL_TRADING_ENABLED=false`。
5. 受控终止 API PID 287472 后，`concurrently` 记录异常退出并自动重启，`8787` 由 PID 265224 恢复；前端和行情桥没有同时退出。
6. 登录后策略排行榜返回 12 项；纸面计划识别 `risk-off`、路由置信度 77%，选择 `KAIROS资金护城河`，生成两条有上限的减仓计划和一条现金观察。自动执行器仍为 `local-paper-broker-only`，检查时处于盘后，没有提交外部或真实订单。
7. 1440 x 900 桌面和 390 x 844 手机浏览器检查无横向溢出；移动菜单可正常打开/关闭，新策略状态区无重叠，控制台无错误。

2026-07-14 的验证结果：

1. `npm test`：28 个服务端测试文件、578 项服务端测试，以及 3 个前端测试文件、13 项前端测试全部通过。
2. `npm run build`：TypeScript 检查与 Vite 生产构建通过。
3. `python -m pytest akshare-bridge/test_bridge.py -q`：46 项桥接测试通过；覆盖板块/个股历史边界、并发限制、空响应不缓存和新浪全球指数回退。
4. 登录运行态为 `paper + akshare`、`authEnabled=true`；匿名健康检查为 200，能力、账户、复盘、指标和 OpenAPI 均为 401。
5. 浏览器验证错误密码、成功登录、刷新保持、认证 WebSocket、安全登出、市场研究页和 390 x 844 手机布局均通过；最终市场页无控制台错误。
6. `/api/research/market-regime` 返回 `live-read-only`，包含 10 个板块、8 只个股、180 日历史且无警告；实际来源为同花顺行业快照/历史与腾讯个股历史回退。
7. `/api/research/real-data-feed` 返回 `live-read-only`，包含 10 条东方财富财经新闻和 5 个新浪全球指数且无警告。
8. `npm run check:a-share` 通过会话登录后完成 6 项检查，后端为 `paper + akshare`，有效指数 4 个。
9. 本机未安装 Docker CLI，因此容器构建需要在部署服务器继续验证。

## 生成文件

以下文件通常由 TypeScript 或构建工具生成，不应作为架构来源：

- `*.tsbuildinfo`
- 开发服务器日志
- `node_modules/`
- `dist/`
- 测试覆盖率目录

这些内容由根目录 `.gitignore` 排除，不应进入提交。长期有效的运行知识应更新到本文档，不应依赖历史日志。
