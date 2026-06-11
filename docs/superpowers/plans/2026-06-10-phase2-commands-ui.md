# Phase 2: Commands Tree UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Phase 1's headless engine (`configLoader`, `processManager`, `commandRunner`, `statusManager`, `logManager`) into a working VS Code sidebar: a "Commands" TreeView with live status icons, run/cancel toggle, search/filter, log/copy actions, and start/finish notifications.

**Architecture:** Pure view-model logic (status→icon/color mapping, status text formatting, command-line description, group filtering) lives in `src/commandViewModel.ts` with **no `vscode` import**, so it stays unit-testable with `node --test`. `src/commandProvider.ts` is a thin `vscode.TreeDataProvider` that calls into `commandViewModel`. `src/extension.ts` wires everything together: loads/watches the config file, constructs the Phase 1 managers, registers the tree view, commands, and menus declared in `package.json`. `commandProvider.ts` and `extension.ts` are **not** unit-tested (they require the `vscode` module, which only exists inside the Extension Host) — they are verified via `npm run compile` and `npm run lint`, matching how Phase 1 handled `clipboardManager.ts`/`logManager.ts`.

**Tech Stack:** TypeScript (strict, commonjs), `node:test` for unit tests, VS Code Extension API (`vscode.TreeDataProvider`, `ThemeIcon`/`ThemeColor`, `OutputChannel`, `withProgress`, `FileSystemWatcher`).

---

## Reference: Phase 1 APIs used in this plan

These already exist on `master` (after Phase 1 merge) — copied here so tasks are self-contained:

```typescript
// src/types.ts
export type ExecutionStatus = 'idle' | 'running' | 'success' | 'failed' | 'cancelled' | 'invalid';

export interface CommandDefinition {
  id: string; name: string; description?: string; shell?: ShellType;
  command?: string; file?: string; args?: string[]; cwd?: string;
  env?: Record<string, string>; timeout?: number;
  autoCopyPath?: boolean; autoOpenLog?: boolean; allowParallelExecution?: boolean;
}
export interface CommandGroup { name: string; commands: CommandDefinition[]; }
export interface QuickCommandRunnerConfig { groups: CommandGroup[]; }
export interface ConfigValidationError { commandId?: string; groupName?: string; message: string; }
export interface ConfigLoadResult {
  config: QuickCommandRunnerConfig;
  validCommands: Map<string, CommandDefinition>;
  invalidCommands: Map<string, ConfigValidationError>; // keyed "<groupName>/<commandId>"
  errors: ConfigValidationError[];
}
export interface ActiveExecution { pid: number; startTime: number; }
export interface CommandStatus { active: ActiveExecution[]; lastResult: LastResult | null; }

// src/configLoader.ts
export function parseConfig(raw: string): QuickCommandRunnerConfig;
export function validateConfig(config: QuickCommandRunnerConfig): ConfigLoadResult;

// src/statusManager.ts
export class StatusManager {
  getStatus(commandId: string): CommandStatus;
  onDidChangeStatus(listener: (commandId: string) => void): { dispose(): void };
  startExecution(commandId: string, pid: number, startTime: number): void;
  finishExecution(commandId: string, pid: number, result: LastResult): void;
}

// src/commandRunner.ts
export interface CommandRunnerOptions { workspaceFolder: string; cancelGracePeriodMs: number; }
export class CommandRunner {
  constructor(statusManager: StatusManager, logManager: LogManager, options: CommandRunnerOptions);
  run(def: CommandDefinition): Promise<void>;
  cancel(commandId: string): void;
}

// src/logManager.ts
export class LogManager {
  appendOutput(commandId: string, commandName: string, stream: 'stdout' | 'stderr', chunk: string): void;
  flush(commandId: string, commandName: string): void;
  show(commandId: string, commandName: string): void;
  appendConfigMessage(message: string): void;
  dispose(): void;
}

// src/clipboardManager.ts
export class ClipboardManager {
  copy(text: string): Promise<void>;
}
```

---

### Task 1: Add `exitCode` to `LastResult`

The Commands view needs to show `✗ exit 1` for failed commands (spec §6.2), but Phase 1's `LastResult` doesn't carry the exit code. This task adds it and threads it through `commandRunner`.

**Files:**
- Modify: `src/types.ts:85-89`
- Modify: `src/commandRunner.ts:40-45` and `:80-84`
- Modify: `test/unit/statusManager.test.ts`

- [ ] **Step 1: Add `exitCode` to `LastResult` in `src/types.ts`**

Change:

```typescript
export interface LastResult {
  status: ExecutionStatus;
  endTime: number;
  durationMs: number;
}
```

to:

```typescript
export interface LastResult {
  status: ExecutionStatus;
  endTime: number;
  durationMs: number;
  exitCode: number | null;
}
```

- [ ] **Step 2: Update `src/commandRunner.ts` to populate `exitCode`**

In the "unsupported shell" branch (around line 40), change:

```typescript
      this.statusManager.finishExecution(resolved.id, -1, {
        status: 'invalid',
        endTime: Date.now(),
        durationMs: 0,
      });
```

to:

```typescript
      this.statusManager.finishExecution(resolved.id, -1, {
        status: 'invalid',
        endTime: Date.now(),
        durationMs: 0,
        exitCode: null,
      });
```

In the `child.on('exit', ...)` handler (around line 80), change:

```typescript
        this.statusManager.finishExecution(resolved.id, pid, {
          status,
          endTime,
          durationMs: endTime - startTime,
        });
```

to:

```typescript
        this.statusManager.finishExecution(resolved.id, pid, {
          status,
          endTime,
          durationMs: endTime - startTime,
          exitCode: code,
        });
```

- [ ] **Step 3: Update `test/unit/statusManager.test.ts` literals and add an `exitCode` assertion**

There are 4 occurrences of `{ status: 'success', endTime: 2000, durationMs: 1000 }` (lines 23, 36, 50, 62). Replace **all four** with `{ status: 'success', endTime: 2000, durationMs: 1000, exitCode: 0 }`, and update the corresponding `assert.deepEqual` expectations on lines 27 and 41 to match (add `exitCode: 0`).

Then add a new test at the end of the file:

```typescript
test('finishExecution stores exitCode on lastResult', () => {
  const manager = new StatusManager();
  manager.startExecution('build', 123, 1000);
  manager.finishExecution('build', 123, { status: 'failed', endTime: 2000, durationMs: 1000, exitCode: 1 });

  assert.equal(manager.getStatus('build').lastResult?.exitCode, 1);
});
```

- [ ] **Step 4: Run the full suite and verify it passes**

Run: `npm run compile && npm run test:unit`
Expected: PASS, 49 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/commandRunner.ts test/unit/statusManager.test.ts
git commit -m "feat: track exit code on LastResult"
```

---

### Task 2: Config file loading helpers (`configLoader.ts`)

`extension.ts` needs to find `.vscode/quick-command-runner.json` in the workspace and load it, returning `null` if it doesn't exist (so the UI can show the "Create Config" welcome view per spec §4.2). Following the existing `ShellResolutionContext` dependency-injection pattern from `processManager.ts`, this takes an injectable filesystem so it stays unit-testable without `vscode`.

**Files:**
- Modify: `src/configLoader.ts`
- Modify: `test/unit/configLoader.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the top of `test/unit/configLoader.test.ts`:

```typescript
import * as path from 'path';
```

(it already imports `parseConfig, validateConfig` from `'../../src/configLoader'` — change that import line to also bring in the new exports:)

```typescript
import { configFilePath, loadConfigFromFile, parseConfig, validateConfig } from '../../src/configLoader';
```

Then append these tests at the end of the file:

```typescript
test('configFilePath joins workspace folder with .vscode/quick-command-runner.json', () => {
  const result = configFilePath('/home/user/project');
  assert.equal(result, path.join('/home/user/project', '.vscode', 'quick-command-runner.json'));
});

test('loadConfigFromFile returns null when the file does not exist', () => {
  const fakeFs = { existsSync: () => false, readFileSync: () => '' };
  assert.equal(loadConfigFromFile('/workspace/.vscode/quick-command-runner.json', fakeFs), null);
});

test('loadConfigFromFile parses and validates an existing file', () => {
  const raw = JSON.stringify({
    groups: [{ name: 'Build', commands: [{ id: 'build', name: 'Build', command: 'npm run build' }] }],
  });
  const fakeFs = { existsSync: () => true, readFileSync: () => raw };

  const result = loadConfigFromFile('/workspace/.vscode/quick-command-runner.json', fakeFs);

  assert.ok(result);
  assert.equal(result?.validCommands.size, 1);
  assert.equal(result?.errors.length, 0);
});

test('loadConfigFromFile surfaces validation errors from the loaded config', () => {
  const raw = JSON.stringify({
    groups: [{ name: 'Build', commands: [{ id: 'bad', name: 'Bad' }] }],
  });
  const fakeFs = { existsSync: () => true, readFileSync: () => raw };

  const result = loadConfigFromFile('/workspace/.vscode/quick-command-runner.json', fakeFs);

  assert.ok(result);
  assert.equal(result?.invalidCommands.size, 1);
  assert.match(result?.errors[0].message ?? '', /exactly one/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run compile`
Expected: FAIL — `configFilePath` and `loadConfigFromFile` are not exported from `'../../src/configLoader'`.

- [ ] **Step 3: Implement `configFilePath` and `loadConfigFromFile`**

Add to the top of `src/configLoader.ts` (after the existing imports):

```typescript
import * as path from 'path';
```

Append to the end of `src/configLoader.ts`:

```typescript
export interface ConfigFileSystem {
  existsSync: (filePath: string) => boolean;
  readFileSync: (filePath: string, encoding: 'utf8') => string;
}

export function configFilePath(workspaceFolder: string): string {
  return path.join(workspaceFolder, '.vscode', 'quick-command-runner.json');
}

export function loadConfigFromFile(filePath: string, fs: ConfigFileSystem): ConfigLoadResult | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return validateConfig(parseConfig(raw));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run compile && npm run test:unit`
Expected: PASS, 53 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/configLoader.ts test/unit/configLoader.test.ts
git commit -m "feat: add config file path and loader helpers"
```

---

### Task 3: Default config scaffold (`defaultConfig.ts`)

The `quickCommandRunner.createConfig` command (spec §4.2) needs a bundled example to write out when no config exists. Keeping it as a typed TS object (rather than a bundled JSON resource file) means it's type-checked against `QuickCommandRunnerConfig` and trivially unit-testable.

**Files:**
- Create: `src/defaultConfig.ts`
- Create: `test/unit/defaultConfig.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/defaultConfig.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../../src/defaultConfig';
import { validateConfig } from '../../src/configLoader';

