---
order: 12
---

# 第三方集成（钉钉 / 企业微信 / 飞书）

柠檬ERP 按租户接入钉钉、企业微信、飞书的「企业自建应用」，提供四项能力：OAuth 扫码登录与应用内免登、站内消息推送（应用消息 + 群机器人）、通讯录同步、成员绑定。代码都在 system 模块，平台接口封装在 `modules/system/im` 包中，业务模块不需要感知。管理员的使用说明见用户手册 [第三方集成](/manual/system/im)。

## 相关类

| 类 | 位置 | 职责 |
| --- | --- | --- |
| `ImPlatform` | system/im | 平台枚举 `DINGTALK`、`WECOM`、`FEISHU`（字典 `sys_im_platform`），`label()` 为中文名 |
| `ImClient` | system/im | 一个平台的开放接口：校验凭证、授权页地址、授权码换成员、应用消息、通讯录、群机器人 |
| `DingTalkClient`、`WeComClient`、`FeishuClient` | system/im | `ImClient` 的三个实现（Spring Bean，按 `platform()` 收集到 `EnumMap`） |
| `ImHttp` | system/im | 统一的 HTTP 调用、错误转换、access_token 缓存、HmacSHA256 加签 |
| `ImProperties` | system/im | `lemon.im.*`：各平台开放接口的地址 |
| `ImCard`、`ImContacts`、`ImIdentity` | system/im | 消息卡片（标题、内容、链接）、通讯录（部门 + 成员）、授权得到的成员 |
| `MessageSentEvent` | system/im | 站内消息写入后发布的事件 |
| `SysImConfigService` | system/service | 配置的读取、保存校验、测试连接、测试群机器人 |
| `SysImAuthService` | system/service | 授权登录、个人绑定、回调处理，绑定关系的保存 |
| `SysImPushService` | system/service | 监听 `MessageSentEvent`，推送应用消息和群机器人 |
| `SysImSyncService` | system/service | 通讯录同步、成员绑定列表、手工绑定 / 解绑 |
| `ImAuthController` | system/controller | `/auth/im/**`，免登录 |
| `SysImController` | system/controller | `/system/im/**`，配置、同步、绑定、个人中心的账号绑定 |

数据表（都带 `tenant_id`）：

| 表 | 内容 | 唯一约束 |
| --- | --- | --- |
| `sys_im_config` | 每个租户每个平台一条配置：凭证、系统访问地址 `home_url`、功能开关、群机器人、最近同步结果 | `(platform, tenant_id)` |
| `sys_im_user` | 系统用户与平台成员 userid 的绑定 | `(platform, im_user_id, tenant_id)`、`(user_id, platform, tenant_id)` |
| `sys_im_dept` | 同步通讯录自动创建部门时，系统部门与平台部门 ID 的对应 | `(platform, im_dept_id, tenant_id)` |

已有数据库升级执行 `sql/upgrade/20261119_im_integration.sql`（建表、菜单 350「第三方集成」及按钮 `sys:im:edit`、`sys:im:sync`、字典 `sys_im_platform`）。菜单在初始数据中只授予超级管理员；SaaS 模式下它属于「基础平台」，租户管理员按套餐获得。

## ImClient 接口

```java
public interface ImClient {
    ImPlatform platform();
    void verify(SysImConfig config);                                   // 重新获取 access_token 校验凭证
    String authorizeUrl(SysImConfig config, String redirectUri, String state, boolean inApp);
    ImIdentity identify(SysImConfig config, String code, String redirectUri);   // 授权码 → 成员 userid
    void send(SysImConfig config, List<String> userIds, ImCard card);  // 应用消息
    ImContacts contacts(SysImConfig config);                           // 可见范围内的部门和成员
    void robot(String webhook, String secret, ImCard card);            // 群机器人
    String robotPrefix();                                              // Webhook 地址前缀，保存时校验
}
```

接口出错时抛 `BizException`，消息带平台名称和原因（`ImHttp.error`：`system.error.returnedError`「{0}返回错误（{1}）：{2}」，平台名称取 `ImPlatform.text()`，按请求语言显示，平台返回的 errmsg 原样输出）。`ImContacts.depts` 必须按「上级在前」排列，根部门（企业本身）的 `parentId` 为 null，同步部门时依赖这个顺序。

