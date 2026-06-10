# Quick Command Runner — Phase 1: Core Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the project scaffold and the headless core engine (types, config validation, shell resolution, process spawn/cancel, in-memory status tracking, output logging, and the run/cancel orchestrator) — everything Phase 2 (sidebar UI) will build on.

**Architecture:** Pure-logic modules (`configLoader`, the shell-resolution and spawn-arg-building parts of `processManager`, `statusManager`) are written with zero `vscode` imports and unit-tested with `node --test` against compiled output. `clipboardManager`, `logManager`, and `commandRunner` depend on the `vscode` API (OutputChannel, clipboard) and are verified by `npm run compile` only in this phase — full integration tests are added in the packaging phase.

**Tech Stack:** TypeScript (strict), `cross-spawn`, `tree-kill`, `node:test` + `node:assert/strict`, ESLint flat config (`typescript-eslint`).

Reference spec: `docs/superpowers/specs/2026-06-10-quick-command-runner-design.md`

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `src/` (directory)
- Create: `test/unit/` (directory)

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p src test/unit
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "quick-command-runner",
  "displayName": "Quick Command Runner",
  "description": "Run frequently-used commands, scripts, and tools from a VS Code sidebar with execution tracking, history, and automatic path detection.",
  "version": "0.1.0",
  "publisher": "your-publisher-name",
  "private": true,
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "main": "./out/src/extension.js",
  "scripts": {
    "compile": "tsc -p ./",
    "watch": "tsc -w -p ./",
    "lint": "eslint src test",
    "pretest": "npm run compile",
    "test:unit": "node --test 'out/test/**/*.test.js'",
    "test": "npm run test:unit"
  },
  "dependencies": {
    "cross-spawn": "^7.0.3",
    "tree-kill": "^1.2.2"
  },
  "devDependencies": {
    "@types/cross-spawn": "^6.0.6",
    "@types/node": "^20.14.0",
    "@types/vscode": "^1.85.0",
    "eslint": "^9.9.0",
    "typescript": "^5.5.4",
    "typescript-eslint": "^8.0.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": ".",
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", ".vscode-test", "out"]
}
```

- [ ] **Step 4: Write `eslint.config.mjs`**

```javascript
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['out/**', 'node_modules/**', '.vscode-test/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
```

- [ ] **Step 5: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` populated, `package-lock.json` created, no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json eslint.config.mjs
git commit -m "chore: scaffold TypeScript project for Quick Command Runner"
```

---

### Task 2: Shared Types (`types.ts`)

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```typescript
export type ShellType =
  | 'auto'
  | 'bash'
  | 'gitbash'
  | 'wsl'
  | 'cmd'
  | 'powershell'
  | 'pwsh'
  | 'sh'
  | 'zsh';

export type ExecutionStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'invalid';

export interface CommandDefinition {
  id: string;
  name: string;
  description?: string;
  shell?: ShellType;
  command?: string;
  file?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  autoCopyPath?: boolean;
  autoOpenLog?: boolean;
  allowParallelExecution?: boolean;
}

export interface CommandGroup {
  name: string;
  commands: CommandDefinition[];
}

export interface QuickCommandRunnerConfig {
  groups: CommandGroup[];
}

export interface ConfigValidationError {
  commandId?: string;
  groupName?: string;
  message: string;
}

export interface ConfigLoadResult {
  config: QuickCommandRunnerConfig;
  validCommands: Map<string, CommandDefinition>;
  invalidCommands: Map<string, ConfigValidationError>;
  errors: ConfigValidationError[];
}

export interface HistoryEntry {
  entryId: string;
  commandId: string;
  commandSnapshot: CommandDefinition;
  fullCommand: string;
  shell: ShellType;
  cwd: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  exitCode: number | null;
  status: ExecutionStatus;
  stdout: string;
  stderr: string;
  extractedPaths: string[];
}

export interface ResolvedShell {
  executable: string;
  shellArgs: string[];
}

export interface ActiveExecution {
  pid: number;
  startTime: number;
}

export interface LastResult {
  status: ExecutionStatus;
  endTime: number;
  durationMs: number;
}

export interface CommandStatus {
  active: ActiveExecution[];
  lastResult: LastResult | null;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run compile
```

Expected: succeeds, produces `out/src/types.js`.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared types for Quick Command Runner"
```

---

### Task 3: Config Loader — Parsing & Validation (`configLoader.ts`)

**Files:**
- Create: `src/configLoader.ts`
- Test: `test/unit/configLoader.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/unit/configLoader.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, validateConfig } from '../../src/configLoader';

test('parseConfig returns empty groups for invalid JSON', () => {
  assert.deepEqual(parseConfig('not json'), { groups: [] });
});

test('parseConfig returns empty groups when "groups" is missing', () => {
  assert.deepEqual(parseConfig('{}'), { groups: [] });
});

test('parseConfig returns the parsed config for valid JSON', () => {
  const raw = JSON.stringify({ groups: [{ name: 'Build', commands: [] }] });
  assert.deepEqual(parseConfig(raw), { groups: [{ name: 'Build', commands: [] }] });
});

test('validateConfig accepts a command with only "command" set', () => {
  const result = validateConfig({
    groups: [{ name: 'Build', commands: [{ id: 'build', name: 'Build', command: 'npm run build' }] }],
  });
  assert.equal(result.validCommands.size, 1);
  assert.equal(result.invalidCommands.size, 0);
  assert.ok(result.validCommands.has('build'));
});

test('validateConfig accepts a command with only "file" set', () => {
  const result = validateConfig({
    groups: [{ name: 'Build', commands: [{ id: 'build', name: 'Build', file: 'build.sh' }] }],
  });
  assert.equal(result.validCommands.size, 1);
  assert.equal(result.invalidCommands.size, 0);
});

test('validateConfig rejects a command with both "command" and "file"', () => {
  const result = validateConfig({
    groups: [
      {
        name: 'Build',
        commands: [{ id: 'build', name: 'Build', command: 'npm run build', file: 'build.sh' }],
      },
    ],
  });
  assert.equal(result.validCommands.size, 0);
  assert.equal(result.invalidCommands.size, 1);
  assert.match(result.errors[0].message, /exactly one/);
});

test('validateConfig rejects a command with neither "command" nor "file"', () => {
  const result = validateConfig({
    groups: [{ name: 'Build', commands: [{ id: 'build', name: 'Build' }] }],
  });
  assert.equal(result.invalidCommands.size, 1);
  assert.match(result.errors[0].message, /exactly one/);
});

test('validateConfig rejects an unknown shell value', () => {
  const result = validateConfig({
    groups: [
      {
        name: 'Build',
        commands: [{ id: 'build', name: 'Build', command: 'echo hi', shell: 'fish' as never }],
      },
    ],
  });
  assert.equal(result.invalidCommands.size, 1);
  assert.match(result.errors[0].message, /unknown shell/);
});

test('validateConfig rejects duplicate ids across groups', () => {
  const result = validateConfig({
    groups: [
      { name: 'Build', commands: [{ id: 'dup', name: 'A', command: 'echo a' }] },
      { name: 'Test', commands: [{ id: 'dup', name: 'B', command: 'echo b' }] },
    ],
  });
  assert.equal(result.validCommands.size, 1);
  assert.equal(result.invalidCommands.size, 1);
  assert.match(result.errors[0].message, /Duplicate command id/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run compile && npm run test:unit
```

Expected: FAIL — `Cannot find module '../../src/configLoader'`.

- [ ] **Step 3: Write `src/configLoader.ts`**

```typescript
import {
  CommandDefinition,
  ConfigLoadResult,
  ConfigValidationError,
  QuickCommandRunnerConfig,
  ShellType,
} from './types';

const VALID_SHELLS: ShellType[] = [
  'auto',
  'bash',
  'gitbash',
  'wsl',
  'cmd',
  'powershell',
  'pwsh',
  'sh',
  'zsh',
];

export function parseConfig(raw: string): QuickCommandRunnerConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { groups: [] };
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { groups?: unknown }).groups)
  ) {
    return { groups: [] };
  }
  return parsed as QuickCommandRunnerConfig;
}

export function validateConfig(config: QuickCommandRunnerConfig): ConfigLoadResult {
  const validCommands = new Map<string, CommandDefinition>();
  const invalidCommands = new Map<string, ConfigValidationError>();
  const errors: ConfigValidationError[] = [];
  const seenIds = new Set<string>();

  for (const group of config.groups ?? []) {
    for (const cmd of group.commands ?? []) {
      const hasCommand = typeof cmd.command === 'string' && cmd.command.length > 0;
      const hasFile = typeof cmd.file === 'string' && cmd.file.length > 0;

      if (hasCommand === hasFile) {
        const error: ConfigValidationError = {
          commandId: cmd.id,
          groupName: group.name,
          message: `Command "${cmd.id}" must set exactly one of "command" or "file" (found ${
            hasCommand ? 'both' : 'neither'
          }).`,
        };
        invalidCommands.set(`${group.name}/${cmd.id}`, error);
        errors.push(error);
        continue;
      }

      if (cmd.shell !== undefined && !VALID_SHELLS.includes(cmd.shell)) {
        const error: ConfigValidationError = {
          commandId: cmd.id,
          groupName: group.name,
          message: `Command "${cmd.id}" has unknown shell "${cmd.shell}".`,
        };
        invalidCommands.set(`${group.name}/${cmd.id}`, error);
        errors.push(error);
        continue;
      }

      if (seenIds.has(cmd.id)) {
        const error: ConfigValidationError = {
          commandId: cmd.id,
          groupName: group.name,
          message: `Duplicate command id "${cmd.id}".`,
        };
        invalidCommands.set(`${group.name}/${cmd.id}`, error);
        errors.push(error);
        continue;
      }

      seenIds.add(cmd.id);
      validCommands.set(cmd.id, cmd);
    }
  }

  return { config, validCommands, invalidCommands, errors };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run compile && npm run test:unit
```

Expected: PASS — all 9 `configLoader` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/configLoader.ts test/unit/configLoader.test.ts
git commit -m "feat: add config parsing and validation"
```

---

### Task 4: Process Manager — Shell Resolution Table (`processManager.ts`)

**Files:**
- Create: `src/processManager.ts`
- Test: `test/unit/processManager.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/unit/processManager.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveShell } from '../../src/processManager';

const noFiles = () => false;

test('resolveShell: cmd on win32', () => {
  const result = resolveShell('cmd', { platform: 'win32', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: 'cmd.exe', shellArgs: ['/d', '/s', '/c'] });
});

test('resolveShell: auto on win32 defaults to cmd', () => {
  const result = resolveShell('auto', { platform: 'win32', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: 'cmd.exe', shellArgs: ['/d', '/s', '/c'] });
});

test('resolveShell: bash on win32 uses Git Bash when present', () => {
  const env = { ProgramFiles: 'C:\\Program Files' };
  const gitBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
  const result = resolveShell('bash', {
    platform: 'win32',
    env,
    fileExists: (p) => p === gitBashPath,
  });
  assert.deepEqual(result, { executable: gitBashPath, shellArgs: ['-c'] });
});

test('resolveShell: bash on win32 falls back to WSL when Git Bash missing', () => {
  const result = resolveShell('bash', { platform: 'win32', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: 'wsl.exe', shellArgs: ['-e', 'bash', '-lc'] });
});

test('resolveShell: wsl on win32', () => {
  const result = resolveShell('wsl', { platform: 'win32', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: 'wsl.exe', shellArgs: ['-e', 'bash', '-lc'] });
});

test('resolveShell: powershell on win32', () => {
  const result = resolveShell('powershell', { platform: 'win32', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: 'powershell.exe', shellArgs: ['-NoProfile', '-Command'] });
});

test('resolveShell: bash on linux', () => {
  const result = resolveShell('bash', { platform: 'linux', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: '/bin/bash', shellArgs: ['-c'] });
});

test('resolveShell: gitbash on linux falls back to bash', () => {
  const result = resolveShell('gitbash', { platform: 'linux', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: '/bin/bash', shellArgs: ['-c'] });
});

test('resolveShell: cmd on linux is unsupported', () => {
  const result = resolveShell('cmd', { platform: 'linux', env: {}, fileExists: noFiles });
  assert.equal(result, null);
});

test('resolveShell: powershell on darwin is unsupported', () => {
  const result = resolveShell('powershell', { platform: 'darwin', env: {}, fileExists: noFiles });
  assert.equal(result, null);
});

test('resolveShell: zsh on linux falls back to bash when zsh missing', () => {
  const result = resolveShell('zsh', { platform: 'linux', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: '/bin/bash', shellArgs: ['-c'] });
});

test('resolveShell: zsh on linux uses zsh when present', () => {
  const result = resolveShell('zsh', {
    platform: 'linux',
    env: {},
    fileExists: (p) => p === '/bin/zsh',
  });
  assert.deepEqual(result, { executable: '/bin/zsh', shellArgs: ['-c'] });
});

test('resolveShell: auto on linux uses $SHELL', () => {
  const result = resolveShell('auto', {
    platform: 'linux',
    env: { SHELL: '/usr/bin/fish' },
    fileExists: noFiles,
  });
  assert.deepEqual(result, { executable: '/usr/bin/fish', shellArgs: ['-c'] });
});

test('resolveShell: auto on linux falls back to /bin/sh without $SHELL', () => {
  const result = resolveShell('auto', { platform: 'linux', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: '/bin/sh', shellArgs: ['-c'] });
});

test('resolveShell: pwsh on linux when not installed', () => {
  const result = resolveShell('pwsh', { platform: 'linux', env: {}, fileExists: noFiles });
  assert.equal(result, null);
});

test('resolveShell: pwsh on linux when installed', () => {
  const result = resolveShell('pwsh', {
    platform: 'linux',
    env: {},
    fileExists: (p) => p === '/usr/bin/pwsh',
  });
  assert.deepEqual(result, { executable: '/usr/bin/pwsh', shellArgs: ['-NoProfile', '-Command'] });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run compile && npm run test:unit
```

Expected: FAIL — `Cannot find module '../../src/processManager'`.

- [ ] **Step 3: Write `src/processManager.ts`**

```typescript
import * as path from 'path';
import { ResolvedShell, ShellType } from './types';

export interface ShellResolutionContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fileExists: (filePath: string) => boolean;
}

const GITBASH_CANDIDATES = (env: NodeJS.ProcessEnv): string[] => [
  path.join(env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
  path.join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
];

const PWSH_CANDIDATES: Record<string, string[]> = {
  darwin: ['/usr/local/bin/pwsh', '/opt/homebrew/bin/pwsh'],
  linux: ['/usr/bin/pwsh', '/opt/microsoft/powershell/7/pwsh', '/usr/local/bin/pwsh'],
};

const ZSH_CANDIDATES = ['/bin/zsh', '/usr/bin/zsh'];

function findFirst(candidates: string[], fileExists: (p: string) => boolean): string | undefined {
  return candidates.find(fileExists);
}

export function resolveShell(
  shellType: ShellType = 'auto',
  ctx: ShellResolutionContext,
): ResolvedShell | null {
  const { platform, env, fileExists } = ctx;

  if (platform === 'win32') {
    switch (shellType) {
      case 'bash':
      case 'gitbash':
      case 'sh':
      case 'zsh': {
        const gitBash = findFirst(GITBASH_CANDIDATES(env), fileExists);
        if (gitBash) {
          return { executable: gitBash, shellArgs: ['-c'] };
        }
        return { executable: 'wsl.exe', shellArgs: ['-e', 'bash', '-lc'] };
      }
      case 'wsl':
        return { executable: 'wsl.exe', shellArgs: ['-e', 'bash', '-lc'] };
      case 'cmd':
        return { executable: 'cmd.exe', shellArgs: ['/d', '/s', '/c'] };
      case 'powershell':
        return { executable: 'powershell.exe', shellArgs: ['-NoProfile', '-Command'] };
      case 'pwsh':
        return { executable: 'pwsh.exe', shellArgs: ['-NoProfile', '-Command'] };
      case 'auto':
      default:
        return { executable: 'cmd.exe', shellArgs: ['/d', '/s', '/c'] };
    }
  }

  // darwin / linux
  switch (shellType) {
    case 'wsl':
    case 'cmd':
    case 'powershell':
      return null;
    case 'pwsh': {
      const candidates = PWSH_CANDIDATES[platform] ?? PWSH_CANDIDATES.linux;
      const pwsh = findFirst(candidates, fileExists);
      return pwsh ? { executable: pwsh, shellArgs: ['-NoProfile', '-Command'] } : null;
    }
    case 'bash':
    case 'gitbash':
      return { executable: '/bin/bash', shellArgs: ['-c'] };
    case 'sh':
      return { executable: '/bin/sh', shellArgs: ['-c'] };
    case 'zsh': {
      const zsh = findFirst(ZSH_CANDIDATES, fileExists);
      return zsh ? { executable: zsh, shellArgs: ['-c'] } : { executable: '/bin/bash', shellArgs: ['-c'] };
    }
    case 'auto':
    default: {
      const shell = env.SHELL;
      if (shell) {
        return { executable: shell, shellArgs: ['-c'] };
      }
      return { executable: '/bin/sh', shellArgs: ['-c'] };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run compile && npm run test:unit
```

Expected: PASS — all 16 `resolveShell` tests green (plus the 9 from Task 3 = 25 total).

- [ ] **Step 5: Commit**

```bash
git add src/processManager.ts test/unit/processManager.test.ts
git commit -m "feat: add cross-platform shell resolution table"
```

---

### Task 5: Process Manager — Spawn Argument Builder (`processManager.ts`)

**Files:**
- Modify: `src/processManager.ts` (append `buildSpawnArgs`)
- Modify: `test/unit/processManager.test.ts` (append tests)

- [ ] **Step 1: Append the failing tests**

Add to the end of `test/unit/processManager.test.ts`:

```typescript
import { buildSpawnArgs } from '../../src/processManager';
import { CommandDefinition } from '../../src/types';

test('buildSpawnArgs: command uses resolved shell (linux auto -> /bin/sh)', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', command: 'npm test' };
  const result = buildSpawnArgs(def, { platform: 'linux', env: {}, fileExists: () => false });
  assert.deepEqual(result, { executable: '/bin/sh', args: ['-c', 'npm test'] });
});

test('buildSpawnArgs: command with explicit bash shell', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', command: 'echo hi', shell: 'bash' };
  const result = buildSpawnArgs(def, { platform: 'linux', env: {}, fileExists: () => false });
  assert.deepEqual(result, { executable: '/bin/bash', args: ['-c', 'echo hi'] });
});

test('buildSpawnArgs: .sh file with no explicit shell infers bash', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', file: 'scripts/build.sh', args: ['--release'] };
  const result = buildSpawnArgs(def, { platform: 'linux', env: {}, fileExists: () => false });
  assert.deepEqual(result, { executable: '/bin/bash', args: ['scripts/build.sh', '--release'] });
});

test('buildSpawnArgs: .ps1 file infers powershell -File', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', file: 'scripts/deploy.ps1' };
  const result = buildSpawnArgs(def, { platform: 'win32', env: {}, fileExists: () => false });
  assert.deepEqual(result, {
    executable: 'powershell.exe',
    args: ['-NoProfile', '-File', 'scripts/deploy.ps1'],
  });
});

test('buildSpawnArgs: .bat file on win32 uses cmd', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', file: 'scripts/build.bat', args: ['Release'] };
  const result = buildSpawnArgs(def, { platform: 'win32', env: {}, fileExists: () => false });
  assert.deepEqual(result, { executable: 'cmd.exe', args: ['/d', '/s', '/c', 'scripts/build.bat', 'Release'] });
});

test('buildSpawnArgs: .py file uses python3 on non-windows', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', file: 'scripts/run.py', args: ['--fast'] };
  const result = buildSpawnArgs(def, { platform: 'linux', env: {}, fileExists: () => false });
  assert.deepEqual(result, { executable: 'python3', args: ['scripts/run.py', '--fast'] });
});

