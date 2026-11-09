# 模块25：指定股票报价补齐真实换手率

> 使用writing-plans规划、executing-plans执行。模块24上线核验后再修改源码，沿用用户授权。

**Goal:** 腾讯指定股票快通道保留公开源已经提供的换手率，避免两个候选扫描器把存在的证据当缺失中性分处理。

**Architecture:** 只在腾讯文本解码中补映射第38字段到既有换手率字段，沿用QuoteCache/HTTP的现有可选turnover合同。保持百分数单位，例如0.62表示0.62%，不除以100；不改候选阈值、风险或来源时间。

**Tech Stack:** Python/pandas/pytest、现有TypeScript扫描器；不新增数据源、缓存、请求或端口。

## 证据

UTC22:24从服务器只读访问公开腾讯三只股票，来源时间仍为11月9日收盘：000001字段38=0.62，600519=0.20，601318=0.35。当前解码已经保留量/额/振幅，唯独没有换手率；dailyCandidates使用健康/过热换手，dailyQualityStocks缺失按50中性因子，因此属于输入遗漏，不把它当成生产零成交的全部根因。

## 文件职责与验收

- `akshare-bridge/main.py`：fetch_tencent_a_share_dataframe补`"换手率": _parse_tencent_number(fields[38])`。未知或非有限保持旧解析与可选缺失策略，负数不作为有效换手率；不改字段顺序或源码时间。
- `akshare-bridge/test_bridge.py`：用真实格式文本构造3.25/18.5等换手率，确认百分数单位贯穿dataframe、真实QuoteCache与指定行情HTTP；空/坏/非有限不补造正值，指数保持不可交易。
- `server/research/dailyCandidates.test.ts`、`dailyQualityStocks.test.ts`：使用等量价不同真实换手输入，确认现有分数和过热反证随数据而变化，不修改评分实现；旧代码评分行为应保持。
- 0045/状态/产品/架构及主计划：来源字段/单位与真实证据限制。

- [x] 旧版Python业务回归先失败，证明dataframe/HTTP丢掉字段；记录失败数。
- [x] 最小映射与字段边界实现，目标Python/完整桥接与SDK测试、扫描器行为通过。
- [x] 服务端144文件2163项、前端55文件366项与TS/Vite通过，变更行情传递后不放宽策略门槛，不生成生产订单。
- [x] `d3986095322b53d981ae49f75cb0755d9513e04b`独立提交部署，UTC22:41核验619文件、三健康/可信HTTPS/匿名保护、原账户/检查点/归档世代及上一10efcc2材料。GitHub网络恢复后正常推送成功。
- [x] 实际生产桥接镜像无网络/无生产挂载、仅挂测试文件且PYTHONPATH=/app，完整166项通过；没有覆盖镜像源码，不把隔离结果当盘中交易验证。

Python命令沿用既有Linux镜像工具与`python -m pytest akshare-bridge/test_bridge.py akshare-bridge/test_research_cache.py akshare-bridge/test_sdk_contract.py -q`；目标用`-k turnover`。TS测试显式`--dir server`。

## 限制

上游数据可能延迟或缺字段，不借来源返回HTTP200推断数据齐全。补齐换手率既可能提高健康候选评分，也可能降低低换手/过热候选评分，不能当成提高成交量的开关。所有报价时效、费用、现金、仓位、T+1和风险门槛继续最终检查。

## 验证记录

12项新解析/真实QuoteCache→指定HTTP/无效值业务回归在旧版全失败，原154项保持；只增加第38字段非负映射后Linux完整166项通过，含真实固定SDK离线契约。新增dailyCandidates两项与既有Quality两项/来源时间七项合计11项在原扫描器实现中通过，没有修改评分逻辑或门槛。完整服务端144文件2163项、前端55文件366项及TypeScript/Vite通过，实际发布验证见下。

UTC22:41桥接实际认证HTTP三股换手率0.62/0.20/0.35与公开源一致，来源仍为11月9日收盘时刻。API和桥接镜像/容器均更换，web复用原镜像并刷新代理；不能把本次发布称为API无重启。归档210运行/88账户样本、integrity ok、分钟摘要published，风险savedAt仍17:54:57.651Z、游标0/正常/峰值20000/全计数0。上一版本616文件及三镜像、私有导出保护通过。
