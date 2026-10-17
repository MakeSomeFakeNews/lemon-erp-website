---
order: 3
---

# 新增一个业务模块

本页以新增「行政办公」模块（`lemon-oa`）中的「用车申请」为例，演示从 Gradle 模块到前端页面、菜单的完整步骤。后续的 [单据编号与打印](./doc-no-print)、[接入审批流](./approval) 会在这个示例上继续扩展。

示例的需求：员工填写用车申请（用车日期、目的地、事由、乘车人数），保存为草稿，草稿可以修改、删除；申请按制单人部门做数据权限；单号自动生成。

::: tip 只是新增一个页面时
如果只是在已有模块中新增功能，跳过第 1 步，直接在对应模块中新增类和 mapper XML 即可。
:::

## 1. 创建 Gradle 模块

新建目录 `lemon-modules/lemon-oa`，创建 `build.gradle`：

```groovy
plugins {
    id 'lemon.java-conventions'
}

description = '行政办公：用车申请'

dependencies {
    api project(':lemon-framework')
    // 单据编号服务 DocNoService 在仓库模块中
    api project(':lemon-modules:lemon-wms')
}
```

- 约定插件 `lemon.java-conventions` 已包含 Java 17、Spring Boot BOM、Lombok、`-parameters`、UTF-8 编码，不需要再写；
- 只依赖真正用到的模块，并确认不会形成依赖环（见 [模块划分与依赖规则](../architecture/modules)）。本例需要取单据号，因此依赖 wms；
- 需要第三方库时，先在 `gradle/libs.versions.toml` 中登记版本，再用 `libs.xxx` 引用。

在根目录 `settings.gradle` 的模块清单中登记：

```groovy
[
    'system',
    // ...
    'bi',
    'oa',         // 行政办公
].each { include "lemon-modules:lemon-${it}" }
```

在 `lemon-admin/build.gradle` 中加入依赖，打包时才会包含新模块：

```groovy
dependencies {
    // ...
    implementation project(':lemon-modules:lemon-bi')
    implementation project(':lemon-modules:lemon-oa')
}
```

模块目录结构：

```
lemon-modules/lemon-oa
├── build.gradle
└── src/main
    ├── java/com/lemon/erp/modules/oa
    │   ├── controller/OaCarRequestController.java
    │   ├── dto/CarRequestForm.java
    │   ├── entity/OaCarRequest.java
    │   ├── mapper/OaCarRequestMapper.java
    │   ├── model/CarRequestStatus.java
    │   └── service/OaCarRequestService.java、OaDocNos.java
    └── resources
        ├── mapper/oa/OaCarRequestMapper.xml
        └── i18n/oa.properties、oa_en.properties   # 消息资源包：中文（默认）、英文
```

前端对应新增：

```
lemon-web/src
├── api/oa/car.js
├── views/oa/car/index.vue
└── locales
    ├── zh-CN/oa.js        # 页面文字（中文）
    └── en-US/oa.js、以及 menu.js / dict.js 中的菜单和字典译文
```

包名必须是 `com.lemon.erp.modules.<模块>`：启动类在 `com.lemon.erp` 包，组件扫描自动覆盖；Mapper 由 `@MapperScan("com.lemon.erp.modules.*.mapper")` 扫描；mapper XML 由 `classpath*:mapper/**/*.xml` 加载；资源包由 `Messages` 扫描 `classpath*:i18n/*.properties` 自动注册，不需要额外配置。

## 1.1 消息资源包

返回前端的提示（业务异常、校验信息、登记给框架的名称）都写成消息键，登记在本模块的两个资源包中，文件为 UTF-8，键为 `oa.<分类>.<名称>`：

```properties
# lemon-modules/lemon-oa/src/main/resources/i18n/oa.properties（默认，简体中文）
# 分类：error 业务异常、valid 校验、text 返回前端的文字、label 名称；参数写作 {0}，单引号写成两个
oa.label.oa=行政办公
oa.label.carRequest=用车申请
oa.label.modify=修改
oa.label.delete=删除
oa.error.carRequestNotFound=用车申请不存在或没有权限
oa.error.carRequestStatusCannot=用车申请当前状态不能{0}
oa.valid.useDateRequired=用车日期不能为空
oa.valid.destinationRequired=目的地不能为空
oa.valid.destinationTooLong=目的地不能超过100个字符
oa.valid.purposeTooLong=事由不能超过255个字符
oa.valid.passengersRequired=乘车人数不能为空
oa.valid.passengersMin=乘车人数至少为1
oa.valid.passengersMax=乘车人数不能超过60
oa.valid.remarkTooLong=备注不能超过255个字符
```

