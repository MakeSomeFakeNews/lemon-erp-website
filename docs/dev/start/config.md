---
order: 4
---

# 配置说明

后端配置文件在 `lemon-admin/src/main/resources`，业务相关的配置项都以 `lemon.` 开头，由框架层和各模块的 `*Properties` 类或 `@Value` 读取。本页逐项说明全部配置及对应的环境变量。

## 多环境配置

| 文件 | 作用 |
| --- | --- |
| `application.yml` | 公共配置：端口、context-path、上传大小、Flowable、MyBatis-Plus、全部 `lemon.*` 默认值；默认激活 `dev` |
| `application-dev.yml` | 开发环境：本机 MySQL、本机 Redis，全部带默认值，可用环境变量覆盖 |
| `application-prod.yml` | 生产环境：数据库、Redis、JWT 密钥、上传目录全部取环境变量，**没有默认值** |

切换环境：

```bash
java -jar lemon-erp.jar --spring.profiles.active=prod
# 或
SPRING_PROFILES_ACTIVE=prod java -jar lemon-erp.jar
```

所有配置项都可以用 Spring Boot 的标准方式覆盖，优先级从高到低：命令行参数（`--lemon.job.enabled=false`）→ 环境变量（`LEMON_JOB_ENABLED=false`）→ `application-{profile}.yml` → `application.yml`。环境变量名的规则是把配置名中的 `.` 换成 `_`、去掉 `-`、转为大写，如 `lemon.upload.attachment-path` 对应 `LEMON_UPLOAD_ATTACHMENTPATH`。

## 环境变量一览

配置文件中直接引用的环境变量：

| 环境变量 | 对应配置 | dev 默认值 | prod |
| --- | --- | --- | --- |
| `DB_URL` | `spring.datasource.url` | `jdbc:mysql://localhost:3306/lemon_erp?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&nullCatalogMeansCurrent=true` | 必填 |
| `DB_USERNAME` | `spring.datasource.username` | `root` | 必填 |
| `DB_PASSWORD` | `spring.datasource.password` | `root` | 必填 |
| `REDIS_HOST` | `spring.data.redis.host` | `localhost` | 必填 |
| `REDIS_PORT` | `spring.data.redis.port` | `6379` | 必填 |
| `REDIS_PASSWORD` | `spring.data.redis.password` | 空 | 必填（没有密码时设为空字符串） |
| `REDIS_DATABASE` | `spring.data.redis.database` | `0` | 默认 `0` |
| `JWT_SECRET` | `lemon.jwt.secret` | 内置开发密钥 | 必填，至少 32 字节 |
| `UPLOAD_PATH` | `lemon.upload.path` | `./uploads`（来自 application.yml） | 必填 |
| `LEMON_TENANT_ENABLED` | `lemon.tenant.enabled` | `false` | 默认 `false` |
| `LEMON_DEMO_ENABLED` | `lemon.demo.enabled` | `false` | 默认 `false`，搭建对外演示环境时设为 `true` |

前端构建时可选的环境变量：

| 环境变量 | 说明 |
| --- | --- |
| `VITE_COMPANY_NAME` | 打印单据上的默认公司名称（未开启 SaaS、打印模板中也没有设置公司名称时使用），默认「柠檬ERP」。在 `npm run build` 时生效，例如 `VITE_COMPANY_NAME=某某公司 npm run build` |

## lemon.* 配置项

### lemon.demo：演示模式

对应 `framework/demo/DemoProperties`，详见 [搭建演示环境](../deploy/demo)。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `lemon.demo.enabled` | `false`（环境变量 `LEMON_DEMO_ENABLED`） | 开启后所有用户只能查看，不能新增、修改、删除数据 |
| `lemon.demo.allowed-paths` | `/auth/login`、`/auth/logout`、`/system/message/read`、`/bi/olap/pivot`、`/scm/promotion/preview`、`/wms/location/putaway`、`/system/print/pdf`、`/system/print/jrxml` | 演示模式下仍然放行的非 GET 请求（Ant 风格路径，不含 `/api`）：登录退出、标记消息已读，以及用 POST 传参的只读查询（多维分析、促销预览、上架建议、单据打印） |

### lemon.tenant：SaaS 多租户