test('DEFAULT_CONFIG validates with no errors and at least one valid command', () => {
  const result = validateConfig(DEFAULT_CONFIG);

  assert.equal(result.errors.length, 0);
  assert.equal(result.invalidCommands.size, 0);
  assert.ok(result.validCommands.size >= 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run compile`
Expected: FAIL — cannot find module `'../../src/defaultConfig'`.

- [ ] **Step 3: Implement `src/defaultConfig.ts`**

```typescript
import { QuickCommandRunnerConfig } from './types';

export const DEFAULT_CONFIG: QuickCommandRunnerConfig = {
  groups: [
    {
      name: 'Build',
      commands: [
        {
          id: 'build',
          name: 'Build',
          description: 'Run the project build script',
          command: 'npm run build',
          shell: 'auto',
        },
      ],
    },
  ],
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run compile && npm run test:unit`
Expected: PASS, 54 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/defaultConfig.ts test/unit/defaultConfig.test.ts
git commit -m "feat: add default config scaffold for createConfig command"
```

---

### Task 4: Command view-model (`commandViewModel.ts`)

This is the core presentation logic for the Commands tree (spec §6.2, §6.3): mapping `ExecutionStatus` to icon/color, formatting the description text (`Running 12s`, `✓ 3.2s`, `✗ exit 1`, `Cancelled`, `Invalid config`), describing a command's command-line for tooltips, and filtering groups by search text. **No `vscode` import** — fully unit-tested.

**Files:**
- Create: `src/commandViewModel.ts`
- Create: `test/unit/commandViewModel.test.ts`

- [ ] **Step 1: Write failing tests for `STATUS_ICONS` and `deriveDisplayStatus`**

Create `test/unit/commandViewModel.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_ICONS,
  deriveDisplayStatus,
  formatStatusDescription,
  describeCommandLine,
  buildCommandViewState,
  filterGroups,
} from '../../src/commandViewModel';
import { CommandStatus, CommandGroup } from '../../src/types';

test('STATUS_ICONS defines an icon and color for every status', () => {
  assert.deepEqual(STATUS_ICONS, {
    idle: { icon: 'circle-outline', color: 'disabledForeground' },
    running: { icon: 'sync~spin', color: 'charts.yellow' },
    success: { icon: 'pass-filled', color: 'testing.iconPassed' },
    failed: { icon: 'error', color: 'testing.iconFailed' },
    cancelled: { icon: 'circle-slash', color: 'charts.orange' },
    invalid: { icon: 'warning', color: 'problemsWarningIcon.foreground' },
  });
});

test('deriveDisplayStatus: invalid config always wins', () => {
  const status: CommandStatus = { active: [{ pid: 1, startTime: 0 }], lastResult: null };
  assert.equal(deriveDisplayStatus(status, true), 'invalid');
});

test('deriveDisplayStatus: active executions mean running', () => {
  const status: CommandStatus = { active: [{ pid: 1, startTime: 0 }], lastResult: null };
  assert.equal(deriveDisplayStatus(status, false), 'running');
});

test('deriveDisplayStatus: no active executions falls back to lastResult.status', () => {
  const status: CommandStatus = {
    active: [],
    lastResult: { status: 'failed', endTime: 1000, durationMs: 500, exitCode: 1 },
  };
  assert.equal(deriveDisplayStatus(status, false), 'failed');
});

test('deriveDisplayStatus: never run is idle', () => {
  const status: CommandStatus = { active: [], lastResult: null };
  assert.equal(deriveDisplayStatus(status, false), 'idle');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run compile`
Expected: FAIL — cannot find module `'../../src/commandViewModel'`.

- [ ] **Step 3: Implement `STATUS_ICONS` and `deriveDisplayStatus`**

Create `src/commandViewModel.ts`:

```typescript
import { CommandDefinition, CommandGroup, CommandStatus, ExecutionStatus } from './types';

export const STATUS_ICONS: Record<ExecutionStatus, { icon: string; color: string }> = {
  idle: { icon: 'circle-outline', color: 'disabledForeground' },
  running: { icon: 'sync~spin', color: 'charts.yellow' },
  success: { icon: 'pass-filled', color: 'testing.iconPassed' },
  failed: { icon: 'error', color: 'testing.iconFailed' },
  cancelled: { icon: 'circle-slash', color: 'charts.orange' },
  invalid: { icon: 'warning', color: 'problemsWarningIcon.foreground' },
};

export function deriveDisplayStatus(status: CommandStatus, isInvalid: boolean): ExecutionStatus {
  if (isInvalid) {
    return 'invalid';
  }
  if (status.active.length > 0) {
    return 'running';
  }
  return status.lastResult?.status ?? 'idle';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run compile && npm run test:unit`
Expected: PASS, 58 tests, 0 failures.

- [ ] **Step 5: Write failing tests for `formatStatusDescription`**

Append to `test/unit/commandViewModel.test.ts`:

```typescript
test('formatStatusDescription: running shows elapsed seconds', () => {
  const status: CommandStatus = { active: [{ pid: 1, startTime: 1000 }], lastResult: null };
  assert.equal(formatStatusDescription('running', status, 13000), 'Running 12s');
});

test('formatStatusDescription: running with multiple active executions shows count', () => {
  const status: CommandStatus = {
    active: [{ pid: 1, startTime: 1000 }, { pid: 2, startTime: 2000 }],
    lastResult: null,
  };
  assert.equal(formatStatusDescription('running', status, 13000), 'Running 12s ×2');
});

test('formatStatusDescription: success shows duration in seconds', () => {
  const status: CommandStatus = {
    active: [],
    lastResult: { status: 'success', endTime: 5000, durationMs: 3200, exitCode: 0 },
  };
  assert.equal(formatStatusDescription('success', status, 0), '✓ 3.2s');
});

test('formatStatusDescription: failed shows exit code', () => {
  const status: CommandStatus = {
    active: [],
    lastResult: { status: 'failed', endTime: 5000, durationMs: 100, exitCode: 1 },
  };
  assert.equal(formatStatusDescription('failed', status, 0), '✗ exit 1');
});

test('formatStatusDescription: failed with no exit code shows ?', () => {
  const status: CommandStatus = {
    active: [],
    lastResult: { status: 'failed', endTime: 5000, durationMs: 100, exitCode: null },
  };
  assert.equal(formatStatusDescription('failed', status, 0), '✗ exit ?');
});

test('formatStatusDescription: cancelled', () => {
  const status: CommandStatus = { active: [], lastResult: null };
  assert.equal(formatStatusDescription('cancelled', status, 0), 'Cancelled');
});

test('formatStatusDescription: invalid', () => {
  const status: CommandStatus = { active: [], lastResult: null };
  assert.equal(formatStatusDescription('invalid', status, 0), 'Invalid config');
});

test('formatStatusDescription: idle is empty', () => {
  const status: CommandStatus = { active: [], lastResult: null };
  assert.equal(formatStatusDescription('idle', status, 0), '');
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npm run compile`
Expected: FAIL — `formatStatusDescription` is not exported.

- [ ] **Step 7: Implement `formatStatusDescription`**

Append to `src/commandViewModel.ts`:

```typescript
export function formatStatusDescription(status: ExecutionStatus, commandStatus: CommandStatus, now: number): string {
  switch (status) {
    case 'running': {
      const start = commandStatus.active[0]?.startTime ?? now;
      const seconds = Math.max(0, Math.floor((now - start) / 1000));
      return commandStatus.active.length > 1 ? `Running ${seconds}s ×${commandStatus.active.length}` : `Running ${seconds}s`;
    }
    case 'success': {
      const durationMs = commandStatus.lastResult?.durationMs ?? 0;
      return `✓ ${(durationMs / 1000).toFixed(1)}s`;
    }
    case 'failed': {
      const exitCode = commandStatus.lastResult?.exitCode;
      return `✗ exit ${exitCode ?? '?'}`;
    }
    case 'cancelled':
      return 'Cancelled';
    case 'invalid':
      return 'Invalid config';
    case 'idle':
    default:
      return '';
  }
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run compile && npm run test:unit`
Expected: PASS, 66 tests, 0 failures.

- [ ] **Step 9: Write failing tests for `describeCommandLine` and `buildCommandViewState`**

Append to `test/unit/commandViewModel.test.ts`:

```typescript
test('describeCommandLine: command-based definition returns the command string', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', command: 'npm run build' };
  assert.equal(describeCommandLine(def), 'npm run build');
});

test('describeCommandLine: file-based definition joins file and args', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', file: 'scripts/build.sh', args: ['--release'] };
  assert.equal(describeCommandLine(def), 'scripts/build.sh --release');
});

test('describeCommandLine: file-based definition with no args returns just the file', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', file: 'scripts/run.py' };
  assert.equal(describeCommandLine(def), 'scripts/run.py');
});

test('buildCommandViewState: combines status, description, tooltip, contextValue, and icon', () => {
  const def: CommandDefinition = {
    id: 'build',
    name: 'Build',
    command: 'npm run build',
    cwd: '/workspace',
    description: 'Builds the project',
  };
  const status: CommandStatus = {
    active: [],
    lastResult: { status: 'success', endTime: 5000, durationMs: 3200, exitCode: 0 },
  };

  const viewState = buildCommandViewState(def, status, false, 0);

  assert.deepEqual(viewState, {
    status: 'success',
    description: '✓ 3.2s',
    tooltip: 'npm run build\ncwd: /workspace\nBuilds the project',
    contextValue: 'cmd.success',
    iconId: 'pass-filled',
    iconColor: 'testing.iconPassed',
  });
});
```

- [ ] **Step 10: Run the tests to verify they fail**

Run: `npm run compile`
Expected: FAIL — `describeCommandLine` and `buildCommandViewState` are not exported.

- [ ] **Step 11: Implement `describeCommandLine` and `buildCommandViewState`**

Append to `src/commandViewModel.ts`:

```typescript
export function describeCommandLine(def: CommandDefinition): string {
  if (def.command) {
    return def.command;
  }
  if (def.file) {
    return [def.file, ...(def.args ?? [])].join(' ');
  }
  return '';
}

export interface CommandViewState {
  status: ExecutionStatus;
  description: string;
  tooltip: string;
  contextValue: string;
  iconId: string;
  iconColor: string;
}

export function buildCommandViewState(
  def: CommandDefinition,
  commandStatus: CommandStatus,
  isInvalid: boolean,
  now: number,
): CommandViewState {
  const status = deriveDisplayStatus(commandStatus, isInvalid);
  const { icon, color } = STATUS_ICONS[status];

  const tooltipLines = [describeCommandLine(def)];
  if (def.cwd) {
    tooltipLines.push(`cwd: ${def.cwd}`);
  }
  if (def.description) {
    tooltipLines.push(def.description);
  }

  return {
    status,
    description: formatStatusDescription(status, commandStatus, now),
    tooltip: tooltipLines.join('\n'),
    contextValue: `cmd.${status}`,
    iconId: icon,
    iconColor: color,
  };
}
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npm run compile && npm run test:unit`
Expected: PASS, 70 tests, 0 failures.

- [ ] **Step 13: Write failing tests for `filterGroups`**

Append to `test/unit/commandViewModel.test.ts`:

```typescript
const SAMPLE_GROUPS: CommandGroup[] = [
  {
    name: 'Build',
    commands: [
      { id: 'build', name: 'Build', command: 'npm run build', description: 'Compile the project' },
      { id: 'lint', name: 'Lint', command: 'npm run lint' },
    ],
  },
  {
    name: 'Docker',
    commands: [{ id: 'compose-up', name: 'Compose Up', command: 'docker compose up', description: 'Start containers' }],
  },
];

test('filterGroups: empty filter text returns all groups unchanged', () => {
  assert.deepEqual(filterGroups(SAMPLE_GROUPS, ''), SAMPLE_GROUPS);
});

test('filterGroups: matches command name case-insensitively', () => {
  const result = filterGroups(SAMPLE_GROUPS, 'lint');
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Build');
  assert.deepEqual(result[0].commands.map((c) => c.id), ['lint']);
});

test('filterGroups: matches command description', () => {
  const result = filterGroups(SAMPLE_GROUPS, 'containers');
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Docker');
});

test('filterGroups: groups with no matches are removed', () => {
  const result = filterGroups(SAMPLE_GROUPS, 'compose');
  assert.deepEqual(result.map((g) => g.name), ['Docker']);
});

test('filterGroups: no matches returns empty array', () => {
  assert.deepEqual(filterGroups(SAMPLE_GROUPS, 'nonexistent'), []);
});
```

- [ ] **Step 14: Run the tests to verify they fail**

Run: `npm run compile`
Expected: FAIL — `filterGroups` is not exported.

- [ ] **Step 15: Implement `filterGroups`**

Append to `src/commandViewModel.ts`:

```typescript
export function filterGroups(groups: CommandGroup[], filterText: string): CommandGroup[] {
  const needle = filterText.trim().toLowerCase();
  if (!needle) {
    return groups;
  }

  return groups
    .map((group) => ({
      ...group,
      commands: group.commands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(needle) || (cmd.description ?? '').toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.commands.length > 0);
}
```

- [ ] **Step 16: Run the full suite to verify it passes**

Run: `npm run compile && npm run test:unit`
Expected: PASS, 75 tests, 0 failures.

- [ ] **Step 17: Lint and commit**

Run: `npm run lint`
Expected: no errors.

```bash
git add src/commandViewModel.ts test/unit/commandViewModel.test.ts
git commit -m "feat: add command view-model (status icons, descriptions, filtering)"
```

---

### Task 5: `LogManager.clear()`

Spec §9.1: `quickCommandRunner.clearLog(id)` → `channel.clear()`. Phase 1's `LogManager` has `show` but not `clear`. This is a one-method addition to a `vscode`-dependent class — no unit test (consistent with the rest of `logManager.ts`), verified by `npm run compile`.

**Files:**
- Modify: `src/logManager.ts:40-43`

- [ ] **Step 1: Add `clear` next to `show`**

In `src/logManager.ts`, change:

```typescript
  show(commandId: string, commandName: string): void {
    this.getChannel(commandId, commandName).show(true);
  }
```

to:

```typescript
  show(commandId: string, commandName: string): void {
    this.getChannel(commandId, commandName).show(true);
  }

  clear(commandId: string, commandName: string): void {
    this.getChannel(commandId, commandName).clear();
  }
```

- [ ] **Step 2: Compile and lint**

Run: `npm run compile && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/logManager.ts
git commit -m "feat: add LogManager.clear for the Clear Log command"
```

---

### Task 6: `CommandTreeItem`, `GroupTreeItem`, and `CommandProvider` (`commandProvider.ts`)

The `vscode.TreeDataProvider` for the "Commands" view (spec §6.1-6.3). Root nodes are config groups (Favorites/Recent sections are Phase 4); each group's children are commands rendered via `commandViewModel.buildCommandViewState`. Supports an in-memory search filter and refreshes when `StatusManager` reports a status change. No unit test — `vscode`-dependent, verified by `npm run compile`.

**Files:**
- Create: `src/commandProvider.ts`

- [ ] **Step 1: Implement `src/commandProvider.ts`**

```typescript
import * as vscode from 'vscode';
import { CommandDefinition, CommandGroup, ConfigLoadResult } from './types';
import { StatusManager, StatusChangeSubscription } from './statusManager';
import { buildCommandViewState, filterGroups } from './commandViewModel';

export class GroupTreeItem extends vscode.TreeItem {
  constructor(public readonly group: CommandGroup) {
    super(group.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'group';
  }
}

export class CommandTreeItem extends vscode.TreeItem {
  constructor(public readonly def: CommandDefinition, isInvalid: boolean, statusManager: StatusManager) {
    super(def.name, vscode.TreeItemCollapsibleState.None);

    const status = statusManager.getStatus(def.id);
    const viewState = buildCommandViewState(def, status, isInvalid, Date.now());

    this.description = viewState.description;
    this.tooltip = viewState.tooltip;
    this.contextValue = viewState.contextValue;
    this.iconPath = new vscode.ThemeIcon(viewState.iconId, new vscode.ThemeColor(viewState.iconColor));
  }
}

export type CommandNode = GroupTreeItem | CommandTreeItem;

export class CommandProvider implements vscode.TreeDataProvider<CommandNode>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<CommandNode | undefined | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private filterText = '';
  private readonly statusSubscription: StatusChangeSubscription;

  constructor(
    private readonly getConfig: () => ConfigLoadResult,
    private readonly statusManager: StatusManager,
  ) {
    this.statusSubscription = statusManager.onDidChangeStatus(() => this.refresh());
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getFilter(): string {
    return this.filterText;
  }

  setFilter(text: string): void {
    this.filterText = text;
    this.refresh();
  }

  clearFilter(): void {
    this.filterText = '';
    this.refresh();
  }

  getTreeItem(element: CommandNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CommandNode): CommandNode[] {
    const { config, invalidCommands } = this.getConfig();
    const groups = filterGroups(config.groups, this.filterText);

    if (!element) {
      return groups.map((group) => new GroupTreeItem(group));
    }

    if (element instanceof GroupTreeItem) {
      return element.group.commands.map((def) => {
        const isInvalid = invalidCommands.has(`${element.group.name}/${def.id}`);
        return new CommandTreeItem(def, isInvalid, this.statusManager);
      });
    }

    return [];
  }

  dispose(): void {
    this.statusSubscription.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }
}
```

- [ ] **Step 2: Compile and lint**

Run: `npm run compile && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/commandProvider.ts
git commit -m "feat: add CommandProvider TreeDataProvider for the Commands view"
```

---

### Task 7: `package.json` contributions (views, configuration, commands, menus) + activity bar icon

Declares the Activity Bar container, the "Commands" view, its empty-state welcome view, the two settings used by Phase 2 (`showNotifications`, `cancelGracePeriodMs`), the commands, and the menus (inline run/cancel toggle, context menu, view toolbar). The fuller example config and final icon polish are Phase 5 (spec §13) — this icon is a functional placeholder so the view container renders.

**Files:**
- Create: `icons/activity-bar-icon.svg`
- Modify: `package.json`

- [ ] **Step 1: Create the placeholder activity bar icon**

Create `icons/activity-bar-icon.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
  <path d="M9 9l4 3-4 3V9z" fill="currentColor"/>
</svg>
```

- [ ] **Step 2: Add `activationEvents` and `contributes` to `package.json`**

In `package.json`, after the `"categories": ["Other"],` line, add:

```json
  "activationEvents": ["onStartupFinished"],
```

Then, after the `"main": "./out/src/extension.js",` line, add the full `"contributes"` block:

```json
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "quickCommandRunner",
          "title": "Quick Command Runner",
          "icon": "icons/activity-bar-icon.svg"
        }
      ]
    },
    "views": {
      "quickCommandRunner": [
        {
          "id": "quickCommandRunnerCommands",
          "name": "Commands"
        }
      ]
    },
    "viewsWelcome": [
      {
        "view": "quickCommandRunnerCommands",
        "contents": "No configuration file found.\n[Create Config](command:quickCommandRunner.createConfig)",
        "when": "!quickCommandRunner.configExists"
      }
    ],
    "configuration": {
      "title": "Quick Command Runner",
      "properties": {
        "quickCommandRunner.showNotifications": {
          "type": "boolean",
          "default": true,
          "description": "Show start/finish notifications for command executions."
        },
        "quickCommandRunner.cancelGracePeriodMs": {
          "type": "number",
          "default": 3000,
          "description": "Delay in milliseconds between SIGTERM and SIGKILL when cancelling a running command."
        }
      }
    },
    "commands": [
      { "command": "quickCommandRunner.run", "title": "Run", "icon": "$(play)" },
      { "command": "quickCommandRunner.cancel", "title": "Cancel", "icon": "$(debug-stop)" },
      { "command": "quickCommandRunner.refresh", "title": "Refresh", "icon": "$(refresh)", "category": "Quick Command Runner" },
      { "command": "quickCommandRunner.search", "title": "Search Commands", "icon": "$(search)", "category": "Quick Command Runner" },
      { "command": "quickCommandRunner.clearFilter", "title": "Clear Filter", "icon": "$(clear-all)", "category": "Quick Command Runner" },
      { "command": "quickCommandRunner.openLog", "title": "Open Log", "category": "Quick Command Runner" },
      { "command": "quickCommandRunner.clearLog", "title": "Clear Log", "category": "Quick Command Runner" },
      { "command": "quickCommandRunner.copyCommandLine", "title": "Copy Command Line", "category": "Quick Command Runner" },
      { "command": "quickCommandRunner.createConfig", "title": "Create Config", "category": "Quick Command Runner" }
    ],
    "menus": {
      "view/title": [
        { "command": "quickCommandRunner.refresh", "when": "view == quickCommandRunnerCommands", "group": "navigation@1" },
        { "command": "quickCommandRunner.search", "when": "view == quickCommandRunnerCommands", "group": "navigation@2" },
        { "command": "quickCommandRunner.clearFilter", "when": "view == quickCommandRunnerCommands && quickCommandRunner.filterActive", "group": "navigation@3" }
      ],
      "view/item/context": [
        {
          "command": "quickCommandRunner.run",
          "when": "view == quickCommandRunnerCommands && viewItem =~ /^cmd\\.(idle|success|failed|cancelled)$/",
          "group": "inline"
        },
        {
          "command": "quickCommandRunner.cancel",
          "when": "view == quickCommandRunnerCommands && viewItem == cmd.running",
          "group": "inline"
        },
        {
          "command": "quickCommandRunner.openLog",
          "when": "view == quickCommandRunnerCommands && viewItem =~ /^cmd\\./",
          "group": "1_log"
        },
        {
          "command": "quickCommandRunner.clearLog",
          "when": "view == quickCommandRunnerCommands && viewItem =~ /^cmd\\./",
          "group": "1_log"
        },
        {
          "command": "quickCommandRunner.copyCommandLine",
          "when": "view == quickCommandRunnerCommands && viewItem =~ /^cmd\\./",
          "group": "2_copy"
        }
      ]
    }
  },
```

- [ ] **Step 3: Validate the JSON and run the existing suite**

Run: `node -e "require('./package.json')" && npm run compile && npm run test:unit`
Expected: no errors, 75 tests pass (this task doesn't touch `src/`, so the count is unchanged from Task 4).

- [ ] **Step 4: Commit**

```bash
git add package.json icons/activity-bar-icon.svg
git commit -m "feat: contribute Commands view, settings, commands, and menus"
```

---

### Task 8: Extension activation (`extension.ts`)

Wires everything together: loads and watches the config file, constructs `StatusManager`/`LogManager`/`ClipboardManager`/`CommandRunner`/`CommandProvider`, registers the tree view and all commands declared in Task 7, and shows start/finish notifications gated by `quickCommandRunner.showNotifications`. `vscode`-dependent — no unit test, verified by `npm run compile`.

**Files:**
- Create: `src/extension.ts`

- [ ] **Step 1: Implement `src/extension.ts`**

```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CommandDefinition, ConfigLoadResult } from './types';
import { configFilePath, loadConfigFromFile } from './configLoader';
import { DEFAULT_CONFIG } from './defaultConfig';
import { StatusManager } from './statusManager';
import { LogManager } from './logManager';
import { ClipboardManager } from './clipboardManager';
import { CommandRunner } from './commandRunner';
import { CommandProvider, CommandTreeItem } from './commandProvider';
import { describeCommandLine } from './commandViewModel';

const EMPTY_CONFIG: ConfigLoadResult = {
  config: { groups: [] },
  validCommands: new Map(),
  invalidCommands: new Map(),
  errors: [],
};

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const workspaceFolder = folder?.uri.fsPath;

  const statusManager = new StatusManager();
  const logManager = new LogManager();
  const clipboardManager = new ClipboardManager();

  let configResult: ConfigLoadResult = EMPTY_CONFIG;

  const reloadConfig = (): void => {
    if (!workspaceFolder) {
      configResult = EMPTY_CONFIG;
      void vscode.commands.executeCommand('setContext', 'quickCommandRunner.configExists', false);
      return;
    }

    const filePath = configFilePath(workspaceFolder);
    const result = loadConfigFromFile(filePath, fs);
    configResult = result ?? EMPTY_CONFIG;

    for (const error of configResult.errors) {
      logManager.appendConfigMessage(error.message);
    }

    void vscode.commands.executeCommand('setContext', 'quickCommandRunner.configExists', result !== null);
  };

  reloadConfig();

  const provider = new CommandProvider(() => configResult, statusManager);
  const treeView = vscode.window.createTreeView('quickCommandRunnerCommands', {
    treeDataProvider: provider,
  });

  const cancelGracePeriodMs = vscode.workspace
    .getConfiguration('quickCommandRunner')
    .get<number>('cancelGracePeriodMs', 3000);

  const runner = workspaceFolder
    ? new CommandRunner(statusManager, logManager, { workspaceFolder, cancelGracePeriodMs })
    : undefined;

  const showNotificationsEnabled = (): boolean =>
    vscode.workspace.getConfiguration('quickCommandRunner').get<boolean>('showNotifications', true);

  const runCommand = async (def: CommandDefinition): Promise<void> => {
    if (!runner) {
      void vscode.window.showErrorMessage('Quick Command Runner: no workspace folder is open.');
      return;
    }

    if (!showNotificationsEnabled()) {
      await runner.run(def);
      return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Running "${def.name}"`, cancellable: true },
      async (_progress, token) => {
        token.onCancellationRequested(() => runner.cancel(def.id));
        await runner.run(def);
      },
    );

    const lastResult = statusManager.getStatus(def.id).lastResult;
    if (lastResult?.status === 'success') {
      void vscode.window.showInformationMessage(`"${def.name}" completed successfully.`);
    } else if (lastResult?.status === 'failed') {
      void vscode.window.showErrorMessage(`"${def.name}" failed (exit ${lastResult.exitCode ?? '?'}).`);
    } else if (lastResult?.status === 'cancelled') {
      void vscode.window.showWarningMessage(`"${def.name}" was cancelled.`);
    }
  };

  context.subscriptions.push(
    treeView,
    provider,
    logManager,

    vscode.commands.registerCommand('quickCommandRunner.run', async (item?: CommandTreeItem) => {
      if (!item) {
        return;
      }
      const def = configResult.validCommands.get(item.def.id);
      if (!def) {
        return;
      }
      await runCommand(def);
    }),

    vscode.commands.registerCommand('quickCommandRunner.cancel', (item?: CommandTreeItem) => {
      if (!item || !runner) {
        return;
      }
      runner.cancel(item.def.id);
    }),

    vscode.commands.registerCommand('quickCommandRunner.refresh', () => {
      reloadConfig();
      provider.refresh();
    }),

    vscode.commands.registerCommand('quickCommandRunner.search', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'Filter commands by name or description',
        value: provider.getFilter(),
      });
      if (value === undefined) {
        return;
      }
      provider.setFilter(value);
      void vscode.commands.executeCommand('setContext', 'quickCommandRunner.filterActive', value.length > 0);
    }),

    vscode.commands.registerCommand('quickCommandRunner.clearFilter', () => {
      provider.clearFilter();
      void vscode.commands.executeCommand('setContext', 'quickCommandRunner.filterActive', false);
    }),

    vscode.commands.registerCommand('quickCommandRunner.openLog', (item?: CommandTreeItem) => {
      if (!item) {
        return;
      }
      logManager.show(item.def.id, item.def.name);
    }),

    vscode.commands.registerCommand('quickCommandRunner.clearLog', (item?: CommandTreeItem) => {
      if (!item) {
        return;
      }
      logManager.clear(item.def.id, item.def.name);
    }),

    vscode.commands.registerCommand('quickCommandRunner.copyCommandLine', async (item?: CommandTreeItem) => {
      if (!item) {
        return;
      }
      await clipboardManager.copy(describeCommandLine(item.def));
      if (showNotificationsEnabled()) {
        void vscode.window.showInformationMessage('Command line copied to clipboard.');
      }
    }),

    vscode.commands.registerCommand('quickCommandRunner.createConfig', () => {
      if (!workspaceFolder) {
        void vscode.window.showErrorMessage('Quick Command Runner: no workspace folder is open.');
        return;
      }

      const filePath = configFilePath(workspaceFolder);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n', 'utf8');

      reloadConfig();
      provider.refresh();
      void vscode.window.showInformationMessage('Created .vscode/quick-command-runner.json');
    }),
  );

  if (folder) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '.vscode/quick-command-runner.json'),
    );
    const onChange = (): void => {
      reloadConfig();
      provider.refresh();
    };
    watcher.onDidCreate(onChange);
    watcher.onDidChange(onChange);
    watcher.onDidDelete(onChange);
    context.subscriptions.push(watcher);
  }
}

