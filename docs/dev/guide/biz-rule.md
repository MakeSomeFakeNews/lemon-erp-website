---
order: 13
---

# 新增业务参数

业务参数是各模块按租户配置的业务控制规则和计算规则，例如采购入库允许超收的比例、客户信用额度的控制方式、工资计算的计薪天数和个税预扣率表。它们在「系统管理 → 业务参数」中按模块分页签显示，每个企业（租户）可以有不同的设置，修改后立即生效。新增业务控制、或者计算中用到的比例、倍数、税率表等「各企业可能不同」的数字时，应登记为业务参数，而不是写死在代码里。

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
| `BizRule` | `framework/rule` | 参数定义（record）：标识、所属模块（页签）、名称、类型（`BOOL` / `NUMBER` / `DECIMAL` / `SELECT` / `TABLE`）、默认值、下拉选项枚举、数字范围、小数位数、表格的列、说明 |
| `BizRule.Column` | `framework/rule` | 表格型参数的一列：名称、小数位数、最小值、最大值、能否留空（表示不限） |
| `BizRuleProvider` | `framework/rule` | 业务模块实现这个接口（声明为 Bean）：`rules()` 返回本模块的参数定义，`validate(key, value)` 做额外的校验（可选） |
| `BizRules` | `framework/rule` | 业务代码读取当前租户的参数值（`bool`、`number`、`decimal`、`option`、`table`） |
| `SysBizRuleService` | system 模块 | 实现 `BizRules`：汇总所有 `BizRuleProvider` 的定义，只保存修改过的值，按租户缓存 |

业务模块只依赖 `lemon-framework` 中的接口，实现在 system 模块中，因此任何业务模块都可以登记和读取业务参数，不会形成反向依赖。

读取流程：`BizRules.get(key)` 先找到参数定义（未登记的标识抛出 `BizException`「业务参数不存在」），再读取当前租户修改过的值（缓存 `bizrule:{租户ID}`，12 小时；没有租户上下文时按平台租户），没有修改过时返回定义中的默认值。

保存流程：页面只提交修改过的参数（`PUT /system/biz-rule`，`{ 参数标识: 值 }`），后端按类型校验并规范化（`DECIMAL`、`TABLE` 去掉数字末尾的 0），再调用登记该参数的 `BizRuleProvider.validate` 做额外校验；值为空或等于默认值时删除这一行（恢复默认），否则插入或更新。保存后立即删除当前租户的缓存，并在事务提交后再删除一次（避免并发请求在提交前把旧值重新加载进缓存），下一次读取即为新值。

## 已有的业务参数

