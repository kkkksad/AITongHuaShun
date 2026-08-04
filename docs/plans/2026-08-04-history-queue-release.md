# 历史行情队列可靠性发布计划

## 目标

减少 A 股板块、期货、港股、全球指数等研究模块同时请求历史日线时出现的常规“历史行情队列繁忙”提示，同时保持 AkShare 桥接的并发、缓存和磁盘占用有硬上限。

## 背景

- 市场页已拆分为多个真实只读研究模块，激活或刷新时可能同时请求行业板块、个股、期货和外盘历史。
- 旧桥接配置默认只允许 1 个活跃历史抓取、最多接纳 8 个执行中或排队序列。
- 单次行业历史上限是 20 个板块，期货主连观察池是 16 个合约，因此正常请求规模也会触发“队列繁忙”，并把未完成序列留到后台刷新。

## 改动步骤

- [x] 将 AkShare 历史调度器改为可配置的 `AKSHARE_BRIDGE_HISTORY_FETCH_MAX_ACTIVE`，默认 2 个活跃任务。
- [x] 将默认接纳上限从 8 提高到 24，覆盖当前 20 个板块和 16 个期货主连观察池。
- [x] 保持历史缓存上限 128 条、普通研究缓存上限 64 条，不增加长期落盘数据。
- [x] 更新生产 `docker-compose.production.yml`、本地 `.env.example` 和运维文档。
- [x] 更新回归测试，要求完整期货观察池默认不再触发“队列繁忙”。
- [x] 运行 Python 桥接测试、前后端测试和生产构建。
- [ ] 提交、推送到 `codex/real-market-regime` 并通过 GitHub Actions 自动部署到 `124.221.165.45`。
- [ ] 部署后检查服务器容器状态和内部健康接口。

## 发布流程

推送到 GitHub 的 `codex/real-market-regime` 分支后，`.github/workflows/deploy-production.yml` 会自动运行测试和构建，打包已验证提交，通过受限 SSH 上传到服务器，再执行 `/opt/kairos` 的生产更新脚本。服务器不直接拉取 GitHub 私有仓库。

## 验收

- `/api/market/futures/history` 的完整 16 合约观察池在测试中返回完整序列，不出现“队列繁忙”。
- `/health` 的 `historyScheduler.maxActive` 为 2，`maxPending` 为 24。
- 生产容器重启后 `https://127.0.0.1/api/health` 在服务器内部返回健康。
