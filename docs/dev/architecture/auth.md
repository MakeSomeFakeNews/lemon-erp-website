---
order: 2
---

# 认证与会话

柠檬ERP 使用「JWT + 服务端会话」的认证方式：JWT 只携带会话 ID，真正的登录状态保存在缓存中。这样既保持了无状态接口的便利，又可以随时让令牌失效（退出登录、强制下线、停用账号、重置密码后立即生效）。

## 相关类

| 类 | 位置 | 职责 |
| --- | --- | --- |
| `JwtTokenProvider` | framework/security | 签发、解析 JWT（HMAC，密钥 `lemon.jwt.secret`） |
| `TokenService` | framework/security | 创建 / 删除会话，在线会话列表，登录用户（权限）缓存 |
| `JwtAuthenticationFilter` | framework/security | 每个请求解析令牌、校验会话、设置租户、加载登录用户 |
| `LoginUser` | framework/security | 当前登录用户（record），放在 `SecurityContext` 的 principal 中 |
| `LoginUserLoader` | framework/security | 从数据库加载登录用户的接口，由 system 模块的 `SysLoginUserLoader` 实现 |
| `SecurityUtils` | framework/security | 静态方法取当前用户、用户 ID、数据权限、门户关联的供应商 / 客户 |
| `SecurityConfig` | framework/config | Spring Security 配置：无状态、关闭表单登录和 CSRF、放行公开接口 |
| `AuthService` / `AuthController` | modules/system | 登录、退出、当前用户信息、当前用户菜单 |
| `PasswordPolicy`、`CaptchaService` | modules/system | 登录失败锁定、密码策略与过期、验证码 |
| `SysImAuthService` / `ImAuthController` | modules/system | 钉钉、企业微信、飞书授权登录（OAuth 授权码），见 [第三方集成](./im) |

## 登录流程

`POST /api/auth/login`，请求体：

```json
{ "username": "admin", "password": "admin123", "tenantName": "柠檬科技", "captchaId": null, "captchaCode": null }
```

`AuthService.login` 的处理顺序：

1. **确定租户**：按 `tenantName` 解析租户并设置 `TenantContext`，之后的查询（用户、登录日志）都在该租户下执行。未开启 SaaS 时为平台租户。
2. **锁定检查**：同一用户名连续失败次数达到「密码错误锁定次数」时拒绝登录（锁定期间密码正确也不行）。
3. **验证码**：参数「登录验证码」为「每次登录」，或为「密码输错后」且该用户名有失败记录时，校验验证码（`GET /api/auth/captcha` 获取，2 分钟有效，校验一次作废）。验证码错误不计入密码错误次数。
4. **校验用户名和密码**（BCrypt）：失败时累加失败次数（不存在的用户名同样计数，避免借此探测账号），剩余 2 次以内时提示「再错 N 次将锁定账号」。
5. **校验账号状态**：停用的账号不能登录。
6. **创建会话**：清除失败次数，`TokenService.createToken` 创建会话并签发 JWT，发布登录日志事件。
7. 返回 `{ token, passwordExpired }`：`passwordExpired` 为 true 时（管理员设置的初始密码、重置过的密码、超过密码有效期），前端提示用户修改密码。

## 令牌与会话

`TokenService.createToken` 的处理：

- 开启了参数「同一账号只允许一处登录」时，先删除该用户已有的全部会话；
- 生成随机的会话 ID（UUID），记录 IP、归属地、浏览器、操作系统、登录时间、租户，以 `OnlineSession` 存入缓存 `login:token:{tokenId}`，过期时间为「登录有效期（小时）」；
- 签发 JWT：`jti` 为会话 ID，`sub` 为用户 ID，附带 `username`，过期时间与会话一致。

| 缓存键 | 内容 | 过期 | 清理时机 |
| --- | --- | --- | --- |
| `login:token:{tokenId}` | `OnlineSession` 登录会话 | 登录有效期 | 退出登录、强制下线、停用 / 删除账号、重置密码、租户停用或到期 |
| `login:perms:{userId}` | `LoginUser`（角色、权限、数据权限、租户、门户关联） | 30 分钟 | 用户、角色、菜单、部门、租户套餐变更后（事务提交后清理） |

## 请求认证

`JwtAuthenticationFilter`（`OncePerRequestFilter`）对每个请求：

