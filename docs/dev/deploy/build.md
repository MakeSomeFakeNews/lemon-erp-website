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
- 单据打印依赖的 JasperReports 7.0.8、OpenPDF 1.3.43、ECJ 3.40.0 都从 Maven Central 下载（版本见 `gradle/libs.versions.toml`）：`jasperreports-pdf` 依赖的 OpenPDF 定制版只在 Jaspersoft 的私有仓库中，`lemon-system/build.gradle` 中已排除它并改用 Maven Central 上的 OpenPDF；`jasperreports-jdt` 自带的 ECJ 版本过旧、不支持 Java 17，另外引入了新版 ECJ。配置镜像仓库时不需要额外添加 Jaspersoft 仓库；
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
└── assets          带内容哈希的 JS、CSS（vue、antd、icons-core、echarts、vendor 等分包）
```

- 构建需要 Node.js 20.19 及以上（或 22.12 及以上）；
- 第三方库按 `vite.config.js` 的 `manualChunks` 拆分为独立的 chunk，便于浏览器长期缓存：`vue`（Vue、Vue Router、Pinia）、`antd`（Ant Design Vue、Day.js）、`icons-core`（图标基础组件及其依赖的颜色库）、`echarts`（只在用到图表的页面加载）、`vendor`（其他）；
- 图标库（`@ant-design/icons-vue`、`@ant-design/icons-svg`）不放入手动 chunk（`onlyExplicitManualChunks: true`），由 Rollup 按页面的实际引用拆分，避免全量图标进入首屏；图标基础组件和 `@ant-design/colors`、`@ctrl/tinycolor` 单独放在 `icons-core` 中——放进 `antd` 会与图标 chunk 形成循环引用，生产环境加载时颜色常量尚未初始化而报错。调整分包规则后要用 `npm run build` + `npm run preview` 检查生产构建，开发服务器不分包、发现不了这类问题；
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
