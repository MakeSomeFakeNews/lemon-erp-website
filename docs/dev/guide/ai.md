---
order: 17
---

# AI 能力扩展开发

业务模块通过实现 `framework/ai` 中的契约向智能模块提供能力：问数工具（`AiTool`）、智能录入的目标单据（`AiExtractTarget`）、数据整理的主数据来源（`AiCleanseSource`）、智能报告的数据来源（`AiReportSource`）。本页给出四种扩展的完整步骤和示例。实现机制（注册表、模型调用、权限与上下文）见 [智能（AI）](../architecture/ai)。

示例沿用 [新增一个业务模块](./new-module) 中的「行政办公 → 用车申请」（`lemon-oa`，`OaCarRequestService`、`OaCarRequestMapper`、业务字典 `oa_car_type`）；数据整理没有合适的用车申请场景，以现有的供应商实现为例。

## 通用约定

| 约定 | 说明 |
| --- | --- |
| 依赖 | 业务模块只依赖 `lemon-framework`（`com.lemon.erp.framework.ai`），**不依赖 `lemon-ai`**，不注入 `LlmClient`、不自己调用模型接口；所有模型调用由 ai 模块经 `AiModelService` 完成 |
| 位置 | 实现类放在本模块的 `ai` 包（`com.lemon.erp.modules.<模块>.ai`），注册为 `@Component`，AI 模块启动时自动收集，不需要登记 |
| 标识 | 工具名称为小写字母开头的小写字母、数字、下划线（如 `oa_car_requests`），建议以模块名开头；录入目标、整理来源、报告来源为 `模块.名称`（如 `oa.car-request`）。全局唯一，格式不对或重复时**启动失败** |
| 列表顺序 | 问数工具、整理来源按标识排序（发给模型的工具列表顺序固定，服务商的提示词缓存才能命中）；智能录入的目标单据按实现类上的 `@Order` 排序（页面中的显示顺序），没有 `@Order` 的排在最后；报告来源按 `order()` 排序 |
| 只查询 | `AiTool.execute`、`prefill`、`page`、`snapshot` 都只查询；调用本模块 Service 的查询方法，数据权限（`@DataPermission`）、租户条件自动生效。只有 `AiCleanseSource.apply` / `disable` 写数据，并且必须调用本模块 Service 的修改方法 |
| 不返回敏感字段 | 这些数据会发送给第三方模型服务：不返回密码、证件号、手机号、银行账号、个人薪资、小时成本等；需要时只给汇总值 |
| 文字用消息键 | 名称、给模型的说明、参数说明、提示都写消息键，中英文写在本模块 `i18n/<模块>.properties` / `<模块>_en.properties`。给模型看的说明也要两种语言（按提问人的界面语言取） |
| Schema 每次构造 | `parameters()`、`schema()` 用 `AiSchema` 在每次调用时构造（说明文字在构造时按当前语言取），不要缓存在静态字段中 |
| 枚举 | 状态等参数用 `AiSchema.enumOf` 给出枚举名称，在说明中写明每个取值的含义；结果中的状态返回枚举名称，同样在工具说明中解释 |
| 不在事务中 | 契约方法由 ai 模块在事务之外调用，查询方法不需要 `@Transactional`；`apply` 的事务由业务 Service 的修改方法负责 |

## 新增一个问数工具

### 1. 实现 AiTool

`lemon-modules/lemon-oa/src/main/java/com/lemon/erp/modules/oa/ai/OaCarRequestTool.java`：

