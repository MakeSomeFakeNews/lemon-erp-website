---
order: 12
---

# 新增业务参数

业务参数是各模块按租户配置的业务控制规则，例如采购入库允许超收的比例、客户信用额度的控制方式。它们在「系统管理 → 业务参数」中按模块分页签显示，每个企业（租户）可以有不同的设置，修改后立即生效。新增业务控制时应登记为业务参数，而不是写死在代码里。

## 与参数设置的区别

| | 参数设置（系统参数） | 业务参数 |
| --- | --- | --- |
| 页面 | 系统管理 → 参数设置 | 系统管理 → 业务参数 |
| 适用范围 | 平台级，所有租户共用（平台专属功能） | 按租户，各租户各自设置 |
| 内容 | 系统名称、登录与会话、密码策略、附件大小等技术性参数 | 各业务模块的控制规则 |
| 定义 | `framework/setting/Setting` 枚举 | 各模块的 `BizRuleProvider` Bean |
| 读取 | `SettingService` | `BizRules` |
| 存储 / 缓存 | `sys_config`，`settings:all` | `sys_biz_rule`（带 `tenant_id`），`bizrule:{租户ID}` |
| 权限 | `sys:config:*` | `sys:bizRule:list`（查看）、`sys:bizRule:edit`（修改） |

