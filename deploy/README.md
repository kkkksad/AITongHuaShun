# 生产部署

生产部署使用 `docker-compose.production.yml`。它只公开 Nginx 的 80/443，Fastify 与 AkShare 桥仅在容器网络内通信。所有订单仍写入本地 PaperBroker，`REAL_TRADING_ENABLED=false` 不得修改。

`/assets/`对至少1024字节的JS/CSS/SVG等文本启用gzip（level5），发送`Vary: Accept-Encoding`并保留30天immutable缓存。HTML、API和WebSocket不在压缩范围；缺少的静态文件仍返回404。可用同一资源分别发送`Accept-Encoding: identity`与`gzip`，比较原始响应体字节，并验证gzip解码后哈希一致；不要用压缩响应体与原文哈希直接比较。TLS可信链须另行验证，`-k`静态传输探针不能证明证书可信。

## 首次部署

常规更新由`deploy/update-server.sh`完成归档核验、完整构建和健康检查。构建证明变化但运行内容相同的镜像复用上一已验证镜像，减少行情缓存被无关重启清空；服务环境/挂载/配置变化仍由Compose处理。程序层、环境、入口、健康和平台变化会正常启用新镜像，无法校验时恢复旧源码/配置后再启动旧镜像，见[决策0026](../docs/decisions/0026-reuse-identical-runtime-images.md)。

当前成功后会删除临时rollback标签和源码备份，部署过程回退不等于持久备份。回部署已知旧SHA使用保存的旧版本归档，仍需完整核验；没有在生产主动演练失败回退。Linux离线流程验证可运行`python3 -m unittest discover -s deploy -p 'test_*.py'`，所有破坏性路径只作用于临时fixture目录。

镜像复用后，发布器还检查保留的Nginx代理：后端容器更换或挂载配置哈希变化时，仅重建仍被保留的web，使上游地址和单文件挂载刷新。没有依赖变化则保持容器；代理刷新失败同样恢复旧源码/Compose和镜像。首次安装这项修复仍由旧发布器运行，下一次后端发布再核验真实刷新。

```bash
sudo bash deploy/bootstrap-ubuntu.sh 124.221.165.45
cp deploy/production.env.example .env.production
chmod 600 .env.production
npm run auth:setup -- --username admin --env-file .env.production --production
```

`bootstrap-ubuntu.sh` 会为国内 Lighthouse 实例写入腾讯云 Docker 镜像加速，避免首次构建卡在 Docker Hub 基础镜像拉取。

认证脚本只显示一次随机初始密码，并把 scrypt 散列写入 `.env.production`，不会保存明文密码。再生成独立桥接 Token：

```bash
openssl rand -hex 32
```

将结果写入 `.env.production` 的 `AKSHARE_BRIDGE_TOKEN` 后启动：

```bash
docker compose --env-file .env.production -f docker-compose.production.yml config
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

初期 IP 证书为自签名证书，浏览器会显示风险提示。绑定域名后应替换 `runtime/certs/kairos.crt` 和 `kairos.key`，并同步更新 `PUBLIC_HOST` 与 `WEB_ORIGIN`。

## 域名证书与续期

当前双域可信证书与续期定时器已上线，授权、有效期与真实验证记录见[状态页](../docs/status/current-state.md)；以下步骤也适用于重新初始化。Let's Encrypt签发/续期免费，不包含现有域名和服务器费用。

Nginx的HTTP80端口独立提供`/.well-known/acme-challenge/`，仅映射`runtime/acme/webroot`，不存在的挑战文件返回404；账户密钥和续期状态不在Web目录中。bootstrap和update会以部署用户预建目录。首次从旧部署升级时，先以`ubuntu`创建`runtime/acme/{config,work,logs}`（0700）与`runtime/acme/webroot/.well-known/acme-challenge`（0755），再发布新Compose；旧脚本不会在同次替换时执行新目录准备逻辑。若目录已被Docker建为root所有，应由管理员修正到部署用户，不能通过sudo运行证书工具绕过。

先执行纯本地预览，不注册账户、不联网、不写入文件：

```bash
bash deploy/manage-certificate.sh issue --domain kairosq.cn --domain www.kairosq.cn --dry-run
```

实际申请须先由域名持有人明确接受[Let's Encrypt订阅协议v1.8](https://letsencrypt.org/documents/LE-SA-v1.8-July-06-2026.pdf)。只有得到该具体版本授权后，才能以普通部署用户`ubuntu`运行：

```bash
bash deploy/manage-certificate.sh issue \
  --domain kairosq.cn --domain www.kairosq.cn \
  --accept-subscriber-agreement https://letsencrypt.org/documents/LE-SA-v1.8-July-06-2026.pdf