三个实现的差异：

| | 钉钉 | 企业微信 | 飞书 |
| --- | --- | --- | --- |
| 应用凭证 | `appKey`（Client ID）+ `appSecret` + `agentId` | `corpId` + `appSecret`（应用 Secret）+ `agentId` | `appKey`（App ID）+ `appSecret` |
| access_token | `oapi /gettoken` | `/cgi-bin/gettoken` | `/open-apis/auth/v3/tenant_access_token/internal` |
| 授权页 | `login.dingtalk.com/oauth2/auth`（`scope=openid`，`prompt=consent`），客户端内外相同 | 客户端内：`open.weixin.qq.com/connect/oauth2/authorize`（`snsapi_base` 静默授权）；浏览器：`login.work.weixin.qq.com/wwlogin/sso/login`（扫码） | `accounts.feishu.cn/open-apis/authen/v1/authorize` |
| 授权码 → 成员 | 新版接口换用户令牌 → `/v1.0/contact/users/me` 取 unionId → `oapi /topapi/user/getbyunionid` 取 userid | `/cgi-bin/auth/getuserinfo` 直接返回 userid | `/open-apis/authen/v2/oauth/token` → `/open-apis/authen/v1/user_info` 取 `user_id` |
| 回调参数 | `authCode` | `code` | `code` |
| 应用消息 | 工作通知 `asyncsend_v2`（有链接时 `action_card`，否则 `markdown`），每批 100 人 | `/cgi-bin/message/send`（`textcard` / `text`），每批 1000 人 | `/open-apis/im/v1/messages`（`interactive` 卡片，`receive_id_type=user_id`），逐人发送 |
| 通讯录 | 从根部门 1 广度遍历 `department/listsub`，按部门分页 `v2/user/list` | `department/list` 一次取全部，再按部门 `user/list` | `departments/0/children?fetch_child=true` 分页，按部门 `users/find_by_department` |
| 群机器人 | markdown；加签：`timestamp` + `sign`（以密钥为 key 对「时间戳\n密钥」HmacSHA256）拼到 URL | markdown，不支持加签 | 卡片；加签：以「时间戳\n密钥」为 key 对空串 HmacSHA256，`timestamp`、`sign` 放在请求体 |

成员可能属于多个部门，通讯录中按 userid 去重，`deptId` 取遍历到的第一个部门。

## ImHttp

- 使用 JDK HttpClient 的 `RestClient`，连接超时 5 秒、读取超时 15 秒；
- 不论 HTTP 状态码都把响应体按 JSON 读取（平台的错误码在响应体中），网络或解析错误转为 `BizException("system.error.apiCallFailedCheckNetwork", 平台名称, 原因)`（「钉钉接口调用失败，请检查网络：…」）；
- `uri(base, path, k1, v1, ...)` 拼接地址并对查询参数编码，值为空的参数忽略；
- **access_token 缓存**：`accessToken(config, refresh, loader)` 以 `im:token:{租户ID}:{平台}` 缓存，过期时间为平台返回的有效期减 5 分钟；`refresh = true`（测试连接）时忽略缓存重新获取；保存配置时 `evictToken` 清理当前租户该平台的令牌。

## 配置的读取与保存

- `GET /system/im/config`（`sys:im:list`）返回三个平台的配置，未保存过的返回默认值（未启用、登录和消息推送开启、自动创建关闭、群机器人类别 `ALERT`）。`appSecret`、`robotSecret` 为 `WRITE_ONLY`，只返回 `appSecretSet`、`robotSecretSet`；填写了 `homeUrl` 时附带只读的 `callbackUrl`（`{homeUrl}/im-callback`）和 `entryUrl`（`{homeUrl}/im-login?platform=&tenant=`）；
- `PUT /system/im/config`（`sys:im:edit`）：去掉首尾空白和 `homeUrl` 末尾的 `/`，`homeUrl` 须匹配 `http(s)://域名[:端口][/路径]`；启用时按平台校验必填项（钉钉 Client ID、飞书 App ID、企业微信企业ID；密钥；钉钉和企业微信的 AgentId；系统访问地址）；AgentId 只能是数字；Webhook 必须以 `robotPrefix()` 开头。密钥为空表示不修改，清空加签密钥需要传 `clearRobotSecret = true`；
- `@OperLog` 的 `OperLogAspect.SECRET_FIELDS` 中加入了 `appSecret`、`robotWebhook`、`robotSecret`，操作日志中完全隐藏；
- `POST /system/im/{platform}/verify`：`client.verify` 重新获取令牌；当前用户已绑定时再给自己发一条「集成测试」消息；`POST /system/im/{platform}/robot-test` 向群机器人发测试消息。

