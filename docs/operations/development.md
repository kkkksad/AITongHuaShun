# 本地开发

## 环境

- Node.js
- npm
- Windows PowerShell 或兼容终端

依赖和版本约束以根目录的 `package.json` 与 `package-lock.json` 为准。

## 安装

```powershell
npm install
```

## 开发服务器

```powershell
npm run dev -- --host 127.0.0.1
```

Vite 会从 `index.html` 加载 `/src/main.tsx`。

## VS Code 一键调试

仓库已经提供共享的 `.vscode/launch.json`、`tasks.json` 和 `settings.json`。

1. 使用 VS Code 打开项目根目录。
2. 首次运行时在终端执行 `npm install`。
3. 打开“运行和调试”，选择 `KAIROS：启动并调试`。
4. 按 `F5`。

VS Code 会自动执行 `npm run dev:debug`，等待 Vite 监听 `http://127.0.0.1:4173/`，随后使用 Edge 打开页面并连接前端调试器。可以直接在 `src/**/*.tsx` 和 `src/**/*.ts` 中设置断点。

如果提示 4173 端口已被占用，请先停止已有的开发服务器。`dev:debug` 使用 `--strictPort`，不会静默切换到其他端口，避免浏览器连接到错误的服务。

其他 VS Code 任务：

- `KAIROS：运行单元测试`
- `KAIROS：生产构建`

## 质量检查

```powershell
npm test
npm run build
```

- `npm test` 使用 Vitest，当前配置查找 `src/**/*.test.ts`。
- `npm run build` 先执行 TypeScript project build，再执行 Vite build。

## 最近验证

2026-07-11 的验证结果：

1. `npm test`：1 个测试文件、4 个测试全部通过。
2. `npm run build`：TypeScript 检查与 Vite 生产构建通过。
3. `npm run dev -- --host 127.0.0.1 --port 4173`：本地页面可访问。
4. 页面结构检查确认总览、策略、市场、账户和研究管线入口均已渲染。

生产构建已将应用主包、图表库和图标库拆分。最近一次结果中，应用主包约 210 kB，Recharts 图表包约 420 kB，均低于当前 500 kB 告警线。

## 生成文件

以下文件通常由 TypeScript 或构建工具生成，不应作为架构来源：

- `*.tsbuildinfo`
- 编译产生的 `vite.config.js`
- 编译产生的 `vite.config.d.ts`
- 开发服务器日志
- `node_modules/`
- `dist/`
- 测试覆盖率目录

这些内容由根目录 `.gitignore` 排除，不应进入提交。长期有效的运行知识应更新到本文档，不应依赖历史日志。
