---
order: 2
---

# 前端开发规范

前端位于 `lemon-web`，使用 Vue 3 组合式 API（`<script setup>`）+ Ant Design Vue 4。本页介绍页面的标准写法，新页面请参照现有页面保持一致的交互。

## 目录与命名

| 位置 | 内容 |
| --- | --- |
| `src/api/<模块>/<功能>.js` | 接口函数，基于 `@/utils/request` |
| `src/views/<模块>/<页面>/index.vue` | 菜单页面，路径即菜单的「组件路径」（`wms/warehouse/index`） |
| `src/components/<模块>/` | 本模块的单据表单（`XxxForm.vue`）、详情（`XxxDetail.vue`）等组件 |
| `src/components/` | 通用组件：`TableToolbar`、`SearchForm`、`FormDrawer`、`SubPage`、`DictTag`、`StatusSwitch`、`AttachmentPanel`、`ChangeLogPanel`、`ImportModal` |
| `src/components/common/` | `LineItemsTable`（单据明细行表格）、`CustomFieldsForm`、`CustomFieldsView`（自定义字段的输入与只读显示） |
| `src/components/print/` | `PrintPreview`（全局打印预览窗口）、`OverlayDesigner`（套打设计器） |
| `src/composables/` | `useTable`、`useColumns`、`useFormDrawer`、`useDict`、`useAction`（单条操作）、`useLineItems`（明细行）、`useCustomFields` |
| `src/constants/enums.js` | 由后端枚举生成的状态、类型常量（`npm run gen:enums`），见 [状态与类型常量](#状态与类型常量) |
| `src/utils/number.js` | 金额、数量的格式化与舍入（`money`、`qty`、`round2` 等），见 [数字的显示与舍入](#数字的显示与舍入) |
| `src/locales/<语言>/<模块>.js` | 界面文字的语言包（`zh-CN`、`en-US`，键一致），`en-US/menu.js`、`dict.js` 是菜单和字典的英文译文，见 [国际化](./i18n) |

## 接口封装

```js
// src/api/wms/warehouse.js
import request from '@/utils/request'

const ids = (v) => [].concat(v).join(',')

export const pageWarehouse = (params) => request.get('/wms/warehouse', { params })
export const getWarehouse = (id) => request.get(`/wms/warehouse/${id}`)
export const addWarehouse = (data) => request.post('/wms/warehouse', data)
export const updateWarehouse = (id, data) => request.put(`/wms/warehouse/${id}`, data)
export const changeWarehouseStatus = (id, status) => request.put(`/wms/warehouse/${id}/status`, { status })
export const deleteWarehouse = (id) => request.delete(`/wms/warehouse/${ids(id)}`)
```

`request` 的 `baseURL` 为 `/api`，超时 15 秒。响应拦截器的处理：

- `code === 200`：直接返回 `data`（页面中 `const page = await pageWarehouse(params)` 拿到的就是 `{ records, total }`）；
- `code === 401` 或 HTTP 401：清除令牌，提示「登录已过期」后跳转登录页；
- 其他错误：`message.error` 显示后端的 `msg`，并给错误对象打上 `handled` 标记后 reject。

请求拦截器给每个请求加上 `Accept-Language: <界面语言>`（`zh-CN` / `en-US`），后端据此返回对应语言的 `msg`，所以页面直接显示后端的提示即可，不需要自己翻译。

因此页面中**不需要 catch 来提示错误**，用 `try / finally` 恢复 loading 状态即可；`main.js` 的全局错误处理会忽略已提示过的错误。

```js
async function remove(id) {
  await deleteWarehouse(id)      // 失败时拦截器已提示，后续代码不会执行
  message.success(t('common.msg.deleteSuccess'))
  load()
}
```

这种「调接口 → 提示成功 → 刷新」的单条操作一般直接用 [useAction](#单条操作-useaction) 生成。

文件下载用 `responseType: 'blob'`，成功时返回 Blob，失败时拦截器会把 JSON 错误解析出来提示。

## 列表页

列表页参照 `views/system/user/index.vue` 或 `views/wms/warehouse/index.vue`，结构固定：

```vue
<template>
  <div class="table-page">
    <a-card v-show="showSearch" :bordered="false" class="page-card">
      <SearchForm :model="query" @search="search" @reset="resetQuery">
        <a-form-item :label="$t('wms.common.warehouse')" name="keyword">
          <a-input v-model:value="query.keyword" :placeholder="$t('wms.flow.codeOrName')" allow-clear />
        </a-form-item>
        <a-form-item :label="$t('common.field.status')" name="status">
          <a-select v-model:value="query.status" :placeholder="$t('common.placeholder.all')" allow-clear :options="toOptions(dict.sys_common_status, true)" />
        </a-form-item>
      </SearchForm>
    </a-card>

    <a-card :bordered="false" class="page-card table-card">
      <TableToolbar
        :exporter="exportAll"
        v-model:size="size"
        v-model:checked="checked"
        v-model:show-search="showSearch"
        :columns="columns"
        @refresh="load"
      >
        <a-button v-perm="'wms:warehouse:add'" type="primary" @click="drawer.openCreate()">
          <template #icon><PlusOutlined /></template>{{ $t('wms.warehouse.createTitle') }}
        </a-button>
      </TableToolbar>

      <a-table
        row-key="id"
        :size="size"
        :columns="visibleColumns"
        :data-source="list"
        :loading="loading"
        :pagination="pagination"
        :scroll="{ x: 1200, y: '100%' }"
        @change="onTableChange"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'type'">
            <DictTag type="wms_warehouse_type" :value="record.type" />
          </template>
          <template v-else-if="column.key === 'action'">
            <span class="table-actions">
              <a-button v-perm="'wms:warehouse:edit'" type="link" size="small" @click="drawer.openEdit(record)">{{ $t('common.action.edit') }}</a-button>
            </span>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { PlusOutlined } from '@ant-design/icons-vue'
import DictTag from '@/components/DictTag.vue'
import SearchForm from '@/components/SearchForm.vue'
import TableToolbar from '@/components/TableToolbar.vue'
import { pageWarehouse } from '@/api/wms/warehouse'
import { useColumns } from '@/composables/useColumns'
import { useDict } from '@/composables/useDict'
import { useTable } from '@/composables/useTable'
import { toOptions } from '@/utils/dict'

const { t } = useI18n()
const dict = useDict('sys_common_status', 'wms_warehouse_type')

// 切换语言会刷新整个页面，列定义直接用 t()，不需要 computed
const columns = [
  { title: t('wms.common.warehouse'), key: 'name', width: 200 },
  { title: t('common.field.type'), key: 'type', width: 150, dict: 'wms_warehouse_type' },
  { title: t('wms.warehouse.address'), dataIndex: 'address', width: 240, ellipsis: true },
  { title: t('common.action.operation'), key: 'action', width: 220, fixed: 'right' }
]
const { checked, visibleColumns } = useColumns(columns, 'wms-warehouse')
const showSearch = ref(true)

const query = reactive({ keyword: undefined, status: undefined })
const { list, loading, size, pagination, load, search, onTableChange, exportAll } = useTable(pageWarehouse, query)

function resetQuery() {
  Object.assign(query, { keyword: undefined, status: undefined })
  search()
}

onMounted(load)
</script>
```

要点：

- 根元素 `class="table-page"`，表格所在卡片加 `table-card`，表格设置 `:scroll="{ x: 总宽度, y: '100%' }"`：表头固定，只有表格区域滚动，分页条始终可见；
- `TableToolbar` 提供刷新、密度、列设置、显示 / 隐藏搜索栏、导出，默认插槽放操作按钮，`extra` 插槽放右侧附加按钮；
- `useColumns(columns, 存储键)` 记住用户隐藏的列（只存隐藏的列，以后新增的列默认显示）；
- 列定义加 `dict: '字典类型'` 后导出 Excel 时输出字典标签，或用 `exportValue: (record) => 值` 自定义；
- 操作列 `key: 'action'`、`fixed: 'right'`，按钮放在 `span.table-actions` 中；
- 页面上的文字全部用 `$t` / `t`，列 `title` 同时用作导出 Excel 的表头，导出也会跟随界面语言。

### useTable

```js
const { list, loading, size, pagination, selectedKeys, rowSelection, load, search, onTableChange, exportAll } =
  useTable(fetcher, query, { params: (q) => ({ ...q, beginTime: q.range?.[0], endTime: q.range?.[1], range: undefined }) })
```

| 返回值 | 说明 |
| --- | --- |
| `list` / `loading` / `pagination` | 绑定到 `a-table` |
| `load()` | 按当前页重新加载；快速切换条件时只采用最后一次请求的结果；删除最后一页的全部数据后自动回到上一页 |
| `search()` | 回到第 1 页并加载 |
| `onTableChange` | 绑定 `@change`，处理翻页、改每页条数 |
| `selectedKeys` / `rowSelection` | 多选 |
| `exportAll(columns, filename?)` | 按当前条件导出 Excel，传给 `TableToolbar` 的 `exporter` |

`fetcher` 接收 `{ current, size, ...query }`，返回 `{ records, total }`。`options.params` 用于把查询条件转换为接口参数（如把时间范围拆成两个参数）。

## 表单：useFormDrawer + FormDrawer

新增 / 编辑表单统一用 `useFormDrawer` 管理状态，`FormDrawer` 渲染外壳（标题、保存 / 取消按钮、加载状态）：

```vue
<FormDrawer :drawer="drawer" :create-title="$t('wms.warehouse.createTitle')" :edit-title="$t('wms.warehouse.editTitle')">
  <a-form ref="formRef" :model="form" :rules="rules" layout="vertical">
    <a-form-item :label="$t('wms.warehouse.code')" name="code">
      <a-input v-model:value="form.code" :maxlength="32" />
    </a-form-item>
    <a-form-item :label="$t('wms.warehouse.name')" name="name">
      <a-input v-model:value="form.name" :maxlength="64" />
    </a-form-item>
  </a-form>
</FormDrawer>
```

```js
const rules = {
  code: [{ required: true, message: t('wms.warehouse.inputCode') }],
  name: [{ required: true, whitespace: true, message: t('wms.warehouse.inputName') }]
}
const drawer = useFormDrawer({
  emptyForm: () => ({ id: undefined, code: '', name: '', type: 'NORMAL', remark: '' }),
  fetch: (record) => getWarehouse(record.id),   // 编辑时加载详情，不传则直接用表格行数据
  create: addWarehouse,
  update: updateWarehouse,
  toPayload: ({ code, name, type, remark }) => ({ code, name, type, remark }),   // 可选，默认去掉 id 和只读字段
  onSuccess: load
})
const { formRef, form } = drawer
```

| 选项 | 说明 |
| --- | --- |
| `emptyForm` | 返回空表单（必填） |
| `beforeOpen(record)` | 打开前加载下拉选项等依赖数据，新增时 `record` 为 null |
| `fetch(record)` | 编辑时加载详情 |
| `create(payload)` / `update(id, payload)` | 保存，按表单是否有 `id` 调用 |
| `toPayload(form)` | 提交数据，默认去掉 `id`、`createTime`、`updateTime`、`children` |
| `onSuccess` | 保存成功后回调，一般用于刷新列表 |
| `successMessage` | 默认 `t('common.msg.saveSuccess')`（「保存成功」） |

自带的行为：打开时加载详情（失败自动关闭）、保存前校验、有未保存的修改时关闭会二次确认、`Ctrl / ⌘ + Enter` 快捷保存。返回值中的 `openCreate(defaults)`、`openEdit(record)` 打开表单。

### 抽屉还是子页

| 场景 | 写法 |
| --- | --- |
| 字段少的简单资料（仓库、库位、职位等） | 默认的抽屉：`<FormDrawer :drawer="drawer">` |
| 有明细行、字段多的单据（订单、出入库单、凭证等） | 子页：`<FormDrawer page :drawer="drawer" width="min(1200px, 100vw)">` |

子页占满内容区、覆盖在列表之上，返回后列表的筛选、分页、滚动位置不变。单据表单一般封装为组件（如 `components/scm/OrderForm.vue`），通过 `defineExpose({ openCreate, openEdit: drawer.openEdit })` 暴露给列表页，保存成功后 `emit('success')` 通知列表页刷新；列表页需要据此刷新已打开的详情时带上单据 ID（如 `OrderForm`、`QuotationForm` 的 `emit('success', id)`）。

## 详情：SubPage

单据详情用 `SubPage`，用法与 `a-drawer` 一致（`open`、`title`、`@close`，插槽 `title`、`extra`、`footer`；`width` 等抽屉属性会被忽略）：

```vue
<template>
  <SubPage :open="open" :title="detail ? $t('oa.car.detailTitle', { no: detail.requestNo }) : $t('oa.car.title')" @close="emit('update:open', false)">
    <template #extra>
      <a-space>
        <a-button size="small" @click="print">{{ $t('common.action.print') }}</a-button>
        <a-button v-perm="'oa:car:edit'" size="small" @click="emit('edit', detail)">{{ $t('common.action.edit') }}</a-button>
      </a-space>
    </template>
    <a-spin :spinning="loading">
      <!-- 详情内容 -->
    </a-spin>
  </SubPage>
</template>

<script setup>
import { ref, watch } from 'vue'
import SubPage from '@/components/SubPage.vue'
import { getCarRequest } from '@/api/oa/car'

const props = defineProps({ open: Boolean, requestId: Number })
const emit = defineEmits(['update:open', 'edit'])

const detail = ref()
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    detail.value = await getCarRequest(props.requestId)
  } finally {
    loading.value = false
  }
}

watch(() => [props.open, props.requestId], ([open]) => open && load(), { immediate: true })

defineExpose({ reload: load })
</script>
```

**从详情进入编辑时不要关闭详情**：编辑子页会叠在详情之上，保存后回到详情，由列表页调用详情组件暴露的 `reload()` 刷新：

```js
const detailRef = ref()
function onSaved(id) {
  load()   // 刷新列表
  if (detailOpen.value && id === detailId.value) detailRef.value?.reload()
}
```

多个子页叠加时后打开的在上面，返回时逐层关闭。

## 字典：useDict + DictTag

```js
import { useDict } from '@/composables/useDict'
import { toOptions } from '@/utils/dict'

const dict = useDict('sys_common_status', 'wms_warehouse_type')
// 模板中：dict.wms_warehouse_type 为该类型的字典数据数组
// 下拉选项：:options="toOptions(dict.wms_warehouse_type)"
```

```vue
<!-- 按字典显示带颜色的标签（颜色取字典数据的 tag_color） -->
<DictTag type="wms_warehouse_type" :value="record.type" />
```

字典数据由 `store/dict.js` 按类型缓存，同一类型只请求一次（接口 `/system/dict/data/type/{type}`，系统字典返回平台的取值，业务字典返回当前租户的取值）。加载后标签按界面语言翻译：英文译文在 `locales/en-US/dict.js`（`字典类型: { 字典值: '英文' }`），没有译文时显示数据库中的标签，所以新增内置字典时要同时加英文译文。状态、类型等取值一律通过字典显示，不在页面中硬编码标签文字。

字典分为两种（见 [字典](../architecture/tenant#字典)），前端的用法相同，区别在于取值能否写在代码里：

| 种类 | 维护 | 前端判断取值时 |
| --- | --- | --- |
| 系统字典（状态、单据类型等） | 平台在「系统管理 → 字典管理」中改名称、颜色、排序，不能增删取值 | 用 `@/constants/enums` 中的常量（字典值与后端枚举名称一致） |
| 业务字典（客户等级、物料分类、收发类别等） | 租户在「系统管理 → 业务字典」中新增、改名、停用 | 下拉选项全部来自字典，不在页面中写死可选值；只有程序依赖的内置取值可以用字面量或在页面中定义常量 |

### 不能手工选择的取值

有些字典取值只能由业务单据自动产生（如出入库类型中的「采购入库」由采购入库单生成、项目费用中的「人工」来自工时、商机阶段中的「赢单 / 输单」由专门的操作产生），后端会拒绝手工录入。下拉中仍列出这些取值，但设为不可选并说明来源，让用户知道为什么不能选：

```js
// views/crm/opportunity/index.vue：新建只能选进行中的阶段，赢单 / 输单显示为禁用并提示在商机详情中推进
const openStageOptions = computed(() =>
  toOptions(dict.crm_opp_stage).map((o) => (OPEN_STAGES.includes(o.value) ? o : { ...o, label: t('crm.opportunity.closedStageHint', { label: o.label }), disabled: true }))
)
```

说明较长时放在选项右侧（`components/wms/wms.js` 的 `docTypeOptions` 返回 `{ value, label, disabled, hint }`，`StockDocForm.vue` 用 `#option` 插槽显示 `hint`，并设 `option-label-prop="label"` 让选中后只显示名称）。新增由业务单据生成的出入库类型时，在 `wms.js` 的 `AUTO_TYPE_SOURCES` 中登记来源。

## 状态与类型常量

页面中比较状态、类型等取值时使用 `@/constants/enums` 中的常量，不写 `'DRAFT'` 这样的字面量：

```js
import { OrderStatus, WorkOrderStatus } from '@/constants/enums'

if (record.status === WorkOrderStatus.DRAFT) { ... }
const editable = [OrderStatus.APPROVED, OrderStatus.PARTIAL].includes(d.status)
```

```vue
<a-button v-if="record.status === LoanStatus.DRAFT" ...>
```

- 该文件由 `npm run gen:enums`（`scripts/gen-enums.mjs`）从后端 `lemon-common`、`lemon-framework`、`lemon-modules` 中**文件名与枚举同名的顶层 Java 枚举**生成，**不要手工修改**；后端新增或修改枚举后重新生成并一起提交。
- 每个枚举导出一个冻结对象，键和值都是常量名（与数据库、JSON 中的取值一致），注释带 Java 类名和对应的字典。
- 导出名为 Java 简单类名；多个模块有同名枚举时全部加模块前缀（如 `WmsDocStatus`、`MesDocStatus`），`lemon-common` / `lemon-framework` 的前缀为 `Common` / `Framework`。
- `npm run i18n:check` 的最后一步（`gen-enums.mjs --check`）检查生成的文件是否与后端一致，不一致时提示重新生成。
- 业务字典（租户可扩展的分类）、Java 类内部的嵌套枚举、前端自己合成的取值不在其中，仍用字面量或在页面 / 模块的 js 中定义常量。
- 用 `@JsonValue` 自定义 JSON 取值的枚举不生成。目前只有启用 / 停用 `EnableStatus`，接口中是数字 1 / 0，前端用 `@/utils/constants` 中的 `STATUS_ENABLED`（1）/ `STATUS_DISABLED`（0），如新增表单的默认值 `status: STATUS_ENABLED`。

## 单条操作：useAction

删除、审核、关闭、提交等单条操作的流程都是「（可选的确认）→ 调接口 → 提示成功 → 刷新」，用 `useAction` 生成处理函数，不必每次写 `async function`：

```js
import { useAction } from '@/composables/useAction'

// 参数原样传给接口；a-popconfirm 已经确认过，不再弹确认框
const remove = useAction(deleteLoan, { successKey: 'common.msg.deleteSuccess', reload: () => load() })

// 先弹确认框；成功提示按接口返回值决定
const submit = useAction((r) => submitCarRequest(r.id), {
  confirm: (r) => t('oa.car.confirmSubmit', { no: r.requestNo }),
  successKey: (approving) => (approving ? t('oa.car.submittedFlow') : t('oa.car.approved')),
  reload: () => load()
})
```

```vue
<a-popconfirm :title="$t('common.msg.confirmDelete')" @confirm="remove(record.id)">...</a-popconfirm>
<a-button type="link" size="small" @click="submit(record)">{{ $t('common.action.submit') }}</a-button>
```

| 选项 | 说明 |
| --- | --- |
| `confirm` | 先弹出 `Modal.confirm`：标题文字、`Modal.confirm` 的参数对象，或 `(...参数) => 前两者`（返回空时不确认） |
| `successKey` | 成功提示的消息键（默认 `common.msg.operationSuccess`），或 `(接口结果, ...参数) => 提示文字`（返回空不提示）；`false` 不提示 |
| `reload` | `(接口结果, ...参数) => 成功后执行`，一般是刷新列表或详情。写成 `() => load()`，即使声明在 `useTable` 之前也不会出错 |
| `loading` | 一个 `ref(false)`，调用期间为 `true`，用于按钮的 loading 状态 |

失败时由请求拦截器提示错误，返回的 Promise 会 reject；有确认框时确认框由 `Modal` 处理，不 reject。

## 单据明细：useLineItems + LineItemsTable

有明细行的单据表单用 `useLineItems` 管理增删行、行 key 和合计，表格用 `components/common/LineItemsTable.vue`：

```vue
<div class="items-head">
  <span>{{ $t('common.field.total') }} <b>{{ money(itemTotal) }}</b></span>
  <a-button size="small" @click="lines.addRow()">{{ $t('common.action.addRow') }}</a-button>
</div>
<LineItemsTable :items="form.items" :columns="itemColumns" :min-rows="1">
  <template #cell="{ column, record }">
    <template v-if="column.key === 'accountId'">
      <AccountSelect v-model:value="record.accountId" />
    </template>
    <template v-else-if="column.key === 'amount'">
      <a-input-number v-model:value="record.amount" :min="0.01" :precision="2" class="full" />
    </template>
  </template>
</LineItemsTable>
```

```js
import LineItemsTable from '@/components/common/LineItemsTable.vue'
import { useLineItems } from '@/composables/useLineItems'
import { money } from '@/utils/number'

const itemColumns = [
  { title: t('fin.claim.expenseAccount'), key: 'accountId', width: 260 },
  { title: t('common.field.amount'), key: 'amount', width: 140 },
  { title: t('common.action.operation'), key: 'action', width: 60 }   // key 为 action 的列默认是删除按钮
]

// 表单对象会被 useFormDrawer 整体替换，所以传函数
const lines = useLineItems(() => form.value.items, { newRow: () => ({ accountId: undefined, amount: undefined }) })
const itemTotal = lines.total('amount')      // computed，按 round2 舍入

// 编辑时给后端返回的明细补上 key
fetch: async (record) => {
  const d = await getClaim(record.id)
  return { ...d, items: d.items.map(lines.withKey) }
}
```

`useLineItems(items, { newRow, field })`：

| 返回值 | 说明 |
| --- | --- |
| `addRow(extra?, { first }?)` | 加一行并返回该行，`newRow(当前明细)` 的默认值被 `extra` 覆盖；`{ first: true }` 加在最前面 |
| `removeRow(行或下标)` | 删除一行（表格分页时传行对象） |
| `withKey(item)` | 给后端返回的明细补上 `key`（已保存的用 `item-{id}`，新增行生成临时 key）；也可以单独导入 `lineKey`、`rowKey` |
| `total(字段或函数, round?)` | 合计（computed），默认 `round2`，传 `(n) => n` 不舍入 |
| `itemName(record, 字段)` | 行内表单项的校验路径 `[field, 行位置, 字段]`，用于 `a-form-item` 的 `name`，`field` 默认 `items` |

`LineItemsTable` 的属性和插槽：

| 属性 / 插槽 | 说明 |
| --- | --- |
| `items`、`columns` | 必填。行 key 固定为 `key`；横向滚动宽度默认为各列 `width` 之和，可用 `scroll-x` 指定 |
| `min-rows` | 行数小于等于该值时删除按钮不可用（默认 0） |
| `confirm-remove` | `(行) => 确认框标题`，返回空时直接删除 |
| `pagination`、`empty-text` | 同 `a-table` |
| `#cell` | 除操作列外的单元格，参数同 `a-table` 的 `bodyCell`（`column`、`record`、`index`） |
| `#action` | 替换默认的删除按钮 |
| `@remove` | 删除一行后触发，参数为该行 |

完整的单据示例见 [单据开发公共组件](./doc-components)，现有页面可参考 `components/scm/QuotationForm.vue`、`components/wms/CheckForm.vue`、`views/fin/claim/index.vue`。

## 数字的显示与舍入

金额、数量的显示和舍入统一用 `utils/number.js`，与后端 `Decimals` 的精度一致（金额 2 位、数量和单价 4 位，四舍五入），不要在页面里再写 `toLocaleString`、`Math.round(x * 100) / 100`：

| 函数 | 说明 |
| --- | --- |
| `money(n, empty = '-')` | 千分位、2 位小数，空值显示 `empty` |
| `moneyOrBlank(n)` | 同上，0 或空值显示为空（账簿中更易读） |
| `price(n)` | 千分位、2～4 位小数 |
| `qty(n, digits = 4)` | 千分位，去掉多余的 0，最多 4 位小数，空值显示 `-` |
| `num(v, digits = 0)` | 千分位，最多 `digits` 位小数，空值或非数字显示 `-` |
| `formatDecimal(n, { min, max })` | 自定义小数位数 |
| `round2(n)` / `round4(n)` | 四舍五入到 2 位 / 4 位，提交前处理浮点误差（如 `0.3 - 0.1`） |
| `nz(n)` | 空值、非数字按 0 处理 |
| `sumBy(list, 字段或函数, round = round2)` | 求和 |

模块中已有的 `formatMoney`（`components/scm/scm.js`）、`formatQty`（`components/wms/wms.js`）等是这些函数的封装，可以继续使用。

## 下拉框与表格的显示

全局约定（`main.js`、`style.css`、`utils/ellipsisTitle.js`），页面不需要额外处理：

- **下拉框按内容宽度展开**：`Select`、`TreeSelect` 的 `dropdownMatchSelectWidth` 默认改为 `false`，弹层不窄于输入框、最宽 560px，更长的选项换行显示而不是省略，所以放在表格窄列中的下拉框也能看全选项。`false` 会关闭虚拟滚动，**选项可能很多的下拉保留虚拟滚动**，给一个固定宽度的数字：物料、科目 `400`，客户 / 供应商、项目 `360`，员工、用户 `300`，仓库、库位 `280`（见 `MaterialSelect`、`AccountSelect`、`PartnerSelect` 等选择组件）。新写这类远程搜索的选择组件时同样设置 `:dropdown-match-select-width="数字"`。
- **编辑表格中的下拉框占满单元格**：表格单元格内的 `a-select` 默认 `width: 100%`（`:where()` 选择器，不增加优先级，组件中显式设置的宽度仍然生效）。可编辑明细表中放物料、库位、税率等下拉的列要留够宽度（物料约 290、库位约 200）。
- **省略单元格悬停显示全文**：列设置了 `ellipsis: true` 时，antd 只给纯文本单元格加 `title`；`installEllipsisTitle` 全局监听鼠标悬停，用 `#bodyCell` 插槽渲染的单元格内容被截断时也会显示完整文字。
- **表格中的标签换行**：非省略列中的 `a-tag`（如 `DictTag`）在窄列中换行显示，不会溢出单元格，英文界面的长标签也能完整显示。
- **子页标题**：`SubPage` 的标题过长被截断时悬停显示全文。

## 拆分大页面

页面超过约 500 行时，把弹窗、标签页、表单拆成同目录下的子组件，`index.vue` 只保留列表和组件的组装：

```
views/mes/wo/
├── index.vue            列表、查询、打开子组件
├── wo.js                本页面共用的常量和函数
├── WoForm.vue           新增 / 编辑
├── WoDetail.vue         详情（SubPage），内含 WoMaterialsTab、WoOpsTab、WoReportsTab、WoDocsTab
└── WoReportModal.vue、WoQtyModal.vue、WoSplitModal.vue、WoReworkModal.vue   各种操作弹窗
```

子组件通过 `defineExpose({ open })` 暴露打开方法，操作完成后 `emit('success')` 等事件通知页面刷新。被多个页面使用的表单、详情放到 `components/<模块>/` 下。

## 按钮权限：v-perm

```vue
<a-button v-perm="'wms:warehouse:add'" type="primary">{{ $t('wms.warehouse.createTitle') }}</a-button>
<!-- 数组：满足其一即可 -->
<a-button v-perm="['scm:purchase:add', 'scm:purchase:edit']">{{ $t('common.action.save') }}</a-button>

<!-- a-popconfirm 这类没有根元素的组件，外面包一层元素 -->
<span v-perm="'wms:warehouse:remove'">
  <a-popconfirm :title="$t('wms.warehouse.confirmDelete', { name: record.name })" @confirm="remove(record.id)">
    <a-button type="link" danger size="small">{{ $t('common.action.delete') }}</a-button>
  </a-popconfirm>
</span>
```

`v-perm` 在挂载时移除没有权限的元素。需要在脚本中判断时用 `useUserStore().hasPerm(perm)`，例如 `StatusSwitch` 的 `:disabled="!userStore.hasPerm('wms:warehouse:edit')"`。

## 样式与深色模式

- 自定义样式使用全局 CSS 变量（定义在 `src/style.css`）：`--app-primary`、`--app-bg`、`--app-card`、`--app-border`、`--app-hover`、`--app-text`、`--app-text-2`、`--app-text-3` 等。亮色为默认值，`html[data-theme='dark']` 时切换为暗色，使用变量的样式自动适配深色模式。
- 页面私有样式写在 `<style scoped>` 中。
- 必须针对深色模式单独写的样式（变量覆盖不到的渐变、图片透明度等），写在**非 scoped** 的 `<style>` 中，并用页面根类名限定范围，因为需要匹配根元素 `html` 上的 `data-theme`，而 scoped 样式中的 `:global()` 不生效：

```vue
<style scoped>
.hero {
  background: var(--app-card);
}
</style>

<style>
/* 暗色：需要匹配根元素的 data-theme，不能放在 scoped 中 */
html[data-theme='dark'] .workbench .hero {
  background: linear-gradient(100deg, rgba(255, 212, 59, 0.07), rgba(0, 0, 0, 0) 55%), var(--app-card);
}
</style>
```

## 移动端

- 页面要在窄屏下可用：表单用 `a-row` / `a-col` 的响应式栅格（`:xs="24" :sm="12"`），抽屉宽度用 `min(640px, 100vw)`。
- 手机 / PDA 的移动作业页面放在 `views/mobile` 下，菜单路径以 `/m` 开头，使用全屏的 `MobileLayout`。

## 数据大屏

数据大屏不使用后台布局，是两个静态路由（`router/index.js`）：

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/screen/:key` | `views/screen/ScreenPage.vue` | 登录后查看，`key` 为 `factory`（生产车间）/ `progress`（生产进度）/ `warehouse` / `sales` / `quality`（不区分大小写）；`?rotate=factory,quality&interval=60` 轮播，`?workCenterId=` 生产车间、生产进度按工作中心显示（`screen.js` 的 `WORK_CENTER_SCREENS`） |
| `/screen-share/:token` | `views/screen/ShareScreenPage.vue` | 投屏链接，免登录。路由守卫对 `SCREEN_SHARE_PATH` 开头的路径直接放行，不加载用户和菜单（电视上可能残留过期的登录令牌） |

两者都交给 `ScreenRunner.vue`：轮播、每 30 秒刷新当前大屏、请求失败时保留上次数据并在标题栏提示离线。通用组件在 `components/screen`：

| 组件 | 作用 |
| --- | --- |
| `ScreenShell` | 外壳：按 1920 × 1080 设计、`transform: scale` 等比缩放铺满窗口；标题栏（企业名称、日期、时钟、更新时间 / 离线提示）、多屏切换、右下角轮播 / 全屏 / 返回按钮 |
| `ScreenKpi` | 指标卡（数字滚动动画），属性 `label`、`value`、`unit`、`digits`、`sub`、`subClass`（`up` / `down`）、`color` |
| `ScreenPanel` | 面板（标题 + `#extra` 插槽） |
| `ScrollList` | 自动滚动列表，`columns` 的 `width` 用 CSS Grid 写法（`140px`、`1fr`），`#cell` 插槽自定义单元格 |
| `screen.js` | `SCREENS` 大屏清单、`WORK_CENTER_SCREENS` 可按工作中心显示的大屏、配色 `COLORS` / `PALETTE`、`fmtNum` / `fmtMoney` / `fmtRate` 格式化、`axisStyle` / `tooltip` / `legend` / `gradient` 图表样式 |

图表使用 `<EChart :option height="100%" dark />`，`dark` 强制暗色配色，不跟随系统主题。大屏的数据请求在 `api/bi/screen.js` 中用独立的 axios 实例：失败时不弹全局提示、401 不跳转登录页（无人值守的电视不能被弹窗打断），投屏链接请求不带登录令牌。

### 新增一块大屏

1. 后端：在 `bi/model/ScreenKey` 中加枚举值（参数为大屏标题的消息键和能否按工作中心显示，如 `FACTORY("bi.label.factory", true)`，消息键在 `bi.properties`、`bi_en.properties` 中登记），在 `bi/dto/BiScreen` 中加一个实现 `ScreenData` 的 record（带 `key`、`title`、`time`，`ScreenData` 是 `sealed` 接口，要在 `permits` 中加上），在 `BiScreenService.data` 的 `switch` 中加一个方法，一次返回 `kpi`、各图表和列表的全部数据（统计查询的结果用带 setter 的类，不返回 `Map`）；统计 SQL 写在 `BiScreenMapper.xml` 中，按租户自动过滤，不加数据权限（大屏接口要求「全部数据」）。列表加 `LIMIT`，趋势类数据用 `fillDays` 补齐没有数据的日期。
2. 前端：在 `views/screen` 下新建 `XxxScreen.vue`（接收 `data` 属性，引入 `./screen.css` 使用 `screen-grid` 的「一行指标卡 + 两行面板」布局），在 `ScreenRunner.vue` 的 `COMPONENTS` 中登记，在 `components/screen/screen.js` 的 `SCREENS` 中加入 `key`、`label`、`desc`（用 `t('screen.screens.xxx')`，译文在 `locales/<语言>/screen.js`；数据大屏页面的卡片、投屏链接表单的选项都来自这里；能按工作中心显示的同时加入 `WORK_CENTER_SCREENS`）。大屏上直接拿到的字典值用 `dictLabel` / `withDictLabel` 按语言显示。
3. 投屏链接按 `ScreenKey` 保存（`bi_screen_share.screens` 逗号分隔），无需改表；如果 `screens` 的总长度可能超过 128 个字符，需要加宽该列。
4. 只适合部分用户看的数据（如薪资）不要放进大屏：大屏可以通过投屏链接免登录查看。

## 国际化

- **不要在页面中硬编码中文**：模板用 `$t('键')`，`<script setup>` 中 `const { t } = useI18n()`，普通 js 模块 `import { t } from '@/locales'`；键同时加到 `locales/zh-CN/<模块>.js` 和 `locales/en-US/<模块>.js`。
- 通用的操作、字段、状态、提示、校验优先复用 `common.*`（`common.action.save`、`common.field.status`、`common.msg.saveSuccess`、`common.rule.required` 等）。
- 带参数的句子写成一个完整的键（`'确定删除仓库「{name}」？'`），不要用 `t()` 拼接片段；文字中的 `@ | $ { }` 写成 `{'@'}`。
- 新增内置菜单时在 `locales/en-US/menu.js` 按菜单 ID 加英文名称，新增内置字典时在 `dict.js` 加译文。
- 只对中文有意义的处理（金额大写等）用 `isZh()` 判断；有意保留的中文在行内写 `i18n-ignore`。
- 提交前运行 `npm run i18n:check`，并切换为 English 检查布局（英文通常更长）。详见 [国际化](./i18n)。

## 其他约定

- 不使用 `alert`、`confirm`，确认用 `Modal.confirm` 或 `a-popconfirm`，提示用 `message`。
- 复用已有的格式化函数保持全站一致：金额、数量、单价用 `utils/number.js`（见 [数字的显示与舍入](#数字的显示与舍入)），金额大写 `components/fin/fin.js` 的 `moneyUpper`，文件大小、时长等用 `utils/format.js`。
- 打印使用 `utils/print.js` 的 `printDocs`（后端生成 PDF，在全局的打印预览窗口中打印或下载），见 [单据编号与打印](./doc-no-print)。
- 需要支持自定义字段的表单、列表、详情使用 `useCustomFields`、`CustomFieldsForm`、`useCustomColumns`、`CustomFieldsView`，见 [业务实体接入自定义字段](./custom-field)。
- 前端没有配置 lint 和测试，提交前请在浏览器中验证亮色、深色两种主题、中英文两种语言和窄屏显示。