```java
package com.lemon.erp.modules.oa.ai;

import com.lemon.erp.common.result.PageResult;
import com.lemon.erp.framework.ai.AiSchema;
import com.lemon.erp.framework.ai.AiTool;
import com.lemon.erp.framework.ai.AiToolArgs;
import com.lemon.erp.framework.ai.AiToolResult;
import com.lemon.erp.framework.dict.DictLookup;
import com.lemon.erp.modules.oa.entity.OaCarRequest;
import com.lemon.erp.modules.oa.model.CarRequestStatus;
import com.lemon.erp.modules.oa.service.OaCarRequestService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * 用车申请清单：复用 {@link OaCarRequestService#page}（按数据权限），只返回精简字段
 */
@Component
@RequiredArgsConstructor
public class OaCarRequestTool implements AiTool {

    private static final String CAR_TYPE_DICT = "oa_car_type";
    private static final int DEFAULT_LIMIT = 50;

    /** 返回给模型的一行：字段名用有含义的英文驼峰，状态为枚举名称（含义写在工具说明中），用车类型给出字典名称 */
    record CarRequestRow(String requestNo, LocalDate useDate, String carType, String destination, Integer passengers,
                         CarRequestStatus status, String applicant) {
    }

    private final OaCarRequestService requestService;
    private final DictLookup dictLookup;

    @Override
    public String name() {
        return "oa_car_requests";
    }

    @Override
    public String labelKey() {
        return "oa.ai.tool.carRequests";
    }

    @Override
    public String descriptionKey() {
        return "oa.ai.tool.carRequests.desc";
    }

    @Override
    public String permission() {
        return "oa:car:list";
    }

    @Override
    public Map<String, Object> parameters() {
        String[] statuses = Arrays.stream(CarRequestStatus.values()).map(Enum::name).toArray(String[]::new);
        return AiSchema.object()
                .prop("status", AiSchema.enumOf("oa.ai.param.status", statuses), false)
                .prop("keyword", AiSchema.string("oa.ai.param.keyword").maxLength(64), false)
                .prop("limit", AiSchema.integer("oa.ai.param.limit").min(1).max(AiTool.MAX_ROWS), false)
                .build();
    }

    @Override
    public Object execute(AiToolArgs args) {
        // 参数已按 parameters() 校验：status 一定是枚举名称之一，limit 在 1 ～ 200 之间
        CarRequestStatus status = args.has("status") ? CarRequestStatus.valueOf(args.getString("status")) : null;
        int limit = args.getInt("limit", DEFAULT_LIMIT);
        PageResult<OaCarRequest> page = requestService.page(1, limit, status, args.getString("keyword"));
        Map<String, String> types = dictLookup.options(CAR_TYPE_DICT);
        List<CarRequestRow> rows = page.records().stream()
                .map(r -> new CarRequestRow(r.getRequestNo(), r.getUseDate(),
                        r.getCarType() == null ? null : types.getOrDefault(r.getCarType(), r.getCarType()),
                        r.getDestination(), r.getPassengers(), r.getStatus(), r.getCreateByName()))
                .toList();
        // 总数大于返回的行数时视为截断，AI 模块会告诉模型「结果已截断、共多少行」
        return AiToolResult.rows(rows, page.total());
    }
}
```

要点：

- **数据权限**：`OaCarRequestService.page` 上有 `@DataPermission`，工具在提问人的登录上下文中执行（异步线程由 `AiAsyncContext` 带上租户、用户、语言），提问人只能查到自己数据权限范围内的用车申请。不要为了「查得全」绕过 Service 直接查表；
- **权限**：`permission()` 与列表接口的权限一致。没有 `oa:car:list` 的用户，模型看不到这个工具，伪造调用也会被拒绝；
- **参数**：参数已按 schema 校验，类型不对时 `AiToolArgs` 的取值方法抛 `BizException`，错误信息回传给模型修正；业务上不合理的参数（如日期范围过大）也抛 `BizException`，用消息键说明原因；
- **结果**：列表用 `AiToolResult.rows(行, 总数)`，单个汇总对象用 `AiToolResult.of(对象)`，也可以直接返回 record / List。最多 `AiTool.MAX_ROWS`（200）行，超出由 AI 模块截断；需要合计的汇总表，合计行放在第一行或最后一行，并在说明中写明；
- **金额、比率**：金额单位为元，比率为百分数（字段名带 `Percent` 或 `Pct`），在说明中写明口径（订单币种还是本位币、含税与否）；
- **表格列名**：结果表格按字段名在前端语言包 `locales/zh-CN/aiColumn.js`、`en-US/aiColumn.js` 中取列名（如 `orderNo` →「订单号」），新字段要在两个文件中补充，没有登记的直接显示字段名。常用字段（`materialCode`、`amount`、`qty`、`status` 等）已经登记，尽量复用已有的字段名；
- **业务字典**：取值对模型没有意义，用 `DictLookup.options(字典)` 换成名称；汇总 SQL 中可以 JOIN `sys_dict_data` 直接返回名称。

已有工具的公共写法可以参考：仓库、供应链、生产模块用 `wms/ai/AiQuerySupport`（`startDate` / `endDate` / `limit` 参数、日期范围校验、按编码或名称匹配基础资料 `pick`），财务、人事、商务智能各有 `FinAiSupport`、`HrAiSupport`、`BiAiSupport`；成对的工具写成一个类中的嵌套 `@Component`（如 `FinAgingTools.Receivable / Payable`）。

### 2. 消息键

`oa.properties`：

```properties
oa.ai.tool.carRequests=用车申请
oa.ai.tool.carRequests.desc=查询用车申请清单（按当前用户的数据权限）：单号、用车日期、用车类型、目的地、乘车人数、\
状态（DRAFT 草稿、APPROVING 审批中、APPROVED 已批准）、申请人，最新的在前。用于回答最近有哪些用车、去某地的用车、待审批的用车等问题。
oa.ai.param.status=状态：DRAFT 草稿、APPROVING 审批中、APPROVED 已批准，不传为全部
oa.ai.param.keyword=单号或目的地包含的关键字
oa.ai.param.limit=最多返回的行数，默认 50
```

