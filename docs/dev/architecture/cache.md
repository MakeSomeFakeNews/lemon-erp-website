---
order: 8
---

# 缓存

柠檬ERP 的缓存通过框架层的 `CacheService` 抽象访问，值统一以 JSON 字符串存储。默认实现为 Redis，本地体验时可以切换为进程内缓存。

## 两种实现

| `lemon.cache.type` | 实现类 | 说明 |
| --- | --- | --- |
| `redis`（默认，未配置时也是） | `RedisCacheService` | 基于 `StringRedisTemplate`；批量读取一次 `MGET`；按前缀列出 key 使用 `SCAN`（每批 500），不使用 `KEYS` |
| `memory` | `MemoryCacheService` | `ConcurrentHashMap` + 过期时间，同样以 JSON 存储以保持与 Redis 一致的语义；只适合单实例的本地体验，重启后全部丢失 |

两个实现通过 `@ConditionalOnProperty` 二选一注册，业务代码只注入 `CacheService` 接口。

## CacheService 接口

```java
public interface CacheService {
    <T> T get(String key, Class<T> type);
    default <T> List<T> getAll(List<String> keys, Class<T> type);   // 结果与 keys 顺序一致，不存在的为 null
    String getRaw(String key);                                        // 原始 JSON（缓存监控查看用）
    long getExpire(String key);                                       // 剩余秒数：-1 永不过期，-2 不存在
    void set(String key, Object value, Duration ttl);                 // ttl 为 null 表示不过期
    void delete(String key);
    Set<String> keys(String prefix);                                  // 列出指定前缀的 key
    default void deleteByPrefix(String prefix);
}
```

值使用 Spring 管理的 `ObjectMapper` 序列化，`get` 时按传入的类型反序列化。缓存的对象建议使用 record 或简单的 POJO，集合可以用数组类型读取（如 `cache.get(key, SysDictData[].class)`）。

## 已有缓存

| 前缀 | 名称 | 内容 | 过期 | 定义位置 |
| --- | --- | --- | --- | --- |
| `login:token:` | 登录会话 | `OnlineSession`，key 为会话 ID | 登录有效期 | `TokenService.TOKEN_KEY` |
| `login:perms:` | 用户权限 | `LoginUser`，key 为用户 ID | 30 分钟 | `TokenService.PERMS_KEY` |
| `dict:` | 字典数据 | 按字典类型缓存的字典数据 | 24 小时 | `SysDictService.CACHE_KEY` |
| `login:fail:` | 登录失败 | 按用户名记录的连续失败次数（非平台租户带租户 ID） | 锁定时长 | `PasswordPolicy.FAIL_KEY` |
| `login:captcha:` | 登录验证码 | 验证码答案 | 2 分钟，校验一次作废 | `CaptchaService.CACHE_KEY` |
| `settings:all` | 系统参数 | 参数设置中修改过的参数 | 12 小时 | `SysConfigService.CACHE_KEY` |
| `bizrule:` | 业务参数 | 按租户缓存的业务参数（修改过的），key 为 `bizrule:{租户ID}` | 12 小时 | `SysBizRuleService.CACHE_KEY` |
| `im:token:` | 第三方集成令牌 | 钉钉、企业微信、飞书应用的 access_token，key 为 `im:token:{租户ID}:{平台}` | 平台返回的有效期减 5 分钟，保存集成配置时清理 | `ImHttp.TOKEN_KEY` |
| `im:state:` | 第三方授权 | 授权登录 / 绑定的 `State`（租户、平台、用途、用户、登录后进入的页面），key 为 `im:state:{随机数}` | 10 分钟，回调时删除（一次有效） | `SysImAuthService.STATE_KEY` |

这些缓存都登记在 `CacheMonitorService.CACHES` 中，「系统监控 → 缓存监控」可以查看 key 数量、查看值、按 key 删除或清空整类缓存；缓存监控只开放这些前缀，不能通过接口查看或删除任意 key。Redis 模式下页面还显示 Redis 的运行信息和命令统计。

## 缓存一致性

- **修改后删除**：数据修改后删除对应缓存，下次读取时重新加载（Cache-Aside）。字典修改后删除 `dict:{type}`，参数保存后删除 `settings:all`，业务参数保存后删除当前租户的 `bizrule:{租户ID}`。
- **权限缓存在事务提交后删除**：`TokenService.evictLoginUser` / `evictAllLoginUsers` 通过 `TransactionSynchronization.afterCommit` 在提交后执行，避免并发请求在提交前把旧权限重新加载进缓存。新增类似的缓存清理时可以参照。
- **直接改库**：直接用 SQL 修改了角色、菜单、字典等数据后，需要手工删除对应前缀（`login:perms:*`、`dict:*`），或在缓存监控中清空。与其他项目共用 Redis 时只按前缀删除，不要执行 `FLUSHDB`。

## 多租户

缓存键以租户内唯一的值（用户名、编码等）作 key 时要带上租户 ID，例如 `PasswordPolicy`：

```java
private String failKey(String username) {
    return TenantContext.isPlatform() ? FAIL_KEY + username : FAIL_KEY + TenantContext.require() + ":" + username;
}
```

按租户保存的整体数据直接以租户 ID 作 key，例如业务参数 `bizrule:{租户ID}`（`SysBizRuleService`，没有租户上下文时按平台租户）、第三方集成的 access_token `im:token:{租户ID}:{平台}`。第三方授权的 `im:state:` 以随机数作 key，租户 ID 保存在值中，回调时据此设置租户上下文。以全局唯一 ID（用户 ID、会话 ID）作 key，或缓存平台共享表（字典、参数设置）的数据时不需要带租户。

## 进程内缓存

除 `CacheService` 外，少数只读且与租户无关的数据使用进程内缓存，例如 `FlowMetaService` 按流程定义 ID 缓存流程设计（流程定义发布后不会变化）；`PrintService` 按报表设计内容的 SHA-256 缓存编译后的 JasperReports 报表（最多 256 个，`JasperReport` 不可序列化，内容相同即结果相同）。各模块登记的业务参数定义（`BizRuleProvider`）、业务记录类型（`RecordTypeProvider`）在首次使用时汇总后保存在 Bean 中。这类缓存在多实例下天然一致，不需要登记到缓存监控。

## 前端缓存

- 字典：`store/dict.js` 按类型缓存字典数据，同一类型只请求一次；
- 公开配置：`store/config.js` 在进入页面前加载 `/auth/config`；
- 打印模板：`utils/printTemplates.js` 在首次打印时加载当前租户已保存的模板，打开打印模板管理页时重新加载；
- 自定义字段定义：`composables/useCustomFields.js` 按业务类型缓存启用的字段，同一页面只请求一次，自定义字段管理页修改定义后清理；
- 列设置、侧边栏折叠等个人偏好保存在 `localStorage`（`utils/storage.js`）。

新增缓存的开发步骤见 [新增缓存](../guide/cache)。
