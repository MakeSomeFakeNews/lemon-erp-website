---
order: 11
---

# 供应商门户接口开发

供应商门户让供应商的人员登录柠檬ERP，确认采购订单、填写送货通知、对账、投标、查看质量索赔。门户账号与内部用户使用同一套登录和用户表，通过严格的接口隔离保证供应商只能访问自己的数据。经销商门户（`/dealer`，`dealer:*` 权限，关联客户）的机制完全相同。

## 门户账号

- 门户账号是 `sys_user.supplier_id` 不为空的用户（经销商门户为 `customer_id`），`LoginUser.isSupplier()` 为 true；
- 在「供应链 → 供应商」资料中开通、停用、重置密码（权限 `scm:supplier:portal`，接口 `/scm/supplier/{supplierId}/portal-accounts`），由框架契约 `PortalAccounts` 定义、system 模块的 `SysPortalAccountService` 实现；开通时只分配内置的「供应商」角色（编码 `supplier`）；
- 登录后，不论分配了什么角色，`SysLoginUserLoader` 只保留 `portal:` 开头的权限，数据权限为仅本人，部门为空；
- 菜单只返回「供应商门户」模块（`/portal`），首页直接进入 `/portal/order`。

## 三层隔离

| 层 | 机制 | 位置 |
| --- | --- | --- |
| 路径 | 门户账号只能访问 `/portal/**` 和少数公共接口，访问其他接口直接返回 403「供应商账号只能使用供应商门户」 | `JwtAuthenticationFilter` 调用 `PortalFeatures.deniedMessage`，规则在 `PortalKind.allows` |
| 权限 | 门户接口声明 `portal:*` 权限，门户账号只有这类权限 | `@PreAuthorize("@ss.hasPerm('portal:order:list')")` |
| 数据 | 供应商一律从当前账号取，**不接受前端传入**；Service 按供应商过滤 | `SecurityUtils.requireSupplierId()` |

门户账号可以访问的公共接口（`PortalKind.COMMON_PATHS`）：`/auth/`（登录信息、菜单）、`/profile`（个人中心）、`/system/message`（站内消息）、`/system/dict/data/type/`（字典）、`/system/attachment`（附件，按业务记录再校验）。

路径检查不依赖接口是否声明了权限：即使某个内部接口忘记加 `@PreAuthorize`，门户账号也访问不到。

## 开发规则

1. **门户接口放在 `/portal/**` 下**。可以是单独的 Controller（`ScmPortalController` 映射 `/portal`、`QmsPortalController` 映射 `/portal/claim`），也可以和内部接口放在同一个 Controller 中用不同路径（`FinStatementController` 中的 `/fin/statement` 与 `/portal/statement`）。
2. **权限标识以 `portal:` 开头**，并在菜单中登记为「供应商门户」下的页面或按钮，授权给「供应商」角色。
3. **供应商用 `SecurityUtils.requireSupplierId()` 取**：当前账号不是供应商账号时抛出 403「供应商门户仅供供应商账号使用」。不要在请求参数、请求体中接收 `supplierId`。
4. **Service 中按供应商校验每一条数据**：列表按供应商过滤；按 ID 访问时校验记录属于该供应商，且处于允许供应商查看的状态（如草稿对供应商不可见），不满足时统一提示「不存在」，不暴露数据是否存在。
5. **不复用内部接口的 Service 方法做数据过滤**：内部方法依赖 `@DataPermission` 等内部用户的数据权限，门户账号的数据权限只有「本人」，结果不符合预期；为门户单独写 `xxxForSupplier(…, supplierId)` 方法。
6. **注意 mapper 中的可选条件**：很多列表 SQL 写的是 `<if test="supplierId != null">`，门户调用时必须保证传入非空的供应商 ID（`requireSupplierId()` 保证了这一点），否则会查出所有供应商的数据。
7. **增删改接口加 `@OperLog`**，标题以「门户-」开头，便于在操作日志中区分。

## 示例

现有的门户列表接口（`QmsPortalController`）：

