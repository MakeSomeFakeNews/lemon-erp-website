---
order: 6
---

# 工作流引擎集成

柠檬ERP 的审批流程基于 Flowable 8（BPMN 2.0），只启用流程引擎，不启用 Flowable IDM 和事件注册引擎，用户和组织架构直接使用系统自己的表。业务人员在「流程中心 → 流程模型」中用仿钉钉的设计器设计表单和流程，发布时由后端把设计器 JSON 转换为标准 BPMN 部署到引擎。

本页介绍实现原理；业务单据接入审批的开发步骤见 [接入审批流](../guide/approval)，扩展审批人类型等见 [扩展审批人类型、运算符、字段类型](../guide/workflow-extend)。

## 分层

```
framework/workflow              业务模块接入工作流的契约（不依赖流程引擎）
├── FlowApi                     发起 / 撤销流程、查询状态、判断流程是否可发起
├── FlowBusiness                业务模块声明的审批流程及其流程变量
├── FlowStatus                  RUNNING / APPROVED / REJECTED / CANCELED（字典 wf_status）
├── FlowFinishedEvent           流程结束事件（通过、拒绝、撤回、终止）
├── FlowTaskAssignedEvent       任务分配事件（待办提醒）
└── identity                    FlowIdentityProvider：用户、角色、部门链查询，由 system 模块实现

modules/workflow                Flowable 集成（只有这个模块依赖 Flowable）
├── config                      FlowableConfig（引擎定制）、WorkflowProperties
├── model                       设计器 JSON 模型：FlowDesign、FlowNode、FlowBranch、FormField、各种枚举
├── engine
│   ├── bpmn                    FlowDesignValidator 设计校验、BpmnModelConverter 节点树 → BPMN
│   ├── meta                    FlowMetaService：读取随部署保存的流程设计（按流程定义 ID 缓存）
│   ├── assignee                审批人策略 AssigneeStrategy + 分派器 flowAssignee
│   ├── expression              条件计算 flowCondition
│   └── listener                结束监听 flowEndListener、抄送 flowCcDelegate、任务分配监听
├── service                     模型发布、发起、待办 / 已办、审批、抄送、实例详情、FlowApi 实现、离职移交
└── controller / entity / mapper / dto
```

业务模块只依赖 `framework/workflow`，不直接使用 Flowable 的 API。

## 设计器 JSON

流程模型（`wf_model.design_json`）保存的是 `FlowDesign`：

```java
public record FlowDesign(List<FormField> form, FlowNode flow) { }

public record FlowNode(String id, NodeType type, String name, AssigneeConfig assignee, ApproveMode approveMode,
                       EmptyAction emptyAction, List<FlowBranch> branches, FlowNode next) { }

public record FlowBranch(String id, String name, Boolean defaultBranch, List<List<ConditionRule>> conditions,
                         FlowNode next) { }

public record AssigneeConfig(AssigneeType type, List<Long> ids, List<String> names, Integer level) { }

public record ConditionRule(String field, ConditionOperator operator, String value) { }
```

流程是一棵仿钉钉的节点树：每个节点通过 `next` 串联下一个节点；条件分支、并行分支节点的各分支放在 `branches` 中，分支内的节点同样用 `next` 串联，所有分支汇合后继续执行分支节点的 `next`。示例（`init.sql` 中内置的销售订单审批，节选）：

```json
{
  "form": [],
  "flow": {
    "id": "start", "type": "START", "name": "发起人",
    "next": {
      "id": "leader", "type": "APPROVER", "name": "销售主管审批",
      "assignee": { "type": "DEPT_LEADER", "ids": [], "names": [], "level": 1 },
      "approveMode": "OR", "emptyAction": "TO_ADMIN",
      "next": {
        "id": "amount_check", "type": "CONDITION", "name": "按订单金额",
        "branches": [
          { "id": "amount_check_yes", "name": "金额 ≥ 20 万元", "defaultBranch": false,
            "conditions": [[{ "field": "amount", "operator": "GE", "value": "200000" }]],
            "next": { "id": "gm", "type": "APPROVER", "name": "总经理审批",
                      "assignee": { "type": "ROLE", "ids": [3], "names": ["总经理"] },
                      "approveMode": "OR", "emptyAction": "TO_ADMIN", "next": null } },
          { "id": "amount_check_else", "name": "其他情况", "defaultBranch": true, "conditions": [], "next": null }
        ],
        "next": { "id": "cc_wh", "type": "CC", "name": "抄送仓库管理员",
                  "assignee": { "type": "ROLE", "ids": [6], "names": ["仓库管理员"] }, "next": null }
      }
    }
  }
}
```

