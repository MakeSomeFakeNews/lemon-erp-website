---
order: 6
---

# 接入审批流

业务单据接入审批时，业务模块只依赖 `framework/workflow` 中的契约（`FlowBusiness`、`ApprovalFlow`、`ApprovalSupport`、`FlowApi`、`FlowFinishedEvent`、`FlowStatus`），不直接使用 Flowable。本页继续以用车申请为例：提交时如果发布了审批流程就进入审批，审批通过后变为「已批准」，拒绝或撤回后回到草稿；没有发布流程时提交即直接批准。

实现原理见 [工作流引擎集成](../architecture/workflow)。

## 整体步骤

1. 在本模块的 `service/<模块>FlowBusinesses` 中声明 `FlowBusiness` Bean：流程标识 + 发起时传入的流程变量；
2. 在单据的 Service 中声明 `ApprovalFlow` 常量（流程标识 + 业务标识前缀）；
3. 提交时调用 `approvalSupport.submit`：流程已发布则把单据改为「审批中」、发起流程并记录流程实例 ID；未发布则直接生效；
4. 监听 `FlowFinishedEvent`，用 `FLOW.onFinished` 取出单据 ID 和审批结果回写单据状态；
5. 撤回时 `approvalSupport.cancelIfRunning`；
6. 在 `init.sql` 中内置一个未发布的流程模型，流程标识与 `FlowBusiness` 一致；
7. 前端加「提交」「撤回」按钮和「审批记录」。

## 1. 声明 FlowBusiness

```java
package com.lemon.erp.modules.oa.service;

import com.lemon.erp.framework.workflow.FlowBusiness;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import static com.lemon.erp.framework.workflow.FlowBusiness.Variable.number;
import static com.lemon.erp.framework.workflow.FlowBusiness.Variable.text;

/**
 * 行政办公接入审批的流程及发起时传入的流程变量，与 OaCarRequestService.submit 中传入的变量保持一致
 */
@Configuration
public class OaFlowBusinesses {

    @Bean
    public FlowBusiness carRequestFlow() {
        // 业务名称和变量 label 写消息键（登记在 oa.properties / oa_en.properties），设计器和流程详情按请求语言显示
        return FlowBusiness.of(OaCarRequestService.PROCESS_KEY, "oa.label.carRequestApproval",
                number("passengers", "oa.label.passengers"),
                text("destination", "oa.label.destination"),
                text("requestNo", "oa.label.requestNo"));
    }
}
```

`FlowBusiness` 的作用：

- 流程设计器的条件分支据此提供可选变量（本例可以按「乘车人数 ≥ 10」设置分支）；
- 流程详情的「业务信息」据此显示变量的名称和值；
- 声明过的流程只能由业务单据发起，不出现在「发起申请」中。

**变量必须与发起时实际传入的一致**，否则设计器中的条件引用的变量在运行时为 null（只有「不等于」成立）。

| 变量类型（`VariableType`） | 工厂方法 | 说明 |
| --- | --- | --- |
| 数字 `NUMBER` | `Variable.number(field, label)` | 条件可用大于、小于等运算符 |
| 文本 `INPUT` | `Variable.text(field, label)` | |
| 下拉 `SELECT` | `Variable.dict(field, label, dictType, 额外取值...)` | 可选值来自字典（值为字典值）；字典之外还可能出现的固定值写在后面，如加班时假期类型为 `OVERTIME` |
| 下拉 `SELECT` | `Variable.select(field, label, 枚举值...)` | 可选值为枚举的名称，如 `select("kind", "scm.label.orderType", OrderKind.values())` |
| 下拉 `SELECT` | `Variable.select(field, label, "A", "B")` | 可选值为给定的字符串 |

传入枚举类型的变量时用 `name()`（如 `"contractType", contract.getContractType().name()`），条件分支按名称比较。

本例用到的消息键（`oa.label.carRequestApproval`、`oa.label.passengers`、`oa.label.destination`、`oa.label.requestNo`，以及下文的 `oa.label.submit`、`oa.label.withdraw`、`oa.error.carRequestStatusChanged`）要在 `oa.properties` 和 `oa_en.properties` 中登记，写法见 [新增业务模块](./new-module) 的「消息资源包」。

