---
order: 14
---

# 业务实体接入自定义字段

自定义字段让用户在「系统管理 → 自定义字段」中为客户、供应商、物料、订单等业务记录扩展字段（如客户的「开户行」「对接销售」），不需要改表结构和代码。本页介绍自定义字段的存储方式，以及让一个新的业务实体支持自定义字段需要做的改动。示例沿用 [新增一个业务模块](./new-module) 中的用车申请。

## 存储方式

自定义字段采用「定义 + 值」两张表，业务表本身不增加任何列：

| 表 | 内容 |
| --- | --- |
| `sys_custom_field` | 字段定义：业务类型 `biz_type`、字段标识 `field_key`、显示名称、类型、下拉选项、必填、列表显示、排序、状态、说明。唯一约束 `(biz_type, field_key, tenant_id)` |
| `sys_custom_value` | 字段的值：业务类型 + 业务记录 ID + 字段标识 → 值（文本，最长 1000 字）。唯一约束 `(biz_type, biz_id, field_key, tenant_id)` |

两张表都带 `tenant_id`，开启 SaaS 时每个租户各自定义字段。业务类型就是附件、字段变更历史使用的**业务记录类型**（`RecordTypeProvider` 登记的类型，如 `scm_customer`、`wms_material`），因此访问控制与附件完全一致。

字段类型（`modules/system/model/CustomFieldType`，字典 `sys_custom_field_type`）与值的保存格式：

| 类型 | 表单控件 | 保存的值 |
| --- | --- | --- |
| `TEXT` 文本 | 输入框 | 原文 |
| `TEXTAREA` 多行文本 | 多行输入框（独占一行） | 原文 |
| `NUMBER` 数字 | 数字输入框 | 十进制文本，去掉末尾的 0（如 `12.5`） |
| `DATE` 日期 | 日期选择 | `yyyy-MM-dd` |
| `SELECT` 下拉 | 下拉选择 | 选项之一；选项在定义中用逗号或换行分隔 |
| `BOOL` 是否 | 开关 | `true` / `false` |

限制：每个业务类型最多 50 个字段；字段标识为字母开头的字母、数字、下划线（最多 32 个字符），创建后业务类型和字段标识不能修改。

## 后端：SysCustomFieldService

所有逻辑都在 system 模块的 `SysCustomFieldService` 中，业务模块不需要写任何自定义字段相关的代码：

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| `GET /system/custom-field/types` | `sys:customField:list` | 可扩展的业务类型（所有 `RecordTypeProvider` 登记的类型） |
| `GET /system/custom-field/all?bizType=` | `sys:customField:list` | 全部定义（管理页面） |
| `POST`、`PUT /{id}`、`DELETE /{id}` | `sys:customField:edit` | 新增、修改、删除定义；删除定义时一并删除已填的值 |
| `GET /system/custom-field?bizType=` | 登录即可 | 业务类型启用的字段，按排序（表单、列表使用） |
| `GET /system/custom-field/values?bizType=&bizId=` | 业务类型的 `viewPerm` + 数据权限 | 一条记录的值：`{ 字段标识: 值 }` |
| `PUT /system/custom-field/values?bizType=&bizId=` | 业务类型的 `editPerm` + 数据权限 | 保存一条记录的值（整体替换） |
| `POST /system/custom-field/values/batch?bizType=` | 业务类型的 `viewPerm` | 列表显示：多条记录的值 `{ 记录ID: { 字段标识: 值 } }`，请求体为 ID 数组，每次最多 500 条 |

- 读写单条记录的值时由 `SysRecordAccessService` 校验：业务类型登记的查看 / 修改权限（多个权限有其一即可），并在业务类型的数据权限规则下用 `loader` 读取记录，读不到时提示「不存在或没有权限」——与附件下载的校验相同，构造 ID 也无法越权；
- 列表批量取值只校验查看权限（列表本身已按数据权限过滤，前端只会传当前页的 ID）；
- 保存值时按字段类型校验（数字、日期格式，下拉值必须是选项之一），必填字段为空时提示「请填写「名称」」，空值不保存；只替换**已启用**字段的值，停用字段已填的值保留，重新启用后仍在。

