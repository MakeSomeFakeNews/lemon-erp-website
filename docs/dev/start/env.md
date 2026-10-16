---
order: 1
---

# 环境准备

本页列出开发柠檬ERP 需要安装的软件及推荐配置。

## 软件要求

| 软件 | 开发环境 | 服务器环境 | 说明 |
| --- | --- | --- | --- |
| JDK | 17 | JRE 17 | 构建约定插件用 Gradle Toolchain 固定为 Java 17 |
| MySQL | 8.0 及以上 | 8.0 及以上 | 业务表与 Flowable 引擎表都在同一个库中 |
| Redis | 6.2 及以上 | 6.2 及以上 | 存放登录会话、权限、字典、参数缓存 |
| Node.js | 20.19 及以上（或 22.12 及以上） | 不需要 | 只用于前端开发和构建，Vite 7 要求此版本 |
| Nginx | 不需要 | 1.20 及以上 | 托管前端静态文件并反向代理 `/api` |
| IDE | IntelliJ IDEA 2025 及以上 | - | 也可以使用其他支持 Gradle 的 IDE |

Gradle 不需要单独安装，项目根目录的 `gradlew` / `gradlew.bat` 会自动下载 Gradle 9.7.1。

## JDK 17

推荐使用 Eclipse Temurin 17 或其他 OpenJDK 17 发行版。安装后确认：

```bash
java -version   # 输出 17.x
```

`lemon.java-conventions` 插件通过 Gradle Toolchain 指定 Java 17：本机默认 JDK 不是 17 时，Gradle 会在已安装的 JDK 中查找 17，找不到时构建失败。可以把 `JAVA_HOME` 指向 JDK 17，或在 `~/.gradle/gradle.properties` 中通过 `org.gradle.java.installations.paths` 指定 JDK 17 的安装目录。

## MySQL 8

建议使用 MySQL 8.0 及以上版本，字符集 `utf8mb4`。`init.sql` 中每张表都显式声明了 `DEFAULT CHARSET = utf8mb4`，建库时也指定 `utf8mb4` 即可：

```sql
CREATE DATABASE lemon_erp DEFAULT CHARSET utf8mb4;
```

dev 环境默认连接 `localhost:3306/lemon_erp`，用户名 `root`、密码 `root`。本机账号密码不同时，启动时用环境变量覆盖即可（见 [本地运行](./run)），不需要修改配置文件。

::: warning 数据库账号需要建表权限
Flowable 在启动时会自动创建、升级 `ACT_` 开头的引擎表（`flowable.database-schema-update: true`），连接数据库的账号需要 CREATE、ALTER、INDEX 等 DDL 权限。
:::

## Redis

本机安装 Redis 6.2 及以上版本并启动，默认连接 `localhost:6379`、无密码、0 号库。可用环境变量 `REDIS_HOST`、`REDIS_PORT`、`REDIS_PASSWORD`、`REDIS_DATABASE` 覆盖。

::: tip 本机 Redis 与其他项目共用时
柠檬ERP 使用的缓存键都带有固定前缀（`login:token:`、`login:perms:`、`dict:`、`login:fail:`、`login:captcha:`、`settings:all`），清理时按前缀删除即可，不要执行 `FLUSHDB` / `FLUSHALL`。也可以用 `REDIS_DATABASE` 指定一个单独的库。
:::

只想在本机快速体验、不想安装 Redis 时，可以把 `lemon.cache.type` 设为 `memory`（进程内缓存，见 [配置说明](./config)）。注意 Spring Data Redis 的自动配置仍然存在，但不会实际连接 Redis。内存缓存不支持多实例部署，重启后所有用户需要重新登录。

## Node.js

前端使用 Vite 7，需要 Node.js 20.19 及以上或 22.12 及以上。推荐使用 nvm、fnm 等版本管理工具安装：

```bash
node -v   # v20.19.0 及以上
npm -v
```

依赖安装慢时可以配置 npm 镜像：`npm config set registry https://registry.npmmirror.com`。

## IntelliJ IDEA 配置

1. **导入项目**：「File → Open」选择项目根目录（包含 `settings.gradle` 的目录），IDEA 会识别为 Gradle 项目并自动导入全部模块。
2. **Gradle JDK**：「Settings → Build, Execution, Deployment → Build Tools → Gradle」，「Gradle JVM」选择 JDK 17；「Build and run using」和「Run tests using」保持默认的 Gradle。用 Gradle 构建可以保证编译参数 `-parameters` 生效（Spring MVC 的 `@PathVariable`、`@RequestParam` 依赖方法参数名）。
3. **项目 SDK**：「File → Project Structure → Project」，SDK 选择 JDK 17，Language level 为 17。
4. **Lombok**：IDEA 已内置 Lombok 插件；首次打开时如提示，启用「Annotation Processing」（「Settings → Build, Execution, Deployment → Compiler → Annotation Processors」勾选 Enable annotation processing）。
5. **文件编码**：「Settings → Editor → File Encodings」全部设为 UTF-8（源码、mapper XML、`init.sql` 都包含中文）。
6. **运行配置**：可以直接运行 `lemon-admin` 模块中的 `com.lemon.erp.LemonErpApplication`。建议把 Working directory 设为项目根目录，这样上传目录 `./uploads`、`./attachments` 与 `./gradlew bootRun` 时一致（都在项目根目录下，已加入 `.gitignore`）。需要覆盖数据库密码等配置时，在运行配置的 Environment variables 中填写，如 `DB_PASSWORD=123456`。
7. **前端**：IDEA Ultimate 可以直接打开 `lemon-web` 目录开发；也可以使用 VS Code 配合 Vue 官方插件（Vue - Official）。

::: tip 编译零警告
项目约定编译保持零警告。新增代码出现 javac 警告（未检查的类型转换、过时 API 等）时请一并处理。
:::

## 下一步

环境准备好后，按 [本地运行](./run) 初始化数据库并启动前后端。
