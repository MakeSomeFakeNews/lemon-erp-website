---
order: 4
---

# 单据开发公共组件

订单、出入库单、报销单这类单据的后端和前端都有大量相同的写法：提交审批、按原状态流转、按数据权限读取、明细行整体替换、金额合计、增删明细行、单条操作的确认与提示。这些写法已经抽成公共组件，新写单据时直接使用，不要在业务 Service 或页面中重复实现。

本页先逐个介绍组件，最后以 [新增一个业务模块](./new-module) 中的用车申请为例，给它加上「预计费用明细」，演示一张带明细行的单据从后端到前端的完整写法。

## 组件一览

| 场景 | 组件 | 位置 |
| --- | --- | --- |
| 接入审批 | `ApprovalFlow`、`ApprovalSupport` | `lemon-framework` 的 `framework/workflow` |
| 状态流转（按原状态条件更新） | `StatusTransitions` | `framework/data` |
| 按数据权限读取单据 | `DataScopes` | `framework/security/datascope` |
| 明细行整体替换 | `DetailLines` | `framework/data` |
| 只取前几条 | `Queries` | `framework/data` |
| 金额、数量计算 | `Decimals` | `lemon-common` 的 `common/util` |
| 制单人 | `MybatisPlusConfig.CreateByInnerInterceptor`（自动填充） | `framework/config` |
| 业务字典校验 | `DictLookup` | `framework/dict` |
| 前端状态常量 | `@/constants/enums`（由后端枚举生成） | `lemon-web/src/constants` |
| 前端单条操作 | `useAction` | `lemon-web/src/composables` |
| 前端明细行 | `useLineItems` + `LineItemsTable` | `composables`、`components/common` |
| 前端数字显示与舍入 | `money`、`qty`、`round2`、`sumBy` 等 | `lemon-web/src/utils/number.js` |
| 前端单据表单与详情 | `useFormDrawer` + `<FormDrawer page>`、`<SubPage>` | `composables`、`components` |

## 后端

### ApprovalFlow / ApprovalSupport：接入审批

在 Service 中把流程声明为常量，提交时交给 `ApprovalSupport`：流程未发布时直接审核，已发布时先改为审批中、再发起流程并记录流程实例 ID。审批结果在 `@EventListener` 中用 `FLOW.onFinished` 处理。

```java
private static final ApprovalFlow FLOW = new ApprovalFlow("fin_loan", "fin_loan:");

@Transactional
public boolean submit(Long id) {
    FinLoan l = requireStatus(id, LoanStatus.DRAFT);
    return approvalSupport.submit(FLOW, id, Map.of("loanNo", l.getLoanNo(), "amount", l.getAmount()),
            () -> transit(id, LoanStatus.DRAFT, LoanStatus.APPROVED),       // 流程未发布：直接审核
            () -> transit(id, LoanStatus.DRAFT, LoanStatus.APPROVING),      // 发起前：改为审批中
            instanceId -> loanMapper.update(Wrappers.<FinLoan>lambdaUpdate()  // 发起后：记录流程实例 ID
                    .set(FinLoan::getFlowInstanceId, instanceId).eq(FinLoan::getId, id)));
}

@EventListener
public void onFlowFinished(FlowFinishedEvent e) {
    FLOW.onFinished(e, (id, approved) -> StatusTransitions.tryChange(loanMapper, FinLoan::getId, id, FinLoan::getStatus,
            LoanStatus.APPROVING, approved ? LoanStatus.APPROVED : LoanStatus.DRAFT));
}
```

（摘自 `FinLoanService`。）业务标识前缀上线后不能修改，已发起的流程按原前缀回调。`submit` 的变量需要查询时传 `Supplier`；创建即审批或有条件才审批的用 `isAvailable` + `start`；撤回用 `cancelIfRunning`；需要区分驳回与撤销时用 `onFinishedWithStatus`。完整说明见 [接入审批流](./approval)。

### StatusTransitions：状态流转

按原状态条件更新（`UPDATE ... SET status = 目标 WHERE id = ? AND status = 原状态`），并发操作时只有一个请求成功：

