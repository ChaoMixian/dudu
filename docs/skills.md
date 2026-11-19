# 技能

[English](en/skills.md) · 中文

技能是工作区共享的 `SKILL.md` 指令包，安装一次后所有 Bot 都能使用。技能不是连接器：它们不持有外部凭证，也不产生事件。

## 安装

在 **设置 → 技能** 中：

- 默认展示按安装量排序的 skills.sh 热门技能；
- 可以直接搜索 skills.sh 公开目录；
- 或输入 `owner/repo`、GitHub 仓库链接、skills.sh 技能链接，先查看仓库里的技能再安装。

安装后写入 `<workspace>/skills/<slug>/SKILL.md` 及其附带文件；来源信息记录在 `<workspace>/.dudu/skills.json`。安装或删除会让所有 Bot 在下次空闲时重建会话，从而加载新的技能列表。

技能内容会作为指令交给模型。只安装可信来源；dudu 会拒绝符号链接、路径穿越、超过 200 个文件或 5 MiB 的技能目录，但这不构成安全沙箱。

## 限制

- 工作区共享，没有按 Bot 启用。
- 不支持自动更新；需要时删除后重新安装。
- GitHub API 未认证时限额较低；设置 `GITHUB_TOKEN` 可提高限额。
