# 项目介绍

柠檬ERP 是一套面向中小制造、商贸企业的全功能开源 ERP，前后端分离，后端为 Gradle 多模块的 Spring Boot 应用，前端为 Vite + Vue 3 + Ant Design Vue 单页应用。本开发文档面向需要部署、二次开发或基于柠檬ERP 交付项目的程序员。

业务功能的使用方法见 [用户手册](/manual/guide/)，本文档只介绍技术实现与开发约定。

## 技术栈

| 端 | 分类 | 技术 | 版本 |
| --- | --- | --- | --- |
| 后端 | 语言 | Java | 17 |
| 后端 | 框架 | Spring Boot（Spring Framework 7、Spring Security） | 4.1.1 |
| 后端 | 持久层 | MyBatis-Plus（分页、多租户、数据权限插件） | 3.5.17 |
| 后端 | 工作流 | Flowable（只启用 BPMN 流程引擎） | 8.0.0 |
| 后端 | 认证 | JJWT | 0.12.6 |
| 后端 | 缓存 | Redis（可切换为进程内缓存） | 6.2 及以上 |
| 后端 | 数据库 | MySQL | 8.0 及以上 |
| 后端 | 单据打印 | JasperReports（生成 PDF；PDF 导出使用 OpenPDF，报表表达式用 Eclipse ECJ 编译） | 7.0.8（OpenPDF 1.3.43、ECJ 3.40.0） |
| 后端 | 其他 | ip2region（IP 归属地离线库）、OSHI（服务器监控） | 3.3.7、6.12.0 |
| 后端 | 构建 | Gradle（项目自带 Wrapper） | 9.7.1 |
| 前端 | 框架 | Vue、Vue Router、Pinia | 3.5、4.5、3.0 |
| 前端 | 构建 | Vite | 7 |
| 前端 | UI 组件 | Ant Design Vue、@ant-design/icons-vue | 4.2、7.0 |
| 前端 | 国际化 | vue-i18n（Composition API 模式；后端为 Spring `MessageSource` 资源包） | 11.4 |
| 前端 | 其他 | Axios、ECharts、Day.js、ExcelJS、JsBarcode、qrcode | - |

后端依赖版本统一维护在 `gradle/libs.versions.toml`，前端依赖见 `lemon-web/package.json`。

::: tip Spring Boot 4 的变化
Spring Boot 4 默认使用 Jackson 3，`ObjectMapper` 等类位于 `tools.jackson.databind` 包；注解（`@JsonFormat`、`@JsonProperty` 等）仍然是 `com.fasterxml.jackson.annotation`。二次开发时注意导入正确的包。
:::

## 架构总览

![柠檬ERP 技术架构图](/images/arch/tech.png)

| 层次 | 内容 |
| --- | --- |
| 前端 `lemon-web` | 登录后按菜单动态注册路由；请求统一走 `/api`，由拦截器处理统一返回结构 |
| 启动模块 `lemon-admin` | 启动类 `LemonErpApplication`、`application*.yml`，组装全部业务模块并打包为 `lemon-erp.jar` |
| 业务模块 `lemon-modules/*` | system、monitor、workflow、dashboard、wms、scm、mes、fin、hr、crm、pm、bi，每个模块包含自己的 Controller、Service、Mapper 和 mapper XML |
| 框架层 `lemon-framework` | 安全认证、数据权限、多租户、缓存、日志、文件、Excel 导入、定时任务契约、演示模式、业务参数契约，以及业务模块之间的契约接口和事件 |
| 通用层 `lemon-common` | 统一返回 `R`、业务异常、全局异常处理、实体基类、校验分组、工具类 |
| 基础设施 | MySQL（业务表 + Flowable 的 `ACT_*` 表）、Redis（会话、权限、字典、参数缓存）、本地磁盘（头像、业务附件） |

一次请求的处理过程：

1. 浏览器请求 `/api/...`，开发环境由 Vite 代理、生产环境由 Nginx 转发到后端 8080 端口（后端 context-path 为 `/api`）。
2. `JwtAuthenticationFilter` 解析 `Authorization: Bearer` 中的 JWT，校验服务端会话仍然存在，按会话设置当前租户，加载（带缓存的）登录用户放入 `SecurityContext`。
3. Controller 方法上的 `@PreAuthorize("@ss.hasPerm('...')")` 校验接口权限，`@OperLog` 记录操作日志。
4. Service 中的查询经过 MyBatis-Plus 拦截器链：租户条件 → 数据权限条件 → 分页（单页上限 500）→ 防全表更新删除。
5. 返回 `R<T>`（`code`、`msg`、`data`），异常由 `GlobalExceptionHandler` 统一转为 `R.fail`。

## 本章内容

| 页面 | 说明 |
| --- | --- |
| [环境准备](./env) | JDK 17、MySQL 8、Redis、Node、IntelliJ IDEA 配置 |
| [本地运行](./run) | 初始化数据库、启动后端和前端、默认账号 |
| [目录结构](./structure) | 仓库目录、后端模块内部结构、前端目录 |
| [配置说明](./config) | 多环境配置、全部 `lemon.*` 配置项与环境变量 |

阅读完本章后，建议继续阅读 [架构设计](../architecture/) 了解认证、权限、多租户、工作流等核心机制，再按 [开发指南](../guide/) 进行二次开发。

## 开源协议

柠檬ERP 基于 Apache-2.0 协议开源，个人与企业均可免费商用，使用时请保留原作者版权声明与许可证文件。源码地址：[github.com/MakeSomeFakeNews/lemon-erp](https://github.com/MakeSomeFakeNews/lemon-erp)。