1. 读取 `Authorization: Bearer <token>`，解析出会话 ID；签名无效或已过期时视为未登录。
2. 按会话 ID 读取 `login:token:*`，会话不存在（已退出、被强退）时视为未登录。
3. 按会话中的租户设置 `TenantContext`（请求结束后清除）。
4. `TokenService.getLoginUser(userId)` 读取权限缓存，未命中时调用 `LoginUserLoader` 从数据库加载并缓存 30 分钟；用户已停用或租户已失效时返回 null，视为未登录。
5. 把 `LoginUser` 及其权限放入 `SecurityContext`。
6. 门户账号（供应商 / 经销商）访问不属于其门户的接口时直接返回 403，见 [供应商门户接口开发](../guide/portal)。

未登录访问需要认证的接口时返回 HTTP 401 和 `{"code":401,"msg":"未登录或登录已过期"}`，前端拦截器清除令牌并跳转登录页。

不需要登录的接口只有：`/auth/login`、`/auth/config`、`/auth/captcha`、`/error`，GET `/files/**`（头像等公开文件），GET `/screen-share/**`（数据大屏投屏链接，见下文），以及 `/auth/im/**`（钉钉、企业微信、飞书授权登录，见下文）。新增公开接口需要修改 `SecurityConfig`，一般不建议。

### 投屏链接（免登录）

数据大屏的投屏链接供车间、仓库的电视免登录查看大屏，是唯一不需要登录就能读取业务数据的入口：

```java
// SecurityConfig：免登录只读，按链接令牌校验
.requestMatchers(HttpMethod.GET, "/screen-share/**").permitAll()
```

| 接口 | 说明 |
| --- | --- |
| `GET /screen-share/{token}` | 链接信息：名称、企业名称、大屏清单、轮播间隔、工作中心 |
| `GET /screen-share/{token}/{key}` | 大屏数据，`key` 必须在链接的大屏清单中，否则提示「链接中没有该大屏」 |

校验在 `BiScreenShareService.resolve` 中完成：

1. 令牌是 `SecureRandom` 生成的 16 字节（128 位）随机数的十六进制（32 个字符），保存在 `bi_screen_share.token`（唯一索引）；长度不是 32 的直接拒绝。
2. 请求没有租户上下文，用 `TenantContext.callIgnore` 跨租户按令牌查找，再用 `TenantContext.callAs(链接所属租户, ...)` 统计数据，因此只能看到创建该链接的租户的数据。
3. 链接不存在、已停用（`status = 0`）或已过有效期（`expire_time`）时统一提示「投屏链接无效、已停用或已过期」，不区分原因。
4. 最近访问时间（`last_access_time`）最多每 5 分钟更新一次，避免每次刷新都写库。

链接的新建、修改、重置令牌（`POST /bi/screen/share/{id}/reset`，旧令牌立即失效）、删除在 `/bi/screen/share` 下，需要 `bi:screen:share` 按钮权限和「全部数据」数据权限（创建链接等于把全公司汇总数据开放给一台设备），并记录操作日志（重置令牌不记录返回结果，避免新令牌出现在日志中）。登录后查看大屏的 `GET /bi/screen/{key}` 需要 `bi:screen:list` 和「全部数据」。

投屏接口只返回大屏的汇总数据，不要在 `/screen-share` 下增加其他接口，也不要在大屏中加入薪资等只适合部分用户查看的数据。

### 第三方登录（钉钉 / 企业微信 / 飞书）

```java
// SecurityConfig：授权页地址和回调
.requestMatchers("/auth/im/**").permitAll()
```

| 接口 | 说明 |
| --- | --- |
| `GET /auth/im/providers?tenantName=` | 登录页显示的平台（租户已启用并开启登录的配置） |
| `GET /auth/im/{platform}/authorize` | 生成授权页地址：登录页传 `tenantName`，免登入口 `/im-login` 传 `tenantId`；`inApp` 表示在平台客户端内打开；`redirect` 为登录后进入的站内路由 |
| `POST /auth/im/callback` | 前端回调页 `/im-callback` 提交 `{code, state}`，登录返回令牌，绑定则保存绑定关系 |

与密码登录的区别：

