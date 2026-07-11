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

仓库包含尚未注册到主服务的认证原型。未来本地启用前必须在 `.env.local` 显式设置：

```text
AUTH_USERNAME=<local-user>
AUTH_PASSWORD=<at-least-12-characters>
JWT_SECRET=<at-least-32-random-characters>
AUTH_TOKEN_TTL_SECONDS=3600
```

认证原型不存在默认凭据。当前 `buildTradingApp` 没有注册 `/api/auth/*`，因此这些变量不会改变现有开发启动流程，也不代表 API 已受保护。

本地 HTTP 安全配置：

```text
RATE_LIMIT_MAX=120
RATE_LIMIT_WINDOW_MS=60000
```

这两个值控制 Fastify 全局限流。生产环境还需要由反向代理或 API 网关实施独立限流，不能只依赖应用进程内计数。

交易状态默认使用内存仓储。需要在本地重启后保留模拟账户时，可在 `.env.local` 设置：

```text
STORE_BACKEND=json
DATA_DIR=./data
```

JSON 仓储仅用于本地单进程模拟，不具备数据库事务、多实例锁或合规审计能力。`data/` 已被 Git 忽略。

## 开发服务器

同时启动 Fastify API 和 Vite：

```powershell
npm run dev
```

接入 A 股真实只读行情并继续使用模拟交易时，推荐使用：

```powershell
npm run dev:a-share
```

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

使用 AkShare 只读行情时，在 `.env.local` 设置：

```text
MARKET_MODE=paper
MARKET_DATA_PROVIDER=akshare
AKSHARE_BRIDGE_URL=http://127.0.0.1:8800
AKSHARE_BRIDGE_TOKEN=
AKSHARE_BRIDGE_DISABLE_PROXY=true
```

然后先运行 `python akshare-bridge/main.py`，或直接使用 `npm run dev:a-share` 同时启动行情桥、API 和前端。真实行情只替换行情提供者，订单仍由本地 `PaperBroker` 模拟执行。AkShare 模式会分别读取个股行情和主要指数行情；指数使用 `SH000001`、`SZ399001`、`SZ399006`、`SH000300`，避免和个股代码冲突。

`AKSHARE_BRIDGE_DISABLE_PROXY=true` 会让 AkShare 桥接绕过本机系统代理，避免东方财富行情接口被代理连接中断；如需显式走代理，可在 `.env.local` 中设为 `false`。

前端视图可直接访问：

- `http://127.0.0.1:4173/`
- `http://127.0.0.1:4173/strategy`
- `http://127.0.0.1:4173/market`
- `http://127.0.0.1:4173/account`
- `http://127.0.0.1:4173/learning`

## VS Code 一键全栈调试

仓库提供共享的 `.vscode/launch.json`、`tasks.json` 和 `settings.json`。

1. 使用 VS Code 打开项目根目录。
2. 首次运行时执行 `npm install`。
3. 打开左侧“运行和调试”面板。
4. 模拟行情选择 `▶ KAIROS：一键启动模拟行情工作台`；A 股只读行情选择 `▶ KAIROS：一键启动真实 A 股行情 + 策略排行榜`。
5. 点击绿色启动按钮或按 `F5`。

VS Code 会：

- 使用 Node.js 调试器启动 `server/index.ts`，可在 `server/**/*.ts` 设置断点。
- 启动 Vite 前端服务。
- 使用 Edge 打开前端；真实 A 股组合会直接打开 `/strategy` 策略排行榜页。
- AkShare 组合会额外使用 Python 调试器启动 `akshare-bridge/main.py`。
- 停止复合调试时同时关闭前后端调试会话。

若 4173、8787 或 8800 端口已被占用，请先停止已有进程。服务使用固定端口，避免浏览器或代理连接到错误实例。

## 质量检查

```powershell
npm test
npm run build
python -m pytest akshare-bridge/test_bridge.py -q
```

- `npm test` 使用 Vitest，覆盖 `src/**/*.test.ts` 与 `server/**/*.test.ts`。
- `npm run build` 依次检查前端、Node.js 配置和服务端 TypeScript，再执行 Vite 生产构建。
- Python 测试验证 FastAPI 健康检查、只读接口令牌、参数边界和模型序列化。

## API 快速检查

服务启动后可运行：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
Invoke-RestMethod http://127.0.0.1:8787/api/capabilities
Invoke-RestMethod http://127.0.0.1:8787/api/account
Invoke-RestMethod http://127.0.0.1:8787/api/market/snapshot
Invoke-RestMethod http://127.0.0.1:8787/api/research/strategy-leaderboard
```

OpenAPI 界面位于 `http://127.0.0.1:8787/documentation`。

策略排行榜端点会基于当前行情快照生成确定性研究样本并运行参数搜索。它用于验证研究流程和候选策略排序，不代表真实收益；接入授权历史行情缓存前，不应把它作为实盘策略依据。

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
  -ContentType "application/json" `
  -Body $body
```

## 最近验证

2026-07-11 的验证结果：

1. `npm test`：25 个测试文件、461 项测试全部通过。
2. `npm run build`：TypeScript 检查与 Vite 生产构建通过。
3. `python -m pytest akshare-bridge/test_bridge.py -q`：13 项测试通过。
4. 测试覆盖回测、参数优化、风险、限价单、撤单、契约、JSON 恢复、HTTP/AkShare 行情适配器、监控、导出和 Fastify API。
5. API 测试验证 Helmet、安全限流、OpenAPI 和能力声明；生产构建无 CSS 语法警告。

## 生成文件

以下文件通常由 TypeScript 或构建工具生成，不应作为架构来源：

- `*.tsbuildinfo`
- 开发服务器日志
- `node_modules/`
- `dist/`
- 测试覆盖率目录

这些内容由根目录 `.gitignore` 排除，不应进入提交。长期有效的运行知识应更新到本文档，不应依赖历史日志。
