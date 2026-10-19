---
order: 3
---

# 目录结构

柠檬ERP 是 Gradle 多模块项目，Java 包名与模块一一对应：`com.lemon.erp.common`、`com.lemon.erp.framework`、`com.lemon.erp.modules.<模块>`。

## 仓库目录

```
lemon-erp
├── settings.gradle             模块清单（include 各模块）
├── gradle
│   ├── libs.versions.toml      依赖版本目录，各模块通过 libs.xxx 引用
│   ├── build-logic             构建约定插件 lemon.java-conventions
│   └── wrapper                 Gradle Wrapper
├── lemon-common                通用层：与业务无关，可被任何模块引用
├── lemon-framework             框架层：基础设施与模块间契约，不依赖任何业务模块
├── lemon-modules               业务模块
│   ├── lemon-system            系统管理：登录认证、用户、部门、角色、菜单、字典（系统字典 / 业务字典）、租户、参数、业务参数、自定义字段、编码规则、打印（JasperReports）、消息、附件、第三方集成（钉钉 / 企业微信 / 飞书）
│   ├── lemon-monitor           系统监控：在线用户、操作日志、登录日志、服务监控、缓存监控
│   ├── lemon-workflow          流程中心：Flowable 集成、流程模型、发起与审批、抄送
│   ├── lemon-dashboard         首页工作台
│   ├── lemon-wms               仓库管理：仓库、库位、物料、出入库 / 调拨 / 盘点、库存、批次与序列号、单据编号
│   ├── lemon-scm               供应链：供应商、客户、请购询价报价、采购 / 销售、发货、物流发运、门户
│   ├── lemon-mes               生产制造：BOM、生产计划、MRP、工单、设备；质量管理（Qms*）
│   ├── lemon-fin               财务：科目、凭证、账簿报表、应收应付、资金、资产、成本、预算、结账
│   ├── lemon-hr                人力资源：员工、招聘培训、考勤、请假、薪酬、绩效、员工自助
│   ├── lemon-crm               客户关系：客户、线索、商机、跟进、合同、市场活动、服务工单
│   ├── lemon-pm                项目管理：项目、WBS 计划、工时、成本、项目核算
│   └── lemon-bi                商务智能：数据仓库 ETL、多维分析、报表与仪表盘、驾驶舱、数据大屏与投屏链接、决策支持
├── lemon-admin                 启动模块：组装全部业务模块，打包为 lemon-erp.jar
├── lemon-web                   前端（Vite + Vue 3 + Ant Design Vue）
├── lemon-mp                    微信小程序（uni-app + Vue 3）：审批、员工自助、销售外勤、扫码作业
├── scripts
│   └── check_i18n.py           后端国际化检查（资源包、消息键、残留中文）
└── sql
    └── init.sql                建表 + 初始数据（MySQL）
```

质量管理（顶部导航「质量」，路由 `/qms/*`）没有单独的 Gradle 模块，代码在 `lemon-mes` 中，类名以 `Qms` 开头。

## 构建配置

| 文件 | 内容 |
| --- | --- |
| `settings.gradle` | 通过 `includeBuild('gradle/build-logic')` 引入约定插件；登记 `lemon-common`、`lemon-framework`、各业务模块和 `lemon-admin` |
| `gradle/libs.versions.toml` | 依赖版本只写在这里（Spring Boot、MyBatis-Plus、JJWT、ip2region、OSHI、Flowable） |
| `gradle/build-logic/src/main/groovy/lemon.java-conventions.gradle` | 公共约定：`java-library`、Java 17 Toolchain、Spring Boot BOM、Lombok、UTF-8 编码、`-parameters` 编译参数、JUnit 5 |
| 各模块 `build.gradle` | 应用 `id 'lemon.java-conventions'`，用 `api project(...)` 声明模块依赖 |
| `lemon-admin/build.gradle` | 依赖全部业务模块和 MySQL 驱动；`bootRun` 工作目录为项目根目录；`bootJar` 输出 `lemon-erp.jar`，普通 jar 任务关闭 |

## 通用层 lemon-common

```
com.lemon.erp.common
├── base          BaseEntity（id、createTime、updateTime）、TreeEntity（parentId、sort、children）
├── dto           StatusRequest（启用 / 停用请求体）
├── enums         EnableStatus（启用 / 停用，存储与 JSON 为 1 / 0）
├── exception     BizException（消息键 + 参数）、InvalidEnumValueException、GlobalExceptionHandler
├── i18n          Messages：自动发现各模块的消息资源包，按请求语言取消息
├── result        R（统一返回）、PageResult（分页结果）
├── util          Decimals（金额、数量的判空、求和、精度）、ServletUtils（请求、客户端 IP）、UserAgentUtils、TreeUtils
└── validation    校验分组 Create、Update
```