变量名不能使用保留字：`initiator`、`assignee`、`loopCounter`、`execution`、`task`、以 `nrOf` 或 `wf` 开头的名称。

## 2. 提交审批

```java
// OaCarRequestService 中增加
public static final String PROCESS_KEY = "oa_car";
/** 流程标识 + 业务标识前缀（业务标识 = 前缀 + 单据 ID）。已发起的流程按原前缀回调，上线后不能修改前缀 */
private static final ApprovalFlow FLOW = new ApprovalFlow(PROCESS_KEY, PROCESS_KEY + ":");

private final ApprovalSupport approvalSupport;

/**
 * 提交：发布了审批流程时进入审批，否则直接批准
 *
 * @return 是否进入审批
 */
@Transactional
public boolean submit(Long id) {
    OaCarRequest request = requireStatus(id, CarRequestStatus.DRAFT, "oa.label.submit");
    return approvalSupport.submit(FLOW, id, Map.of(
                    "passengers", request.getPassengers(),
                    "destination", request.getDestination(),
                    "requestNo", request.getRequestNo()),
            // 流程未发布：直接批准
            () -> transit(id, CarRequestStatus.DRAFT, CarRequestStatus.APPROVED),
            // 发起前：改为审批中（流程没有审批节点时会在发起过程中直接结束并回调 onFlowFinished，所以要先改状态）
            () -> transit(id, CarRequestStatus.DRAFT, CarRequestStatus.APPROVING),
            // 发起后：记录流程实例 ID
            instanceId -> requestMapper.update(Wrappers.<OaCarRequest>lambdaUpdate()
                    .set(OaCarRequest::getFlowInstanceId, instanceId).eq(OaCarRequest::getId, id)));
}
```

