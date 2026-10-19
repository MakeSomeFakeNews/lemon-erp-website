---
order: 4
---

# Docker 部署

柠檬ERP 仓库的 `docker/` 目录提供了完整的 Docker 部署文件：后端镜像、前端镜像（Nginx）、一键启动 MySQL + Redis + 后端 + 前端的 `docker-compose.yml`，以及构建、推送镜像的脚本。

```
lemon-erp
├── .dockerignore              构建时排除 build、node_modules、本地上传文件等
└── docker
    ├── backend.Dockerfile     后端镜像：Gradle 构建 + JRE 17 运行，内置中文字体
    ├── web.Dockerfile         前端镜像：Node 构建 + Nginx 托管，/api 转发到后端
    ├── nginx.conf             前端镜像使用的 Nginx 配置
    ├── docker-compose.yml     MySQL 8 + Redis 7 + 后端 + 前端
    ├── .env.example           配置模板（复制为 .env 后修改）
    └── build.sh               构建 / 推送镜像
```

## 环境要求

| 项目 | 要求 |
| --- | --- |
| Docker | 20.10 及以上，启用 BuildKit（Docker Desktop 和新版 Docker Engine 默认启用） |
| Docker Compose | v2（`docker compose` 命令） |
| 内存 | 建议 4 GB 及以上（MySQL + 后端默认最大堆 1 GB） |
| 网络 | 首次构建需要下载基础镜像、Gradle 依赖和 npm 依赖 |

## 一键部署

```bash
git clone https://github.com/MakeSomeFakeNews/lemon-erp.git
cd lemon-erp/docker
cp .env.example .env        # 修改其中的密码和 JWT_SECRET
docker compose up -d --build
```

第一次启动时：

1. 构建后端、前端镜像（几分钟，取决于网络）；
2. MySQL 在空数据卷上执行 `sql/init.sql` 创建全部表和初始数据；
3. 后端等待 MySQL、Redis 健康后启动，Flowable 自动创建流程引擎的 `ACT_*` 表；
4. 后端健康检查通过后启动前端（Nginx）。

用 `docker compose ps` 查看状态，四个容器都是 `healthy` / `running` 后，浏览器访问 `http://服务器地址`（端口见 `.env` 中的 `WEB_PORT`），使用 `admin` / `admin123` 登录，**登录后立即修改密码**。

```bash
docker compose ps                   # 查看容器状态
docker compose logs -f backend      # 查看后端日志
```

## 配置（.env）

`docker/.env` 由 `.env.example` 复制而来，已加入 `.gitignore`，不会提交到代码仓库。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEB_PORT` | `80` | 对外访问端口（只暴露前端 Nginx，MySQL、Redis、后端只在 Docker 内部网络中访问） |
| `MYSQL_ROOT_PASSWORD` | 必填 | MySQL root 密码 |
| `DB_PASSWORD` | 必填 | 应用连接数据库的账号 `lemon` 的密码（该账号拥有 `lemon_erp` 库的全部权限） |
| `REDIS_PASSWORD` | 必填 | Redis 密码 |
| `JWT_SECRET` | 必填 | 登录令牌签名密钥，至少 32 字节，用 `openssl rand -base64 48` 生成 |
| `LEMON_TENANT_ENABLED` | `false` | 开启 SaaS 多租户，开启后登录需要填写租户「柠檬科技」，见 [SaaS 多租户](../architecture/tenant) |
| `LEMON_DEMO_ENABLED` | `false` | 开启演示模式（只能查看），见 [搭建演示环境](./demo) |
| `LEMON_MINIAPP_APP_ID` | 空 | 微信小程序（`lemon-mp`）的 AppID，不用小程序时留空 |
| `LEMON_MINIAPP_APP_SECRET` | 空 | 微信小程序的 AppSecret，不用小程序时留空 |
| `LEMON_MINIAPP_SUBSCRIBE_TEMPLATE_ID` | 空 | 审批提醒的订阅消息模板 ID；模板字段名默认 `thing1` 标题、`thing2` 内容、`time3` 时间，不同时要修改 `application.yml`（或在 `docker-compose.yml` 的后端 `environment` 中加 `LEMON_MINIAPP_SUBSCRIBE_TITLEFIELD` 等变量），见 [微信小程序开发](../guide/miniapp#订阅消息模板) |
| `JAVA_OPTS` | `-Xms512m -Xmx1g` | 后端 JVM 参数，数据量大时调大 `-Xmx` |
| `IMAGE_PREFIX` | `lemon-erp` | 镜像名前缀，推送到镜像仓库时改为仓库地址，如 `registry.example.com/lemon/lemon-erp` |
| `IMAGE_TAG` | `latest` | 镜像标签 |
| `NPM_REGISTRY` | 空 | 构建前端镜像时使用的 npm 镜像，国内网络可设为 `https://registry.npmmirror.com` |

必填项没有设置时 `docker compose` 会直接报错提示。

::: warning 生产环境必须修改密码
`.env.example` 中的密码和密钥只是占位符，正式使用前全部替换为随机的强密码。`MYSQL_ROOT_PASSWORD`、`DB_PASSWORD` 只在 MySQL 数据卷第一次初始化时生效，之后修改 `.env` 不会改变数据库中的密码。
:::

## 镜像说明

### 后端镜像

`docker/backend.Dockerfile`，构建上下文为项目根目录：