对应 `framework/tenant/TenantProperties`。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `lemon.tenant.enabled` | `false`（环境变量 `LEMON_TENANT_ENABLED`） | 是否开启 SaaS 模式。关闭时只有平台租户，登录不需要填写租户，租户管理菜单隐藏；开启后业务数据按 `tenant_id` 隔离，详见 [SaaS 多租户](../architecture/tenant) |
| `lemon.tenant.ignore-tables` | `sys_menu`、`sys_dict_type`、`sys_dict_data`、`sys_job`、`sys_job_log`、`sys_tenant`、`sys_tenant_package`、`sys_tenant_package_menu`、`sys_user_role`、`sys_role_menu`、`sys_role_dept`、`sys_config` | 平台共享、没有 `tenant_id` 列的表，在代码中定义。新增平台共享表时在 `TenantProperties` 中登记，一般不在配置文件中修改 |

### lemon.jwt：登录令牌

对应 `framework/config/JwtProperties`（`secret`），`expire-hours` 由系统参数读取。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `lemon.jwt.secret` | dev 为内置开发密钥；prod 取 `JWT_SECRET` | JWT 的 HMAC 签名密钥，按 UTF-8 字节计算至少 32 字节（256 位），否则启动失败。修改后所有已签发的 token 失效 |
| `lemon.jwt.expire-hours` | `12` | 系统参数「登录有效期（小时）」的默认值（1~720）。在「参数设置」中修改过后以页面为准 |

### lemon.security：登录与密码策略默认值

这些配置都是「系统管理 → 参数设置」中对应参数的**默认值**，页面中修改过的参数保存在 `sys_config` 表，以页面为准（见 `framework/setting/Setting`）。

| 配置项 | 默认值 | 对应参数 | 范围 |
| --- | --- | --- | --- |
| `lemon.security.password-min-length` | `8` | 密码最小长度 | 6~32 |
| `lemon.security.login-max-retry` | `5` | 密码错误锁定次数 | 1~20 |
| `lemon.security.login-lock-minutes` | `10` | 锁定时长（分钟） | 1~1440 |
| `lemon.security.password-expire-days` | `0` | 密码有效期（天），0 不限制 | 0~3650 |

### lemon.user

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `lemon.user.initial-password` | `Lemon@123` | 系统参数「初始密码」的默认值：人事录用、组织同步自动开通账号时使用，须符合密码策略，首次登录要求修改 |

### lemon.cache：缓存实现

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `lemon.cache.type` | `redis` | `redis`：`RedisCacheService`（默认，未配置时也是 Redis）；`memory`：`MemoryCacheService`，进程内缓存，只适合本地体验，不支持多实例，重启后会话全部失效 |

### lemon.upload：文件存储

对应 `framework/config/UploadProperties`。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `lemon.upload.path` | `./uploads`（prod 取 `UPLOAD_PATH`） | 公开文件（头像等）的存储根目录，通过 `/api/files/**` 直接访问，不需要登录 |
| `lemon.upload.attachment-path` | `./attachments` | 业务附件（合同、简历、原始凭证等）的存储目录，不公开访问，只能通过附件接口按业务权限下载。prod 配置中没有覆盖，生产环境建议用 `LEMON_UPLOAD_ATTACHMENTPATH` 指定绝对路径 |

相对路径相对于进程的工作目录。附件单个文件的大小上限在「参数设置 → 文件上传 → 附件大小上限」中配置（默认 20MB，最大 100MB）。

### lemon.job：定时任务调度

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `lemon.job.enabled` | `true` | 是否自动调度定时任务（「系统监控 → 定时任务」）。设为 `false` 时不自动执行，仍可在页面上手动执行。多实例部署时只在一个实例上开启，见 [定时任务](../architecture/job) |

### lemon.bi：商务智能

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `lemon.bi.etl-cron` | `0 30 1 * * *` | 定时任务「数据仓库同步」的默认 Cron（每天 01:30），设为 `-` 时该任务首次登记为停用。只在任务首次登记到 `sys_job` 时生效，之后以「定时任务」页面的设置为准 |

### lemon.workflow：工作流

对应 `modules/workflow/config/WorkflowProperties`，`application.yml` 中没有配置，按需添加。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `lemon.workflow.database-type` | 空（按 JDBC 连接自动识别） | 强制指定 Flowable 的数据库方言，如 `mysql`。只在自动识别不正确时设置（例如使用兼容 MySQL 协议的其他数据库） |