| 标识 | 模块 | 名称 | 类型 | 默认值 | 使用位置 |
| --- | --- | --- | --- | --- | --- |
| `scm.purchaseIn.overRate` | 供应链 | 采购入库超收比例（%） | 数字 0~100 | 0 | `ScmTradeDocService`：采购入库时订单明细的已入库数量按比例放宽（`addDone` 的 `overRate`） |
| `scm.salesOut.overRate` | 供应链 | 销售出库超发比例（%） | 数字 0~100 | 0 | 同上，销售出库 |
| `scm.credit.control` | 供应链 | 客户信用额度控制 | 下拉（`CreditControl`） | `ALL` 审核和出库时控制 | `ScmOrderService`：`ALL` 时审核销售订单和出库都校验，`SHIPMENT` 只在出库时校验，`NONE` 不校验 |
| `fin.voucher.selfAudit` | 财务 | 允许审核自己制单的凭证 | 是否 | false | `FinVoucherService`：关闭时制单人不能审核自己的凭证（超级管理员除外） |
| `hr.pay.monthDays` | 人力资源 | 月计薪天数 | 小数（2 位）1~31 | 21.75 | 日工资 =（基本工资 + 岗位津贴）/ 月计薪天数 |
| `hr.pay.dayHours` | 人力资源 | 每日工时 | 小数 1~24 | 8 | 小时工资 = 日工资 / 每日工时；请假跨天时每天按此计 |
| `hr.social.personalRate` / `hr.social.companyRate` | 人力资源 | 个人 / 单位社保比例（%） | 小数 0~100 | 10.5 / 26 | 员工没有社保方案时使用 |
| `hr.attendance.lateFine` | 人力资源 | 迟到早退扣款（每次） | 小数 0~10000 | 50 | 工资表考勤扣款 |
| `hr.leave.sickDeductRate` | 人力资源 | 病假扣发比例（%） | 小数 0~100 | 40 | 病假按小时工资扣发 |
| `hr.overtime.workdayRate` / `restdayRate` / `holidayRate` | 人力资源 | 工作日 / 休息日 / 法定节假日加班倍数 | 小数 0~10 | 1.5 / 2 / 3 | 加班费 |
| `hr.tax.threshold` | 人力资源 | 个税基本减除费用（月） | 小数 | 5000 | 累计预扣法 |
| `hr.tax.table` | 人力资源 | 个税累计预扣率表 | 表格（上限、预扣率 %、速算扣除数） | 7 档综合所得预扣率表 | 除最后一档外上限必填且递增，最后一档上限留空（不限），由 `HrBizRules.validate` 校验 |
| `hr.employee.probationMonths` | 人力资源 | 默认试用期（月） | 整数 0~12 | 3 | 录用、新增员工时的默认试用期 |

定义分别在 `ScmBizRules`、`FinBizRules`、`HrBizRules` 中；供应链、财务的标识常量定义在对应的 `*BizRules` 类里，人力资源的标识和默认值定义在 `hr/model/HrRules` 中（见下文「多个相关参数的类型化读取」）。

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
| `BizRule.decimal(key, module, label, 默认值, 小数位数, 最小值, 最大值, 说明)` | `DECIMAL` | 数字输入框（按小数位数） | 默认值写成去掉末尾 0 的文本（如 `"21.75"`、`"8"`），保存时校验范围和小数位数 |
| `BizRule.select(key, module, label, 默认枚举值, 枚举类, 说明)` | `SELECT` | 单选按钮组 | 值为枚举名称，保存时校验必须是枚举中的值 |
| `BizRule.table(key, module, label, 默认值, 列, 说明)` | `TABLE` | 可编辑表格（插入行、删除行） | 多行多列的数字，见下文「表格型参数」 |

- `key`：全局唯一，建议「模块.对象.属性」，最长 64 个字符（`sys_biz_rule.rule_key`）；
- `module`、`label`、`remark` 和选项枚举的 `label()` 都是消息键（登记在声明模块的资源包中），「业务参数」页面按请求语言显示，见 [国际化](./i18n)；
- `module`：页面上的页签名称，同一模块的参数写同一个键；页签和参数按登记顺序显示；
- `remark`：显示在参数下方，页面会在后面加上「默认：xxx」（表格型参数不显示默认值）；
- 不支持文本类型（`SettingType.TEXT`），值（包括表格型参数规范化之后的文本）最长 255 个字符。

Bean 注册后不需要任何其他配置，重启后参数就出现在「业务参数」页面中。

### 3. 在业务代码中读取

注入 `BizRules`，按类型读取：

```java
@Service
@RequiredArgsConstructor
public class OaCarRequestService {

    private final BizRules bizRules;
    private final ApprovalSupport approvalSupport;

    @Transactional
    public Long create(CarRequestForm form) {
        int maxDays = bizRules.number(OaBizRules.CAR_MAX_ADVANCE_DAYS);
        if (form.useDate().isAfter(LocalDate.now().plusDays(maxDays))) {
            throw new BizException("oa.error.carUseDateTooFar", maxDays);
        }
        ...
    }

    /** 提交：设置为「提交即通过」时直接批准，否则按流程是否发布决定（提交审批见「接入审批流」） */
    @Transactional
    public boolean submit(Long id) {
        OaCarRequest request = requireStatus(id, CarRequestStatus.DRAFT, "oa.label.submit");
        if (bizRules.option(OaBizRules.CAR_APPROVAL, CarApprovalMode.class) == CarApprovalMode.AUTO) {
            transit(id, CarRequestStatus.DRAFT, CarRequestStatus.APPROVED);
            return false;
        }
        return approvalSupport.submit(FLOW, id, Map.of(...), ...);
    }
}
```

