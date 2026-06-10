# Quick Command Runner — Design Spec

Date: 2026-06-10
Status: Approved (pending final spec review)

## 1. Overview

"Quick Command Runner" is a VS Code extension providing a sidebar launcher for
frequently-used commands, scripts, and tools (build/test/run/docker/git/etc.).
Commands are defined in a per-workspace JSON config, grouped into categories,
and run via `child_process` with real-time stdout/stderr streaming, status
tracking, run/cancel toggling, automatic detection+clipboard-copy of output
paths, and persistent execution history with favorites/recents.

## 2. Goals / Non-goals

**Goals**: cross-platform command execution (bash/gitbash/wsl/cmd/powershell/
pwsh/sh/zsh, executables, scripts, direct strings); sidebar TreeView UI with
live status; run/cancel toggle that kills the full process tree; auto path
detection + clipboard copy; persistent history/favorites/recents; per-command
output channels; production-ready packaging (`vsce package`).

**Non-goals (v1)**: multi-root workspace support (the first workspace folder
is used for `${workspaceFolder}` and the config path; multi-root is a future
enhancement); remote/SSH targets (the `wsl` shell type is the only
remote-adjacent option, used as a local pass-through to `wsl.exe`);
telemetry; automated marketplace publishing (the README documents manual
`vsce publish`).

## 3. Architecture & Module Map

```
src/
├── extension.ts        — activation: wires all modules, registers commands/views,
│                          watches .vscode/quick-command-runner.json
├── types.ts             — shared interfaces/types (below)
├── configLoader.ts      — reads + validates the JSON config
├── processManager.ts    — shell resolution, spawn (cross-spawn), tree-kill cancel
├── commandRunner.ts      — orchestrates one execution end-to-end
├── statusManager.ts      — in-memory status map + change events
├── commandProvider.ts     — TreeDataProvider for the "Commands" view
├── historyManager.ts      — TreeDataProvider + workspaceState persistence for
│                            "History" view, plus favorites/recent
├── pathExtractor.ts        — regex-based path detection from process output
├── clipboardManager.ts      — vscode.env.clipboard wrapper
└── logManager.ts             — per-command OutputChannel, timestamped lines
```

### 3.1 Core Types (`types.ts`)

```typescript
export type ShellType =
  | 'auto' | 'bash' | 'gitbash' | 'wsl' | 'cmd' | 'powershell' | 'pwsh' | 'sh' | 'zsh';

export type ExecutionStatus =
  | 'idle' | 'running' | 'success' | 'failed' | 'cancelled' | 'invalid';

export interface CommandDefinition {
  id: string;
  name: string;
  description?: string;
  shell?: ShellType;                 // default 'auto'
  command?: string;                   // direct command string
  file?: string;                       // script/executable path, resolved against cwd
  args?: string[];
  cwd?: string;                         // default '${workspaceFolder}'
  env?: Record<string, string>;
  timeout?: number;                     // ms, 0 = none
  autoCopyPath?: boolean;               // default = global setting
  autoOpenLog?: boolean;                // default false
  allowParallelExecution?: boolean;     // default false
}

export interface CommandGroup {
  name: string;
  commands: CommandDefinition[];
}

export interface QuickCommandRunnerConfig {
  groups: CommandGroup[];
}

export interface HistoryEntry {
  entryId: string;
  commandId: string;
  commandSnapshot: CommandDefinition;   // frozen copy for re-run after config changes
  fullCommand: string;                   // resolved command line actually executed
  shell: ShellType;
  cwd: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  exitCode: number | null;
  status: ExecutionStatus;
  stdout: string;                         // truncated to 100KB, marker appended if cut
  stderr: string;                          // truncated to 100KB, marker appended if cut
  extractedPaths: string[];
}

export interface ConfigValidationError {
  commandId?: string;
  groupName?: string;
  message: string;
}
```

### 3.2 Run Flow

1. `quickCommandRunner.run(commandId)` fires. `commandRunner` checks
   `statusManager` — if there is already an active execution for this
   `commandId` and `!allowParallelExecution`, no-op (the UI button is
   already showing Cancel, so this is normally unreachable). If
   `allowParallelExecution: true`, a second run is allowed alongside the
   first (see 5.2 for how concurrent executions are tracked/displayed).
2. Resolve the `CommandDefinition`: substitute `${workspaceFolder}` in
   `cwd`/`command`/`file`/`args`/`env` values, merge `env` over
   `process.env`.
