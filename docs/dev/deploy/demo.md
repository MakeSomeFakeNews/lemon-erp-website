---
order: 5
---

# 搭建演示环境

对外展示柠檬ERP 时，可以开启演示模式：访客可以浏览全部页面、查询数据、查看报表和审批流程，但不能新增、修改、删除任何数据，演示数据不会被改乱。

## 开启

设置环境变量 `LEMON_DEMO_ENABLED=true`（对应配置 `lemon.demo.enabled`）后启动后端：

```bash
LEMON_DEMO_ENABLED=true java -jar lemon-erp.jar --spring.profiles.active=prod
```

Docker 部署时在 `environment` 中加上 `LEMON_DEMO_ENABLED: "true"`。

开启后：

- 登录页显示「当前为演示环境，只能查看，不能新增、修改、删除数据」，顶部导航右侧显示橙色的「演示模式」标签（前端从 `GET /auth/config` 的 `demoMode` 读取）
- 所有用户（包括超级管理员）的新增、修改、删除、审核、审批、导入、上传等操作都会被拒绝，提示「演示模式下不能新增、修改、删除数据」
- 查询、导出、打印、查看详情、登录、退出不受影响
- 定时任务照常执行（例如数据仓库同步、到期提醒），它们不经过 HTTP 请求

建议同时在「系统管理 → 参数设置」中打开「登录页显示演示账号」，方便访客登录：登录页列出 `admin`（超级管理员）、`test`（只读）两个账号（SaaS 模式下注明租户「柠檬科技」），点击即自动填入账号、密码和租户。演示模式下打开登录页时会默认填好超级管理员（浏览器记住的用户名是 `test` 时填 `test`），访客直接点「登录」即可。登录页填入的密码固定为 `admin123`（`views/login/index.vue` 中的常量），演示环境不要修改这两个账号的密码。

## 实现原理

`framework/demo/DemoModeInterceptor` 是一个 Spring MVC 拦截器，在 `@PreAuthorize` 和业务代码之前执行：

1. 演示模式关闭，或请求方法是 `GET` / `HEAD` / `OPTIONS` 时直接放行
2. 请求路径匹配 `lemon.demo.allowed-paths` 白名单时放行
3. 其余请求不执行，返回 HTTP 200 和 `{"code":403,"msg":"演示模式下不能新增、修改、删除数据"}`，前端请求拦截器按 `msg` 弹出提示

白名单默认包含：

| 路径 | 说明 |
| --- | --- |
| `/auth/login`、`/auth/logout` | 登录、退出 |
| `/auth/im/callback` | 钉钉、企业微信、飞书授权回调（扫码登录、个人中心绑定） |
| `/system/message/read` | 标记站内消息已读 |
| `/bi/olap/pivot` | 多维分析查询 |
| `/scm/promotion/preview` | 销售订单的促销预览 |
| `/wms/location/putaway` | 上架库位建议 |
| `/system/print/pdf` | 单据打印：生成 PDF |
| `/system/print/jrxml` | 打印模板：下载按当前配置生成的默认 JRXML |

::: warning 新增接口时注意
如果新增了用 `POST` 传参、但不修改数据的查询接口，要把它的路径加到 `DemoProperties.allowedPaths` 的默认值中，否则演示模式下无法使用。会修改数据的接口一律不要加入白名单。
:::

::: tip 第三方集成
`GET /auth/im/providers`、`GET /auth/im/{platform}/authorize` 是 GET 请求，回调 `POST /auth/im/callback` 在白名单中，因此演示环境中已启用的平台仍可扫码登录。注意回调在「绑定」用途时会写入 `sys_im_user`（个人中心绑定账号仍然生效），这是白名单中唯一会写数据的情况；而保存集成配置、测试连接、测试群机器人、同步通讯录、手工绑定和解除绑定都会被拦截。演示环境如需展示扫码登录，请在开启演示模式之前配置好集成并绑定演示账号。
:::

::: tip 数据大屏
数据大屏和投屏链接的查看接口都是 `GET`，演示模式下可以正常打开；新建、编辑、重新生成、删除投屏链接会被拦截。演示环境如需展示投屏效果，请在开启演示模式之前创建好投屏链接。注意投屏链接免登录，演示环境中创建的链接任何拿到地址的人都能访问。
:::

## 演示数据

演示环境建议使用 `sql/init.sql` 初始化的数据，并在关闭演示模式的状态下先录入一批完整的业务数据（采购、销售、生产、财务凭证等），再开启演示模式对外开放。需要重置演示数据时，关闭演示模式后重新执行 `init.sql`，或从备份恢复数据库。
