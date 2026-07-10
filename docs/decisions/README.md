# 决策记录

本目录记录影响多个模块、难以逆转或需要长期解释的决定。

## 索引

- [0001：将代码仓库作为记录系统](0001-repository-as-record.md)
- [0002：采用 TypeScript 模拟交易后端栈](0002-simulation-backend-stack.md)
- [0003：真实行情只读接入与纸面执行隔离](0003-read-only-market-provider-boundary.md)
- [0004：东方财富只读行情与统一纸面执行边界](0004-eastmoney-read-only-paper-boundary.md)
- [0005：认证原型默认禁用与显式配置](0005-auth-prototype-fail-closed.md)

## 新建格式

文件名使用 `NNNN-short-title.md`。

每份记录至少包含：

- 状态：提议、接受、取代或废弃。
- 日期。
- 背景。
- 决策。
- 结果与代价。
- 被取代关系。

只记录长期决策。一次性实施步骤应写入 `docs/plans/`。
