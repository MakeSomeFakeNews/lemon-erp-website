---
order: 2.5
---

# 界面设置

顶栏的「界面设置」按钮（`SkinOutlined` 图标）打开右侧抽屉（`layout/components/settings/SettingDrawer.vue`），修改立即生效（实时预览），底部「恢复默认」（保留侧边栏折叠和语言）。用户手册见 [界面设置](/manual/guide/ui-settings)。本页说明设置项的实现、主题色变量和保存方式，**写自定义样式时请先看[主题色与 CSS 变量](#主题色与-css-变量)**。

## 设置项

默认值、预设主题色、取值校验在 `lemon-web/src/utils/uiSettings.js`（`DEFAULT_SETTINGS`、`PRESET_COLORS`、`normalizeSettings`）：

| 项 | 键 | 取值 | 默认 |
| --- | --- | --- | --- |
| 主题模式 | `themeMode` | `ThemeMode`：`light` / `dark` / `system` | `system`（随系统切换） |
| 主题色 | `primaryColor` | `#rrggbb`，10 个预设或自定义取色 | `#1677ff`（拂晓蓝，品牌色） |
| 布局 | `layout` | `LayoutMode`：`mix` / `side` / `top` / `column` | `mix` |
| 显示多标签页 | `tabs` | 布尔 | `true` |
| 紧凑模式 | `compact` | 布尔，`theme.compactAlgorithm` | `false` |
| 侧边栏折叠 | `collapsed` | 布尔 | `false` |
| 界面语言 | `locale` | `LOCALES` 中的取值 | 见[语言](#语言) |

`normalizeSettings` 丢弃不认识的项、非法取值用默认值（本地缓存和服务端内容都可能来自旧版本或被修改过），并兼容旧版本本地缓存只有 `{ dark, collapsed }` 的情况。

- **主题模式**：`appStore.dark` 是实际是否深色（`system` 时按 `prefers-color-scheme` 计算并监听变化），`html[data-theme]` 随之切换，深色样式仍写在非 scoped 的 `html[data-theme='dark'] ...` 中（见 [前端开发规范 · 样式与深色模式](./frontend#样式与深色模式)）。顶栏原有的深浅色快捷切换保留。
- **主题色**：`App.vue` 把它作为 `colorPrimary` / `colorInfo`（链接色由 colorInfo 派生）交给 Ant Design 的 `ConfigProvider`，悬停、浅色背景等派生色由 antd 算法生成，深浅色各自正确。
- **没有提供**的项：「固定顶栏」（页头本来就固定，只有内容区滚动）、圆角和侧边栏宽度（收益小，保持简洁）。

## 主题色与 CSS 变量

Ant Design Vue 4 本身不输出 CSS 变量，原来页面里写的 `var(--ant-color-primary, #1677ff)` 实际一直取的是后备值。现在 `components/ThemeVars.vue` 用 `theme.useToken()` 把派生后的 token 写成 html 上的 CSS 变量，随主题色、深浅色、紧凑模式实时更新：

| 变量 | 含义 |
| --- | --- |
| `--app-primary` | 主题色 |
| `--app-primary-bg` | 主题色的浅色背景（选中行、标签底色等） |
| `--app-primary-hover` | 悬停色 |
| `--app-primary-border` | 主题色边框 |
| `--ant-color-primary`、`--ant-color-primary-bg` | 与 antd token 同名，兼容已有写法 |
| `--ant-color-success` / `warning` / `error`、`--ant-color-text-tertiary` 等 | 状态色、文字色 |

::: warning 注意
**自定义样式中的强调色一律用这些变量**，不要写死 `#1677ff`、`rgba(22, 119, 255, …)`，否则切换主题色后会残留蓝色。需要半透明时用 `color-mix`：

```css
.node.active {
  border-color: var(--app-primary);
  background: color-mix(in srgb, var(--app-primary) 20%, transparent);
}
```

图表系列色、状态色（运行中、等级等）、第三方品牌色（如钉钉蓝）是数据颜色，不跟随主题色，保持原值。
:::

## 布局

`layout/BasicLayout.vue` 按 `appStore.layout` 组合以下组件：

| 布局 | 组成 |
| --- | --- |
| `mix` 顶部模块 + 侧边菜单（默认） | 顶栏切换模块，侧边栏显示当前模块的分组和页面（`SideMenu` 的 `module` 模式） |
| `side` 侧边菜单 | 全部模块、分组、页面的多级树（`SideMenu` 的 `tree` 模式，分组也是可折叠的子菜单，展开一个模块时收起其他模块），顶栏显示完整面包屑 |
| `top` 顶部菜单 | 没有侧边栏，`TopMenu` 把全部菜单显示为水平菜单，模块的下拉面板按分组排成多列（`style.css` 的 `.top-menu-popup` / `.top-menu-cols-N`，列数按行数估算，分组不跨列），放不下的模块收进「…」；Logo 移到顶栏，不显示折叠按钮 |
| `column` 双栏 | 最左一列 `ModuleRail` 显示模块图标和名称，第二栏显示当前模块的分组和页面，收起时第二栏隐藏；首页等不属于模块的页面只显示模块栏 |

- 菜单项统一由 `layout/menuItems.js` 的 `toMenuItems` 从 `/auth/menus` 生成（已按权限过滤），各布局的高亮都按当前路由；多标签页、菜单搜索、面包屑与布局无关。新增页面只需按 [新增菜单与授权](./menu) 登记，四种布局自动出现。
- 小于 768px 时不区分布局，统一使用抽屉菜单；768 ~ 1199px 侧边栏默认收起。
- 移动作业（`MobileLayout`）、数据大屏、打印等独立页面不使用后台布局，不受影响。

## 保存

每个用户一份，**服务端为准、浏览器缓存**。

### 后端

- 表 `sys_user_setting`：`user_id`、`setting_key`、`setting_value`（JSON 文本），唯一约束 `(user_id, setting_key, tenant_id)`。单独建表而不是在 `sys_user` 上加 JSON 列：用户列表、登录等查询不带大字段；以后新增个人设置（如表格列设置）用新的 key 即可，不必加表；删除用户时一并删除。
- `UserSettingService` 只读写**当前登录用户**自己的设置（请求体里的 userId 只是内容，不能借此写别人的设置）。
- 接口 `GET` / `PUT /profile/settings/{key}`，界面设置的 key 为 `ui`，PUT 整体替换：

| 校验 | 规则 |
| --- | --- |
| key | 小写字母开头的字母、数字、下划线 |
| 内容 | 必须是 JSON 对象（不能是数组、字符串），不超过 8000 字符 |
| 数量 | 每人最多 20 项 |

- 修改较频繁，不记操作日志。
- 登录后 `/auth/info` 的 `uiSettings` 一并返回，不再单独请求；只在登录后读一次，按唯一索引查询，不加缓存。
- 已有库升级执行 `sql/upgrade/20261111_user_setting.sql`（只新建一张表，可重复执行），见 [升级说明](../deploy/upgrade)。

### 前端

`store/app.js`：

- 修改后立即写入本地缓存 `lemon_erp_settings`，800ms 防抖保存到服务端；退出登录前、页面关闭或刷新时（`keepalive` 请求）把还没保存的修改发出去。
- 登录后应用服务端的设置；服务端还没有时，把本地设置（含旧版本只有 `{ dark, collapsed }` 的本地设置）上传。
- 登录页使用本地缓存的上次设置。
- 演示模式下所有人共用账号，只保存在本地，抽屉底部的提示相应改为「设置只保存在本浏览器」。

### 语言

切换语言仍保存在浏览器（`lemon_erp_locale`，登录页也能切换），已登录时同时写入界面设置的 `locale`。在没有选择过语言的浏览器上登录时采用服务端保存的语言（刷新一次页面）；选择过的以本浏览器为准，避免登录页刚选的语言被覆盖。

## 扩展

- **新增一个界面设置项**：在 `uiSettings.js` 的 `DEFAULT_SETTINGS` 中加默认值、在 `normalizeSettings` 中加校验，在 `SettingDrawer.vue` 中加控件，文字加到 `locales/<语言>/layout.js` 的 `layout.settings`；仍保存在 key `ui` 中，后端不用改。
- **新增一种个人设置**（与界面无关，如某个表格的列设置）：用新的 key 调用 `/profile/settings/{key}`，注意每人最多 20 项、单项不超过 8000 字符。
- **新增预设主题色**：在 `PRESET_COLORS` 中加 `{ key, color }`，并在两种语言的 `layout.settings.colors.<key>` 中加名称。
