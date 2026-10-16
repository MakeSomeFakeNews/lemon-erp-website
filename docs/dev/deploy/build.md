---
order: 1
---

# 打包

后端打包为一个可执行 jar，前端构建为静态文件，两者分别部署。

## 后端

在项目根目录执行：

```bash
./gradlew build
```

输出 `lemon-admin/build/libs/lemon-erp.jar`（Spring Boot 可执行 jar，包含全部业务模块、依赖和配置文件）。`lemon-admin` 中普通 jar 任务已关闭，只生成这一个 jar。

只需要 jar 时：

```bash
./gradlew :lemon-admin:bootJar
```

说明：

- 构建使用 Java 17 Toolchain，构建机需要安装 JDK 17；首次构建会下载 Gradle 9.7.1 和依赖，需要能访问 Maven Central（或在 `~/.gradle/init.gradle` 中配置镜像仓库）；
- 编译参数带 `-parameters`（Spring MVC 依赖方法参数名），不要在 IDE 中用不带该参数的方式单独编译打包；
- 版本号在 `gradle/build-logic/src/main/groovy/lemon.java-conventions.gradle` 中（`version = '0.0.1-SNAPSHOT'`），jar 文件名固定为 `lemon-erp.jar`。

配置文件 `application.yml`、`application-dev.yml`、`application-prod.yml` 都打包在 jar 中，部署时通过 `--spring.profiles.active=prod` 和环境变量提供生产配置，不需要修改 jar。也可以在 jar 同目录放置 `application-prod.yml` 或 `config/application-prod.yml` 覆盖（Spring Boot 外部配置的标准做法）。

## 前端

```bash
cd lemon-web
npm ci            # 按 package-lock.json 安装依赖（首次或依赖变化时）
npm run build
```

输出 `lemon-web/dist`：

```
dist
├── index.html
├── favicon.svg ...
└── assets          带内容哈希的 JS、CSS（vue、antd、echarts、vendor 等分包）
```

- 构建需要 Node.js 20.19 及以上（或 22.12 及以上）；
- 第三方库拆分为独立的 chunk（`vue`、`antd`、`echarts`、`vendor`），图表库只在用到的页面加载；
- 前端请求的接口地址固定为相对路径 `/api`，部署时由 Nginx 转发，不需要按环境修改；
- 打印单据上的默认公司名称可以在构建时指定：`VITE_COMPANY_NAME=某某公司 npm run build`（未开启 SaaS、也没有在打印模板中设置公司名称时使用）；
- 路由使用 HTML5 History 模式，部署在域名根路径下，Nginx 需要把未知路径回退到 `index.html`。

## 产物清单

| 产物 | 部署位置 |
| --- | --- |
| `lemon-admin/build/libs/lemon-erp.jar` | 后端服务器，如 `/opt/lemon-erp/lemon-erp.jar` |
| `lemon-web/dist/` | Nginx 静态目录，如 `/opt/lemon-erp/web/` |
| `sql/init.sql` | 首次部署时初始化数据库 |

## 首次部署初始化数据库

```bash
mysql -uroot -p -e "CREATE DATABASE lemon_erp DEFAULT CHARSET utf8mb4"
mysql -uroot -p lemon_erp < sql/init.sql
```

`init.sql` 会删除并重建全部业务表，只在首次部署时执行。Flowable 的 `ACT_*` 表由后端首次启动时自动创建。

建议为应用创建单独的数据库账号：

```sql
CREATE USER 'lemon'@'%' IDENTIFIED BY '强密码';
GRANT ALL PRIVILEGES ON lemon_erp.* TO 'lemon'@'%';
```

应用账号需要建表、改表权限（Flowable 启动时自动创建和升级引擎表）。