## 框架层 lemon-framework

```
com.lemon.erp.framework
├── cache         CacheService 及 Redis / 内存两种实现
├── code          DocNoCatalog：模块声明的单据编号类型
├── config        MyBatis-Plus（含自动填充制单人的 CreateByInnerInterceptor）、Security、JWT、Jackson、异步 / 定时 / 重试、上传目录、静态资源映射；I18nConfig（messageSource、按 Accept-Language 解析语言）
├── data          单据开发公共组件：StatusTransitions（按原状态条件流转）、DetailLines（明细行整体替换）、Queries（只取前几条）
├── demo          演示模式：DemoProperties、DemoModeInterceptor（只读拦截）
├── dict          DictLookup：按当前租户校验业务字典的取值（由系统模块实现）
├── excel         Excel 导入：ImportExecutor、ImportRequest、ImportResult
├── file          FileStorageService：头像等公开文件、业务附件的本地存储
├── finance       ExchangeRateProvider、PartnerBalanceProvider（由财务模块实现）
├── ip            IpLocationService（ip2region 离线库）
├── job           JobHandler、JobParams：定时任务契约
├── log           @OperLog、OperLogAspect、OperLogEvent、LoginLogEvent
├── message       MessageSender、MessageCategory：站内消息契约与消息类别
├── org           员工离职 / 调岗事件、人工成本、开通账号、UserLookup（查询登录账号）等组织相关契约
├── period        BizPeriodGuard：会计期间锁
├── portal        PortalKind、PortalFeatures、PortalAccounts：供应商 / 经销商门户
├── quality       SupplierQualityProvider：供应商质量统计
├── record        RecordTypeProvider、ChangeLogger：附件与字段变更历史
├── ref           ReferenceChecker、ReferenceGuard：主数据删除前的引用检查
├── rule          BizRule、BizRuleProvider、BizRules：按租户的业务参数
├── security      JWT 过滤器、TokenService 会话、LoginUser、@ss 权限判断
│   └── datascope @DataPermission 数据权限，DataScopes（按数据权限读取单条数据）
├── setting       Setting 系统参数定义、SettingService
├── tenant        TenantContext、TenantProperties、TenantInitializer、PlatformFeatures
├── todo          TodoProvider：首页待办契约
└── workflow      FlowApi、FlowBusiness、FlowFinishedEvent 等工作流契约，ApprovalFlow、ApprovalSupport（单据提交审批），ApproveStatus
```

`resources/ip2region/ip2region_v4.xdb` 是 IP 归属地离线库。`lemon-common`、`lemon-framework` 和每个业务模块的 `src/main/resources/i18n/` 下都有本模块的消息资源包（如 `common.properties` / `common_en.properties`、`framework.properties` / `framework_en.properties`），见 [国际化](../guide/i18n)。

## 业务模块内部结构

每个业务模块的结构相同（以 scm 为例）：

```
lemon-modules/lemon-scm
├── build.gradle
└── src/main
    ├── java/com/lemon/erp/modules/scm
    │   ├── controller      接口，路径以模块名开头（/scm/...），门户接口在 /portal、/dealer 下
    │   ├── service         业务逻辑；另有 ScmDocNos（单据编号）、ScmFlowBusinesses（审批流程）、ScmBizRules（业务参数）等声明类；
    │   │                   大的 Service 按职责拆成多个类（如 ScmOrderAssembler、ScmOrderPricingService），纯计算规则写成不依赖
    │   │                   Spring 的类（如 CreditRules、PromotionCalculator），较大的功能可以建子包（如 fin/service/cost）
    │   ├── mapper          MyBatis-Plus Mapper 接口，由 @MapperScan("com.lemon.erp.modules.*.mapper") 扫描
    │   ├── entity          实体（继承 BaseEntity，@TableName）
    │   ├── dto             请求体、查询结果和接口返回结构（record 或带 setter 的类，不用 Map），一组相关的放在
    │   │                   XxxViews / XxxRequests 中（如 ScmPriceViews、SrmRequests）
    │   ├── model           枚举（文件名与枚举同名，与系统字典对应）、业务字典的内置取值常量、数据权限规则、本模块内的事件
    │   └── event           本模块发布的领域事件
    └── resources
        ├── mapper/scm      mapper XML（自定义 SQL 只写在这里）
        └── i18n            消息资源包：scm.properties（默认，简体中文）、scm_en.properties（英文）
```

## 启动模块 lemon-admin

```
lemon-admin/src/main
├── java/com/lemon/erp/LemonErpApplication.java   @SpringBootApplication、@ConfigurationPropertiesScan、@MapperScan
└── resources
    ├── application.yml        公共配置
    ├── application-dev.yml    开发环境（默认）
    └── application-prod.yml   生产环境（全部取环境变量）
```

