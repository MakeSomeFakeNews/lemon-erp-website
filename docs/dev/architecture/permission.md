---
order: 3
---

# 权限模型

柠檬ERP 的功能权限基于 RBAC：用户 → 角色 → 菜单。菜单表同时描述导航结构（模块、分组、页面）和权限标识（页面、按钮、接口）。数据范围由角色的数据权限控制，见 [数据权限](./data-scope)。

## 数据模型

| 表 | 说明 |
| --- | --- |
| `sys_user` | 用户；`dept_id` 所属部门；`supplier_id` / `customer_id` 不为空的是门户账号 |
| `sys_role` | 角色；`code` 角色编码，`data_scope` 数据权限（1 全部、2 自定义、3 本部门、4 本部门及以下、5 仅本人） |
| `sys_user_role` | 用户与角色关联 |
| `sys_menu` | 菜单：目录、页面、按钮 |
| `sys_role_menu` | 角色与菜单关联 |
| `sys_role_dept` | 自定义数据权限的部门 |
| `sys_dept` | 部门（树形），`leader_user_id` 为负责人（审批流程中的「部门主管」） |

`sys_menu` 的字段：

| 字段 | 说明 |
| --- | --- |
| `parent_id` | 上级菜单，0 为顶级 |
| `name` | 菜单名称 |
| `type` | `M` 目录、`C` 菜单（对应前端页面）、`F` 按钮（只有权限标识） |
| `path` | 路由地址：一级目录为模块路径（如 `/wms`），页面为相对地址（如 `warehouse`） |
| `component` | 页面组件路径，相对 `lemon-web/src/views`，不带 `.vue`（如 `wms/warehouse/index`） |
| `perms` | 权限标识，格式 `模块:功能:操作`（如 `wms:warehouse:add`） |
| `icon` | Ant Design 图标名（如 `HomeOutlined`） |
| `sort` | 排序 |
| `visible` / `status` | 是否显示、是否启用 |

## 菜单层级与导航

| 层级 | 类型 | 示例 | 显示位置 |
| --- | --- | --- | --- |
| 模块 | 一级目录 `M`，`path` 为 `/模块` | 仓库管理 `/wms` | 页面顶部导航栏（与「首页」并列） |
| 分组 | 二级目录 `M`，**不填** `path` | 库存作业、基础资料 | 侧边栏中的分组标题 |
| 页面 | 菜单 `C`，填写 `path` 和 `component` | 仓库管理 `warehouse` → `wms/warehouse/index` | 侧边栏菜单项 |
| 按钮 | `F`，只有 `perms` | 仓库新增 `wms:warehouse:add` | 不显示，用于按钮和接口权限 |

页面的完整地址是模块路径拼接页面路径：分组没有路径，因此「仓库管理」页面的地址是 `/wms/warehouse`。侧边栏只显示当前模块的菜单；在首页、个人中心等不属于模块的页面上，侧边栏显示模块列表。切换模块时回到该模块上次打开的页面。

## 三级权限

| 层级 | 控制什么 | 后端 | 前端 |
| --- | --- | --- | --- |
| 菜单 | 能看到哪些模块和页面 | `/auth/menus` 只返回有权限的目录和菜单 | 按返回的菜单动态注册路由，没有权限的页面没有路由 |
| 按钮 | 页面上能点哪些按钮 | - | `v-perm` 指令移除没有权限的元素 |
| 接口 | 能调用哪些接口 | `@PreAuthorize("@ss.hasPerm('...')")` | - |

按钮权限只是界面上的隐藏，真正的控制在接口上：每个接口都必须声明权限，按钮的 `v-perm` 与对应接口使用相同的权限标识。

### 后端接口权限

`framework/security/PermissionService` 注册为名为 `ss` 的 Bean：

```java
@GetMapping
@PreAuthorize("@ss.hasPerm('wms:warehouse:list')")
public R<PageResult<WmsWarehouse>> page(...) { ... }

// 满足其一即可：多个页面共用的选择器接口
@GetMapping("/active")
@PreAuthorize("@ss.hasAnyPerm('scm:purchase:add', 'scm:purchase:edit', 'scm:contract:list')")
public R<List<ScmPurchaseContract>> active(...) { ... }
```

| 方法 | 说明 |
| --- | --- |
| `hasPerm(perm)` | 超级管理员、拥有 `*:*:*`、或拥有该权限时为 true |
| `hasAnyPerm(perms...)` | 拥有其中任一权限 |
| `hasRole(role)` | 超级管理员或拥有该角色编码 |

没有权限时 `GlobalExceptionHandler` 返回 `{"code":403,"msg":"没有权限，请联系管理员"}`。

只需要登录、不需要特定权限的接口（如仓库下拉选项 `/wms/warehouse/options`）可以不加 `@PreAuthorize`，但要确认返回的数据不敏感。

