---
order: 7
---

# 常见问题

## 数据库与 Flowable

### Flowable 的 ACT_ 表在哪里创建？init.sql 中为什么没有？

`ACT_` 开头的表（`ACT_RE_*` 流程定义、`ACT_RU_*` 运行时、`ACT_HI_*` 历史、`ACT_GE_*` 通用）由 Flowable 引擎在后端启动时自动创建和升级（`flowable.database-schema-update: true`），版本由引擎管理，所以不放在 `init.sql` 中。

- 首次启动会比之后慢一些；
- 数据库账号需要 CREATE、ALTER、INDEX 等 DDL 权限，否则启动时报建表失败；
- 备份、恢复时 `ACT_*` 表要和业务表一起处理：业务单据上记录的流程实例 ID 指向这些表；
- 不要手工删除 `ACT_*` 表中的数据，终止流程请在「流程中心 → 流程实例」中操作。

### 为什么连接串必须带 nullCatalogMeansCurrent=true？

Flowable 启动时通过 JDBC 元数据（`DatabaseMetaData.getTables`）判断引擎表是否已经存在。MySQL Connector/J 8 开始 `nullCatalogMeansCurrent` 默认为 false，查询元数据时不限定当前库，会把**同一 MySQL 实例中其他库**里的 `ACT_*` 表也算进来：

- 其他库（例如另一个使用 Flowable 的系统、测试库）已有这些表时，引擎误以为表已存在，不再创建，随后访问时报 `Table 'lemon_erp.ACT_GE_PROPERTY' doesn't exist`；
- 或者读取到其他库的版本信息，误判需要升级。

dev 配置的默认连接串已经带上该参数；自己设置 `DB_URL` 时务必保留：

```
jdbc:mysql://host:3306/lemon_erp?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&nullCatalogMeansCurrent=true
```

已经因为缺少该参数导致启动失败时，加上参数后重新启动即可，引擎会在本库中创建缺少的表。

### 启动报 Public Key Retrieval is not allowed

MySQL 8 默认使用 `caching_sha2_password` 认证，在没有 SSL 的连接上首次认证需要获取服务器公钥。可以：

- 在连接串中加 `allowPublicKeyRetrieval=true`（只建议在可信的内网中使用）；
- 或为连接启用 SSL；
- 或把应用账号改为 `mysql_native_password` 认证。

### 时间相差 8 小时

- JDBC 连接串带 `serverTimezone=Asia/Shanghai`（与 MySQL 服务器时区一致）；
- 后端进程设置 `TZ=Asia/Shanghai` 或 `-Duser.timezone=Asia/Shanghai`，容器中尤其要注意；
- MySQL 服务器时区与业务时区一致（`init.sql` 中的 `NOW()` 使用服务器时区）。

JSON 中的日期时间统一输出为 `yyyy-MM-dd HH:mm:ss`（服务器时区），不会输出 UTC 时间。

### 能在已有数据的库上重新执行 init.sql 吗？

不能。`init.sql` 开头会 `DROP TABLE IF EXISTS` 删除全部业务表。已有环境的结构变更需要编写增量 SQL，见 [升级与数据备份](./upgrade)。

## 认证与安全

### 启动报 WeakKeyException / JWT_SECRET 长度不够

JWT 使用 HMAC-SHA 签名，JJWT 要求密钥至少 256 位。`lemon.jwt.secret`（prod 为环境变量 `JWT_SECRET`）按 UTF-8 编码后**至少 32 字节**，否则启动时报：

```
io.jsonwebtoken.security.WeakKeyException: The specified key byte array is ... bits which is not secure enough for any JWT HMAC-SHA algorithm.
```

用 `openssl rand -base64 48` 生成一个 64 字符的随机字符串即可。注意中文字符在 UTF-8 中占 3 字节，不建议使用。prod 环境没有设置 `JWT_SECRET` 时同样无法启动。

### 修改 JWT_SECRET 后所有人都掉线了

正常现象：已签发的令牌无法通过新密钥的签名校验，所有用户需要重新登录。多实例部署时所有实例必须使用同一个密钥，否则用户在实例之间切换时会被要求重新登录。

### 账号被锁定了怎么解锁？

连续输错密码达到「密码错误锁定次数」后锁定，锁定时长后自动解锁。提前解锁：管理员重置该用户的密码，或在「系统监控 → 缓存监控」中清除「登录失败」缓存（`login:fail:*`）。不存在的用户名同样会计数。

### admin 密码忘了

在数据库中把 admin 的密码重置为 `admin123` 对应的 BCrypt 值（`init.sql` 中 `sys_user` 插入语句里的密码哈希），登录后立即修改，并删除 Redis 中的 `login:perms:*`、`login:fail:*`。

### 直接改了数据库中的角色、菜单，为什么没有生效？

登录用户的权限缓存在 `login:perms:{userId}` 中（30 分钟）。通过页面修改会自动清理；直接改库后需要删除 `login:perms:*`，或在「缓存监控」中清空「用户权限」。字典改库后删除 `dict:*`。与其他项目共用 Redis 时只按前缀删除，不要 `FLUSHDB`。

## 代理与 IP

