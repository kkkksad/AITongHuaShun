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
```

需要修改默认端口或风控参数时，将 `.env.example` 复制为未提交的 `.env.local`。任何供应商 Token 或密钥只能放在 `.env.local`，不得使用 `VITE_*` 暴露给浏览器。

## 开发服务器

同时启动 Fastify API 和 Vite：

```powershell
npm run dev
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

Vite 将 `/api` 和 `/ws` 代理到本地 Fastify 服务。当前 `MARKET_MODE` 只允许 `mock` 或 `paper`；配置为 `live` 会拒绝启动。

## VS Code 一键全栈调试

仓库提供共享的 `.vscode/launch.json`、`tasks.json` 和 `settings.json`。

1. 使用 VS Code 打开项目根目录。
2. 首次运行时执行 `npm install`。
3. 打开“运行和调试”，选择 `KAIROS：全栈调试`。
4. 按 `F5`。

VS Code 会：

- 使用 Node.js 调试器启动 `server/index.ts`，可在 `server/**/*.ts` 设置断点。
- 启动 Vite 前端服务。
- 使用 Edge 打开前端，可在 `src/**/*.tsx` 和 `src/**/*.ts` 设置断点。
- 停止复合调试时同时关闭前后端调试会话。

若 4173 或 8787 端口已被占用，请先停止已有进程。两个服务都使用固定端口，避免浏览器或代理连接到错误实例。

## 质量检查

```powershell
npm test
npm run build
```

- `npm test` 使用 Vitest，覆盖 `src/**/*.test.ts` 与 `server/**/*.test.ts`。
- `npm run build` 依次检查前端、Node.js 配置和服务端 TypeScript，再执行 Vite 生产构建。

## API 快速检查

服务启动后可运行：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
Invoke-RestMethod http://127.0.0.1:8787/api/account
Invoke-RestMethod http://127.0.0.1:8787/api/market/snapshot
```

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

1. `npm test`：4 个测试文件、15 项测试全部通过。
2. `npm run build`：TypeScript 检查与 Vite 生产构建通过。
3. Fastify 注入测试验证健康检查、请求校验、模拟成交与暂停拒单。
4. 生产构建已拆分应用、图表和图标包；Recharts 图表包约 420 kB。

## 生成文件

以下文件通常由 TypeScript 或构建工具生成，不应作为架构来源：

- `*.tsbuildinfo`
- 开发服务器日志
- `node_modules/`
- `dist/`
- 测试覆盖率目录

这些内容由根目录 `.gitignore` 排除，不应进入提交。长期有效的运行知识应更新到本文档，不应依赖历史日志。