3. `processManager` resolves shell + argv (see 5.1) and spawns via
   `cross-spawn`, returning `{ pid, child }`.
4. `statusManager` sets status `running`, records `startTime` + `pid`,
   emits a change event. `commandProvider` updates the icon to a spinner and
   swaps the inline button to Cancel. A `withProgress` notification
   (location: Notification, cancellable) appears, doubling as the "started"
   notification.
5. stdout/stderr are streamed: `logManager` line-buffers and writes
   timestamped lines to the command's `OutputChannel`; `pathExtractor` scans
   each chunk incrementally, appending matches to `extractedPaths`. If
   `autoOpenLog`, the channel is revealed on first output.
6. On the first extracted path, if `autoCopyPath` resolves true,
   `clipboardManager` copies it, an info notification "Path copied to
   clipboard" fires, and the copy is logged.
7. On process exit: status becomes `success` (exit code 0, not cancelled),
   `failed` (non-zero exit code), or `cancelled` (cancel was requested).
   `historyManager.add(entry)` persists the `HistoryEntry`. A completion
   toast fires (info/error/warning per status, gated by
   `quickCommandRunner.showNotifications`). `statusManager` emits a final
   change; both tree views refresh; the button reverts to Run.

### 3.3 Cancel Flow

`quickCommandRunner.cancel(commandId)` → `processManager.cancel(pid)` calls
`tree-kill(pid, 'SIGTERM')`. If the process is still alive after
`quickCommandRunner.cancelGracePeriodMs` (default 3000ms), escalate to
`tree-kill(pid, 'SIGKILL')`. The exit handler observes the cancel flag and
sets status `cancelled` regardless of the resulting exit code.

## 4. Configuration

### 4.1 File & Schema

Config lives at `.vscode/quick-command-runner.json`, matching
`QuickCommandRunnerConfig`. A JSON Schema at
`schemas/quick-command-runner.schema.json` is registered via
`contributes.jsonValidation` for editor autocomplete/validation. The schema
enforces: `groups[].name` and `commands[].{id,name}` required strings;
`shell` restricted to the `ShellType` enum; `command`/`file` typed as
optional strings (the *exactly-one-required* rule is enforced by
`configLoader`, not the schema, since JSON Schema's `oneOf` would produce
confusing editor error messages for partially-typed commands).

### 4.2 Validation Rules (`configLoader.ts`)

- Exactly one of `command` / `file` must be set per command. If both or
  neither are present, the command's status is `invalid`; it is shown in the
  tree with a warning icon and a tooltip explaining the problem, and is
  excluded from execution (the Run action is disabled via `contextValue`).
- `id` must be unique across all groups/commands. A duplicate is a
  config-level error: a warning notification fires and details are written
  to the `Quick Command Runner: Configuration` output channel; the
  first-seen command keeps its `id`, later duplicates become `invalid`.
- An unrecognized `shell` value makes the command `invalid` (same treatment
  as above).
- If `.vscode/quick-command-runner.json` does not exist, the Commands view
  shows a welcome view with a "Create Config" button
  (`quickCommandRunner.createConfig`) that scaffolds the file from the
  bundled example.
- The config file is watched via `vscode.workspace.createFileSystemWatcher`;
  changes trigger reload, revalidation, and a tree refresh.

## 5. Execution Engine (`processManager.ts`)

### 5.1 Shell Resolution

| `shell` value | Windows | macOS | Linux |
|---|---|---|---|
| `bash` | detected Git-Bash (`%ProgramFiles%\Git\bin\bash.exe`, then `PATH`), else WSL bash | `/bin/bash -c` | `/bin/bash -c` |
| `gitbash` | same Git-Bash detection as `bash` | falls back to `bash` | falls back to `bash` |
| `wsl` | `wsl.exe -e bash -lc` | unsupported → `invalid` | unsupported → `invalid` |
| `cmd` | `cmd.exe /d /s /c` | unsupported → `invalid` | unsupported → `invalid` |
| `powershell` | `powershell.exe -NoProfile -Command` | unsupported → `invalid` | unsupported → `invalid` |
| `pwsh` | `pwsh.exe -NoProfile -Command` | `pwsh -NoProfile -Command` (if installed, else `invalid`) | `pwsh -NoProfile -Command` (if installed, else `invalid`) |
| `sh` | falls back to Git-Bash `bash -c` | `/bin/sh -c` | `/bin/sh -c` |
| `zsh` | falls back to `bash` | `/bin/zsh -c` (if exists, else `/bin/bash -c`) | `/bin/zsh -c` (if exists, else `/bin/bash -c`) |
| `auto` | `cmd.exe /d /s /c` | `$SHELL -c` or `/bin/sh -c` | `$SHELL -c` or `/bin/sh -c` |

