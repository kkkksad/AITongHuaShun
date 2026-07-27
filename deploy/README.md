# 生产部署

生产部署使用 `docker-compose.production.yml`。它只公开 Nginx 的 80/443，Fastify 与 AkShare 桥仅在容器网络内通信。所有订单仍写入本地 PaperBroker，`REAL_TRADING_ENABLED=false` 不得修改。

## 首次部署

```bash
sudo bash deploy/bootstrap-ubuntu.sh 111.229.76.161
cp deploy/production.env.example .env.production
chmod 600 .env.production
npm run auth:setup -- --username admin --env-file .env.production --production
```

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

## 运维

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200
docker compose --env-file .env.production -f docker-compose.production.yml restart
docker compose --env-file .env.production -f docker-compose.production.yml down
```

升级前备份 `runtime/data`；不得把 `.env.production`、`runtime/data`、证书私钥或运行日志加入 Git。WxPusher 仅在取得新的未泄露 SPT 后启用。

## GitHub 自动部署

`.github/workflows/deploy-production.yml` 只监听生产分支 `codex/real-market-regime`。推送后先运行 Node、Python、生产构建和 Compose 校验，再通过受限 SSH 密钥调用 `deploy/update-server.sh`。部署脚本串行执行；构建失败不会替换运行容器，启动后健康检查失败会尝试恢复上一组镜像。

服务器的部署公钥必须使用强制命令，示例：

```text
command="bash /opt/kairos/deploy/github-deploy-entrypoint.sh",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding ssh-ed25519 <public-key> kairos-github-actions
```

GitHub 仓库的 `production` Environment 中只需配置一个 Secret：`KAIROS_DEPLOY_SSH_KEY`，值为这把受限部署密钥的私钥。工作流会校验服务器现有 ED25519 指纹，拒绝连接指纹不匹配的主机。
