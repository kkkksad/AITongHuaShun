# 0101：必需应用根组件随入口载入

日期：2026-11-13（北京时间）。状态：已实现，发布保护接续[计划](../plans/2026-11-12-research-wait-and-page-measurement.md)。

main原先先载入入口，再通过lazyWithChunkRecovery动态载入每次都必需的App，App加载完成后才开始原会话检查。匿名登录页的实际请求记录包含这一额外脚本波次。

main改为静态导入App。保持现有会话检查、认证隔离、错误边界、Suspense、vite:preloadError恢复及PWA规则；App内各页面与图表继续沿用lazyWithChunkRecovery。不提前请求受保护账户，不新增认证状态或接口。入口块由约199.19KB增加至267.63KB，原约68.65KB的App被合入，总JS没有因此消失；必需根组件少一次请求，各页面仍按需载入。

跨文档恢复测试夹具相应采用必需App壳内的真实React.lazy页面，而不是把同步require当Promise。原跨刷新重试上限、存储失败、混合preload事件、普通错误、成功导入、无SW及开发清理共15项继续执行；另有3项恢复单测。真实完整构建Chrome对照见[研究报告](../research/2026-11-12-required-app-entry-loading.md)。固定80ms响应、390/1440各ABBA的表单就绪中位619.45→319.35ms，只证明受控等待减少，不能宣称生产P95或FCP改善。此改动不触及交易、行情源或后端并发。