| 方法 | 说明 |
| --- | --- |
| `change(mapper, 主键列, id, 状态列, 原状态, 目标状态, 消息键, 参数...)` | 失败（状态已被他人改变）时抛出 `BizException(消息键, 参数)` |
| `change(mapper, 主键列, id, 状态列, 原状态, 目标状态, extra, 消息键, 参数...)` | 同时设置其他字段，`extra` 中追加 `set` |
| `tryChange(mapper, 主键列, id, 状态列, 原状态, 目标状态[, extra])` | 返回是否成功，不抛异常（审批结果回调、撤回中使用） |
| `changeFromAny(..., 原状态集合, 目标状态, 消息键, 参数...)` / `tryChangeFromAny(..., 原状态集合, 目标状态, extra)` | 原状态为集合中任一个 |

```java
StatusTransitions.change(contractMapper, ScmPurchaseContract::getId, id, ScmPurchaseContract::getStatus,
        ContractStatus.ACTIVE, ContractStatus.CLOSED,
        w -> w.set(ScmPurchaseContract::getCloseReason, reason).set(ScmPurchaseContract::getUpdateTime, LocalDateTime.now()),
        "scm.error.contractStatusHasChangedRefreshTry");
```

- 「主键列」一般是主键，也可以是其他唯一字段（如会计期间）；
- 用条件构造器更新时不会自动填充 `updateTime`，需要时在 `extra` 中设置；
- 不需要再在 mapper XML 中为每张单据写 `transit`。

### DataScopes：按数据权限读取单据

详情、修改、删除、审核等按 ID 操作前，必须按数据权限读取单据，防止通过构造 ID 访问其他部门的数据：

| 方法 | 说明 |
| --- | --- |
| `load(rule, loader)` | 有「全部数据」权限时直接查询，否则在规则下查询；看不到时返回 null |
| `require(rule, loader, 消息键, 参数...)` | 看不到或不存在时抛出 `BizException(消息键)` |
| `require(rule, loader, check, 消息键, 参数...)` | 还要满足 `check`（如单据种类相符），否则同样视为不存在 |

```java
private ScmPurchaseContract getAccessible(Long id) {
    return DataScopes.require(CONTRACT_RULE, () -> contractMapper.selectById(id), "scm.error.purchaseContractDoesNotExistAccess");
}
```

规则（`DataPermissionRule`）与列表方法上 `@DataPermission` 的表名、部门列、用户列一致，定义为常量。原理见 [数据权限](../architecture/data-scope)。

### DetailLines：明细行整体替换

修改单据时明细行整体替换：删除该单据原有的明细，再用 mapper XML 中的多值 `INSERT` 批量插入。在调用方的事务中执行：

```java
DetailLines.replace(itemMapper, ScmPurchaseContractItem::getContractId, id, items,
        ScmPurchaseContractItem::setContractId, itemMapper::insertBatch);
```

参数依次为：明细的 Mapper、明细表中指向单据的字段、单据 ID、新的明细、给明细设置单据 ID 的方法、批量插入方法。明细为空时只删除不插入。明细行的 ID 会变化，其他表不要引用可以整体替换的明细行 ID。

### Queries：只取前几条

由分页插件按数据库方言生成 LIMIT（不查总数），不要在 Java 中写 `.last("LIMIT 1")`：

```java
FinPeriod earlierOpen = Queries.first(periodMapper, Wrappers.<FinPeriod>lambdaQuery()
        .lt(FinPeriod::getPeriod, period).eq(FinPeriod::getStatus, PeriodStatus.OPEN).orderByAsc(FinPeriod::getPeriod));
List<ScmOrder> recent = Queries.limit(orderMapper, wrapper, 10);
```

### Decimals：金额与数量

精度约定与数据库一致：金额 2 位，数量和单价 4 位，四舍五入（HALF_UP）。

```java
BigDecimal total = Decimals.money(Decimals.sum(items, OaCarRequestItem::getAmount));   // 求和（null 视为 0）后保留 2 位
BigDecimal q = Decimals.qty(qty);                                                     // 保留 4 位
BigDecimal rate = Decimals.percent(good, total, 2);                                   // good / total × 100，total 为 0 时返回 null
if (Decimals.positive(amount)) { ... }                                                // 大于 0（null 视为 0）
BigDecimal tax = amount.multiply(taxRate).divide(Decimals.HUNDRED, Decimals.MONEY_SCALE, Decimals.ROUNDING);
```