## 其他重要配置

`application.yml` 中的其他配置：

| 配置项 | 值 | 说明 |
| --- | --- | --- |
| `server.port` | `8080` | 后端端口，可用 `SERVER_PORT` 覆盖 |
| `server.servlet.context-path` | `/api` | 所有接口的前缀，前端和 Nginx 都按 `/api` 转发，不建议修改 |
| `server.forward-headers-strategy` | `native` | 从 `X-Forwarded-For` / `X-Forwarded-Proto` 还原客户端 IP 和协议，只信任内网代理，见 [Nginx 配置](../deploy/nginx) |
| `spring.servlet.multipart.max-file-size` | `100MB` | 单个上传文件的上限（附件的实际上限以参数设置为准） |
| `spring.servlet.multipart.max-request-size` | `105MB` | 单次请求的上限 |
| `flowable.database-schema-update` | `true` | 启动时自动创建 / 升级 `ACT_*` 表 |
| `flowable.check-process-definitions` | `false` | 不扫描 `classpath:/processes`，流程定义只由「流程模型」发布 |
| `flowable.history-level` | `audit` | 保留流程、任务、变量、审批意见的历史 |
| `flowable.idm.enabled` / `flowable.eventregistry.enabled` | `false` | 不使用 Flowable 的用户组织和事件注册引擎，用户与组织架构使用系统自己的表 |
| `mybatis-plus.mapper-locations` | `classpath*:mapper/**/*.xml` | 扫描全部模块的 mapper XML |
| `mybatis-plus.configuration.map-underscore-to-camel-case` | `true` | 列名下划线自动映射为驼峰属性 |
| `mybatis-plus.global-config.db-config.id-type` | `auto` | 主键自增 |

prod 中额外设置了 `logging.level.root: info`。

单据打印（JasperReports）没有配置项：纸张、字号、版式都在「系统管理 → 打印模板」中按租户设置，字体与表达式编译器在代码中（`PrintContext`）固定。部署的服务器需要安装中文字体用于排版时测量文字宽度，见 [生产环境配置](../deploy/production#中文字体)。

## 系统参数与配置文件的关系

「系统管理 → 参数设置」中的参数定义在 `framework/setting/Setting` 枚举中，读取顺序为：

1. 页面中修改过的值（`sys_config` 表，平台级，所有租户共用，缓存键 `settings:all`）；
2. 参数声明了配置属性（如 `lemon.security.login-max-retry`）时，取配置文件或环境变量中的值；
3. 都没有时取枚举中的默认值。

| 参数 | 键 | 默认值来源 |
| --- | --- | --- |
| 系统名称 | `sys.name` | 柠檬ERP |
| 登录页显示演示账号 | `sys.showDemoAccount` | true |
| 页面水印 | `sys.watermark` | false |
| 登录验证码 | `captcha.mode` | OFF（可选 每次登录 / 密码输错后） |
| 验证码类型 | `captcha.type` | MATH（算术题，可选 4 位字母数字） |
| 密码错误锁定次数 | `login.maxRetry` | `lemon.security.login-max-retry` |
| 锁定时长（分钟） | `login.lockMinutes` | `lemon.security.login-lock-minutes` |
| 登录有效期（小时） | `session.expireHours` | `lemon.jwt.expire-hours` |
| 同一账号只允许一处登录 | `session.single` | false |
| 密码最小长度 | `password.minLength` | `lemon.security.password-min-length` |
| 密码复杂度 | `password.complexity` | LETTER_DIGIT（字母和数字） |
| 密码有效期（天） | `password.expireDays` | `lemon.security.password-expire-days` |
| 初始密码 | `user.initialPassword` | `lemon.user.initial-password` |
| 附件大小上限（MB） | `upload.attachmentMaxMb` | 20 |

业务代码通过注入 `SettingService` 读取参数，例如 `settings.getInt(Setting.SESSION_EXPIRE_HOURS)`。新增参数时在 `Setting` 中声明即可自动出现在参数设置页面。

「系统管理 → 业务参数」是另一套按租户保存的业务控制规则（超收比例、信用额度控制方式等），不读取配置文件，默认值写在各模块的 `BizRuleProvider` 中，见 [新增业务参数](../guide/biz-rule)。
