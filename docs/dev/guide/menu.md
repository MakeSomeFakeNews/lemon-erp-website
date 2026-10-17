---
order: 7
---

# 新增菜单与授权

前端页面的路由由菜单动态生成：**没有登记菜单的页面无法访问**（访问地址显示 404）。新增页面后需要在菜单中登记，并给需要的角色授权。菜单与权限的数据模型见 [权限模型](../architecture/permission)。

## 菜单的三种类型

| 类型 | `type` | 填写 | 说明 |
| --- | --- | --- | --- |
| 目录 | `M` | 名称、图标、排序；一级目录填路由地址 `/模块`，二级目录（分组）**不填**路由地址 | 一级目录即模块，显示在顶部导航；二级目录是侧边栏分组 |
| 菜单 | `C` | 名称、路由地址（相对，如 `car`）、组件路径（如 `oa/car/index`）、权限标识（如 `oa:car:list`）、图标 | 对应一个前端页面 |
| 按钮 | `F` | 名称、权限标识（如 `oa:car:add`） | 页面上的按钮和对应接口的权限 |

页面的完整地址 = 模块路径 + 页面路由地址（分组没有路由地址，不参与拼接），如 `/oa` + `car` = `/oa/car`。组件路径相对 `lemon-web/src/views`，不带 `.vue`，`oa/car/index` 对应 `src/views/oa/car/index.vue`。

权限标识的命名：`模块:功能:操作`，列表 / 详情 `:list`，新增 `:add`，修改 `:edit`，删除 `:remove`，其他操作按动作命名（`:approve`、`:submit`、`:confirm`、`:close`、`:export`、`:import`）。菜单（`C`）的权限标识一般是 `:list`，与列表接口一致。

## 方式一：在页面上登记

适合在已运行的环境中添加：

1. 用超级管理员登录，进入「系统管理 → 菜单管理」；
2. 新增一级目录（模块）：类型「目录」，路由地址 `/oa`，选择图标，排序决定在顶部导航中的位置；
3. 按需在模块下新增二级目录作为侧边栏分组（不填路由地址）；
4. 在模块或分组下新增菜单：路由地址 `car`，组件路径 `oa/car/index`，权限标识 `oa:car:list`；
5. 在菜单下新增按钮：`oa:car:add`、`oa:car:edit`、`oa:car:remove`、`oa:car:submit` 等；
6. 进入「系统管理 → 角色管理」，编辑需要的角色，在菜单权限中勾选新页面和按钮（勾选页面会自动勾选所在的分组和模块）；
7. 拥有该角色的用户刷新页面后即可看到新菜单。

菜单、角色的修改会自动清理全部权限缓存，立即生效。

## 方式二：写入 init.sql

适合随代码一起发布、新环境开箱即用。在 `sql/init.sql` 中对应模块的段落追加：

```sql
-- ---------------------------------------------------------------- 行政办公：菜单、字典
INSERT INTO sys_menu (id, parent_id, name, type, path, component, perms, icon, sort, visible, status, create_time, update_time) VALUES
(5000, 0,    '行政办公',     'M', '/oa', NULL,           NULL,            'CoffeeOutlined', 8, 1, 1, NOW(), NOW()),
(5010, 5000, '车辆管理',     'M', NULL,  NULL,           NULL,            NULL,             1, 1, 1, NOW(), NOW()),
(5001, 5010, '用车申请',     'C', 'car', 'oa/car/index', 'oa:car:list',   'CarOutlined',    1, 1, 1, NOW(), NOW()),
(5002, 5001, '用车申请新增', 'F', NULL,  NULL,           'oa:car:add',    NULL, 1, 1, 1, NOW(), NOW()),
(5003, 5001, '用车申请修改', 'F', NULL,  NULL,           'oa:car:edit',   NULL, 2, 1, 1, NOW(), NOW()),
(5004, 5001, '用车申请删除', 'F', NULL,  NULL,           'oa:car:remove', NULL, 3, 1, 1, NOW(), NOW()),
(5005, 5001, '用车申请提交', 'F', NULL,  NULL,           'oa:car:submit', NULL, 4, 1, 1, NOW(), NOW());
```

- 菜单 ID 选一段不会与现有数据冲突的号段（现有菜单 ID 在 3300 以内）；
- 图标使用 Ant Design Vue 图标组件名（如 `CarOutlined`），可在菜单管理的图标选择器中查找；
- `visible = 0` 的菜单不在侧边栏显示，但仍会注册路由（可用于只从其他页面跳转进入的页面）；
- `status = 0` 的菜单停用，不会返回给前端。

菜单名称在数据库中保存中文。内置菜单要同时在前端 `lemon-web/src/locales/en-US/menu.js` 中按菜单 ID 加英文名称（注释写中文名称），英文界面才会显示英文；没有译文的菜单（包括用户在页面上新增的菜单）在英文界面也显示数据库中的名称：

```js
// locales/en-US/menu.js
  5000: 'Office', // 行政办公
  5010: 'Vehicles', // 车辆管理
  5001: 'Car Requests', // 用车申请
```

按钮（`F`）只用于授权，不需要译文。菜单 ID 是译文的键，所以增量脚本中的菜单 ID 要与 `init.sql` 一致，见 [国际化](./i18n)。

### 给内置角色授权

内置角色的 ID 固定（`init.sql` 中插入）：

