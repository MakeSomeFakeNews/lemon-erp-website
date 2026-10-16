# 部署运维

本章介绍柠檬ERP 的打包、生产环境配置、Nginx 反向代理、Docker 部署，以及升级、备份和常见问题。

## 部署架构

| 组件 | 说明 |
| --- | --- |
| Nginx | 托管前端静态文件 `lemon-web/dist`，把 `/api/` 反向代理到后端；负责 HTTPS |
| 后端 `lemon-erp.jar` | Spring Boot 可执行 jar，默认端口 8080，接口前缀 `/api`，使用 prod 配置 |
| MySQL 8 | 业务库，包含 `init.sql` 创建的业务表和 Flowable 自动创建的 `ACT_*` 表 |
| Redis | 登录会话、权限、字典、参数缓存 |
| 本地磁盘 | 头像（`UPLOAD_PATH`）、业务附件（附件目录），需要持久化和备份 |

请求路径：浏览器 → Nginx（`/` 静态文件，`/api/` 转发）→ 后端 `:8080/api/...` → MySQL / Redis。前端使用 HTML5 History 路由，部署在域名根路径下。

## 服务器要求

| 项目 | 要求 |
| --- | --- |
| 操作系统 | Linux（推荐）、Windows、macOS |
| Java | JRE 17 |
| MySQL | 8.0 及以上，字符集 utf8mb4 |
| Redis | 6.2 及以上 |
| Nginx | 1.20 及以上 |
| 内存 | 后端建议分配 1GB 以上堆内存（`-Xmx1g`），数据量大、使用商务智能同步时适当增加 |

## 上线检查清单

| 检查项 | 说明 |
| --- | --- |
| 使用 prod 配置 | `--spring.profiles.active=prod` 或 `SPRING_PROFILES_ACTIVE=prod` |
| `JWT_SECRET` | 随机生成，至少 32 字节，妥善保管 |
| 数据库连接串 | 带 `nullCatalogMeansCurrent=true`、`serverTimezone=Asia/Shanghai`，账号有建表权限 |
| Redis | 设置密码；与其他系统共用时使用单独的库 |
| 文件目录 | `UPLOAD_PATH` 和附件目录使用绝对路径，持久化并纳入备份 |
| Nginx | `/api/` 转发并设置 `X-Forwarded-For`；`client_max_body_size` 调大；启用 HTTPS |
| 时区 | 服务器、JVM、MySQL 时区一致（如 `Asia/Shanghai`），影响单据日期、定时任务执行时间 |
| 默认账号 | 修改 admin 密码，停用 test 账号 |
| 参数设置 | 关闭「登录页显示演示账号」；按需开启登录验证码、密码策略、页面水印 |
| 多实例 | 只在一个实例上开启定时任务，上传目录使用共享存储，缓存使用 Redis |
| 备份 | 配置数据库和文件目录的定期备份 |

## 本章内容

| 页面 | 内容 |
| --- | --- |
| [打包](./build) | 后端 jar、前端 dist 的构建 |
| [生产环境配置](./production) | prod 配置、环境变量、启动脚本、systemd 服务、JVM 参数 |
| [Nginx 配置](./nginx) | 静态文件、反向代理、HTTPS、上传大小、真实 IP |
| [Docker 部署示例](./docker) | Dockerfile 与 docker-compose 参考 |
| [升级与数据备份](./upgrade) | 版本升级步骤、数据库与文件备份建议 |
| [常见问题](./faq) | Flowable 表、`nullCatalogMeansCurrent`、`JWT_SECRET` 长度、`X-Forwarded-For`、ip2region 更新等 |