## 前端 lemon-web

```
lemon-web
├── index.html
├── vite.config.js              开发端口 5173、/api 代理、构建分包
├── public                      favicon 等静态资源
├── scripts/check-i18n.mjs      前端多语言检查（npm run i18n:check）
├── scripts/gen-enums.mjs       由后端枚举生成 src/constants/enums.js（npm run gen:enums，--check 只检查）
└── src
    ├── main.js                 注册 vue-i18n、Pinia、Router、Ant Design Vue、v-perm 指令、全局错误处理；下拉框默认按内容宽度展开，
    │                           表格省略单元格的悬停提示（utils/ellipsisTitle.js）
    ├── App.vue                 按界面语言切换 Ant Design、dayjs 的语言包
    ├── style.css               全局样式与亮 / 暗主题 CSS 变量（--app-*）、table-page 等布局类
    ├── api/<模块>/*.js          接口封装，基于 utils/request.js
    ├── views/<模块>/<页面>/index.vue   页面，菜单的「组件路径」即相对 views 的路径（不含 .vue）
    │                           views/screen 数据大屏（静态路由 /screen/:key、免登录的 /screen-share/:token）
    ├── components              通用组件（TableToolbar、SearchForm、FormDrawer、SubPage、DictTag、
    │                           AttachmentPanel、ChangeLogPanel、ImportModal 等）与各模块的单据表单、详情
    │                           print/ 打印预览与套打设计器，common/ 单据明细行表格 LineItemsTable、自定义字段的表单与显示，
    │                           charts/ ECharts 封装，screen/ 数据大屏外壳、指标卡、面板、滚动列表
    ├── composables             useTable、useColumns、useFormDrawer、useDict、useAction（单条操作）、useLineItems（明细行）、useCustomFields
    ├── constants/enums.js      由后端枚举生成的状态、类型常量（不要手工修改）
    ├── directives/perm.js      按钮权限指令 v-perm
    ├── layout                  BasicLayout（顶部模块导航、侧边栏、多标签页）、MobileLayout（移动作业）
    ├── locales                 界面语言包：index.js（createI18n、语言列表、切换），zh-CN/、en-US/ 下按模块的
    │                           <模块>.js（common、layout、route、print 等通用文件），en-US/menu.js、dict.js 为菜单和字典的英文译文
    ├── router/index.js         静态路由 + 按菜单动态注册路由
    ├── store                   user（用户、权限、菜单）、config（公开配置）、dict（字典缓存）、app（主题等）
    └── utils                   request、number（金额、数量的格式化与舍入）、print（提交后端生成 PDF）、printTemplates（打印模板目录与套用）、
                                labels（条码标签）、excel、dict、format、ellipsisTitle 等工具
```

## 小程序 lemon-mp

```
lemon-mp
├── package.json                dev:mp-weixin、build:mp-weixin、dev:h5、i18n:check
├── vite.config.js              uni 插件、H5 调试代理、@web 别名（指向 ../lemon-web/src，共用枚举常量与字典英文译文）
├── .env.example                VITE_API_BASE（后端接口地址，含 /api）
├── scripts/check-i18n.mjs      多语言检查
└── src
    ├── manifest.json           应用名称、mp-weixin.appid
    ├── pages.json              页面与分包、底部导航、easycom（l-* 组件自动引入）
    ├── pages                   主包：工作台、审批、消息、我的、登录、修改密码
    ├── pkg-approval、pkg-hr、pkg-pm、pkg-crm、pkg-wms、pkg-mes   按功能区的分包
    ├── api/<区>.js              接口封装，基于 utils/request.js（uni.request）
    ├── config/entries          工作台入口登记：权限 perm / permAll、对应的 Web 端路由 links
    ├── components/l-*          通用组件：l-card、l-cell、l-field、l-tag、l-empty、l-load-more、l-segmented、l-scan-input
    ├── composables             usePaged（下拉刷新 + 触底加载）、useAction（runAction、scanCode、vibrate）、useTitle
    ├── locales                 最小多语言实现 index.js，zh-CN/、en-US/ 下按区的语言包
    ├── store                   user（当前用户、hasPerm）、dict（字典缓存）
    └── utils                   request、auth、session、subscribe（订阅消息）、tabbar、format
```

详见 [微信小程序开发](../guide/miniapp)。

## 数据库脚本

`sql/init.sql` 用 `-- ------ 模块名` 注释分段：前半部分先删除再按模块建表（系统、工作流、仓库、供应链、生产、财务、质量、人力、客户、项目、商务智能），后半部分按模块插入菜单与按钮权限、字典、内置角色授权、示例数据和内置流程模型，末尾是后续功能追加的段落。新增表、菜单、字典时在对应模块的段落中追加，并保证脚本在 MySQL 8 上可以完整执行。