`submit` 的完整写法见 [接入审批流](./approval)。`BizRules` 的方法：

| 方法 | 返回 |
| --- | --- |
| `get(key)` | 原始字符串（未修改时为默认值；参数未登记时抛异常） |
| `bool(key)` | `boolean` |
| `number(key)` | `int` |
| `decimal(key)` | `BigDecimal` |
| `option(key, 枚举类)` | 枚举值，用 `==` 比较 |
| `table(key)` | `List<List<BigDecimal>>`：每行一个列表，留空的单元格为 `null` |

读取的是当前请求所属租户的值。定时任务按租户逐个执行，`@Async` 会传递租户上下文，因此在这些场景中读取的也是对应租户的值。

### 表格型参数

一个参数需要多行多列的数字时（如税率表、阶梯价）用 `TABLE` 类型。值保存为文本：行之间用 `;`、单元格之间用 `,` 分隔，可以留空的列留空表示「不限」。例如个税累计预扣率表（累计应纳税所得额上限、预扣率 %、速算扣除数，最后一档不限）：

```
36000,3,0;144000,10,2520;300000,20,16920;420000,25,31920;660000,30,52920;960000,35,85920;,45,181920
```

```java
BizRule.table(HrRules.TAX_TABLE, MODULE, "hr.label.rule.taxTable", DEFAULTS.get(HrRules.TAX_TABLE), List.of(
                new BizRule.Column("hr.label.rule.taxUpper", 2, 0, 100_000_000L, true),       // 上限：可留空（不限）
                new BizRule.Column("hr.label.rule.taxRate", 2, 0, 100, false),                // 预扣率（%）
                new BizRule.Column("hr.label.rule.taxDeduction", 2, 0, 100_000_000L, false)), // 速算扣除数
        "hr.label.rule.taxTableRemark")
```

- 保存时通用校验每行的列数、必填、范围、小数位数，并把数字规范为去掉末尾 0 的写法（`BizRule.formatTable`）；
- 行与行之间的约束（如上限必须递增、只有最后一行可以不限）在 `BizRuleProvider.validate` 中校验，不合法时抛 `BizException`：

```java
@Override
public void validate(String key, String value) {
    if (!HrRules.TAX_TABLE.equals(key)) {
        return;
    }
    List<HrRules.TaxBracket> brackets = HrRules.brackets(value);
    for (int i = 0; i < brackets.size(); i++) {
        HrRules.TaxBracket b = brackets.get(i);
        boolean last = i == brackets.size() - 1;
        if (last != (b.upper() == null)) {
            throw new BizException("hr.error.taxTableLastUnlimited");
        }
        if (i > 0 && !last && b.upper().compareTo(brackets.get(i - 1).upper()) <= 0) {
            throw new BizException("hr.error.taxTableAscending", i + 1);
        }
    }
}
```

- 读取时 `bizRules.table(key)` 或 `BizRule.parseTable(值)` 得到每行的数字列表，再转为业务自己的 record（如 `HrRules.TaxBracket`）。

### 多个相关参数的类型化读取

一组计算规则有很多参数时（如工资计算用到的 12 个参数），不要在计算代码中到处 `bizRules.decimal("...")`，而是定义一个 record 汇总这组参数，读取一次后作为参数传给计算方法。人力资源的写法：

