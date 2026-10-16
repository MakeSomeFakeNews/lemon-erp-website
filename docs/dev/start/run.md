---
order: 2
---

# 本地运行

本页介绍在本机初始化数据库、启动后端和前端的完整步骤。所有 Gradle 命令都在项目根目录执行。

## 1. 获取源码

```bash
git clone https://github.com/MakeSomeFakeNews/lemon-erp.git
cd lemon-erp
```

## 2. 初始化数据库

```bash
mysql -uroot -p -e "CREATE DATABASE lemon_erp DEFAULT CHARSET utf8mb4"
mysql -uroot -p lemon_erp < sql/init.sql
```

`sql/init.sql` 是唯一的建表与初始数据脚本，包含全部业务表、菜单与按钮权限、字典、内置角色、内置流程模型（未发布）、默认账号和示例基础资料。

::: danger 注意
`init.sql` 开头会 `DROP TABLE IF EXISTS` 删除全部业务表后重建，**不要在已有数据的库上执行**。已有库的结构变更需要自行编写增量脚本，见 [升级与数据备份](../deploy/upgrade)。
:::

工作流引擎的 `ACT_` 开头的表不在 `init.sql` 中，后端首次启动时由 Flowable 自动创建。

## 3. 启动后端

```bash
./gradlew bootRun
```

`bootRun` 使用默认的 dev 环境（`spring.profiles.active: dev`），连接本机 MySQL `localhost:3306/lemon_erp`（`root` / `root`）和本机 Redis（`localhost:6379`，无密码）。本机配置不同时用环境变量覆盖：

```bash
# macOS / Linux
DB_PASSWORD=你的密码 REDIS_PASSWORD=redis密码 ./gradlew bootRun

# Windows PowerShell
$env:DB_PASSWORD="你的密码"; .\gradlew.bat bootRun
```

| 环境变量 | dev 默认值 |
| --- | --- |
| `DB_URL` | `jdbc:mysql://localhost:3306/lemon_erp?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&nullCatalogMeansCurrent=true` |
| `DB_USERNAME` | `root` |
| `DB_PASSWORD` | `root` |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` |
| `REDIS_PASSWORD` | 空 |
| `REDIS_DATABASE` | `0` |
| `JWT_SECRET` | 内置的开发密钥（生产环境必须更换） |

完整的配置项见 [配置说明](./config)。

启动成功后后端监听 `http://localhost:8080`，接口前缀为 `/api`（如 `http://localhost:8080/api/auth/config`）。首次启动时：

- Flowable 自动创建 `ACT_*` 表，耗时会比之后的启动稍长；
- 定时任务调度器为每个任务（`JobHandler`）在 `sys_job` 中登记一条记录，使用默认 Cron；
- `bootRun` 的工作目录是项目根目录，上传的头像保存在 `./uploads`，业务附件保存在 `./attachments`。

::: tip 自定义 DB_URL 时
自己设置 `DB_URL` 时记得保留 `nullCatalogMeansCurrent=true` 参数，否则 Flowable 可能读取到同一 MySQL 实例中其他库的 `ACT_*` 表结构，导致引擎表没有创建或启动报错。详见 [常见问题](../deploy/faq)。
:::

## 4. 启动前端

```bash
cd lemon-web
npm install
npm run dev
```

访问 `http://localhost:5173`。Vite 开发服务器把 `/api` 开头的请求代理到 `http://localhost:8080`，并附带 `X-Forwarded-For`（`xfwd: true`），配置在 `lemon-web/vite.config.js`。

## 5. 登录

| 租户 | 账号 | 密码 | 说明 |
| --- | --- | --- | --- |
| 柠檬科技 | admin | admin123 | 超级管理员，拥有全部权限 |
| 柠檬科技 | test | admin123 | 普通用户，所有页面只读，数据权限为「本部门及以下」，可以在流程中心发起、审批自己的流程 |

「租户」输入框只在开启 SaaS 多租户（`LEMON_TENANT_ENABLED=true`）时显示，默认不显示，直接输入账号密码即可。开启后租户名称填「柠檬科技」（平台租户）。

登录后可以在「系统管理 → 用户管理」中为其他内置角色（总经理、采购员、仓库管理员、会计等）创建账号，体验不同岗位的菜单和数据权限。

::: tip 正式使用前
- 修改 admin、test 的密码，或停用 test 账号；
- 在「系统管理 → 参数设置」中关闭「登录页显示演示账号」；
- 生产环境配置见 [生产环境配置](../deploy/production)。
:::

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `./gradlew bootRun` | 以 dev 环境启动后端 |
| `./gradlew build` | 编译全部模块并生成 `lemon-admin/build/libs/lemon-erp.jar` |
| `./gradlew :lemon-admin:bootJar` | 只生成可执行 jar |
| `./gradlew clean` | 清理构建输出 |
| `cd lemon-web && npm run dev` | 启动前端开发服务器（端口 5173） |
| `cd lemon-web && npm run build` | 构建前端，输出到 `lemon-web/dist` |
| `cd lemon-web && npm run preview` | 本地预览构建结果 |

## 启动失败排查

| 现象 | 处理 |
| --- | --- |
| `Access denied for user 'root'@'localhost'` | 数据库密码不对，设置 `DB_PASSWORD` |
| `Unknown database 'lemon_erp'` | 没有建库，执行第 2 步 |
| `Table 'lemon_erp.sys_xxx' doesn't exist` | 没有执行 `init.sql` |
| 登录时提示「系统繁忙，请稍后重试」，后端日志中有 `Unable to connect to Redis` | Redis 没有启动或密码不对；也可以临时改用内存缓存 `LEMON_CACHE_TYPE=memory` |
| `Public Key Retrieval is not allowed` | MySQL 8 账号使用 `caching_sha2_password` 且未启用 SSL，在 `DB_URL` 中加 `allowPublicKeyRetrieval=true` |
| 前端页面接口全部报「网络连接失败」 | 后端没有启动，或没有监听 8080 端口 |

更多问题见 [常见问题](../deploy/faq)。