| ID | 角色 | 编码 |
| --- | --- | --- |
| 1 | 超级管理员 | admin（拥有全部权限，不需要授权） |
| 2 | 普通用户 | common（所有页面只读） |
| 3 | 总经理 | gm |
| 4 | 采购员 | purchaser |
| 5 | 销售员 | sales |
| 6 | 仓库管理员 | warehouse |
| 7 | 生产计划员 | planner |
| 8 | 车间主管 | workshop |
| 9 | 会计 | accountant |
| 10 | 出纳 | cashier |
| 11 | 人事专员 | hr |
| 12 | 项目经理 | pm |
| 13 | 普通员工 | staff |

质量工程师、供应商、经销商等角色在后续段落中插入，按编码查询其 ID。

```sql
-- 普通员工：使用用车申请；普通用户、总经理：只读
INSERT INTO sys_role_menu (role_id, menu_id) VALUES
(13, 5000), (13, 5010), (13, 5001), (13, 5002), (13, 5003), (13, 5004), (13, 5005),
(2, 5000), (2, 5010), (2, 5001),
(3, 5000), (3, 5010), (3, 5001);
```

授权时**目录、分组、页面要一起授权**：`/auth/menus` 按角色关联的菜单返回菜单树，缺少上级目录时页面无法挂到导航上。页面上勾选会自动连带上级，写 SQL 时需要自己写全。

::: tip 只读权限的约定
「普通用户」等只读角色只授权目录、页面（`:list`），不授权按钮。前端的新增、编辑等按钮用 `v-perm` 隐藏，后端接口用 `@PreAuthorize` 拒绝。
:::

## 已有环境的增量脚本

`init.sql` 会删除并重建全部表，已有环境不能重新执行，需要另写增量 SQL。增量脚本要能重复执行、不依赖自增 ID：

```sql
-- 菜单：按权限标识判断是否已存在
INSERT INTO sys_menu (parent_id, name, type, path, component, perms, icon, sort, visible, status, create_time, update_time)
SELECT 0, '行政办公', 'M', '/oa', NULL, NULL, 'CoffeeOutlined', 8, 1, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE type = 'M' AND path = '/oa');
```

::: warning 菜单 ID 与英文译文
英文界面按菜单 ID 查找译文（`locales/en-US/menu.js`），上面这种不写 ID、由数据库自增的写法会让已有环境中的菜单 ID 与 `init.sql` 不一致，英文界面将显示中文名称。内置菜单的增量脚本建议写明与 `init.sql` 相同的 ID，并按 ID 判断是否已存在（`sql/upgrade` 中的脚本就是这样写的）：

```sql
INSERT INTO sys_menu (id, parent_id, name, type, path, component, perms, icon, sort, visible, status, create_time, update_time)
SELECT m.* FROM (
    SELECT 5000 AS id, 0 AS parent_id, '行政办公' AS name, 'M' AS type, '/oa' AS path, NULL AS component, NULL AS perms, 'CoffeeOutlined' AS icon, 8 AS sort, 1 AS visible, 1 AS status, NOW() AS create_time, NOW() AS update_time
    UNION ALL SELECT 5001, 5000, '用车申请', 'C', 'car', 'oa/car/index', 'oa:car:list', 'CarOutlined', 1, 1, 1, NOW(), NOW()
) m
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = m.id);
```
:::

需要引用上级菜单 ID、按角色编码授权时，可以先查询出 ID，再用 `VALUES` 插入；或者直接在页面上登记（方式一）。注意多租户约定中「不写 `INSERT ... SELECT`」针对的是业务代码中经过 MyBatis 的 SQL，`sys_menu`、`sys_role_menu` 是平台共享表，在数据库客户端中执行的维护脚本不受影响。

直接改库后要清理权限缓存：删除 Redis 中的 `login:perms:*`，或在「系统监控 → 缓存监控」中清空「用户权限」。

## SaaS 模式下的租户套餐

开启多租户时，非平台租户的权限以租户套餐为上限：

- 新菜单需要在「系统管理 → 租户套餐」中加入对应套餐，租户才能使用；
- 租户的 admin 角色（租户管理员）的菜单与套餐一致，随套餐修改自动同步；租户的其他角色由租户管理员在套餐范围内授权；
- 平台专属功能（权限前缀 `sys:menu:`、`sys:dict:`、`sys:config:`、`sys:tenant`、`monitor:server:`、`monitor:cache:`、`monitor:job:`）不能加入套餐。新增平台专属功能时在 `PlatformFeatures` 中登记权限前缀。

## 门户菜单

供应商门户（`/portal`）、经销商门户（`/dealer`）是特殊的一级目录：只对对应门户的账号显示，门户账号也只能看到所属门户。门户页面的权限标识以 `portal:` 或 `dealer:` 开头，授权给内置的「供应商」「经销商」角色，见 [供应商门户接口开发](./portal)。

## 移动作业菜单

手机 / PDA 页面放在一级目录「移动作业」（`/m`）下，组件在 `views/mobile` 中，路由挂在全屏的移动端布局下，不使用后台的顶部导航和侧边栏。

## 常见问题

| 现象 | 原因 |
| --- | --- |
| 访问地址显示 404 | 菜单没有登记、没有授权、组件路径写错（浏览器控制台会警告「未找到组件 src/views/xxx.vue」），或修改后没有刷新页面 |
| 菜单显示了但按钮没有显示 | 角色没有勾选按钮权限，或 `v-perm` 与按钮的权限标识不一致 |
| 按钮显示了但点击提示「没有权限」 | 接口 `@PreAuthorize` 的权限标识与按钮不一致 |
| 改库授权后不生效 | 权限缓存未清理（最多 30 分钟后自动过期） |
| 租户用户看不到新菜单 | 租户套餐中没有加入该菜单 |
| 英文界面中新菜单显示为中文 | `locales/en-US/menu.js` 中没有该菜单 ID 的译文 |
