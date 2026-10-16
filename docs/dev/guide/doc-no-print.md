---
order: 4
---

# 单据编号与打印

本页介绍新单据如何生成单据编号、如何接入「系统管理 → 编码规则」和「系统管理 → 打印模板」。示例沿用 [新增一个业务模块](./new-module) 中的用车申请。

## 单据编号

### 取号：DocNoService

所有模块的单据编号都由仓库模块的 `com.lemon.erp.modules.wms.service.DocNoService` 生成（因此需要取号的模块要依赖 `lemon-wms`）：

```java
@Transactional
public Long create(CarRequestForm form) {
    OaCarRequest request = new OaCarRequest();
    request.setRequestNo(docNoService.next(OaCarRequestService.DOC_NO));   // 如 YC202610160001
    ...
}
```

`next(规则标识)` 的处理：

1. 按规则标识取当前租户的编码规则（「编码规则」页面修改过的规则），没有修改过时取 `DocNoCatalog` 中声明的默认规则，未声明的标识按「标识 + yyyyMMdd + 4 位当天流水」处理；
2. 按「规则 + 日期周期」得到流水键，在流水表中条件更新加 1，第一次使用时插入（并发插入冲突时重试加 1）；
3. 按规则格式化为编号。

`next` 声明为 `@Transactional(propagation = Propagation.MANDATORY)`，**必须在事务中调用**：流水行被锁到事务结束，单据保存失败时流水号一并回滚，不会跳号；并发取号也不会重复。所有模块共用同一张流水表，规则标识各不相同。

### 声明：DocNoCatalog

每个模块在 `service/<模块>DocNos` 中把自己的单据编号类型声明为 `DocNoCatalog` Bean，「编码规则」页面据此按模块分组列出可配置的单据（`@Order` 决定模块在页面中的顺序）：

```java
@Configuration
public class ScmDocNos {

    /** 供应商、客户编码规则标识：新增时编码留空则自动生成 */
    public static final String SUPPLIER = "GYS";
    public static final String CUSTOMER = "KH";

    @Bean
    @Order(1)
    public DocNoCatalog scmDocNoCatalog() {
        List<DocNoCatalog.Type> types = new ArrayList<>();
        types.add(doc("QG", "请购单"));
        types.add(doc("XJ", "询价单"));
        types.add(doc(ScmTenderService.DOC_NO, "招标"));
        // ...
        types.add(master(SUPPLIER, "供应商编码"));
        types.add(master(CUSTOMER, "客户编码"));
        return new DocNoCatalog("供应链管理", types);
    }
}
```

| 工厂方法 | 默认格式 | 适用 |
| --- | --- | --- |
| `Type.doc(key, name)` | 前缀 + `yyyyMMdd` + 4 位流水，每天重置 | 单据 |
| `Type.master(key, name)` | 前缀 + 6 位流水，不重置 | 主数据（物料、供应商、客户）：新增时编码留空则自动生成 |
| `new Type(key, name, dateFormat, seqLength, resetCycle)` | 自定义 | 其他 |

`key` 既是规则标识，也是默认前缀，与 `docNoService.next(key)` 的参数一致，建议定义为常量。已使用的模块顺序：scm 1、wms 2、mes 3 和 4、fin 5、crm 6、hr 7，新模块取更大的值。

页面上可以修改：前缀、日期格式（`yyyyMMdd`、`yyMMdd`、`yyyyMM`、`yyMM`、`yyyy`、不含日期）、流水位数、重置周期（每天、每月、每年、不重置）。校验规则：日期部分至少要精确到重置周期（如按天重置时日期不能只到月，否则编号会重复）、前缀不能与其他单据重复。修改只影响之后的新编号；编码规则按租户保存。

## 单据打印

打印在前端完成：`utils/print.js` 把单据渲染为 A4 打印页面，放入隐藏的 iframe 后调用浏览器打印（可另存为 PDF），不需要后端接口。

### printDocs

```js
import { printDocs } from '@/utils/print'

printDocs(doc, '打印任务标题', '模板标识')
```

| 参数 | 说明 |
| --- | --- |
| `docs` | 一张单据对象或数组（多张时每张一页） |
| `title` | 打印任务标题，也是另存为 PDF 时的默认文件名 |
| `type` | 打印模板标识（`PRINT_TYPES` 中的 `key`），不传则按默认版式打印 |

单据对象的结构：

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 单据名称，如「记账凭证」 |
| `no` | string | 单号 |
| `fields` | `[标签, 值, 是否整行][]` | 表头字段，每行三列 |
| `columns` | `{ title, key?, value?, align?, width? }[]` | 明细列：`key` 取行的字段，或 `value(row, index)` 计算；`align: 'right'` 右对齐 |
| `rows` | object[] | 明细行 |
| `totals` | object | 合计行 `{ 列 key: 值 }`，第一列显示「合计」 |
| `sections` | `{ title, columns, rows }[]` | 主表之后的其他明细表 |
| `signs` | array | 签字栏，元素为名称字符串或 `[名称, 值]`，如 `['审核', ['制单', '张三']]` |
| `note` | string | 备注 |
| `slip` | boolean | 条状单据（如工资条）：不单独占一页，之间用虚线分隔 |

