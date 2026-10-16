---
order: 4
---

# Docker 部署示例

::: warning 参考示例
柠檬ERP 仓库中没有提供官方的 Dockerfile 和镜像，本页的 Dockerfile 与 docker-compose 是参考写法，请根据自己的环境（镜像仓库、网络、存储、密码管理）调整后使用。
:::

示例使用四个容器：MySQL、Redis、后端、Nginx（内含前端静态文件）。把下面的文件放在项目根目录的 `deploy/` 目录中（目录名可自定）。

```
lemon-erp
├── deploy
│   ├── backend.Dockerfile
│   ├── web.Dockerfile
│   ├── nginx.conf
│   ├── docker-compose.yml
│   └── .env
├── lemon-admin ...
├── lemon-web ...
└── sql/init.sql
```

## 后端镜像

```dockerfile
# deploy/backend.Dockerfile（构建上下文为项目根目录）
FROM eclipse-temurin:17-jdk AS build
WORKDIR /src
COPY . .
RUN ./gradlew :lemon-admin:bootJar --no-daemon

FROM eclipse-temurin:17-jre
ENV TZ=Asia/Shanghai \
    SPRING_PROFILES_ACTIVE=prod \
    UPLOAD_PATH=/data/uploads \
    LEMON_UPLOAD_ATTACHMENTPATH=/data/attachments \
    JAVA_OPTS="-Xms512m -Xmx1g"
WORKDIR /app
COPY --from=build /src/lemon-admin/build/libs/lemon-erp.jar /app/lemon-erp.jar
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/lemon-erp.jar"]
```

- 构建阶段使用项目自带的 Gradle Wrapper，需要能访问 Gradle 发行版下载地址和 Maven Central；网络受限时可以在宿主机先执行 `./gradlew :lemon-admin:bootJar`，Dockerfile 只保留运行阶段并 `COPY lemon-admin/build/libs/lemon-erp.jar`；
- 建议在项目根目录加 `.dockerignore`，排除 `**/build`、`lemon-web/node_modules`、`lemon-web/dist`、`.gradle`、`.idea`、`uploads`、`attachments`，减小构建上下文；
- `/data` 下的上传目录和附件目录必须挂载卷持久化。

## 前端镜像

```dockerfile
# deploy/web.Dockerfile（构建上下文为项目根目录）
FROM node:20 AS build
WORKDIR /web
COPY lemon-web/package.json lemon-web/package-lock.json ./
RUN npm ci
COPY lemon-web/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist /usr/share/nginx/html
EXPOSE 80
```

`node:20` 镜像为 Node.js 20 的最新版本，满足 Vite 7 对 20.19 及以上的要求。

## Nginx 配置

```nginx
# deploy/nginx.conf
server {
    listen 80;
    server_name _;

    client_max_body_size 105m;

    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        # backend 为 docker-compose 中后端服务的名称
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
}
```

Docker 默认网络的地址在 172.16.0.0/12 范围内，属于后端默认信任的内网代理，`X-Forwarded-For` 中的客户端 IP 可以被正确识别。

## docker-compose

```yaml
# deploy/docker-compose.yml
services:
  mysql:
    image: mysql:8.0
    restart: unless-stopped
    environment:
      TZ: Asia/Shanghai
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: lemon_erp
      MYSQL_USER: lemon
      MYSQL_PASSWORD: ${DB_PASSWORD}
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_general_ci
    volumes:
      - mysql-data:/var/lib/mysql
      # 只在数据目录为空（首次启动）时执行，导入到 MYSQL_DATABASE
      - ../sql/init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-p${MYSQL_ROOT_PASSWORD}"]
      interval: 10s
      timeout: 5s
      retries: 30

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}", "--appendonly", "yes"]
    volumes:
      - redis-data:/data

  backend:
    build:
      context: ..
      dockerfile: deploy/backend.Dockerfile
    image: lemon-erp-backend:latest
    restart: unless-stopped
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_started
    environment:
      SPRING_PROFILES_ACTIVE: prod
      DB_URL: "jdbc:mysql://mysql:3306/lemon_erp?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&nullCatalogMeansCurrent=true&allowPublicKeyRetrieval=true&useSSL=false"
      DB_USERNAME: lemon
      DB_PASSWORD: ${DB_PASSWORD}
      REDIS_HOST: redis
      REDIS_PORT: "6379"
      REDIS_PASSWORD: ${REDIS_PASSWORD}
      JWT_SECRET: ${JWT_SECRET}
      LEMON_TENANT_ENABLED: "false"
    volumes:
      - lemon-files:/data

  web:
    build:
      context: ..
      dockerfile: deploy/web.Dockerfile
    image: lemon-erp-web:latest
    restart: unless-stopped
    depends_on:
      - backend
    ports:
      - "80:80"

volumes:
  mysql-data:
  redis-data:
  lemon-files:
```

```ini
# deploy/.env（不要提交到代码仓库）
MYSQL_ROOT_PASSWORD=请替换为强密码
DB_PASSWORD=请替换为强密码
REDIS_PASSWORD=请替换为强密码
JWT_SECRET=请替换为 openssl rand -base64 48 生成的密钥
```

说明：

- `MYSQL_USER` 创建的账号拥有 `lemon_erp` 库的全部权限，满足 Flowable 自动建表的需要；
- `init.sql` 通过 `/docker-entrypoint-initdb.d` 只在 MySQL 数据卷为空时执行一次；**删除 `mysql-data` 卷会清空全部数据**；
- 容器内的 MySQL 未配置证书校验时，连接串加了 `allowPublicKeyRetrieval=true&useSSL=false`（MySQL 8 默认的 `caching_sha2_password` 认证在非 SSL 连接下需要），只在 Docker 内部网络中使用；
- 只对外暴露 Nginx 的 80 端口，MySQL、Redis、后端都只在 Docker 网络内部访问；需要 HTTPS 时在 `web` 中挂载证书并参照 [Nginx 配置](./nginx) 修改，或在外层再放一个负责 HTTPS 的反向代理；
- 所有容器设置时区（MySQL 通过 `TZ`，后端镜像中已设置 `TZ=Asia/Shanghai`）。

## 启动

```bash
cd deploy
docker compose up -d --build
docker compose logs -f backend      # 首次启动时 Flowable 创建 ACT_* 表，稍等片刻
```

浏览器访问 `http://服务器地址`，使用 `admin` / `admin123` 登录后立即修改密码。

## 升级

```bash
git pull
cd deploy
docker compose build backend web
docker compose up -d backend web
```

升级前先备份数据库和 `lemon-files` 卷；数据库结构有变化时先执行增量 SQL，见 [升级与数据备份](./upgrade)。

## 备份卷中的数据

```bash
# 数据库
docker compose exec mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines lemon_erp' > lemon_erp_$(date +%F).sql

# 上传文件与附件
docker run --rm -v deploy_lemon-files:/data -v "$PWD":/backup alpine tar czf /backup/lemon-files_$(date +%F).tar.gz -C /data .
```

卷的实际名称带 compose 项目名前缀（默认为目录名，如 `deploy_lemon-files`），用 `docker volume ls` 查看。