| 枚举 | 取值 |
| --- | --- |
| `NodeType` 节点类型 | `START` 发起人（根节点）、`APPROVER` 审批人、`CC` 抄送人、`CONDITION` 条件分支、`PARALLEL` 并行分支 |
| `AssigneeType` 审批人类型 | `USER` 指定成员、`ROLE` 指定角色、`DEPT_LEADER` 部门主管（`level` 级别）、`INITIATOR` 发起人自己 |
| `ApproveMode` 多人审批方式 | `SEQUENTIAL` 依次审批、`AND` 会签（全部同意）、`OR` 或签（一人同意） |
| `EmptyAction` 审批人为空 | `AUTO_PASS` 自动通过、`TO_ADMIN` 转交超级管理员 |
| `ConditionOperator` 条件运算符 | `EQ`、`NE`、`GT`、`GE`、`LT`、`LE`、`IN`（逗号分隔多个值）、`CONTAINS` |
| `FormFieldType` 表单字段类型 | `INPUT`、`TEXTAREA`、`NUMBER`、`DATE`、`SELECT` |

## 发布：设计器 JSON → BPMN

「发布」时 `WfModelService.deploy`：

1. `FlowDesignValidator` 校验设计：根节点必须是发起人且只有一个、至少有一个审批人节点、审批人和抄送人配置完整、部门主管级别为 1~10、条件分支和并行分支至少两个分支、条件分支必须有且只有一个默认分支并放在最后、表单字段标识合法且不是保留字等；
2. `BpmnModelConverter.convert` 把节点树转换为 `BpmnModel`；
3. 创建部署：`tenantId` 为当前租户，包含 `{modelKey}.bpmn20.xml` 和 `flow-design.json`（设计器 JSON）两个资源；
4. 把新版本号、流程定义 ID 回写到 `wf_model`。

每次发布生成一个新版本，已发起的流程继续按原版本运行。

**BPMN 只描述流转结构**，审批人、分支条件等运行时配置不写进 BPMN，而是由表达式 Bean 按节点 ID 从同一部署的 `flow-design.json` 中读取（`FlowMetaService`，按流程定义 ID 缓存）。因此每个流程定义版本都自带对应的设计，详情页按发起时的版本展示表单和进度。

转换规则：

| 设计器节点 | BPMN 元素 |
| --- | --- |
| 发起人 | 开始事件，`initiator` 属性写入流程变量 `initiator`（发起人用户 ID） |
| 审批人 | 多实例用户任务：集合表达式 `${flowAssignee.resolve(execution)}`，元素变量 `assignee`，任务的办理人 `${assignee}`；依次审批为串行多实例，会签 / 或签为并行多实例。其后接一个排他网关：`${wfRejected}` 流向「审批拒绝」终止结束事件，`${!wfRejected}` 继续 |
| 抄送人 | 服务任务，委托表达式 `${flowCcDelegate}` 记录抄送 |
| 条件分支 | 一对排他网关（分叉 + 汇合 `__join`）；分支连线的条件为 `${flowCondition.evaluate(execution, '分支ID')}`，默认分支设为网关的默认流向 |
| 并行分支 | 一对并行网关（分叉 + 汇合） |
| 流程结束 | 「审批通过」结束事件 `end__approved`；有审批节点时另有「审批拒绝」终止结束事件 `end__rejected`（`terminateAll`，同时结束其他并行分支）；两个结束事件都挂执行监听器 `${flowEndListener}` |

自动生成的元素 ID 都包含双下划线（如 `leader__result`、`flow__3`），与设计器节点 ID 不会冲突。

多实例的完成条件：

- 依次审批、会签：`${wfRejected}`（有人拒绝立即结束，否则全部完成）；
- 或签：`${wfRejected || nrOfCompletedInstances >= 1}`（一人同意即结束）。

任一审批人拒绝时，设置流程变量 `wfRejected = true`，多实例立即结束，经结果网关流向终止结束事件，整个流程（包括其他并行分支）结束，状态为「已拒绝」。

## 审批人：flowAssignee

`FlowAssigneeResolver`（Bean 名 `flowAssignee`）在进入审批节点时计算审批人：

1. 按当前节点 ID 从流程设计中取出节点配置；
2. 按 `AssigneeType` 分派给对应的 `AssigneeStrategy` 实现（启动时收集全部策略 Bean，同一类型有多个实现时启动失败）；
3. 通过 `FlowIdentityProvider.listEnabledUserIds` 过滤掉停用的用户；
4. 结果为空且节点配置为「转交超级管理员」时，取拥有 `admin` 角色的用户；配置为「自动通过」时返回空集合，多实例不产生任务，直接通过。

内置的四种策略：

| 策略 | 类型 | 规则 |
| --- | --- | --- |
| `UserAssigneeStrategy` | `USER` | 设计时选择的成员，按选择顺序（依次审批的顺序） |
| `RoleAssigneeStrategy` | `ROLE` | 拥有任一角色的启用用户 |
| `DeptLeaderAssigneeStrategy` | `DEPT_LEADER` | 从发起人所在部门向上数到第 `level` 级部门（所在部门为第 1 级），取该部门负责人；没有负责人或负责人就是发起人时继续向上查找 |
| `InitiatorAssigneeStrategy` | `INITIATOR` | 发起人自己 |

