# 历史研究超时治理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将 A 股、板块、港股、期货和全球历史研究从“客户端长时间等待后超时”改为有界调度、部分结果优先返回、后台单飞预热和明确降级，避免一个上游历史源拖慢整个工作台。

**架构：** AkShare 调用继续保持单线程，避免原生提供者并发不安全；在桥接历史缓存之前增加全局有界调度器和每个 HTTP 批次的响应预算。未完成的单序列继续由缓存后台预热，响应立即返回已有结果和稳定告警。服务端研究调用统一使用受控历史读取时限，不再把基础行情超时乘到 60 至 360 秒。

**技术栈：** Python FastAPI、`asyncio`、AkShare、TypeScript、Fastify、Vitest、pytest。

---

## 已确认事实

- 2026-07-21 桥接 `/health` 显示 `historyCache.inFlight=18`，而 `AKSHARE_EXECUTOR` 为单线程；多个历史批次在同一队列排队。
- 股票历史每个代码依次尝试东方财富、腾讯和新浪；前两源当前各有最长 12 秒请求，批量 12 只股票在串行执行时无法在 Fastify 的 60 秒等待内完成。
- `marketRegimeResearch`、个股趋势、变盘雷达、港股、期货、稳健性和外盘研究各自按 4、8、12 或 24 倍扩大基础超时，导致相同上游故障被放大为长时间 UI 加载。
- 当前单序列缓存具备 fresh/stale/single-flight，但没有全局队列上限、批次响应预算或失败冷却；客户端中止不应把已经开始的缓存预热变成无界积压。

## Task 1：有界历史调度与响应预算

**文件：**
- 修改：`akshare-bridge/research_cache.py`
- 修改：`akshare-bridge/main.py`
- 测试：`akshare-bridge/test_bridge.py`

- [x] **Step 1: 写失败测试，锁定慢批次不阻塞 HTTP 响应。**

```python
def test_stock_history_returns_completed_series_when_other_series_exceed_budget():
    with patch("main.fetch_stock_history_dataframe", side_effect=slow_fetch):
        response = client.get("/api/market/stock-history?symbols=600519,000001&days=180")
    assert response.status_code == 200
    assert "后台刷新" in response.json()["warning"]
```

- [x] **Step 2: 写失败测试，锁定全局排队上限与健康指标。**

```python
assert response.json()["historyCache"]["inFlight"] <= configured_max_pending
assert response.json()["historyScheduler"]["rejected"] >= 1
```

- [x] **Step 3: 实现 `HistoryFetchLimiter`。**

```python
class HistoryFetchLimiter:
    async def run(self, fetcher: Callable[[], Awaitable[T]]) -> T:
        # Reject work beyond max_pending before it can accumulate behind AKSHARE_EXECUTOR.
        ...
```

将 limiter 放在缓存任务内部，使同一 `HistoryCacheKey` 仍 single-flight；任何被拒绝的项目只写入当前响应警告，不写原始错误、Cookie 或请求参数。

- [x] **Step 4: 将 `build_history_response` 改为预算内收集。**

```python
done, pending = await asyncio.wait(tasks, timeout=HISTORY_RESPONSE_BUDGET_SEC)
# Return normalized completed series. Pending cache tasks keep warming the bounded cache.
```

响应包含已完成系列和“仍在后台刷新/队列繁忙”的有界提示。未完成任务必须消费异常，缓存成功结果保留 fresh/stale TTL，失败不写入成功缓存。

- [x] **Step 5: 缩短不可控第三回退的阻塞面。**

保留具有显式网络超时的东方财富、腾讯股票历史源；默认不调用无法传入请求超时的新浪日线回退。每个支持超时参数的提供者使用受控秒数，失败继续返回来源与警告，不填充静态数据。

- [x] **Step 6: 运行桥接测试。**

Run: `D:\conda\python.exe -m pytest akshare-bridge/test_bridge.py -q -p no:cacheprovider`

Expected: 全部通过，慢批次测试不等待完整外部请求。

## Task 2：统一 Fastify 历史读取时限