For `file`-based commands with no explicit `shell`, the interpreter is
inferred from the file extension: `.sh`→`bash`, `.ps1`→`powershell`,
`.bat`/`.cmd`→`cmd`, `.py`→`python`/`python3`, no extension or `.exe`/no
extension on POSIX with the executable bit set → spawned directly with no
shell wrapper (argv = `[file, ...args]`).

All spawning goes through `cross-spawn` (handles Windows `.cmd`/`.bat`/
spaces-in-path quirks uniformly across shells and direct executables).

### 5.2 Process Tracking & Cancellation

`tree-kill` is used for cancellation (see 3.3). `statusManager` keeps, per
`commandId`: a list of active executions `{ pid, startTime }[]` (normally 0
or 1 entries; more than 1 only when `allowParallelExecution: true`), and
`lastResult: { status, endTime, durationMs }` for the most recently
completed run. This is in-memory only — live UI state, not persisted
(history persistence is `historyManager`'s job).

The Commands view's displayed status is derived: if `active.length > 0` →
`running` (description shows `Running` or, when `active.length > 1`,
`Running ×N`); otherwise → `lastResult.status` (or `idle` if the command has
never run, or `invalid` if `configLoader` flagged it). The Cancel action
cancels **all** active executions for that `commandId` (tree-kill on every
tracked pid). A `vscode.EventEmitter<string>` (commandId) notifies
`commandProvider` on every state change; the History view does not need live
status (history entries are only added once an execution completes).

### 5.3 Timeout

If `timeout > 0` and the process is still running when the timer fires,
`processManager` triggers the same cancel path as a user-initiated cancel,
but the resulting status is `failed` (not `cancelled`) with a synthetic note
in the log: `[timeout] Command exceeded {timeout}ms and was terminated.`

## 6. Sidebar UI

### 6.1 Layout

Two TreeViews in one Activity Bar container ("Quick Command Runner",
icon `icons/activity-bar-icon.svg` — a monochrome 24×24 terminal+play glyph):

- **Commands** (`quickCommandRunnerCommands`): root nodes are
  `⭐ Favorites` (shown only if non-empty), `🕐 Recent` (last
  `recentLimit`, default 5, shown only if non-empty), then one collapsible
  node per config `Group`, each containing `CommandTreeItem` leaves.
  Favorites/Recent leaves reference the same underlying `CommandDefinition`
  (live status reflects the same in-memory state as the group entry).
- **History** (`quickCommandRunnerHistory`): flat list of `HistoryEntry`,
  newest first.

### 6.2 Commands View — Tree Items & Status Icons

`CommandTreeItem`: label = `name`; description = live status text
(`Running 12s`, `✓ 3.2s`, `✗ exit 1`, `Cancelled`, `Invalid config`);
tooltip = resolved command line + cwd + description. `iconPath` is a
`ThemeIcon` keyed on status:

| Status | Codicon | Color (ThemeColor) |
|---|---|---|
| idle | `circle-outline` | `disabledForeground` (gray) |
| running | `sync~spin` | `charts.yellow` |
| success | `pass-filled` | `testing.iconPassed` (green) |
| failed | `error` | `testing.iconFailed` (red) |
| cancelled | `circle-slash` | `charts.orange` |
| invalid | `warning` | `problemsWarningIcon.foreground` |

`contextValue = "cmd.<status>.<fav|nofav>"` drives `when`-clause menus:

- **Toggle button** (inline): Run icon (`▶`) when status ∈
  {idle, success, failed, cancelled}; Cancel icon (`■`) when status =
  `running`. Implemented as two `view/item/context` entries with
  complementary `when` regexes on `viewItem`, both bound to
  `group: "inline"`.
- **Favorite star** (inline): toggles `quickCommandRunner.toggleFavorite`.
- **Context menu**: Open Log, Clear Log, Copy Command Line.

### 6.3 Commands View — Search/Filter

Toolbar "Search" button → `showInputBox` → sets an in-memory filter string
on `commandProvider` → `_onDidChangeTreeData.fire()`. `getChildren` filters
commands by case-insensitive substring match on `name`/`description`; groups
with no matching children are hidden; matching groups auto-expand. A "Clear
Filter" toolbar button (visible only via a `quickCommandRunner.filterActive`
context key) resets it.

