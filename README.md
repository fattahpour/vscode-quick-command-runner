# Quick Command Runner

Run your project's frequently-used shell commands, scripts, and tools from a sidebar in VS Code — with live status tracking, output logs, run history, favorites, and automatic clipboard copying of file paths printed by your tools.

## Features

- **Commands view** — a tree of your configured commands, grouped however you like (Build, Test, Run, Docker, Git, ...).
- **One-click run/cancel** with live status icons (idle, running, success, failed, cancelled, invalid).
- **Search & filter** commands by name or description.
- **Favorites** — pin commands to a `⭐ Favorites` section at the top of the tree.
- **Recent** — the last few commands you ran, shown in a `🕐 Recent` section.
- **History view** — every run is recorded with its full command line, exit code, duration, and captured stdout/stderr. Sort, filter, clear, re-run, or reopen the log of any past run.
- **Per-command output channels** — each command gets its own "Output" channel; logs can auto-open, be cleared, or copied.
- **Automatic path detection** — when a command prints something that looks like a file path, it can be copied to your clipboard automatically.
- **Variable substitution** — use `${workspaceFolder}` in `cwd`, `command`, `file`, `args`, and `env`.

## Getting Started

1. Install the extension (see below).
2. Open a folder/workspace in VS Code.
3. Click the **Quick Command Runner** icon in the Activity Bar.
4. If no configuration file exists yet, the Commands view shows a **Create Config** link — click it to scaffold `.vscode/quick-command-runner.json` with a starter "Build" command.
5. Edit that file to add your own groups and commands (see [Configuration](#configuration)).

### Installing

This extension isn't published to the Marketplace yet. Install it from a packaged `.vsix`:

```bash
npm install
npm run compile
npx vsce package
code --install-extension quick-command-runner-<version>.vsix
```

Or run it from source for development: open this folder in VS Code and press `F5` to launch an Extension Development Host.

## Configuration

Commands are defined in **`.vscode/quick-command-runner.json`** at the root of your workspace:

```json
{
  "groups": [
    {
      "name": "Build",
      "commands": [
        {
          "id": "build",
          "name": "Build",
          "description": "Compile the project",
          "command": "mvn -q -o package",
          "shell": "bash"
        },
        {
          "id": "build-frontend",
          "name": "Build Frontend",
          "command": "npm run build",
          "cwd": "${workspaceFolder}/frontend"
        }
      ]
    },
    {
      "name": "Test",
      "commands": [
        {
          "id": "test",
          "name": "Run Tests",
          "command": "npm test",
          "autoOpenLog": true
        }
      ]
    },
    {
      "name": "Run",
      "commands": [
        {
          "id": "run-jar",
          "name": "Run JAR",
          "command": "java -jar target/app.jar",
          "env": { "SPRING_PROFILES_ACTIVE": "local" },
          "allowParallelExecution": false,
          "timeout": 0
        }
      ]
    },
    {
      "name": "Docker",
      "commands": [
        {
          "id": "compose-up",
          "name": "Compose Up",
          "command": "docker compose up -d"
        }
      ]
    },
    {
      "name": "Git",
      "commands": [
        {
          "id": "git-status",
          "name": "Status",
          "command": "git status",
          "autoCopyPath": false
        }
      ]
    }
  ]
}
```

### Command fields

Each entry in `groups[].commands` is a `CommandDefinition`:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Unique identifier. Duplicates make the command invalid. |
| `name` | string | yes | Display name shown in the tree. |
| `description` | string | no | Shown in the tooltip and matched by search/filter. |
| `command` | string | one of `command`/`file` | A shell command line to run. |
| `file` | string | one of `command`/`file` | Path to a script/executable to run instead of `command`. |
| `args` | string[] | no | Extra arguments appended when using `file`. |
| `shell` | string | no | One of `auto`, `bash`, `gitbash`, `wsl`, `cmd`, `powershell`, `pwsh`, `sh`, `zsh`. Defaults to `auto` (uses `$SHELL` on macOS/Linux, `cmd.exe` on Windows). For `file`, the shell is also inferred from the extension (`.sh`→bash, `.ps1`→powershell, `.bat`/`.cmd`→cmd, `.py`→python). |
| `cwd` | string | no | Working directory. Defaults to the workspace root. Supports `${workspaceFolder}`. |
| `env` | object | no | Extra environment variables, merged on top of VS Code's environment. Supports `${workspaceFolder}` in values. |
| `timeout` | number | no | Milliseconds before the command is automatically cancelled. `0`/omitted = no timeout. |
| `autoCopyPath` | boolean | no | Per-command override of `quickCommandRunner.autoCopyPath`. |
| `autoOpenLog` | boolean | no | Automatically reveal this command's Output channel as soon as it produces output. |
| `allowParallelExecution` | boolean | no | If `false` (default), starting the command while it's already running is ignored. |

A command is **invalid** (shown with a warning icon and not runnable) if:

- it sets neither or both of `command`/`file`,
- its `id` duplicates another command's `id`, or
- its `shell` value isn't one of the supported shells.

## Using the Commands view

- Click a command (or its inline ▶ button) to **run** it. While running, the inline button becomes a ⏹ **Cancel** button.
- The status icon and description next to each command show:

  | Status | Icon | Description |
  | --- | --- | --- |
  | Idle | hollow circle | not yet run |
  | Running | spinner | `Running <n>s` (or `×N` if running multiple times in parallel) |
  | Success | green check | `✓ <duration>s` |
  | Failed | red error | `✗ exit <code>` |
  | Cancelled | orange slash | `Cancelled` |
  | Invalid config | warning | `Invalid config` |

- Use the **Search** (magnifying glass) toolbar button to filter the tree by name/description; **Clear Filter** removes the filter.
- Click the ⭐ icon next to a command to toggle it in/out of the **Favorites** section.
- The **Recent** section shows the last few commands you ran (configurable via `quickCommandRunner.recentLimit`).
- Right-click (or use the inline icons on) a command for:
  - **Open Log** / **Clear Log** — view or clear that command's Output channel.
  - **Copy Command Line** — copy the fully-resolved command line to the clipboard.
- **Refresh** reloads the configuration file.

## Using the History view

Every run — successful, failed, or cancelled — is recorded here, newest first.

- **Sort History** cycles between sorting by time, duration, or status.
- **Filter History** filters entries by command name or status text.
- **Clear History** removes all recorded entries.
- Each entry shows the command name, status, and duration/exit info, similar to the Commands view icons.
- **Re-run** (▶) runs that command again using its current configuration.
- **Open Log** opens a read-only document containing exactly what that run produced: the resolved command line, followed by its captured `stdout` and `stderr` (each capped at 100 KB, with a `…[truncated]` marker if exceeded).

## Settings

Configure these under `Quick Command Runner` in VS Code Settings (`quickCommandRunner.*`):

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `quickCommandRunner.autoCopyPath` | boolean | `true` | Global default for auto-copying the first detected output path to the clipboard. Per-command `autoCopyPath` overrides this. |
| `quickCommandRunner.showNotifications` | boolean | `true` | Show start/finish/path-copied notifications for command executions. |
| `quickCommandRunner.cancelGracePeriodMs` | number | `3000` | Delay in milliseconds between SIGTERM and SIGKILL when cancelling a running command. |
| `quickCommandRunner.historyLimit` | number | `200` | Maximum number of command history entries to keep. |
| `quickCommandRunner.recentLimit` | number | `5` | Maximum number of commands shown in the "Recent" section of the Commands view. |

## Automatic path copying

While a command runs, its output is scanned for things that look like file paths — either a `key: /some/path` / `key=/some/path` style line containing "path" (e.g. `Report path: ./out/report.html`), or a standalone token that looks like an absolute/relative/home-relative path (`/...`, `./...`, `../...`, `~/...`, or `C:\...`).

The **first** path found (across stdout and stderr, including a final flush after the process exits) is copied to the clipboard, provided `autoCopyPath` is enabled (per-command setting, falling back to the global `quickCommandRunner.autoCopyPath`). If `quickCommandRunner.showNotifications` is on, you'll see a notification confirming what was copied.

## Troubleshooting

- **"Invalid config" / warning icon** — check that the command sets exactly one of `command`/`file`, has a unique `id`, and uses a supported `shell` value.
- **Command doesn't start on your platform** — some shells aren't available everywhere (e.g. `wsl`/`cmd`/`powershell` on macOS/Linux, or `pwsh` if PowerShell Core isn't installed). Use `shell: "auto"` or pick a shell available on your OS.
- **A long-running command never finishes** — set `timeout` (ms) to have it auto-cancelled, or use the Cancel button. Cancellation sends `SIGTERM`, then `SIGKILL` after `quickCommandRunner.cancelGracePeriodMs`.
- **Running a command twice does nothing** — that's `allowParallelExecution: false` (the default); set it to `true` if concurrent runs are expected.

## License

[MIT](LICENSE)
