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
| `LEMON_MINIAPP_APP_ID` / `LEMON_MINIAPP_APP_SECRET` | 否 | `wx0123456789abcdef` / `***` | 微信小程序的 AppID / AppSecret，不用小程序时不设置 |
| `LEMON_MINIAPP_SUBSCRIBE_TEMPLATE_ID` | 否 | 公众平台中的模板 ID | 审批提醒的订阅消息模板，不设置时不推送 |
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
| `-Xms` / `-Xmx` | 一般 1~2GB；MRP 运算、数据仓库同步、大批量导出、批量打印（一次最多 1000 张单据、2 万行明细）时内存占用较高，按数据量调整 |
| `-XX:+UseG1GC` | Java 17 默认即为 G1，可省略 |
| `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/var/log/lemon-erp/` | 便于排查内存溢出 |
| `-Duser.timezone=Asia/Shanghai` | 不方便设置 `TZ` 环境变量时使用 |

IP 归属地库（约 11MB）在启动时加载到内存。

## 中文字体

单据打印由后端用 JasperReports 生成 PDF。PDF 中的文字使用 PDF 阅读器内置的宋体（不嵌入字体文件），但后端排版时要用服务器上的字体测量文字宽度、决定在哪里换行，因此**服务器需要安装至少一种中文字体**。没有中文字体时应用启动日志中会出现警告「服务器没有能显示中文的字体，打印单据时中文换行可能不准确」，打印仍然可以进行，但中文按西文字体测量，表格中的长文字可能超出单元格或换行位置不对。

```bash
# Debian / Ubuntu
sudo apt-get install -y fontconfig fonts-noto-cjk

# RHEL / Rocky / AlmaLinux
sudo dnf install -y fontconfig google-noto-sans-cjk-ttc-fonts

# Alpine（容器）
apk add --no-cache fontconfig font-noto-cjk

# 确认已安装中文字体
fc-list :lang=zh
```

安装后重启后端生效（字体在启动时检测一次）。Windows、macOS 自带中文字体，不需要处理。

其他说明：

- 打印依赖 JasperReports、OpenPDF 和 Eclipse ECJ，都已打包在 `lemon-erp.jar` 中；报表表达式由 ECJ 编译，运行环境只需要 JRE 17，不需要 JDK；
- Java 的图形环境需要以无头模式运行，Spring Boot 默认已设置 `java.awt.headless=true`，不要在启动参数中改为 `false`；
- 编译后的报表缓存在进程内存中（最多 256 个），重启后首次打印每种单据会慢一些。

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
| 第三方集成 | 授权登录的 state（`im:state:`）和应用 access_token 在缓存中，发起授权与回调可能落在不同实例，必须使用 Redis |
| 微信小程序 | 登录会话（`mp:session:`）和 access_token（`mp:token`）在缓存中，登录与选择租户、绑定可能落在不同实例，必须使用 Redis |

## 第三方集成

接入钉钉、企业微信、飞书（「系统管理 → 第三方集成」）时，部署上需要满足：

| 项目 | 要求 |
| --- | --- |
| 系统访问地址 | 在页面上填写的 `home_url` 是**前端**地址（如 `https://erp.example.com`），授权回调 `{home_url}/im-callback` 和应用首页 `{home_url}/im-login` 都是前端路由。员工的手机和电脑必须能访问它；在公司外用手机打开时需要外网可访问。建议使用 HTTPS，飞书、钉钉的重定向 URL 和企业微信的可信域名都按这个地址登记 |
| 前端路由回退 | Nginx 需要 `try_files $uri $uri/ /index.html`，使 `/im-callback`、`/im-login` 直接访问时返回 `index.html`，见 [Nginx 配置](./nginx) |
| 服务器出口 | 后端要能访问平台的开放接口：`oapi.dingtalk.com`、`api.dingtalk.com`、`qyapi.weixin.qq.com`、`open.feishu.cn`（地址见 `lemon.im.*`）。处在代理或防火墙之后时放行这些域名的 443 端口 |
| 企业微信可信 IP | 企业微信要求在应用的「企业可信 IP」中登记调用接口的服务器出口 IP，出口 IP 变化后需要更新 |
| 回调不需要入站 | 平台只把浏览器重定向回系统访问地址，不会主动回调后端，后端不需要对平台开放入站访问 |
| 多实例 | 必须使用 Redis，见上文「多实例部署」 |
| 子路径部署 | 系统访问地址可以带路径，但前端本身需要按 [部署在子路径下](./nginx#部署在子路径下) 改造；免登入口直接请求 `/api/auth/info` 校验令牌，接口地址需与前端同源 |

应用凭证保存在数据库 `sys_im_config` 中（密钥只写不读、操作日志隐藏），备份数据库时注意保护。

## 微信小程序

使用微信小程序（`lemon-mp`）时，部署上需要满足：

| 项目 | 要求 |
| --- | --- |
| HTTPS 域名 | 小程序正式版只能访问 HTTPS 域名：已备案的域名（不能是 IP 地址或 `localhost`），证书有效且由受信任的机构签发，支持 TLS 1.2 及以上。小程序编译时的接口地址 `VITE_API_BASE` 为 `https://<域名>/api` |
| 服务器域名 | 在微信公众平台「开发管理 → 开发设置 → 服务器域名」中把该域名登记为 request、uploadFile、downloadFile 合法域名；使用非 443 端口时要连同端口登记 |
| Nginx | 与 Web 端共用同一个 `/api` 转发即可，不需要额外配置；跟进照片上传受 `client_max_body_size` 和附件大小上限限制，见 [Nginx 配置](./nginx) |
| 后端配置 | `LEMON_MINIAPP_APP_ID`、`LEMON_MINIAPP_APP_SECRET`；审批提醒另需 `LEMON_MINIAPP_SUBSCRIBE_TEMPLATE_ID`，见 [配置说明](../start/config) |
| 服务器出口 | 后端要能访问 `api.weixin.qq.com` 的 443 端口（code2Session、access_token、订阅消息）；如果在公众平台「开发设置」中开启了 IP 白名单，要登记后端的出口 IP |
| access_token | 同一个小程序的 AppSecret 不要再给其他系统获取 access_token，否则会互相使对方的令牌失效 |
| 多实例 | 必须使用 Redis，见上文「多实例部署」 |

AppSecret 只通过环境变量提供，不要写入配置文件或提交到代码仓库；在公众平台重置 AppSecret 后要同步更新环境变量并重启后端。小程序的编译、上传、审核见 [微信小程序开发 → 发布](../guide/miniapp#发布)。

## 安全建议

- 生产环境只开放 Nginx 的 80 / 443 端口，后端 8080、MySQL、Redis 只监听内网或本机；
- 启用 HTTPS；
- 在「系统管理 → 参数设置」中开启登录验证码、设置密码复杂度和有效期、按需开启「同一账号只允许一处登录」和页面水印；
- 修改 admin 默认密码，停用 test 账号，关闭「登录页显示演示账号」；
- 附件目录不要放在 Nginx 可直接访问的目录下。