系统参数见 [配置说明](../start/config#系统参数与配置文件的关系)。

## 结构

| 类 | 位置 | 说明 |
| --- | --- | --- |
| `BizRule` | `framework/rule` | 参数定义（record）：标识、所属模块（页签）、名称、类型、默认值、下拉选项枚举、数字范围、说明 |
| `BizRuleProvider` | `framework/rule` | 业务模块实现这个接口（声明为 Bean），返回本模块的参数定义 |
| `BizRules` | `framework/rule` | 业务代码读取当前租户的参数值 |
| `SysBizRuleService` | system 模块 | 实现 `BizRules`：汇总所有 `BizRuleProvider` 的定义，只保存修改过的值，按租户缓存 |

业务模块只依赖 `lemon-framework` 中的接口，实现在 system 模块中，因此任何业务模块都可以登记和读取业务参数，不会形成反向依赖。

读取流程：`BizRules.get(key)` 先找到参数定义（未登记的标识抛出 `BizException`「业务参数不存在」），再读取当前租户修改过的值（缓存 `bizrule:{租户ID}`，12 小时；没有租户上下文时按平台租户），没有修改过时返回定义中的默认值。

保存流程：页面只提交修改过的参数（`PUT /system/biz-rule`，`{ 参数标识: 值 }`），后端按类型校验，值为空或等于默认值时删除这一行（恢复默认），否则插入或更新；保存后删除当前租户的缓存，下一次读取即为新值。

## 已有的业务参数

| 标识 | 模块 | 名称 | 类型 | 默认值 | 使用位置 |
| --- | --- | --- | --- | --- | --- |
| `scm.purchaseIn.overRate` | 供应链 | 采购入库超收比例（%） | 数字 0~100 | 0 | `ScmTradeDocService`：采购入库时订单明细的已入库数量按比例放宽（`addDone` 的 `overRate`） |
| `scm.salesOut.overRate` | 供应链 | 销售出库超发比例（%） | 数字 0~100 | 0 | 同上，销售出库 |
| `scm.credit.control` | 供应链 | 客户信用额度控制 | 下拉（`CreditControl`） | `ALL` 审核和出库时控制 | `ScmOrderService`：`ALL` 时审核销售订单和出库都校验，`SHIPMENT` 只在出库时校验，`NONE` 不校验 |
| `fin.voucher.selfAudit` | 财务 | 允许审核自己制单的凭证 | 是否 | false | `FinVoucherService`：关闭时制单人不能审核自己的凭证（超级管理员除外） |

定义分别在 `ScmBizRules`、`FinBizRules` 中，标识常量也定义在这两个类里。

## 新增一个业务参数

以 [新增一个业务模块](./new-module) 中的用车申请为例，增加两个参数：「用车最多提前预约天数」（数字）和「用车申请的审批方式」（下拉）。

### 1. 下拉选项的枚举

下拉类参数的取值用枚举表示，实现 `framework/setting/OptionEnum`，按枚举名称保存；`label()` 返回显示名称的**消息键**，页面上按请求语言显示：

```java
package com.lemon.erp.modules.oa.model;

import com.lemon.erp.framework.setting.OptionEnum;

/**
 * 用车申请的审批方式（业务参数 oa.car.approval）
 */
public enum CarApprovalMode implements OptionEnum {
    /** 提交后走审批流程 */
    FLOW("oa.enum.CarApprovalMode.flow"),
    /** 提交即通过 */
    AUTO("oa.enum.CarApprovalMode.auto");

    private final String label;

    CarApprovalMode(String label) {
        this.label = label;
    }

    @Override
    public String label() {
        return label;
    }
}
```

### 2. 登记参数：BizRuleProvider

在本模块的 `service` 包中新建 `OaBizRules`，把标识定义为常量，业务代码引用常量而不是写字符串：

```java
package com.lemon.erp.modules.oa.service;

import com.lemon.erp.framework.rule.BizRule;
import com.lemon.erp.framework.rule.BizRuleProvider;
import com.lemon.erp.modules.oa.model.CarApprovalMode;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 行政办公的业务参数
 */
@Component
public class OaBizRules implements BizRuleProvider {

    /** 模块、名称、说明都是消息键，登记在 oa.properties / oa_en.properties */
    private static final String MODULE = "oa.label.oa";

    /** 用车最多提前预约的天数 */
    public static final String CAR_MAX_ADVANCE_DAYS = "oa.car.maxAdvanceDays";
    /** 用车申请的审批方式 */
    public static final String CAR_APPROVAL = "oa.car.approval";

    @Override
    public List<BizRule> rules() {
        return List.of(
                BizRule.number(CAR_MAX_ADVANCE_DAYS, MODULE, "oa.label.carMaxAdvanceDays", 30, 1, 365,
                        "oa.label.carMaxAdvanceDaysRemark"),
                BizRule.select(CAR_APPROVAL, MODULE, "oa.label.carApprovalMode", CarApprovalMode.FLOW, CarApprovalMode.class,
                        "oa.label.carApprovalModeRemark"));
    }
}
```

```properties
# oa.properties（oa_en.properties 中登记同样的键）
oa.label.oa=行政办公
oa.label.carMaxAdvanceDays=用车最多提前预约天数
oa.label.carMaxAdvanceDaysRemark=用车日期最多可以选择今天之后多少天
oa.label.carApprovalMode=用车申请审批方式
oa.label.carApprovalModeRemark=选择「提交即通过」时不发起审批流程
oa.enum.CarApprovalMode.flow=走审批流程
oa.enum.CarApprovalMode.auto=提交即通过
oa.error.carUseDateTooFar=用车日期最多只能提前 {0} 天预约
```

`BizRule` 的工厂方法：

| 方法 | 类型 | 页面控件 | 说明 |
| --- | --- | --- | --- |
| `BizRule.bool(key, module, label, 默认值, 说明)` | `BOOL` | 开关 | 值为 `true` / `false` |
| `BizRule.number(key, module, label, 默认值, 最小值, 最大值, 说明)` | `NUMBER` | 整数输入框 | 只支持整数，保存时校验范围 |
| `BizRule.select(key, module, label, 默认枚举值, 枚举类, 说明)` | `SELECT` | 单选按钮组 | 值为枚举名称，保存时校验必须是枚举中的值 |

- `key`：全局唯一，建议「模块.对象.属性」，最长 64 个字符（`sys_biz_rule.rule_key`）；
- `module`、`label`、`remark` 和选项枚举的 `label()` 都是消息键（登记在声明模块的资源包中），「业务参数」页面按请求语言显示，见 [国际化](./i18n)；
- `module`：页面上的页签名称，同一模块的参数写同一个键；页签和参数按登记顺序显示；
- `remark`：显示在参数下方，页面会在后面加上「默认：xxx」；
- 不支持文本类型（`SettingType.TEXT`），值最长 255 个字符。

Bean 注册后不需要任何其他配置，重启后参数就出现在「业务参数」页面中。

### 3. 在业务代码中读取

注入 `BizRules`，按类型读取：

```java
@Service
@RequiredArgsConstructor
public class OaCarRequestService {

    private final BizRules bizRules;

    @Transactional
    public Long create(CarRequestForm form) {
        int maxDays = bizRules.number(OaBizRules.CAR_MAX_ADVANCE_DAYS);
        if (form.useDate().isAfter(LocalDate.now().plusDays(maxDays))) {
            throw new BizException("oa.error.carUseDateTooFar", maxDays);
        }
        ...
    }

    /** 提交：流程未发布或设置为「提交即通过」时直接生效（提交审批见「接入审批流」） */
    @Transactional
    public boolean submit(Long id) {
        OaCarRequest request = requireStatus(id, CarRequestStatus.DRAFT, "oa.label.submit");
        if (bizRules.option(OaBizRules.CAR_APPROVAL, CarApprovalMode.class) == CarApprovalMode.AUTO
                || !flowApi.isAvailable(PROCESS_KEY)) {
            transit(id, CarRequestStatus.DRAFT, CarRequestStatus.APPROVED);
            return false;
        }
        ...
    }
}
```

`submit` 的完整写法见 [接入审批流](./approval)。`BizRules` 的方法：

| 方法 | 返回 |
| --- | --- |
| `get(key)` | 原始字符串 |
| `bool(key)` | `boolean` |
| `number(key)` | `int` |
| `option(key, 枚举类)` | 枚举值，用 `==` 比较 |

读取的是当前请求所属租户的值。定时任务按租户逐个执行，`@Async` 会传递租户上下文，因此在这些场景中读取的也是对应租户的值。

### 4. 验证

1. 重启后端，「系统管理 → 业务参数」中出现「行政办公」页签和两个参数，显示默认值；
2. 修改后点「保存」，参数显示「已修改」标签，业务操作按新值生效；点「恢复默认」后保存，恢复为默认值；
3. 开启 SaaS 时用两个租户分别修改，确认互不影响。

## 注意事项

- 新租户不需要初始化业务参数：没有修改过的参数都取默认值，不需要实现 `TenantInitializer`。
- 修改参数的默认值只影响没有修改过该参数的租户；已修改过的租户保留自己的值。
- 下拉参数的枚举不要删除或重命名已经可能被保存的值，否则 `option` 读取时 `Enum.valueOf` 会抛出异常；确实要删除时同时写升级 SQL 删除或改写 `sys_biz_rule` 中对应的行。
- 直接用 SQL 修改 `sys_biz_rule` 后要删除缓存 `bizrule:{租户ID}`（或在「系统监控 → 缓存监控」中清空「业务参数」）。
- 「业务参数」不是平台专属功能，开启 SaaS 时可以加入租户套餐，由租户管理员自行设置。
- 参数只用于控制规则（开关、比例、方式），不要用来保存业务数据或大段文本。