`oa_en.properties`：

```properties
oa.ai.tool.carRequests=Car requests
oa.ai.tool.carRequests.desc=Lists car requests within the current user''s data scope: request No., use date, car type, destination, \
passengers, status (DRAFT draft, APPROVING in approval, APPROVED approved) and applicant, newest first. Use it for questions \
about recent car usage, trips to a destination or requests awaiting approval.
oa.ai.param.status=Status: DRAFT, APPROVING or APPROVED; omit for all
oa.ai.param.keyword=Keyword contained in the request No. or destination
oa.ai.param.limit=Maximum number of rows, 50 by default
```

- `labelKey` 是显示给用户的简短名称，对话中显示为「正在查询：用车申请」；
- `descriptionKey` 是给模型看的说明，**模型完全依据它决定什么时候调用、怎么理解结果**：写清楚做什么、返回哪些字段及含义、枚举取值、默认范围、适合回答什么问题；
- MessageFormat 中单引号要写两个（`user''s`）。

### 3. 验证

1. 重启后端，用有 `ai:chat:use` 和 `oa:car:list` 的账号在「AI 问数」中提问（如「最近一周有哪些用车申请」），查询过程中出现「正在查询：用车申请」，展开可以看到参数和表格；
2. 用数据权限为「仅本人」的账号提问，确认只返回本人的申请；去掉 `oa:car:list` 后再问，模型应说明无法查询；
3. 运行 `python3 scripts/check_i18n.py lemon-modules/lemon-oa`，切换为英文界面提问，确认说明和回答都是英文。

## 新增一种可智能录入的单据

### 1. 实现 AiExtractTarget

`lemon-modules/lemon-oa/src/main/java/com/lemon/erp/modules/oa/ai/OaCarRequestExtractTarget.java`：

```java
package com.lemon.erp.modules.oa.ai;

import com.lemon.erp.common.i18n.Messages;
import com.lemon.erp.framework.ai.AiExtractTarget;
import com.lemon.erp.framework.ai.AiPrefill;
import com.lemon.erp.framework.ai.AiPrefillBuilder;
import com.lemon.erp.framework.ai.AiSchema;
import com.lemon.erp.framework.dict.DictLookup;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * 智能录入：用车申请（出差审批单、聊天记录、行程截图等），用车类型按业务字典 oa_car_type 的名称匹配键值
 */
@Component
@RequiredArgsConstructor
public class OaCarRequestExtractTarget implements AiExtractTarget {

    private static final String CAR_TYPE_DICT = "oa_car_type";
    private static final int MAX_PASSENGERS = 60;

    private final DictLookup dictLookup;

    @Override
    public String key() {
        return "oa.car-request";
    }

    @Override
    public String labelKey() {
        return "oa.label.carRequest";
    }

    /** 一般是单据的新增权限：没有时目标不出现在列表中，调用返回 403 */
    @Override
    public String permission() {
        return "oa:car:add";
    }

    /** 模型输出的结构：只描述单据上能看到的信息，不要求模型给出 ID 或字典键值 */
    @Override
    public Map<String, Object> schema() {
        List<String> types = List.copyOf(dictLookup.options(CAR_TYPE_DICT).values());
        AiSchema carType = types.isEmpty() ? AiSchema.string("oa.ai.extractCarType").maxLength(16)
                : AiSchema.enumOf("oa.ai.extractCarType", types.toArray(String[]::new));
        return AiSchema.object()
                .prop("useDate", AiSchema.date("oa.ai.extractUseDate"), false)
                .prop("carType", carType, false)
                .prop("destination", AiSchema.string("oa.ai.extractDestination").maxLength(100), true)
                .prop("passengers", AiSchema.integer("oa.ai.extractPassengers"), false)
                .prop("purpose", AiSchema.string("oa.ai.extractPurpose").maxLength(255), false)
                .build();
    }

    @Override
    public String instructionKey() {
        return "oa.ai.extractInstruction";
    }

    /** 模型输出（已按 schema 校验）→ 前端新增表单的数据；只查询、不写库 */
    @Override
    public AiPrefill prefill(Map<String, Object> ex) {
        AiPrefillBuilder b = new AiPrefillBuilder();
        b.put("useDate", b.date("useDate", AiPrefillBuilder.str(ex, "useDate")));

        String destination = cut(AiPrefillBuilder.str(ex, "destination"), 100);
        b.required("destination", destination, Messages.get("oa.ai.labelDestination"));
        b.put("destination", destination);
        b.put("purpose", cut(AiPrefillBuilder.str(ex, "purpose"), 255));

        String carType = AiPrefillBuilder.str(ex, "carType");
        if (carType != null) {
            String value = carTypeValue(carType);
            if (value == null) {
                b.warn("carType", carType, "oa.ai.warnCarTypeNotFound", carType);
            }
            b.put("carType", value);
        }

        BigDecimal passengers = b.qty("passengers", AiPrefillBuilder.dec(ex, "passengers"));
        if (passengers != null) {
            if (passengers.compareTo(BigDecimal.valueOf(MAX_PASSENGERS)) > 0 || passengers.stripTrailingZeros().scale() > 0) {
                b.warn("passengers", passengers.toPlainString(), "oa.ai.warnPassengersInvalid", passengers.toPlainString());
            } else {
                b.put("passengers", passengers.intValue());
            }
        }
        return b.build();
    }

    /** 用车类型：按字典名称或键值匹配，匹配不上为 null（由用户选择） */
    private String carTypeValue(String text) {
        for (Map.Entry<String, String> e : dictLookup.options(CAR_TYPE_DICT).entrySet()) {
            if (e.getValue().equals(text) || e.getKey().equalsIgnoreCase(text)) {
                return e.getKey();
            }
        }
        return null;
    }

    private static String cut(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }

    /** 前端打开的页面 */
    @Override
    public String route() {
        return "/oa/car";
    }

    /** 前端表单标识，与页面中 useAiPrefill 的第一个参数一致 */
    @Override
    public String form() {
        return "car-request";
    }
}
```

