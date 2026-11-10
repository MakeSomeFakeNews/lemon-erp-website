---
order: 14
---

# 通知公告

通知公告在 `lemon-system` 模块中实现：管理端「系统管理 → 通知公告」维护和发布，员工端（工作台卡片、「全部公告」、小程序）只读取发给自己的公告。它复用了平台已有的站内消息、附件和第三方推送，本页说明其表结构、接口和几处关键设计。使用说明见用户手册的[通知公告](/manual/system/notice)。

## 相关代码

| 位置 | 说明 |
| --- | --- |
| `system/controller/SysNoticeController` | 管理端与员工端接口，前缀 `/system/notice` |
| `system/service/SysNoticeService` | 保存、发布、撤回、阅读、接收人计算、附件访问校验 |
| `system/service/SysNoticeRecordTypes` | 登记附件业务类型 `sys_notice` |
| `system/model/NoticeStatus`、`NoticeScope` | 状态（`DRAFT` / `PUBLISHED` / `WITHDRAWN`）、发布范围（`ALL` / `DEPT` / `ROLE`） |
| `mapper/system/SysNoticeMapper.xml` | 员工端可见公告的查询（`selectMine`、`countMineUnread`、`selectMineById`） |
| `mapper/system/SysNoticeRecipientMapper.xml` | 范围内用户、阅读统计、已读未读名单、标记已读 |
| `framework/message/MessageCategory.NOTICE` | 站内消息类别「公告」（字典 `sys_message_category`） |
| 前端 `views/system/notice/` | 管理端列表、表单（`NoticeForm`）、详情与阅读情况（`NoticeDetail`） |
| 前端 `views/dashboard/NoticeCard.vue`、`views/notice/index.vue` | 工作台卡片、「全部公告」（固定路由 `/notices`） |
| 前端 `components/system/NoticeView.vue`、`NoticeDrawer.vue` | 公告内容展示（管理端预览与员工端共用）、员工端详情抽屉（打开即已读） |
| 小程序 `pkg-notice/` | 公告列表、详情（`markdown.js` 把正文转为 `rich-text` 可用的 HTML） |

## 表结构

三张表都带 `tenant_id`，按租户隔离。

| 表 | 主要字段 | 说明 |
| --- | --- | --- |
| `sys_notice` | `title`（128）、`type`（业务字典 `sys_notice_type`）、`content`（`MEDIUMTEXT`，Markdown）、`scope_type`、`pinned`、`expire_date`（含当天，为空长期有效）、`status`、`publish_time`（最近一次发布时间）、`publish_by`、`create_by` | 公告。列表接口不返回 `content` |
| `sys_notice_target` | `notice_id`、`target_id` | 发布范围：指定部门时为部门 ID，指定角色时为角色 ID；全员时没有记录 |
| `sys_notice_recipient` | `notice_id`、`user_id`、`read_time`（未读为空） | 接收人与阅读记录，唯一键 `(notice_id, user_id, tenant_id)`，索引 `(user_id, read_time)` |

字典：`sys_notice_status`、`sys_notice_scope` 为系统字典；`sys_notice_type` 为业务字典（内置 通知 `NOTICE`、公告 `ANNOUNCE`、制度 `POLICY`、活动 `EVENT`，都不是内置取值，租户可增删），保存时用 `DictLookup.check` 校验，新租户由 `SysDictTenantInitializer` 随业务字典复制。

菜单：`353 通知公告`（`system/notice/index`，`sys:notice:list`），按钮 `sys:notice:add` / `edit` / `remove` / `publish`（发布与撤回共用）。内置授权给人事专员（全部）和普通用户（只读，只有菜单）；超级管理员不需要授权，租户管理员随套餐获得。菜单在系统管理目录下，属于基础平台功能模块。

## 接口