- 构建阶段使用 `eclipse-temurin:17-jdk` 和项目自带的 Gradle Wrapper 执行 `:lemon-admin:bootJar`，Gradle 依赖缓存在 BuildKit 缓存中，再次构建不会重新下载；
- 运行阶段使用 `eclipse-temurin:17-jre`，安装了 `fonts-noto-cjk` 中文字体——单据打印由 JasperReports 生成 PDF，排版时需要中文字体测量文字宽度，见 [生产环境配置](./production#中文字体)；
- 默认 `SPRING_PROFILES_ACTIVE=prod`、`TZ=Asia/Shanghai`，上传文件和业务附件保存在 `/data/uploads`、`/data/attachments`（`docker-compose.yml` 中挂载为 `lemon-files` 卷）；
- 健康检查访问 `GET /api/auth/config`，启动后 2 分钟内不计失败次数。

### 前端镜像

`docker/web.Dockerfile`：

- 构建阶段使用 `node:22-alpine` 执行 `npm ci`、`npm run build`（Vite 7 需要 Node 20.19 及以上）；
- 运行阶段使用 `nginx:1.27-alpine`，配置见 `docker/nginx.conf`：前端路由回退到 `index.html`，`/assets/` 静态资源长期缓存，`/api/` 转发到 `backend:8080`，上传上限 105 MB，代理读超时 120 秒（打印、导出等耗时请求），开启 gzip。

Docker 默认网络的地址在 172.16.0.0/12 范围内，属于后端默认信任的内网代理，Nginx 传入的 `X-Forwarded-For` 能被正确识别，登录日志、操作日志中记录的是用户的真实 IP。

## 构建与推送镜像

`docker/build.sh` 单独构建镜像，适合在构建机上打包、推送到镜像仓库，再在服务器上拉取运行：

```bash
./docker/build.sh                                         # 构建 lemon-erp-backend:latest、lemon-erp-web:latest
./docker/build.sh -t 1.0.0                                # 指定标签
./docker/build.sh -p registry.example.com/lemon/lemon-erp -t 1.0.0 --push    # 构建并推送
./docker/build.sh --npm-registry https://registry.npmmirror.com             # 国内 npm 镜像
./docker/build.sh --platform linux/amd64                  # 在 Apple 芯片的电脑上构建 x86 服务器使用的镜像
```

服务器上只需要 `docker/docker-compose.yml`、`docker/.env` 和 `sql/init.sql`（保持 `../sql/init.sql` 的相对位置），在 `.env` 中设置与推送时相同的 `IMAGE_PREFIX`、`IMAGE_TAG`，然后：

```bash
docker compose pull backend web
docker compose up -d --no-build
```

## 升级

```bash
cd lemon-erp
git pull
cd docker
docker compose up -d --build backend web
```

升级前先备份数据库和文件卷（见下文）。新版本修改了数据库结构时，先对比新旧版本的 `sql/init.sql` 编写并执行增量 SQL，再启动新版本，见 [升级与数据备份](./upgrade)。

::: danger 不要删除数据卷
`init.sql` 只在 MySQL 数据卷为空时执行一次。`docker compose down -v` 或删除 `lemon-erp_mysql-data` 卷会**清空全部业务数据**，升级时只需要 `docker compose up -d --build`。
:::

## 备份与恢复

```bash
cd lemon-erp/docker

# 备份数据库
docker compose exec mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines lemon_erp' > lemon_erp_$(date +%F).sql

# 备份上传文件与业务附件
docker run --rm -v lemon-erp_lemon-files:/data -v "$PWD":/backup alpine tar czf /backup/lemon-files_$(date +%F).tar.gz -C /data .

# 恢复数据库
docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" lemon_erp' < lemon_erp_2026-10-17.sql
```

`docker-compose.yml` 中设置了项目名 `lemon-erp`，三个数据卷分别为 `lemon-erp_mysql-data`、`lemon-erp_redis-data`、`lemon-erp_lemon-files`，用 `docker volume ls` 查看。

## HTTPS

前端容器只监听 80 端口。需要 HTTPS 时有两种方式：

- 在宿主机或负载均衡器上再放一层负责 HTTPS 的反向代理，转发到 `WEB_PORT`（推荐，证书续期与应用升级互不影响）；
- 修改 `docker/nginx.conf` 增加 443 监听和证书配置，在 `docker-compose.yml` 中挂载证书目录并映射 443 端口，参考 [Nginx 配置](./nginx)。

使用微信小程序时必须启用 HTTPS：小程序正式版只能访问在微信公众平台登记的 HTTPS 域名，小程序的接口地址为 `https://<域名>/api`，经前端容器的 Nginx 转发到后端，见 [生产环境配置 → 微信小程序](./production#微信小程序)。

外层代理需要传递 `X-Forwarded-For`，并且其地址要在后端信任的内网范围内，否则日志中记录的是代理的 IP，见 [常见问题](./faq)。

## 常见问题

**构建很慢或下载失败**：首次构建需要从 Docker Hub、Gradle、Maven Central、npm 下载内容。国内网络可以为 Docker 配置镜像加速，前端使用 `NPM_REGISTRY=https://registry.npmmirror.com`；也可以在网络通畅的机器上用 `build.sh` 构建并推送到私有镜像仓库。

**后端一直不是 healthy**：用 `docker compose logs backend` 查看日志。常见原因是 `.env` 中的 `JWT_SECRET` 少于 32 字节，或修改过数据库密码导致与数据卷中的不一致。

**打印的 PDF 中文排版异常**：确认使用的是 `docker/backend.Dockerfile` 构建的镜像，容器内执行 `docker compose exec backend fc-list :lang=zh` 应有输出。

**修改了 .env 没有生效**：执行 `docker compose up -d` 重新创建容器；数据库密码只在第一次初始化时生效。
