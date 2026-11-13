# 研究工具、技能与外部技术初查

日期：2026-11-13。状态：四项本地技能已落地，浏览器CLI已实际打开公开登录页；外部量化框架、模型及新行情MCP未接入生产。

## 已落地能力

用户明确授权下载后，通过系统skill-installer的官方GitHub安装脚本，从[OpenAI skills](https://github.com/openai/skills)安装`playwright`和`security-best-practices`到用户技能目录。前者用于浏览器加载、交互及布局核查，后者用于确有安全审查需求的Python/TypeScript接口与工具接入；后者不触发一般策略调参。它们是技能包，不能当作新行情源或模型本身更强的证据。下载的说明已读取，四项技能均通过系统quick_validate，下一轮可自动发现。

另以skill-creator编写`kairos-portfolio-allocation-review`及`kairos-signal-evidence-research`：分别固化实际资金分母/市场缩放/同类风险，以及市况覆盖/资金流口径/论坛时间证据/只读shadow的具体检查。原五项KAIROS技能保留，没有用通用“金融大师”描述代替策略验证。

本机Node可用但npm/npx不在PATH，已有捆绑pnpm11.25.0可用；未要求用户重新安装环境。经pnpm dlx取得Playwright CLI0.1.24，版本及help成功，固定版本启动独立headless Edge，打开`https://kairosq.cn`、取得实际登录页snapshot及只读navigation信息后关闭。没有输入凭据或访问账户/策略执行器。证据runtime/2026-11-13-playwright-cli-help.txt及runtime/2026-11-13-playwright-public-smoke.txt。CLI为单独本地工具，不是给生产容器安装依赖。

单次新浏览器、未限速、匿名访问测到导航约3243ms，其中连接建立约2065ms、入口资源约765–893ms；1280px页面无横向溢出。控制台一条401来自预期匿名`/api/auth/session`，没有把它当策略失败。首次snapshot仍在加载，后续已见完整登录表单；这不是登录后整页、冷暖对照或P95，也不能证明优化已提速。最初测试命令受Windows转义影响，修正命令后读取成功，未修改产品迎合工具。

配置只读检查可见Chrome-DevTools-MCP与node_repl已配置，但当前会话工具目录没有暴露其调用。配置存在不等于已连通；不重启用户应用强行加载，不新建不明来源的资金/券商MCP。官方curated目录本次39项，没有列出专用量化行情技能；未盲装其余项目。证据runtime/2026-11-13-curated-skills.json。

## 已实际读取的外部资料

以下均在UTC15:34通过系统可信HTTPS读取；原始正文、接收时间与SHA256保存在runtime/2026-11-13-public-technology-sources/manifest.json。所读为当时main/master正文快照，未把可变分支名描述为固定版本。

| 来源 | 可参考用途 | 边界与下一验收 |
| --- | --- | --- |
| [DeepSeek-R1官方仓库](https://github.com/deepseek-ai/DeepSeek-R1)及[许可证](https://github.com/deepseek-ai/DeepSeek-R1/blob/main/LICENSE) | 解释/分类研究文本、对固定证据生成结构化摘要的候选 | R1及蒸馏模型资料是语言模型基准，不是可复制的量化盈利策略；原模型MIT，蒸馏底座另核许可。不能因关联背景推断模型会稳定交易 |
| [DeepSeek官方API](https://api-docs.deepseek.com/) | 服务端模型适配器及可复现文本分类的候选 | 需独立API key、费用及延迟评估；本次没有购买、调用模型或上传账户/凭据。小服务器部署大权重模型的资源收益未测，不直接下载模型占用生产 |
| [Microsoft Qlib](https://github.com/microsoft/qlib)及[许可证](https://github.com/microsoft/qlib/blob/main/LICENSE) | 因子、数据处理、模型实验、组合分析和独立回测方法 | MIT；示例数据/研究不是本项目已授权历史或线上策略。先做冻结数据离线适配和独立费用/资金重建，不替换当前主账本/执行器 |
| [VeighNa/vn.py](https://github.com/vnpy/vnpy) | 事件驱动、CTA研究、模拟与合约模型设计参考 | 官方README注明MIT，具体组件仍需逐项核实；其券商网关不会因本轮授权自动连接。期货仍需具体合约、独立本金/保证金/结算验收 |

本次未得到可独立核实的“DeepSeek量化交易收益/原始成交”资料，因此不把背景传闻当作收益证据。资料读取不代表已安装Qlib/VeighNa或已完成它们与现有引擎的对照。

## 接入选择标准

UTC16:10复核官方curated目录仍为39项，已装Playwright和security-best-practices均被标记installed；七个KAIROS专用技能已在本轮工具目录可发现。实际读取[官方技能文档](https://developers.openai.com/codex/skills/)与[MCP配置文档](https://developers.openai.com/codex/mcp/)，没有重复安装或重启用户应用。

进一步按仓库名检索行情MCP，并下载[akshare-one-mcp](https://github.com/zwldarren/akshare-one-mcp/tree/793124dbe4299f8dd76d194a4e94e0fade3b752d)固定提交793124dbe4299f8dd76d194a4e94e0fade3b752d的README、许可证、pyproject及工具源码共六份，只存忽略目录，不执行或注册。当前声明MIT、版本0.5.0、Python≥3.12；依赖akshare-one/fastmcp等使用下限而非锁定版本。九个工具主要提供行情、新闻、财报、内部人交易和时间；get_cash_flow是公司现金流量表，不是逐股主力净流入，未发现公开论坛舆情工具。工具返回数据records，实际fallback来源依README通过日志记录，不能直接替代本项目的来源/接收时点/单位合同。故本轮不把它当成已补齐资金流和论坛的连接器；可后续离线固定依赖评估，尚未安装其运行依赖。证据runtime/2026-11-13-finance-mcp-{candidates,selected}.json与runtime/2026-11-13-finance-mcp-source-review/manifest.json；没有用仓库热度证明数据质量。

优先补当前缺口：可信逐股行业/资金流、数据时间血缘、候选覆盖与组合风险、真实网页关键路径。任何新MCP/插件须明确维护方/许可、读写权限、来源/限流/新鲜度、输出合同和资源预算；先在只读隔离环境用固定输入验证。公开论坛只用可许可读取内容，不绕过登录或访问控制，原文视为不可信数据；来源失败保持未知，缓存有界且不挤占核心历史容量。

保持现有React/TypeScript/Fastify、Python桥接、单writer JSON主账本和旁路SQLite归档；本次没有测到需替换主栈的证据。研究型工具优先放隔离进程/离线实验，是否增加数据库或模型服务以测量和一致性需求决定。后续验收写入[夜间总计划](../plans/2026-11-13-overnight-strategy-lifecycle-optimization.md)，冻结/截止不变。