```properties
# oa_en.properties（英文，键和 {0} 占位符与中文一致）
oa.label.oa=Office
oa.label.carRequest=Car Request
oa.label.modify=modify
oa.label.delete=delete
oa.error.carRequestNotFound=Car request does not exist or access denied
oa.error.carRequestStatusCannot=Cannot {0} the car request in its current status
oa.valid.useDateRequired=Use date is required
oa.valid.destinationRequired=Destination is required
oa.valid.destinationTooLong=Destination cannot exceed 100 characters
oa.valid.purposeTooLong=Purpose cannot exceed 255 characters
oa.valid.passengersRequired=Number of passengers is required
oa.valid.passengersMin=Number of passengers must be at least 1
oa.valid.passengersMax=Number of passengers cannot exceed 60
oa.valid.remarkTooLong=Remark cannot exceed 255 characters
```

规则详见 [国际化](./i18n#资源包)。

## 2. 建表与字典

在 `sql/init.sql` 中新增建表语句（文件开头的 `DROP TABLE IF EXISTS` 列表中也加上 `oa_car_request`）：

```sql
CREATE TABLE oa_car_request (
    id               BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
    tenant_id        BIGINT       NOT NULL DEFAULT 1 COMMENT '租户ID',
    request_no       VARCHAR(32)  NOT NULL COMMENT '申请单号',
    use_date         DATE         NOT NULL COMMENT '用车日期',
    destination      VARCHAR(100) NOT NULL COMMENT '目的地',
    purpose          VARCHAR(255)          DEFAULT NULL COMMENT '事由',
    passengers       INT          NOT NULL DEFAULT 1 COMMENT '乘车人数',
    status           VARCHAR(16)  NOT NULL DEFAULT 'DRAFT' COMMENT '状态(字典 oa_car_status) DRAFT草稿 APPROVING审批中 APPROVED已批准',
    dept_id          BIGINT                DEFAULT NULL COMMENT '制单人部门',
    create_by        BIGINT                DEFAULT NULL COMMENT '制单人',
    flow_instance_id VARCHAR(64)           DEFAULT NULL COMMENT '审批流程实例ID',
    remark           VARCHAR(255)          DEFAULT NULL COMMENT '备注',
    create_time      DATETIME              DEFAULT NULL COMMENT '创建时间',
    update_time      DATETIME              DEFAULT NULL COMMENT '更新时间',
    PRIMARY KEY (id),
    UNIQUE KEY uk_car_request_no (request_no, tenant_id),
    KEY idx_car_request_dept (dept_id),
    KEY idx_car_request_create_by (create_by)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '用车申请';
```

建表约定：

- 主键 `id BIGINT AUTO_INCREMENT`，带 `create_time`、`update_time`（由 MyBatis-Plus 自动填充）；
- 业务表都加 `tenant_id BIGINT NOT NULL DEFAULT 1`，唯一约束末尾加 `tenant_id`；
- 需要数据权限的表加 `dept_id`、`create_by`（或负责人列）并建索引；
- 状态等枚举列为 `VARCHAR`，存枚举名称，注释中写明字典类型和取值；
- 每列写 `COMMENT`，SQL 保持 MySQL 8 可执行。

字典：

```sql
INSERT INTO sys_dict_type (name, type, status, remark, create_time, update_time) VALUES
('用车申请状态', 'oa_car_status', 1, '用车申请的状态', NOW(), NOW());
INSERT INTO sys_dict_data (dict_type, dict_label, dict_value, tag_color, sort, status, create_time, update_time) VALUES
('oa_car_status', '草稿', 'DRAFT', 'default', 1, 1, NOW(), NOW()),
('oa_car_status', '审批中', 'APPROVING', 'processing', 2, 1, NOW(), NOW()),
('oa_car_status', '已批准', 'APPROVED', 'green', 3, 1, NOW(), NOW());
```

字典标签在数据库中保存中文，英文译文加到前端 `lemon-web/src/locales/en-US/dict.js`：

```js
  // 用车申请状态
  oa_car_status: {
    DRAFT: 'Draft', // 草稿
    APPROVING: 'In Approval', // 审批中
    APPROVED: 'Approved' // 已批准
  },
```

::: warning 已有数据库
`init.sql` 会删除并重建全部表，不能在已有数据的库上重新执行。已有环境把上面的建表、字典、菜单语句另存为增量脚本单独执行，写法要可重复执行（如 `CREATE TABLE IF NOT EXISTS`、`INSERT ... WHERE NOT EXISTS`），菜单等数据按编码、权限标识关联，不依赖自增 ID。
:::

## 3. 枚举与实体

```java
package com.lemon.erp.modules.oa.model;

/**
 * 用车申请状态，与字典 oa_car_status 对应
 */
public enum CarRequestStatus {
    DRAFT,
    APPROVING,
    APPROVED
}
```

```java
package com.lemon.erp.modules.oa.entity;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.lemon.erp.common.base.BaseEntity;
import com.lemon.erp.modules.oa.model.CarRequestStatus;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.time.LocalDate;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("oa_car_request")
public class OaCarRequest extends BaseEntity {

    private String requestNo;

    private LocalDate useDate;

    private String destination;

    /** 可以清空的字段：更新时 null 也写入（默认策略会跳过 null） */
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String purpose;

    private Integer passengers;

    private CarRequestStatus status;

    private Long deptId;

    private Long createBy;

    private String flowInstanceId;

    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String remark;

    /** 制单人姓名，列表查询时关联用户表带出 */
    @TableField(exist = false)
    private String createByName;
}
```

- 继承 `BaseEntity` 获得 `id`、`createTime`、`updateTime`（插入、更新时自动填充，JSON 只读）；
- 实体中**不需要** `tenantId` 字段，由多租户拦截器自动处理；
- 状态字段直接用枚举类型，MyBatis 按名称存储；
- 非表字段加 `@TableField(exist = false)`；
- MyBatis-Plus 的 `updateById` 默认跳过值为 null 的字段，允许用户清空的可选字段加 `@TableField(updateStrategy = FieldStrategy.ALWAYS)`。

请求体用 record，校验信息写消息键 `{键}`（由 Bean Validation 按请求语言插值）：

```java
package com.lemon.erp.modules.oa.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;

public record CarRequestForm(
        @NotNull(message = "{oa.valid.useDateRequired}") LocalDate useDate,
        @NotBlank(message = "{oa.valid.destinationRequired}") @Size(max = 100, message = "{oa.valid.destinationTooLong}") String destination,
        @Size(max = 255, message = "{oa.valid.purposeTooLong}") String purpose,
        @NotNull(message = "{oa.valid.passengersRequired}") @Min(value = 1, message = "{oa.valid.passengersMin}") @Max(value = 60, message = "{oa.valid.passengersMax}") Integer passengers,
        @Size(max = 255, message = "{oa.valid.remarkTooLong}") String remark) {
}
```

## 4. Mapper 与 mapper XML

```java
package com.lemon.erp.modules.oa.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.lemon.erp.modules.oa.entity.OaCarRequest;
import com.lemon.erp.modules.oa.model.CarRequestStatus;
import org.apache.ibatis.annotations.Param;

public interface OaCarRequestMapper extends BaseMapper<OaCarRequest> {

    IPage<OaCarRequest> selectPageList(IPage<OaCarRequest> page, @Param("status") CarRequestStatus status,
                                       @Param("keyword") String keyword);

    /** 状态流转：只有当前状态为 from 时才更新，返回更新行数 */
    int transit(@Param("id") Long id, @Param("from") CarRequestStatus from, @Param("to") CarRequestStatus to);
}
```

`src/main/resources/mapper/oa/OaCarRequestMapper.xml`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "https://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.lemon.erp.modules.oa.mapper.OaCarRequestMapper">

    <select id="selectPageList" resultType="com.lemon.erp.modules.oa.entity.OaCarRequest">
        SELECT r.id, r.request_no, r.use_date, r.destination, r.purpose, r.passengers, r.status,
               r.dept_id, r.create_by, r.create_time, u.nickname AS create_by_name
        FROM oa_car_request r
        LEFT JOIN sys_user u ON u.id = r.create_by
        <where>
            <if test="status != null">r.status = #{status}</if>
            <if test="keyword != null and keyword != ''">
                AND (r.request_no LIKE CONCAT('%', #{keyword}, '%') OR r.destination LIKE CONCAT('%', #{keyword}, '%'))
            </if>
        </where>
        ORDER BY r.id DESC
    </select>

    <update id="transit">
        UPDATE oa_car_request SET status = #{to}, update_time = NOW() WHERE id = #{id} AND status = #{from}
    </update>

</mapper>
```

- 第一个参数为 `IPage` 时，MyBatis-Plus 自动分页并执行 count；
- 关联查询用 JOIN 一次查出制单人姓名，避免 N+1；
- 开启 SaaS 时两张表都会自动追加租户条件，不需要在 XML 中写 `tenant_id`；
- 开启了 `map-underscore-to-camel-case`，`create_by_name` 自动映射到 `createByName`。

## 5. Service

```java
package com.lemon.erp.modules.oa.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.lemon.erp.common.exception.BizException;
import com.lemon.erp.common.i18n.Messages;
import com.lemon.erp.common.result.PageResult;
import com.lemon.erp.framework.security.LoginUser;
import com.lemon.erp.framework.security.SecurityUtils;
import com.lemon.erp.framework.security.datascope.DataPermission;
import com.lemon.erp.framework.security.datascope.DataPermissionContext;
import com.lemon.erp.framework.security.datascope.DataPermissionRule;
import com.lemon.erp.modules.oa.dto.CarRequestForm;
import com.lemon.erp.modules.oa.entity.OaCarRequest;
import com.lemon.erp.modules.oa.mapper.OaCarRequestMapper;
import com.lemon.erp.modules.oa.model.CarRequestStatus;
import com.lemon.erp.modules.wms.service.DocNoService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.function.Supplier;

/**
 * 用车申请：草稿 → （提交审批）→ 已批准
 */
@Service
@RequiredArgsConstructor
public class OaCarRequestService {

    /** 单据编号的规则标识（默认前缀），在 OaDocNos 中声明 */
    public static final String DOC_NO = "YC";
    /** 数据权限：按制单人部门、制单人 */
    public static final DataPermissionRule RULE = new DataPermissionRule("oa_car_request", "dept_id", "create_by");

    private final OaCarRequestMapper requestMapper;
    private final DocNoService docNoService;

    @DataPermission(table = "oa_car_request", deptColumn = "dept_id", userColumn = "create_by")
    public PageResult<OaCarRequest> page(long current, long size, CarRequestStatus status, String keyword) {
        Page<OaCarRequest> page = Page.of(current, size);
        requestMapper.selectPageList(page, status, keyword);
        return PageResult.of(page);
    }

    public OaCarRequest detail(Long id) {
        return getAccessible(id);
    }

    @Transactional
    public Long create(CarRequestForm form) {
        LoginUser user = SecurityUtils.getLoginUser();
        OaCarRequest request = new OaCarRequest();
        request.setRequestNo(docNoService.next(DOC_NO));
        apply(request, form);
        request.setStatus(CarRequestStatus.DRAFT);
        request.setDeptId(user.deptId());
        request.setCreateBy(user.userId());
        requestMapper.insert(request);
        return request.getId();
    }

    @Transactional
    public void update(Long id, CarRequestForm form) {
        OaCarRequest request = requireStatus(id, CarRequestStatus.DRAFT, "oa.label.modify");
        apply(request, form);
        requestMapper.updateById(request);
    }

    @Transactional
    public void delete(Long id) {
        requireStatus(id, CarRequestStatus.DRAFT, "oa.label.delete");
        requestMapper.deleteById(id);
    }

    // ---------------------------------------------------------------- 内部

    private static void apply(OaCarRequest request, CarRequestForm form) {
        request.setUseDate(form.useDate());
        request.setDestination(form.destination().trim());
        request.setPurpose(form.purpose());
        request.setPassengers(form.passengers());
        request.setRemark(form.remark());
    }

    /** 按 ID 读取，并校验当前用户的数据权限 */
    OaCarRequest getAccessible(Long id) {
        Supplier<OaCarRequest> loader = () -> requestMapper.selectById(id);
        OaCarRequest request = SecurityUtils.getDataScope().all() ? loader.get() : DataPermissionContext.execute(RULE, loader);
        if (request == null) {
            throw new BizException("oa.error.carRequestNotFound");
        }
        return request;
    }

    /** @param action 动作名称的消息键，填入提示的 {0} */
    OaCarRequest requireStatus(Long id, CarRequestStatus status, String action) {
        OaCarRequest request = getAccessible(id);
        if (request.getStatus() != status) {
            throw new BizException("oa.error.carRequestStatusCannot", Messages.get(action));
        }
        return request;
    }
}
```

要点：

- 列表方法加 `@DataPermission`；详情、修改、删除先用 `getAccessible` 校验数据权限，防止通过构造 ID 越权；
- 写方法加 `@Transactional`；`docNoService.next` 必须在事务中调用；
- 新增时写入 `dept_id`、`create_by`；
- 状态比较用枚举 `!=`，不写字符串字面量；
- 提示一律用消息键，不拼接中文；参数本身需要翻译时先 `Messages.get` 再传入。

## 6. Controller

```java
package com.lemon.erp.modules.oa.controller;

import com.lemon.erp.common.result.PageResult;
import com.lemon.erp.common.result.R;
import com.lemon.erp.framework.log.OperLog;
import com.lemon.erp.framework.log.OperType;
import com.lemon.erp.modules.oa.dto.CarRequestForm;
import com.lemon.erp.modules.oa.entity.OaCarRequest;
import com.lemon.erp.modules.oa.model.CarRequestStatus;
import com.lemon.erp.modules.oa.service.OaCarRequestService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 用车申请
 */
@RestController
@RequestMapping("/oa/car")
@RequiredArgsConstructor
public class OaCarRequestController {

    private final OaCarRequestService requestService;

    @GetMapping
    @PreAuthorize("@ss.hasPerm('oa:car:list')")
    public R<PageResult<OaCarRequest>> page(@RequestParam(defaultValue = "1") long current,
                                            @RequestParam(defaultValue = "10") long size,
                                            @RequestParam(required = false) CarRequestStatus status,
                                            @RequestParam(required = false) String keyword) {
        return R.ok(requestService.page(current, size, status, keyword));
    }

    @GetMapping("/{id}")
    @PreAuthorize("@ss.hasPerm('oa:car:list')")
    public R<OaCarRequest> detail(@PathVariable Long id) {
        return R.ok(requestService.detail(id));
    }

    @PostMapping
    @PreAuthorize("@ss.hasPerm('oa:car:add')")
    @OperLog(title = "用车申请", type = OperType.INSERT) // i18n-ignore 操作日志存库，保持中文
    public R<Long> create(@Valid @RequestBody CarRequestForm form) {
        return R.ok(requestService.create(form));
    }

    @PutMapping("/{id}")
    @PreAuthorize("@ss.hasPerm('oa:car:edit')")
    @OperLog(title = "用车申请", type = OperType.UPDATE) // i18n-ignore 操作日志存库，保持中文
    public R<Void> update(@PathVariable Long id, @Valid @RequestBody CarRequestForm form) {
        requestService.update(id, form);
        return R.ok();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("@ss.hasPerm('oa:car:remove')")
    @OperLog(title = "用车申请", type = OperType.DELETE) // i18n-ignore 操作日志存库，保持中文
    public R<Void> delete(@PathVariable Long id) {
        requestService.delete(id);
        return R.ok();
    }
}
```

接口路径以模块名开头；每个接口声明权限；增删改加 `@OperLog`（标题存入操作日志，保持中文，行尾写 `// i18n-ignore`）。接口最终地址为 `/api/oa/car`。

## 7. 单据编号声明

在本模块中声明单据编号类型，「系统管理 → 编码规则」页面据此列出可配置的单据：

```java
package com.lemon.erp.modules.oa.service;

import com.lemon.erp.framework.code.DocNoCatalog;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;

import static com.lemon.erp.framework.code.DocNoCatalog.Type.doc;

@Configuration
public class OaDocNos {

    @Bean
    @Order(20)
    public DocNoCatalog oaDocNoCatalog() {
        // 模块名、单据名写消息键，编码规则页面按请求语言显示
        return DocNoCatalog.of("oa.label.oa", doc(OaCarRequestService.DOC_NO, "oa.label.carRequest"));
    }
}
```

默认编号为 `YC` + `yyyyMMdd` + 4 位当天流水，如 `YC202610160001`。详见 [单据编号与打印](./doc-no-print)。

## 8. 前端接口与页面

`lemon-web/src/api/oa/car.js`：

```js
import request from '@/utils/request'

export const pageCarRequest = (params) => request.get('/oa/car', { params })
export const getCarRequest = (id) => request.get(`/oa/car/${id}`)
export const addCarRequest = (data) => request.post('/oa/car', data)
export const updateCarRequest = (id, data) => request.put(`/oa/car/${id}`, data)
export const deleteCarRequest = (id) => request.delete(`/oa/car/${id}`)
```

页面文字放在语言包中，`lemon-web/src/locales/zh-CN/oa.js`：

```js
/** 行政办公（oa.xxx） */
export default {
  car: {
    title: '用车申请',
    detailTitle: '用车申请 {no}',
    keyword: '申请',
    keywordPh: '单号或目的地',
    create: '新增用车申请',
    edit: '编辑用车申请',
    confirmDelete: '确定删除用车申请「{no}」？',
    requestNo: '申请单号',
    useDate: '用车日期',
    destination: '目的地',
    passengers: '乘车人数',
    purpose: '事由',
    applicant: '申请人'
  }
}
```

`lemon-web/src/locales/en-US/oa.js`（键与中文完全一致）：

```js
/** 行政办公（oa.xxx） */
export default {
  car: {
    title: 'Car Request',
    detailTitle: 'Car Request {no}',
    keyword: 'Request',
    keywordPh: 'Request No. or destination',
    create: 'New Car Request',
    edit: 'Edit Car Request',
    confirmDelete: 'Delete car request "{no}"?',
    requestNo: 'Request No.',
    useDate: 'Use Date',
    destination: 'Destination',
    passengers: 'Passengers',
    purpose: 'Purpose',
    applicant: 'Applicant'
  }
}
```

语言包文件放在 `locales/<语言>/` 下即自动加载，文件名 `oa` 就是键的第一段。

`lemon-web/src/views/oa/car/index.vue`（字段少，表单用抽屉）：

```vue
<template>
  <div class="table-page">
    <a-card v-show="showSearch" :bordered="false" class="page-card">
      <SearchForm :model="query" @search="search" @reset="resetQuery">
        <a-form-item :label="$t('oa.car.keyword')" name="keyword">
          <a-input v-model:value="query.keyword" :placeholder="$t('oa.car.keywordPh')" allow-clear />
        </a-form-item>
        <a-form-item :label="$t('common.field.status')" name="status">
          <a-select v-model:value="query.status" :placeholder="$t('common.placeholder.all')" allow-clear :options="toOptions(dict.oa_car_status)" />
        </a-form-item>
      </SearchForm>
    </a-card>

    <a-card :bordered="false" class="page-card table-card">
      <TableToolbar
        :exporter="exportAll"
        v-model:size="size"
        v-model:checked="checked"
        v-model:show-search="showSearch"
        :columns="columns"
        @refresh="load"
      >
        <a-button v-perm="'oa:car:add'" type="primary" @click="drawer.openCreate()">
          <template #icon><PlusOutlined /></template>{{ $t('oa.car.create') }}
        </a-button>
      </TableToolbar>

      <a-table
        row-key="id"
        :size="size"
        :columns="visibleColumns"
        :data-source="list"
        :loading="loading"
        :pagination="pagination"
        :scroll="{ x: 1100, y: '100%' }"
        @change="onTableChange"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <DictTag type="oa_car_status" :value="record.status" />
          </template>
          <template v-else-if="column.key === 'action'">
            <span v-if="record.status === 'DRAFT'" class="table-actions">
              <a-button v-perm="'oa:car:edit'" type="link" size="small" @click="drawer.openEdit(record)">
                <template #icon><EditOutlined /></template>{{ $t('common.action.edit') }}
              </a-button>
              <span v-perm="'oa:car:remove'">
                <a-popconfirm :title="$t('oa.car.confirmDelete', { no: record.requestNo })" @confirm="remove(record.id)">
                  <a-button type="link" danger size="small">
                    <template #icon><DeleteOutlined /></template>{{ $t('common.action.delete') }}
                  </a-button>
                </a-popconfirm>
              </span>
            </span>
          </template>
        </template>
      </a-table>
    </a-card>

    <FormDrawer :drawer="drawer" :create-title="$t('oa.car.create')" :edit-title="$t('oa.car.edit')">
      <a-form ref="formRef" :model="form" :rules="rules" layout="vertical">
        <a-row :gutter="16">
          <a-col :xs="24" :sm="12">
            <a-form-item :label="$t('oa.car.useDate')" name="useDate">
              <a-date-picker v-model:value="form.useDate" value-format="YYYY-MM-DD" class="full" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item :label="$t('oa.car.passengers')" name="passengers">
              <a-input-number v-model:value="form.passengers" :min="1" :max="60" :precision="0" class="full" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="$t('oa.car.destination')" name="destination">
              <a-input v-model:value="form.destination" :maxlength="100" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="$t('oa.car.purpose')" name="purpose">
              <a-textarea v-model:value="form.purpose" :rows="3" :maxlength="255" show-count />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="$t('common.field.remark')" name="remark">
              <a-input v-model:value="form.remark" :maxlength="255" />
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
    </FormDrawer>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons-vue'
import DictTag from '@/components/DictTag.vue'
import FormDrawer from '@/components/FormDrawer.vue'
import SearchForm from '@/components/SearchForm.vue'
import TableToolbar from '@/components/TableToolbar.vue'
import { addCarRequest, deleteCarRequest, getCarRequest, pageCarRequest, updateCarRequest } from '@/api/oa/car'
import { useColumns } from '@/composables/useColumns'
import { useDict } from '@/composables/useDict'
import { useFormDrawer } from '@/composables/useFormDrawer'
import { useTable } from '@/composables/useTable'
import { toOptions } from '@/utils/dict'

const { t } = useI18n()
const dict = useDict('oa_car_status')

const columns = [
  { title: t('oa.car.requestNo'), dataIndex: 'requestNo', width: 160 },
  { title: t('oa.car.useDate'), dataIndex: 'useDate', width: 120 },
  { title: t('oa.car.destination'), dataIndex: 'destination', width: 200, ellipsis: true },
  { title: t('oa.car.passengers'), dataIndex: 'passengers', width: 100 },
  { title: t('common.field.status'), key: 'status', width: 100, dict: 'oa_car_status' },
  { title: t('oa.car.applicant'), dataIndex: 'createByName', width: 110 },
  { title: t('common.field.createTime'), dataIndex: 'createTime', width: 170 },
  { title: t('common.action.operation'), key: 'action', width: 160, fixed: 'right' }
]
const { checked, visibleColumns } = useColumns(columns, 'oa-car')
const showSearch = ref(true)

const query = reactive({ keyword: undefined, status: undefined })
const { list, loading, size, pagination, load, search, onTableChange, exportAll } = useTable(pageCarRequest, query)

function resetQuery() {
  Object.assign(query, { keyword: undefined, status: undefined })
  search()
}

onMounted(load)

const rules = {
  useDate: [{ required: true, message: t('common.rule.requiredSelect', { name: t('oa.car.useDate') }) }],
  destination: [{ required: true, whitespace: true, message: t('common.rule.required', { name: t('oa.car.destination') }) }],
  passengers: [{ required: true, message: t('common.rule.required', { name: t('oa.car.passengers') }) }]
}
const drawer = useFormDrawer({
  emptyForm: () => ({ id: undefined, useDate: undefined, destination: '', purpose: '', passengers: 1, remark: '' }),
  fetch: (record) => getCarRequest(record.id),
  create: addCarRequest,
  update: updateCarRequest,
  toPayload: ({ useDate, destination, purpose, passengers, remark }) => ({ useDate, destination, purpose, passengers, remark }),
  onSuccess: load
})
const { formRef, form } = drawer

async function remove(id) {
  await deleteCarRequest(id)
  message.success(t('common.msg.deleteSuccess'))
  load()
}
</script>

<style scoped>
.full {
  width: 100%;
}
</style>
```

有明细行、字段多的单据，表单改为 `<FormDrawer page>` 子页并封装为 `components/oa/CarRequestForm.vue`，详情用 `SubPage` 封装为 `CarRequestDetail.vue`，见 [前端开发规范](./frontend)。

## 9. 菜单与授权

页面必须登记到菜单才能访问：前端按 `/auth/menus` 返回的菜单动态注册路由，没有菜单就没有路由。在 `init.sql` 中登记模块目录、页面和按钮（菜单 ID 选一段不会冲突的号段）：

```sql
INSERT INTO sys_menu (id, parent_id, name, type, path, component, perms, icon, sort, visible, status, create_time, update_time) VALUES
(5000, 0,    '行政办公',     'M', '/oa', NULL,          NULL,           'CoffeeOutlined', 8, 1, 1, NOW(), NOW()),
(5001, 5000, '用车申请',     'C', 'car', 'oa/car/index', 'oa:car:list', 'CarOutlined',    1, 1, 1, NOW(), NOW()),
(5002, 5001, '用车申请新增', 'F', NULL,  NULL,          'oa:car:add',    NULL, 1, 1, 1, NOW(), NOW()),
(5003, 5001, '用车申请修改', 'F', NULL,  NULL,          'oa:car:edit',   NULL, 2, 1, 1, NOW(), NOW()),
(5004, 5001, '用车申请删除', 'F', NULL,  NULL,          'oa:car:remove', NULL, 3, 1, 1, NOW(), NOW());

-- 普通员工（staff）可以使用用车申请
INSERT INTO sys_role_menu (role_id, menu_id) VALUES
(13, 5000), (13, 5001), (13, 5002), (13, 5003), (13, 5004);
```

菜单名称在数据库中保存中文，英文译文按菜单 ID 加到 `lemon-web/src/locales/en-US/menu.js`（没有译文时英文界面也显示中文名称）：

```js
  5000: 'Office', // 行政办公
  5001: 'Car Requests', // 用车申请
```

页面地址为模块路径 + 页面路径：`/oa/car`。超级管理员不需要授权。也可以不改 `init.sql`，直接在「系统管理 → 菜单管理」中新增，再到「角色管理」中给角色勾选。菜单字段、分组目录、开启 SaaS 时的租户套餐等细节见 [新增菜单与授权](./menu)。

## 10. 验证

1. `./gradlew build` 编译通过、无警告；
2. 执行建表、字典、菜单 SQL，重启后端；
3. 用 admin 登录，顶部导航出现「行政办公」，新增、修改、删除用车申请，单号按 `YC` + 日期 + 流水生成；
4. 用只有 staff 角色的账号登录，验证按钮和数据权限（仅本人数据）；
5. 在「系统监控 → 操作日志」中确认增删改都有记录；
6. 运行 `python3 scripts/check_i18n.py lemon-modules/lemon-oa` 和 `cd lemon-web && npm run i18n:check`，确认两个检查都通过；在顶栏切换为 English，确认菜单、页面文字、字典标签、校验和业务提示都是英文；
7. 开启 `LEMON_TENANT_ENABLED=true` 后用另一个租户登录，确认数据互相隔离（新租户需要在租户套餐中加入该菜单）。

## 其他可选的扩展

| 需求 | 做法 |
| --- | --- |
| 审批 | [接入审批流](./approval) |
| 打印 | [单据编号与打印](./doc-no-print) |
| 首页待办 | 实现 `TodoProvider`，数量在 mapper XML 中一次查询 |
| 附件、字段变更历史 | 实现 `RecordTypeProvider` 登记业务类型，前端放 `AttachmentPanel` / `ChangeLogPanel`，见 [文件与附件](../architecture/file) |
| 自定义字段 | 登记业务类型后前端接入 `useCustomFields`，见 [业务实体接入自定义字段](./custom-field) |
| 可配置的业务规则（比例、开关、方式） | 实现 `BizRuleProvider` 登记业务参数，见 [新增业务参数](./biz-rule) |
| 引用主数据（物料、客户等） | 实现 `ReferenceChecker`，防止被引用的主数据被删除 |
| 定时提醒 | [新增定时任务](./job) |
| 新租户需要的基础数据 | [新租户初始化](./tenant-init) |
