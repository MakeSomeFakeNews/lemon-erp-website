---
order: 2
---

# 生产环境配置

生产环境使用 `application-prod.yml`：数据库、Redis、JWT 密钥、上传目录全部取环境变量，没有默认值，避免把开发环境的配置带到生产。全部配置项见 [配置说明](../start/config)。

## application-prod.yml

```yaml
# 生产环境：所有敏感配置必须通过环境变量提供，缺失时启动失败
spring:
  datasource:
    driver-class-name: com.mysql.cj.jdbc.Driver
    url: ${DB_URL}
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
  data:
    redis:
      host: ${REDIS_HOST}
      port: ${REDIS_PORT}
      password: ${REDIS_PASSWORD}
      database: ${REDIS_DATABASE:0}

lemon:
  jwt:
    secret: ${JWT_SECRET}
  upload:
    path: ${UPLOAD_PATH}

logging:
  level:
    root: info
```

## 环境变量

| 环境变量 | 必填 | 示例 | 说明 |
| --- | --- | --- | --- |
| `SPRING_PROFILES_ACTIVE` | 是 | `prod` | 也可以用启动参数 `--spring.profiles.active=prod` |
| `DB_URL` | 是 | `jdbc:mysql://127.0.0.1:3306/lemon_erp?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&nullCatalogMeansCurrent=true` | 必须带 `nullCatalogMeansCurrent=true` |
| `DB_USERNAME` / `DB_PASSWORD` | 是 | `lemon` / `***` | 账号需要 DDL 权限（Flowable 自动建表） |
| `REDIS_HOST` / `REDIS_PORT` | 是 | `127.0.0.1` / `6379` | |
| `REDIS_PASSWORD` | 是 | `***` | Redis 没有密码时也要设置为空字符串 |
| `REDIS_DATABASE` | 否 | `0` | 与其他系统共用 Redis 时指定单独的库 |
| `JWT_SECRET` | 是 | 64 位随机字符串 | 至少 32 字节，见下文 |
| `UPLOAD_PATH` | 是 | `/data/lemon-erp/uploads` | 头像等公开文件目录 |
| `LEMON_UPLOAD_ATTACHMENTPATH` | 建议 | `/data/lemon-erp/attachments` | 业务附件目录，默认是工作目录下的 `./attachments` |
| `LEMON_TENANT_ENABLED` | 否 | `false` | 是否开启 SaaS 多租户 |
| `LEMON_DEMO_ENABLED` | 否 | `false` | 是否开启演示模式（只能查看），见 [搭建演示环境](./demo) |
| `LEMON_JOB_ENABLED` | 否 | `true` | 多实例部署时只在一个实例上为 true |
| `SERVER_PORT` | 否 | `8080` | 后端端口 |
| `TZ` | 建议 | `Asia/Shanghai` | 进程时区，影响 `LocalDate.now()`、定时任务的执行时间 |

### JWT_SECRET

JWT 使用 HMAC 签名，密钥按 UTF-8 编码后**至少 32 字节**（256 位），否则启动时报 `WeakKeyException`。生成随机密钥：

```bash
openssl rand -base64 48
```

- 密钥泄露后任何人都可以伪造令牌（虽然还需要服务端会话存在，但不要依赖这一点），请妥善保管，不要提交到代码仓库；
- 更换密钥后所有已登录用户需要重新登录；
- 多实例部署时所有实例使用同一个密钥。

## 启动脚本

```bash
#!/usr/bin/env bash
# /opt/lemon-erp/start.sh
export SPRING_PROFILES_ACTIVE=prod
export DB_URL='jdbc:mysql://127.0.0.1:3306/lemon_erp?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&nullCatalogMeansCurrent=true'
export DB_USERNAME=lemon
export DB_PASSWORD='数据库密码'
export REDIS_HOST=127.0.0.1
export REDIS_PORT=6379
export REDIS_PASSWORD='Redis密码'
export JWT_SECRET='替换为 openssl rand -base64 48 生成的密钥'
export UPLOAD_PATH=/data/lemon-erp/uploads
export LEMON_UPLOAD_ATTACHMENTPATH=/data/lemon-erp/attachments
export TZ=Asia/Shanghai

exec java -Xms512m -Xmx1g -XX:+UseG1GC \
  -jar /opt/lemon-erp/lemon-erp.jar \
  --logging.file.name=/var/log/lemon-erp/app.log
```

