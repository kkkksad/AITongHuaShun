# 轻量云服务器生产部署计划

## 目标和范围

将 KAIROS Quant 部署到腾讯云轻量应用服务器，持续运行只读 AkShare 行情、本地 Paper 模拟交易、研究接口和前端工作台。部署必须保留登录保护、HTTPS、数据持久化、日志上限与自动重启，不接入任何真实券商执行。

## 相关文件

- `Dockerfile`：增加仅包含构建后前端资源的 Nginx 镜像阶段。
- `akshare-bridge/Dockerfile`：完整复制桥接运行模块。
- `docker-compose.production.yml`：生产容器、网络、持久化、健康检查和资源预算。
- `deploy/nginx.conf`：HTTPS、静态资源、API/WebSocket 代理与入口限流。
- `deploy/production.env.example`：不含凭据的生产环境变量模板。
- `deploy/bootstrap-ubuntu.sh`：Ubuntu 主机初始化与临时 IP 证书生成。
- `docs/operations/development.md`：生产部署和日常运维命令。
- `docs/status/current-state.md`：记录实际部署验证结果和剩余限制。

## 前置条件和约束

- 目标主机为 Ubuntu 24.04 x86_64，4 核、4GB 内存、40GB SSD。
- 公网初期只使用 IP，因此先生成带 IP SAN 的自签名证书；浏览器会提示证书不受信任。绑定域名后应替换为受信任证书。
- `REAL_TRADING_ENABLED=false`、`MARKET_MODE=paper` 和 `MARKET_DATA_PROVIDER=akshare` 不得改变。
- Paper 状态只允许单实例 JSON 持久化，默认保留七天历史；不启用多副本。
- 认证散列、桥接 Token 和 WxPusher SPT 只能存在于服务器 `.env.production`，不得提交。
- 已在聊天中出现过的服务器密码和 WxPusher SPT 不得继续作为长期生产凭据。

## 实施步骤

- [x] 核验 SSH、公钥登录、操作系统和服务器资源。
- [x] 增加生产 Compose、Nginx 和主机初始化脚本。
- [x] 修复 AkShare 镜像遗漏运行模块的问题。
- [x] 运行 TypeScript、前后端测试、Python 测试与生产构建。
- [x] 在服务器安装 Docker，关闭 SSH 密码登录并验证密钥仍可用。
- [x] 上传不含本地数据和凭据的部署包，生成服务器专用认证与桥接 Token。
- [x] 构建并启动容器，验证 HTTPS、认证保护、API、AkShare 和 Paper JSON 配置。
- [x] 验证容器重启策略、磁盘预算和公网入口，仅开放 80/443/22。
- [x] 更新状态文档并提交代码。

## 关键决策

1. 使用 Docker Compose 单机部署，避免把开发进程管理方式直接搬到公网。
2. 前端由 Nginx 直接提供构建产物，不在生产环境运行 `vite preview`。
3. AkShare 端口和 Fastify 端口只在 Docker 网络内暴露，公网入口统一经过 Nginx。
4. 初期 IP 访问使用自签名 HTTPS，以满足生产 Secure Cookie；不降低认证安全要求来迁就 HTTP。
5. Paper 数据和研究数据写入宿主机 `runtime/data`，日志使用 Docker `json-file` 上限，避免 40GB 系统盘被无界占用。

## 验证命令和实际结果

本地验证：

```powershell
npm test
npm run build
python -m pytest akshare-bridge -q
git diff --check
```

服务器侧使用：

```bash
docker compose --env-file .env.production -f docker-compose.production.yml config
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl -k https://127.0.0.1/api/health
```

实际结果：

- 服务端 Vitest 53 个文件、803 个测试通过；前端 Vitest 27 个文件、90 个测试通过；Python pytest 109 个测试通过。
- `tsc -b` 与 Vite 生产构建通过；Linux 服务器成功构建 `kairos-api`、`kairos-web` 和 `kairos-akshare-bridge` 三个镜像。
- `.dockerignore` 的运行数据规则改为根目录锚定，避免误排除 `src/data`；AkShare 镜像使用腾讯云 PyPI 镜像、120 秒超时和有限重试，解决公网依赖下载超时。
- Compose 配置校验通过，Nginx、Fastify 与 AkShare 三个容器均进入 `healthy`；服务器内部 `/healthz` 与 `/api/health` 通过。
- 公网 `https://111.229.76.161`、`/api/health` 和前端静态资源均返回 200；未认证访问 `/api/account` 返回 401。
- 生产 API 报告 `mode=paper`、`marketDataProvider=akshare`、`realTradingEnabled=false`、`authEnabled=true`。
- 80 仅重定向到 443，Fastify 3001 与 AkShare 8800 未映射到公网。IP 证书为自签名证书，浏览器仍会提示不受信任。

## 遗留问题和后续工作

- 绑定域名后替换自签名证书，并将公网地址切换到正式域名。
- 用户重新生成 WxPusher SPT 后再启用每日通知，部署阶段不复用已泄露 Token。
- JSON 存储仍是单进程 Paper 持久化，不替代 PostgreSQL、共享会话或合规审计系统。
