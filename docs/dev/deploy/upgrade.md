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

`sql/init.sql` 是全量的建表与初始数据脚本，**不能在已有数据的库上执行**（会删除全部表）。升级时需要把新旧版本之间的差异整理为增量 SQL：

```bash
# 对比两个版本之间 init.sql 的变化
git diff v旧版本 v新版本 -- sql/init.sql
```

按差异编写增量脚本，要求：

- **可以重复执行**：建表用 `CREATE TABLE IF NOT EXISTS`；加列、加索引前先判断是否已存在（MySQL 8 的 `ALTER TABLE ... ADD COLUMN` 不支持 `IF NOT EXISTS`，可以查询 `information_schema.COLUMNS` 后再执行，或在脚本说明中注明只执行一次）；插入菜单、字典等数据用 `INSERT ... SELECT ... WHERE NOT EXISTS`；
- **不依赖自增 ID**：菜单的上级、角色授权按路由地址、权限标识、角色编码查询关联，而不是写死 ID；
- **多租户**：开启 SaaS 时，新增的租户基础数据需要为每个已有租户插入（显式写 `tenant_id`）；新表的唯一约束带 `tenant_id`；
- 先在测试库执行验证，再在生产库执行。

例如增量添加一个字典：

```sql
INSERT INTO sys_dict_type (name, type, status, remark, create_time, update_time)
SELECT '用车申请状态', 'oa_car_status', 1, NULL, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM sys_dict_type WHERE type = 'oa_car_status');

INSERT INTO sys_dict_data (dict_type, dict_label, dict_value, tag_color, sort, status, create_time, update_time)
SELECT 'oa_car_status', '草稿', 'DRAFT', 'default', 1, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM sys_dict_data WHERE dict_type = 'oa_car_status' AND dict_value = 'DRAFT');
```

Flowable 的 `ACT_*` 表不需要手工处理：新版本的引擎在启动时按 `database-schema-update: true` 自动升级表结构。

### 升级步骤

1. 停止后端：`systemctl stop lemon-erp`；
2. 执行增量 SQL；
3. 替换 `lemon-erp.jar`，按需更新环境变量；
4. 启动后端，查看日志确认启动成功（`journalctl -u lemon-erp -f`）；
5. 替换 Nginx 静态目录中的前端文件（先上传到新目录，再切换目录或替换，避免替换过程中出现部分新文件、部分旧文件）；
6. 清理权限、字典缓存（`login:perms:*`、`dict:*`），使新的菜单、权限、字典立即生效；
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