## systemd 服务

推荐用 systemd 管理进程，环境变量写在单独的文件中（权限 600）：

```ini
# /etc/lemon-erp/lemon-erp.env
SPRING_PROFILES_ACTIVE=prod
DB_URL=jdbc:mysql://127.0.0.1:3306/lemon_erp?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&nullCatalogMeansCurrent=true
DB_USERNAME=lemon
DB_PASSWORD=数据库密码
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=Redis密码
JWT_SECRET=替换为随机密钥
UPLOAD_PATH=/data/lemon-erp/uploads
LEMON_UPLOAD_ATTACHMENTPATH=/data/lemon-erp/attachments
TZ=Asia/Shanghai
```

```ini
# /etc/systemd/system/lemon-erp.service
[Unit]
Description=Lemon ERP
After=network.target mysql.service redis.service

[Service]
Type=simple
User=lemon
WorkingDirectory=/opt/lemon-erp
EnvironmentFile=/etc/lemon-erp/lemon-erp.env
ExecStart=/usr/bin/java -Xms512m -Xmx1g -XX:+UseG1GC -jar /opt/lemon-erp/lemon-erp.jar --logging.file.name=/var/log/lemon-erp/app.log
SuccessExitStatus=143
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lemon-erp
sudo systemctl status lemon-erp
journalctl -u lemon-erp -f
```

运行用户需要对上传目录、附件目录、日志目录有读写权限。

## JVM 参数建议

| 参数 | 建议 |
| --- | --- |
| `-Xms` / `-Xmx` | 一般 1~2GB；MRP 运算、数据仓库同步、大批量导出时内存占用较高，按数据量调整 |
| `-XX:+UseG1GC` | Java 17 默认即为 G1，可省略 |
| `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/var/log/lemon-erp/` | 便于排查内存溢出 |
| `-Duser.timezone=Asia/Shanghai` | 不方便设置 `TZ` 环境变量时使用 |

IP 归属地库（约 11MB）在启动时加载到内存。

## 日志

默认日志输出到控制台。用 `--logging.file.name` 输出到文件，Spring Boot 默认按 10MB 滚动、保留 7 天，可以调整：

```bash
--logging.file.name=/var/log/lemon-erp/app.log \
--logging.logback.rollingpolicy.max-file-size=100MB \
--logging.logback.rollingpolicy.max-history=30
```

需要调整某个包的日志级别时：`--logging.level.com.lemon.erp=debug`（排查 SQL 可设置对应 Mapper 包为 debug）。

## 多实例部署

后端是无状态的（会话在 Redis 中），可以部署多个实例由 Nginx 负载均衡，注意：

| 项目 | 要求 |
| --- | --- |
| 缓存 | 必须使用 Redis（`lemon.cache.type=redis`），内存缓存不支持多实例 |
| JWT 密钥 | 所有实例相同 |
| 文件目录 | `UPLOAD_PATH` 和附件目录挂载同一个共享存储（NFS 等），或改造 `FileStorageService` 使用对象存储 |
| 定时任务 | 只在一个实例上 `LEMON_JOB_ENABLED=true`，其他实例为 `false`，否则任务会在每个实例上各执行一次 |
| 流程引擎 | Flowable 共用同一个数据库，多实例之间由引擎的乐观锁保证一致 |

## 安全建议

- 生产环境只开放 Nginx 的 80 / 443 端口，后端 8080、MySQL、Redis 只监听内网或本机；
- 启用 HTTPS；
- 在「系统管理 → 参数设置」中开启登录验证码、设置密码复杂度和有效期、按需开启「同一账号只允许一处登录」和页面水印；
- 修改 admin 默认密码，停用 test 账号，关闭「登录页显示演示账号」；
- 附件目录不要放在 Nginx 可直接访问的目录下。
