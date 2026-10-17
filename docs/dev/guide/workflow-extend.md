---
order: 6
---

# 扩展审批人类型、运算符、字段类型

流程设计器的审批人类型、条件运算符、表单字段类型、节点类型都是前后端共同约定的取值：后端是 `modules/workflow/model` 中的枚举，前端是 `components/workflow` 中的常量。**扩展时后端枚举和前端常量必须同步修改**，否则设计器保存的值后端无法识别（或反过来）。前端常量的显示名称用 `t('workflow.xxx')`，新增的取值要同时在 `locales/zh-CN/workflow.js` 和 `locales/en-US/workflow.js` 中加译文；后端枚举中的中文名称只用于内部、不返回前端（行内 `// i18n-ignore`），后端返回给前端的校验提示用消息键，见 [国际化](./i18n)。

| 扩展点 | 后端 | 前端 |
| --- | --- | --- |
| 审批人类型 | `AssigneeType` 加枚举值 + 实现 `AssigneeStrategy` Bean；需要校验时修改 `FlowDesignValidator` | `designer/flow.js` 的 `ASSIGNEE_TYPES`、`assigneeText`；`NodeConfigDrawer.vue` 的配置控件 |
| 条件运算符 | `ConditionOperator` 加枚举值 | `designer/flow.js` 的 `OPERATORS`、`TYPE_OPERATORS`；`ConditionEditor.vue` 的输入控件（按需） |
| 表单字段类型 | `FormFieldType` 加枚举值（实现校验与转换） | `form/form.js` 的 `FIELD_TYPES`；`FormRender.vue` 加控件；`FormView.vue` 的显示（按需）；`designer/flow.js` 的 `TYPE_OPERATORS` |
| 待办提醒 | 监听 `FlowTaskAssignedEvent`（`WfNotifyService` 已发送站内消息） | - |
| 节点类型 | `NodeType` 加枚举值，在 `BpmnModelConverter` 中转换、在 `FlowDesignValidator` 中校验 | 设计器增加节点 |

## 新增审批人类型

示例：新增「连续多级主管」——从发起人的直属主管开始，向上连续到第 N 级主管，依次审批（钉钉中常见的审批人类型）。

### 1. 枚举

```java
@Getter
@AllArgsConstructor
public enum AssigneeType {

    USER("指定成员", true),  // i18n-ignore 未输出给前端，前端常量 ASSIGNEE_TYPES 翻译
    ROLE("指定角色", true),  // i18n-ignore
    DEPT_LEADER("部门主管", false),  // i18n-ignore
    INITIATOR("发起人自己", false),  // i18n-ignore
    /** 从直属主管向上连续 level 级的部门主管 */
    DEPT_LEADER_CHAIN("连续多级主管", false);  // i18n-ignore

    private final String label;

    /** 是否需要在 ids 中指定具体对象 */
    private final boolean requiresIds;
}
```

### 2. 策略实现

实现 `AssigneeStrategy` 并注册为 Spring Bean，`FlowAssigneeResolver`（`flowAssignee`）启动时自动收集，同一类型有多个实现时启动失败：

```java
package com.lemon.erp.modules.workflow.engine.assignee;

import com.lemon.erp.framework.workflow.identity.FlowDept;
import com.lemon.erp.framework.workflow.identity.FlowIdentityProvider;
import com.lemon.erp.modules.workflow.model.AssigneeType;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Objects;

/**
 * 连续多级主管：发起人所在部门起向上 level 级部门的负责人，由近到远依次审批；
 * 没有负责人或负责人是发起人自己的部门跳过，同一人只审批一次
 */
@Component
@RequiredArgsConstructor
public class DeptLeaderChainAssigneeStrategy implements AssigneeStrategy {

    private final FlowIdentityProvider identityProvider;

    @Override
    public AssigneeType type() {
        return AssigneeType.DEPT_LEADER_CHAIN;
    }

    @Override
    public List<Long> resolve(AssigneeContext context) {
        Long initiatorId = context.initiatorId();
        if (initiatorId == null) {
            return List.of();
        }
        return identityProvider.listDeptChain(initiatorId).stream()
                .limit(context.config().levelOrDefault())
                .map(FlowDept::leaderUserId)
                .filter(Objects::nonNull)
                .filter(leader -> !leader.equals(initiatorId))
                .distinct()
                .toList();
    }
}
```

策略可用的信息在 `AssigneeContext` 中：节点的 `AssigneeConfig`（`type`、`ids`、`names`、`level`）和发起人 ID。返回的候选用户可以包含停用的用户（由调用方统一过滤），**顺序即依次审批的顺序**。查询用户、角色、部门通过 `FlowIdentityProvider`，不要在 workflow 模块中直接访问系统模块的表；需要新的查询时在 `FlowIdentityProvider` 中加方法，由 system 模块的 `SysFlowIdentityProvider` 实现。

