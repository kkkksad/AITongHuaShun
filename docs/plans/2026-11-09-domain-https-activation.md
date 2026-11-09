# 域名HTTPS签发与自动续期

日期：2026-11-09。状态：签发与续期启用完成，文档归档发布。

用户已明确接受 https://letsencrypt.org/documents/LE-SA-v1.8-July-06-2026.pdf ，授权为`kairosq.cn`和`www.kairosq.cn`申请免费证书并启用自动续期。此前模块10已部署挑战路由和受审查工具，未实际签发；本任务继续该授权步骤。

## 执行顺序

- [x] 核对当前线上仍为IP自签证书、三服务健康、续期timer未安装；本地工作区干净，HEAD a58345c。
- [x] 两域DNS均指124.221.165.45、外部HTTP健康200、内部真实webroot探针通过。CA目录现行协议与授权v1.8完全一致；脚本SHA256与本地匹配，全部运行目录/部署锁归ubuntu。systemd源文件仅CRLF差异，归一后与本地逐字哈希匹配再安装。
- [x] 北京时间20:35普通ubuntu成功注册、双域签发，Certbot v5.9.0真实容器UID运行成功；公开镜像实际拉取digest为sha256:bc93cb710b413e6b456d622f9b0133b3e109c0a78c2ed9976af43d209b0a1805（记录下载结果，未改tag配置）。工具已验证信任链/两域/私钥匹配后原子安装，nginx -t/reload成功，旧证书保留。
- [x] 两域从本机不带-k检查主页及healthz均200；根域及www的API health为paper+akshare/auth开启/realTrading关闭，匿名account为401。服务器OpenSSL公开元数据显示issuer Let's Encrypt YE2、SAN两域、有效期2026-11-09至2027-02-07，证书644/私钥600。
- [x] 北京时间20:36安装已审查LF单元，systemd-analyze verify通过（仅系统已有无关tat_agent路径提示）；User/Group ubuntu。实际start续期service Result=success/ExecMainStatus=0，Certbot确认未到期并跳过，不重新签发或重载。timer enabled/active，每天两次+随机延迟，当前下一次北京时间2026-11-10 00:43:06。
- [x] 已更新权威部署/状态文档、决策和历史计划引用；本次无应用代码改动，真实操作验证和diff检查作为相关验证，不重报旧全套测试。文档提交与线上精确版本由聊天最终交接及服务器runtime/production-release.json记录；归档部署保留runtime证书、账户与交易配置。

## 验证与边界

真实通过以双域不带`-k`的HTTPS结果和公开证书元数据为准。证书工具每次核对已授权协议版本，协议变更须停止；自动续期仅在到期窗口更新证书。保持paper/只读行情权限，任务不改账户、策略、订单和消息额度。

独立复核未发现Linux部署阻断；本次Windows/Git Bash旧mock测试受symlink/install权限与PATH限制，17通过/6失败/1跳过，不作为Linux签发成功证据。真实签发、可信TLS及systemd实际运行结果如上。此次只更新文档和运行环境，无应用代码改动。