`transit` 是 [新增一个业务模块](./new-module#_5-service) 中用 `StatusTransitions.change` 实现的状态流转（按原状态条件更新，失败提示刷新）。

`ApprovalSupport`（`framework/workflow`，在调用方的事务中执行，单据状态与流程一起提交或回滚）：

| 方法 | 说明 |
| --- | --- |
| `boolean submit(flow, id, 变量, 直接审核, 改为审批中, 记录实例ID)` | 流程未发布时执行「直接审核」并返回 `false`；已发布时依次执行「改为审批中」→ 发起流程 → 「记录实例ID」，返回 `true` |
| `boolean submit(flow, id, Supplier<变量>, ...)` | 同上，变量需要查询时传 `Supplier`，只在发起审批时才计算 |
| `void start(flow, id, 变量, 改为审批中, 记录实例ID)` | 直接发起（调用方已确认流程已发布）：创建即审批中、或只有满足条件时才走审批的单据（如有差异的盘点、请假） |
| `boolean isAvailable(flow)` | 流程是否已发布，配合 `start` 使用 |
| `boolean cancelIfRunning(instanceId, 原因)` | 流程仍在运行时撤销（会触发结束事件，状态为 `CANCELED`），返回是否撤销了 |

`ApprovalFlow`（record）：

| 方法 | 说明 |
| --- | --- |
| `new ApprovalFlow(processKey, keyPrefix)` | 流程标识（与 `FlowBusiness` 一致）、业务标识前缀（含分隔符，如 `"oa_car:"`） |
| `businessKey(id)` | 前缀 + 单据 ID |
| `idOf(event)` | 结束事件对应的单据 ID，不是本流程的单据时返回 null |
| `onFinished(event, (id, approved) -> ...)` | 是本流程的单据时处理审批结果；驳回、撤销、终止都为 `approved = false` |
| `onFinishedWithStatus(event, (id, status) -> ...)` | 需要区分驳回（`REJECTED`）与撤销（`CANCELED`）时使用 |

`ApprovalSupport` 底层调用 `FlowApi`，一般不需要直接使用：

| 方法 | 说明 |
| --- | --- |
| `boolean isAvailable(processKey)` | 流程是否可以发起：模型存在、已启用且已发布 |
| `String start(processKey, businessKey, variables)` | 以当前登录用户的身份发起（使用最新发布的版本），返回流程实例 ID；流程不存在、未发布、已停用时抛 `BizException` |
| `void cancel(processInstanceId, reason)` | 撤销运行中的流程，状态变为 `CANCELED`；不校验是否为发起人，撤销人记为当前用户 |
| `FlowStatus getStatus(processInstanceId)` | 流程状态，实例不存在时返回 null |

- 流程实例 ID 保存到单据（`flow_instance_id`），用于撤回和查看审批记录；
- 发起流程与单据状态修改在同一事务中，任一失败整体回滚。

只有满足条件时才走审批的单据（例如盘点单有差异才审批），先用 `isAvailable` 判断流程已发布，再按条件调用 `start`（`WmsCheckService.confirm`）：

```java
if (approvalSupport.isAvailable(FLOW)) {
    // ... 读取明细，统计盘盈、盘亏数量和差异行数 diffLines
    if (diffLines > 0) {
        approvalSupport.start(FLOW, id,
                Map.of("docNo", check.getDocNo(), "gainQty", gain, "lossQty", loss, "diffLines", diffLines),
                () -> StatusTransitions.change(checkMapper, WmsCheck::getId, id, WmsCheck::getStatus,
                        DocStatus.DRAFT, DocStatus.APPROVING, "wms.error.stockCountHasConfirmedRefresh"),
                instanceId -> checkMapper.update(Wrappers.<WmsCheck>lambdaUpdate()
                        .set(WmsCheck::getFlowInstanceId, instanceId).eq(WmsCheck::getId, id)));
        return true;
    }
}
adjust(check, DocStatus.DRAFT);   // 流程未发布或没有差异：直接调整库存
return false;
```

## 3. 监听审批结果

```java
/** 审批结束：通过 → 已批准；拒绝、撤回、终止 → 草稿 */
@EventListener
public void onFlowFinished(FlowFinishedEvent e) {
    // 只处理仍在审批中的单据（已撤回、删除的忽略），不抛异常，避免回滚审批操作
    FLOW.onFinished(e, (id, approved) -> StatusTransitions.tryChange(requestMapper, OaCarRequest::getId, id,
            OaCarRequest::getStatus, CarRequestStatus.APPROVING, approved ? CarRequestStatus.APPROVED : CarRequestStatus.DRAFT));
}
```

注意：

- 所有流程结束时都会发布 `FlowFinishedEvent`，`FLOW.onFinished` 按业务标识前缀过滤，不是本流程的单据时不执行，所以 `@EventListener` 不需要写 `condition`；
- `FlowFinishedEvent` 在流程引擎的事务中**同步**发布，`@EventListener` 与审批操作在同一事务中：监听器抛异常会回滚审批（审批人会看到错误提示）。需要在审批通过时做校验（如库存是否足够）时，可以在这里抛 `BizException` 阻止通过；
- 只需在提交后处理的副作用（发消息、调用外部系统）用 `@TransactionalEventListener`；
- 监听器在**审批人**的请求中执行，当前登录用户是审批人而不是制单人，不要在这里做数据权限校验，也不要把当前用户当作制单人（审核人可以记为 `SecurityUtils.getUserIdOrNull()`）；
- `e.status()` 为 `APPROVED`、`REJECTED`、`CANCELED`（发起人撤回或管理员终止）；
- 用 `tryChange`（带原状态条件、失败不抛异常），重复事件或已由撤回处理过时不会重复修改。

需要区分驳回和撤销时（如请假被驳回与撤销显示不同状态）：

```java
// HrLeaveService：流程状态到请假状态的对应写在枚举方法 LeaveStatus.ofFlow 中
FLOW.onFinishedWithStatus(e, (id, status) ->
        finish(id, LeaveStatus.ofFlow(status), SecurityUtils.getUserIdOrNull(), null));
```

## 4. 撤回

```java
/** 撤回审批：撤销流程，单据回到草稿 */
@Transactional
public void withdraw(Long id) {
    OaCarRequest request = requireStatus(id, CarRequestStatus.APPROVING, "oa.label.withdraw");
    approvalSupport.cancelIfRunning(request.getFlowInstanceId(), "撤回用车申请"); // i18n-ignore 撤销原因存入流程记录，保持中文
    // 流程撤销事件已把单据改回草稿时，这里更新 0 行
    StatusTransitions.tryChange(requestMapper, OaCarRequest::getId, id, OaCarRequest::getStatus,
            CarRequestStatus.APPROVING, CarRequestStatus.DRAFT);
}
```

发起人也可以在「流程中心 → 我的申请」中撤回，管理员可以在「流程实例」中终止，两种情况都会触发 `FlowFinishedEvent`（`CANCELED`），由上面的监听器把单据改回草稿。

## 5. Controller

```java
/** 提交：data 为 true 表示已进入审批 */
@PostMapping("/{id}/submit")
@PreAuthorize("@ss.hasPerm('oa:car:submit')")
@OperLog(title = "用车申请-提交", type = OperType.UPDATE) // i18n-ignore
public R<Boolean> submit(@PathVariable Long id) {
    return R.ok(requestService.submit(id));
}

@PostMapping("/{id}/withdraw")
@PreAuthorize("@ss.hasPerm('oa:car:submit')")
@OperLog(title = "用车申请-撤回", type = OperType.UPDATE) // i18n-ignore
public R<Void> withdraw(@PathVariable Long id) {
    requestService.withdraw(id);
    return R.ok();
}
```

记得在菜单中登记按钮权限 `oa:car:submit` 并授权。

## 6. 内置流程模型

在「流程中心 → 流程模型」中新建流程标识为 `oa_car` 的模型、设计并发布后，提交即进入审批。为了开箱即用，可以在 `init.sql` 中内置一个**未发布**的模型（`version`、`definition_id` 为空），由管理员调整审批人后发布：

```sql
INSERT INTO wf_model (model_key, name, category, sort, status, design_json, remark, create_time, update_time) VALUES
('oa_car', '用车申请审批', 'ADMIN', 30, 1,
 '{"form": [], "flow": {"id": "start", "type": "START", "name": "发起人", "next": {"id": "leader", "type": "APPROVER", "name": "部门主管审批", "assignee": {"type": "DEPT_LEADER", "ids": [], "names": [], "level": 1}, "approveMode": "OR", "emptyAction": "TO_ADMIN", "next": {"id": "people_check", "type": "CONDITION", "name": "按乘车人数", "branches": [{"id": "people_check_yes", "name": "人数 ≥ 10", "defaultBranch": false, "conditions": [[{"field": "passengers", "operator": "GE", "value": "10"}]], "next": {"id": "gm", "type": "APPROVER", "name": "总经理审批", "assignee": {"type": "ROLE", "ids": [3], "names": ["总经理"]}, "approveMode": "OR", "emptyAction": "TO_ADMIN", "next": null}}, {"id": "people_check_else", "name": "其他情况", "defaultBranch": true, "conditions": [], "next": null}], "next": null}}}}',
 '内置流程（未发布）：部门主管 → 乘车人数 ≥ 10 时总经理。发布后用车申请「提交」改为提交审批', NOW(), NOW());
```

- `model_key` 与 `FlowBusiness.processKey`、`ApprovalFlow` 的流程标识一致；
- `category` 取字典 `wf_category`（`PURCHASE`、`SALES`、`PRODUCTION`、`ADMIN` 等）；
- 业务流程的 `form` 为空数组，条件使用业务变量；
- 设计 JSON 中的节点 ID 只能包含字母、数字、下划线且以字母开头；角色审批人的 `ids` 为 `sys_role.id`（本例 3 为总经理）；
- 开启 SaaS 时，新租户开通会复制平台的流程模型（未发布草稿），并把审批角色换成新租户中对应的角色。

## 7. 前端

```js
// api/oa/car.js
export const submitCarRequest = (id) => request.post(`/oa/car/${id}/submit`)
export const withdrawCarRequest = (id) => request.post(`/oa/car/${id}/withdraw`)
```

```vue
<a-button v-if="record.status === CarRequestStatus.DRAFT" v-perm="'oa:car:submit'" type="link" size="small" @click="submit(record)">
  {{ $t('common.action.submit') }}
</a-button>
<a-button v-if="record.status === CarRequestStatus.APPROVING" v-perm="'oa:car:submit'" type="link" size="small" @click="withdraw(record)">
  {{ $t('oa.car.withdraw') }}
</a-button>
<a-button v-if="record.flowInstanceId" type="link" size="small" @click="openFlow(record)">{{ $t('oa.car.flowRecords') }}</a-button>

<InstanceDetailDrawer v-model:open="flowOpen" :instance-id="flowInstanceId" />
```

```js
import InstanceDetailDrawer from '@/components/workflow/InstanceDetailDrawer.vue'
import { submitCarRequest, withdrawCarRequest } from '@/api/oa/car'
import { CarRequestStatus } from '@/constants/enums'
import { useAction } from '@/composables/useAction'

// 接口返回 true 表示已进入审批，false 表示流程未发布、已直接批准
const submit = useAction((r) => submitCarRequest(r.id), {
  successKey: (approving) => (approving ? t('oa.car.submittedFlow') : t('oa.car.approved')),
  reload: () => load()
})
const withdraw = useAction((r) => withdrawCarRequest(r.id), {
  confirm: (r) => t('oa.car.confirmWithdraw', { no: r.requestNo }),
  successKey: 'oa.car.withdrawn',
  reload: () => load()
})

const flowOpen = ref(false)
const flowInstanceId = ref()
function openFlow(record) {
  flowInstanceId.value = record.flowInstanceId
  flowOpen.value = true
}
```

用到的 `oa.car.withdraw`（撤回）、`oa.car.flowRecords`（审批记录）、`oa.car.submittedFlow`（已提交审批）、`oa.car.approved`（已批准）、`oa.car.confirmWithdraw`（确定撤回用车申请「{no}」？）、`oa.car.withdrawn`（已撤回）加到 `locales/zh-CN/oa.js` 和 `en-US/oa.js` 中。`useAction` 的用法见 [前端开发规范](./frontend#单条操作-useaction)。

列表 SQL 中记得查出 `flow_instance_id`。`InstanceDetailDrawer` 显示流程进度、审批记录和业务信息；流程详情只有发起人、审批人、抄送人和有 `wf:instance:list` 权限的用户可以查看。

## 已接入审批的业务

可以参考的真实实现（流程变量见各模块的 `XxxFlowBusinesses`）：

| 流程标识 | 业务 | 实现 |
| --- | --- | --- |
| `scm_purchase_order` / `scm_sales_order` | 采购 / 销售订单审核 | `ScmOrderService.approve`、`withdraw`、`onFlowFinished`（两种订单的流程标识不同、业务标识前缀相同，按 `OrderKind` 构造 `ApprovalFlow`） |
| `scm_contract` | 采购合同 | `ScmPurchaseContractService.submit`、`onFlowFinished` |
| `fin_loan` | 员工借款 | `FinLoanService.submit`、`onFlowFinished`（最简单的完整示例） |
| `hr_leave` | 请假 / 加班 | `HrLeaveService`：创建即发起（`start`）、撤销（`cancelIfRunning`）、区分驳回与撤销（`onFinishedWithStatus`） |
| `scm_requisition`、`scm_quotation`、`scm_order_change` | 请购单、销售报价、订单变更 | scm |
| `wms_check`、`wms_stock_doc` | 有差异的盘点、手工出入库与调拨确认 | wms |
| `mes_supplement`、`mes_ecn`、`qms_ncr` | 补料申请、工程变更、不合格品评审 | mes |
| `fin_voucher`、`fin_payment`、`fin_expense`、`fin_loan` | 凭证、付款单、费用报销、员工借款 | fin |
| `hr_leave`、`hr_recruit`、`hr_change`、`hr_payroll` | 请假加班、招聘需求、人事异动、工资表 | hr |
| `crm_contract` | 销售合同 | crm |
| `pm_project`、`pm_cost` | 项目立项、手工录入的项目费用 | pm |

这些流程在 `init.sql` 中都内置了未发布的模型，未发布或停用时业务单据直接生效。