需要流程变量（如业务单据传入的项目经理 ID）的审批人类型，需要扩展 `AssigneeContext`，在 `FlowAssigneeResolver.resolveUsers` 中从 `DelegateExecution` 读取变量后传入。

### 3. 设计校验

`FlowDesignValidator.validateAssignee` 中，主管级别的范围校验目前只针对 `DEPT_LEADER`，新类型同样使用 `level`，一并校验：

```java
if ((assignee.type() == AssigneeType.DEPT_LEADER || assignee.type() == AssigneeType.DEPT_LEADER_CHAIN)
        && (assignee.levelOrDefault() < 1 || assignee.levelOrDefault() > AssigneeConfig.MAX_LEVEL)) {
    throw new BizException("workflow.error.supervisorLevelMust", name(node), AssigneeConfig.MAX_LEVEL);
}
```

### 4. 前端

`components/workflow/designer/flow.js`：

```js
/** 审批人类型；requiresIds：需要选择具体成员 / 角色；single：只会得到一个人，不需要多人审批方式 */
export const ASSIGNEE_TYPES = [
  { label: t('workflow.assignee.user'), value: 'USER', requiresIds: true },
  { label: t('workflow.assignee.role'), value: 'ROLE', requiresIds: true },
  { label: t('workflow.assignee.deptLeader'), value: 'DEPT_LEADER', single: true },
  { label: t('workflow.assignee.initiator'), value: 'INITIATOR', single: true },
  { label: t('workflow.assignee.leaderChain'), value: 'DEPT_LEADER_CHAIN' }
]

export function assigneeText(node) {
  const a = node.assignee
  if (!a) return ''
  if (a.type === 'INITIATOR') return t('workflow.assignee.initiator')
  if (a.type === 'DEPT_LEADER') return (a.level || 1) === 1 ? t('workflow.leader.direct') : t('workflow.leader.level', { n: a.level })
  if (a.type === 'DEPT_LEADER_CHAIN') return t('workflow.leader.chain', { n: a.level || 1 })
  // ...
}
```

`designer/NodeConfigDrawer.vue` 中，主管级别的选择框和 `onTypeChange` 中的默认级别目前只针对 `DEPT_LEADER`，改为同时适用于新类型（例如 `['DEPT_LEADER', 'DEPT_LEADER_CHAIN'].includes(draft.assignee.type)`）。新类型会得到多个审批人，不设置 `single`，设计器会显示「多人审批方式」，连续多级主管一般选「依次审批」。

## 新增条件运算符

示例：新增「不属于」`NOT_IN`。

后端 `ConditionOperator`：

```java
public enum ConditionOperator {

    EQ((a, e) -> compare(a, e) == 0),
    NE((a, e) -> compare(a, e) != 0),
    GT((a, e) -> compare(a, e) > 0),
    GE((a, e) -> compare(a, e) >= 0),
    LT((a, e) -> compare(a, e) < 0),
    LE((a, e) -> compare(a, e) <= 0),
    IN((a, e) -> Arrays.stream(e.split("[,，]")).map(String::trim).anyMatch(v -> compare(a, v) == 0)),
    /** 不属于其中任何一个，多个值用逗号分隔 */
    NOT_IN((a, e) -> Arrays.stream(e.split("[,，]")).map(String::trim).noneMatch(v -> compare(a, v) == 0)),
    CONTAINS((a, e) -> a.toString().contains(e));
    // ...
}
```

两边都能转为数字时按数值比较，否则按字符串比较。注意 `test` 方法对 null 的统一处理：流程变量为 null（未填写）时只有 `NE` 成立，其他运算符（包括新增的）都为 false；新运算符对 null 有不同语义时在 `test` 中处理。条件在 Java 中计算，不拼接表达式，新增运算符不会引入表达式注入。

前端 `designer/flow.js`：

```js
export const OPERATORS = [
  { label: '等于', value: 'EQ' },
  // ...
  { label: '属于', value: 'IN' },
  { label: '不属于', value: 'NOT_IN' },
  { label: '包含', value: 'CONTAINS' }
]

/** 各字段类型可用的比较方式 */
const TYPE_OPERATORS = {
  NUMBER: ['EQ', 'NE', 'GT', 'GE', 'LT', 'LE', 'IN', 'NOT_IN'],
  DATE: ['EQ', 'NE', 'GT', 'GE', 'LT', 'LE'],
  SELECT: ['EQ', 'NE', 'IN', 'NOT_IN'],
  INPUT: ['EQ', 'NE', 'CONTAINS', 'IN', 'NOT_IN'],
  TEXTAREA: ['EQ', 'NE', 'CONTAINS']
}
```

`ConditionEditor.vue` 中，下拉字段在运算符为 `IN` 时改为输入框、占位提示「多个值用逗号分隔」，`NOT_IN` 需要同样处理（把 `rule.operator !== 'IN'`、`rule.operator === 'IN'` 的判断扩展到 `NOT_IN`）。

## 新增表单字段类型

