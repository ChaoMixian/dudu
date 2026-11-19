# Skills

[中文](../skills.md) · English

Skills are workspace-wide `SKILL.md` instruction packs. Install once and every Bot can use them. A skill is not a connector: it holds no external credentials and produces no events.

## Install

In **Settings → Skills**:

- browse popular skills.sh entries sorted by installs by default;
- search the public skills.sh directory;
- or enter `owner/repo`, a GitHub URL, or a skills.sh skill URL, inspect the repository, then install.

Files are written to `<workspace>/skills/<slug>/SKILL.md` and its supporting files; source metadata is stored in `<workspace>/.dudu/skills.json`. Installing or removing a skill rebuilds every Bot session when it next becomes idle, so the new skill list is loaded.

Skill content is passed to the model as instructions. Install only trusted sources. dudu rejects symlinks, path traversal, and skill folders larger than 200 files or 5 MiB, but this is not a security sandbox.

## Limits

- Workspace-wide; there is no per-Bot enablement.
- No automatic updates; remove and reinstall when needed.
- Unauthenticated GitHub API limits are low; set `GITHUB_TOKEN` to raise them.
