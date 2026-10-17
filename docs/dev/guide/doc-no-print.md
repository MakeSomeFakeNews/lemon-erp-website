---
order: 4
---

# 单据编号与打印

本页介绍新单据如何生成单据编号、如何接入「系统管理 → 编码规则」和「系统管理 → 打印模板」，以及后端用 JasperReports 生成 PDF 的打印机制。示例沿用 [新增一个业务模块](./new-module) 中的用车申请。

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

单据打印由后端用 JasperReports 生成 PDF：页面把单据组装为统一的结构，前端按「系统管理 → 打印模板」中的配置调整后提交给后端，后端排版、分页后返回 PDF，在预览窗口中打印或下载。使用方法见用户手册 [打印模板](/manual/system/print-template)。

### 整体流程

1. 页面调用 `utils/print.js` 的 `printDocs(doc, 标题, 模板标识)`；
2. `toPrintDoc` 把页面组装的单据规范化：表头字段、签字栏转为 `{ key, label, value }`，明细行转为「列标题 → 文本」，所有值转为字符串；
3. 读取当前租户已保存的打印模板（`GET /system/print-template`，首次打印时加载并缓存在前端），`applyTemplate` 按模板隐藏、排序、改名表头字段 / 明细列 / 签字栏，设置列宽和公司名称；`layoutOf` 把模板的纸张设置换算为 `layout`（宽、高、页边距 mm，字号 pt，已按纸张方向换算）；
4. `POST /system/print/pdf`，请求体为 `{ type, title, layout, docs, overlay }`（`PrintRequest`），前端超时 120 秒；
5. 后端 `modules/system/print/PrintService` 校验、规范化后选择版式：上传了 JRXML 的单据按 JRXML，启用了套打的按套打定位，否则由 `PrintDesigner` 按单据结构和纸张生成默认版式；编译、填充、导出 PDF；
6. 前端把返回的 PDF 显示在 `components/print/PrintPreview.vue`（挂在 `App.vue` 中的全局预览窗口，使用浏览器内置的 PDF 阅读器），用户点「打印」或「下载 PDF」。

单据数据始终由页面组装（页面上已有、已按查看权限和数据权限取到的数据），打印接口只负责排版，所以 `POST /system/print/pdf` 不设菜单权限，登录用户都可以调用。打印按钮一般也不单独设权限，有查看权限即可打印。

### printDocs

```js
import { printDocs } from '@/utils/print'

printDocs(doc, '打印任务标题', '模板标识')
```

| 参数 | 说明 |
| --- | --- |
| `docs` | 一张单据对象或数组。多张时合并为一个 PDF，每张单独分页、单独编页码（工资条除外） |
| `title` | 打印任务标题，也是 PDF 的文档标题和下载时的文件名 |
| `type` | 打印模板标识（`PRINT_TYPES` 中的 `key`）。不传时不套用模板，按默认版式（A4 纵向、页边距 10mm、字号 10pt）打印 |

单据对象的结构：

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 单据名称，如「记账凭证」 |
| `no` | string | 单号，显示在标题下方（`No. 单号`） |
| `fields` | `[标签, 值, 是否整行][]` | 表头字段，每行三个，第三项为 `true` 时独占一行 |
| `columns` | `{ title, key?, value?, align?, width? }[]` | 明细列：`key` 取行的字段，或 `value(row, index)` 计算；`align: 'right'` 右对齐；`width` 列宽（mm），一般不在代码中写，由打印模板设置 |
| `rows` | object[] | 明细行 |
| `totals` | object | 合计行 `{ 列 key: 值 }`，按列的 `key` 对应到列上（没有 `key` 的列不能放合计值）；第一列没有值时显示「合计」 |
| `sections` | `{ title, columns, rows }[]` | 主明细之后的其他明细表（如生产任务单的工序），最多 5 个 |
| `signs` | array | 签字栏，元素为名称字符串或 `[名称, 值]`，如 `['审核', ['制单', '张三']]` |
| `note` | string | 备注，显示在明细之后 |
| `slip` | boolean | 条状单据（工资条）：一页连续打印多条，之间用虚线分隔，每条不跨页拆开 |

