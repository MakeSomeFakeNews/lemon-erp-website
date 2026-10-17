---
order: 11
---

# 新租户初始化

开启 SaaS 多租户后，平台租户在「系统管理 → 租户管理」中开通新租户。新租户的业务表是空的，但很多功能依赖基础数据才能使用（会计科目、考勤班次、流程模型等）。各模块通过实现 `TenantInitializer`，在开通租户时为新租户准备本模块的基础数据。多租户机制见 [SaaS 多租户](../architecture/tenant)。

## 开通租户的过程

`SysTenantService.create`：

1. 保存租户记录；
2. 切换到新租户的上下文（`TenantContext.runAs(新租户ID, …)`），在同一事务中：
   1. 系统模块开通根部门、租户管理员账号（首次登录要求修改密码），从平台复制内置岗位角色（菜单取与套餐的交集），得到「平台角色 ID → 新租户角色 ID」的映射；
   2. 按 `@Order` 顺序调用所有 `TenantInitializer` Bean 的 `initialize(context)`。

任一初始化器抛出异常，整个开通操作回滚。

已有的初始化器：

| 实现 | 模块 | 复制的数据 |
| --- | --- | --- |
| `SysDictTenantInitializer` | system | 业务字典的取值（`SysDictService.copyBusinessData`：平台中全部业务字典的数据复制一份到新租户，之后由租户在「业务字典」中维护） |
| `WmsTenantInitializer` | wms | 规格属性及属性值（颜色、尺码，多规格物料生成 SKU 时使用） |
| `FinTenantInitializer` | fin | 币种、会计科目表（按编码层级复制，上级科目 ID 换成新租户中的） |
| `HrTenantInitializer` | hr | 班次（考勤、请假折算工时依赖默认班次） |
| `BiTenantInitializer` | bi | 预警规则 |
| `WfTenantInitializer` | workflow | 流程模型：复制为未发布的草稿，审批角色换成新租户中对应的角色，指定成员清空 |

## TenantInitializer 接口

```java
public interface TenantInitializer {

    void initialize(Context context);

    /** 从平台复制的记录清空 ID 和时间，作为新记录插入 */
    static <T extends BaseEntity> T asNew(T entity);

    /**
     * @param tenantId  新租户
     * @param menuIds   套餐包含的菜单
     * @param roleIdMap 平台内置角色 ID → 新租户中对应角色 ID
     */
    record Context(Long tenantId, String tenantName, Set<Long> menuIds, Map<Long, Long> roleIdMap) { }
}
```

`initialize` 在**新租户的上下文中**执行，直接插入的数据由多租户拦截器自动填充新租户的 `tenant_id`。

## 示例：复制模板数据

最常见的写法是从平台租户读取模板数据，再在新租户中插入（`HrTenantInitializer`）：

```java
@Component
@RequiredArgsConstructor
public class HrTenantInitializer implements TenantInitializer {

    private final HrShiftMapper shiftMapper;

    @Override
    public void initialize(Context context) {
        TenantContext.callAs(TenantContext.PLATFORM_TENANT_ID, () -> shiftMapper.selectList(Wrappers.emptyWrapper()))
                .forEach(s -> shiftMapper.insert(TenantInitializer.asNew(s)));
    }
}
```

- `TenantContext.callAs(PLATFORM_TENANT_ID, …)` 临时切换到平台租户读取，结束后自动恢复为新租户；
- `TenantInitializer.asNew(entity)` 清空 `id`、`createTime`、`updateTime`，插入时生成新 ID 并自动填充时间和租户；
- 平台中的数据就是新租户的模板，管理员可以先在平台租户中维护好，再开通租户。

### 有上下级关系的数据

复制树形或互相引用的数据时，需要把引用的 ID 换成新租户中的 ID（`FinTenantInitializer`）：

```java
List<FinAccount> accounts = TenantContext.callAs(TenantContext.PLATFORM_TENANT_ID,
        () -> accountMapper.selectList(Wrappers.emptyWrapper()));
// 上级科目的编码更短，先插入
accounts.sort(Comparator.comparing((FinAccount a) -> a.getCode().length()).thenComparing(FinAccount::getCode));
Map<Long, Long> idMap = new HashMap<>();
for (FinAccount a : accounts) {
    Long platformId = a.getId();
    TenantInitializer.asNew(a);
    a.setParentId(a.getParentId() == null || a.getParentId() == 0 ? 0L : idMap.getOrDefault(a.getParentId(), 0L));
    accountMapper.insert(a);
    idMap.put(platformId, a.getId());
}
```

### 引用角色的数据

数据中引用了角色 ID（如审批人为角色）时，用 `context.roleIdMap()` 换成新租户中的角色；引用了具体用户、部门的配置不能复制（新租户中没有这些用户），应清空，由租户管理员重新设置。`WfTenantInitializer` 就是这样处理流程模型的审批人的。

### 只初始化套餐包含的功能

`context.menuIds()` 是套餐包含的菜单 ID，可以据此只为套餐中包含的功能准备数据（例如套餐中没有财务模块时不复制会计科目）。

## 编写要点

- **注册为 Spring Bean**（`@Component`），用 `@Order` 控制顺序（依赖其他模块初始化结果时排在后面）；系统模块的部门、角色、管理员在所有初始化器之前创建；
- **数据量控制**：只复制必要的基础数据和模板，不复制业务单据、示例数据；
- **批量插入**：数据较多时在 mapper XML 中写单条多值 `INSERT ... VALUES`，不要写 `INSERT ... SELECT`（多租户拦截器处理不完整，且跨租户读取需要先切换上下文）；
- **单据编号、编码规则**不需要初始化：编码规则未配置时使用 `DocNoCatalog` 中的默认规则，流水号按租户独立；
- **菜单、系统字典**是平台共享的，不需要初始化；**业务字典**由 `SysDictTenantInitializer` 统一复制，模块新增业务字典时只需在 `init.sql` 中插入平台（`tenant_id = 1`）的数据，不需要自己写初始化器；
- **可重复执行**：初始化只在开通时执行一次，但建议写成先检查再插入，便于为已存在的租户手工补数据。

## 为已有租户补数据

新版本增加了需要初始化的基础数据时，已开通的租户不会自动执行新的初始化器。可以：

- 编写一次性的维护脚本，按租户插入数据（SQL 中显式写 `tenant_id`）；
- 或在代码中提供平台专用的维护接口，用 `TenantContext.runAs(tenantId, …)` 逐个租户执行初始化逻辑。

## 未开启 SaaS 时

单租户模式下只有平台租户，不会开通新租户，初始化器不会被调用；平台租户的基础数据由 `init.sql` 提供。
