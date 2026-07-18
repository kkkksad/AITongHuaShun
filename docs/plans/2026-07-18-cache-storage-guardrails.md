# 缓存与运行存储防护实施计划

> 状态：已完成。按测试先行方式完成，验证结果见文末。

**目标：** 给研究缓存和运行日志增加可配置的硬上限，避免长时间运行时内存、磁盘和无效文件持续增长，同时保持本地 paper 交易状态完整。

**方案：** Python 行情桥使用 TTL + LRU 的有界缓存，并在读写路径主动清除过期项；Node 启动前只扫描仓库内 `logs/*.log`，按保留天数、单文件预算和目录总预算清理非活动日志。健康检查公开缓存条目、上限和淘汰计数，便于确认限制是否生效。

**技术栈：** Python 3、FastAPI、pytest、TypeScript、Node.js、Vitest。

---

## 文件边界

- `akshare-bridge/research_cache.py`：提供通用有界 TTL 缓存，并给历史研究缓存增加 LRU、主动过期清理和统计。
- `akshare-bridge/main.py`：接入缓存上限环境变量，并在桥接健康接口公开缓存容量。
- `akshare-bridge/test_research_cache.py`、`akshare-bridge/test_bridge.py`：验证容量、LRU、过期清理和健康响应。
- `server/operations/runtimeFileRetention.ts`：实现限定目录的日志预算计算与清理，不读取或修改交易数据。
- `server/operations/runtimeFileRetention.test.ts`：验证过期、超大文件、总预算、活动文件保护和路径边界。
- `scripts/cleanup-runtime-files.ts`、`package.json`：在本地开发服务启动前运行日志清理。
- `.env.example`、`docs/operations/development.md`、`docs/architecture/system-overview.md`、`docs/status/current-state.md`：记录默认预算、边界和验证结果。

### 任务 1：Python 缓存容量硬上限

- [x] 先增加普通缓存和历史缓存的失败测试：超限淘汰最久未使用项、读取更新 LRU、写入时主动清除过期项、进行中的历史请求不被淘汰。
- [x] 运行 `python -m pytest akshare-bridge/test_research_cache.py -q`，确认新测试先失败。
- [x] 实现 `BoundedTTLCache`，并让 `ResearchHistoryCache` 接受 `max_entries`，统计 `entries`、`max_entries`、`evictions`、`expired_pruned` 和 `in_flight`。
- [x] 在 `main.py` 接入 `AKSHARE_BRIDGE_RESEARCH_CACHE_MAX_ENTRIES=64` 与 `AKSHARE_BRIDGE_HISTORY_CACHE_MAX_ENTRIES=128`。
- [x] 更新 `/health` 测试并公开两类缓存的容量统计。
- [x] 运行 `python -m pytest akshare-bridge/test_research_cache.py akshare-bridge/test_bridge.py -q`。

### 任务 2：开发日志磁盘预算

- [x] 先增加失败测试，覆盖 7 天过期删除、20 MB 单文件限制、100 MB 目录总预算、最近写入文件跳过和目录外路径拒绝。
- [x] 实现 `cleanupRuntimeLogs`，只处理经过解析且位于目标 `logs` 目录内的普通 `.log` 文件；删除失败只返回告警，不阻塞项目启动。
- [x] 增加 `runtime:cleanup`，并通过 `predev`、`predev:a-share` 在服务启动前执行。
- [x] 默认使用 `RUNTIME_LOG_RETENTION_DAYS=7`、`RUNTIME_LOG_MAX_TOTAL_MB=100`、`RUNTIME_LOG_MAX_FILE_MB=20`；最近 5 分钟仍在写入的日志暂不删除。
- [x] 运行日志清理专项测试，再用清理脚本的 dry-run 检查现有 `logs`。

### 任务 3：文档与完整验证

- [x] 更新环境变量示例和运维文档，明确不会自动删除 `node_modules`、交易状态、现金、持仓、开放订单和七天内审计记录。
- [x] 更新架构与当前状态，区分内存条目上限和磁盘 MB 预算。
- [x] 运行 `python -m pytest akshare-bridge/test_research_cache.py akshare-bridge/test_bridge.py -q`。
- [x] 运行服务端、前端、TypeScript、Vite 构建和 `git diff --check` 验证。
- [x] 记录实际验证结果和仍存在的限制。

## 不变量

- 清理器绝不扫描 `data/`，也不修改 `paper-trading-state.json`。
- 缓存淘汰只影响可重新拉取的只读研究结果，不得改变订单、现金或持仓。
- 活动日志可以暂时超过预算，但会在停止写入后于下一次启动清理，避免删除仍被进程占用的文件。
- 缓存命中不改变数据来源和时间戳语义，过期缓存不得冒充实时数据。

## 验证结果

- `D:\conda\python.exe -m pytest akshare-bridge/test_research_cache.py akshare-bridge/test_bridge.py -q`：88 项通过；另有一项 FastAPI/httpx 依赖弃用警告。
- 服务端 Vitest：42 个测试文件、703 项通过，其中日志预算专项 6 项通过。
- 前端 Vitest：21 个测试文件、63 项通过。
- TypeScript 项目检查通过；Vite 生产构建通过，转换 2,313 个模块。
- `git diff --check` 通过，仅有仓库既有的 LF/CRLF 转换提示。
- 实际 dry-run 扫描 12 个日志、41.1 MB，确认只需删除一个 38.2 MB 的非活动旧日志；执行后剩余 11 个日志、2.84 MB。
- 当前 `4173`、`8787`、`8800` 各只有一个监听进程。另有一个 2026-07-16 遗留、未监听项目端口的 Python 进程，工作集约 0.1 MB；因无法确认是否属于其他任务，未自动结束。
- 持续写入的活动重定向日志允许暂时超过预算，停止写入后会在下一次开发启动时清理；这是避免误删活动文件的有意取舍。
