---
order: 11
---

# 文件与附件

柠檬ERP 的文件分为两类，分别存放在两个目录，访问方式和安全要求完全不同：

| 类别 | 示例 | 存储目录 | 访问方式 |
| --- | --- | --- | --- |
| 公开文件 | 用户头像 | `lemon.upload.path`（默认 `./uploads`，prod 为 `UPLOAD_PATH`） | `GET /api/files/**` 直接访问，不需要登录 |
| 业务附件 | 合同、简历、原始凭证、物料图纸 | `lemon.upload.attachment-path`（默认 `./attachments`） | 不能直接访问，只能通过附件接口下载，按业务记录的功能权限和数据权限校验 |

两个目录都在本地磁盘，由 `framework/file/FileStorageService` 读写。多实例部署时需要挂载同一个共享存储（NFS 等）。

## 公开文件

`FileStorageService.storeImage(file, dir, maxSize)`：

- 只接受 `png`、`jpg`、`jpeg`、`gif`、`webp`，且 Content-Type 为 `image/*`；
- 按 `{业务目录}/{yyyy}/{MM}/{uuid}.{扩展名}` 保存，返回可直接访问的 URL，如 `/api/files/avatar/2026/10/xxx.png`；
- `WebMvcConfig` 把 `/files/**` 映射到上传根目录，`SecurityConfig` 对 GET `/files/**` 放行。

公开目录中的文件任何人知道地址即可访问，**不要把业务资料保存到公开目录**。

## 业务附件

### 存储与下载

`FileStorageService.storeAttachment(file, maxSize)`：

- 单个文件大小上限取参数「附件大小上限（MB）」（默认 20，最大 100；`spring.servlet.multipart.max-file-size` 为 100MB 兜底）；
- 禁止可执行文件和脚本：`exe`、`bat`、`cmd`、`com`、`msi`、`sh`、`ps1`、`vbs`、`js`、`jar`、`dll`、`scr`、`html`、`htm`、`svg`、`php`、`jsp`，扩展名只能是 0~10 位小写字母数字；
- 按 `{yyyy}/{MM}/{uuid}.{扩展名}` 保存在附件目录，数据库（`sys_attachment`）记录原文件名、大小、存储路径、所属业务类型和业务 ID；
- 解析存储路径时校验不能跳出附件目录。

附件接口（system 模块 `SysAttachmentController`，路径 `/api/system/attachment`）：

| 接口 | 说明 |
| --- | --- |
| `GET ?bizType=&bizId=` | 某条业务记录的附件列表 |
| `POST /batch?bizType=`（请求体为记录 ID 列表） | 多条记录的附件，按记录 ID 分组返回附件信息（不含文件内容），用于列表中的缩略图（如小程序跟进记录的照片）；一次最多 500 条记录。与自定义字段的批量取值一样只校验业务类型的查看权限，下载时仍按记录的数据权限校验 |
| `POST ?bizType=&bizId=`（multipart，字段 `file`） | 上传 |
| `GET /{id}/download` | 下载：以附件形式返回（`Content-Disposition: attachment`），`X-Content-Type-Options: nosniff`，禁止浏览器按内容猜测类型 |
| `DELETE /{id}` | 删除记录和文件 |

这些接口不声明固定的菜单权限，而是按业务类型校验：查看、下载需要业务类型的 `viewPerm`，上传、删除需要 `editPerm`，并且在业务类型的数据权限规则下能读到该业务记录。

### 登记业务记录类型

业务模块实现 `RecordTypeProvider`，登记哪些业务记录可以挂附件、记录变更历史：

```java
@Component
@RequiredArgsConstructor
public class WmsRecordTypes implements RecordTypeProvider {

    private final WmsMaterialMapper materialMapper;

    @Override
    public List<RecordType> recordTypes() {
        return List.of(new RecordType("wms_material", "wms.label.material", "wms:material:list", "wms:material:edit",
                null, materialMapper::selectById));
    }
}
```

`RecordType` 的参数：

