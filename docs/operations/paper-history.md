# Paper长期历史归档

本模块是[决策0025](../decisions/0025-read-only-sqlite-paper-history.md)中的只读观察副本。安装后的数据从原JSON账本读取；数据库不参与下单、风控和实时权益计算。后台长期库查询尚未接入页面，不把它描述为已替换交易主账本。

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