## 授权登录与绑定

OAuth 授权码方式，前端两个免登录页面（`router/index.js` 的 `WHITE_LIST` 和 `BARE_PAGES`，已登录时也不加载菜单路由）：

| 前端路由 | 组件 | 作用 |
| --- | --- | --- |
| `/im-callback` | `views/login/ImCallback.vue` | 平台授权后跳回的回调页：取 `authCode`（钉钉）或 `code` 和 `state`，调用 `POST /auth/im/callback`，登录时保存令牌，绑定时回到个人中心 |
| `/im-login?platform=&tenant=&redirect=` | `views/login/ImEntry.vue` | 免登入口（应用首页、消息链接）：本地令牌仍有效（直接 `fetch('/api/auth/info')` 校验）时进入 `redirect`；否则清除令牌，按 UA 判断是否在平台客户端内（`utils/im.js` 的 `detectImApp`），请求授权页地址后跳转 |

后端接口：

| 接口 | 鉴权 | 说明 |
| --- | --- | --- |
| `GET /auth/im/providers?tenantName=` | 免登录 | 登录页显示的平台：租户已启用且 `loginEnabled` 的配置；租户名称无效时返回空列表 |
| `GET /auth/im/{platform}/authorize?tenantName=&tenantId=&inApp=&redirect=` | 免登录 | 登录用的授权页地址。租户：未开启 SaaS 时为平台租户；有 `tenantId`（免登入口）时校验租户可用；否则按 `tenantName` 解析 |
| `POST /auth/im/callback` `{code, state}` | 免登录 | 回调：登录返回 `{platform, bind:false, token, passwordExpired, redirect}`，绑定返回 `{bind:true}` |
| `GET /system/im/mine` | 登录即可 | 个人中心：当前租户已启用的平台及本人的绑定 |
| `GET /system/im/mine/{platform}/bind-url` | 登录即可 | 绑定用的授权页地址（只要求平台已启用，不要求开启登录） |
| `DELETE /system/im/mine/{platform}` | 登录即可 | 解除本人的绑定 |

`SecurityConfig` 中的放行：

```java
// 钉钉、企业微信、飞书授权登录：授权页地址和回调
.requestMatchers("/auth/im/**").permitAll()
```

流程（`SysImAuthService`）：