### 6.4 History View

Tree items: label = `"{name} — {relative time}"`, description =
`"{durationMs}ms · exit {exitCode}"`, same status icon mapping as 6.2.
Toolbar: Sort (`showQuickPick`: Time / Duration / Status), Filter
(`showInputBox` on name/status), Clear History (confirmation dialog), Refresh.
Inline actions: **Re-run** (replays `commandSnapshot` through
`commandRunner`), **Open Log** — for an entry whose `OutputChannel` still
exists (same session), reveals it; otherwise opens `entry.stdout`/`stderr`
as a read-only virtual document (`vscode.workspace.openTextDocument` with
`{ content, language: 'log' }`).

## 7. Path Extraction & Clipboard

`pathExtractor.ts` scans stdout+stderr chunks (in arrival order) with:

```typescript
const LABEL_VALUE_RE = /\b\w*path\w*\s*[:=]\s*("?)([^\s"]+)\1/gi;
const LOOKS_LIKE_PATH_RE = /^(?:[A-Za-z]:[\\/]|\/|~\/|\.{1,2}[\\/])/;
```

`LABEL_VALUE_RE` matches any identifier containing "path" (case-insensitive
— covers `path:`, `PATH:`, `outputPath=`, `filePath:`, etc.) followed by `:`
or `=` and a token (optionally quoted). `LOOKS_LIKE_PATH_RE` filters matches
to those that look like absolute/home/relative paths (POSIX `/...`,
`~/...`, `./`/`../`, or Windows `C:\...`/`C:/...`). All matches across the
whole execution are appended to `extractedPaths` in order. The first match
is copied to the clipboard via `clipboardManager` (gated by `autoCopyPath`,
per-command override of the global `quickCommandRunner.autoCopyPath`
default `true`); all matches are stored on the `HistoryEntry`.

`clipboardManager.ts` is a one-method wrapper:
`copy(text: string): Thenable<void>` → `vscode.env.clipboard.writeText`.

## 8. History, Favorites, Recent (`historyManager.ts`)

All three are persisted in `workspaceState`:

- `quickCommandRunner.history` → `HistoryEntry[]`, newest first, capped at
  `quickCommandRunner.historyLimit` (default 200, FIFO eviction of oldest).
- `quickCommandRunner.favorites` → `string[]` of command IDs.
- `quickCommandRunner.recent` → `string[]` of command IDs, MRU order, capped
  at `quickCommandRunner.recentLimit` (default 5), updated on every run
  (moved to front, deduped).

`historyManager` is also the `TreeDataProvider` for the History view (6.4)
and the source of truth `commandProvider` queries for the Favorites/Recent
sections (6.1). API surface: `add(entry)`, `getAll()`, `getFavorites()`,
`toggleFavorite(commandId)`, `getRecent()`, `recordUsed(commandId)`,
`clear()`, `setSort(...)`, `setFilter(...)`.

## 9. Logging & Notifications

### 9.1 Logging (`logManager.ts`)

One lazily-created `vscode.OutputChannel` per command
(`Quick Command Runner: <name>`), plus one shared
`Quick Command Runner: Configuration` channel for config validation issues.
Output is line-buffered (handling arbitrary chunk boundaries from
`spawn`); each line is written as `[HH:mm:ss.SSS] <line>`, with stderr lines
tagged `[HH:mm:ss.SSS] [stderr] <line>`. `quickCommandRunner.openLog(id)` →
`channel.show(true)`; `quickCommandRunner.clearLog(id)` → `channel.clear()`.

### 9.2 Notifications

A run starts inside `vscode.window.withProgress({ location:
ProgressLocation.Notification, cancellable: true })`, which serves as the
"started" notification and offers an in-toast Cancel button (in addition to
the sidebar toggle). On completion, a separate toast fires: info
(success/path-copied), error (failed), or warning (cancelled). All toasts
are gated by `quickCommandRunner.showNotifications` (default `true`).

## 10. Settings (`contributes.configuration`, prefix `quickCommandRunner.`)

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `autoCopyPath` | boolean | `true` | Global default for auto-copying the first detected output path; per-command `autoCopyPath` overrides. |
| `showNotifications` | boolean | `true` | Toggle all start/finish/path-copied toasts. |
| `historyLimit` | number | `200` | Max stored history entries. |
| `recentLimit` | number | `5` | Max entries in the "Recent" section / MRU list. |
| `cancelGracePeriodMs` | number | `3000` | Delay between SIGTERM and SIGKILL escalation on cancel. |

