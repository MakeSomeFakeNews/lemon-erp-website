---
order: 9
---

# 新增定时任务

业务模块新增定时任务只需要实现框架层的 `JobHandler` 接口并注册为 Spring Bean，系统模块会自动登记、调度、按租户执行、记录日志，管理员在「系统监控 → 定时任务」中修改 Cron、参数和启停。调度原理见 [定时任务](../architecture/job)。

## 示例：用车提醒

每天早上提醒第二天用车的申请人：

```java
package com.lemon.erp.modules.oa.service;

import com.lemon.erp.framework.job.JobHandler;
import com.lemon.erp.framework.job.JobParams;
import com.lemon.erp.framework.message.MessageCategory;
import com.lemon.erp.framework.message.MessageSender;
import com.lemon.erp.framework.message.MessageSender.Message;
import com.lemon.erp.modules.oa.entity.OaCarRequest;
import com.lemon.erp.modules.oa.mapper.OaCarRequestMapper;
import com.lemon.erp.modules.oa.model.CarRequestStatus;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;

/**
 * 用车提醒：提醒申请人 days 天后（默认 1 天）的已批准用车
 */
@Component
@RequiredArgsConstructor
public class OaCarRemindJob implements JobHandler {

    private final OaCarRequestMapper requestMapper;
    private final MessageSender messageSender;

    @Override
    public String key() {
        return "oa.carRemind";
    }

    @Override
    /** 名称的消息键：写入任务表时取中文，「定时任务」页面按请求语言显示 */
    public String name() {
        return "oa.label.carRemindJob";
    }

    @Override
    public String defaultCron() {
        return "0 0 17 * * *";
    }

    @Override
    public String defaultParams() {
        return "days=1";
    }

    @Override
    public String run(JobParams params) {
        LocalDate useDate = LocalDate.now().plusDays(params.getInt("days", 1));
        List<OaCarRequest> list = requestMapper.selectList(Wrappers.<OaCarRequest>lambdaQuery()
                .eq(OaCarRequest::getStatus, CarRequestStatus.APPROVED)
                .eq(OaCarRequest::getUseDate, useDate));
        for (OaCarRequest r : list) {
            if (r.getCreateBy() == null) {
                continue;
            }
            // 站内消息、执行结果存入数据库，保持中文（定时任务中没有请求语言）
            messageSender.send(List.of(r.getCreateBy()), Message.of(MessageCategory.REMIND,
                    "用车提醒：" + r.getRequestNo(), useDate + " 前往 " + r.getDestination(), "/oa/car") // i18n-ignore 站内消息存库
                    .dedup("oa-car-remind:" + r.getId()));
        }
        return "提醒 " + list.size() + " 条用车申请"; // i18n-ignore 任务日志存库
    }
}
```

启动后任务自动出现在「定时任务」页面，默认每天 17:00 执行。

## 接口说明

| 方法 | 必须实现 | 说明 |
| --- | --- | --- |
| `key()` | 是 | 唯一标识，建议「模块.功能」，如 `oa.carRemind`；登记到 `sys_job.job_key`，之后不要修改 |
| `name()` | 是 | 任务名称的消息键（登记在本模块的资源包中）。首次启动写入任务表时取中文，「定时任务」页面按请求语言显示 |
| `defaultCron()` | 是 | 默认 Cron，Spring 6 段格式：秒 分 时 日 月 周，如 `0 30 1 * * *` 为每天 01:30 |
| `defaultEnabled()` | 否 | 首次登记时是否启用，默认 true |
| `defaultParams()` | 否 | 默认参数，`key=value`，多个用逗号分隔 |
| `run(JobParams)` | 是 | 执行逻辑，返回结果说明（写入执行日志，最多 500 字） |

`defaultCron`、`defaultParams`、`defaultEnabled` 只在任务**首次登记**时使用，之后以页面设置为准，修改代码中的默认值不会影响已登记的任务。

`JobParams`：

```java
int days = params.getInt("days", 30);          // 不存在或不是整数时返回默认值
String mode = params.get("mode", "summary");
```

## 编写要点

- **没有登录用户**：任务在调度线程中运行，不能调用 `SecurityUtils.getLoginUser()`，不能使用 `@DataPermission`，制单人等需要用户的字段要自己决定取值。
- **多租户**：开启 SaaS 时调度器在每个租户的上下文中分别调用一次 `run`，任务代码按单租户编写即可，SQL 自动带租户条件；某个租户抛异常不影响其他租户，日志中记录各租户的结果。
- **事务**：`run` 本身不在事务中。需要事务时调用 Service 中加了 `@Transactional` 的方法，不要在 `JobHandler` 实现类的方法上加 `@Transactional` 后在类内部调用（AOP 不生效）。逐条处理多条记录时每条单独提交（Service 中用 `TransactionTemplate`），一条失败不影响其他，最后汇总失败的记录；有失败时抛出异常让本次执行记为失败（示例 `MesEcnEffectJob` 调用 `MesEcnService.effectDue`）。
- **幂等与去重**：任务可能被手动重复执行，提醒类消息用 `Message.dedup(key)`，同一用户相同的去重键只发一次；数据处理类任务用条件更新保证重复执行不出错。
- **大数据量**：统计在数据库中完成；需要逐条处理时分批查询，避免一次加载全部数据。
- **失败**：抛出异常时本次执行记为失败（日志中记录异常信息），下次按 Cron 照常执行。
- **不要用 `@Scheduled`**：`@Scheduled` 方法没有租户上下文，开启 SaaS 后访问租户表会报错，也无法在页面上管理。

## 管理与测试

- 「系统监控 → 定时任务」中可以修改 Cron（保存时校验格式）、参数、启停，修改后立即重新调度；
- 「立即执行」在当前请求中同步执行一次，返回执行结果，适合开发时测试；
- 「执行日志」查看每次执行的触发方式（定时 / 手动）、耗时、状态和结果；
- 本地开发时如果不希望任务自动执行，设置 `LEMON_JOB_ENABLED=false`，仍可手动执行；
- 多实例部署时只在一个实例上开启调度（其他实例 `lemon.job.enabled=false`）。

定时任务页面是平台专属功能，只有平台租户的用户（需要 `monitor:job:*` 权限）可以管理。
