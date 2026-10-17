---
order: 4
---

# 数据权限

数据权限控制用户能看到、能操作哪些部门或个人的数据。它是框架能力（`framework/security/datascope`），基于 MyBatis-Plus 的数据权限拦截器实现：业务代码只需要声明「哪张表、哪一列表示所属部门、哪一列表示所属用户」，SQL 条件由框架自动追加。

## 数据权限类型

角色的 `data_scope` 字段（字典 `sys_data_scope`，枚举 `DataScopeType`）：

| 值 | 类型 | 可访问的数据 |
| --- | --- | --- |
| 1 | 全部数据 | 不加任何条件 |
| 2 | 自定义数据 | `sys_role_dept` 中勾选的部门 |
| 3 | 本部门数据 | 用户所在部门 |
| 4 | 本部门及以下数据 | 用户所在部门及其全部下级部门 |
| 5 | 仅本人数据 | 数据所属用户为本人 |

一个用户有多个角色时取**并集**（`SysDataScopeResolver`）：任一角色为「全部数据」即为全部；否则把各角色的部门合并，任一角色为「仅本人」时再加上本人数据。计算结果为 `DataScope` record，随登录用户一起缓存：

```java
public record DataScope(boolean all, Set<Long> deptIds, Long selfUserId) { ... }
```

超级管理员（以及租户的 admin 角色）为全部数据；门户账号为仅本人。

## 声明式用法

在 Service 的查询方法上加 `@DataPermission`：

```java
@DataPermission(table = "scm_purchase_contract", deptColumn = "dept_id", userColumn = "create_by")
public PageResult<ScmPurchaseContract> page(long current, long size, ContractStatus status, Long supplierId, String keyword) {
    Page<ScmPurchaseContract> page = Page.of(current, size);
    contractMapper.selectPageList(page, status, supplierId, keyword);
    return PageResult.of(page);
}
```

方法执行期间，所有对 `scm_purchase_contract` 表的查询（包括 mapper XML 中的 JOIN、分页的 count 查询）都会追加：

```sql
AND (c.dept_id IN (当前用户可访问的部门) OR c.create_by = 当前用户ID)
```

条件中的表限定符使用 SQL 中该表的别名（上例 XML 中 `FROM scm_purchase_contract c`），没有别名时用表名。

| 属性 | 默认值 | 说明 |
| --- | --- | --- |
| `table` | 必填 | 需要过滤的表名（忽略大小写和反引号） |
| `deptColumn` | `dept_id` | 数据所属部门列，为空字符串表示不按部门过滤 |
| `userColumn` | `create_by` | 数据所属用户列（创建人、负责人等），用于「仅本人」，为空字符串表示不按用户过滤 |

生成条件的规则（`DataPermissionSqlHandler`）：

- 用户为「全部数据」时不追加条件；
- 有可访问部门且声明了部门列时生成 `部门列 IN (...)`；
- 有本人数据权限且声明了用户列时生成 `用户列 = 用户ID`；
- 两者用 OR 连接；都没有时追加恒假条件 `1 = 0`（看不到任何数据）。

只拼接开发者声明的列名和 Long 型 ID，不存在 SQL 注入。

## 编程式用法

`@DataPermission` 基于 Spring AOP，同一个类内部的方法互相调用时注解不生效；在修改、删除前校验记录是否可访问等场景，使用 `DataPermissionContext.execute`：

```java
public static final DataPermissionRule CONTRACT_RULE =
        new DataPermissionRule("scm_purchase_contract", "dept_id", "create_by");

private ScmPurchaseContract getAccessible(Long id) {
    Supplier<ScmPurchaseContract> loader = () -> contractMapper.selectById(id);
    ScmPurchaseContract contract = SecurityUtils.getDataScope().all()
            ? loader.get()
            : DataPermissionContext.execute(CONTRACT_RULE, loader);
    if (contract == null) {
        throw new BizException("采购合同不存在或没有权限");
    }
    return contract;
}
```

详情、修改、删除、审核等按 ID 操作的接口都应先这样校验，否则用户可以通过构造 ID 访问其他部门的数据。

规则支持嵌套：内层规则只在内层生效，退出后恢复外层规则；栈清空时移除 ThreadLocal，不会在线程池中泄漏。

## 实现原理

| 类 | 作用 |
| --- | --- |
| `DataPermission` | 注解 |
| `DataPermissionAspect` | 环绕切面：方法执行期间把规则压入 `DataPermissionContext` |
| `DataPermissionContext` | 当前线程生效的规则栈（ThreadLocal） |
| `DataPermissionRule` | 一张表的规则（表名、部门列、用户列） |
| `LazyDataPermissionInterceptor` | 继承 MyBatis-Plus 的 `DataPermissionInterceptor`，**只在当前线程有规则时**才解析、改写 SQL，其他 SQL 原样执行，不影响性能 |
| `DataPermissionSqlHandler` | 按规则和当前用户的 `DataScope` 生成条件表达式 |

拦截器注册在分页拦截器之前，因此分页的 count 也带数据权限条件；SaaS 模式下租户条件先于数据权限追加。

## 使用约定

1. **表结构**：需要按部门隔离的业务表加 `dept_id`（制单人部门）和 `create_by`（制单人）或负责人列，并在新增时由 Service 写入：

   ```java
   LoginUser user = SecurityUtils.getLoginUser();
   contract.setDeptId(user.deptId());
   contract.setCreateBy(user.userId());
   ```

2. **只用于查询**：写操作中的唯一性校验（如单号、编码是否重复）不能受数据权限影响，否则会因为看不到其他部门的数据而误判为不重复。不要把 `@DataPermission` 加在包含这类校验的写方法上。
3. **列表与详情一致**：列表用 `@DataPermission`，按 ID 访问用 `DataPermissionContext.execute`，两者使用同一条规则（建议定义为常量）。
4. **定时任务、异步线程中不要使用**：这些线程没有登录用户，`SecurityUtils.getDataScope()` 会抛出未登录异常。
5. **商务智能等汇总分析**：多维分析、自定义报表按部门过滤；经营驾驶舱、决策分析、数据大屏汇总全公司数据，只对有「全部数据」权限的用户开放（`SecurityUtils.getDataScope().all()`）；数据大屏的投屏链接也只能由有该权限的用户创建，免登录访问时按链接所属租户统计。

## 附件与变更历史

业务记录的附件、字段变更历史也按数据权限校验：`RecordType` 中声明数据权限规则和按 ID 读取记录的方法，下载附件时在该规则下读取业务记录，读不到即无权访问，见 [文件与附件](./file)。