### 管理端

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/system/notice` | `sys:notice:list` | 分页（`title`、`type`、`status`），附 `readCount` / `totalCount` |
| GET | `/system/notice/{id}` | `sys:notice:list` | 详情，含 `targetIds`、`targetNames`、阅读统计 |
| GET | `/system/notice/{id}/readers` | `sys:notice:list` | 接收人名单：`read`（true 已读 / false 未读 / 不传全部）、`keyword`（用户名、昵称） |
| GET | `/system/notice/options` | `sys:notice:add` 或 `edit` | 选择发布范围用的部门树和启用的非门户角色，不需要部门、角色管理的权限 |
| POST | `/system/notice` | `sys:notice:add` | 新建草稿，返回 ID |
| PUT | `/system/notice/{id}` | `sys:notice:edit` | 修改（只允许草稿、已撤回） |
| DELETE | `/system/notice/{ids}` | `sys:notice:remove` | 删除（只允许草稿、已撤回），一并删除范围和接收人 |
| PUT | `/system/notice/{id}/publish` | `sys:notice:publish` | 发布，返回接收人数 |
| PUT | `/system/notice/{id}/withdraw` | `sys:notice:publish` | 撤回 |

请求体 `NoticeRequest`：`title`、`type`、`content`（最多 50000 字符）、`scopeType`、`targetIds`（最多 500 项，全员时忽略）、`pinned`、`expireDate`（不能早于今天）。指定部门时校验部门存在；指定角色时校验角色存在且不是门户角色（`PortalKind` 中的角色编码）。

### 员工端

登录即可，不声明 `@PreAuthorize`，只返回当前用户是接收人、已发布且未过期的公告：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/system/notice/my` | 分页（`unread`、`keyword`、`type`），不含正文，`ORDER BY pinned DESC, publish_time DESC` |
| GET | `/system/notice/my/unread-count` | 未读数（工作台卡片、小程序消息页的提示条） |
| GET | `/system/notice/my/{id}` | 详情（含正文）；不可见时提示 `system.error.noticeNotAvailable`（不存在、已撤回或已过期） |
| PUT | `/system/notice/my/{id}/read` | 标为已读，对应的站内消息一并已读 |

可见条件集中在 `SysNoticeMapper.xml` 的 `mineFrom` 片段：`JOIN sys_notice_recipient r ON r.notice_id = n.id AND r.user_id = #{userId}`、`n.status = 'PUBLISHED'`、`n.expire_date IS NULL OR n.expire_date >= #{today}`（`today` 由 Java 传入 `LocalDate.now()`）。

前端「全部公告」是 `router/index.js` 中的固定路由 `/notices`，不在 `sys_menu` 中登记，所有登录用户都能打开；`/notices?id=` 进入时直接打开该公告的详情抽屉，打开后从地址中去掉 `id`。

## 状态流转

```
草稿 DRAFT ──发布──▶ 已发布 PUBLISHED ──撤回──▶ 已撤回 WITHDRAWN
                          ▲                        │
                          └────────再次发布────────┘
```

- 修改、删除只允许 `DRAFT` / `WITHDRAWN`：修改用带状态条件的 `UPDATE ... WHERE status IN (...)`，影响 0 行时报 `noticeNotEditable`；
- 发布用 `StatusTransitions.tryChangeFromAny`（按原状态更新，并发发布时只有一个成功，失败报 `noticeStatusChanged`），同时写 `publish_time`、`publish_by`；
- 撤回用 `StatusTransitions.change` 从 `PUBLISHED` 改为 `WITHDRAWN`；
- 过期不改变状态：过期是查询条件，管理端列表按 `expireDate` 在前端显示「已过期」标签。发布时有效期早于今天会被拒绝。

## 接收人快照

接收人在**发布时**计算并写入 `sys_notice_recipient`，之后员工端的可见范围和阅读统计都只看这张表，不再按部门、角色实时计算：

| 范围 | 计算方式（`selectScopeUsers`） |
| --- | --- |
| 全员 | `sys_user.status = 1` 且 `supplier_id`、`customer_id` 都为空（排除供应商、经销商门户账号） |
| 指定部门 | 同上，且 `dept_id` 在所选部门及其全部下级部门中（`SysDeptService.selfAndDescendantIds`） |
| 指定角色 | 同上，且拥有所选角色中任一启用的角色 |

范围内没有用户时报 `noticeNoRecipients`。

这样设计的原因：

- 员工端查询只需要按 `(user_id, read_time)` 索引 JOIN 一张表，不必在每次打开工作台时展开部门树、角色关系；
- 阅读进度的分母（应读人数）固定，不会因为人员调动而变化，「已读 / 应读」可以如实反映发布时的通知范围；
- 代价是之后调入部门、新入职、新分配角色的用户不会自动收到，离开范围的用户也仍然能看到。需要时撤回后再次发布。