真实示例（`components/fin/VoucherDetail.vue`）：

```js
printDocs({
  title: '记账凭证',
  no: d.voucherNo,
  fields: [
    ['日期', d.voucherDate],
    ['期间', periodText(d.period)],
    ['附单据', `${d.attachmentCount ?? 0} 张`]
  ],
  columns: [
    { title: '摘要', key: 'summary' },
    { title: '会计科目', value: (e) => `${e.accountCode} ${e.accountName}` },
    { title: '部门 / 辅助', value: (e) => [e.deptName, e.projectName, e.partnerName].filter(Boolean).join(' / ') },
    { title: '借方金额', key: 'debit', value: (e) => moneyOrBlank(e.debit), align: 'right' },
    { title: '贷方金额', key: 'credit', value: (e) => moneyOrBlank(e.credit), align: 'right' }
  ],
  rows: d.entries,
  totals: { summary: '合计', deptName: moneyUpper(d.totalDebit), debit: formatMoney(d.totalDebit), credit: formatMoney(d.totalCredit) },
  signs: [['制单', d.createByName], ['审核', d.auditByName], ['记账', d.postByName], '财务主管']
}, `记账凭证 ${d.voucherNo}`, 'fin.voucher')
```

物料明细的通用列可以用 `materialColumns()`（序号、物料编码、物料名称、规格型号、单位）。

公司名称显示在标题上方，优先级：打印模板通用设置中的公司名称 → SaaS 模式下的租户名称 → 构建时的环境变量 `VITE_COMPANY_NAME` → 「柠檬ERP」。

### 登记打印模板：PRINT_TYPES

要让新单据出现在「系统管理 → 打印模板」中、可以配置版式，在 `utils/printTemplates.js` 的 `PRINT_TYPES` 中登记：

```js
export const PRINT_TYPES = [
  // ...
  {
    key: 'oa.carRequest',
    module: '行政',
    name: '用车申请单',
    fields: ['用车日期', '目的地', '乘车人数', '申请人', '状态', '事由'],
    signs: ['申请人', '部门主管', '行政'],
    note: true
  }
]
```

| 属性 | 说明 |
| --- | --- |
| `key` | 模板标识，`printDocs` 的第三个参数，建议「模块.单据」 |
| `module` / `name` | 模板列表中的分组和名称 |
| `fields` | 表头字段名称，**与 doc.fields 中的标签一致** |
| `columns` | 明细列标题，**与 doc.columns 中的 title 一致**；数字列可写 `{ title: '数量', align: 'right' }` |
| `signs` | 签字栏名称，**与 doc.signs 中的名称一致** |
| `note` | 是否有备注 |
| `slip` | 是否条状单据 |

模板按名称匹配：用户在模板中可以隐藏、调整顺序、重命名表头字段、明细列和签字栏，设置明细列宽度（毫米）、纸张方向、标题，是否显示公司名称和备注。doc 中有而模板中没有的条目（如之后新增的字段）按默认显示在末尾。模板设计页的预览使用按 `PRINT_TYPES` 生成的示例数据。

### 示例：打印用车申请

```js
import { printDocs } from '@/utils/print'
import { findDict } from '@/utils/dict'

const dict = useDict('oa_car_status')

function print(r) {
  printDocs({
    title: '用车申请单',
    no: r.requestNo,
    fields: [
      ['用车日期', r.useDate],
      ['目的地', r.destination],
      ['乘车人数', r.passengers],
      ['申请人', r.createByName],
      ['状态', findDict(dict.oa_car_status, r.status)?.label],
      ['事由', r.purpose, true]
    ],
    signs: [['申请人', r.createByName], '部门主管', '行政'],
    note: r.remark
  }, `用车申请单 ${r.requestNo}`, 'oa.carRequest')
}
```

在列表的操作列或详情的 `extra` 插槽中加一个「打印」按钮调用即可。打印按钮一般不单独设权限，有查看权限即可打印。

### 已登记的模板

| 标识 | 单据 |
| --- | --- |
| `scm.purchaseOrder`、`scm.salesOrder` | 采购订单、销售订单 |
| `scm.purchaseIn`、`scm.purchaseReturn`、`scm.salesOut`、`scm.salesReturn` | 采购入库、采购退货、销售出库、销售退货 |
| `scm.pickList`、`scm.wavePick`、`scm.packingList` | 拣货单、波次拣货单、装箱单 |
| `wms.in`、`wms.out`、`wms.transfer` | 入库单、出库单、调拨单 |
| `fin.voucher` | 记账凭证 |
| `mes.workOrder` | 生产任务单 |
| `hr.payslip` | 工资条（条状） |

## 条码与标签

物料、库位、箱号的条码标签由 `utils/labels.js` 生成（`jsbarcode` 生成 CODE128 条码、`qrcode` 生成二维码），通过 `printHtml(html)` 打印（与单据打印共用隐藏 iframe 的实现）。标签类型登记在 `LABEL_TYPES` 中（模板标识以 `label.` 开头），尺寸、条码类型、显示的字段同样在「打印模板」中维护；相关组件为 `components/label/LabelPrintModal.vue`、`LabelTemplateEditor.vue`。移动作业页面扫码时按标签中的条码内容（物料条码或编码、库位编码、箱号）识别。