| 参数 | 说明 |
| --- | --- |
| `code` | 类型编码，如 `wms_material`，即前端 `AttachmentPanel` / `ChangeLogPanel` 的 `biz-type` |
| `name` | 名称的消息键（登记在本模块的资源包中，输出时 `Messages.get`），如 `wms.label.material` |
| `viewPerm` | 查看附件、变更历史需要的权限，多个用逗号分隔（有其一即可，如内部与供应商门户共用的单据） |
| `editPerm` | 上传、删除附件需要的权限，多个用逗号分隔 |
| `rule` | 业务记录的数据权限规则（`DataPermissionRule`），为 null 不按数据权限过滤 |
| `loader` | 按 ID 读取业务记录，在数据权限规则下执行；返回 null 表示不存在或无权访问 |

登记的业务类型同时用于附件、字段变更历史和 [自定义字段](../guide/custom-field)：三者都由系统模块的 `SysRecordAccessService` 按 `viewPerm` / `editPerm` 和数据权限规则校验访问。

按部门隔离的单据要传入数据权限规则，例如采购合同 `new RecordType("scm_contract", "scm.label.purchaseContract", "scm:contract:list", "scm:contract:edit", ScmConstants.CONTRACT_RULE, contractMapper::selectById)`，这样其他部门的用户即使知道 ID 也无法下载附件。

### 前端

```vue
<AttachmentPanel biz-type="wms_material" :biz-id="material.id" :editable="userStore.hasPerm('wms:material:edit')" />
```

`AttachmentPanel` 的属性：`bizType`（必填）、`bizId`、`editable`（是否显示上传、删除）。上传前按公开配置中的附件大小上限在前端预先校验。

## Excel 导入导出

Excel 的生成和解析都在前端完成（ExcelJS），后端只接收 JSON：

- **导出**：列表页把 `useTable` 返回的 `exportAll` 传给 `TableToolbar` 的 `exporter`，按当前查询条件、当前显示的列分页拉取（每页 500 条，最多 20 页即 1 万行）后生成 Excel；列定义中 `dict: '字典类型'` 导出字典标签，`exportValue: (record) => 值` 自定义；操作列不导出。
- **导入**：前端 `ImportModal` 下载模板、解析文件，把字典标签、名称等转换为值和 ID 后按行提交；后端接收 `ImportRequest<T>`（一次最多 2000 行），调用 `ImportExecutor.run(req, 新增方法, 校验分组)`：在一个事务中逐行做 Bean Validation 并调用业务的新增方法（与手工新增走同一套校验），收集每行的错误，任何一行出错整批回滚，返回出错的行号和原因（最多 200 条）。

```java
@PostMapping("/import")
@PreAuthorize("@ss.hasPerm('wms:material:add')")
@OperLog(title = "物料管理-导入", type = OperType.IMPORT)
public R<ImportResult> importRows(@Valid @RequestBody ImportRequest<WmsMaterial> req) {
    return R.ok(importExecutor.run(req, materialService::create, Create.class));
}
```

## 单据打印

单据打印由后端用 JasperReports 生成 PDF（`modules/system/print`）：页面组装单据并按「系统管理 → 打印模板」的配置调整后提交 `POST /system/print/pdf`，`PrintService` 按上传的 JRXML、套打定位或 `PrintDesigner` 生成的默认版式排版、分页，返回 PDF 在预览窗口中打印或下载。PDF 使用阅读器内置的宋体、不嵌入字库，服务器需要安装中文字体用于排版时测量文字宽度。打印模板的配置、上传的 JRXML、套打底图都按租户保存在 `sys_print_template` 中，不占用文件目录。条码标签仍由前端生成 HTML 后调用浏览器打印。开发方法见 [单据编号与打印](../guide/doc-no-print)。

## 部署注意

- 两个目录都要持久化（容器部署时挂载卷）并纳入备份；
- 附件目录不要放在 Nginx 的静态目录下，也不要配置任何直接访问它的路径；
- Nginx 默认的请求体上限只有 1MB，需要调大 `client_max_body_size`，见 [Nginx 配置](../deploy/nginx)。