要点：

- `prefill` 返回的 `data` 字段名必须与前端新增表单的字段一致（这里是 `useDate`、`carType`、`destination`、`passengers`、`purpose`），值的格式也要与表单一致（日期为 `YYYY-MM-DD` 字符串）。模型多输出的字段会被忽略，没有放进 `data` 的不会预填；
- 需要匹配主数据（供应商、物料、科目等）时用 `AiPrefillBuilder.match`：给出精确匹配和模糊搜索两个函数（调用本模块 Service），匹配不上时把原文放在 `xxxName` 字段并提示，参考 `scm/ai/ScmExtractSupport`、`fin/ai/FinExpenseClaimExtractTarget`；
- 有明细行时 schema 用 `AiSchema.array(说明键, AiSchema.object()...)`，`prefill` 中用 `b.list(ex, "items", "items", 上限)` 读取，提示的字段路径写成 `items[2].materialId`，金额用 `price` / `total` 检查；
- 可能重复的资料（同名、同税号）只提示，不阻止：用户核对后由原表单保存，原接口的校验照常生效；
- 字典取值作为枚举给模型时用名称（模型看得懂），在 `prefill` 中换回键值。

`oa.properties`（英文同样补齐）：

```properties
oa.ai.extractUseDate=用车日期 yyyy-MM-dd
oa.ai.extractCarType=用车类型，只能从列出的取值中选择，无法判断时填 null
oa.ai.extractDestination=目的地
oa.ai.extractPassengers=乘车人数（整数）
oa.ai.extractPurpose=事由
oa.ai.extractInstruction=只有出发时间时取其日期作为用车日期；乘车人数是人数而不是车辆数。
oa.ai.labelDestination=目的地
oa.ai.warnCarTypeNotFound=用车类型「{0}」不在字典中，请手工选择
oa.ai.warnPassengersInvalid=乘车人数 {0} 不正确（应为 1 ～ 60 的整数），请手工填写
```

### 2. 页面接入

`views/oa/car/index.vue` 中加入「AI 识别」按钮、提示和字段高亮（其余代码见 [新增一个业务模块](./new-module)）：

```vue
<template>
  <!-- 工具栏：有 ai:extract:use、oa:car:add 且租户开启了智能录入时才显示 -->
  <TableToolbar ...>
    <a-button v-perm="'oa:car:add'" type="primary" @click="drawer.openCreate()">...</a-button>
    <AiExtractButton target="oa.car-request" perm="oa:car:add" :title="$t('oa.car.create')" @result="ai.apply" />
  </TableToolbar>

  <FormDrawer :drawer="drawer" :create-title="$t('oa.car.create')" :edit-title="$t('oa.car.edit')">
    <!-- 表单顶部列出需要核对的提示 -->
    <AiPrefillAlert :ai="ai" />
    <a-form ref="formRef" :model="form" :rules="rules" layout="vertical">
      <!-- 有提示的字段加黄色边框 -->
      <a-form-item :label="$t('oa.car.carType')" name="carType" :class="ai.cls('carType')">...</a-form-item>
      <a-form-item :label="$t('oa.car.passengers')" name="passengers" :class="ai.cls('passengers')">...</a-form-item>
      <a-form-item :label="$t('oa.car.destination')" name="destination" :class="ai.cls('destination')">...</a-form-item>
    </a-form>
  </FormDrawer>
</template>

<script setup>
import AiExtractButton from '@/components/ai/AiExtractButton.vue'
import AiPrefillAlert from '@/components/ai/AiPrefillAlert.vue'
import { useAiPrefill } from '@/composables/useAiPrefill'

const drawer = useFormDrawer({ /* ... */ })

// 第一个参数与后端 form() 一致；open 中必须同步调用 openCreate（预填的表单视为已修改，直接关闭要确认）
const ai = useAiPrefill('car-request', (data) => drawer.openCreate(data), () => drawer.open.value)
</script>
```