表头字段、明细列、签字栏的**名称就是它们的标识**：打印模板按名称匹配配置，套打按名称定位，上传的 JRXML 按名称取值（`$P{FIELDS}.get("供应商")`、`$F{物料名称}`）。因此同一张单据中的名称不要重复，也不要随意修改已有单据的名称，否则用户保存过的模板会对应不上。

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
    { title: '部门 / 辅助', key: 'deptName', value: auxText },
    { title: '借方金额', key: 'debit', value: (e) => moneyOrBlank(e.debit), align: 'right' },
    { title: '贷方金额', key: 'credit', value: (e) => moneyOrBlank(e.credit), align: 'right' }
  ],
  rows: d.entries,
  totals: { summary: '合计', deptName: moneyUpper(d.totalDebit), debit: formatMoney(d.totalDebit), credit: formatMoney(d.totalCredit) },
  signs: [['制单', d.createByName], ['审核', d.auditByName], ['记账', d.postByName], '财务主管']
}, `记账凭证 ${d.voucherNo}`, 'fin.voucher')
```

「部门 / 辅助」列同时写了 `key` 和 `value`：明细行的值由 `value` 计算，`key` 只用于让合计行的大写金额对应到这一列。

物料明细的通用列可以用 `materialColumns()`（序号、物料编码、物料名称、规格型号、单位）。

公司名称显示在标题上方，优先级：打印模板通用设置中的公司名称 → SaaS 模式下的租户名称 → 构建时的环境变量 `VITE_COMPANY_NAME` → 「柠檬ERP」；单据模板中关闭「显示公司名称」时不显示。

### 默认版式

没有上传 JRXML、也没有启用套打时，`PrintDesigner` 按单据的结构（有哪些表头字段、明细列、签字栏）和纸张生成 Jasper 设计：

| 位置 | 内容 |
| --- | --- |
| 页眉（每页） | 公司名称、标题、单号、表头字段（每行三个） |
| 列头（每页重复） | 明细列标题，灰底 |
| 明细 | 每行一条，带边框，同一行等高，长文字自动换行 |
| 明细之后 | 合计行、其他明细表（表格组件，跨页时重复列头）、备注，放不下时只把放不下的部分移到下一页 |
| 页脚 | 末页：签字栏 + 页码；其他页：页码（「第 x 页 / 共 y 页」） |

- 列宽：模板中设置了宽度（mm）的列按设置；其余列按内容长度（列名和各行文字中最长的，中文算 2 个字符，最多按 30 个字符计）分配剩余宽度，不窄于列名；固定列宽合计超出纸张时按比例缩小；
- 工资条（`slip`）：所有条目合并为一个报表，每条一个明细区（表头字段每行四个），条目之间用虚线分隔，不跨页拆开；
- 纸张（`PrintLayout`）：宽 50~1000mm、高 50~2000mm，页边距 0~40mm，字号 6~24pt。打印模板中可选 A4、A5、B5、241mm 连续纸一 / 二 / 三等分（241 × 280 / 140 / 93）和自定义尺寸（`printTemplates.js` 的 `PAPERS`）；
- 编译后的报表按设计内容（生成的 JRXML 的 SHA-256）缓存在本机内存中，最多 256 个，同样结构、同样纸张的单据只编译一次。`JasperReport` 不可序列化，所以不经过 `CacheService`，多实例部署时各自编译。

### 字体

`PrintContext` 创建打印专用的 Jasper 环境：

- PDF 中的文字使用 PDF 阅读器内置的宋体（`STSong-Light`，编码 `UniGB-UCS2-H`），**不嵌入字体文件**，PDF 体积小，服务器也不需要提供字库给 PDF；
- 排版时需要测量文字宽度来换行，优先用 Java 逻辑字体 `SansSerif`（会回退到系统中文字体），不能显示中文时找一个能显示中文的系统字体；服务器上没有任何中文字体时按 JVM 默认字体测量（应用启动时日志警告「服务器没有能显示中文的字体……」），中文宽度偏窄，换行可能不准确。**部署的服务器应安装中文字体**（如 `fonts-noto-cjk`），见 [生产环境配置](../deploy/production#中文字体)；
- 宋体、黑体、微软雅黑、仿宋、楷体、PingFang SC、Noto Sans SC、思源黑体等常用字体名都注册为同一套字体，用 Jaspersoft Studio 设计的模板中选了这些字体也能正常输出中文；
- 报表表达式用 JDT（ECJ）编译：`javac` 在 Spring Boot 可执行 jar 中找不到 Jasper 等依赖的类。

### 名称与值：表达式安全

Jasper 报表中的表达式是 Java 代码，在服务器上编译执行。默认版式中要把字段名、列名写进表达式（如 `$P{FIELDS}.get("供应商")`），因此：

- **名称经过过滤才写入表达式**：`PrintService.normalize` 对表头字段、明细列、签字栏、明细表标题的名称调用 `safeName`，只保留文字、数字、空格和少量标点（`_ - / ( ) （ ） . · : ： % # × + 、`），去掉引号、反斜杠、花括号等，最长 40 个字；`PrintDesigner.literal(name)` 再次过滤后才拼成字符串字面量。明细行、合计中的 key 随之替换。过滤后为空或转换为 Java 标识符后重复的名称自动改为「字段1」「列2」或加序号；
- **单据的值只通过参数和数据源传入**：标题、单号、公司名称、备注作为参数，表头字段、签字栏、合计作为 Map 参数，明细行作为 `JRMapCollectionDataSource`，其他明细表作为参数中的列表；值只限制长度（最长 2000 字），不进入表达式；
- 数量限制：一次最多 1000 张单据、合计 20000 行明细，每张单据最多 60 个表头字段 / 明细列 / 签字栏、5 个其他明细表。