```

脚本拒绝root、非本用户目录与异常锁，和应用发布共用部署锁；默认使用已核实官方版本`certbot/certbot:v5.9.0`，不是不可变digest。若已单独核实官方镜像digest，可用`KAIROS_CERTBOT_IMAGE`固定。镜像尚未拉取时的registry可达性仍需实际申请时验证。脚本不注册邮箱，账户密钥、续期配置和Certbot运行日志仅保留在受限`runtime/acme`，不得提交或输出这些材料。

每次实际运行都会比对CA目录公布的协议URL；版本变化就停止，等待重新审核授权。签发或续期后检查信任链、全部主/别域名、至少一天有效期和私钥匹配，再通过单一版本目录指针切换证书对；执行容器内`nginx -t`与reload，失败恢复旧指针。旧证书对保留在本地受限版本目录。实际续期将上面`issue`改为`renew`，首个域名必须保持为`kairosq.cn`以复用同一lineage。

签发成功后才安装`deploy/kairos-certificate-renew.service`与`.timer`并启用：服务固定`User/Group=ubuntu`、根域与www、已审核协议版本，每天两次并随机延迟；不使用PrivateTmp，以保持共享部署锁可见。本实例已人工安装并启用，应用部署脚本仍不会自动安装或启动单元。可用`systemctl is-active kairos-certificate-renew.timer`、`systemctl list-timers kairos-certificate-renew.timer`和`systemctl show kairos-certificate-renew.service --property=Result,ExecMainStatus`核对。未到期时renew应成功跳过，不能将跳过当作到期续签演练；条款授权、首次签发和定时启用分别记录于状态页。

把未提交`.env.production`中的`PUBLIC_HOST`设为`kairosq.cn`，Compose会派生`WEB_ORIGIN=https://kairosq.cn`。最终必须用不带`-k`的HTTPS检查根域和www的`/healthz`及`/api/health`，确认SAN、信任链及认证保护；自签名证书检查不能代替该验证。详细决策见[0013](../docs/decisions/0013-managed-domain-certificates.md)。

## 固定密码重置

固定密码必须在服务器终端隐藏输入，不能出现在命令参数、Git 或 `.env.production` 明文中。当前单用户部署允许 8 至 256 个字符；公网部署仍应使用未在其他位置复用的密码。

```bash
cd /opt/kairos
read -rsp "New KAIROS password: " KAIROS_PASSWORD; echo
printf '%s' "$KAIROS_PASSWORD" | docker run --rm -i \
  --user "$(id -u):$(id -g)" \
  -v "$PWD:/work" -w /work \
  kairos-api:production \
  /app/node_modules/.bin/tsx scripts/setup-auth.ts \
  --username admin --env-file .env.production --production --password-stdin
unset KAIROS_PASSWORD
docker compose --env-file .env.production \
  -f docker-compose.production.yml up -d --force-recreate backend
```

重置会使旧密码和后端内存会话失效，但不会修改 Paper 账户、持仓或订单数据。

## 运维

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200
docker compose --env-file .env.production -f docker-compose.production.yml restart
docker compose --env-file .env.production -f docker-compose.production.yml down
```

升级前备份 `runtime/data`；不得把 `.env.production`、`runtime/data`、证书私钥或运行日志加入 Git。WxPusher 仅在取得新的未泄露 SPT 后启用。

Docker 构建上下文必须排除 `.env`、`.env.*` 与 `runtime/`，包括服务器上已有的 `.env.production`。生产配置只通过 Compose 在运行时注入，不应进入镜像层或构建缓存。

## GitHub 自动部署

`.github/workflows/deploy-production.yml` 只监听生产分支 `main`。推送后先运行 Node、Python、生产构建和 Compose 校验，再把已验证提交通过受限 SSH 会话的 stdin 上传到服务器，并调用 `deploy/update-server.sh`。服务器不需要直接读取 GitHub 私有仓库，也不开放通用 scp/sftp。上传归档会先解压到提交专属的临时目录，并校验 Compose、镜像构建和部署入口等必需文件；只有完整归档通过校验后才会备份和替换当前源码。部署脚本串行执行；构建失败不会替换运行容器，启动后健康检查失败会尝试恢复上一组镜像和上一份源码。

服务器的部署公钥必须使用强制命令，示例：

```text
command="bash /opt/kairos/deploy/github-deploy-entrypoint.sh",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding ssh-ed25519 <public-key> kairos-github-actions
```

GitHub 仓库的 `production` Environment 中只需配置一个 Secret：`KAIROS_DEPLOY_SSH_KEY`，值为这把受限部署密钥的私钥。工作流会校验服务器现有 ED25519 指纹，拒绝连接指纹不匹配的主机。