部门负责人在「系统管理 → 部门管理」中设置（`sys_dept.leader_user_id`）。

## 条件：flowCondition

`FlowConditionEvaluator`（Bean 名 `flowCondition`）计算分支条件：条件组之间为「或」，组内规则为「且」，每条规则用流程变量 `field` 的值与设计时填写的 `value` 按 `ConditionOperator` 比较。

- 两边都能转为数字时按数值比较，否则按字符串比较（`yyyy-MM-dd` 格式的日期按字符串比较即可）；
- 变量为 null（未填写）时只有 `NE` 成立；
- **条件在 Java 中计算，不拼接 UEL 表达式**，避免表达式注入。

条件中可以引用的变量：流程表单字段（「发起申请」中直接发起的流程），或业务模块在 `FlowBusiness` 中声明、发起时通过 `flowApi.start` 传入的变量。

## 流程变量

| 变量 | 说明 |
| --- | --- |
| 表单字段 | 「发起申请」时按 `FormFieldType` 校验并转换后保存为同名变量（数字整数存为 Long、小数存为 Double） |
| 业务变量 | `flowApi.start` 传入的 `variables` |
| `initiator` | 发起人用户 ID（字符串） |
| `assignee` | 多实例审批任务的当前审批人 |
| `wfRejected` | 是否已被拒绝 |
| `wfAction` | 任务局部变量，处理结果，已办列表一次查询即可带出 |

保留变量名：`initiator`、`assignee`、`loopCounter`、`execution`、`task`、以 `nrOf` 或 `wf` 开头的名称。表单字段和业务变量不能使用，`flowApi.start` 传入保留变量名时报错。

## 状态与审批记录

- 流程状态保存在流程实例的 `businessStatus` 上（`FlowStatus`），列表按状态筛选直接走引擎查询。
- 审批意见使用 Flowable 的 Comment，类型为 `ApprovalAction`（`APPROVE`、`REJECT`、`TRANSFER`、`CANCEL`、`TERMINATE` 等，字典 `wf_task_action`）。
- 发起人可以在审批中撤回（状态 `CANCELED`），有 `wf:instance:cancel` 权限的管理员可以终止。
- 会签等多人同时审批同一流程时，引擎以乐观锁检测冲突。审批接口（同意、拒绝）在 Controller 上声明 `@Retryable(includes = FlowableOptimisticLockingException.class, maxRetries = 2, delay = 50)`：Controller 不在事务中，每次重试时审批在新事务中整体重做（重试必须在事务之外）。

## 事件

| 事件 | 发布时机 | 用途 |
| --- | --- | --- |
| `FlowFinishedEvent(processInstanceId, processKey, businessKey, status, startUserId)` | 流程结束（通过、拒绝、撤回、终止），在流程引擎的事务中同步发布 | 业务模块回写单据状态。`@EventListener` 与审批操作同一事务，监听器抛异常会回滚审批；只需在提交后处理（发通知等）时用 `@TransactionalEventListener` |
| `FlowTaskAssignedEvent(taskId, taskName, processInstanceId, processKey, processName, assigneeId)` | 审批任务分配给某个用户（新任务或转交） | 待办提醒，`WfNotifyService` 已发送站内消息；建议用 `@TransactionalEventListener` |

`FlowTaskAssignedEvent` 由 `FlowableConfig` 注册的引擎事件监听器（`TASK_ASSIGNED`）发布。

## 多租户

流程定义按租户部署（`tenantId` 为租户 ID 字符串），同一流程标识在各租户独立编号版本；流程实例和任务继承流程定义的租户，查询时都带租户条件。新租户开通时，`WfTenantInitializer` 把平台的流程模型复制为未发布的草稿，并把审批角色换成新租户中对应的角色。

## 权限标识

| 菜单 | 权限 |
| --- | --- |
| 发起申请 | `wf:start:list` |
| 我的待办（同意、拒绝、转交） | `wf:task:todo` |
| 我的已办 | `wf:task:done` |
| 我的申请（撤回只能由发起人操作） | `wf:instance:mine` |
| 抄送我的 | `wf:copy:list` |
| 流程模型 | `wf:model:list`、`wf:model:add`、`wf:model:edit`（含设计）、`wf:model:deploy`、`wf:model:remove` |
| 流程实例（可查看全部流程详情） | `wf:instance:list`、`wf:instance:cancel`（终止） |

流程详情只有发起人、审批人（含转交过的）、抄送人和有 `wf:instance:list` 权限的用户可以查看；任务只能由当前审批人处理。

## 数据库

Flowable 的 `ACT_*` 表由引擎在启动时自动创建、升级（`flowable.database-schema-update: true`），不放在 `init.sql` 中。MySQL 的连接串需要带 `nullCatalogMeansCurrent=true`，否则引擎可能读取到同一实例中其他库的表结构，见 [常见问题](../deploy/faq)。
