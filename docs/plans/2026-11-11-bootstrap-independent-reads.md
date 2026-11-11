# 首页初始化独立只读并行

> 使用writing-plans制定，按executing-plans顺序执行。

**Goal:** 消除浏览器初始化中五类只读快照等待health/capabilities后才发出的额外网络波次；保留整体成功返回、认证边界与实时覆盖层。

**Architecture:** fetchTradingBootstrap把fetchSystemStatus与原五个GET放入同一Promise.all。仍共七请求、订单最近50、同一个AbortSignal、原Cookie与认证generation；不改useTradingBackend的启动条件、缓存、WebSocket同步、下单或服务端。任一失败仍拒绝整个bootstrap，不伪造部分成功；已发出的兄弟请求继续遵循既有取消机制。

**Tech Stack:** TypeScript、Vitest/jsdom假时钟、隔离本机HTTP计时。

## Task 1：复现

- [ ] 状态请求100ms、业务快照50ms时，原总等待150ms；应同一波开始七个GET并在100ms取得完整结果。
- [ ] 覆盖业务快照比状态慢时仍等完整返回、错误仍整体拒绝、所有请求使用同一取消信号与会话Cookie；保留最近50订单边界。
- [ ] 使用原认证generation和初始化/实时事件覆盖层回归，不能因先完成部分数据而绕过生命周期保护。

## Task 2：实现与测量

- [ ] 只修改fetchTradingBootstrap的等待编排，不新增端点、重试、轮询、缓存或部分UI状态。
- [ ] 同一本机HTTP受控响应、前后ABBA比较请求数和总时长；结果只说明可省一次网络波次，不冒充生产P95。

## Task 3：交付

- [ ] 目标回归、完整前端两worker、TS/Vite；后端/Python未改则明确继承模块14最终2728后端与原桥接结果。
- [ ] 更新0090、架构/产品/状态/总计划，记录测试与限制。
- [ ] 独立提交推送部署；核对SHA/归档哈希/三健康/可信双域HTTPS/匿名401/动态账户与检查点/上一材料。

开始前须先完成模块14发布回执与实际生产镜像检查，不同时运行两个Vitest。