示例：新增「金额」`AMOUNT`：非负数，保留两位小数。

后端 `FormFieldType`（负责把前端提交的值校验并转换为流程变量）：

```java
/** 金额：非负，最多两位小数，保存为 Double */
AMOUNT {
    @Override
    Object convert(FormField field, Object raw) {
        BigDecimal number;
        try {
            number = new BigDecimal(raw.toString().trim());
        } catch (NumberFormatException e) {
            throw invalid(field, Messages.get("workflow.text.mustNumber"));
        }
        if (number.signum() < 0 || number.compareTo(MAX_NUMBER) > 0) {
            throw invalid(field, Messages.get("workflow.text.outRange"));
        }
        if (number.stripTrailingZeros().scale() > 2) {
            throw invalid(field, Messages.get("workflow.text.atMostTwoDecimals"));
        }
        return number.doubleValue();
    }
},
```

`invalid(field, 原因)` 抛出 `BizException("workflow.error.fieldInvalid", 字段名, 原因)`（「「{0}」{1}」），原因用 `Messages.get` 按请求语言取，新增的 `workflow.text.atMostTwoDecimals` 要登记在 `workflow.properties` 和 `workflow_en.properties` 中。`parse` 方法已统一处理必填校验（未填写时必填报错、非必填返回 null）和类型检查（只接受字符串和数字），`convert` 只需处理有值的情况。流程变量的类型要能被条件比较：数字保存为 Long / Double，文本、日期保存为字符串。

前端：

```js
// components/workflow/form/form.js
export const FIELD_TYPES = [
  { label: t('workflow.fieldType.input'), value: 'INPUT' },
  { label: t('workflow.fieldType.textarea'), value: 'TEXTAREA' },
  { label: t('workflow.fieldType.number'), value: 'NUMBER' },
  { label: t('workflow.fieldType.amount'), value: 'AMOUNT' },
  { label: t('workflow.fieldType.date'), value: 'DATE' },
  { label: t('workflow.fieldType.select'), value: 'SELECT' }
]
```

```vue
<!-- components/workflow/form/FormRender.vue：在 NUMBER 之后加一个分支 -->
<a-input-number
  v-else-if="f.type === 'AMOUNT'"
  v-model:value="model[f.field]"
  :min="0"
  :precision="2"
  :placeholder="f.placeholder || $t('workflow.form.inputAmount')"
  class="full"
/>
```

再在 `designer/flow.js` 的 `TYPE_OPERATORS` 中加 `AMOUNT: ['EQ', 'NE', 'GT', 'GE', 'LT', 'LE']`，条件分支才能为金额字段提供比较方式；需要特殊显示（如千分位）时修改 `FormView.vue`。

业务模块 `FlowBusiness.Variable` 的 `type` 与表单字段类型一致（`NUMBER`、`SELECT`、`INPUT`），设计器按同样的规则为业务变量提供运算符。

## 待办提醒

审批任务分配给某个用户（新任务或转交）时发布 `FlowTaskAssignedEvent`，`WfNotifyService` 已经监听并发送站内消息。需要额外的通知渠道（邮件、企业微信、短信等）时，新增一个监听器，在事务提交后发送：

```java
@Component
@RequiredArgsConstructor
public class WfMailNotifier {

    @TransactionalEventListener
    public void onTaskAssigned(FlowTaskAssignedEvent e) {
        // e.assigneeId() 审批人、e.processName() 流程标题（如「张三的采购订单审核」）、e.taskName() 节点名称
        // 调用外部通知服务，失败不影响审批
    }
}
```

## 新增节点类型

节点类型的扩展涉及 BPMN 结构，改动较大，步骤为：

1. `NodeType` 加枚举值，`FlowNode` 中需要新的配置时增加字段（同时更新设计器 JSON 的约定）；
2. `BpmnModelConverter.Builder.append` 的 `switch` 中增加分支，把节点转换为 BPMN 元素（用户任务、服务任务、网关等）；需要运行时配置的，像审批人、条件一样由表达式 Bean 按节点 ID 从 `FlowMetaService` 读取，不要把配置写进 BPMN；自动生成的元素 ID 使用双下划线后缀，避免与设计器节点 ID 冲突；
3. `FlowDesignValidator` 中校验新节点的配置；
4. 前端设计器（`designer/flow.js` 的节点创建、校验、文案，`AddNodeButton.vue`、`FlowNodeChain.vue`、`NodeConfigDrawer.vue`）增加节点；
5. 流程详情的进度展示（`WfInstanceDetailService`）按需处理新节点。

已发布的流程定义各自带有发布时的设计 JSON，修改转换规则只影响之后发布的版本。

## 验证

扩展后在「流程中心 → 流程模型」中新建一个测试模型：设计、保存、发布，再从「发起申请」或业务单据发起，检查审批人、条件分支走向、流程详情的显示是否正确。前后端取值不一致时，保存设计会报「请求参数格式不正确」（后端无法反序列化未知的枚举值）。
