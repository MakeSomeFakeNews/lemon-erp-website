---
order: 6
---

# 升级与数据备份

## 需要备份的数据

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 数据库 | MySQL `lemon_erp` 库 | 全部业务数据，以及 Flowable 的 `ACT_*` 表（流程定义、运行中的流程、审批历史），两者必须一起备份和恢复 |
| 上传文件 | `UPLOAD_PATH`（默认 `./uploads`） | 用户头像等 |
| 业务附件 | `lemon.upload.attachment-path`（默认 `./attachments`） | 合同、简历、原始凭证等，数据库中只保存存储路径 |
| 配置 | 环境变量文件、`application-prod.yml`（如有外置）、Nginx 配置 | 特别是 `JWT_SECRET` |

Redis 中只有登录会话和各类缓存，丢失后用户重新登录、缓存自动重新加载，一般不需要备份。

## 数据库备份

使用 `mysqldump` 做逻辑备份，`--single-transaction` 在 InnoDB 下不锁表：

```bash
mysqldump -h127.0.0.1 -ulemon -p --single-transaction --routines --triggers \
  --default-character-set=utf8mb4 lemon_erp | gzip > /backup/lemon_erp_$(date +%F_%H%M).sql.gz
```

定时备份（crontab，每天 02:30，保留 30 天）：

```bash
30 2 * * * /opt/lemon-erp/backup.sh
```

```bash
#!/usr/bin/env bash
# /opt/lemon-erp/backup.sh
set -e
DIR=/backup/lemon-erp
mkdir -p "$DIR"
mysqldump -h127.0.0.1 -ulemon -p"$DB_PASSWORD" --single-transaction --routines --triggers \
  --default-character-set=utf8mb4 lemon_erp | gzip > "$DIR/db_$(date +%F).sql.gz"
tar czf "$DIR/files_$(date +%F).tar.gz" -C /data/lemon-erp uploads attachments
find "$DIR" -type f -mtime +30 -delete
```

建议：

- 备份文件保存到另一台服务器或对象存储，不要只放在同一台机器上；
- 数据量大时可以使用 Percona XtraBackup 等物理备份工具，或开启 binlog 做时间点恢复；
- 定期在测试环境做恢复演练，确认备份可用；
- 数据库和附件目录在同一时间点备份，避免附件记录与文件不一致。

商务智能的数据仓库表（`bi_fact_*`）由同步任务全量重建，丢失后在「数据仓库」中重新同步即可。

## 恢复

```bash
# 停止后端，避免恢复过程中写入
systemctl stop lemon-erp

mysql -uroot -p -e "DROP DATABASE lemon_erp; CREATE DATABASE lemon_erp DEFAULT CHARSET utf8mb4"
gunzip < /backup/lemon-erp/db_2026-10-16.sql.gz | mysql -uroot -p lemon_erp
tar xzf /backup/lemon-erp/files_2026-10-16.tar.gz -C /data/lemon-erp

systemctl start lemon-erp
```

恢复后清理 Redis 中的缓存（只按前缀删除，不要 `FLUSHDB` 影响其他系统）：

```bash
redis-cli -a 密码 --scan --pattern 'login:perms:*' | xargs -r redis-cli -a 密码 del
redis-cli -a 密码 --scan --pattern 'dict:*' | xargs -r redis-cli -a 密码 del
redis-cli -a 密码 del settings:all
```

## 版本升级

### 升级前

1. 阅读新版本的更新说明，确认是否有数据库结构变更、配置项变更；
2. 在测试环境用生产数据的副本完整演练一次升级；
3. 备份数据库和文件目录；
4. 选择业务低峰期，提前通知用户（升级期间服务短暂不可用，用户需要重新登录的情况见下文）。

### 数据库变更