export function deactivate(): void {}
```

- [ ] **Step 2: Compile and lint**

Run: `npm run compile && npm run lint`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test:unit`
Expected: PASS, 75 tests, 0 failures (extension.ts has no unit tests; this confirms it didn't break anything else).

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire extension activation, commands, and config watching"
```

---

### Task 9: Debug launch config and final verification

Adds `.vscode/launch.json`/`tasks.json` so a developer can press F5 to open an Extension Development Host with this extension loaded (spec §11), then runs the full verification suite for Phase 2.

**Files:**
- Create: `.vscode/launch.json`
- Create: `.vscode/tasks.json`

- [ ] **Step 1: Create `.vscode/tasks.json`**

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "watch",
      "problemMatcher": "$tsc-watch",
      "isBackground": true,
      "presentation": { "reveal": "never" },
      "group": { "kind": "build", "isDefault": true }
    }
  ]
}
```

- [ ] **Step 2: Create `.vscode/launch.json`**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/out/**/*.js"],
      "preLaunchTask": "${defaultBuildTask}"
    }
  ]
}
```

- [ ] **Step 3: Run full verification**

Run: `npm run compile && npm run lint && npm run test:unit`
Expected: compile clean, lint clean, 75 tests pass, 0 failures, 0 cancelled.

- [ ] **Step 4: Commit**

```bash
git add .vscode/launch.json .vscode/tasks.json
git commit -m "chore: add F5 debug launch configuration"
```

---

## Manual smoke test (informational — not executable in this sandbox)

This sandbox has no display, so `vscode-test`/Extension Development Host can't run here. After merging, a developer with VS Code should:

1. Open this folder in VS Code, press F5 ("Run Extension").
2. In the Extension Development Host window, open a folder with no `.vscode/quick-command-runner.json` — confirm the "Commands" view shows the "Create Config" welcome view, and clicking it creates the file with the `DEFAULT_CONFIG` contents.
3. Edit the config to add a `command: "echo hello && sleep 5"` entry; confirm it appears under its group with the idle icon.
4. Click the inline Run (▶) button — confirm the icon switches to a spinning sync icon, the description shows `Running Ns`, a progress notification appears, and the inline button becomes Cancel (■).
5. Let it finish — confirm the icon becomes a green check, description shows `✓ N.Ns`, and a completion toast appears.
6. Use the toolbar Search button to filter commands by name; confirm non-matching groups disappear and "Clear Filter" appears.
7. Right-click a command — confirm "Open Log", "Clear Log", and "Copy Command Line" all work.

## Spec gap carried over from Phase 1 review

The Phase 1 final reviewer noted spec §5.3's timeout log line (`[timeout] Command exceeded {timeout}ms and was terminated.`) is not yet implemented in `commandRunner.ts`. This is **not** addressed in Phase 2 (it's orthogonal to the tree UI) — track it for Phase 3 or 4.