税率、比例按百分数存储（13 表示 13%）。完整方法见 [后端开发规范](./backend#金额与数量)。

### 制单人自动填充

`MybatisPlusConfig` 注册的 `CreateByInnerInterceptor` 在插入实体时，`createBy` 为空则自动填当前登录用户（定时任务等没有登录用户时保持为空），Service 中不需要 `setCreateBy`。实体的 `createBy` 加 `@JsonProperty(access = JsonProperty.Access.READ_ONLY)`，前端传入的值不会被接收。用 mapper XML 多值 `INSERT` 插入的数据不经过实体，仍需自己赋值。

### 枚举中的状态判断

状态的组合和判断写在枚举中（如 `OrderStatus.EXECUTABLE`、`isExecutable()`、`isUnaudited()`，`LeaveStatus.ofFlow(FlowStatus)`），Service 中不写字符串比较，也不维护以字符串为键的映射表，见 [后端开发规范](./backend#枚举约定)。

## 前端

| 组件 | 用途 | 说明 |
| --- | --- | --- |
| `@/constants/enums` | 判断状态、类型 | `record.status === CarRequestStatus.DRAFT`；由 `npm run gen:enums` 从后端枚举生成，见 [状态与类型常量](./frontend#状态与类型常量) |
| `useAction(api, { confirm, successKey, reload, loading })` | 删除、提交、审核、关闭等单条操作 | 返回的函数直接写在 `@click` / `@confirm` 上，见 [单条操作](./frontend#单条操作-useaction) |
| `useLineItems(() => form.value.items, { newRow })` | 明细行的增删、行 key、合计、校验路径 | `addRow`、`removeRow`、`withKey`、`total`、`itemName` |
| `<LineItemsTable :items :columns>` | 明细行表格 | `#cell` 插槽、默认的删除列、`min-rows`、`confirm-remove`，见 [单据明细](./frontend#单据明细-uselineitems-lineitemstable) |
| `utils/number.js` | 金额、数量的显示与舍入 | `money`、`moneyOrBlank`、`price`、`qty`、`num`、`round2`、`round4`、`sumBy` |
| `<FormDrawer page>` | 单据表单（子页） | 占满内容区，返回后列表状态不变 |
| `<SubPage>` | 单据详情（子页） | 用法同 `a-drawer`，`defineExpose({ reload })` |

## 完整示例：带明细行的用车申请

在 [新增一个业务模块](./new-module) 的用车申请上增加「预计费用明细」（费用项目、金额、备注），申请上保存预计费用合计。修改草稿时明细整体替换。

### 表

```sql
ALTER TABLE oa_car_request ADD COLUMN estimated_amount DECIMAL(14, 2) NOT NULL DEFAULT 0 COMMENT '预计费用合计';

CREATE TABLE oa_car_request_item (
    id          BIGINT         NOT NULL AUTO_INCREMENT COMMENT '主键',
    tenant_id   BIGINT         NOT NULL DEFAULT 1 COMMENT '租户ID',
    request_id  BIGINT         NOT NULL COMMENT '用车申请ID',
    item_name   VARCHAR(64)    NOT NULL COMMENT '费用项目，如过路费、停车费',
    amount      DECIMAL(14, 2) NOT NULL COMMENT '金额',
    remark      VARCHAR(255)            DEFAULT NULL COMMENT '备注',
    create_time DATETIME                DEFAULT NULL COMMENT '创建时间',
    update_time DATETIME                DEFAULT NULL COMMENT '更新时间',
    PRIMARY KEY (id),
    KEY idx_car_request_item_request (request_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '用车申请费用明细';
```

新建库时把 `estimated_amount` 直接写在 `oa_car_request` 的建表语句中；`ALTER TABLE` 只用于已有环境的增量脚本。

### 实体、请求体与 Mapper

```java
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("oa_car_request_item")
public class OaCarRequestItem extends BaseEntity {

    private Long requestId;

    private String itemName;

    private BigDecimal amount;

    private String remark;
}
```

`OaCarRequest` 中增加：

```java
/** 预计费用合计（明细金额之和） */
private BigDecimal estimatedAmount;

/** 费用明细，详情时带出 */
@TableField(exist = false)
private List<OaCarRequestItem> items;
```

请求体增加明细（record 嵌套 record，`@Valid` 校验每一行）：

```java
public record CarRequestForm(
        // ... 原有字段
        @Size(max = 50, message = "{oa.valid.itemsTooMany}") List<@Valid CarRequestItemForm> items) {

    public record CarRequestItemForm(
            @NotBlank(message = "{oa.valid.itemNameRequired}") @Size(max = 64, message = "{oa.valid.itemNameTooLong}") String itemName,
            @NotNull(message = "{oa.valid.itemAmountRequired}") @DecimalMin(value = "0.01", message = "{oa.valid.itemAmountMin}") BigDecimal amount,
            @Size(max = 255, message = "{oa.valid.remarkTooLong}") String remark) {
    }
}
```

```java
public interface OaCarRequestItemMapper extends BaseMapper<OaCarRequestItem> {

    /** 批量插入，单条 INSERT ... VALUES (...), (...) */
    int insertBatch(@Param("items") List<OaCarRequestItem> items);
}
```

```xml
<mapper namespace="com.lemon.erp.modules.oa.mapper.OaCarRequestItemMapper">

    <insert id="insertBatch">
        INSERT INTO oa_car_request_item (request_id, item_name, amount, remark, create_time, update_time) VALUES
        <foreach collection="items" item="i" separator=",">
            (#{i.requestId}, #{i.itemName}, #{i.amount}, #{i.remark}, NOW(), NOW())
        </foreach>
    </insert>

</mapper>
```

开启 SaaS 时多租户拦截器会自动给多值 `INSERT` 加上 `tenant_id` 列，XML 中不写。

### Service

在 [新增一个业务模块](./new-module#_5-service) 的 `OaCarRequestService` 上修改 `detail`、`create`、`update`、`delete`：

```java
private final OaCarRequestItemMapper itemMapper;

public OaCarRequest detail(Long id) {
    OaCarRequest request = getAccessible(id);
    request.setItems(itemMapper.selectList(Wrappers.<OaCarRequestItem>lambdaQuery()
            .eq(OaCarRequestItem::getRequestId, id).orderByAsc(OaCarRequestItem::getId)));
    return request;
}

@Transactional
public Long create(CarRequestForm form) {
    validate(form);
    List<OaCarRequestItem> items = toItems(form);
    OaCarRequest request = new OaCarRequest();
    request.setRequestNo(docNoService.next(DOC_NO));
    apply(request, form, items);
    request.setStatus(CarRequestStatus.DRAFT);
    request.setDeptId(SecurityUtils.getLoginUser().deptId());
    requestMapper.insert(request);
    // 新增时没有旧明细，replace 只做批量插入
    DetailLines.replace(itemMapper, OaCarRequestItem::getRequestId, request.getId(), items,
            OaCarRequestItem::setRequestId, itemMapper::insertBatch);
    return request.getId();
}

@Transactional
public void update(Long id, CarRequestForm form) {
    OaCarRequest request = requireStatus(id, CarRequestStatus.DRAFT, "oa.label.modify");
    validate(form);
    List<OaCarRequestItem> items = toItems(form);
    apply(request, form, items);
    requestMapper.updateById(request);
    DetailLines.replace(itemMapper, OaCarRequestItem::getRequestId, id, items,
            OaCarRequestItem::setRequestId, itemMapper::insertBatch);
}

@Transactional
public void delete(Long id) {
    requireStatus(id, CarRequestStatus.DRAFT, "oa.label.delete");
    itemMapper.delete(Wrappers.<OaCarRequestItem>lambdaQuery().eq(OaCarRequestItem::getRequestId, id));
    requestMapper.deleteById(id);
}

private static List<OaCarRequestItem> toItems(CarRequestForm form) {
    if (form.items() == null) {
        return List.of();
    }
    return form.items().stream().map(r -> {
        OaCarRequestItem item = new OaCarRequestItem();
        item.setItemName(r.itemName().trim());
        item.setAmount(Decimals.money(r.amount()));
        item.setRemark(r.remark());
        return item;
    }).toList();
}

private static void apply(OaCarRequest request, CarRequestForm form, List<OaCarRequestItem> items) {
    // ... 原有字段
    request.setEstimatedAmount(Decimals.money(Decimals.sum(items, OaCarRequestItem::getAmount)));
}
```

要点：

- 单据和明细的写入在同一个 `@Transactional` 方法中，任一失败整体回滚；校验、组装明细在写入之前完成；
- 合计由后端按明细计算，不信任前端传入的合计；
- 明细行的 `createBy` 不需要赋值（明细表没有制单人列，单据上的由拦截器填充）；
- 提交审批、审批回调、撤回的写法与没有明细时相同，见 [接入审批流](./approval)。

需要新增的消息键：`oa.valid.itemsTooMany`、`oa.valid.itemNameRequired`、`oa.valid.itemNameTooLong`、`oa.valid.itemAmountRequired`、`oa.valid.itemAmountMin`，中英文都要登记。

### 前端：单据表单

有明细行的单据表单用子页，封装为 `components/oa/CarRequestForm.vue`：

```vue
<template>
  <FormDrawer page :drawer="drawer" :create-title="$t('oa.car.create')" :edit-title="$t('oa.car.edit')" width="min(1200px, 100vw)">
    <a-form ref="formRef" :model="form" :rules="rules" layout="vertical">
      <a-row :gutter="16">
        <a-col :xs="24" :sm="12" :lg="6">
          <a-form-item :label="$t('oa.car.useDate')" name="useDate">
            <a-date-picker v-model:value="form.useDate" value-format="YYYY-MM-DD" class="full" />
          </a-form-item>
        </a-col>
        <!-- 用车类型、目的地、乘车人数、事由、备注，同列表页的抽屉表单 -->
      </a-row>

      <div class="items-head">
        <span class="section-title">{{ $t('oa.car.items') }}</span>
        <a-space>
          <span>{{ $t('common.field.total') }} <b>{{ money(itemTotal) }}</b></span>
          <a-button size="small" @click="lines.addRow()">
            <template #icon><PlusOutlined /></template>{{ $t('common.action.addRow') }}
          </a-button>
        </a-space>
      </div>
      <LineItemsTable :items="form.items" :columns="itemColumns" :empty-text="$t('oa.car.noItems')">
        <template #cell="{ column, record }">
          <template v-if="column.key === 'itemName'">
            <a-form-item :name="lines.itemName(record, 'itemName')" :rules="[{ required: true, whitespace: true, message: $t('oa.car.inputItemName') }]" class="cell-item">
              <a-input v-model:value="record.itemName" :maxlength="64" />
            </a-form-item>
          </template>
          <template v-else-if="column.key === 'amount'">
            <a-form-item :name="lines.itemName(record, 'amount')" :rules="[{ required: true, message: $t('oa.car.inputAmount') }]" class="cell-item">
              <a-input-number v-model:value="record.amount" :min="0.01" :precision="2" class="full" />
            </a-form-item>
          </template>
          <template v-else-if="column.key === 'remark'">
            <a-input v-model:value="record.remark" :maxlength="255" />
          </template>
        </template>
      </LineItemsTable>
    </a-form>
  </FormDrawer>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { PlusOutlined } from '@ant-design/icons-vue'
import FormDrawer from '@/components/FormDrawer.vue'
import LineItemsTable from '@/components/common/LineItemsTable.vue'
import { addCarRequest, getCarRequest, updateCarRequest } from '@/api/oa/car'
import { useFormDrawer } from '@/composables/useFormDrawer'
import { useLineItems } from '@/composables/useLineItems'
import { money, round2 } from '@/utils/number'

/** 新增 / 编辑用车申请（草稿），含预计费用明细；保存后触发 success(id) */
const emit = defineEmits(['success'])
const { t } = useI18n()

const itemColumns = [
  { title: t('oa.car.itemName'), key: 'itemName', width: 220 },
  { title: t('common.field.amount'), key: 'amount', width: 160 },
  { title: t('common.field.remark'), key: 'remark', width: 260 },
  { title: t('common.action.operation'), key: 'action', width: 70 }   // 默认是删除按钮
]

const rules = {
  useDate: [{ required: true, message: t('common.rule.requiredSelect', { name: t('oa.car.useDate') }) }],
  destination: [{ required: true, whitespace: true, message: t('common.rule.required', { name: t('oa.car.destination') }) }]
}

const drawer = useFormDrawer({
  emptyForm: () => ({ id: undefined, useDate: undefined, carType: undefined, destination: '', purpose: '', passengers: 1, remark: '', items: [] }),
  fetch: async (record) => {
    const d = await getCarRequest(record.id)
    // 给后端返回的明细补上行 key
    return { ...d, carType: d.carType || undefined, items: (d.items || []).map(lines.withKey) }
  },
  create: async (data) => {
    const id = await addCarRequest(data)
    emit('success', id)
    return id
  },
  update: async (id, data) => {
    await updateCarRequest(id, data)
    emit('success', id)
  },
  toPayload: (f) => ({
    useDate: f.useDate,
    carType: f.carType || null,
    destination: f.destination,
    purpose: f.purpose,
    passengers: f.passengers,
    remark: f.remark,
    items: f.items.map((i) => ({ itemName: i.itemName, amount: round2(i.amount), remark: i.remark || null }))
  })
})
const { formRef, form } = drawer

// 表单对象会被整体替换，传函数取当前的明细
const lines = useLineItems(() => form.value.items, { newRow: () => ({ itemName: '', amount: undefined, remark: '' }) })
const itemTotal = lines.total('amount')

defineExpose({ openCreate: drawer.openCreate, openEdit: drawer.openEdit })
</script>

<style scoped>
.full {
  width: 100%;
}
.items-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 8px 0;
}
.cell-item {
  margin-bottom: 0;
}
</style>
```

列表页引入表单组件，新增、编辑都由它打开：

```vue
<a-button v-perm="'oa:car:add'" type="primary" @click="formRef.openCreate()">{{ $t('oa.car.create') }}</a-button>
<a-button v-if="record.status === CarRequestStatus.DRAFT" v-perm="'oa:car:edit'" type="link" size="small" @click="formRef.openEdit(record)">
  {{ $t('common.action.edit') }}
</a-button>

<CarRequestForm ref="formRef" @success="onSaved" />
<CarRequestDetail ref="detailRef" v-model:open="detailOpen" :request-id="detailId" @edit="(d) => formRef.openEdit(d)" />
```

```js
const formRef = ref()
const detailRef = ref()

function onSaved(id) {
  load()   // 刷新列表
  if (detailOpen.value && id === detailId.value) detailRef.value?.reload()   // 从详情进入编辑时，刷新详情
}
```

详情组件 `CarRequestDetail.vue` 用 `<SubPage>`，写法见 [前端开发规范](./frontend#详情-subpage)；从详情进入编辑时不要关闭详情，编辑子页叠在详情之上，保存后回到详情并刷新。详情中的明细表格只读显示，金额用 `money()`：

```js
const itemColumns = [
  { title: t('oa.car.itemName'), dataIndex: 'itemName', width: 220 },
  { title: t('common.field.amount'), dataIndex: 'amount', width: 140, align: 'right', customRender: ({ text }) => money(text) },
  { title: t('common.field.remark'), dataIndex: 'remark', ellipsis: true }
]
```

### 验证

1. 新增用车申请，添加三行费用明细，合计实时更新；删除一行，合计随之变化；
2. 保存后打开编辑，明细按原顺序带出；修改金额、删除一行后保存，数据库中的明细被整体替换、`estimated_amount` 为新合计；
3. 明细中费用项目留空、金额为 0 时，前端提示；绕过前端直接提交时，后端按校验注解返回提示；
4. 提交审批后（状态不是草稿）再修改，后端提示「用车申请当前状态不能修改」。