修改或扩展 `PrintDesigner` 时遵守同样的规则：表达式中只能出现常量和经 `literal()` 过滤的名称，任何来自单据的值都通过参数或数据源传入，不要拼接到表达式中。

### 上传 JRXML

需要完全自定义版式（加 Logo、改表格样式、特殊布局）时，在打印模板中点「下载默认模板」，后端按当前配置和示例单据生成默认版式的 JRXML（`POST /system/print/jrxml`），用 Jaspersoft Studio 7 修改后点「上传 JRXML」。之后该单据按上传的 JRXML 打印，模板中的字段、列、纸张配置不再生效（公司名称仍然套用）；删除 JRXML 或「恢复默认」后改回按配置生成。

上传时 `PrintService.validateJrxml` 校验：不超过 1MB、能编译通过（需为 Jaspersoft Studio 7 的 JRXML）。JRXML 保存在 `sys_print_template.jrxml`（按租户），列表查询不读取。

JRXML 中的表达式会在服务器上执行，所以 **SaaS 模式下只有平台租户可以上传**（`checkUploadAllowed`），其他租户只能用可视化配置调整版式。单租户模式下有 `sys:printTemplate:edit` 权限即可上传。

JRXML 中可用的参数与字段：

| 名称 | 类型 | 内容 |
| --- | --- | --- |
| `$P{TITLE}`、`$P{NO}`、`$P{COMPANY_NAME}`、`$P{NOTE}` | String | 标题、单号、公司名称、备注 |
| `$P{FIELDS}` | Map | 表头字段：名称 → 文本，如 `$P{FIELDS}.get("供应商")` |
| `$P{SIGNS}` | Map | 签字栏：名称 → 已签的人 |
| `$P{TOTALS}` | Map | 合计：列名 → 文本 |
| `$P{SECTIONS}` | List | 其他明细表：`[{ title, rows }]`，`rows` 为「列名 → 文本」的列表 |
| `$F{列名}` | String | 明细行的字段，字段名为明细列的名称，如 `$F{物料名称}` |

工资条的 JRXML 中，数据源的每一行是一条工资条，字段名为表头字段的名称（如 `$F{实发工资}`）。

名称以单据中的原名称为准（不受模板中改名的影响），经过上面的过滤后作为 key。

### 套打

套打用于在预印的单据纸（如带格式的送货单、凭证纸）上只打印数据：每个字段按绝对位置输出，不打印表格线和标签。在打印模板中打开「套打」开关，点「设计套打位置」：

- 可以上传底图（扫描的空白单据，PNG / JPG，不超过 2MB），只用于在设计器中对位，**不打印**；底图保存在 `sys_print_template.background`（data URL，按租户），通过 `GET/PUT /system/print-template/{key}/background` 读写；
- 左侧列出可放置的内容：基本（标题、单号、公司名称、备注）、表头字段、合计、签字栏，点击后拖到纸张上，可设宽度、字号、对齐；明细列勾选后在明细区内按列定位；
- 明细区设置第一行的位置、行高和每页行数，明细超过每页行数时换页，定位字段在每页重复打印；
- 「整体偏移（校准打印机）」的 X / Y 用于校准打印机的进纸偏差（-50 ~ 50mm），所有定位一起移动。

配置保存在模板的 `overlay` 中，打印时随请求提交（`PrintOverlay`），后端 `PrintDesigner.overlayDesign` 生成页边距为 0 的报表：定位字段放在背景区（每页都打印），明细按行高逐行输出。位置单位为 mm，以纸张左上角为原点；纸张大小、方向和字号取模板设置，页边距不生效。

| 定位 key | 内容 |
| --- | --- |
| 表头字段名称 | 表头字段的值 |
| `$title`、`$no`、`$company`、`$note` | 标题、单号、公司名称、备注 |
| `$total:列名` | 该列的合计 |
| `$sign:名称` | 签字栏的值（已签的人） |

后端校验：最多 80 个定位字段、明细 30 列、每页 100 行，行高 3~50mm，字号 6~36pt，超出纸张的元素不输出。套打不适用于工资条；上传了 JRXML 的单据以 JRXML 为准，套打不生效。

### 登记打印模板：PRINT_TYPES