- 「智能录入」页面识别后跳转到 `/oa/car?ai=car-request`，`useAiPrefill` 在页面挂载时取出结果并打开新增表单；在本页点「AI 识别」则直接打开。识别结果只保存在内存中，刷新即丢弃；
- 表单字段多、用子页（`<FormDrawer page>`）或独立表单组件时，把 `ai` 作为 prop 传进去，在组件中使用 `ai.cls(...)`；有明细行时参考 `components/scm/OrderForm.vue`（匹配不上的物料在选择框下显示识别出的原文）；
- 在前端语言包 `locales/zh-CN/ai.js`、`en-US/ai.js` 的 `extract.field` 中补充 schema 字段的名称（`useDate`、`carType`、`destination`、`passengers`、`purpose`），识别结果预览中显示为中文 / 英文，没有登记的直接显示字段名。

### 3. 授权与验证

- 「智能录入」菜单（`ai:extract:use`）授给需要的角色；能用哪些目标由目标自身的权限决定，不需要另外配置；
- 在「AI 设置」中开启智能录入；要识别图片时配置识图模型（未配置时只能识别 PDF、Excel、文本）；
- 分别上传文字、图片、扫描件 PDF 验证：结果预填到表单、提示正确，保存走原有的校验。

## 新增一种可整理的资料

### 1. 业务 Service 增加只读查询

数据整理需要分页读取**启用**的记录（按 ID 升序，保证分页稳定），只查需要的列。以供应商为例（`ScmSupplierService`，现有代码）：

```java
/** 数据整理：启用的供应商，按 ID 升序，只查整理需要的列 */
public PageResult<ScmSupplier> pageForCleanse(long current, long size, String keyword) {
    Page<ScmSupplier> page = supplierMapper.selectPage(Page.of(current, size), Wrappers.<ScmSupplier>lambdaQuery()
            .select(ScmSupplier::getId, ScmSupplier::getCode, ScmSupplier::getName, ScmSupplier::getContact, ScmSupplier::getAddress, ScmSupplier::getTaxNo)
            .eq(ScmSupplier::getStatus, EnableStatus.ENABLED)
            .and(StringUtils.hasText(keyword), w -> w.like(ScmSupplier::getCode, keyword).or().like(ScmSupplier::getName, keyword))
            .orderByAsc(ScmSupplier::getId));
    return PageResult.of(page);
}

/** 是否有其他启用的供应商使用该名称 */
public boolean existsEnabledName(String name, Long excludeId) {
    return supplierMapper.exists(Wrappers.<ScmSupplier>lambdaQuery()
            .eq(ScmSupplier::getName, name)
            .eq(ScmSupplier::getStatus, EnableStatus.ENABLED)
            .ne(excludeId != null, ScmSupplier::getId, excludeId));
}
```

资料表有数据权限时，查询方法同样加 `@DataPermission`。

### 2. 实现 AiCleanseSource

`scm/ai/ScmSupplierCleanseSource`（现有代码）：

