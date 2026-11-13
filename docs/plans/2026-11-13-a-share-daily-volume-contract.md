# A股日线成交量来源单位统一执行计划

> 当前聊天内逐项执行，遵循总计划截止及发布验收；不并行修改代码，不改变策略阈值。

**Goal:** 将实际生产SDK返回的东财日线手单位转换为股，同时保留已经是股的腾讯日线，消除相同A股接口的100倍来源差异。

**Architecture:** 只在normalize_history_dataframe识别实际eastmoney-stock-history的分支转换，不修改供应商DataFrame或已归一化缓存。其他来源保持，换算后非有限行不进入响应；历史价格、时间、复权、来源及现有调度不变。

**Tech Stack:** Python、pandas、Pydantic、pytest、固定AkShare1.20.34；TypeScript回归及Docker发布。

## 已核实证据

- 生产3bbd4bc三健康、干净树，无在途测试/发布。runtime/2026-11-13-pinned-daily-sdk.json保存实际生产桥接镜像在禁网、无账户/凭据挂载的隔离容器中读取的SDK源码，版本1.20.34；腾讯函数明确volume为股并自行乘_tx_volume_multiplier。
- 官方文档主站HTTP403，改读官方GitHub docs/data/stock/stock_quote.md，东财日线成交量手、腾讯日线股。原始片段和全文SHA存runtime/2026-11-13-akshare-daily-volume-doc*；这是当前文档，不冒充历史point-in-time数据。
- 现normalize_history_dataframe直接传递两来源volume，造成同量成交100倍尺度差异。没有证据证明该差异是11月13日零买入或中国建筑亏损的原因。

## 文件与步骤

修改akshare-bridge/main.py、test_bridge.py、test_sdk_contract.py；文档更新决策0117、开发/架构/状态及总计划。Python test_bridge.py现有autouse夹具隔离缓存，新例沿用同一文件，不额外污染SDK导入。

- [x] 在test_bridge.py增加相同交易东财100手与腾讯10000股同结果、腾讯不二次乘100、供应商原frame不变、重复归一化/批次缓存不重复换算、其他市场来源保持、换算溢出保留合法邻行及全坏显式不可用的反例。
- [x] 真实SDK离线transport原东财100/腾讯100原始载荷经SDK后分别100/10000，桥接后均10000；验证金额/价格/日期和qfq保持，空东财fallback仍为股。在test_sdk_contract.py原独立进程路径追加断言。
- [x] 先跑 `python -m pytest akshare-bridge/test_bridge.py -q -k daily_volume_contract`，确认旧版失败及控制结果。
- [x] 最小实现：原volume提取结果保持；仅 `source == "eastmoney-stock-history"` 时乘100并用math.isfinite过滤换算溢出，之后赋给HistoricalBar。Tencent已经是股、其他市场原值、输入DataFrame和缓存路径不变。
- [x] 跑本地Python全套；将本地待提交源码及全部桥接测试仅挂入临时禁网Linux测试容器，以生产同版SDK验证。另跑完整后端及TS/Vite，前端无改继承452项。
- [x] 更新文档：新生产A股日线volume均为股；旧冻结文件SHA绑定原生手声明继续有效，新增冻结输入必须显式声明股，禁止按source名字盲目再乘100。旧研究结果不重标/重写。
- [ ] 独立提交推送exit0、部署，核对完整发布保护和动态经济/风险摘要。生产桥接镜像禁网跑全套，API/网页运行内容无改应核对复用。一次文档回执后再接下一模块。

## 验收边界

这是单位正确性修复，不是新增策略或收益证明。当前主要相对量比在全序列同倍率下理论不变，但不据此宣称所有未来决策完全相同；浮点边界和来源响应仍需验证。其他非有限历史字段、缺量回退、逐股行业合同和策略持续性细项另行排查，不将本模块称为完整数据质量审计。

## 流水

- UTC14:45起核对总计划与接续状态。A/B已完成，开始C的第一个可复现来源单位模块。
- 15新增旧版9失败/6正常控制；固定SDK Linux选择性旧版另含真实传输，共10失败/6控制。最小修复后本地307通过/1非固定SDK跳过、Linux308全通过、完整191文件3137后端与TS/Vite通过。日志runtime/2026-11-13-daily-volume-{before,original-linux,python,linux,server,build}.log。准备推送部署，不提前称上线。
