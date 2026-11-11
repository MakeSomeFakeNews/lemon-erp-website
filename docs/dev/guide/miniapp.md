---
order: 16
---

# 微信小程序开发

`lemon-mp` 是柠檬ERP 的微信小程序端，用 uni-app（Vue 3）开发、编译为微信小程序。它只放随时随地、操作轻、能用上手机能力（扫码、拍照、拨号、振动）的功能：审批、工作台与消息、员工自助、项目工时、销售外勤、扫码作业与报工、设备与质量。后端接口与 Web 端完全共用，权限、数据权限、多租户都由后端控制，小程序只是另一个前端。

本页说明项目结构、本地开发、配置、登录绑定与审批提醒的实现、新增一个功能入口的完整步骤，以及发布上线的注意事项。

## 功能取舍

| 放进小程序 | 留在电脑端 |
| --- | --- |
| 审批：待办 / 已办 / 我发起的 / 抄送我的，同意、拒绝、转交、撤回；发起申请（流程中心设计的表单）；审批提醒（微信订阅消息） | 系统配置：菜单、角色、字典、参数、租户、打印模板、编码规则、第三方集成 |
| 工作台（待办汇总、经营概览）、站内消息 | 流程设计器、表单设计、BI 多维分析、自定义报表、数据大屏 |
| 员工自助：打卡、考勤日历、假期余额、请假加班申请与撤销、工资条、绩效自评与评分；项目工时填报与审核 | 字段多、明细行多的单据录入：采购 / 销售订单（需审批，手机录入列为后续计划；订单出入库可用拣货、扫码收货）、BOM、工艺路线、凭证、工资表、MRP、成本核算、结账 |
| 销售与服务：客户、联系人拨号、写跟进（拍照）、今日待跟进、线索录入与转化、商机推进、服务工单受理与处理、销售订单进度、快速开单（销售出库直接开单）；商品速查（库存与按个人设置显示的一种价格，价格按权限由后端过滤；点击看图片、库存分布、售价 / 进价历史，长按更多）；单据草稿（销售出库、采购入库草稿的审核记账、删除）；保存并审核后打印 / 分享 PDF（后端生成 PDF，用其他应用打开打印或转发） | Excel 导入导出、供应商 / 经销商门户、套打与打印模板设计 |
| 仓储生产：库存查询（均价、库存金额）与经营历史、扫码收货、快速入库（采购入库直接开单：扫码选商品、辅助单位、默认进价、批次与有效期、序列号、库位推荐）、上架、拣货、盘点（盘盈成本价）、生产报工 | 工单指派、配件领用、不合格品评审处置、检验方案维护 |
| 设备与质量：设备台账（扫码）、保养维修登记与处理、检验录入、不合格品登记 | |

新增功能时按同样的原则取舍：需要大屏幕、大量录入、复杂配置的留在 Web 端；小程序中遇到这类操作时提示「请在电脑端处理」。

各功能区使用的后端接口与入口权限：