```java
package com.lemon.erp.modules.scm.ai;

import com.lemon.erp.common.enums.EnableStatus;
import com.lemon.erp.common.exception.BizException;
import com.lemon.erp.common.result.PageResult;
import com.lemon.erp.common.validation.Update;
import com.lemon.erp.framework.ai.AiCleanseChange;
import com.lemon.erp.framework.ai.AiCleanseField;
import com.lemon.erp.framework.ai.AiCleanseRecord;
import com.lemon.erp.framework.ai.AiCleanseSource;
import com.lemon.erp.framework.ai.AiCleanseSupport;
import com.lemon.erp.modules.scm.entity.ScmSupplier;
import com.lemon.erp.modules.scm.service.ScmSupplierService;
import jakarta.validation.Validator;
import jakarta.validation.groups.Default;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.EnumSet;
import java.util.Set;

/**
 * 数据整理：供应商（名称、联系人、地址）。候选记录不含电话、邮箱、开户行和银行账号；税号只用于查重。
 * 应用建议调用 ScmSupplierService#update（编码校验与变更历史），另外按实体注解校验长度，不允许改成其他启用供应商的名称；
 * 疑似重复的供应商可停用
 */
@Component
@RequiredArgsConstructor
public class ScmSupplierCleanseSource implements AiCleanseSource {

    private final ScmSupplierService supplierService;
    private final Validator validator;

    @Override
    public String key() {
        return "scm.supplier";
    }

    @Override
    public String labelKey() {
        return "scm.label.supplier";
    }

    /** 查看候选记录、生成建议 */
    @Override
    public String viewPermission() {
        return "scm:supplier:list";
    }

    /** 采纳建议（修改、停用） */
    @Override
    public String applyPermission() {
        return "scm:supplier:edit";
    }

    @Override
    public Set<AiCleanseField> editableFields() {
        return EnumSet.of(AiCleanseField.NAME, AiCleanseField.CONTACT, AiCleanseField.ADDRESS);
    }

    @Override
    public PageResult<AiCleanseRecord> page(long current, long size, String keyword) {
        PageResult<ScmSupplier> page = supplierService.pageForCleanse(current, size, keyword);
        return new PageResult<>(page.records().stream().map(ScmSupplierCleanseSource::toRecord).toList(), page.total());
    }

    /** 当前值：采纳前比较，记录在生成建议之后被修改过的建议过期 */
    @Override
    public AiCleanseRecord get(Long id) {
        return toRecord(supplierService.get(id));
    }

    @Override
    public void apply(AiCleanseChange change) {
        ScmSupplier s = supplierService.get(change.id());
        change.changes().forEach((field, value) -> {
            String v = AiCleanseSupport.trimToNull(value);
            switch (field) {
                case NAME -> s.setName(v);
                case CONTACT -> s.setContact(v);
                case ADDRESS -> s.setAddress(v);
                default -> throw new BizException("scm.error.cleanseFieldNotSupported", field.name());
            }
        });
        // 业务 Service 的修改方法本身不做 Bean Validation，按实体注解补上（与接口的 @Validated 相同的规则）
        AiCleanseSupport.validate(validator, s, Default.class, Update.class);
        if (change.changes().containsKey(AiCleanseField.NAME) && supplierService.existsEnabledName(s.getName(), s.getId())) {
            throw new BizException("scm.error.cleanseSupplierNameExists", s.getName());
        }
        supplierService.update(s.getId(), s);
    }

    /** 疑似重复只建议停用，不自动合并 */
    @Override
    public boolean supportsDisable() {
        return true;
    }

    @Override
    public void disable(Long id) {
        supplierService.changeStatus(id, EnableStatus.DISABLED);
    }

    /** 只放分析需要的字段：联系人、地址放在 extra 中（键为 AiCleanseField.extraKey()），税号用于查重 */
    private static AiCleanseRecord toRecord(ScmSupplier s) {
        return new AiCleanseRecord(s.getId(), s.getCode(), s.getName(), null, null, null,
                AiCleanseSupport.extra(AiCleanseField.CONTACT.extraKey(), s.getContact(), AiCleanseField.ADDRESS.extraKey(), s.getAddress(),
                        AiCleanseRecord.TAX_NO, s.getTaxNo()));
    }
}
```

要点：

- `AiCleanseRecord` 中名称、规格、分类、单位是固定字段，联系人、地址等放在 `extra` 中（键为 `AiCleanseField.extraKey()`），其他有助于判断的字段（品牌、条码）也可以放进 `extra`；`AiCleanseRecord.TAX_NO` 键的值相同的记录直接归为疑似重复；
- **`apply` 必须调用业务 Service 的修改方法**，不要直接写表：这样编码唯一、状态等原有校验和字段变更历史都照常生效；先用 `AiCleanseSupport.validate` 按实体注解校验长度等规则，再检查业务上的唯一性（不允许改成与其他启用记录重名）；
- 生成建议时 AI 模块已丢弃不可修改的字段、超过 `AiCleanseField.maxLength()` 的值和不在 `categoryOptions()` 中的分类；采纳时 `AiCleanseRegistry.apply` 再检查应用权限和字段在 `editableFields()` 中，然后才调用 `apply`；每条建议一个事务，`apply` 抛出的 `BizException` 消息作为该条的失败原因显示；
- 有分类时实现 `categoryOptions()` 返回可选值（值 → 名称，一般是 `dictLookup.options(业务字典)`），模型只能从中选择，参考 `wms/ai/WmsMaterialCleanseSource`；
- 可修改字段只能从 `AiCleanseField`（NAME、SPEC、CATEGORY、UNIT、CONTACT、ADDRESS）中选。需要新的字段时要在 `AiCleanseField` 中增加（列宽 `maxLength`，放在 `extra` 中的给出 `extraKey`），并在前端 `locales/<语言>/ai.js` 的 `cleanse.field` 中补充名称。

