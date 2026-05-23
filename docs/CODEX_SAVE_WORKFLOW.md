# Codex Save Workflow

Use this at the end of a completed work session:

```powershell
npm run codex:save
```

That command runs `scripts/codex-save.ps1` and does three things:

1. Commits current Git changes with an automated `chore: codex autosave ...` message.
2. Pushes the current branch to the GitHub remote.
3. Saves a local backup under `D:\GitHubBackup\SocialAi`.

The backup contains:

- `git-bundles\SocialAi.bundle` - a restorable Git bundle with all refs.
- `working-tree\` - a mirrored copy of the project files, excluding heavy/generated folders such as `.git`, `node_modules`, `dist`, Shopify build output, and Wrangler caches.
- `metadata\last-save.json` - the last saved commit, branch, remote, and timestamp.

Ignored local files such as `.env` are not committed to GitHub, but the working-tree mirror can copy them to `D:\GitHubBackup`. Treat that drive as private.

Useful variants:

```powershell
# Back up locally without pushing.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\codex-save.ps1 -NoPush

# Use a custom commit message.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\codex-save.ps1 -Message "chore: save billing fixes"

# Save only Git history, skipping the working-tree mirror.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\codex-save.ps1 -SkipWorkingTreeMirror
```

`D:\GitHubBackup` is the shared backup folder. Each direct child folder is a project, so this repo uses the `SocialAi` project folder by default.