| 功能区 | 后端接口 | 入口权限 |
| --- | --- | --- |
| 审批 | `/workflow/task/*`、`/workflow/instance/*`、`/workflow/copy`、`/workflow/start/*`、`/workflow/identity/users` | `wf:task:todo` / `wf:task:done` / `wf:instance:mine` / `wf:copy:list` 任一；发起 `wf:start:list` |
| 工作台、消息 | `/dashboard/business`、`/dashboard/todos`、`/system/message/*` | 登录即可 |
| 通知公告（`pkg-notice`：工作台入口、消息页未读公告提示、列表与详情，正文用 `rich-text` 显示，附件下载后打开） | `/system/notice/my*`、`/system/attachment` | 登录即可 |
| 员工自助 | `/hr/self/*`、`/hr/perf/appraisal/{id}` | 登录即可（需关联员工档案） |
| 项目工时 | `/pm/my/timesheet`、`/pm/my/timesheet/tasks`、`/pm/my/tasks`、`/pm/timesheet`、`/pm/timesheet/review` | 填报登录即可（须为项目成员）：选择任务用 `GET /pm/my/timesheet/tasks?projectId=`（本人参与的项目的任务树，不需要项目权限，读取失败时改用 `/pm/my/tasks`）；审核 `pm:timesheet:list`，「待审批」分段请求 `/pm/timesheet` 时带 `excludeSelf=true`（不列出本人的工时，与 Web 端工时审批一致） |
| 销售与服务 | `/crm/*`、`/scm/sales/order`、`/bi/trace/order/sales/{id}`、`/system/attachment/*` | `crm:customer:list`、`crm:followup:list`、`crm:lead:list`、`crm:opp:list`、`crm:ticket:list`、`scm:sales:list` |
| 商品速查 | `/scm/quick-lookup/*`、`/profile/settings/quickLookup`、`POST /wms/material/images/urls`、`/scm/pricing/reference` | `scm:quickLookup:list` |
| 单据草稿 | `/scm/{salesOut,purchaseIn}/drafts/*` | `scm:salesOut:list` / `scm:purchaseIn:list`（且业务参数 `scm.tradeDoc.draft` 开启），审核 `scm:{kind}:post`、删除 `scm:{kind}:add` |
| 快速开单 | `/scm/customer/options`、`/wms/material/options`、`/wms/material/{id}/units`、`/scm/pricing/default`、`/scm/pricing/reference`、`/scm/promotion/preview`、`/wms/stock`、`/fin/account/options`、`/fin/account/scopes`、`/scm/supplier/carrier-options`（运费）、`POST /scm/salesOut`（业务参数 `scm.tradeDoc.draft` 开启时可 `POST /scm/salesOut/drafts` 存草稿，见[手机开单的保存、草稿与打印](#手机开单的保存、草稿与打印)）、`/system/biz-rule/values` | `scm:salesOut:add`，且业务参数 `scm.directDoc.enabled` 开启 |
| 扫码作业 | `/wms/*`（含经营历史 `/wms/stock/history`）、`/scm/purchaseIn`（扫码收货、快速入库；`scm.tradeDoc.draft` 开启时可存草稿 `/scm/purchaseIn/drafts`）、`/scm/supplier/options`（快速入库选供应商）、`/scm/delivery/*`、`/mes/wo/*` | `wms:stock:list`、`scm:purchaseIn:add`（快速入库还要业务参数 `scm.directDoc.enabled` 开启）、`wms:transfer:add`、`scm:delivery:pick`、`wms:check:edit`、`mes:wo:report` + `mes:wo:list` |
| 设备与质量 | `/mes/equipment`、`/mes/maintenance/*`、`/mes/inspection/*`、`/qms/plan/match`、`/qms/ncr` | `mes:equipment:list`、`mes:maintain:list`、`mes:qc:list`、`qms:ncr:list` |

为小程序补充的后端能力：

- 跟进记录登记为可挂附件的业务类型 `crm_followup`（`CrmRecordTypes`，用于现场照片）：查看权限与跟进列表一致（`crm:followup:list`、`crm:customer:list`、`crm:lead:list`、`crm:opp:list` 任一），上传需要 `crm:followup:add`，按跟进人、部门做数据权限。
- `POST /system/attachment/batch?bizType=`：请求体为记录 ID 列表，按记录分组返回附件信息（不含文件内容），用于列表中的缩略图，见 [文件与附件](../architecture/file)。
- 销售 / 采购订单查询参数 `partnerName`：按往来单位名称或编码搜索。
- 物料主图：物料下拉、库存查询返回 `imageUrl`（公开文件地址），库存查询、快速开单的商品搜索显示缩略图（`utils/request.js` 的 `fileUrl` 转为完整地址，库存查询点击用 `uni.previewImage` 查看大图）；库存明细显示批次的生产日期。见 [物料资料与批次管理](./material#商品图片)。

## 技术栈与项目结构

| 分类 | 技术 | 版本 |
| --- | --- | --- |
| 框架 | uni-app（`@dcloudio/*`，Vite 插件 `@dcloudio/vite-plugin-uni`） | 3.0.0-5020620260917001 |
| 视图 | Vue（`<script setup>` 组合式 API） | 3.4.21 |
| 构建 | Vite、Sass | 5.2.8、1.77.8 |
| 目标平台 | 微信小程序（`mp-weixin`）；H5 只用于浏览器调试 | - |

小程序没有引入 UI 组件库、状态管理库和 vue-i18n，界面由自带的 `l-*` 组件和全局样式组成，状态用 `reactive` 模块，多语言是一个最小实现（见下文）。

```
lemon-mp
├── package.json                脚本：dev:mp-weixin、build:mp-weixin、dev:h5、build:h5、i18n:check
├── vite.config.js              uni 插件；H5 调试时 /api 代理；@web 别名指向 ../lemon-web/src
├── .env.example                VITE_API_BASE 示例，复制为 .env
├── project.config.json         微信开发者工具的项目配置
├── scripts/check-i18n.mjs      多语言检查（npm run i18n:check）
└── src
    ├── main.js                 createSSRApp，注册全局 $t
    ├── App.vue                 onLaunch：设置底部导航文字、加载订阅消息配置；全局样式（l-btn、l-footer、l-item、l-search 等）
    ├── manifest.json           应用名称、mp-weixin.appid、分包优化、H5 路由模式
    ├── pages.json              页面与分包、easycom 规则、底部导航、预下载
    ├── uni.scss                全局 SCSS 变量（$l-primary、$l-bg、$l-radius 等，与 Web 端主题色一致）
    ├── pages                   主包：工作台 index、审批 approval、消息 message、我的 mine（含修改密码 password）、登录 login
    ├── pkg-approval            分包：审批详情、发起申请
    ├── pkg-hr                  分包：打卡、考勤、请假加班、工资条、绩效
    ├── pkg-pm                  分包：我的工时、填报、工时审核
    ├── pkg-crm                 分包：客户、跟进、商机、销售订单、线索、服务工单（photos.js 跟进照片）
    ├── pkg-wms                 分包：库存、经营历史、快速开单、快速入库、商品速查、单据草稿、收货、上架、拣货、盘点、报工（mobile.js / mobile.scss 扫码作业公共逻辑；
    │                           sale/ 快速开单的明细行 SaleRow.vue、运费 SaleFreight.vue、lines.js、gifts.js；purchase/ 快速入库；lookup/ 商品速查（voice.js 语音）；
    │                           draft/ 单据草稿；tradeSave.js 保存方式；print.js 打印 / 分享 PDF；components/ 搜索弹层、价格参考弹层）
    ├── pkg-mes                 分包：设备、保养维修、质量检验、不合格品
    ├── pkg-notice              分包：通知公告列表、详情（markdown.js 正文转 rich-text）
    ├── api/<区>.js              接口封装：auth、workflow、dashboard、message、notice、hr、pm、crm、wms、mes
    ├── config/entries          工作台入口登记：index.js 汇总，<区>.js 每个功能区一个文件
    ├── components/l-*          通用组件（easycom 自动引入）
    ├── composables             usePaged、useAction（runAction、scanCode、vibrate）、useTitle
    ├── locales                 index.js 最小多语言实现；zh-CN/、en-US/ 下按区的 <区>.js
    ├── store                   user（当前用户、权限 hasPerm）、dict（字典缓存 useDict）、bizRules（前端可读的业务参数）
    ├── utils                   request（请求封装）、auth（令牌）、session（登录后处理、登录检查）、subscribe（订阅消息）、
    │                           tabbar（底部导航文字与未读角标）、format（金额、数量、时间格式化）
    └── static                  logo、底部导航图标 tab/、l-cell 使用的白色线条图标 icons/
```

主包只放底部导航的四个页面、登录和修改密码；每个功能区一个分包，首次进入时才下载，主包体积保持在微信的限制以内。`pages.json` 中给审批页配置了 `preloadRule`，进入审批页时预下载 `pkg-approval`。分包页面的地址带分包根目录，例如 `/pkg-crm/lead/index`。

## 本地开发

需要 Node.js（与 Web 端相同，20.19 及以上）和 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。

```bash
cd lemon-mp
npm install
cp .env.example .env         # 设置 VITE_API_BASE
npm run dev:mp-weixin        # 监听编译到 dist/dev/mp-weixin
```

在微信开发者工具中「导入项目」，目录选择 `lemon-mp/dist/dev/mp-weixin`，AppID 选择自己的小程序或测试号。源码修改后自动重新编译，开发者工具自动刷新。

| 命令 | 说明 |
| --- | --- |
| `npm run dev:mp-weixin` | 开发编译到 `dist/dev/mp-weixin`，用微信开发者工具打开 |
| `npm run build:mp-weixin` | 发布包 `dist/build/mp-weixin`（压缩），用于上传 |
| `npm run dev:h5` | 浏览器调试（没有微信登录，直接用账号密码登录） |
| `npm run build:h5` | 构建 H5 版本（只用于调试，不作为正式的移动端发布） |
| `npm run i18n:check` | 多语言检查，见下文「多语言」 |

### 接口地址

`.env` 中的 `VITE_API_BASE` 是后端接口地址，**包含 context-path `/api`**，在 `utils/request.js` 中读取（未设置时为 `http://localhost:8080/api`）：

```properties
# 后端接口地址（含 context-path /api）。小程序正式版必须是已在微信公众平台配置的 HTTPS 合法域名
VITE_API_BASE=http://localhost:8080/api
```

- 在开发者工具的模拟器中可以直接访问 `localhost`；`manifest.json` 中 `mp-weixin.setting.urlCheck` 为 `false`，开发版不校验合法域名（也可以在开发者工具「详情 → 本地设置」中勾选「不校验合法域名」）。
- 用手机「预览」或「真机调试」时，手机访问不到电脑上的 `localhost`，要改为电脑的局域网 IP（如 `http://192.168.1.10:8080/api`），并打开小程序右上角菜单中的「开发调试」。
- `.env` 已加入 `.gitignore`，修改后需要重新执行编译命令才生效。

### H5 调试

`npm run dev:h5` 在浏览器中运行，便于用浏览器开发者工具调试页面和接口。H5 中没有 `wx.login`，登录页直接显示账号密码表单并调用 `/auth/login`；订阅消息、解除绑定等微信专属功能不显示。

为避免跨域，H5 调试时把 `.env` 中的 `VITE_API_BASE` 改为 `/api`，开发服务器把 `/api` 代理到 `VITE_PROXY_TARGET`（默认 `http://localhost:8080`）：

```bash
# VITE_PROXY_TARGET 可以写在 .env 中（vite.config.js 用 loadEnv 读取），也可以在命令行中临时指定（命令行优先）
VITE_PROXY_TARGET=http://192.168.1.10:8080 npm run dev:h5
```

::: warning H5 只是调试手段
页面以微信小程序为准开发和测试。H5 与小程序的组件、API 存在差异（例如 `uni.scanCode` 在 H5 中不可用），在 H5 中能运行不代表小程序中没有问题，提交前务必在微信开发者工具和真机上验证。
:::

### 本地联调后端

小程序微信登录需要后端配置与开发者工具中相同 AppID 的 `LEMON_MINIAPP_APP_ID` / `LEMON_MINIAPP_APP_SECRET`，否则点击「微信登录」提示「未配置微信小程序」。只调试页面时可以不配置，用 H5 账号密码登录。

```bash
LEMON_MINIAPP_APP_ID=wx0123456789abcdef LEMON_MINIAPP_APP_SECRET=*** ./gradlew bootRun
```

## 配置

### 小程序端

| 位置 | 内容 |
| --- | --- |
| `.env` 的 `VITE_API_BASE` | 后端接口地址（含 `/api`），编译时写入代码。开发、体验、正式环境的地址不同时，按环境分别编译 |
| `src/manifest.json` 的 `mp-weixin.appid` | 小程序 AppID，与后端 `lemon.miniapp.app-id` 必须是同一个小程序 |
| `src/manifest.json` 的 `name`、`description`、`versionName` | 应用名称、描述、版本号 |
| `src/pages.json` | 页面、分包、底部导航、页面默认标题（中文） |
| `pages/mine/index.vue` 的 `VERSION` | 「我的」页底部显示的版本号，发版时与 `versionName` 一起修改 |

### 后端 lemon.miniapp

对应 `modules/system/miniapp/MiniappProperties`。一个小程序只有一个 AppID，SaaS 模式下所有租户共用同一个小程序，所以 AppID / AppSecret 是平台级的配置文件参数，不放在「系统管理 → 第三方集成」中按租户配置。

| 配置项 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `lemon.miniapp.app-id` | `LEMON_MINIAPP_APP_ID` | 空 | 小程序 AppID。与 `app-secret` 任一为空时不能用微信登录，也不推送订阅消息 |
| `lemon.miniapp.app-secret` | `LEMON_MINIAPP_APP_SECRET` | 空 | 小程序 AppSecret（公众平台「开发管理 → 开发设置」），只通过环境变量提供，不要提交到代码仓库 |
| `lemon.miniapp.api` | - | `https://api.weixin.qq.com` | 微信服务端接口地址，一般不修改（测试时可指向本地模拟服务） |
| `lemon.miniapp.subscribe.template-id` | `LEMON_MINIAPP_SUBSCRIBE_TEMPLATE_ID` | 空 | 审批提醒的订阅消息模板 ID，为空时不推送，小程序中也不申请授权 |
| `lemon.miniapp.subscribe.title-field` | - | `thing1` | 模板中「标题」对应的字段名 |
| `lemon.miniapp.subscribe.content-field` | - | `thing2` | 模板中「内容」对应的字段名 |
| `lemon.miniapp.subscribe.time-field` | - | `time3` | 模板中「时间」对应的字段名 |
| `lemon.miniapp.subscribe.categories` | - | `APPROVAL` | 推送的站内消息类别（`MessageCategory`：`APPROVAL`、`REMIND`、`ALERT`、`SYSTEM`），可配置多个 |
| `lemon.miniapp.subscribe.page` | - | `pages/approval/index` | 点击订阅消息打开的小程序页面 |
| `lemon.miniapp.subscribe.state` | - | `formal` | 打开的小程序版本：`formal` 正式版、`trial` 体验版、`developer` 开发版 |

`application.yml` 中的配置：

```yaml
lemon:
  # 微信小程序（lemon-mp）：所有租户共用一个小程序，AppID / AppSecret 在这里配置；为空时小程序不能用微信登录
  miniapp:
    app-id: ${LEMON_MINIAPP_APP_ID:}
    app-secret: ${LEMON_MINIAPP_APP_SECRET:}
    subscribe:
      template-id: ${LEMON_MINIAPP_SUBSCRIBE_TEMPLATE_ID:}
      # title-field: thing1
      # content-field: thing2
      # time-field: time3
```

没有列出环境变量的配置项，也可以按 Spring Boot 的规则用环境变量覆盖，例如 `LEMON_MINIAPP_SUBSCRIBE_STATE=trial`、`LEMON_MINIAPP_SUBSCRIBE_CATEGORIES=APPROVAL,REMIND`。全部配置项也列在 [配置说明](../start/config) 中。

### 订阅消息模板

1. 在微信公众平台「功能 → 订阅消息」中从公共模板库选用一个一次性订阅模板，例如「待办审批提醒」，关键词至少选择标题（`thing` 类型）、内容（`thing` 类型）和时间（`time` 类型）三项；
2. 在模板详情中查看模板 ID 和各关键词的字段名（如 `thing1`、`thing2`、`time3`）；
3. 后端配置 `LEMON_MINIAPP_SUBSCRIBE_TEMPLATE_ID`；字段名与默认值不同时，在 `application.yml` 中修改 `title-field`、`content-field`、`time-field`。

::: warning 字段类型
后端按 `thing` 类型的规则把标题、内容截断为 20 个字符，时间格式为 `yyyy-MM-dd HH:mm`。选用的模板中如果「标题」「内容」是其他类型的关键词（例如只允许 5 个汉字的 `phrase`），微信会返回参数错误，推送失败（只记日志），因此尽量选择这三个关键词都是 `thing` / `time` 的模板。
:::

## 登录与绑定

### 相关类与接口

| 类 | 位置 | 职责 |
| --- | --- | --- |
| `MiniappAuthController` | system/controller | `/auth/miniapp/*` 接口 |
| `SysMiniappAuthService` | system/service | 按 openid 查找绑定、选择租户、账号密码登录并绑定、解除绑定 |
| `WeChatMiniClient` | system/miniapp | 微信服务端接口：code2Session、access_token、发送订阅消息 |
| `MiniappProperties` | system/miniapp | 配置 `lemon.miniapp.*` |
| `SysMiniappUser` / `SysMiniappUserMapper` | system | 绑定关系表 `sys_miniapp_user` |
| `SysMiniappPushService` | system/service | 站内消息推送为订阅消息 |

| 接口 | 登录 | 说明 |
| --- | --- | --- |
| `GET /auth/miniapp/config` | 否 | 小程序公开配置 `{ subscribeTemplateIds }`：配置了模板时为一个元素的数组，否则为空数组 |
| `POST /auth/miniapp/login` | 否 | `{ code, switchAccount }`，`code` 为 `wx.login` 的结果 |
| `POST /auth/miniapp/choose` | 否 | `{ key, tenantId }`：绑定了多个租户的账号时选择租户登录 |
| `POST /auth/miniapp/bind` | 否 | `{ key, username, password, tenantName, captchaId, captchaCode }`：账号密码登录并绑定当前微信 |
| `POST /auth/miniapp/unbind` | 是 | 解除当前用户的微信绑定 |

`SecurityConfig` 中放行前四个接口，解除绑定需要登录：

```java
// 微信小程序登录（解除绑定需要登录）
.requestMatchers("/auth/miniapp/config", "/auth/miniapp/login", "/auth/miniapp/choose", "/auth/miniapp/bind").permitAll()
```

`login`、`choose`、`bind` 都返回 `MiniappLoginResult`：

```java
/** token 不为空时已登录；否则 key 为会话标识（10 分钟内有效），tenants 为空表示未绑定，不为空时选择租户 */
public record MiniappLoginResult(String token, boolean passwordExpired, String key, List<MiniappTenant> tenants) {
    /** @param name 租户名称，未开启 SaaS 模式时为空 */
    public record MiniappTenant(Long id, String name) { }
}
```

### 绑定关系

`sys_miniapp_user`（租户 + 用户 + openid）记录微信与系统用户的绑定，唯一约束为 `(openid, tenant_id)` 和 `(user_id, tenant_id)`：**每个租户中一个微信只绑定一个用户，一个用户只绑定一个微信**；SaaS 模式下同一个微信可以分别绑定不同租户的账号。

登录时还没有租户上下文，`SysMiniappUserMapper.selectByOpenid` 用 `@InterceptorIgnore(tenantLine = "true")` 跨租户按 openid 查询（SQL 写在 mapper XML 中）；其余读写（绑定、解绑、推送时按用户查询）都在当前租户下，由租户插件自动加条件。

### 登录流程

1. 小程序调用 `uni.login({ provider: 'weixin' })` 取得 `code`，提交 `POST /auth/miniapp/login`。
2. `WeChatMiniClient.openid(code)` 调用微信 `/sns/jscode2session` 换取 openid。**openid 只在服务端使用，不返回前端**；未配置 AppID / AppSecret 时提示「未配置微信小程序」，微信返回错误时提示错误码和信息。
3. 查找可登录的绑定（`candidates`）：按 openid 跨租户查出全部绑定，只保留租户可用（`SysTenantLookup.isActive`）、用户存在且启用、不是门户账号（`supplierId`、`customerId` 都为空）的。
4. 按结果分三种情况：

| 结果 | 后端 | 小程序 |
| --- | --- | --- |
| 只有一个可登录的绑定 | 设置该租户为当前租户，`AuthService.loginAs(user, "system.label.miniappLogin")` 签发令牌，登录日志记「微信小程序登录成功」 | 保存令牌，进入工作台 |
| 有多个（多个租户的账号） | 生成会话标识 `key`（`SecureRandom` 16 字节的十六进制），openid 缓存在 `mp:session:{key}` 下 10 分钟，返回 `key` 和可选租户 | 显示「选择租户」，调用 `/auth/miniapp/choose` |
| 没有 | 同上，返回 `key`，租户列表为空 | 显示账号密码表单，调用 `/auth/miniapp/bind` |

**选择租户**（`choose`）：按 `key` 取出 openid（过期时提示「登录已过期，请重新进入小程序」），在可登录的绑定中找到该租户的那一个并登录，然后删除会话标识；该微信没有绑定此租户的账号时提示「该微信没有绑定此租户的账号」。

**账号密码登录并绑定**（`bind`，`@Transactional`）：

1. 按 `key` 取出 openid；
2. `AuthService.authenticate(req.toLogin())` 做与 `/auth/login` 完全相同的校验：确定租户、锁定检查、验证码、用户名密码、账号状态，失败时累加失败次数并记录登录日志（见 [认证与会话](../architecture/auth#登录流程)）；
3. `AuthService.loginAs` 签发令牌（门户账号、停用账号在这里报错，不会绑定）；
4. 删除当前租户中该 openid 的绑定和该用户原有的绑定，插入新的绑定，即**替换**该微信在本租户的绑定和该用户原来绑定的微信；
5. 删除会话标识。

令牌与 Web 端完全相同（`TokenService.createToken`）：出现在「在线用户」中，退出、强制下线、停用、重置密码后立即失效，开启「同一账号只允许一处登录」时小程序登录会让 Web 端的会话下线。返回的 `passwordExpired` 为 true 时（初始密码、重置过的密码、密码过期），小程序登录后先进入修改密码页（`utils/session.js` 的 `afterLogin`）。

### 小程序端的处理

登录页 `pages/login/index.vue` 有三种状态（`mode`）：`wechat` 微信登录按钮、`choose` 选择租户、`form` 账号密码。

- 进入登录页时自动执行一次微信登录（`wechatLogin(false)`）；带参数 `switch=1` 进入时（退出登录、切换账号、解除绑定之后）不自动登录，避免刚退出又被自动登录。
- 账号密码表单按 `/auth/config` 显示租户输入框（SaaS 模式）和验证码（参数「登录验证码」），上次填写的租户名称保存在本地。
- 前端记录会话标识的获取时间，超过 9 分钟后提交表单前先用 `switchAccount: true` 重新登录取得新的 `key`，避免后端 10 分钟的有效期刚好过期。
- H5 调试时没有微信登录，直接调用 `/auth/login`。

令牌保存在 `uni.setStorageSync('lemon_mp_token')`，`utils/request.js` 给每个请求加 `Authorization: Bearer <令牌>` 和 `Accept-Language: <界面语言>`；接口返回 401 时清除令牌并 `reLaunch` 到登录页。各 tab 页的 `onShow` 中调用 `ensureLogin()`：没有令牌时进入登录页，有令牌但还没加载用户时请求 `/auth/info`。

### 切换账号与解除绑定

| 操作 | 位置 | 处理 |
| --- | --- | --- |
| 使用其他账号登录 | 登录页、选择租户页 | `POST /auth/miniapp/login` 传 `switchAccount: true`：即使已绑定也不自动登录，只返回会话标识，随后填写账号密码绑定。用于绑定另一个账号（如另一个租户的账号）；在选择租户页中点击时会话标识仍有效，直接显示表单 |
| 切换账号 | 「我的」 | 退出登录后进入 `login?switch=1`，绑定关系保留 |
| 解除微信绑定 | 「我的」 | 确认后调用 `/auth/miniapp/unbind`，删除当前用户在当前租户中的绑定，然后退出到登录页；下次需要重新输入账号密码 |
| 退出登录 | 「我的」 | 调用 `/auth/logout`，绑定关系保留，下次点击「微信登录」直接登录 |

## 审批提醒（订阅消息）

微信小程序不能像钉钉、企业微信那样随时给用户发消息，只能发送用户**事先授权过**的一次性订阅消息：每授权一次，服务端可以给该用户发送一条。

### 授权时机

`utils/subscribe.js`：

- `loadSubscribeConfig()`：`App.vue` 的 `onLaunch` 中调用，请求 `/auth/miniapp/config` 预先加载模板 ID（只在 `MP-WEIXIN` 下执行）；
- `requestSubscribe(feedback)`：调用 `uni.requestSubscribeMessage` 申请授权，没有配置模板时直接返回；`feedback` 为 true 时提示授权结果；
- `subscribeAvailable()`：是否配置了模板，用于决定「我的」中是否显示「审批提醒」。

::: warning 必须在点击事件中同步调用
微信要求 `requestSubscribeMessage` 由用户的点击直接触发，**不能放在 `await` 之后或异步回调中**，否则调用失败。这也是模板 ID 要在启动时预先加载、而不是点击时再请求的原因。新增调用点时，把 `requestSubscribe()` 写在点击处理函数的第一行：

```js
async function submit() {
  // 审批人处理完一条待办，顺便续订下一次的审批提醒（只能在点击事件中同步申请）
  requestSubscribe()
  // 之后再做校验、调用接口等异步操作
}
```
:::

当前申请授权的位置：

| 位置 | 文件 |
| --- | --- |
| 登录页「微信登录」按钮 | `pages/login/index.vue` 的 `onWechatTap` |
| 工作台点击待办 | `pages/index/index.vue` 的 `openLink` |
| 审批详情提交同意 / 拒绝 / 转交 | `pkg-approval/detail.vue` 的 `submit` |
| 提交发起申请 | `pkg-approval/start/form.vue` |
| 「我的 → 审批提醒」主动开启 | `pages/mine/index.vue`（`requestSubscribe(true)`，提示授权结果） |

用户在授权弹窗中勾选「总是保持以上选择」后不再弹窗，之后每次调用都按用户的选择直接累计可发送次数。

### 后端推送

`SysMessageService` 写入站内消息后发布 `MessageSentEvent`，`SysMiniappPushService.onMessage` 与钉钉等平台的推送（`SysImPushService`）并列监听：

```java
@Async
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
public void onMessage(MessageSentEvent e) { ... }
```

1. **触发条件**：配置了 AppID 和 AppSecret、配置了模板 ID、消息类别在 `subscribe.categories` 中（默认只有 `APPROVAL`），且有接收人；否则直接返回。业务事务提交后异步执行，事务回滚时不推送，没有事务时也执行。
2. 在当前租户中查出接收人中已绑定微信的用户（`sys_miniapp_user`）。
3. 组装模板数据：标题字段为消息标题，内容字段为消息内容（为空时用标题），二者都截断为 20 个字符（超出时保留 19 个字符加「…」）；时间字段为当前时间 `yyyy-MM-dd HH:mm`。推送的文字来自站内消息（存库内容，中文），`lang` 固定为 `zh_CN`。
4. 逐个调用 `WeChatMiniClient.sendSubscribe`（`/cgi-bin/message/subscribe/send`），点击消息打开 `subscribe.page`（默认审批页），版本为 `subscribe.state`。

**失败处理**：

| 情况 | 处理 |
| --- | --- |
| 微信返回 `43101`（用户没有授权或次数已用完） | 视为正常情况跳过，不记错误 |
| 返回 `40001` / `42001`（access_token 无效或过期） | 强制重新获取 access_token 后重发一次 |
| 其他错误码、网络异常（连接超时 5 秒、读取超时 15 秒） | 记 `warn` 日志「推送微信订阅消息失败」，继续发给下一个用户；不重试，不影响站内消息 |

access_token 由 `WeChatMiniClient.accessToken` 从 `/cgi-bin/token` 获取，缓存在 `mp:token`（所有租户共用一个），有效期为微信返回的 `expires_in` 减 5 分钟。

::: warning 不要让其他系统共用同一个 AppID 获取 access_token
微信的 `/cgi-bin/token` 每次获取都会让之前的 access_token 在短时间后失效。如果其他系统也用同一个小程序的 AppSecret 获取令牌，柠檬ERP 缓存的令牌会被顶掉；后端遇到 40001 时会重取一次，但两边会反复互相顶掉。
:::

业务模块继续只通过 `framework/message/MessageSender` 发送站内消息，不需要知道订阅消息的存在；想让某类消息也推送到小程序时，把它的类别加到 `subscribe.categories`，并确认点击后打开的页面（`subscribe.page`）合适。

## 新增一个功能入口

以「合同查询」为例（只读列表，按客户名称或合同编号搜索），说明在小程序中新增一个页面和工作台入口的完整步骤。后端接口 `GET /crm/contract` 已存在（需要 `crm:contract:list`、`crm:opp:list`、`crm:customer:list` 之一，按数据权限返回），Web 端菜单路由为 `/crm/contract`。

### 1. 在 pages.json 中登记页面

属于已有功能区的页面加到对应分包的 `pages` 中；新的功能区新建分包（目录 `src/pkg-<区>`，`root` 与目录同名）：

```json
{
  "root": "pkg-crm",
  "pages": [
    { "path": "contract/index", "style": { "navigationBarTitleText": "合同", "enablePullDownRefresh": true } }
  ]
}
```

- `navigationBarTitleText` 只能写一种语言（中文），运行时由页面的 `useTitle` 按界面语言重新设置；
- 列表页开启 `enablePullDownRefresh`，配合 `usePaged` 下拉刷新；
- 不要把功能页面放进主包 `pages`，主包只放底部导航页、登录和修改密码。

### 2. 封装接口

在 `src/api/<区>.js` 中添加，路径与 Web 端相同（不含 `/api`）：

```js
// src/api/crm.js
/** 销售合同：{ current, size, keyword, status, customerId }（数据权限由后端处理） */
export const pageContracts = (params) => get('/crm/contract', params)
```

`utils/request.js` 提供 `get(url, params, opts)`、`post(url, data, opts)`、`put`、`del`、`upload(url, filePath, formData)`：

- `params` 拼接为查询参数，值为 `null` / `undefined` / 空字符串的忽略，数组按逗号连接；
- 返回 `R.data`；出错时已弹出提示并 reject，错误对象带 `handled` 标记，页面不需要再提示，`catch` 后直接返回即可；
- `{ silent: true }` 不弹出错误提示，用于可选的数据（如没有权限时不显示的卡片）；
- 下载需要令牌的附件不能直接作为 `<image>` 的地址，参照 `pkg-crm/photos.js` 用 `uni.downloadFile` 带上 `Authorization` 头下载为临时文件。

### 3. 语言包

在 `src/locales/zh-CN/<区>.js` 和 `src/locales/en-US/<区>.js` 中添加同样的键（文件名即键的第一段）：

```js
// src/locales/zh-CN/crm.js
export default {
  entry: { /* ... */ contract: '合同' },
  contract: {
    title: '合同',
    searchPh: '搜索合同名称、编号、客户',
    signDate: '签订 {date}'
  }
}

// src/locales/en-US/crm.js
export default {
  entry: { /* ... */ contract: 'Contracts' },
  contract: {
    title: 'Contracts',
    searchPh: 'Search name, number or customer',
    signDate: 'Signed {date}'
  }
}
```

### 4. 页面

```vue
<!-- src/pkg-crm/contract/index.vue -->
<template>
  <view>
    <view class="l-search">
      <input v-model="keyword" :placeholder="t('crm.contract.searchPh')" placeholder-class="l-placeholder" confirm-type="search" @confirm="paged.refresh()" />
    </view>
    <view v-for="c in paged.list" :key="c.id" class="l-item">
      <view class="l-item__head">
        <text class="l-item__title">{{ c.name }}</text>
        <l-tag :text="dictText(dict.crm_contract_status, c.status)" :color="dictColor(dict.crm_contract_status, c.status)" />
      </view>
      <view class="l-item__desc">{{ [c.contractNo, c.customerName].filter(Boolean).join(' · ') }}</view>
      <view class="l-item__desc">
        {{ money(c.amount) }}<text v-if="c.status === SalesContractStatus.ACTIVE && c.signDate"> · {{ t('crm.contract.signDate', { date: c.signDate }) }}</text>
      </view>
    </view>
    <l-empty v-if="paged.loaded && !paged.list.length" />
    <l-load-more v-else-if="paged.list.length" :status="paged.status" />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app'
import { useI18n } from '@/locales'
import { SalesContractStatus } from '@web/constants/enums'
import { pageContracts } from '@/api/crm'
import { usePaged } from '@/composables/usePaged'
import { useTitle } from '@/composables/useTitle'
import { dictColor, dictText, useDict } from '@/store/dict'
import { money } from '@/utils/format'

const { t } = useI18n()
useTitle('crm.contract.title')
const dict = useDict('crm_contract_status')
const keyword = ref('')
const paged = usePaged((p) => pageContracts({ ...p, keyword: keyword.value.trim() }))

onLoad(() => paged.refresh())
onPullDownRefresh(() => paged.refresh())
onReachBottom(() => paged.more())
</script>
```

要点：

- 状态比较用 `@web/constants/enums` 中由后端枚举生成的常量（`SalesContractStatus.ACTIVE`），不写 `'ACTIVE'` 这样的字符串字面量；
- 字典用 `useDict(类型...)` 加载（同一类型只请求一次），`dictText` 取标签、`dictColor` 取 Web 端字典的 `tagColor` 交给 `l-tag`；英文界面自动使用 Web 端的字典译文；
- 页面中不写中文，全部用 `t('键')`（模板中也可以用 `$t`）；
- 按钮级权限用 `hasPerm('crm:contract:add')`（`store/user`）判断是否显示，与 Web 端的 `v-perm` 对应；最终仍以后端 `@PreAuthorize` 为准。**要写在 `computed` 或模板中**（例如 `const canAdd = computed(() => hasPerm('crm:contract:add'))`）：小程序冷启动或从链接直接打开分包页面时用户信息可能还没加载，`hasPerm` 读取的是响应式状态，写在 `computed` 中用户信息加载后会自动更新；在 `setup` 顶层直接求值只会得到加载前的结果，按钮不显示；
- 需要按权限决定加载哪些数据的页面，在 `onLoad` / `onShow` 中先 `await ensureUser()`（`store/user`，并发调用共用一次请求，没有令牌时直接返回）再加载。

### 5. 登记工作台入口

在 `src/config/entries/<区>.js` 中登记，新的功能区新建文件并在 `config/entries/index.js` 的 `ALL` 中加入：

```js
// src/config/entries/crm.js
{
  key: 'crm-contract',
  group: 'sales',
  title: 'crm.entry.contract',
  color: '#2f54eb',
  url: '/pkg-crm/contract/index',
  // 与后端接口的权限一致：有任一权限即显示
  perm: ['crm:contract:list', 'crm:opp:list', 'crm:customer:list'],
  // 首页待办、站内消息中的 Web 端链接 /crm/contract... 转到本页
  links: ['/crm/contract']
}
```

| 字段 | 说明 |
| --- | --- |
| `key` | 唯一标识（「我的」页按 key 查找入口） |
| `group` | 工作台分组：`office` 办公、`sales` 销售与服务、`warehouse` 仓储生产、`quality` 设备与质量（`GROUPS`，标题键为 `common.group.<分组>`） |
| `title` | 入口名称的消息键；工作台图标显示名称的第一个字 |
| `color` | 图标底色 |
| `url` | 页面地址 |
| `tab` | 是否底部导航页（用 `switchTab` 打开，不能带参数） |
| `perm` | 有任一权限即显示（字符串或数组）；**不写**表示登录即可。注意写成空数组 `[]` 时任何人都看不到（超级管理员除外） |
| `permAll` | 还必须同时具备的权限，例如报工入口 `perm: 'mes:wo:report'`、`permAll: ['mes:wo:list']`（报工页要查询工单） |
| `links` | 对应的 Web 端路由前缀 |
| `rule` | 布尔型业务参数的键，参数关闭时不显示入口，例如快速开单 `rule: 'scm.directDoc.enabled'`。参数读取完成前按开启处理，所以页面自身仍要检查参数 |

**业务参数**：`store/bizRules.js` 与 Web 端 `useBizRules` 使用同一个接口 `GET /system/biz-rule/values?keys=...`，只能读到后端在 `BizRuleProvider.publicKeys()` 中声明为前端可读的参数（如 `ScmBizRules` 的 `scm.directDoc.enabled`、`scm.salesOut.lineWarehouse`）。`loadBizRules(keys)` 读取尚未缓存的参数（失败时不抛出），`bizRule(key, 默认值)` 响应式读取，默认值要与后端默认值一致；缓存在切换账号（`resetUser`）时清空。工作台加载时 `loadEntryRules()` 读取所有入口用到的参数。

```js
// pkg-wms/sale/index.vue：参数关闭时显示提示，不能开单
await loadBizRules(['scm.directDoc.enabled', 'scm.salesOut.lineWarehouse'])
disabled.value = bizRule('scm.directDoc.enabled', true) === false
```

入口的权限要与页面实际调用的接口权限一致，否则用户能看到入口、进入后接口返回 403。

**链接转换**：工作台待办（`TodoProvider` 返回的 `link`）和站内消息的 `link` 都是 Web 端路由。`entryOfLink(link)` 去掉查询参数后，在当前用户可见的入口中按 `links` 前缀匹配（取最长的前缀），找到后 `openEntry` 打开对应页面，并把链接中的查询参数（筛选条件，例如库存的 `lowStock=1`、检验单的 `status=DRAFT`、服务工单的 `mine=1`）原样拼到小程序页面地址上，页面在 `onLoad(query)` 中按与 Web 端相同的参数名读取；找不到或没有权限时提示「该事项请在电脑端处理」。底部导航页不能带参数，`openEntry` 把链接暂存，由页面在 `onShow` 中用 `takeTabLink(url)` 取出（审批页据此切换到待办 / 我发起的等分段）。后端新增待办或消息时，如果希望小程序中可以直接处理，确认链接前缀已登记在某个入口的 `links` 中。

### 6. 检查

```bash
npm run i18n:check
```

然后在微信开发者工具中分别用有权限、没有权限的账号检查入口是否显示，切换为 English 检查文字长度和布局，最后真机预览。

## 通用组件与组合函数

`pages.json` 的 easycom 规则 `"^l-(.*)": "@/components/l-$1/l-$1.vue"` 让 `l-*` 组件在页面中无需导入即可使用。

| 组件 | 属性 / 事件 | 用途 |
| --- | --- | --- |
| `l-card` | `title`；`click` | 白色圆角卡片，默认插槽为内容 |
| `l-cell` | `label`、`value`、`arrow`、`icon`、`iconColor`；`click` | 信息行：没有值时显示「-」；带 `arrow` 的是入口；`icon` 为 `static/icons` 下的白色线条图标名 |
| `l-field` | `label`、`required` | 表单项：标签 + 控件，`input` / `picker` / `textarea` 放在默认插槽中，控件加 `class="l-input"` / `l-textarea` |
| `l-tag` | `text`、`color` | 状态标签，`color` 可用 Web 端字典的 `tagColor`（green、red、blue、orange、gold、cyan、purple 等）或 `success` / `danger` / `warning` / `primary` |
| `l-empty` | `text` | 空状态，默认文字「暂无数据」 |
| `l-load-more` | `status`：`loading` / `more` / `noMore` | 列表底部加载状态，配合 `usePaged` |
| `l-segmented` | `v-model`、`options: [{ label, value, badge? }]`；`change` | 顶部分段切换（如「我的 / 全部」） |
| `l-scan-input` | `placeholder`、`focus`；`scan` | 扫码输入：点「扫码」调用摄像头；PDA 扫码枪按键盘输入加回车；结果通过 `scan` 事件返回，输入框随即清空 |

全局样式类（`App.vue`）：`l-btn`（`--ghost`、`--danger`、`--default`）、底部固定操作栏 `l-footer`（内容末尾放 `<view class="l-footer-space" />` 留出高度）、列表项 `l-item`（`__head`、`__title`、`__desc`）、搜索框 `l-search`、`l-muted`、`l-placeholder`。

| 组合函数 | 用法 |
| --- | --- |
| `usePaged(fetcher, size = 20)` | 下拉刷新 + 触底加载。`fetcher` 接收 `{ current, size }`，返回后端分页结果 `{ records, total }`；返回的响应式对象有 `list`、`total`、`status`、`loaded`、`refresh()`、`more()`。`refresh()` 结束时自动 `stopPullDownRefresh` |
| `runAction(action, { confirm, success, then })` | 单条操作：有 `confirm` 时先弹确认框 → 显示加载中执行 `action` → 成功提示 `success`（默认「操作成功」，超过 7 个字时不带图标）→ 执行 `then`。返回是否成功，接口错误已由 request 提示 |
| `useTitle(key, params)` | 在 `onShow` 中按界面语言设置导航栏标题；`params` 可以是返回参数的函数 |
| `scanCode()` | 调用摄像头扫码，返回结果字符串，用户取消时为 `null` |
| `vibrate(ok = true)` | 扫码反馈：成功短震，失败长震 |

```js
// pkg-crm/opportunity/index.vue：推进商机阶段 → 提示 → 刷新列表
runAction(() => changeOpportunityStage(o.id, data), { success: t('crm.opportunity.stageChanged'), then: () => paged.refresh() })
```

其他工具：`utils/format.js` 的 `money`（千分位两位小数）、`price`（单价，千分位、2 到 4 位小数）、`qty`（最多 4 位小数）、`shortMoney`（中文按万 / 亿，英文按 K / M）、`shortTime`、`today(offsetDays)`、`period()`（`yyyyMM` 整数）；`utils/request.js` 的 `fileUrl(path)` 把后端文件地址（头像等）转为完整地址。

## 快速开单与成本显示

快速开单（`pkg-wms/sale/index.vue`）与 Web 端销售出库的「直接开单」调用同一个接口 `POST /scm/salesOut`（不传 `orderId`），后端生成并审核隐式订单后出库，规则全部在后端，小程序只负责录入：

| 要点 | 实现 |
| --- | --- |
| 辅助单位 | 行上的 `qty`、`price` 是所选录入单位的数量和含税单价；默认价、促销预览、库存比较和提交都折算为基本单位（`lines.js` 的 `baseQty` / `basePrice`，基本单价保留 4 位小数），`unitName` 只用于显示。扫包装条码新增的行默认按该包装单位录入；序列号物料和赠品只按基本单位 |
| 默认价 | `GET /scm/pricing/default`（`kind=SALES`，按行传 `materialIds`、`qtys`），按行返回，同一物料多行时各自按数量匹配起订量；只覆盖没有手工改过（`priceAuto`）的单价，客户、日期、数量、单位变化时重新带出 |
| 税率与发票类型 | 表头可选发票类型（业务字典 `scm_invoice_kind`，`store/dict` 的 `useDict`，取值带 `extValue` 即税率），选择后明细税率（赠品除外）统一调整为该税率，每行可再修改税率（`SaleRow.vue`，0 ~ 100、2 位小数，清空为按默认）；新明细的税率为发票类型的税率，没有时为业务参数「默认税率」（`scm.defaultTaxRate`，经 `store/bizRules.js` 读取）；未选发票类型时默认价带出的税率按来源，选了时以发票类型为准；提交时带 `invoiceKind`（记在隐式订单上），明细税率为空时由后端按 发票类型 → 默认税率 补上，见 [开单取价 - 税率](./pricing#税率) |
| 价格参考 | `components/PriceRefSheet.vue` 只取 `/scm/pricing/reference` 的销售历史分区（该客户、全部客户），后端按权限裁剪分区，没有 `sales` 分区时显示没有权限 |
| 促销与赠品 | 明细变化后 500 ms 调 `POST /scm/promotion/preview`（只传普通行），预览返回前不能保存；赠品行由 `gifts.js` 按预览重建，`scm.salesOut.lineWarehouse` 开启时可拆成多行从不同仓库出，提交前校验各组数量合计等于预览的赠品数量。没有预览权限时不显示赠品，由后端保存时从表头仓库先到期先出补上（序列号赠品除外） |
| 库位批次 | 每行按 `/wms/stock` 的可用库存先到期先出排序（过期的排最后），默认第一项；赠品所选库位批次不够时提交时自动拆到其他库位批次 |
| 整单优惠 | 基数为扣除促销优惠后的合计，抹分 / 抹角 / 抹元按分计算差额累加到 `wholeDiscount` |
| 运费 | `pkg-wms/sale/SaleFreight.vue`，与 Web 端销售出库相同：本公司承担 / 代垫运费，现付选付款账户（`/fin/account/options` + `/fin/account/scopes`），月结选承运商（`/scm/supplier/carrier-options`）；通过 ref 调用 `check()`、`payload()`、`reset()`，提交时合并到请求 |

成本金额只在后端控制：没有「查看成本金额」（`wms:stock:cost`）权限时，`/wms/stock/summary` 不返回 `unitCost`、`amount`，`/wms/stock/history` 返回 `costVisible: false` 且不带单价金额；盘点单详情的 `costVisible` 在有 `wms:stock:cost`，或盘点单未完成且有 `wms:check:add` / `wms:check:edit` 时为真（小程序盘点入口要求 `wms:check:edit` 且只列草稿盘点单，因此盘盈行总能填成本价）；当前均价 `avgCost` 只在有 `wms:stock:cost` 时返回，没有时输入框提示「默认按确认时的当前均价」，不显示「默认均价 X」。页面按字段是否返回或 `costVisible` 显示，不自己判断权限。

## 商品速查

商品速查（`pkg-wms/lookup`，issue #97）的接口、价格权限、个人设置与 Web 端「商品速查」相同，见 [开单取价 - 商品速查](./pricing#商品速查)。

- 顶部搜索框输入名称 / 规格 / 简拼，400ms 防抖搜索，触底加载下一页；
- 右上「价格 ▾」打开查询价格设置 `LookupSettingSheet`，按进货类 / 成本 / 销售类分组，没有权限的置灰；
- 小程序没有双击，交互改为点击：
  - 点击商品描述看商品图片 `LookupImageSheet`（列表中显示主图缩略图，点击放大）；
  - 点击库存看各仓库 / 批次 `LookupStockSheet`（有 `wms:stock:list` 时可转到经营历史）；
  - 点击价格看历史参考 `LookupPriceSheet`：售价 / 进价分段按权限显示，底部【更多交易历史】打开 `lookup/trades`，【更多内容】打开 `lookup/reference`；
- 长按一行用 `uni.showActionSheet` 弹出全部联查（含售价、进价历史和经营历史，按权限列出）。

### 语音输入

小程序没有内置的语音识别 API，商品速查默认使用输入法的语音输入（微信键盘、系统输入法的麦克风），不需要任何配置。需要「按住说话」按钮时接入微信官方的「同声传译」插件，代码已在 `pkg-wms/lookup/voice.js` 中写好（`requirePlugin('WechatSI')` 成功才显示按钮，识别语言随界面语言）：

1. 在微信公众平台「设置 - 第三方设置 - 插件管理」中添加插件「微信同声传译」（AppID `wx069ba97219f66d99`）；
2. 在 `src/pages.json` 的 `pkg-wms` 分包中声明：

   ```json
   "plugins": { "WechatSI": { "version": "0.3.6", "provider": "wx069ba97219f66d99" } }
   ```

3. 重新编译，搜索框旁出现「按住说话」。

::: warning 注意
插件没有在后台添加就声明，会导致小程序无法编译和预览，所以仓库中默认不声明。只在已添加插件的小程序上加这段配置；录音需要麦克风授权，发布前在「用户隐私保护指引」中声明麦克风的用途。
:::

## 手机开单的保存、草稿与打印

issue #97 补齐了手机开单：快速入库、统一的保存方式、单据草稿和打印 / 分享 PDF。

**保存方式**：快速开单、快速入库、扫码收货的保存按钮统一由 `pkg-wms/tradeSave.js` 决定，与 Web 端出入库表单一致：

| 情况 | 按钮 |
| --- | --- |
| 业务参数「进销存单据先存草稿」（`scm.tradeDoc.draft`）关闭 | 只有「保存」，保存即审核 |
| 开启，且有审核权限（`scm:{kind}:post`） | 「存草稿」+「保存并审核」 |
| 开启，但没有审核权限 | 只有「存草稿」 |

`saveModes(kind)` 返回按钮列表，`saveTrade(kind, mode, build)` 调用 `POST /scm/{kind}` 或 `POST /scm/{kind}/drafts`，审核成功后询问是否打印。

**快速入库**（`pkg-wms/purchase`）是采购入库直接开单：`POST /scm/purchaseIn`，`orderId` 为空，带供应商 `partnerId`。

| 要点 | 实现 |
| --- | --- |
| 表头 | 选供应商（`/scm/supplier/options` 分页搜索）、仓库（记住上次选择）、发票类型、入库日期 |
| 商品 | 扫码 / 搜索商品；扫库位条码设为当前库位 |
| 含税单价 | 按 `/scm/pricing/default`（`kind=PURCHASE`：合同价 → 供货价 → 最近进价 → 参考成本价）带出 |
| 辅助单位 | 折算规则同快速开单，复用 `pkg-wms/sale/lines.js` |
| 批次与序列号 | 批次物料必须填批次号（可填有效期），序列号物料扫描序列号 |
| 库位 | 不选时保存前按上架策略推荐（`fillPutaway`） |

**单据草稿**（`pkg-wms/draft`）：

- 分段列出销售出库 / 采购入库的草稿，按列表权限显示分段，可按单据号搜索；
- 详情显示表头和明细；
- 「审核记账」调用 `POST /scm/{kind}/drafts/{id}/post`，「删除」调用 `DELETE /scm/{kind}/drafts/{id}`。

**打印 / 分享 PDF**（`pkg-wms/print.js`）：

1. 保存并审核、草稿审核成功后询问是否打印，需要 `scm:{kind}:list` 读取单据详情，没有时不询问；
2. 按 Web 端 `TradeDocDetail` 的打印内容组装单据。匹配键取 Web 端语言包 `zh-CN/print.js` 的打印名称，显示名称按界面语言；
3. 套用打印模板（`/system/print-template`，即默认格式的隐藏 / 排序 / 改名 / 纸张；上传了 JRXML 的由后端按 JRXML），调用 `POST /system/print/pdf` 生成 PDF；
4. 写入 `wx.env.USER_DATA_PATH` 后用 `uni.openDocument({ showMenu: true })` 打开，用户在右上角菜单转发，或用其他应用打开打印。小程序不能直接连接打印机；H5 调试时在新窗口打开。

打印改动集中在 `print.js` 一个文件，以后支持[打印格式选择](./doc-no-print#多份打印格式)时只改这里。

销售 / 采购订单的手机录入暂未提供（订单字段多、需审批，仍在电脑端），订单出库 / 入库可用拣货、扫码收货。

## 与 Web 端共用的内容

`vite.config.js` 中的别名 `@web` 指向 `../lemon-web/src`，小程序直接引用 Web 端的两类文件，不复制：

| 文件 | 用途 |
| --- | --- |
| `@web/constants/enums` | 由后端枚举生成的状态、类型常量（`FlowStatus`、`LeaveStatus`、`WorkOrderStatus` 等），见 [前端开发规范](./frontend#状态与类型常量)。后端新增枚举后在 `lemon-web` 中运行 `npm run gen:enums`，小程序随之可用 |
| `@web/locales/en-US/dict.js` | 字典的英文译文，`locales/index.js` 的 `dictLabel` 使用 |

因此 `lemon-mp` 必须与 `lemon-web` 放在同一个仓库中的相邻目录才能编译。只引用这类不依赖 Web 端运行环境（DOM、Ant Design Vue、vue-i18n）的纯数据文件，不要从 `@web` 引入组件或工具函数。

## 多语言

小程序不能运行 vue-i18n 的消息编译（小程序环境不允许 `eval` / `new Function`），`src/locales/index.js` 是一个最小实现：

| 能力 | 做法 |
| --- | --- |
| 语言包 | `locales/<语言>/<区>.js` 默认导出对象，用 `import.meta.glob` 自动加载；键为 `<文件名>.<路径>`，如 `t('approval.approve')` |
| 插值 | 写 `{name}`：`t('common.total', { n: 3 })`。不支持复数、链接消息、HTML |
| 回退 | 当前语言没有译文时回退到中文，再没有时返回键本身 |
| 响应式 | `locale` 是 `ref`，模板中的 `t()` / `$t()` 在切换语言后自动更新，无需刷新 |
| 初始语言 | 本地保存的 `lemon_mp_locale`；没有时按系统语言（`en` 开头为英文，其他为中文）。在「我的 → 语言」中切换 |
| 字典 | `dictLabel(type, value, fallback)`：英文按 Web 端 `en-US/dict.js` 的译文，中文直接用数据库中的标签 |
| 请求 | `Accept-Language` 为当前界面语言，后端提示按语言返回 |

约束：

- 代码中不写中文，全部用 `t` / `$t`；有意保留的（如中文数量单位「万」「亿」、语言名称「简体中文」）在行内写 `i18n-ignore`；
- `pages.json`、`manifest.json` 只能写一种语言（中文），页面标题由 `useTitle` 设置、底部导航文字由 `utils/tabbar.js` 的 `applyTabBar()` 设置（`App.vue` 的 `onLaunch`、工作台和「我的」的 `onShow`、切换语言后调用）；
- 推送的订阅消息内容来自站内消息，保持中文。

`npm run i18n:check`（`scripts/check-i18n.mjs`）检查：

| 标记 | 内容 |
| --- | --- |
| `[en-US 缺少]` / `[zh-CN 缺少]` | 两种语言的语言包键不一致 |
| `[语言 缺少] 键（文件）` | 代码中 `t('…')`、`$t('…')`、`te('…')` 使用的字面量键不存在（拼接的动态键不检查） |
| `[中文] 文件:行号` | 代码中残留的中文（去掉注释和 `console` 输出后），行内有 `i18n-ignore` 的除外 |

`pages.json`、`manifest.json` 不检查。有问题时退出码为 1，没有问题输出「多语言检查通过」。Web 端的约定见 [国际化](./i18n#小程序)。

## 平台差异与条件编译

| Web 端 | 小程序 |
| --- | --- |
| DOM、`window`、`document` | 没有，用 `<view>`、`<text>`、`<image>` 等组件和 `uni.*` API |
| `localStorage` | `uni.getStorageSync` / `uni.setStorageSync` |
| axios | `uni.request`、`uni.uploadFile`、`uni.downloadFile`（已封装在 `utils/request.js`） |
| Vue Router | `uni.navigateTo`（普通页）、`uni.switchTab`（底部导航页，不能带参数）、`uni.reLaunch`、`uni.navigateBack`；页面参数在 `onLoad(query)` 中读取 |
| `onMounted` 加载数据 | 页面生命周期 `onLoad`、`onShow`、`onPullDownRefresh`、`onReachBottom`（从 `@dcloudio/uni-app` 导入） |
| `alert` / `message` | `uni.showToast`、`uni.showModal`、`uni.showLoading` |
| 扫码、拍照、拨号 | `uni.scanCode`、`uni.chooseImage`、`uni.makePhoneCall`、`uni.vibrateShort` |

尺寸用 `rpx`（750rpx 为屏幕宽度）。只在某个平台执行的代码用条件编译：

```js
// #ifdef MP-WEIXIN
uni.requestSubscribeMessage({ tmplIds: templateIds })
// #endif
```

```vue
<!-- #ifdef MP-WEIXIN -->
<l-cell :label="t('common.mine.unbind')" arrow @click="unbind" />
<!-- #endif -->
```

当前用到条件编译的地方：登录页判断是否为微信环境、订阅消息、「我的」中的审批提醒 / 切换账号 / 解除绑定、商品速查的同声传译插件（`voice.js`，只在 `MP-WEIXIN`）、打印 / 分享 PDF（`print.js`，H5 在新窗口打开，小程序用 `uni.openDocument`）。

## 发布

### 1. 准备

| 事项 | 说明 |
| --- | --- |
| 后端 HTTPS 域名 | 正式版只能访问 HTTPS 域名，见 [生产环境配置](../deploy/production#微信小程序) |
| 后端配置 | `LEMON_MINIAPP_APP_ID`、`LEMON_MINIAPP_APP_SECRET`，需要审批提醒时配置 `LEMON_MINIAPP_SUBSCRIBE_TEMPLATE_ID` |
| 服务器域名 | 微信公众平台「开发管理 → 开发设置 → 服务器域名」中，把后端域名（如 `https://erp.example.com`）同时登记为 **request 合法域名**、**uploadFile 合法域名**（跟进照片上传）和 **downloadFile 合法域名**（跟进照片下载） |
| 订阅消息 | 「功能 → 订阅消息」中选用模板，见上文 |
| 用户隐私保护指引 | 在公众平台「设置 → 服务内容声明 → 用户隐私保护指引」中如实声明用到的个人信息（如写跟进时拍照、从相册选择照片），未声明的隐私接口在正式版中会调用失败 |

服务器域名必须是 HTTPS、已备案的域名，不能是 IP 地址或 `localhost`；带端口时要连同端口一起登记。服务器域名每月可修改的次数有限，建议一次规划好。

### 2. 编译与上传

```bash
cd lemon-mp
# .env 中 VITE_API_BASE=https://erp.example.com/api
npm run build:mp-weixin
```

1. 在微信开发者工具中导入 `dist/build/mp-weixin`（与开发版使用不同的目录）；
2. 确认「详情 → 本地设置」中**没有**勾选「不校验合法域名」时也能正常访问，真机预览检查登录、扫码、拍照上传；
3. 点击「上传」，填写版本号（与 `manifest.json` 的 `versionName` 一致）和项目备注。

### 3. 审核与版本管理

- 上传后是「开发版本」，在公众平台「管理 → 版本管理」中可以设为**体验版**，给添加了体验成员的用户测试；测试订阅消息点击跳转体验版时，后端临时设置 `lemon.miniapp.subscribe.state=trial`；
- 提交审核时填写功能页面和测试账号。小程序需要登录才能使用，请提供一个可以登录的测试账号（审核人员首次进入时用账号密码登录并绑定），并保证审核期间该账号可用（不要停用、不要修改密码）；
- 审核通过后手动「发布」为正式版；发布前确认后端已是对应的版本，新页面调用的接口已部署；
- 小程序与后端分开发布：后端接口要向下兼容已发布的旧版本小程序（用户可能还在使用旧版本），删除或修改接口参数时先发布新版小程序、等旧版本基本不再使用后再改后端；
- 每次发版同步修改 `manifest.json` 的 `versionName` / `versionCode` 和「我的」页的 `VERSION`。

::: tip 多租户
所有租户共用同一个小程序，租户不需要单独发布。用户首次登录时输入租户名称、账号和密码完成绑定，之后按绑定自动进入对应租户。
:::

## 暂未提供

打卡定位校验；Web 端跟进记录显示照片；工单指派、配件领用；不合格品照片（`qms_ncr` 未登记附件类型）；抄送已读状态。