```java
// hr/model/HrRules：参数标识、默认值和类型化的取值
public record HrRules(BigDecimal monthPayDays, BigDecimal dayHours, BigDecimal socialPersonal, BigDecimal socialCompany,
                      BigDecimal lateFine, BigDecimal sickDeduct, BigDecimal overtimeWorkday, BigDecimal overtimeRestday,
                      BigDecimal overtimeHoliday, BigDecimal taxThreshold, List<TaxBracket> taxBrackets, int probationMonths) {

    public static final String MONTH_PAY_DAYS = "hr.pay.monthDays";
    // ... 其他参数标识

    /** 默认值（规范写法，业务参数的默认值） */
    public static final Map<String, String> DEFAULTS;   // 静态块中填入 21.75、8、10.5 ...

    /** 全部取默认值，不依赖 Spring，便于单独验证计算逻辑 */
    public static final HrRules DEFAULT = of(DEFAULTS::get);

    /** 由参数值构造（参数标识 → 值） */
    public static HrRules of(Function<String, String> values) { ... }

    /** 比例类参数按百分数保存，提供换算后的小数 */
    public BigDecimal socialPersonalRate() {
        return socialPersonal.divide(Decimals.HUNDRED);
    }

    /** 累计预扣的个税 = 累计应纳税所得额 × 预扣率 − 速算扣除数 */
    public BigDecimal cumulativeTax(BigDecimal cumTaxable) { ... }
}
```

```java
// hr/service/HrBizRules：登记参数，默认值取 HrRules.DEFAULTS，保证定义只有一处
decimal(HrRules.MONTH_PAY_DAYS, "hr.label.rule.monthPayDays", 2, 1, 31, "hr.label.rule.monthPayDaysRemark"),

// hr/service/HrRuleService：读取当前租户的整组参数
public HrRules current() {
    return HrRules.of(bizRules::get);
}

// 使用：一次计算中只读取一次，传给计算方法
HrRules rules = ruleService.current();
// HrPayrollService：日工资 =（基本工资 + 岗位津贴）/ 月计薪天数
BigDecimal daily = salary.getBaseSalary().add(salary.getPostAllowance()).divide(rules.monthPayDays(), 6, RoundingMode.HALF_UP);
```

- 标识、默认值、类型转换和派生的计算（如 `monthPayHours()`、`cumulativeTax()`）都集中在 record 中，`BizRuleProvider` 只负责登记；
- 计算方法接收 record 参数而不是自己读取参数，同一次计算中的取值一致，也可以用 `HrRules.DEFAULT` 单独验证；
- 比例类参数按百分数保存（10.5 表示 10.5%），在 record 中提供换算为小数的方法。

### 4. 验证

1. 重启后端，「系统管理 → 业务参数」中出现「行政办公」页签和两个参数，显示默认值；
2. 修改后点「保存」，参数显示「已修改」标签，业务操作按新值生效；点「恢复默认」后保存，恢复为默认值；
3. 开启 SaaS 时用两个租户分别修改，确认互不影响。

## 注意事项

- 新租户不需要初始化业务参数：没有修改过的参数都取默认值，不需要实现 `TenantInitializer`。
- 已有的计算规则改为业务参数时，默认值必须与原先写死的值一致，没有修改过参数的租户结果不变。
- 修改参数的默认值只影响没有修改过该参数的租户；已修改过的租户保留自己的值。
- 下拉参数的枚举不要删除或重命名已经可能被保存的值，否则 `option` 读取时 `Enum.valueOf` 会抛出异常；确实要删除时同时写升级 SQL 删除或改写 `sys_biz_rule` 中对应的行。
- 直接用 SQL 修改 `sys_biz_rule` 后要删除缓存 `bizrule:{租户ID}`（或在「系统监控 → 缓存监控」中清空「业务参数」）。
- 「业务参数」不是平台专属功能，开启 SaaS 时可以加入租户套餐，由租户管理员自行设置。
- 参数只用于控制规则和计算规则（开关、比例、倍数、方式、税率表），不要用来保存业务数据或大段文本。