### 日志中的 IP 都是 127.0.0.1 或 Nginx 的地址

后端从 `X-Forwarded-For` 还原客户端 IP 需要两个条件：

1. Nginx 设置了 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`；
2. 请求来自受信任的代理：默认只信任内网地址（10/8、172.16/12、192.168/16、127/8 等）。Nginx 或负载均衡器不在内网时，用 `server.tomcat.remoteip.internal-proxies` 配置其地址的正则（设置后替换默认范围）。

外部客户端直接伪造的 `X-Forwarded-For` 请求头不会被采用（请求不是来自受信任的代理）。本地开发时在本机访问显示 `127.0.0.1` / 「内网IP」属于正常现象。详见 [Nginx 配置](./nginx)。

### IP 归属地显示「未知」

- 公网 IPv6 地址：目前只内置 IPv4 库，IPv6 显示「未知」；
- 内网地址显示「内网IP」；
- IP 库加载失败时（启动日志中有「加载 IP 归属地库失败」）所有地址显示「未知」。

### 如何更新 ip2region 归属地库？

归属地使用 [ip2region](https://github.com/lionsoul2014/ip2region) 离线库，文件为 `lemon-framework/src/main/resources/ip2region/ip2region_v4.xdb`，打包在 jar 中，启动时整体加载到内存，不调用任何外部接口。更新步骤：

1. 从 ip2region 项目的 `data` 目录下载最新的 `ip2region_v4.xdb`（xdb 格式需与依赖的 `org.lionsoul:ip2region` 3.x 版本兼容）；
2. 覆盖上述文件；
3. 重新打包、部署后端。

已记录的日志中的归属地不会更新，只影响之后的记录。

## 部署

### 刷新页面出现 404

前端使用 HTML5 History 路由，Nginx 需要配置 `try_files $uri $uri/ /index.html;`，把未知路径交给前端路由处理。

### 接口全部返回 404 或「接口不存在」

后端 context-path 为 `/api`，Nginx 要把 `/api/` 原样转发：`proxy_pass http://127.0.0.1:8080;`（后面不带 `/`）。写成 `proxy_pass http://127.0.0.1:8080/;` 会去掉 `/api` 前缀。

### 上传附件报 413 Request Entity Too Large

Nginx 默认请求体上限为 1MB，设置 `client_max_body_size 105m;`（不小于「参数设置」中的附件大小上限）。后端的上限为单个文件 100MB、单次请求 105MB。

### 页面能打开，但登录提示「系统繁忙，请稍后重试」

查看后端日志中的异常，常见原因：Redis 连不上或密码错误、数据库表不完整（没有执行 `init.sql`）。为了安全，未知异常的详细信息只记录在日志中，不返回给前端。

### 定时任务在每个实例上都执行了一次

多实例部署时只在一个实例上开启调度（`LEMON_JOB_ENABLED=true`），其他实例设为 `false`。

### 修改了 lemon.bi.etl-cron 没有生效

该配置只是「数据仓库同步」任务首次登记时的默认 Cron，之后以「系统监控 → 定时任务」页面的设置为准，请在页面上修改。

### 开启 SaaS 后报「当前操作缺少租户上下文」

在没有租户上下文的线程中访问了租户表，常见于自建线程、`@Scheduled` 方法。异步处理用 `@Async`（租户自动传递），定时任务实现 `JobHandler`（调度器按租户执行），需要切换时用 `TenantContext.runAs`。见 [SaaS 多租户](../architecture/tenant)。

### 开启 SaaS 后新租户看不到某些菜单

非平台租户的菜单以租户套餐为上限，在「系统管理 → 租户套餐」中把菜单加入套餐。菜单、字典、参数设置、监控、定时任务等平台专属功能不能分配给其他租户。

### 打印的单据中文换行不对、文字超出表格

服务器没有安装中文字体，后端排版时按西文字体测量中文宽度。安装中文字体（如 `fonts-noto-cjk`）后重启后端，见 [生产环境配置](./production#中文字体)。启动日志中的警告「服务器没有能显示中文的字体」可以确认这一点。

### 打印时提示超时或「打印失败」

一次打印的单据很多时生成 PDF 需要较长时间：前端等待 120 秒，Nginx 的 `proxy_read_timeout` 也要不小于这个时间（默认只有 60 秒），见 [Nginx 配置](./nginx)。「打印失败：……」是 JasperReports 编译或填充报表出错，多见于上传的 JRXML 引用了不存在的参数或字段，详细原因在后端日志中；可以在「打印模板」中删除上传的 JRXML 恢复按配置打印。

### 开启 SaaS 后不能上传 JRXML

JRXML 中的表达式是在服务器上执行的 Java 代码，SaaS 模式下只有平台租户可以上传，其他租户提示「SaaS 模式下租户不能上传 JRXML 模板」，只能用可视化配置和套打调整版式。见 [单据编号与打印](../guide/doc-no-print#上传-jrxml)。

### 只想快速体验，不想装 Redis

设置 `LEMON_CACHE_TYPE=memory` 使用进程内缓存（仍需要 MySQL）。仅限单实例体验，重启后所有用户需要重新登录。