`sql/init.sql` 是全量的建表与初始数据脚本，**不能在已有数据的库上执行**（会删除全部表）。已有数据库的升级使用仓库 [`sql/upgrade`](https://github.com/MakeSomeFakeNews/lemon-erp/tree/main/sql/upgrade) 目录中的增量脚本（每个 [Release](https://github.com/MakeSomeFakeNews/lemon-erp/releases) 的附件和 Docker 部署包中也有）：

| 脚本 | 说明 |
| --- | --- |
| `20261106_v1.0.0.sql` | 开源首版（2026-10-16）升级到 v1.0.0，这段时间内任一版本的代码部署的数据库都可以直接执行 |
| `20261108_order_discount.sql` | 整单优惠 / 抹零：订单、报价单的整单优惠金额，订单明细的已出入库金额、已退款金额和优惠分摊额（按历史出入库单回填），订单变更前后的整单优惠，订单关闭时的尾差调整（应收应付来源增加「订单尾差调整」） |
| `20261108_price_region.sql` | 客户区域改为业务字典 `scm_region`：已有区域文本与字典名称相同的换成键值，其余取值按租户写入字典后换成键值 |
| `20261108_settlement.sql` | 应收应付：收付款折让 / 抹零、多收转预收预付、外币预收预付（历史冲抵记录回填单据一方的本位币金额）、冲账单（菜单「冲账单」、业务字典「冲账项目」）、应付坏账按钮 |
| `20261108_stock_cost.sql` | 实时库存成本：物料移动加权平均成本、库存流水和出入库明细的成本价（按历史单据和成本核算单价回填并标记为近似成本）、盘盈成本价、库存查询「查看成本金额」按钮；完工入库的料工费口径、完工后退料、工单关闭转出成本 |
| `20261109_gm_order_close.sql` | 总经理角色增加「采购订单关闭」「销售订单关闭」按钮权限（各租户按角色编码） |
| `20261109_role_perms.sql` | 内置角色权限补齐：质量工程师补齐员工自助、费用报销、借款申请；销售员增加服务工单处理、市场活动维护；新增菜单「项目 → 我的工时」并授权普通员工；新增内置角色「销售经理」（各租户按角色编码，非平台租户以套餐为上限） |
| `20261109_system_bugs.sql` | 缺陷修复：在途调拨的收货日期（历史单据取收货时间的日期）；工作中心所属车间（工单的数据权限部门取第一道工序工作中心的车间）；金额为 0 的应收应付单改为已核销 |
| `20261109_notice.sql` | 通知公告：公告、发布范围、接收人与阅读记录三张新表，公告状态、发布范围（系统字典）和公告类型（业务字典，平台和已有租户各一份），站内消息类别「公告」，菜单「系统管理 → 通知公告」及内置角色授权 |
| `20261109_ecn_approver.sql` | 工程变更记录批准人（`mes_ecn.approve_by`），详情的「批准」显示批准人和时间；已批准的历史变更单没有批准人，只显示批准时间 |
| `20261110_arap_issue50.sql` | 应收应付（issue #50）：收付款中冲抵预收预付（收付款单和核销明细增加冲抵金额，新表登记收付款选用的预收预付，预收预付的冲抵记录关联收付款单）；收付款草稿（收付款状态增加「草稿」，字典「审批状态」增加「草稿」，是否启用由业务参数「收付款先存草稿」控制，默认关闭）；按钮「收款单确认」「付款单确认」，随套餐加入，已有收款单 / 付款单新增权限的角色同时授权。往来汇总、来源单据穿透不需要改库 |
| `20261110_ecn_flow.sql` | 工程变更审批的内置示例流程（`mes_ecn`，未发布）增加条件分支：变更原因为客户要求、质量问题或用料变更 ≥ 5 项时总经理审批（流程变量新增 `itemChanges` 用料变更项数、`opChanges` 工序变更项数）；只更新从未发布、从未修改过的模型，各租户按角色编码对应本租户的岗位角色，已调整或已发布的模型保持不变。项目月结迟审批工时入账、合同已回款口径、分批预留合并不需要改库 |
| `20261110_mes_issue49.sql` | 生产制造（issue #49）：工单报工报废数量（按已有报工的各工序报废数回填），已有完工入库且完工 + 报废已达到数量的在制工单改为已完工（完工时间取最后一次完工入库或报工的时间）；工单计划完工日期索引；菜单「生产制造 → 生产统计」（人员计件统计、工序产量统计、工单完成情况、产品产量汇总、用料差异分析），包含生产工单的套餐及其租户管理员随套餐加入，内置角色按编码授权（平台以外的租户以套餐为上限）。业务参数「完工入库领料校验」（默认提示）不需要改库 |
| `20261110_other_income_rebate.sql` | 现金银行与返利：其他收支（收支类别、其他收入单 / 费用支出单三张新表；管理费用下增加业务招待费、水电费、租赁费、快递费明细科目；平台和已有租户各复制一份内置收支类别）；账户调拨的手续费承担方（已有数据为转出账户）；返利协议的种类、计算方式和供应商（已有数据为销售返利、阶梯比例）及返利项目新表，应收应付来源「销售返利」改名为「返利」；相关字典，凭证来源增加「其他收支」；菜单「财务 → 资金与费用 → 其他收支」和「供应链 → 采购 → 采购返利」，随套餐加入、内置角色按编码授权 |
| `20261110_trade_discount_freight.sql` | 整单优惠不改变价格体系：出入库单记录本单分摊的整单优惠，明细记录优惠前单价和分摊额（按订单明细的分摊额回填已有单据，并按优惠前单价重算受影响的价格记忆）；询价单的供应商整单优惠承诺（新表）；采购入库运费（运费、承担方、承运供应商，应收应付来源「采购运费」）；发运单运费承担方（默认本公司承担，与原来一致）及代垫运费应收单；系统字典「运费承担」。销售毛利扣坏账、运费的口径只是查询，不需要改库 |
| `20261111_fund_transfer_fields.sql` | 账户调拨（issue #66）：经办人、票据号码（可空）；手续费承担方改称「手续费支付账户」（系统字典 `fin_fee_bearer` 改名，取值名称改为「转出账户支付」「转入账户支付」，只改仍为原名称的）。手续费单独生成凭证分录（出纳日记账中作为支付账户的一笔支出）、收支汇总单列调拨手续费只是程序变化，已有调拨的凭证保持原样 |

之后的变更按 `YYYYMMDD_名称.sql`（变更当天的日期）新增。升级时按文件名顺序执行**部署之后**新增的脚本：

```bash
mysqldump -uroot -p lemon_erp > lemon_erp_backup.sql          # 先备份
mysql -uroot -p lemon_erp < sql/upgrade/20261106_v1.0.0.sql

# Docker 部署（在 docker 目录中执行）
docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" lemon_erp' < ../sql/upgrade/20261106_v1.0.0.sql
```

官方升级脚本都可以重复执行，已经执行过的部分会自动跳过，不确定是否执行过时直接再执行一次即可。每个脚本发布前都会验证：用旧版本的 `init.sql` 建库后执行升级脚本，得到的表结构、索引和菜单、字典、参数等初始数据与新版本 `init.sql` 完全一致。

#### 二次开发时编写增量脚本

自己修改了表结构时，同样在 `sql/upgrade` 中按日期新增脚本，并同步修改 `init.sql`。可以对比两个版本之间 `init.sql` 的变化：

```bash
git diff v旧版本 v新版本 -- sql/init.sql
```

编写要求：

- **可以重复执行**：建表用 `CREATE TABLE IF NOT EXISTS`；加列、加索引前先判断是否已存在（MySQL 8 的 `ALTER TABLE ... ADD COLUMN` 不支持 `IF NOT EXISTS`，可以查询 `information_schema.COLUMNS` 后再执行，或在脚本说明中注明只执行一次）；插入菜单、字典等数据用 `INSERT ... SELECT ... WHERE NOT EXISTS`；
- **不依赖自增 ID**：菜单的上级、角色授权按路由地址、权限标识、角色编码查询关联，而不是写死 ID；
- **多租户**：开启 SaaS 时，新增的租户基础数据需要为每个已有租户插入（显式写 `tenant_id`）；新表的唯一约束带 `tenant_id`；
- 先在测试库执行验证，再在生产库执行。

例如增量添加一个系统字典（取值全部内置，只有平台一份）：

```sql
INSERT INTO sys_dict_type (name, type, kind, status, remark, create_time, update_time)
SELECT '用车申请状态', 'oa_car_status', 'SYSTEM', 1, NULL, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM sys_dict_type WHERE type = 'oa_car_status');

INSERT INTO sys_dict_data (tenant_id, dict_type, dict_label, dict_value, tag_color, sort, status, builtin, create_time, update_time)
SELECT 1, 'oa_car_status', '草稿', 'DRAFT', 'default', 1, 1, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM sys_dict_data WHERE dict_type = 'oa_car_status' AND dict_value = 'DRAFT' AND tenant_id = 1);
```

业务字典（`kind = 'BUSINESS'`）每个租户各有一份：新开通的租户从平台（`tenant_id = 1`）复制，已开通的租户不会自动得到新增的业务字典，增量脚本要按 `sys_tenant` 中的每个租户插入一份（同样用 `NOT EXISTS` 判断 `dict_type`、`dict_value`、`tenant_id`）。

Flowable 的 `ACT_*` 表不需要手工处理：新版本的引擎在启动时按 `database-schema-update: true` 自动升级表结构。

### 升级步骤

1. 停止后端：`systemctl stop lemon-erp`；
2. 按顺序执行 `sql/upgrade` 中部署之后新增的升级脚本；
3. 替换 `lemon-erp.jar`，按需更新环境变量；
4. 启动后端，查看日志确认启动成功（`journalctl -u lemon-erp -f`）；
5. 替换 Nginx 静态目录中的前端文件（先上传到新目录，再切换目录或替换，避免替换过程中出现部分新文件、部分旧文件）；
6. 在「系统监控 → 缓存监控」中清空「用户权限」「字典数据」「系统参数」缓存（Redis 中的 `login:perms:*`、`dict:*`、`settings:all`），使新的菜单、权限、字典立即生效；
7. 用管理员和普通账号登录验证主要功能。

`index.html` 设置为不缓存（见 [Nginx 配置](./nginx)），用户刷新页面即可加载新版本的前端；`assets` 中的文件名带内容哈希，不会读到旧缓存。

登录会话保存在 Redis 中，只升级 jar 不会让用户掉线；更换了 `JWT_SECRET` 或清空了 `login:token:*` 时所有用户需要重新登录。

### 回滚

- 保留上一版本的 jar 和前端文件；
- 增量 SQL 尽量只做兼容的变更（加表、加列、加数据），使旧版本代码在新结构上仍能运行，回滚时只需替换程序；
- 不兼容的变更（删列、改列类型、改数据含义）需要准备回滚脚本，或直接用升级前的备份恢复。

## 二次开发项目的升级建议

基于柠檬ERP 二次开发时，为了便于合并上游的新版本：

- 新功能尽量放在新的业务模块或新类中，通过框架提供的扩展点（事件、`TodoProvider`、`JobHandler`、`FlowBusiness`、`RecordTypeProvider` 等）接入，少改动原有类；
- 对原有代码的修改保持小而集中，提交信息写清楚原因；
- 自己的表、菜单、字典使用独立的前缀和 ID 号段，避免与上游新增的数据冲突；
- 用 Git 管理，定期合并上游版本，合并后按本页步骤整理增量 SQL。