### 3. 验证

在「数据整理」中选择新的数据类型（列表来自 `GET /ai/cleanse/sources`，按查看权限过滤），发起整理，确认疑似重复和规范化建议合理；采纳一条后到资料页面确认已修改、变更历史有记录；手工修改某条记录后再采纳它的旧建议，应提示建议已过期。

## 为报告新增一类指标

智能报告由各来源返回的「指标快照」组成，模型只引用快照中的数字撰写文字。新增指标有两种方式：在已有来源的快照 record 中加字段，或新增一个来源（报告中多一个板块）。

### 快照的写法

- 返回 record（可嵌套 List），字段名用有含义的英文驼峰；金额单位为元；
- 只放汇总值和少量排行（前 5 ～ 10 名），不放明细清单；
- **增长率、占比在 Java 中算好**：`AiReportMetrics.growth(本期, 基期)`、`percent(部分, 整体)`（%，保留 1 位小数，基期为空或 0 时为 null）；百分比字段名以 `Pct` 结尾，百分点的变化以 `Points` 结尾——报告的提示词按这个约定告诉模型单位，模型不做任何计算；
- 环比用 `period.previous()` 再查一次上期，同比自己按去年同期查询，都放进快照；
- 数据来自数据仓库等非实时数据时，在快照中带上同步时间 `dataSyncedAt`，提示词会要求模型在同步时间早于期间结束时说明数据可能不完整。

### 新增一个来源

以用车申请为例：按用车类型统计期间内的申请数和乘车人次，与上期对比。

先在 mapper XML 中写汇总 SQL（统计在数据库中完成），`OaCarRequestMapper.xml`：

```xml
<select id="selectTypeSummary" resultType="com.lemon.erp.modules.oa.dto.CarTypeSummaryRow">
    SELECT r.car_type, COUNT(*) AS request_count, COALESCE(SUM(r.passengers), 0) AS passenger_count
    FROM oa_car_request r
    WHERE r.status = 'APPROVED' AND r.use_date BETWEEN #{beginDate} AND #{endDate}
    GROUP BY r.car_type
</select>
```

```java
// dto/CarTypeSummaryRow.java
@Data
public class CarTypeSummaryRow {
    private String carType;
    private Long requestCount;
    private Long passengerCount;
}

// mapper/OaCarRequestMapper.java
List<CarTypeSummaryRow> selectTypeSummary(@Param("beginDate") LocalDate beginDate, @Param("endDate") LocalDate endDate);

// service/OaCarRequestService.java：按数据权限统计
@DataPermission(table = "oa_car_request", deptColumn = "dept_id", userColumn = "create_by")
public List<CarTypeSummaryRow> typeSummary(LocalDate beginDate, LocalDate endDate) {
    return requestMapper.selectTypeSummary(beginDate, endDate);
}
```

然后实现 `AiReportSource`，`oa/ai/OaCarReportSource.java`：

