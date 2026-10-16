---
order: 9
---

# 定时任务

柠檬ERP 的定时任务由系统模块统一调度：业务模块实现框架层的 `JobHandler` 接口并注册为 Spring Bean，`SysJobService` 负责登记、按 Cron 调度、按租户执行和记录日志。管理员在「系统监控 → 定时任务」中修改 Cron、参数、启停，立即执行，查看执行日志。

## JobHandler

```java
public interface JobHandler {
    String key();                         // 唯一标识，如 wms.batchExpiry
    String name();                        // 任务名称
    String defaultCron();                 // 默认 Cron（Spring 6 段格式：秒 分 时 日 月 周）
    default boolean defaultEnabled() { return true; }   // 首次登记时是否启用
    default String defaultParams() { return null; }     // 默认参数，如 days=30
    String run(JobParams params);         // 执行，返回结果说明（写入日志）
}
```

`JobParams` 解析页面设置的参数：`key=value`，多个用逗号或分号分隔（中英文均可），提供 `getInt(key, 默认值)`、`get(key, 默认值)`。

## 调度过程

`SysJobService`：

1. **登记**：应用启动完成（`ApplicationReadyEvent`）时，为每个 `JobHandler` 检查 `sys_job` 中是否已有记录，没有则按 `defaultCron`、`defaultParams`、`defaultEnabled` 插入。之后以页面设置为准，修改代码中的默认值不会影响已登记的任务。
2. **调度**：`lemon.job.enabled=true`（默认）时创建线程池大小为 2 的 `ThreadPoolTaskScheduler`（线程名 `lemon-job-`），为每个启用且 Cron 合法的任务按 `CronTrigger` 调度；页面修改 Cron、启停后立即重新调度。
3. **执行**：每次触发时重新读取任务记录；同一任务同一时间只运行一次（正在运行时再次触发会提示「正在运行」）。
4. **按租户执行**：未开启 SaaS 时在平台租户上下文中执行一次；开启后对每个启用且未到期的租户，在该租户的上下文中依次执行，某个租户失败不影响其他租户，结果汇总为「租户名：结果；…」。
5. **记录日志**：`sys_job_log` 记录触发方式（`SCHEDULE` 定时 / `MANUAL` 手动）、开始时间、耗时、状态（`SUCCESS` / `FAILED`）、结果或错误信息（最多 500 字），并更新任务的最近执行情况。

`lemon.job.enabled=false` 时不自动调度，任务仍会登记，可以在页面上「立即执行」（在当前请求线程中执行）。

`sys_job`、`sys_job_log` 是平台共享表，定时任务页面是平台专属功能，只有平台租户可以管理。

## 内置任务

| 标识 | 名称 | 默认 Cron | 默认参数 |
| --- | --- | --- | --- |
| `wms.batchExpiry` | 批次临期提醒 | `0 20 8 * * *` | `days=30` |
| `scm.reorder` | 补货提醒 | `0 30 8 * * *` | |
| `mes.maintainRemind` | 设备保养提醒 | `0 30 8 * * *` | `days=3` |
| `mes.woOverdue` | 工单逾期提醒 | `0 40 8 * * *` | |
| `mes.ecnEffect` | 工程变更生效 | `0 5 0 * * *` | |
| `qms.capaOverdue` | 纠正预防逾期提醒 | `0 20 9 * * *` | |
| `fin.arOverdue` | 应收逾期提醒 | `0 0 9 * * *` | |
| `fin.noteDue` | 票据到期提醒 | `0 10 9 * * *` | `days=7` |
| `hr.probationRemind` | 试用期到期提醒 | `0 10 8 * * *` | `days=15` |
| `hr.contractExpiry` | 劳动合同到期提醒 | `0 40 8 * * *` | `days=30` |
| `hr.salaryApply` | 调薪生效 | `0 5 0 * * *` | |
| `crm.followRemind` | 客户跟进提醒 | `0 0 8 * * *` | |
| `crm.poolReclaim` | 客户公海回收 | `0 30 2 * * *` | `days=30` |
| `crm.collectionRemind` | 合同回款提醒 | `0 50 8 * * *` | |
| `pm.taskOverdue` | 项目任务逾期提醒 | `0 50 8 * * *` | |
| `bi.alertNotify` | 经营预警推送 | `0 0 9 * * *` | |
| `bi.etl` | 数据仓库同步 | `lemon.bi.etl-cron`（默认 `0 30 1 * * *`） | |

`bi.etl` 的默认 Cron 取配置 `lemon.bi.etl-cron`，配置为 `-` 时首次登记为停用（仍可在「数据仓库」页面或定时任务页面手动执行）。

## 注意事项

- **没有登录用户**：任务在调度线程中运行，`SecurityUtils.getLoginUser()` 会抛出未登录异常，不能依赖当前用户（数据权限、制单人等）；需要「操作人」时使用固定的系统账号或留空。
- **使用 JobHandler 而不是 @Scheduled**：框架虽然开启了 `@EnableScheduling`，但 `@Scheduled` 方法没有租户上下文，开启 SaaS 后访问租户表会报错，也不会出现在定时任务页面。
- **提醒去重**：每天执行的提醒任务发送站内消息时用 `Message.dedup(key)`，同一用户相同的提醒只发一次。
- **多实例部署**：调度器在每个实例中独立运行，「同一时间只运行一次」只在单个进程内有效。多实例部署时只在一个实例上保持 `lemon.job.enabled=true`，其他实例设为 `false`。
- **执行时间**：默认 Cron 按服务器时区计算，部署时注意 JVM 时区（容器中设置 `TZ=Asia/Shanghai`）。

新增定时任务的步骤和示例见 [新增定时任务](../guide/job)。