1. 生成授权页地址时创建 `State(tenantId, platform, bind, userId, redirect)`，以 `SecureRandom` 的 16 字节十六进制作为 `state`，存入缓存 `im:state:{state}`，10 分钟有效；`redirect` 只接受以 `/` 开头、不以 `//` 开头、不含 `\`、不超过 255 个字符的站内路由，否则丢弃。回调地址固定为 `{homeUrl}/im-callback`，`homeUrl` 为空时提示「请先在第三方集成中填写系统访问地址」。
2. 平台授权后跳回 `/im-callback`。`callback` 读取并**立即删除** state（一次有效，不存在时提示「授权已过期，请重新操作」），按 state 中的租户设置 `TenantContext`，再用授权码换取成员 userid。
3. 绑定：`bind(userId, platform, imUserId, imName)`——该成员已绑定其他用户时报错，用户已绑定其他成员时改为新成员。
4. 登录：按 `sys_im_user` 找到用户，调用 `AuthService.loginAs(user, platform.loginLabel())`（第二个参数是登录方式的消息键，如 `system.label.dingtalkLogin`，登录日志按中文记录）：停用账号、门户账号（`supplierId` / `customerId` 不为空）拒绝，之后与密码登录相同地 `createToken`、记录登录日志（「钉钉登录成功」）、返回 `passwordExpired`。未绑定时调用 `recordLoginFailure("钉钉:userid", ...)` 记入登录日志并提示先绑定。

`AuthService.login` 和 `loginAs` 共用 `issue()` 签发令牌，第三方登录不经过密码错误锁定和验证码。

## 消息推送

```java
// SysMessageService.send：写入站内消息后
publisher.publishEvent(new MessageSentEvent(List.copyOf(targets), message));
```

`SysImPushService.onMessage` 用 `@Async` + `@TransactionalEventListener(AFTER_COMMIT, fallbackExecution = true)` 监听：业务事务提交后异步推送，回滚时不推送；没有事务时也执行。对当前租户每个已启用的配置：

- `messageEnabled` 时，查出接收人中已绑定该平台的成员，调用 `client.send`；
- `robotWebhook` 不为空且消息的 `category` 在 `robotCategories` 中时，调用 `client.robot`（每个事件一次，与接收人数无关）；
- 卡片链接为 `entryUrl(config, message.link())`，即 `{homeUrl}/im-login?platform=&tenant=&redirect={站内路由}`，消息没有链接时为 `/`；没有 `homeUrl` 时只发文字；
- 异常只 `log.warn`，不重试、不影响站内消息；
- 推送的标题、内容来自站内消息（存库内容，中文），卡片按钮「查看详情」（企业微信「详情」）也固定为中文，不按接收人的界面语言变化（源码中这些字面量带 `// i18n-ignore`）。

去重键（`dedupKey`）过滤后没有接收人时 `send` 直接返回，不发布事件，所以定时提醒在平台中同样每天只推一次。业务模块继续只依赖 `framework/message/MessageSender`，不需要知道推送的存在。

## 通讯录同步

`POST /system/im/{platform}/sync`（`sys:im:sync`，前端超时 180 秒）：

1. 先在事务外调用 `client.contacts` 读取通讯录（网络调用不放在事务中），再用 `TransactionTemplate` 执行 `apply`，最后 `markSynced` 保存结果摘要（`ImSyncResult.summary()`，截断到 255 字符）。
2. 开启 `syncCreate` 时 `syncDepts`：平台根部门对应 `parent_id = 0` 中排序最小的部门；其余部门先查 `sys_im_dept` 的对应关系（系统部门已删除的对应关系一并删除），没有时按「上级 ID + 名称」匹配已有部门，再没有则新建，并记录对应关系；已对应的部门在平台改名后同步修改名称。
3. 成员处理：已绑定的跳过；手机号规范化（只保留数字，13 位且以 86 开头时去掉 86，少于 5 位视为无）后在非门户账号中查找，恰好一个且该用户未绑定本平台时绑定；开启 `syncCreate` 且没有同手机号用户时调用 `SysOrgSyncService.create`（检查套餐账号上限、初始密码、`pwdReset = 1`，不分配角色）开通账号，登录名优先用手机号，否则为 `{平台小写}_{userid}`（非法字符替换为 `_`，重复时加 `_2`…）；开通失败（如账号达到套餐上限）后不再开通，其余成员计入未绑定并返回 `warning`。
4. 新建了部门或账号时 `tokenService.evictAllLoginUsers()` 清理权限缓存。

同步只增加和改名，不删除部门、不停用账号（离职由人事的 `EmployeeLeftEvent` 处理）。

成员绑定列表 `GET /system/im/bindings?platform=&bound=&keyword=`（`SysImUserMapper.selectBindingPage`）以 `sys_user` 为主表 LEFT JOIN `sys_dept`、`sys_im_user`，排除门户账号；手工绑定 `POST /system/im/bindings` 不向平台核实 userid；解绑 `DELETE /system/im/bindings/{绑定ID}`。

## 缓存

| 前缀 | 内容 | 过期 |
| --- | --- | --- |
| `im:token:` | 应用 access_token，key 为 `im:token:{租户ID}:{平台}` | 平台返回的有效期减 5 分钟，保存配置时清理 |
| `im:state:` | 授权 `State`，key 为 `im:state:{随机数}` | 10 分钟，回调时删除 |

两者都登记在 `CacheMonitorService.CACHES`（「第三方集成令牌」「第三方授权」）。多实例部署时必须使用 Redis（`lemon.cache.type=redis`）：发起授权和处理回调可能落在不同实例上，进程内缓存会导致「授权已过期」。

