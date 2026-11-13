# 研究工具、技能与外部技术初查

日期：2026-11-13。状态：此前四项本地技能和浏览器CLI已验证；本次新增Jupyter技能及独立执行环境、Context7文档MCP配置和实际匿名读取，UTC18:24前另完成Chrome DevTools MCP启动修复、实际性能追踪及LCP技能安装。外部量化框架、模型及新行情MCP未接入生产。

## Chrome DevTools MCP实际连通与LCP技能

用户再次授权下载获取后，复核官方插件/MCP正文和现有配置：`Chrome-DevTools-MCP`原命令为`npx -y chrome-devtools-mcp@latest`，当前npx不在PATH，不能把配置存在当可用。按[官方ChromeDevTools项目](https://github.com/ChromeDevTools/chrome-devtools-mcp)及npm元数据，下载固定1.13.0、Apache-2.0官方包；SHA512与registry完整性字段匹配，388文件逐SHA256留存。该发布包已捆绑运行依赖，无额外运行dependencies，不执行prepare/安装脚本；仅放用户工具目录，未改项目锁文件或服务器。

通过Codex MCP CLI将原条目改为既有Node绝对路径加固定入口，不重复注册第二个浏览器MCP。启用headless/isolated，禁用工具使用统计、更新检查和CrUX外部查询；不附着用户浏览器、不复用用户登录。保存安装前完整配置到用户私有备份目录，核对其他配置与另外两个MCP逐字段语义保持。当前会话通过独立stdio客户端真实完成初始化、33工具发现、两次快照、只读DOM/NavigationTiming、两次网络列表、性能记录和控制台共10项检查，成功保存可解码的440166字节/16828事件trace并正常退出。测试客户端协商工作区roots，不开启不受限文件访问；先前根目录未协商和GBK打印问题已修正，最终完整执行exit0。未声称当前会话原生MCP已热加载；安装后的技能下一轮可发现，客户端何时重载原生MCP仍需实际确认。

同时用官方skill-installer从ChromeDevTools固定提交`b1e35e3ab1774664dfc66a2cb813a392535fe160`安装`debug-optimize-lcp`；5文件与完整性校验后的同版本包逐字节一致，UTF-8格式校验通过。它提供LCP分段、关键资源和冷热对照步骤，不是额外行情或交易策略。来源及验收见runtime/2026-11-13-{devtools-installed-manifest,devtools-config-verification,devtools-smoke,lcp-skill-verification}.json与-devtools-public-trace.json.gz。

最终匿名新浏览器初次navigation约4395ms，其中连接约2487ms；同一临时浏览器trace重新加载的LCP909ms（TTFB531ms/渲染等待378ms）、CLS0。最终快照已显示完整登录表单，网络唯一预期401为`/api/auth/session`。这是未限速匿名样本及暖加载trace，不是登录后P95、优化前后实验或生产提速结论；CrUX关闭时工具输出的“无数据”不能视为查询了真实用户指标。后续F用它复现关键路径并测冷热对照，不能把安装当性能优化完成。

## 本次新增授权与实际验收

UTC18:57接续用户授权，重新读取官方plugins/skills/MCP正文并查询39项curated目录；已有四类工具及原验收记录覆盖当前浏览器、文档和离线研究用途，没有重复安装。随后再验DevTools388文件、Jupyter技能12文件、LCP技能5文件与此前固定版本清单全匹配，Context7官方端点及DevTools绝对可执行路径检查通过。本会话仍未暴露Context7/DevTools原生调用，先前独立stdio实际验收与原生热加载严格区分。没有专用逐股资金流/论坛技能可直接补齐合同，未将get_cash_flow误作主力流入；未新增生产依赖或付费服务。只读来源时间、SHA与结论见runtime/2026-11-13-plugin-followup.json；工具支持研究和排障，不证明策略盈利。

用户再次明确允许下载获取有用插件。复核[官方插件](https://developers.openai.com/codex/plugins)、[技能](https://developers.openai.com/codex/skills)及[MCP文档](https://developers.openai.com/codex/mcp)正文；当前会话没有插件安装工具，采用官方技能安装器及Codex MCP配置命令，区分技能包、外部工具和生产能力。

- **Jupyter研究技能**：官方`openai/skills`固定提交`77963424cd7687fd52e5fcfdd3f08d826ab9b1ab`，`skills/.curated/jupyter-notebook`；安装后12个文件与固定源逐字节一致，格式校验通过。独立用户工具环境安装固定`nbformat 5.11.1`、`nbclient 0.11.0`、`ipykernel 7.4.0`，顶层许可证BSD-3-Clause，36个完整依赖版本及下载哈希留存；未修改项目或服务器依赖。官方模板生成实验笔记后，使用已有冻结结果执行全部两段代码，验证216组完整结果保持和两次输出字节一致。没有新增收益结论；Windows运行有兼容/本地内核提示但无执行错误，内核随执行结束退出，不启动公开Notebook服务。
- **Context7文档MCP**：维护方Upstash，所读开源许可MIT；按其官方地址`https://mcp.context7.com/mcp`注册为用户级`context7`，不下载或执行第三方MCP本地包。实际无凭据完成initialize、两个工具列表、Fastify库匹配和6686字符超时文档读取，服务返回版本4.7.0；只发送公开技术问题，文档本身须回到具体版本源核实。CLI添加配置后自动发起OAuth，已中止该可选登录；后续匿名读取通过，不称完成账户授权。注册成功不等于当前会话已热加载原生工具，下一轮/客户端重新加载后再核验；此前两个MCP条目仍存在。未保存完整安装前配置，仅语义摘要，故不宣称全部配置逐字段不变。

安装后的技能下一轮可自动发现。当前会话已用独立客户端实际执行读取和研究，避免将“已配置”当“已使用”。来源与验收位于`runtime/2026-11-13-{jupyter-install-source,jupyter-installed-manifest,notebook-environment,notebook-pip-report,context7-smoke}.json`及已执行`-tool-smoke.ipynb`；仅记录来源、版本与公开研究，没有凭据或生产账户导出。

已有Playwright继续负责页面交互；Chrome-DevTools-MCP此前未暴露原生工具，现已按上节实际连通验收，原生热加载仍未确认。没有重启用户应用、付费订阅或安装未经验证的资金/券商插件。专用资金流/论坛缺口沿H计划来源合同推进，下面的`get_cash_flow`财报工具不能替代它。

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