1. 租户和用途来自授权时创建的 `state`（`SecureRandom` 128 位随机数，缓存 `im:state:` 10 分钟，回调时读取后立即删除），不信任回调请求中的其他参数；
2. 授权码由平台换成成员 userid，按 `sys_im_user` 的绑定关系找到用户。未绑定时 `AuthService.recordLoginFailure` 记入登录日志（用户名为「钉钉:userid」）并提示先绑定；
3. `AuthService.loginAs(user, "钉钉登录")` 校验账号启用、不是门户账号，然后与密码登录共用 `issue()`：`createToken`、登录日志（「钉钉登录成功」）、返回 `passwordExpired`。第三方登录不经过验证码和密码错误锁定；
4. 授权页地址中的回调地址固定为 `{系统访问地址}/im-callback`，必须与平台中登记的一致；`redirect` 只接受站内路由，防止借登录跳转到外部网站。

已登录用户绑定本人账号走同一流程（`GET /system/im/mine/{platform}/bind-url`，state 中记录当前用户 ID）。前端 `/im-callback`、`/im-login` 在路由白名单中，且已登录时也不加载菜单路由（`BARE_PAGES`），由页面自行处理令牌。完整流程见 [第三方集成](./im#授权登录与绑定)。

## LoginUser

```java
public record LoginUser(Long userId, String username, Long deptId, Set<String> roles, Set<String> perms,
                        DataScope dataScope, String tokenId, Long tenantId, Long supplierId, Long customerId) {
    public boolean isAdmin();     // 平台租户中角色编码为 admin 的用户（超级管理员）
    public boolean isSupplier();  // 供应商门户账号
    public boolean isDealer();    // 经销商门户账号
}
```

业务代码中获取当前用户：

```java
LoginUser user = SecurityUtils.getLoginUser();   // 未登录抛 BizException(401)
Long userId = SecurityUtils.getUserId();
Long userIdOrNull = SecurityUtils.getUserIdOrNull(); // 异步线程、定时任务中可能为 null
DataScope scope = SecurityUtils.getDataScope();
```

`SysLoginUserLoader` 加载时的规则：

- 平台租户的 admin 角色拥有通配权限 `*:*:*` 和全部数据权限；
- 其他用户的权限是其启用角色的菜单权限并集，租户用户以租户套餐为上限，非平台租户去掉平台专属权限（`PlatformFeatures`）；
- 门户账号只保留所属门户的权限（`portal:*` 或 `dealer:*`），数据权限为仅本人；
- 数据权限由 `SysDataScopeResolver` 按多个角色取并集计算，见 [数据权限](./data-scope)。

## 会话失效的场景

| 操作 | 处理 |
| --- | --- |
| 退出登录 | 删除当前会话 |
| 系统监控 → 在线用户 → 强制下线 | 删除指定会话 |
| 通讯录同步新建了部门或账号 | 清空全部权限缓存（`login:perms:*`） |
| 停用、删除用户，重置密码 | `kickUser`：删除该用户全部会话并清除权限缓存 |
| 修改用户角色、部门 | 清除该用户的权限缓存，下次请求重新加载 |
| 修改角色权限、菜单、部门，修改租户套餐 | 清空全部权限缓存（`login:perms:*`） |
| 租户停用、到期 | `kickTenant`：删除该租户全部会话 |
| 修改 `lemon.jwt.secret` | 已签发的令牌全部无法通过签名校验 |

权限缓存的清理在事务提交后执行（`TransactionSynchronization.afterCommit`），避免并发请求在提交前把旧权限重新加载进缓存。

::: warning 直接修改数据库后
直接用 SQL 修改了角色、菜单、用户角色等权限数据时，需要手工删除 Redis 中的 `login:perms:*`（或在「系统监控 → 缓存监控」中清空「用户权限」），否则最多 30 分钟后才生效。
:::

## 前端

- 登录成功后令牌保存在 `localStorage`（键 `lemon_erp_token`），`utils/request.js` 的请求拦截器自动加上 `Authorization: Bearer` 请求头。
- 路由守卫在首次进入页面时请求 `/auth/info` 和 `/auth/menus`，生成动态路由；没有令牌时跳转 `/login?redirect=原地址`。
- 响应 `code` 为 401 或 HTTP 状态 401 时，清除令牌并跳转登录页（多个并发请求只处理一次）。
- 登录页在进入前请求 `/auth/config`，获取是否开启 SaaS（显示「租户」输入框）、系统名称、验证码模式、密码策略、水印等公开配置。