### 前端按钮权限

```vue
<a-button v-perm="'wms:warehouse:add'" type="primary">新增仓库</a-button>
<!-- 满足其一即可 -->
<a-button v-perm="['scm:purchase:add', 'scm:purchase:edit']">...</a-button>
<!-- a-popconfirm 等没有根元素的组件，外面包一层元素再加 v-perm -->
<span v-perm="'wms:warehouse:remove'">
  <a-popconfirm title="确定删除？" @confirm="remove(record.id)">
    <a-button type="link" danger size="small">删除</a-button>
  </a-popconfirm>
</span>
```

在脚本中判断权限用 `useUserStore().hasPerm('sys:user:edit')`（同样支持数组）。

## 动态路由

`lemon-web/src/router/index.js` 在首次进入页面时：

1. `userStore.loadUser()` 请求 `/auth/info`（用户、角色、权限）和 `/auth/menus`（当前用户可见的目录 + 菜单树，不含按钮）；
2. `menusToRoutes` 把菜单树拍平：类型为 `C` 且有 `component` 的菜单生成一条路由，路径为各级 `path` 拼接，组件通过 `import.meta.glob('../views/**/*.vue')` 按 `component` 匹配；找不到组件时控制台警告并显示 404 页面；
3. 路径以 `/m/` 开头的移动作业页面挂在移动端布局下，其他挂在 `BasicLayout` 下；
4. 最后添加 404 兜底路由。

`/auth/menus` 的过滤规则（`AuthService.currentUserMenus`）：超级管理员返回全部启用的目录和菜单；其他用户按角色授权并以租户套餐为上限；平台专属菜单只对平台租户显示；租户管理菜单只在 SaaS 模式下显示；门户模块只对所属门户的账号显示，门户账号只看到所属门户。

## 内置角色

`init.sql` 按岗位预置了角色和授权，可在「角色管理」中调整：

| 角色 | 编码 | 数据权限 | 权限范围 |
| --- | --- | --- | --- |
| 超级管理员 | admin | 全部 | 全部权限 |
| 普通用户 | common | 本部门及以下 | 所有页面只读（数据大屏除外） |
| 总经理 | gm | 全部 | 业务模块只读 + 商务智能（含数据大屏和投屏链接管理）；审核采购 / 销售订单、招聘需求、假勤、工时 |
| 采购员 | purchaser | 本部门 | 请购、询价、采购订单与收退货、供应商、寄售结算；库存、物料只读 |
| 销售员 | sales | 仅本人 | 报价、销售订单、发货通知、客户、CRM；库存、出库、价目表只读 |
| 仓库管理员 | warehouse | 全部 | 仓库全部单据与资料、采购收退货、销售出库退货、拣货、发运、领料与完工入库、移动作业、数据大屏 |
| 生产计划员 | planner | 本部门及以下 | 生产计划、MRP、产能排程、工单、齐套、BOM、工作中心、请购单 |
| 车间主管 | workshop | 本部门 | 领料、报工、完工入库、补料申请、质量检验、设备与维护 |
| 质量工程师 | quality | 全部 | 质量管理全部功能；物料、供应商、工单只读 |
| 会计 | accountant | 全部 | 财务全部功能；采购销售单据、工资表、项目核算只读 |
| 出纳 | cashier | 全部 | 收付款、预收预付、银行对账、报销借款付款 |
| 人事专员 | hr | 全部 | 人力资源全部功能 |
| 项目经理 | pm | 仅本人 | 项目管理全部功能（只看自己负责的项目） |
| 普通员工 | staff | 仅本人 | 员工自助、流程中心、费用报销和借款申请 |
| 供应商 | supplier | 仅本人 | 供应商门户账号专用 |
| 经销商 | dealer | 仅本人 | 经销商门户账号专用 |

超级管理员 = 平台租户中拥有 `admin` 角色的用户（`LoginUser.isAdmin()`）。其他租户的 `admin` 角色是租户管理员，权限以套餐为上限，按普通角色处理。

## 防越权规则

非超级管理员在角色、用户管理中：

- 不能分配超级管理员角色，不能修改超级管理员角色；
- 不能授予自己没有的菜单权限，不能授予超出自己范围的数据权限；
- 不能重置密码、修改、停用、删除超级管理员账号。

角色成员的增减使用独立的按钮权限 `sys:role:assignUser`，数据权限的设置使用 `sys:role:dataScope`。

## 权限缓存

登录用户的角色和权限缓存在 `login:perms:{userId}`（30 分钟）。通过页面修改用户、角色、菜单、部门、租户套餐后会自动清理；直接修改数据库后需要手工删除 `login:perms:*`，见 [认证与会话](./auth)。

新增页面和按钮时如何登记菜单、给内置角色授权，见 [新增菜单与授权](../guide/menu)。
