# 单实例服务器部署

本页描述当前 KAIROS Quant 工作台的单实例部署边界。它保护研究和本地模拟交易工作台，不提供真实券商账户授权或真实订单执行。

## 前置条件

- Linux 云服务器、Docker Engine 与 Docker Compose。
- 一个指向服务器的域名。
- Caddy、Nginx 或云负载均衡器负责 HTTPS 终止。
- 防火墙只向公网开放 `80/443`；Fastify `3001` 不得直接发布，前端 `4173` 只绑定 `127.0.0.1`。
- 继续保持 `MARKET_MODE=paper`、`REAL_TRADING_ENABLED=false`。

域名证书必须是受信任的 CA 证书，并同时包含 `kairosq.cn` 与 `www.kairosq.cn`。当前服务器上的 IP 自签名证书不能用于域名入口；浏览器会在前端 JavaScript 加载前拒绝它，因此这类问题不是 React 代码或缓存可以单独解决的。

当前会话存储在单个 Fastify 进程内。服务重启会让全部用户重新登录；不得横向扩成多个后端副本。多实例部署前必须把会话替换为 Redis 等共享、可撤销存储，并重新验证限流与 CSRF 边界。

## 初始化部署环境

安装依赖后生成部署凭据：

```bash
npm ci
npm run auth:setup -- --username kairos-admin --env-file .env --production
```

命令只在终端显示一次随机密码，`.env` 只保存 `scrypt` 散列。随后编辑被 Git 忽略的 `.env`：

```text
WEB_ORIGIN=https://quant.example.com
AUTH_ENABLED=true
AUTH_USERNAME=kairos-admin
AUTH_PASSWORD_HASH=<generated-scrypt-hash>
AUTH_COOKIE_SECURE=true
AUTH_SESSION_TTL_SECONDS=28800
AUTH_MAX_SESSIONS=3
AUTH_LOGIN_RATE_LIMIT_MAX=5
TRUST_PROXY=false
```

不要把 `.env`、初始密码、Cookie、短信验证码或任何券商凭据提交到 Git。修改密码时重新运行初始化命令并重启后端；旧密码与全部旧会话会同时失效。

需要固定密码时使用 `scripts/setup-auth.ts --password-stdin` 从标准输入读取，当前长度范围为 8 至 256 个字符。不得把固定密码放在命令参数、环境模板、GitHub 工作流或任何仓库文件中；公网部署应使用未公开且不复用的密码。

## 启动容器

```bash
docker compose --profile prod build
docker compose --profile prod up -d
docker compose --profile prod ps
```

生产 Compose 只把前端绑定到宿主机 `127.0.0.1:4173`，后端 `3001` 只在容器网络暴露。认证变量缺失、密码散列损坏或生产安全 Cookie 被关闭时，后端会拒绝启动。

## HTTPS 反向代理

Nginx 证书目录使用 `runtime/certs/kairos.crt` 与 `runtime/certs/kairos.key`。可在服务器上使用受信任 CA 签发的域名证书替换这两个文件，并确认私钥权限为 `600`、证书权限为 `644`，然后执行：

```bash
sudo nginx -t
docker compose --env-file .env.production -f docker-compose.production.yml up -d --force-recreate web
```

换证书前确认 DNS 的 `@` 和 `www` A 记录都指向 `124.221.165.45`；换证书后分别检查 `https://kairosq.cn/healthz`、`https://www.kairosq.cn/healthz` 和浏览器证书 SAN。

Caddy 示例：

```caddyfile
quant.example.com {
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        Content-Security-Policy "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss:; worker-src 'self'; manifest-src 'self'"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        Referrer-Policy "no-referrer"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
    }
    reverse_proxy 127.0.0.1:4173
}
```

请求路径 `/api/*` 与 `/ws` 先到前端容器，再由其代理到后端容器，因此浏览器看到的页面、Cookie、REST 和 WebSocket 都保持同源。安全响应头阻止第三方嵌入、外部脚本和不必要的浏览器权限；部署后应在浏览器控制台确认现有图表与 Service Worker 没有违反 CSP。不要额外把 `3001` 暴露给公网，也不要绕过 HTTPS 直接访问 `4173`。

## 上线检查

1. 未登录打开任意前端路径，只显示登录页。
2. 匿名访问 `/api/account`、`/api/capabilities`、`/metrics`、`/documentation/json` 均返回 `401`。
3. `/api/health` 只用于容器和负载均衡健康检查。
4. 浏览器 Cookie 包含 `HttpOnly`、`Secure`、`SameSite=Strict`。
5. 浏览器 `localStorage`、`sessionStorage` 和 WebSocket URL 不包含认证令牌。
6. 连续错误登录达到上限后返回 `429`；反向代理还应配置独立 IP 限流。
7. 登出后原 Cookie 无法再次读取账户或研究接口。
8. 云安全组和宿主机防火墙只允许 `22`（限制来源）、`80` 和 `443`。

## 备份与更新

- 持久化 paper 状态时使用受限目录挂载和 `STORE_BACKEND=json`；JSON 仍只适合单进程模拟，不是生产数据库。
- 备份 `.env` 时按密钥材料处理，使用服务器密钥管理或加密备份，不复制到聊天、源码或前端环境变量。
- 更新前运行 `npm test` 和 `npm run build`；更新后重新检查登录、登出、401、429、WebSocket 和 paper-only 边界。