**再次发布**时按当时的范围重新计算，与已有名单比对：移出范围的用户删除其记录（含阅读记录），新增的用户插入，仍在范围内的保留 `read_time`。批量增删按每 500 个用户一批，插入用单条多值 `INSERT`。

## 与站内消息的联动

发布时调用 `SysMessageService.send(users, message)`：

| 属性 | 取值 |
| --- | --- |
| 类别 | `MessageCategory.NOTICE`（「公告」） |
| 标题 | 公告标题 |
| 内容 | 正文去掉常见 Markdown 标记后的前 100 个字符（`SysNoticeService.excerpt`），存库内容保持原文，不按请求语言生成 |
| 链接 | `/notices?id={id}`；小程序在 `config/entries/notice.js` 中把 `/notices` 映射到 `/pkg-notice/index`，带 `id` 时直接打开详情 |
| 去重键 | `notice:{id}`：已有该去重键消息的用户跳过，每人一条 |

站内消息写入后按现有机制在事务提交后推送到钉钉 / 企业微信 / 飞书（应用消息，以及群机器人中勾选了「公告」类别的群），公告本身不需要额外处理。

| 动作 | 消息处理 |
| --- | --- |
| 发布 | 给全部接收人发送，按去重键跳过已经有消息的人 |
| 撤回 | `deleteUnreadByDedupKey("notice:{id}")` 删除所有未读的公告消息，已读的保留 |
| 再次发布 | 同发布：由于撤回时删除了未读消息，结果是只提醒新增的接收人和之前没看的人 |
| 阅读公告 | `markRead` 只在 `read_time` 为空时更新；更新成功时 `readByDedupKey(userId, "notice:{id}")` 把该用户的公告消息标为已读 |

未读公告不单独计入顶栏铃铛，铃铛中体现的是「公告」类别的未读消息；在「我的消息」中标记消息已读不会反向把公告标为已读（公告的已读以打开公告为准）。

## 附件可见性

公告附件的业务类型是 `sys_notice`，登记为：

```java
new RecordType("sys_notice", "system.label.notice", "", "sys:notice:add, sys:notice:edit", null,
        noticeService::loadForAttachment)
```

`viewPerm` 为空字符串。为支持这种情况，`SysRecordAccessService` 改为只在 `viewPerm` 非空时校验权限；为空表示登录即可，是否能访问完全由 `loader` 决定（`RecordType` 的参数说明见[文件与附件](./file#登记业务记录类型)）：

- 有 `sys:notice:list` 的用户：`selectById`，可以查看全部公告（含草稿）的附件；
- 其他用户：`selectMineById`，只有是接收人、已发布且未过期的公告才返回记录，否则视为不存在。

上传、删除附件需要 `sys:notice:add` 或 `sys:notice:edit`。前端表单在保存草稿得到 ID 后才显示 `AttachmentPanel`。

新增类似「只给特定人看」的业务记录时可以沿用这种写法：`viewPerm` 留空，在 `loader` 中按业务规则过滤。注意 `viewPerm` 为空时所有登录用户都会进入 `loader`，`loader` 必须自行完成全部校验。

## 正文渲染

- Web 端用 `components/ai/MarkdownView.vue`，经 `utils/markdown.js` 的 `marked` + DOMPurify 清理（禁止 `img`、`style`、`form`、`input`、`iframe` 和 `style` 属性，链接新窗口打开）；
- 小程序用 `rich-text`，`pkg-notice/markdown.js` 把原始 HTML 和图片按文字输出，标签样式写成内联（页面样式对 `rich-text` 内部不生效）；
- 不显示图片是为了避免借图片地址向外发送请求，需要图片时作为附件上传。

## 演示模式

员工打开公告时会调用 `PUT /system/notice/my/{id}/read`。为了在演示环境中也能体验已读效果，`DemoProperties.allowedPaths` 默认值中加入了 `/system/notice/my/*/read`（与标记站内消息已读 `/system/message/read` 一样），其他公告接口的写操作仍被拦截，见[演示环境](../deploy/demo)。

