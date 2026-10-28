# 旧版固定隔离样本

由基线提交 2dd03c2cc071a7738c360b10c63200e0fff530f7 的 pluckctl 生成，2026-10-28。全部为虚构配置与 Key，未读取用户目录。

生成顺序：官方 settings（含无关字段及虚构凭据）→ save-cpa → set-models → switch cpa → refresh（本地临时 HTTP 替身，随机空闲端口）→ switch official → switch cpa。包含已有 Key、列表、官方/CPA 快照、列表外默认模型与别名。生成后固定保存，测试只复制到临时目录再修改；端口不保证现在有服务。

生产 UI 验证通过新版 pluckctl 读写这些副本；Rust 服务回归校验保存后的字段、凭据、快照。持久格式未变。