## 已接入的业务

| 业务类型 | 页面 | 表单 | 列表列 | 详情 |
| --- | --- | --- | --- | --- |
| `scm_customer` 客户 | `views/scm/customer` | 抽屉表单 | 有 | - |
| `scm_supplier` 供应商 | `views/scm/supplier` | 抽屉表单 | 有 | - |
| `wms_material` 物料 | `views/wms/material` | 子页表单 | 有 | - |
| `scm_purchase`、`scm_sales` 采购 / 销售订单 | `components/scm/OrderForm.vue`、`OrderDetail.vue` | 子页表单 | - | `CustomFieldsView` |

「自定义字段」管理页列出所有登记过的业务记录类型（如员工档案、项目等），但只有页面按下文接入后，定义的字段才会显示在表单和列表中。

## 接入步骤

### 1. 登记业务记录类型

如果业务实体已经能挂附件（已在 `RecordTypeProvider` 中登记），跳过这一步。否则在本模块中实现 `RecordTypeProvider`：

```java
package com.lemon.erp.modules.oa.service;

import com.lemon.erp.framework.record.RecordType;
import com.lemon.erp.framework.record.RecordTypeProvider;
import com.lemon.erp.modules.oa.mapper.OaCarRequestMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 行政办公的业务记录类型：附件、字段变更历史、自定义字段
 */
@Component
@RequiredArgsConstructor
public class OaRecordTypes implements RecordTypeProvider {

    private final OaCarRequestMapper requestMapper;

    @Override
    public List<RecordType> recordTypes() {
        // 名称写消息键（oa.label.carRequest），自定义字段、附件等页面按请求语言显示
        return List.of(new RecordType("oa_car_request", "oa.label.carRequest", "oa:car:list", "oa:car:edit",
                OaCarRequestService.RULE, requestMapper::selectById));
    }
}
```

用车申请按制单人部门 + 制单人做数据权限，所以传入 `OaCarRequestService.RULE`，其他部门的用户即使知道 ID 也读写不了它的自定义字段。各参数的含义见 [文件与附件](../architecture/file)。

另外确认新增接口**返回新记录的 ID**（`R<Long>`）：前端在业务记录保存成功后才能用这个 ID 保存自定义字段的值。

后端的改动到此为止，重启后「系统管理 → 自定义字段」的业务类型中出现「用车申请」。

### 2. 表单：useCustomFields

`composables/useCustomFields.js` 的 `useCustomFields(bizType)` 加载业务类型启用的字段，`wrap(options)` 包装 `useFormDrawer` 的选项：

- 表单数据中增加 `cf`（`{ 字段标识: 值 }`），计入「未保存修改」的判断；
- 编辑时与 `fetch` 并行读取已有的值；
- 提交时把业务字段和 `cf` 分开：先检查必填的自定义字段（未填时提示并中止，不会保存业务记录），再调用原来的 `create` / `update`，成功后保存自定义字段的值（`create` 用返回的新 ID）。

在用车申请列表页中：

```js
import CustomFieldsForm from '@/components/common/CustomFieldsForm.vue'
import { useCustomColumns, useCustomFields } from '@/composables/useCustomFields'

const cf = useCustomFields('oa_car_request')
const cfFields = cf.fields

const drawer = useFormDrawer(
  cf.wrap({
    emptyForm: () => ({ id: undefined, useDate: undefined, carType: undefined, destination: '', purpose: '', passengers: 1, remark: '' }),
    fetch: (record) => getCarRequest(record.id),
    create: addCarRequest,          // 必须返回新记录的 ID
    update: updateCarRequest,
    toPayload: ({ useDate, carType, destination, purpose, passengers, remark }) =>
      ({ useDate, carType: carType || null, destination, purpose, passengers, remark }),
    onSuccess: load
  })
)
```

