# 0019：浏览器认证生命周期隔离

日期：2026-11-05。状态：接受。

## 问题

QueryClient由整个页面共享。只禁用bootstrap不能清掉仍在新鲜期的资金计划、日周复盘和其他受保护查询；旧mutation的成功/失败回调也可能在新认证后覆盖新账户显示。原生HTTP实验还证明，无signal旧请求的401响应体晚于新登录完成时，会错误清掉新会话CSRF并发出过期事件。

## 决策

- App在登录、会话确认、退出或过期边界同步推进内存epoch，然后取消并清除整个业务QueryClient，先清理再允许新认证加载。路由和本地策略参数独立保留，同会话导航继续复用新鲜查询。
- 六类交易mutation捕获发起时epoch。迟到成功/失败保留原Promise结果，但不写新会话缓存或提示；reset每个await之后再次核验，研究清理helper在自己的取消await后亦核验。切换时清旧pending/notice并重建socket。旧verify/退出完成不能覆盖后来的认证。
- API请求捕获独立内存generation。当前保护请求401仍清CSRF并通知过期；旧generation的401仅向原调用方返回原错误。login成功、当前verify成功、显式过期和退出建立边界，旧verify/退出清理不得改写后来CSRF。

## 实施与限制

模块54实现App、hook和查询清理，模块56实现API generation隔离；两层各自验证发布，不依赖请求一定及时取消。认证材料仍只在内存，不新增持久token或订单执行权限。

这些约束隔离客户端缓存、提示和认证内存；不会撤销已到服务端的操作，也不保证并发HTTP响应的浏览器Set-Cookie顺序。真实账户执行权限与本决策无关。

## 验证

模块54用真实React/App/Settings/Router/QueryClient及受控网络/Socket验证30项认证交错，保留原同会话重置和导航回归。模块56用localhost原生HTTP/fetch及流式Response.text验证旧401、真实abort和CSRF头，完整结果与发布记录见[夜间计划](../plans/2026-11-05-overnight-module-upgrades.md)。
