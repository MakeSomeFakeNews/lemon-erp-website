---
order: 9
---

# 新增缓存

业务代码中需要缓存时，注入框架层的 `CacheService`，不要直接使用 `StringRedisTemplate`：这样在 Redis 和进程内缓存（`lemon.cache.type=memory`）之间切换时代码不需要修改，也能统一出现在缓存监控中。缓存的实现与已有缓存见 [缓存](../architecture/cache)。

## 示例：缓存单据的统计结果

```java
package com.lemon.erp.modules.oa.service;

import com.lemon.erp.framework.cache.CacheService;
import com.lemon.erp.framework.tenant.TenantContext;
import com.lemon.erp.modules.oa.dto.CarStat;
import com.lemon.erp.modules.oa.mapper.OaCarRequestMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Duration;

@Service
@RequiredArgsConstructor
public class OaCarStatService {

    /** 缓存前缀：在 CacheMonitorService.CACHES 中登记 */
    public static final String CACHE_KEY = "oa:car:stat:";
    private static final Duration CACHE_TTL = Duration.ofMinutes(10);

    private final CacheService cache;
    private final OaCarRequestMapper requestMapper;

    /** 本月用车统计（按租户缓存 10 分钟） */
    public CarStat monthStat() {
        String key = CACHE_KEY + TenantContext.require();
        CarStat cached = cache.get(key, CarStat.class);
        if (cached != null) {
            return cached;
        }
        CarStat stat = requestMapper.selectMonthStat();   // 在 mapper XML 中用 COUNT / SUM 统计
        cache.set(key, stat, CACHE_TTL);
        return stat;
    }

    /** 数据变化后删除缓存，下次读取时重新加载 */
    public void evict() {
        cache.delete(CACHE_KEY + TenantContext.require());
    }
}
```

统计结果用 record 定义在 dto 中，Mapper 中声明 `CarStat selectMonthStat();`，SQL 写在 `OaCarRequestMapper.xml` 中：

```java
package com.lemon.erp.modules.oa.dto;

/** 本月用车统计：申请数、已批准数、乘车人次 */
public record CarStat(long total, long approved, long passengers) {
}
```

## 键的命名

- 以「模块:功能:」开头，冒号分隔，如 `oa:car:stat:`，避免与其他缓存冲突，也便于按前缀清理；
- 已使用的前缀：`login:token:`、`login:perms:`、`login:fail:`、`login:captcha:`、`dict:`、`settings:all`、`bizrule:`、`im:token:`、`im:state:`，不要占用；
- **多租户**：以租户内唯一的值（用户名、编码、统计范围等）作 key 时，带上租户 ID（`TenantContext.require()`）；以全局唯一的 ID（用户 ID、单据 ID）作 key，或缓存平台共享表的数据时不需要；
- 与其他项目共用 Redis 时，前缀是区分数据的唯一依据。

## 值与过期时间

- 值以 JSON 存储，建议缓存 record 或简单 POJO；集合用数组类型读取，如 `cache.get(key, SysDictData[].class)`；
- 设置合理的过期时间（`ttl` 为 null 表示永不过期，一般不要这样做），即使失效逻辑有遗漏，数据也会在过期后自动更新；
- 不要缓存大对象（如整张表的明细），Redis 中单个值建议不超过几百 KB；
- 批量读取用 `cache.getAll(keys, type)`（Redis 实现为一次 `MGET`）；只需要数量时用 `cache.keys(prefix).size()`，不读取值。

## 失效

- 数据修改后删除缓存（不要「修改后更新缓存」，并发时容易写入旧值）；
- 在事务中修改数据时，最好在**事务提交后**删除缓存，否则并发请求可能在提交前把旧数据重新加载进缓存。参照 `TokenService` 的写法：

```java
private static void afterCommit(Runnable action) {
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                action.run();
            }
        });
    } else {
        action.run();
    }
}
```

- 按前缀批量删除用 `cache.deleteByPrefix(prefix)`（Redis 实现基于 `SCAN`，不会阻塞 Redis）。

## 登记到缓存监控

在 monitor 模块的 `CacheMonitorService.CACHES` 中登记新前缀，「系统监控 → 缓存监控」才会列出该缓存，可以查看 key、查看值、删除和清空：

```java
private static final List<CacheName> CACHES = List.of(
        new CacheName(TokenService.TOKEN_KEY, "monitor.label.loginSessions", "monitor.label.sessionsOnlineUsersAfterClearingAll", 0),
        new CacheName(TokenService.PERMS_KEY, "monitor.label.userPermissions", "monitor.label.rolesPermissionsSignedUsersReloadedAutomatic", 0),
        // ...
        new CacheName(OaCarStatService.CACHE_KEY, "monitor.label.oaCarStat", "monitor.label.oaCarStatRemark", 0));
```

`CacheName` 的参数依次为前缀、名称、说明、数量（登记时填 0，页面上实时统计）。名称和说明是消息键，登记在 monitor 模块的 `monitor.properties`、`monitor_en.properties` 中（如 `monitor.label.oaCarStat=用车统计`），页面按请求语言显示。缓存监控只开放登记过的前缀，不能通过接口查看或删除任意 key。

::: warning 模块依赖
`CacheMonitorService` 在 monitor 模块中，monitor 只依赖 system。如果新缓存的常量定义在其他业务模块（如上例的 oa），monitor 无法引用该类：可以在 `CACHES` 中直接写前缀字符串，或把前缀常量定义在 framework 中。
:::

## 进程内缓存的使用场景

只读、不随租户变化、不会修改的数据（如按流程定义 ID 缓存的流程设计）可以直接用 `ConcurrentHashMap` 做进程内缓存，多实例下天然一致，也不需要登记到缓存监控。可能被修改的数据不要用进程内缓存，多实例部署时各实例之间无法同步失效。