test('buildSpawnArgs: executable file with no extension spawns directly', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', file: './my-tool', args: ['--version'] };
  const result = buildSpawnArgs(def, { platform: 'linux', env: {}, fileExists: () => false });
  assert.deepEqual(result, { executable: './my-tool', args: ['--version'] });
});

test('buildSpawnArgs: returns null when shell is unsupported on this platform', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', command: 'dir', shell: 'cmd' };
  const result = buildSpawnArgs(def, { platform: 'linux', env: {}, fileExists: () => false });
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run compile && npm run test:unit
```

Expected: FAIL — `buildSpawnArgs is not a function` (or TS compile error: no exported member `buildSpawnArgs`).

- [ ] **Step 3: Update `src/processManager.ts`**

Change the top import line from:

```typescript
import { ResolvedShell, ShellType } from './types';
```

to:

```typescript
import { CommandDefinition, ResolvedShell, ShellType } from './types';
```

Then append to the end of `src/processManager.ts`:

```typescript
const SCRIPT_SHELL_BY_EXT: Record<string, ShellType> = {
  '.sh': 'bash',
  '.ps1': 'powershell',
  '.bat': 'cmd',
  '.cmd': 'cmd',
};

export interface SpawnArgs {
  executable: string;
  args: string[];
}

export function buildSpawnArgs(def: CommandDefinition, ctx: ShellResolutionContext): SpawnArgs | null {
  if (def.command) {
    const resolved = resolveShell(def.shell ?? 'auto', ctx);
    if (!resolved) {
      return null;
    }
    return { executable: resolved.executable, args: [...resolved.shellArgs, def.command] };
  }

  if (def.file) {
    const extra = def.args ?? [];
    const ext = path.extname(def.file).toLowerCase();
    const effectiveShell = def.shell ?? SCRIPT_SHELL_BY_EXT[ext];

    if (effectiveShell === 'powershell' || effectiveShell === 'pwsh') {
      const resolved = resolveShell(effectiveShell, ctx);
      if (!resolved) {
        return null;
      }
      return { executable: resolved.executable, args: ['-NoProfile', '-File', def.file, ...extra] };
    }

    if (
      effectiveShell === 'bash' ||
      effectiveShell === 'gitbash' ||
      effectiveShell === 'sh' ||
      effectiveShell === 'zsh'
    ) {
      const resolved = resolveShell(effectiveShell, ctx);
      if (!resolved) {
        return null;
      }
      return { executable: resolved.executable, args: [def.file, ...extra] };
    }

    if (effectiveShell === 'cmd') {
      return { executable: 'cmd.exe', args: ['/d', '/s', '/c', def.file, ...extra] };
    }

    if (ext === '.py') {
      return { executable: ctx.platform === 'win32' ? 'python' : 'python3', args: [def.file, ...extra] };
    }

    return { executable: def.file, args: extra };
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run compile && npm run test:unit
```

Expected: PASS — all 8 `buildSpawnArgs` tests green (33 total).

- [ ] **Step 5: Commit**

```bash
git add src/processManager.ts test/unit/processManager.test.ts
git commit -m "feat: build spawn argv for commands, scripts, and executables"
```

---

### Task 6: Process Manager — Spawn & Cancel (`processManager.ts`)

**Files:**
- Modify: `src/processManager.ts` (append `spawnProcess`, `cancelProcess`)
- Modify: `test/unit/processManager.test.ts` (append tests)

- [ ] **Step 1: Append the failing tests**

Add to the end of `test/unit/processManager.test.ts`:

```typescript
import { spawnProcess, cancelProcess } from '../../src/processManager';

test('spawnProcess runs a command and captures stdout', async () => {
  const { child } = spawnProcess(process.execPath, ['-e', "console.log('hello')"], {
    cwd: process.cwd(),
    env: process.env,
  });

  let output = '';
  child.stdout?.on('data', (chunk) => {
    output += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('exit', (code) => resolve(code));
  });

  assert.equal(exitCode, 0);
  assert.match(output, /hello/);
});

test('cancelProcess terminates a running process', async () => {
  const { pid, child } = spawnProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: process.cwd(),
    env: process.env,
  });

  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  await cancelProcess(pid, 50);
  await exited;

  assert.notEqual(child.signalCode, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run compile && npm run test:unit
```

Expected: FAIL — TS compile error, no exported members `spawnProcess`/`cancelProcess` from `'../../src/processManager'`.

- [ ] **Step 3: Update `src/processManager.ts`**

Change the top imports from:

```typescript
import * as path from 'path';
import { CommandDefinition, ResolvedShell, ShellType } from './types';
```

to:

```typescript
import * as path from 'path';
import { ChildProcess } from 'child_process';
import spawn from 'cross-spawn';
import treeKill from 'tree-kill';
import { CommandDefinition, ResolvedShell, ShellType } from './types';
```

`tree-kill` ships its own `index.d.ts` (an `export =` of the function), so no separate `@types/tree-kill` package is needed — `import treeKill from 'tree-kill'` works via `esModuleInterop`.

Then append to the end of `src/processManager.ts`:

```typescript
export interface RunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface RunHandle {
  pid: number;
  child: ChildProcess;
}

export function spawnProcess(executable: string, args: string[], options: RunOptions): RunHandle {
  const child = spawn(executable, args, { cwd: options.cwd, env: options.env });
  if (child.pid === undefined) {
    throw new Error(`Failed to spawn process: ${executable}`);
  }
  return { pid: child.pid, child };
}

export function cancelProcess(pid: number, graceMs: number): Promise<void> {
  return new Promise((resolve) => {
    treeKill(pid, 'SIGTERM', () => {
      const timer = setTimeout(() => {
        treeKill(pid, 'SIGKILL', () => resolve());
      }, graceMs);
      timer.unref();
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run compile && npm run test:unit
```

Expected: PASS — both new tests green (35 total). The cancel test takes ~50ms+ due to the grace period.

- [ ] **Step 5: Commit**

```bash
git add src/processManager.ts test/unit/processManager.test.ts
git commit -m "feat: spawn and tree-kill child processes"
```

---

### Task 7: Status Manager (`statusManager.ts`)

**Files:**
- Create: `src/statusManager.ts`
- Create: `test/unit/statusManager.test.ts`

`StatusManager` tracks per-command execution state in memory: zero or more in-flight executions (`active`) plus the result of the most recent completed run (`lastResult`), per the `CommandStatus` shape from `types.ts`. It has zero `vscode` imports — its own tiny listener list stands in for `vscode.EventEmitter` so it can be unit-tested with `node --test`. Phase 2's tree provider will subscribe via `onDidChangeStatus` to know when to refresh.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/statusManager.test.ts`:

```typescript
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { StatusManager } from '../../src/statusManager';

test('getStatus returns idle default for an unknown command', () => {
  const manager = new StatusManager();
  assert.deepEqual(manager.getStatus('missing'), { active: [], lastResult: null });
});

test('startExecution adds an active entry with pid and startTime', () => {
  const manager = new StatusManager();
  manager.startExecution('build', 123, 1000);

  const status = manager.getStatus('build');
  assert.equal(status.active.length, 1);
  assert.deepEqual(status.active[0], { pid: 123, startTime: 1000 });
  assert.equal(status.lastResult, null);
});

test('finishExecution removes the active entry and records lastResult', () => {
  const manager = new StatusManager();
  manager.startExecution('build', 123, 1000);
  manager.finishExecution('build', 123, { status: 'success', endTime: 2000, durationMs: 1000 });

  const status = manager.getStatus('build');
  assert.equal(status.active.length, 0);
  assert.deepEqual(status.lastResult, { status: 'success', endTime: 2000, durationMs: 1000 });
});

test('parallel executions of the same command stay active until each finishes', () => {
  const manager = new StatusManager();
  manager.startExecution('build', 100, 1000);
  manager.startExecution('build', 200, 1001);
  assert.equal(manager.getStatus('build').active.length, 2);

  manager.finishExecution('build', 100, { status: 'success', endTime: 2000, durationMs: 1000 });

  const status = manager.getStatus('build');
  assert.equal(status.active.length, 1);
  assert.equal(status.active[0].pid, 200);
  assert.deepEqual(status.lastResult, { status: 'success', endTime: 2000, durationMs: 1000 });
});

test('onDidChangeStatus notifies listeners with the affected command id', () => {
  const manager = new StatusManager();
  const seen: string[] = [];
  manager.onDidChangeStatus((commandId) => seen.push(commandId));

  manager.startExecution('build', 123, 1000);
  manager.finishExecution('build', 123, { status: 'success', endTime: 2000, durationMs: 1000 });

  assert.deepEqual(seen, ['build', 'build']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run compile && npm run test:unit
```

Expected: FAIL — `Cannot find module '../../src/statusManager'`.

- [ ] **Step 3: Write `src/statusManager.ts`**

```typescript
import { CommandStatus, LastResult } from './types';

export type StatusChangeListener = (commandId: string) => void;

export interface StatusChangeSubscription {
  dispose(): void;
}

export class StatusManager {
  private readonly statuses = new Map<string, CommandStatus>();
  private listeners: StatusChangeListener[] = [];

  getStatus(commandId: string): CommandStatus {
    return this.statuses.get(commandId) ?? { active: [], lastResult: null };
  }

  onDidChangeStatus(listener: StatusChangeListener): StatusChangeSubscription {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((registered) => registered !== listener);
      },
    };
  }

  startExecution(commandId: string, pid: number, startTime: number): void {
    const status = this.getStatus(commandId);
    this.statuses.set(commandId, {
      active: [...status.active, { pid, startTime }],
      lastResult: status.lastResult,
    });
    this.notify(commandId);
  }

  finishExecution(commandId: string, pid: number, result: LastResult): void {
    const status = this.getStatus(commandId);
    this.statuses.set(commandId, {
      active: status.active.filter((execution) => execution.pid !== pid),
      lastResult: result,
    });
    this.notify(commandId);
  }

  private notify(commandId: string): void {
    for (const listener of this.listeners) {
      listener(commandId);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run compile && npm run test:unit
```

Expected: PASS — all 5 new tests green (40 total).

- [ ] **Step 5: Commit**

```bash
git add src/statusManager.ts test/unit/statusManager.test.ts
git commit -m "feat: add in-memory command status tracking"
```

---

### Task 8: Clipboard Manager (`clipboardManager.ts`)

**Files:**
- Create: `src/clipboardManager.ts`

Thin wrapper over `vscode.env.clipboard`. It depends on the `vscode` API, so this phase verifies it with `npm run compile` only — behavioral coverage comes from the `@vscode/test-electron` integration suite added in the packaging phase.

- [ ] **Step 1: Write `src/clipboardManager.ts`**

```typescript
import * as vscode from 'vscode';

export class ClipboardManager {
  async copy(text: string): Promise<void> {
    await vscode.env.clipboard.writeText(text);
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run compile
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/clipboardManager.ts
git commit -m "feat: add clipboard manager"
```

---

### Task 9: Log Manager (`logManager.ts`)

**Files:**
- Create: `src/logManager.ts`

Owns one `vscode.OutputChannel` per command (`Quick Command Runner: <name>`) plus a shared `Quick Command Runner: Configuration` channel. Output arrives as arbitrary chunks from `child.stdout`/`child.stderr`, so `LogManager` buffers partial lines per `${commandId}:${stream}` key and only writes complete, timestamped lines (`[HH:mm:ss.SSS]`, with stderr lines tagged `[stderr]`). `flush()` writes out anything left in the buffers when a process exits. This depends on the `vscode` API, so this phase verifies it with `npm run compile` only.

- [ ] **Step 1: Write `src/logManager.ts`**

```typescript
import * as vscode from 'vscode';

type OutputStream = 'stdout' | 'stderr';

function formatTimestamp(date: Date): string {
  const pad = (value: number, width = 2) => value.toString().padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export class LogManager {
  private readonly channels = new Map<string, vscode.OutputChannel>();
  private readonly buffers = new Map<string, string>();
  private configChannel: vscode.OutputChannel | undefined;

  appendOutput(commandId: string, commandName: string, stream: OutputStream, chunk: string): void {
    const channel = this.getChannel(commandId, commandName);
    const bufferKey = `${commandId}:${stream}`;
    const combined = (this.buffers.get(bufferKey) ?? '') + chunk;
    const lines = combined.split('\n');
    const remainder = lines.pop() ?? '';
    this.buffers.set(bufferKey, remainder);

    for (const line of lines) {
      this.writeLine(channel, stream, line);
    }
  }

  flush(commandId: string, commandName: string): void {
    const channel = this.getChannel(commandId, commandName);
    for (const stream of ['stdout', 'stderr'] as const) {
      const bufferKey = `${commandId}:${stream}`;
      const remainder = this.buffers.get(bufferKey);
      if (remainder) {
        this.writeLine(channel, stream, remainder);
        this.buffers.set(bufferKey, '');
      }
    }
  }

  show(commandId: string, commandName: string): void {
    this.getChannel(commandId, commandName).show(true);
  }

  appendConfigMessage(message: string): void {
    if (!this.configChannel) {
      this.configChannel = vscode.window.createOutputChannel('Quick Command Runner: Configuration');
    }
    this.configChannel.appendLine(`[${formatTimestamp(new Date())}] ${message}`);
  }

  dispose(): void {
    for (const channel of this.channels.values()) {
      channel.dispose();
    }
    this.configChannel?.dispose();
  }

  private getChannel(commandId: string, commandName: string): vscode.OutputChannel {
    let channel = this.channels.get(commandId);
    if (!channel) {
      channel = vscode.window.createOutputChannel(`Quick Command Runner: ${commandName}`);
      this.channels.set(commandId, channel);
    }
    return channel;
  }

  private writeLine(channel: vscode.OutputChannel, stream: OutputStream, line: string): void {
    const tag = stream === 'stderr' ? ' [stderr]' : '';
    channel.appendLine(`[${formatTimestamp(new Date())}]${tag} ${line}`);
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run compile
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/logManager.ts
git commit -m "feat: add per-command output channel logging"
```

---

### Task 10: Command Runner (`commandRunner.ts`)

**Files:**
- Create: `src/commandRunner.ts`

`CommandRunner` is the run/cancel orchestrator implementing spec §3.2/§3.3: it guards against re-running a command that disallows parallel execution, substitutes `${workspaceFolder}` across `cwd`/`command`/`file`/`args`/`env`, resolves spawn arguments via `buildSpawnArgs`, spawns the process, streams stdout/stderr into `LogManager`, tracks lifecycle via `StatusManager`, enforces `timeout`, and supports `cancel()` via `tree-kill`. `commandRunner.ts` itself has no `vscode` import, but it takes a `LogManager` (which does) as a constructor dependency, so requiring it from a plain `node --test` process would still fail to load `'vscode'` transitively. This phase verifies it with `npm run compile` only.

A `cancelledPids: Set<number>` distinguishes a user-initiated cancellation from a natural failure: `cancel()` adds the pid to the set *before* asking `tree-kill` to terminate it; the exit handler checks (and removes from) the set to decide between `'cancelled'` and `'success'`/`'failed'`. A `timeout` firing calls `cancelProcess` directly without touching `cancelledPids`, so a timed-out command is reported as `'failed'` (per spec §5.3), not `'cancelled'`.

- [ ] **Step 1: Write `src/commandRunner.ts`**

```typescript
import * as fs from 'fs';
import { CommandDefinition, ExecutionStatus } from './types';
import { buildSpawnArgs, cancelProcess, spawnProcess, ShellResolutionContext } from './processManager';
import { StatusManager } from './statusManager';
import { LogManager } from './logManager';

export interface CommandRunnerOptions {
  workspaceFolder: string;
  cancelGracePeriodMs: number;
}

export class CommandRunner {
  private readonly cancelledPids = new Set<number>();

  constructor(
    private readonly statusManager: StatusManager,
    private readonly logManager: LogManager,
    private readonly options: CommandRunnerOptions,
  ) {}

  async run(def: CommandDefinition): Promise<void> {
    const existingStatus = this.statusManager.getStatus(def.id);
    if (existingStatus.active.length > 0 && !def.allowParallelExecution) {
      return;
    }

    const resolved = this.resolveDefinition(def);

    const ctx: ShellResolutionContext = {
      platform: process.platform,
      env: process.env,
      fileExists: fs.existsSync,
    };

    const spawnArgs = buildSpawnArgs(resolved, ctx);
    if (!spawnArgs) {
      this.logManager.appendConfigMessage(
        `Command "${resolved.name}" (${resolved.id}) cannot run: unsupported shell "${resolved.shell ?? 'auto'}" on this platform.`,
      );
      this.statusManager.finishExecution(resolved.id, -1, {
        status: 'invalid',
        endTime: Date.now(),
        durationMs: 0,
      });
      return;
    }

    const cwd = resolved.cwd ?? this.options.workspaceFolder;
    const env = { ...process.env, ...resolved.env };
    const startTime = Date.now();

    const { pid, child } = spawnProcess(spawnArgs.executable, spawnArgs.args, { cwd, env });
    this.statusManager.startExecution(resolved.id, pid, startTime);

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (resolved.timeout) {
      timeoutHandle = setTimeout(() => {
        void cancelProcess(pid, this.options.cancelGracePeriodMs);
      }, resolved.timeout);
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      this.logManager.appendOutput(resolved.id, resolved.name, 'stdout', chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.logManager.appendOutput(resolved.id, resolved.name, 'stderr', chunk.toString());
    });

    await new Promise<void>((resolve) => {
      child.on('exit', (code) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        this.logManager.flush(resolved.id, resolved.name);

        const wasCancelled = this.cancelledPids.delete(pid);
        const status: ExecutionStatus = wasCancelled ? 'cancelled' : code === 0 ? 'success' : 'failed';
        const endTime = Date.now();

        this.statusManager.finishExecution(resolved.id, pid, {
          status,
          endTime,
          durationMs: endTime - startTime,
        });
        resolve();
      });
    });
  }

  cancel(commandId: string): void {
    const status = this.statusManager.getStatus(commandId);
    for (const execution of status.active) {
      this.cancelledPids.add(execution.pid);
      void cancelProcess(execution.pid, this.options.cancelGracePeriodMs);
    }
  }

  /** Substitutes `${workspaceFolder}` across cwd/command/file/args/env (spec §3.2 step 2) and merges env over process.env. */
  private resolveDefinition(def: CommandDefinition): CommandDefinition {
    const substitute = (value: string): string =>
      value.replace(/\$\{workspaceFolder\}/g, this.options.workspaceFolder);

    return {
      ...def,
      cwd: def.cwd ? substitute(def.cwd) : def.cwd,
      command: def.command ? substitute(def.command) : def.command,
      file: def.file ? substitute(def.file) : def.file,
      args: def.args?.map(substitute),
      env: def.env
        ? Object.fromEntries(Object.entries(def.env).map(([key, value]) => [key, substitute(value)]))
        : def.env,
    };
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run compile
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/commandRunner.ts
git commit -m "feat: add command run/cancel orchestrator"
```

---
