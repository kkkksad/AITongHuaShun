# 0068：新标的漏斗进入长期归档白名单

状态：只读数据链路T1已发布，网页展示T2已验证；实际发布见[计划](../plans/2026-11-10-overnight-strategy-and-loading.md)。

0052已在当前计划和自动运行审计的strategyCoverage下保留newPositionFunnel，SQLite采集未接收该字段，长期复盘无法区分已有仓位、新标的资格、独立金额覆盖和最终拟买数量。

采集从`strategyCoverage.newPositionFunnel`读取固定scope、七项计数和布尔许可，存入运行details_json顶层newPositionFunnel；投影与Node再次独立按同一规则校验，只放入最多20条latestRuns。不迁移SQL表/schemaVersion，不回填已归档事件，不保存股票列表、名称、请求正文或额外字段。

scannerCandidateCount至多100万，其余池计数至多12，均为非负整数（Python显式拒绝bool）。已有持仓+新股=考虑池，考虑池不超scanner，资格不超新股，独立金额覆盖不超资格，拟买不超新股。无字段/缺任一必需字段/错误类型/范围/关系时整个可选funnel为null，运行其他证据仍有效。真实零和false保持，不从旧matchedCandidateCount等近似重建。

该信息只解释计划，独立金额覆盖不代表多单总现金可同时覆盖，拟买不是提交或成交，布尔许可不替代Broker风控。

T2在同一归档面板加独立漏斗表，最多20条，展示实际时间和七计数/全局许可；旧null未知，实际0/false保持，过期提醒与跨世代隐藏沿用。不增加请求/轮询或研究；窄屏表格各自滚动，页面不横溢。新增三项缺失行为旧版失败，最终目标14项、完整前端/构建与隔离Chrome验证记录于计划。

旧版Python真实SQLite/投影新增两项失败，Node新增14项失败。修后Node目标36项通过（另补真实零回归进入完整验证），Windows与Linux验证见流水。Linux使用临时隔离目录和真实生产账本私有副本，生产主账本字节保持、SQLite完整性ok，不触发交易或通知。
