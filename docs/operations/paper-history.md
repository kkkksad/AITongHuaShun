# Paper长期历史归档

新增标的漏斗按[0068](../decisions/0068-new-position-funnel-archive.md)从运行审计进入SQLite和latestRuns只读摘要，固定scope/七项有界计数/布尔许可，不保存股票列表或额外正文。网页独立漏斗表最多20条，旧/坏样本未知、真实零保持，不重写已归档事件；拟买数不是提交/成交数，独立金额不代表同批累计资金充足。

最近20条保留运行现可显示单调总耗时、研究、通知和订单准备/提交耗时，口径见[0051](../decisions/0051-paper-run-monotonic-stage-timing.md)。采集和投影都只保留固定timing字段，未知旧记录/未运行阶段/坏样本显示未知；不根据记录间隔补算，不重写已归档的旧事件。可从后续自然运行积累证据，休市启动样本不能当盘中研究性能。

本模块是[决策0025](../decisions/0025-read-only-sqlite-paper-history.md)中的只读观察副本。安装后的数据从原JSON账本读取；数据库不参与下单、风控和实时权益计算。按[0040](../decisions/0040-paper-history-bounded-read-model.md)，网站通过当前账户世代的有界摘要读取近七日运行证据，仍不替代交易主账本。

## 安装与权限

先部署包含持久`accountEpoch`的后端并确认原账户保持，再在现有Ubuntu服务器执行：

```bash
cd /opt/kairos
sudo bash deploy/install-paper-history.sh
systemctl status kairos-paper-history.timer --no-pager
systemctl show kairos-paper-history.service -p Result -p ExecMainStatus -p MemoryPeak
```

脚本只适用当前`ubuntu`部署用户和`/opt/kairos`。每60秒启动一次oneshot，无重叠运行；重启后约1分钟恢复。服务无网络、源目录只读、归档目录0700、产物0600；单核25%CPU、192MiB内存、45秒上限。停止采集使用`sudo systemctl disable --now kairos-paper-history.timer`，现有交易服务继续运行。

## 内容、容量与诊断

按[0108](../decisions/0108-archived-stock-history-identities.md)扩展的运行摘要可保留≤12股的历史选择/响应身份/校验接纳/足够日线代码及原分析asOf；仅允许后续真实审计中已存在的合法字段，旧记录未知，非法可选证据不妨碍原运行摘要。认证七日GET的最近20轮提供可选stockHistoryCoverage；列表不证明新上游读取、拟买或胜率，不提供原响应/任意SQL。版本与发布状态见对应计划。

`runtime/archive/paper-history.sqlite`保存账户世代、每5分钟一条最新成本/总现金/冻结资金样本、订单与自动执行的白名单计数/状态/历史输入问题代码。现金原值是含冻结的总现金，可用现金仍为总现金减冻结，不能再次扣减计算盈亏。没有保存账户市值报价，不从成本样本推断实时收益。

终态订单保留365天，开放订单保留；样本和运行摘要保留90天。库页上限256MiB、WAL另计、每日备份最多3份，预计总上限约1GiB加临时备份/WAL；不是磁盘配额。清理重用空闲页，不保证数据库文件缩小。输入超过16MiB或格式/世代不合法拒绝整批。数据库满/损坏时不重建、不删除源文件，服务失败且`status.json`最后成功时间不前移。

```bash
cd /opt/kairos
python3 scripts/paper_history.py --status
cat runtime/archive/status.json
journalctl -u kairos-paper-history.service -n 20 --no-pager
```

`--status`只读核验数据库；`status.json`只代表最近成功采集，须核对`lastSuccessAt`是否过期。此模块没有公开HTTP服务或外部数据库端口。重复采样不会重复累计成交/运行；它仍可能漏掉一分钟内被账户重置清除的记录，不能当成完整事件日志。

## 备份与恢复核验

首次当天成功采集会用SQLite在线备份API生成北京时间日期的完整一致副本，并执行`quick_check`；最多保留最近3个日期。当天副本是当天首次采样时刻，手动刷新到当前时刻：

```bash
cd /opt/kairos
python3 scripts/paper_history.py --backup
```

核验恢复时把备份复制至独立临时目录，对复制文件执行`python3 scripts/paper_history.py --database /tmp/独立目录/restored.sqlite --status`，核对`integrity=ok`、世代数、订单数、运行数。不要在正在写入的库上直接复制主文件；在线备份已包含一致的WAL内容。不要把归档库覆盖至`paper-trading-state.json`。

如确需替换损坏的归档库，先停止timer并确认oneshot已结束，保留原库、WAL和SHM做诊断，再在新的独立目录验证备份后另行切换。此流程不恢复交易主账本。当前同盘备份不能抵抗磁盘损坏，异机加密备份仍待实现。

## 离线验证

```powershell
python -m unittest discover -s scripts -p test_paper_history.py
node node_modules/vitest/vitest.mjs run --dir server --environment node server/store/jsonFileTradingStore.epoch.test.ts
```

Python测试只用标准库，无需AkShare或pytest；覆盖重复采样、成交更新、世代隔离、源文件不变、保留期限、原子失败、库容量、损坏输入/库和备份恢复。

## 网站只读摘要

采集后原子发布`runtime/archive/read-model/current.json`，包含当前账户世代最近七个北京时间日期的运行/盘中/未知会话计数、已记录提交尝试及字段覆盖、白名单阻塞/研究问题与最多20条最新运行。SQL只读事务最多20000条，输出最多128KiB；超限或失败保留旧摘要，采集数据库继续成功，`status.json.readModelStatus`为`unavailable`。

生产Compose将上述子目录只读挂载到`/app/paper-history`，环境`PAPER_HISTORY_READ_MODEL_FILE=/app/paper-history/current.json`；开发环境该配置默认空串，不启动文件接入。发布器预先创建0700目录并检查归属/链接。首次安装新Compose时若正在运行旧发布器，应先由ubuntu部署用户核对并创建该目录，避免Docker自动创建root所有的目录；不要改账户或数据库内容。

认证GET `/api/research/paper-history`仅读取摘要，不触发SQL、采集、行情、策略或执行。摘要未来/损坏/超大时不可用，超过三分钟显示过期；账户世代不符时隐藏旧数据、等待下次采集。后台状态为published只代表原子发布完成，不代表策略有效或交易成功。

研究页的“Paper运行证据”分别展示盘中、会话未知和提交字段覆盖。旧库条目没有session时保持未知；已持久化的无变化轮次可能合并，运行条数不是调度次数。规则次数可能重复涉及同一候选，不是拒单数；没有盘中证据不能推断策略无信号。摘要不提供收益/胜率、完整历史回放或数据库下载。

完整离线命令为`python -m unittest discover -s scripts -p 'test_paper_history*.py'`；Linux另覆盖符号链接拒绝。生产发布后检查`status.json.readModelStatus`、摘要生成时间及当前账户世代一致性；不要输出凭据或原始账本。