```java
package com.lemon.erp.modules.oa.ai;

import com.lemon.erp.framework.ai.AiReportMetrics;
import com.lemon.erp.framework.ai.AiReportPeriod;
import com.lemon.erp.framework.ai.AiReportSource;
import com.lemon.erp.framework.dict.DictLookup;
import com.lemon.erp.modules.oa.dto.CarTypeSummaryRow;
import com.lemon.erp.modules.oa.service.OaCarRequestService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/** 智能报告「用车」：已批准的用车申请数、乘车人次及按用车类型的排行，与上期对比 */
@Component
@RequiredArgsConstructor
public class OaCarReportSource implements AiReportSource {

    private static final int TOP = 5;

    private final OaCarRequestService requestService;
    private final DictLookup dictLookup;

    @Override
    public String key() {
        return "oa.car";
    }

    @Override
    public String labelKey() {
        return "oa.ai.report.car";
    }

    @Override
    public String permission() {
        return "oa:car:list";
    }

    /** typeSummary 按数据权限过滤，不要求全部数据；报告中会注明「按数据权限统计」 */
    @Override
    public boolean requiresAllData() {
        return false;
    }

    /** 板块顺序：已有来源为 10（销售）～ 70（人事） */
    @Override
    public int order() {
        return 80;
    }

    @Override
    public CarSnapshot snapshot(AiReportPeriod period) {
        List<CarTypeSummaryRow> current = requestService.typeSummary(period.start(), period.end());
        AiReportPeriod prev = period.previous();
        List<CarTypeSummaryRow> previous = requestService.typeSummary(prev.start(), prev.end());
        long requests = sum(current, CarTypeSummaryRow::getRequestCount);
        long prevRequests = sum(previous, CarTypeSummaryRow::getRequestCount);
        long passengers = sum(current, CarTypeSummaryRow::getPassengerCount);
        Map<String, String> types = dictLookup.options("oa_car_type");
        List<TypeCount> byType = current.stream()
                .sorted(Comparator.comparing(CarTypeSummaryRow::getRequestCount).reversed())
                .limit(TOP)
                .map(r -> new TypeCount(r.getCarType() == null ? null : types.getOrDefault(r.getCarType(), r.getCarType()),
                        r.getRequestCount(), AiReportMetrics.percent(r.getRequestCount(), requests)))
                .toList();
        return new CarSnapshot(requests, prevRequests, AiReportMetrics.growth(requests, prevRequests),
                passengers, sum(previous, CarTypeSummaryRow::getPassengerCount), byType);
    }

    private static long sum(List<CarTypeSummaryRow> rows, java.util.function.Function<CarTypeSummaryRow, Long> f) {
        return rows.stream().map(f).filter(java.util.Objects::nonNull).mapToLong(Long::longValue).sum();
    }

    /**
     * @param requestChangePct 申请数比上期的变化（%），上期为 0 时为 null
     * @param byType           按用车类型的前 5 名，sharePct 为占本期申请数的比例（%）
     */
    public record CarSnapshot(long requests, long previousRequests, BigDecimal requestChangePct,
                              long passengers, long previousPassengers, List<TypeCount> byType) {
    }

    public record TypeCount(String carType, long requests, BigDecimal sharePct) {
    }
}
```

`oa.properties` 中加 `oa.ai.report.car=用车`（英文 `Car usage`），它是报告中该板块的标题。

要点：

- **`requiresAllData()`**：底层查询按数据权限过滤（如上例）时返回 false，没有「全部数据」权限的用户也能生成，快照标记为 `LIMITED`，报告中注明非全公司口径；底层查询不按数据权限过滤、汇总全公司数据（财务报表、库存、人事等）时必须返回 true，只有「全部数据」权限的用户才会包含这个板块——否则等于把全公司数据开放给了只有部分数据权限的人；
- `permission()` 与对应页面的查看权限一致，没有权限的用户生成的报告不含这个板块；
- `snapshot` 抛出的异常只影响本板块（写入 `error`），不影响整份报告；
- 定时生成的报告以系统身份（全部权限、全部数据）收集，所有来源都会包含；
- 不要在快照中放个人薪资、证件号等敏感信息，报告快照会保存在 `ai_report.snapshot` 中，并在报告详情中可以查看。

### 在已有来源中加字段

在来源的快照 record 中加字段即可，例如在 `HrWorkforceReportSource.WorkforceSnapshot` 中加一个当前试用期人数的占比 `probationPct`（用 `AiReportMetrics.percent` 算好）。快照 record 的字段直接序列化为 JSON 交给模型，提示词不需要修改；新字段的含义不明显时在 record 的 Javadoc 中写清楚，并让字段名自解释（单位、口径），模型按字段名理解。

### 验证

在「智能报告」中点「生成报告」，确认弹窗中「将包含的数据来源」出现新的板块（来自 `GET /ai/report/sources`），生成后在报告详情的「数据快照」中核对数字，正文中引用的数字应与快照一致；用数据权限为「本部门」的账号生成，确认该板块注明按数据权限统计。

## 检查清单

| 检查项 | 说明 |
| --- | --- |
| 模块依赖 | `build.gradle` 中没有引用 `lemon-ai`；只 import `com.lemon.erp.framework.ai` |
| 标识 | 格式正确、全局唯一，启动日志中没有 `Invalid AI capability key` / `Duplicate AI capability key` |
| 权限 | 每个实现都返回了合适的权限；报告来源正确设置了 `requiresAllData()` |
| 数据权限 | 查询都经过本模块 Service，列表类查询方法上有 `@DataPermission` |
| 只读 | 工具、`prefill`、`page`、`snapshot` 中没有写操作；`apply` 调用业务 Service 的修改方法 |
| 敏感字段 | 返回给模型的 record 中没有密码、证件号、手机号、银行账号、个人薪资等 |
| 结果规模 | 列表有行数上限，快照只有汇总值和少量排行 |
| 国际化 | 名称、说明、参数说明、提示都有中英文，`python3 scripts/check_i18n.py` 通过；前端 `extract.field` 等补充了名称，`npm run i18n:check` 通过 |
| 不调用模型 | 业务模块中没有任何模型调用，也没有 HTTP 请求 |