```java
@RestController
@RequestMapping("/portal/claim")
@RequiredArgsConstructor
public class QmsPortalController {

    private final QmsClaimService claimService;

    @GetMapping
    @PreAuthorize("@ss.hasPerm('portal:claim:list')")
    public R<PageResult<QmsSupplierClaim>> page(@RequestParam(defaultValue = "1") long current,
                                               @RequestParam(defaultValue = "10") long size) {
        return R.ok(claimService.pageForSupplier(current, size, SecurityUtils.requireSupplierId()));
    }
}
```

```java
// QmsClaimService
public PageResult<QmsSupplierClaim> pageForSupplier(long current, long size, Long supplierId) {
    Page<QmsSupplierClaim> page = Page.of(current, size);
    claimMapper.selectPageList(page, null, supplierId, null, true);   // portal = true：不返回草稿
    return PageResult.of(page);
}
```

新增一个门户详情接口：

```java
// QmsPortalController
@GetMapping("/{id}")
@PreAuthorize("@ss.hasPerm('portal:claim:list')")
public R<QmsSupplierClaim> detail(@PathVariable Long id) {
    return R.ok(claimService.detailForSupplier(id, SecurityUtils.requireSupplierId()));
}
```

```java
// QmsClaimService
/** 供应商门户：只能查看本供应商的、已提交的索赔单 */
public QmsSupplierClaim detailForSupplier(Long id, Long supplierId) {
    QmsSupplierClaim claim = id == null ? null : claimMapper.selectDetail(id);
    if (claim == null || !supplierId.equals(claim.getSupplierId()) || claim.getStatus() == ClaimStatus.DRAFT) {
        throw new BizException("mes.error.claimDoesNotExist");
    }
    return claim;
}
```

需要修改数据的门户接口（如订单确认 `ScmPortalOrderService.confirm`）先调用同样的 `detail(id, supplierId)` 校验归属，再校验状态，最后用带原状态条件的更新防止并发。

## 菜单与前端

在 `init.sql` 中把页面登记在「供应商门户」（菜单 ID 13，路由 `/portal`）下，并授权给「供应商」角色（ID 15）：

```sql
INSERT INTO sys_menu (id, parent_id, name, type, path, component, perms, icon, sort, visible, status, create_time, update_time) VALUES
(5100, 13, '来料检验', 'C', 'inspection', 'portal/inspection/index', 'portal:inspection:list', 'SafetyCertificateOutlined', 6, 1, 1, NOW(), NOW());
INSERT INTO sys_role_menu (role_id, menu_id) VALUES (15, 5100);
```

- 前端页面放在 `views/portal/<页面>/index.vue`，接口函数放在 `api/portal.js`（如 `pagePortalOrder`、`confirmPortalOrder`）；
- 门户页面同样遵循 [前端开发规范](./frontend)，按钮用 `v-perm="'portal:xxx:yyy'"`；
- 门户模块只对供应商账号显示，内部用户（包括超级管理员）看不到门户菜单；内部人员需要查看供应商视角时，可以为测试供应商开通一个门户账号登录。

## 消息与附件

- 给供应商发送站内消息：通过 `PortalAccounts.enabledUserIds(PortalKind.SUPPLIER, supplierId)` 取该供应商的启用账号，再调用 `MessageSender.send`（参考 `ScmPortalNotifier`）；
- 门户与内部共用的单据挂附件时，`RecordType` 的 `viewPerm`、`editPerm` 可以写多个权限，有其一即可。例如供应商对账单（`FinRecordTypes`）：查看为 `fin:statement:list,portal:statement:list`，上传为 `fin:statement:edit,portal:statement:confirm`；`loader` 中需要按当前账号的供应商校验记录归属。

## 经销商门户

经销商门户的对应关系：

| 项目 | 供应商门户 | 经销商门户 |
| --- | --- | --- |
| 关联 | `sys_user.supplier_id` | `sys_user.customer_id` |
| 路径 | `/portal/**` | `/dealer/**` |
| 权限前缀 | `portal:` | `dealer:` |
| 内置角色 | `supplier` | `dealer` |
| 取关联方 | `SecurityUtils.requireSupplierId()` | `SecurityUtils.requireCustomerId()` |
| 开通账号 | 供应商资料（`scm:supplier:portal`） | 客户资料（`/scm/customer/{customerId}/portal-accounts`） |

两者都由 `PortalKind` 枚举描述，新增第三种门户时在 `PortalKind` 中加枚举值即可复用路径隔离和权限过滤。