在表单中放输入项（没有启用的字段时不渲染任何内容）：

```vue
<FormDrawer :drawer="drawer" :create-title="$t('oa.car.create')" :edit-title="$t('oa.car.edit')">
  <a-form ref="formRef" :model="form" :rules="rules" layout="vertical">
    <a-row :gutter="16">
      <!-- 原有字段 ... -->
    </a-row>
    <CustomFieldsForm :fields="cfFields" :values="form.cf || {}" :title="$t('oa.car.extraInfo')" />
  </a-form>
</FormDrawer>
```

自定义字段的名称、选项是管理员在「自定义字段」页面中录入的数据，按录入的文字显示，不随界面语言翻译。

`CustomFieldsForm` 的属性：`fields`（启用的字段）、`values`（直接修改的值对象）、`title`（分组标题）、`span`（每项在 sm 以上占的栅格，默认 12 即每行两项；子页表单可用 8 每行三项）、`disabled`。必填字段带红色星号，字段的「说明」显示为输入提示。

::: tip toPayload
`wrap` 会把 `toPayload` 的结果作为业务记录的提交数据。没有写 `toPayload` 时默认去掉 `id`、`createTime`、`updateTime`、`children` 和 `cf` 后提交，`cf` 不会混入业务接口的请求体。
:::

### 3. 列表：useCustomColumns

勾选了「列表显示」的字段可以作为列表列。`useCustomColumns(bizType, list)` 返回列定义（`key` 为 `cf:字段标识`，宽 120，带 `custom` 属性）和取值函数，当前页的记录变化时批量读取值：

```js
const { columns: cfColumns, cell: cfCell } = useCustomColumns('oa_car_request', list)

// 自定义字段列放在操作列之前
const tableColumns = computed(() => {
  const cols = visibleColumns.value
  const action = cols.findIndex((c) => c.key === 'action')
  return action < 0 ? [...cols, ...cfColumns.value] : [...cols.slice(0, action), ...cfColumns.value, ...cols.slice(action)]
})
```

```vue
<a-table :columns="tableColumns" ...>
  <template #bodyCell="{ column, record }">
    <!-- 原有的列 ... -->
    <template v-else-if="column.custom">{{ cfCell(record, column) }}</template>
  </template>
</a-table>
```

`cfCell` 按类型显示文本（是否类型显示「是」/「否」）。表格的 `:scroll` 宽度可以适当加大。

### 4. 详情：CustomFieldsView

有详情页的单据用 `CustomFieldsView` 只读显示：

```vue
<CustomFieldsView :key="detail.id" biz-type="oa_car_request" :biz-id="detail.id" />
```

`bizId` 变化时自动重新读取；组件暴露 `reload()`，在详情中编辑保存后调用即可刷新。没有启用的字段时不渲染。

### 5. 验证

1. 在「系统管理 → 自定义字段」中为「用车申请」新增几个不同类型的字段，其中一个设为必填、一个勾选「列表显示」；
2. 新增用车申请，确认表单出现「扩展信息」，必填字段不填时不能保存；保存后编辑，值正确带出；
3. 列表中出现勾选了「列表显示」的列；
4. 用没有该单据修改权限的账号确认不能保存值，用其他部门的账号确认读不到不在数据权限内的记录的值。

## 注意事项

- 业务记录和自定义字段的值是两次请求分别保存的，不在同一个事务中：业务记录保存成功、值保存失败时（如值格式不正确），业务记录已经保存，页面提示错误后可以再次编辑保存。
- 删除业务记录时不会自动删除它的自定义字段值；删除字段定义时会删除该字段的全部值。
- 自定义字段的值不参与列表的查询条件，也不包含在列表的 Excel 导出、导入和打印中；需要按某个扩展信息查询、统计或在单据上打印时，应在业务表中增加正式的字段。
- 新增业务类型的 `code` 一旦有用户定义过字段就不要再修改，否则已有的定义和值会对应不上。