## 11. Project Scaffold & Packaging

```
vscode-command-executer/
├── .vscode/
│   ├── launch.json                    # F5 = Extension Development Host
│   ├── tasks.json                     # background "watch" task
│   └── quick-command-runner.json      # example/demo config
├── .gitignore  .vscodeignore
├── package.json  tsconfig.json
├── README.md  CHANGELOG.md
├── icons/activity-bar-icon.svg
├── schemas/quick-command-runner.schema.json
├── src/  (11 files listed in §3)
└── test/
    ├── unit/      # node:test, no 'vscode' import
    └── suite/     # @vscode/test-electron integration tests
```

**Dependencies**: runtime — `cross-spawn`, `tree-kill`. Dev — `typescript`,
`@types/vscode`, `@types/node`, `@types/cross-spawn`, `@vscode/test-cli`,
`@vscode/test-electron`, `@vscode/vsce`, `eslint` + `@typescript-eslint/*`
(minimal flat config).

**npm scripts**:

```
compile            tsc -p ./
watch              tsc -w -p ./
lint               eslint src test
pretest            npm run compile
test:unit          node --test ./out/test/unit
test:integration   vscode-test
test               npm run test:unit && npm run test:integration
vscode:prepublish  npm run compile
package            vsce package
```

`test:integration` requires a display and cannot run in this sandbox; it is
included for CI/local-dev completeness, while `test:unit` is the suite
exercised during implementation here.

**package.json contributes** (see §6 for views/menus, §10 for
configuration): `engines.vscode: ^1.85.0`, `activationEvents:
["onStartupFinished"]`, `viewsContainers.activitybar` (one container),
`views` (Commands + History), `commands` (run, cancel, refresh, search,
clearFilter, openLog, clearLog, copyCommandLine, toggleFavorite,
historySort, historyFilter, historyClear, historyRerun, historyOpenLog,
createConfig), `menus` (`view/title`, `view/item/context`),
`jsonValidation` (config schema). `publisher` and extension `name` use
placeholders (`your-publisher-name` / `quick-command-runner`); the README
documents changing them before `vsce publish`.

**Example config** (`.vscode/quick-command-runner.json`): groups for Build
(mvn + gradle), Test (npm test), Run (java -jar), Docker (compose up), Git
(status) — covering different `shell` values, `file` vs `command`, `env`,
`timeout`, and `autoCopyPath`.

**README**: overview/features, install (VSIX), configuration (schema +
example), usage walkthrough (run/cancel, history, favorites, path-copy),
settings table, packaging (`vsce package`), publishing (`vsce publish`,
placeholder publisher), troubleshooting (shell not found, path not detected,
Windows process-tree kill), screenshot placeholders.

**CHANGELOG**: `[0.1.0] - Unreleased` with a feature bullet list.

## 12. Testing Strategy

Core logic modules — `configLoader`, `pathExtractor`, the shell-resolution
table in `processManager`, and `historyManager`'s persistence/sorting/
filtering logic — are written with **no `import 'vscode'`**, taking a
`Memento`-shaped interface (`{ get, update }`) instead of the real
`vscode.Memento` where persistence is needed, so they can be unit-tested
with `node --test` against compiled output (`out/test/unit`), runnable in
this sandbox without launching VS Code. `extension.ts`, `commandProvider.ts`,
and `commandRunner.ts` (which do depend on the `vscode` API) are covered by
`@vscode/test-electron` integration tests in `test/suite/`, run via
`vscode-test` — not executable headlessly here, but part of the standard
project setup.

## 13. Implementation Phases

1. **Core engine** — `types`, `configLoader`, `processManager`,
   `commandRunner`, `statusManager`, `logManager`. Headless-testable via
   `test:unit`.
2. **Commands tree UI** — `commandProvider`, `extension.ts` wiring, run/cancel
   toggle, status icons, search/filter, notifications.
3. **Path extraction & clipboard** — `pathExtractor`, `clipboardManager`,
   wired into the run flow and history entries.
4. **History/Favorites/Recent** — `historyManager` (persistence + History
   view), Favorites/Recent sections in the Commands view.
5. **Packaging polish** — README, CHANGELOG, JSON schema, activity bar icon,
   eslint config, example config, `vsce package` verification.