**文件：**
- 新建：`server/research/historyRequestPolicy.ts`
- 新建：`server/research/historyRequestPolicy.test.ts`
- 修改：`server/research/marketRegimeResearch.ts`
- 修改：`server/research/stockTrendForecast.ts`
- 修改：`server/research/turningPointScanner.ts`
- 修改：`server/research/strategyRobustness.ts`
- 修改：`server/research/hongKongMarketResearch.ts`
- 修改：`server/research/crossMarketStrategyContext.ts`
- 修改：`server/research/externalMarketImpact.ts`

- [x] **Step 1: 写失败测试，固定历史研究超时上限。**

```ts
expect(historyBridgeTimeoutMs(15_000)).toBe(30_000);
expect(historyBridgeTimeoutMs(1_000)).toBe(8_000);
expect(historyBridgeTimeoutMs(300_000)).toBe(30_000);
```

- [x] **Step 2: 实现唯一的历史读取策略。**

```ts
export function historyBridgeTimeoutMs(baseTimeoutMs: number): number {
  return Math.min(30_000, Math.max(8_000, Math.round(baseTimeoutMs * 2)));
}
```

该策略只用于历史日线；普通快照、搜索、新闻和数字资产继续使用各自的短时限，不改变 Paper 下单边界。

- [x] **Step 3: 替换所有历史端点的乘数。**

把 `* 4`、`* 8`、`* 12`、`* 24` 替换为 `historyBridgeTimeoutMs`。模块仍在桥接返回部分结果时保留可用数据，并把 warning 透传给 UI，而不是抛出原始 `fetch failed`。

- [x] **Step 4: 运行研究聚焦测试。**

Run: `vitest run server/research/historyRequestPolicy.test.ts server/research/marketRegimeResearch.test.ts server/research/stockTrendForecast.test.ts server/research/turningPointScanner.test.ts server/research/hongKongMarketResearch.test.ts --environment node`

Expected: 全部通过，历史请求不会生成超过 30 秒的客户端等待。

## Task 3：运行态诊断、文档和回归

**文件：**
- 修改：`docs/architecture/system-overview.md`
- 修改：`docs/operations/development.md`
- 修改：`docs/status/current-state.md`
- 修改：`docs/plans/README.md`
- 修改：本计划

- [x] **Step 1: 重启桥接和 API，确认历史在途任务清零。**

验证 `/health` 中 `historyCache.inFlight`、新增的 `historyScheduler`、4173/8787/8800 健康检查和登录保护。

- [x] **Step 2: 并发请求历史研究。**

```powershell
Invoke-RestMethod 'http://127.0.0.1:8787/api/research/market-regime?sectorLimit=10&stockLimit=8&days=180'
Invoke-RestMethod 'http://127.0.0.1:8787/api/research/turning-points?limit=12&days=360'
```

验证任一上游慢时返回受控 `warning` 和部分结果或明确降级，桥接队列不超过配置上限，后续刷新可复用后台预热序列。

- [x] **Step 3: 全量验证。**

Run: 服务端 Vitest、前端 Vitest、Python pytest、`tsc -b`、Vite build、`git diff --check`。

- [x] **Step 4: 更新状态文档并完成提交前检查。**

确认待提交内容不包含 `.env.local`、`data/`、日志、SPT、UID、密码或 pnpm 临时文件。除非用户另外要求，不创建提交或推送远程。

## 实际结果

- 桥接默认 `maxActive=1`、`maxPending=8`，历史批次响应预算为 6 秒；运行态最终 `active=0`、`pending=0`、`historyCache.inFlight=0`。
- 12 只 A 股首轮在约 6.2 秒返回 5 个已完成序列和受控警告，后续渐进预热后 12/12 返回且无警告。
- 16 个受控期货主连首轮和第二轮返回有界部分结果，预热完成后 16/16 在 234ms 返回，未再出现 HTTP 400。
- 运行态没有绕过登录保护：未认证业务接口继续返回 401；Fastify 研究端点由聚焦测试和全量服务端测试覆盖，桥接并发与队列指标使用真实运行进程验证。
- Python 109 项、服务端 Vitest 797 项、前端 Vitest 90 项全部通过；TypeScript 检查、Vite 生产构建和 `git diff --check` 通过。
- 方案偏离：板块历史从批次级普通缓存迁移到逐序列历史缓存，避免部分批次被缓存 15 分钟；期货完整观察池大于队列上限时采用多轮渐进预热，不放宽全局队列。