## 配置项

`ImProperties`（`lemon.im.*`）只有各平台开放接口的地址，默认为官方地址，一般不需要配置；应用凭证在页面上按租户配置，不放在配置文件中。

| 配置项 | 默认值 |
| --- | --- |
| `lemon.im.dingtalk.oapi` | `https://oapi.dingtalk.com`（旧版服务端接口：access_token、工作通知、通讯录、群机器人） |
| `lemon.im.dingtalk.api` | `https://api.dingtalk.com`（新版接口：用户授权） |
| `lemon.im.dingtalk.login` | `https://login.dingtalk.com`（登录授权页） |
| `lemon.im.wecom.api` | `https://qyapi.weixin.qq.com` |
| `lemon.im.wecom.open` | `https://open.weixin.qq.com`（客户端内网页授权） |
| `lemon.im.wecom.login` | `https://login.work.weixin.qq.com`（浏览器扫码登录） |
| `lemon.im.feishu.api` | `https://open.feishu.cn` |
| `lemon.im.feishu.accounts` | `https://accounts.feishu.cn` |

使用 Lark 国际版时：

```yaml
lemon:
  im:
    feishu:
      api: https://open.larksuite.com
      accounts: https://accounts.larksuite.com
```

注意群机器人 Webhook 的前缀校验也取自这些地址（`robotPrefix()`），修改后页面提示的前缀（前端 `views/system/im/index.vue` 的 `ROBOT_PREFIX`）需要同步修改。

## 扩展一个新平台

以接入某个新的 IM 平台为例：

1. **枚举与字典**：在 `ImPlatform` 中增加枚举值，参数为名称和登录方式（如「钉钉登录」）的消息键，在 `system.properties`、`system_en.properties` 中登记（`text()` 按请求语言取名称，`defaultText()` 取中文写入登录日志等存库内容），并在 `sql/init.sql` 和升级脚本中给字典 `sys_im_platform` 增加同名的值（`sys_im_config.platform` 等列为 `VARCHAR(16)`）。
2. **实现 `ImClient`**：新建 `XxxClient implements ImClient`，标注 `@Component`，注入 `ImHttp` 和 `ImProperties`（在 `ImProperties` 中增加该平台的接口地址）。access_token 用 `http.accessToken(config, refresh, loader)` 获取，错误用 `ImHttp.error` 转换；`contacts` 返回的部门要上级在前、根部门 `parentId` 为 null。`SysImConfigService` 按 `platform()` 自动收集，不需要登记。
3. **凭证字段**：优先复用 `corpId`、`appKey`、`appSecret`、`agentId`；在 `SysImConfigService.save` 的必填校验中加入新平台的分支。
4. **回调参数**：平台回调的授权码参数名不是 `code` 时，在 `ImCallback.vue` 中读取；平台客户端的 UA 加到 `utils/im.js` 的 `detectImApp`。
5. **前端**：`utils/im.js` 的 `IM_PLATFORMS`（名称、简称用 `t('components.im.xxx')`，在两个语言包的 `components.js` 中加译文；颜色，`ImPlatformIcon` 使用），`views/system/im/index.vue` 的 `FIELDS`（凭证字段）、`ROBOT_PREFIX`、`USERID_HELP`、`GUIDES`（接入步骤）；平台卡片布局是三列网格，平台增多时调整样式。
6. **测试**：`lemon-admin` 的 `ImIntegrationTests` 用 JDK `HttpServer` 在本地模拟三个平台的接口（测试中把注入的 `ImProperties` 各地址改为本地服务，结束后恢复），新平台按同样方式补充授权、消息、通讯录、群机器人的用例。

::: warning 不要
- 不要把应用密钥写到日志或返回给前端；新增的密钥字段要设为 `JsonProperty.Access.WRITE_ONLY` 并加入 `OperLogAspect.SECRET_FIELDS`。
- 不要在 `/auth/im` 下增加需要登录或会修改业务数据的接口，这个路径整体免登录。
- 不要在业务模块中直接调用 `ImClient`：业务通知一律通过 `MessageSender` 发送站内消息，由推送服务转发。
:::