要让新单据出现在「系统管理 → 打印模板」中、可以配置版式和套打，在 `utils/printTemplates.js` 的 `PRINT_TYPES` 中登记：

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
| `key` | 模板标识，`printDocs` 的第三个参数，建议「模块.单据」（只能包含字母、数字、下划线和点，最长 64 个字符） |
| `module` / `name` | 模板列表中的分组和名称 |
| `fields` | 表头字段名称，**与 doc.fields 中的标签一致** |
| `columns` | 明细列标题，**与 doc.columns 中的 title 一致**；数字列可写 `{ title: '数量', align: 'right' }`（文件内的 `num('数量')`） |
| `signs` | 签字栏名称，**与 doc.signs 中的名称一致** |
| `note` | 是否有备注 |
| `slip` | 是否条状单据 |

`PRINT_TYPES` 有三个用途：模板设计页按它列出可配置的字段、明细列、签字栏；套打设计器按它列出可定位的内容；`sampleDoc` 按它生成示例单据（3 行明细），用于模板设计页的 PDF 预览和「下载默认模板」。

模板按名称匹配：用户可以隐藏、调整顺序、重命名表头字段、明细列和签字栏，设置明细列宽度（mm），设置纸张、方向、页边距、字号、标题，是否显示公司名称和备注。doc 中有而模板中没有的条目（如之后新增的字段）按默认显示在末尾。模板配置的结构见 `printTemplates.js` 文件头的注释，按租户保存在 `sys_print_template.config`（JSON，最长 20000 字符），模板标识 `_common` 为通用设置（公司名称）。

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

在列表的操作列或详情的 `extra` 插槽中加一个「打印」按钮调用即可。

### 新增单据打印的步骤

1. 在页面或详情组件中按上面的结构组装单据，调用 `printDocs(doc, 标题, 模板标识)`；
2. 在 `PRINT_TYPES` 中登记模板标识，`fields`、`columns`、`signs` 的名称与 doc 中完全一致；
3. 在「系统管理 → 打印模板」中选择新单据，确认右侧 PDF 预览正常，再到页面上实际打印一次；
4. 已有单据新增字段时，在 doc 和 `PRINT_TYPES` 中同时加上；用户保存过的模板会把新字段显示在末尾，可以再调整。

后端不需要任何改动：`PrintService` 和 `PrintDesigner` 按单据结构通用处理。

::: tip 演示模式
`POST /system/print/pdf`、`/system/print/jrxml` 只生成文件、不修改数据，已在演示模式的白名单中，见 [搭建演示环境](../deploy/demo)。
:::

### 已登记的模板

| 标识 | 单据 |
| --- | --- |
| `scm.purchaseOrder`、`scm.salesOrder` | 采购订单、销售订单 |
| `scm.purchaseIn`、`scm.purchaseReturn`、`scm.salesOut`、`scm.salesReturn` | 采购入库、采购退货、销售出库、销售退货 |
| `scm.pickList`、`scm.wavePick`、`scm.packingList` | 拣货单、波次拣货单、装箱单 |
| `wms.in`、`wms.out`、`wms.transfer` | 入库单、出库单、调拨单 |
| `fin.voucher` | 记账凭证 |
| `fin.partnerStatement` | 往来对账单（客户 / 供应商共用一个模板） |
| `mes.workOrder` | 生产任务单 |
| `hr.payslip` | 工资条（条状） |

### 相关接口

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| `POST /system/print/pdf` | 登录即可 | 生成 PDF（`Content-Disposition: inline`） |
| `POST /system/print/jrxml` | `sys:printTemplate:edit` | 按请求中的单据和配置生成默认版式的 JRXML |
| `GET /system/print-template` | 登录即可 | 全部已修改的模板（上传了 JRXML 的带 `jrxml: true`） |
| `PUT` / `DELETE /system/print-template/{key}` | `sys:printTemplate:edit` | 保存配置 / 恢复默认（同时删除 JRXML 和底图） |
| `GET` / `POST` / `DELETE /system/print-template/{key}/jrxml` | `sys:printTemplate:edit` | 下载 / 上传 / 删除 JRXML |
| `GET` / `PUT /system/print-template/{key}/background` | `sys:printTemplate:list` / `edit` | 读取 / 保存套打底图 |

## 条码与标签

物料、库位、箱号的条码标签不经过 JasperReports，仍由前端生成：`utils/labels.js` 用 `jsbarcode` 生成 CODE128 条码、`qrcode` 生成二维码，拼成 HTML 后通过 `utils/print.js` 的 `printHtml(html)` 放入隐藏的 iframe 调用浏览器打印。标签类型登记在 `LABEL_TYPES` 中（模板标识以 `label.` 开头），尺寸、条码类型、显示的字段同样在「打印模板」中维护；相关组件为 `components/label/LabelPrintModal.vue`、`LabelTemplateEditor.vue`。移动作业页面扫码时按标签中的条码内容（物料条码或编码、库位编码、箱号）识别。
