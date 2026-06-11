# Phase 3: Path Extraction & Clipboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `pathExtractor.ts` (regex-based path detection from process output), wire it and the existing `clipboardManager.ts` into `commandRunner`'s run flow so the first detected path is copied to the clipboard (gated by `autoCopyPath`), the channel auto-reveals on first output (gated by `autoOpenLog`), and all detected paths are recorded on `LastResult.extractedPaths` for later use by Phase 4's `historyManager`.

**Architecture:** `pathExtractor.ts` is a pure module (no `vscode` import, like `processManager`/`statusManager`) with full `node:test` coverage. `commandRunner.ts` gains a `ClipboardManager` constructor parameter and a `notifyPathCopied: (path: string) => void` callback in `CommandRunnerOptions` — this keeps `vscode` imports out of `commandRunner.ts` (the principle the Phase 2 final reviewer praised), with `extension.ts` supplying the callback that shows the notification (gated by `quickCommandRunner.showNotifications`, per spec §10). `logManager.ts` gains an `appendInfo` method (for the "path copied" log line) and an `appendTimeout` method that closes a gap carried over from the Phase 1 review (spec §5.3's `[timeout]` log line was never implemented). A new `quickCommandRunner.autoCopyPath` setting (default `true`) is added to `package.json`.

**Tech Stack:** TypeScript (strict, commonjs), `node:test` for unit tests, VS Code Extension API (`vscode.env.clipboard`, `OutputChannel`, `showInformationMessage`).

---

## Reference: current state (after Phase 1 + 2)

These already exist on `master` — copied here so tasks are self-contained:

```typescript
// src/types.ts
export interface CommandDefinition {
  id: string; name: string; description?: string; shell?: ShellType;
  command?: string; file?: string; args?: string[]; cwd?: string;
  env?: Record<string, string>; timeout?: number;
  autoCopyPath?: boolean; autoOpenLog?: boolean; allowParallelExecution?: boolean;
}

export interface LastResult {
  status: ExecutionStatus;
  endTime: number;
  durationMs: number;
  exitCode: number | null;
}

// src/clipboardManager.ts
export class ClipboardManager {
  async copy(text: string): Promise<void>; // vscode.env.clipboard.writeText
}

// src/logManager.ts
type OutputStream = 'stdout' | 'stderr';
export class LogManager {
  appendOutput(commandId: string, commandName: string, stream: OutputStream, chunk: string): void;
  flush(commandId: string, commandName: string): void;
  show(commandId: string, commandName: string): void;
  clear(commandId: string, commandName: string): void;
  appendConfigMessage(message: string): void;
  dispose(): void;
}

// src/commandRunner.ts
export interface CommandRunnerOptions { workspaceFolder: string; cancelGracePeriodMs: number; }
export class CommandRunner {
  constructor(statusManager: StatusManager, logManager: LogManager, options: CommandRunnerOptions);
  run(def: CommandDefinition): Promise<void>;
  cancel(commandId: string): void;
}
```

**Path extraction regexes (spec §7, validated empirically):**

```typescript
const LABEL_VALUE_RE = /\b\w*path\w*\s*[:=]\s*("?)([^\s"]+)\1/gi;
const LOOKS_LIKE_PATH_RE = /^(?:[A-Za-z]:[\\/]|\/|~\/|\.{1,2}[\\/])/;
```

`LABEL_VALUE_RE` matches any identifier containing "path" (case-insensitive)
followed by `:` or `=` and a token (optionally quoted). `LOOKS_LIKE_PATH_RE`
filters to values that look like absolute/home/relative paths. Known
limitation (not a bug — spec doesn't require handling it): a quoted value
containing a space (e.g. `path: "/tmp/my file.txt"`) produces no match,
because `[^\s"]+` stops at the first space.

---

### Task 1: Path extraction (`pathExtractor.ts`)

**Files:**
- Create: `src/pathExtractor.ts`
- Test: `test/unit/pathExtractor.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/pathExtractor.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PathExtractor } from '../../src/pathExtractor';

test('scan returns no paths for output with no path-like labels', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('Building project...\n'), []);
});

test('scan extracts a simple unix path after "path:"', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('path: /usr/local/bin\n'), ['/usr/local/bin']);
});

test('scan extracts a path from a label using "=" with no spaces', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('outputPath=/tmp/build/output.txt\n'), ['/tmp/build/output.txt']);
});

test('scan extracts a quoted path', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('configPath: "/etc/app/config.json"\n'), ['/etc/app/config.json']);
});

test('scan ignores values that do not look like paths', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('path: myproject\n'), []);
});

test('scan extracts a relative path with ./ prefix', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('path: ./dist/output\n'), ['./dist/output']);
});

test('scan extracts a Windows-style path', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('path: C:\\Users\\test\\file.txt\n'), ['C:\\Users\\test\\file.txt']);
});

test('scan extracts a tilde-relative path', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('path: ~/projects/output\n'), ['~/projects/output']);
});

test('scan buffers a partial line until a newline arrives', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('path: /tmp/abc'), []);
  assert.deepEqual(extractor.scan('.log\n'), ['/tmp/abc.log']);
});

test('flush extracts a path from a final line with no trailing newline', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('path: /tmp/final.log'), []);
  assert.deepEqual(extractor.flush(), ['/tmp/final.log']);
});

test('getExtractedPaths accumulates paths across multiple scans', () => {
  const extractor = new PathExtractor();
  extractor.scan('srcPath: /a/b\n');
  extractor.scan('destPath: /c/d\n');
  assert.deepEqual(extractor.getExtractedPaths(), ['/a/b', '/c/d']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run compile`
Expected: FAIL — `error TS2307: Cannot find module '../../src/pathExtractor' or its corresponding type declarations.`

- [ ] **Step 3: Implement `src/pathExtractor.ts`**

```typescript
const LABEL_VALUE_RE = /\b\w*path\w*\s*[:=]\s*("?)([^\s"]+)\1/gi;
const LOOKS_LIKE_PATH_RE = /^(?:[A-Za-z]:[\\/]|\/|~\/|\.{1,2}[\\/])/;

/** Incrementally scans process output for `*path*[:=]value` tokens that look like filesystem paths (spec §7). */
export class PathExtractor {
  private buffer = '';
  private readonly extractedPaths: string[] = [];

  /** Scans a chunk of output, buffering any trailing partial line for the next call. Returns paths newly found in this chunk. */
  scan(chunk: string): string[] {
    const combined = this.buffer + chunk;
    const lines = combined.split('\n');
    this.buffer = lines.pop() ?? '';

    const found: string[] = [];
    for (const line of lines) {
      found.push(...this.scanLine(line));
    }
    return found;
  }

  /** Scans any remaining buffered partial line (call on process exit). Returns paths newly found. */
  flush(): string[] {
    if (!this.buffer) {
      return [];
    }
    const found = this.scanLine(this.buffer);
    this.buffer = '';
    return found;
  }

  /** All paths found so far, in the order they were encountered. */
  getExtractedPaths(): string[] {
    return [...this.extractedPaths];
  }

  private scanLine(line: string): string[] {
    const found: string[] = [];
    LABEL_VALUE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LABEL_VALUE_RE.exec(line)) !== null) {
      const value = match[2];
      if (LOOKS_LIKE_PATH_RE.test(value)) {
        this.extractedPaths.push(value);
        found.push(value);
      }
    }
    return found;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run compile && npm run test:unit`
Expected: PASS, 87 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/pathExtractor.ts test/unit/pathExtractor.test.ts
git commit -m "feat: add pathExtractor for scanning command output for paths"
```

---

### Task 2: Log manager info/timeout lines (`logManager.ts`)

Adds `appendInfo` (used in Task 4 to log "path copied to clipboard") and
`appendTimeout` (closes the spec §5.3 gap flagged in the Phase 1 review:
"`[timeout] Command exceeded {timeout}ms and was terminated.`" was never
written to the log). `logManager.ts` imports `vscode`, so it has no
`node:test` coverage — verified via compile/lint only, per the existing
pattern for vscode-dependent modules.

**Files:**
- Modify: `src/logManager.ts` (full rewrite)

- [ ] **Step 1: Replace `src/logManager.ts`**

```typescript
import * as vscode from 'vscode';

type OutputStream = 'stdout' | 'stderr';
type LogLineKind = OutputStream | 'info' | 'timeout';

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

  appendInfo(commandId: string, commandName: string, message: string): void {
    const channel = this.getChannel(commandId, commandName);
    this.writeLine(channel, 'info', message);
  }

  appendTimeout(commandId: string, commandName: string, timeoutMs: number): void {
    const channel = this.getChannel(commandId, commandName);
    this.writeLine(channel, 'timeout', `Command exceeded ${timeoutMs}ms and was terminated.`);
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

  clear(commandId: string, commandName: string): void {
    this.getChannel(commandId, commandName).clear();
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

  private writeLine(channel: vscode.OutputChannel, kind: LogLineKind, line: string): void {
    const tag = kind === 'stderr' ? ' [stderr]' : kind === 'info' ? ' [info]' : kind === 'timeout' ? ' [timeout]' : '';
    channel.appendLine(`[${formatTimestamp(new Date())}]${tag} ${line}`);
  }
}
```

- [ ] **Step 2: Verify compile, lint, and existing tests are unaffected**

Run: `npm run compile && npm run lint && npm run test:unit`
Expected: compile clean, lint clean, 87 tests, 0 failures (unchanged from Task 1 — `logManager.ts` has no `node:test` file).

- [ ] **Step 3: Commit**

```bash
git add src/logManager.ts
git commit -m "feat: add LogManager.appendInfo and appendTimeout"
```

---

### Task 3: Thread `extractedPaths` through `LastResult`

Adds `extractedPaths: string[]` to `LastResult` so `commandRunner` (Task 4)
can record every path found during a run, and a future `historyManager`
(Phase 4) can persist them on `HistoryEntry`. This is a pure type change
plus the mechanical fixes it ripples into two existing test files.

**Files:**
- Modify: `src/types.ts:85-90`
- Modify: `test/unit/statusManager.test.ts` (full rewrite)
- Modify: `test/unit/commandViewModel.test.ts:37,63,71,79,124`

- [ ] **Step 1: Write the failing test**

Append to the end of `test/unit/statusManager.test.ts`:

```typescript
test('finishExecution stores extractedPaths on lastResult', () => {
  const manager = new StatusManager();
  manager.startExecution('build', 123, 1000);
  manager.finishExecution('build', 123, {
    status: 'success',
    endTime: 2000,
    durationMs: 1000,
    exitCode: 0,
    extractedPaths: ['/tmp/output.log'],
  });

  assert.deepEqual(manager.getStatus('build').lastResult?.extractedPaths, ['/tmp/output.log']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run compile`
Expected: FAIL — `error TS2353: Object literal may only specify known properties, and 'extractedPaths' does not exist in type 'LastResult'` (and a related `TS2339: Property 'extractedPaths' does not exist on type 'LastResult'` on the `getStatus(...).lastResult?.extractedPaths` line).

- [ ] **Step 3: Add `extractedPaths` to `LastResult` in `src/types.ts`**

Change (`src/types.ts:85-90`):

```typescript
export interface LastResult {
  status: ExecutionStatus;
  endTime: number;
  durationMs: number;
  exitCode: number | null;
}
```

to:

```typescript
export interface LastResult {
  status: ExecutionStatus;
  endTime: number;
  durationMs: number;
  exitCode: number | null;
  extractedPaths: string[];
}
```

- [ ] **Step 4: Run compile to see the ripple effect**

Run: `npm run compile`
Expected: FAIL — multiple `error TS2741: Property 'extractedPaths' is missing in type '{ status: ...; endTime: ...; durationMs: ...; exitCode: ... }' but required in type 'LastResult'`, at:
- `test/unit/statusManager.test.ts` lines 23, 36, 50, 62, 70 (object literals passed to `finishExecution`)
- `test/unit/commandViewModel.test.ts` lines 37, 63, 71, 79, 124 (object literals assigned to `CommandStatus`-typed `lastResult`)

- [ ] **Step 5: Replace `test/unit/statusManager.test.ts` to fix the ripple**

Replace the full file content with:

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
  manager.finishExecution('build', 123, { status: 'success', endTime: 2000, durationMs: 1000, exitCode: 0, extractedPaths: [] });

  const status = manager.getStatus('build');
  assert.equal(status.active.length, 0);
  assert.deepEqual(status.lastResult, { status: 'success', endTime: 2000, durationMs: 1000, exitCode: 0, extractedPaths: [] });
});

test('parallel executions of the same command stay active until each finishes', () => {
  const manager = new StatusManager();
  manager.startExecution('build', 100, 1000);
  manager.startExecution('build', 200, 1001);
  assert.equal(manager.getStatus('build').active.length, 2);

  manager.finishExecution('build', 100, { status: 'success', endTime: 2000, durationMs: 1000, exitCode: 0, extractedPaths: [] });

  const status = manager.getStatus('build');
  assert.equal(status.active.length, 1);
  assert.equal(status.active[0].pid, 200);
  assert.deepEqual(status.lastResult, { status: 'success', endTime: 2000, durationMs: 1000, exitCode: 0, extractedPaths: [] });
});

test('onDidChangeStatus notifies listeners with the affected command id', () => {
  const manager = new StatusManager();
  const seen: string[] = [];
  manager.onDidChangeStatus((commandId) => seen.push(commandId));

  manager.startExecution('build', 123, 1000);
  manager.finishExecution('build', 123, { status: 'success', endTime: 2000, durationMs: 1000, exitCode: 0, extractedPaths: [] });

  assert.deepEqual(seen, ['build', 'build']);
});

test('onDidChangeStatus: disposed listener stops receiving notifications', () => {
  const manager = new StatusManager();
  const seen: string[] = [];
  const sub = manager.onDidChangeStatus((commandId) => seen.push(commandId));

  manager.startExecution('build', 123, 1000);
  sub.dispose();
  manager.finishExecution('build', 123, { status: 'success', endTime: 2000, durationMs: 1000, exitCode: 0, extractedPaths: [] });

  assert.deepEqual(seen, ['build']);
});

test('finishExecution stores exitCode on lastResult', () => {
  const manager = new StatusManager();
  manager.startExecution('build', 123, 1000);
  manager.finishExecution('build', 123, { status: 'failed', endTime: 2000, durationMs: 1000, exitCode: 1, extractedPaths: [] });

  assert.equal(manager.getStatus('build').lastResult?.exitCode, 1);
});

test('finishExecution stores extractedPaths on lastResult', () => {
  const manager = new StatusManager();
  manager.startExecution('build', 123, 1000);
  manager.finishExecution('build', 123, {
    status: 'success',
    endTime: 2000,
    durationMs: 1000,
    exitCode: 0,
    extractedPaths: ['/tmp/output.log'],
  });

  assert.deepEqual(manager.getStatus('build').lastResult?.extractedPaths, ['/tmp/output.log']);
});
```

- [ ] **Step 6: Fix `test/unit/commandViewModel.test.ts`**

Make these 5 edits (each adds `, extractedPaths: []` to a `lastResult` object literal):

1. Line 37, change:

```typescript
    lastResult: { status: 'failed', endTime: 1000, durationMs: 500, exitCode: 1 },
```

to:

```typescript
    lastResult: { status: 'failed', endTime: 1000, durationMs: 500, exitCode: 1, extractedPaths: [] },
```

2. Lines 63 and 124 (identical — replace **both** occurrences), change:

```typescript
    lastResult: { status: 'success', endTime: 5000, durationMs: 3200, exitCode: 0 },
```

to:

```typescript
    lastResult: { status: 'success', endTime: 5000, durationMs: 3200, exitCode: 0, extractedPaths: [] },
```

3. Line 71, change:

```typescript
    lastResult: { status: 'failed', endTime: 5000, durationMs: 100, exitCode: 1 },
```

to:

```typescript
    lastResult: { status: 'failed', endTime: 5000, durationMs: 100, exitCode: 1, extractedPaths: [] },
```

4. Line 79, change:

```typescript
    lastResult: { status: 'failed', endTime: 5000, durationMs: 100, exitCode: null },
```

to:

```typescript
    lastResult: { status: 'failed', endTime: 5000, durationMs: 100, exitCode: null, extractedPaths: [] },
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run compile && npm run test:unit`
Expected: PASS, 88 tests, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts test/unit/statusManager.test.ts test/unit/commandViewModel.test.ts
git commit -m "feat: track extractedPaths on LastResult"
```

---

### Task 4: Wire clipboard + path extraction into the run flow

Wires `pathExtractor` (Task 1) and `clipboardManager` into `commandRunner.run()`
per spec §3.2 steps 5-6: stream chunks through `pathExtractor`, reveal the
log on first output if `autoOpenLog`, copy the first detected path to the
clipboard if `autoCopyPath` resolves true (logging it via `appendInfo` and
notifying via the new `notifyPathCopied` callback), record `extractedPaths`
on `LastResult`, and log the `[timeout]` line (Task 2's `appendTimeout`) when
a timeout fires. Adds the `quickCommandRunner.autoCopyPath` setting.
`commandRunner.ts` and `extension.ts` import `vscode` (transitively, via
`logManager`/`vscode` itself for `extension.ts`) or are orchestration-only,
so this task is verified via compile/lint + the existing suite, not new
`node:test` cases.

**Files:**
- Modify: `src/commandRunner.ts` (full rewrite)
- Modify: `src/extension.ts:56-65`
- Modify: `package.json:39-53`

- [ ] **Step 1: Replace `src/commandRunner.ts`**

```typescript
import * as fs from 'fs';
import { CommandDefinition, ExecutionStatus } from './types';
import { buildSpawnArgs, cancelProcess, spawnProcess, ShellResolutionContext } from './processManager';
import { StatusManager } from './statusManager';
import { LogManager } from './logManager';
import { ClipboardManager } from './clipboardManager';
import { PathExtractor } from './pathExtractor';

export interface CommandRunnerOptions {
  workspaceFolder: string;
  cancelGracePeriodMs: number;
  autoCopyPathDefault: boolean;
  notifyPathCopied: (path: string) => void;
}

export class CommandRunner {
  private readonly cancelledPids = new Set<number>();

  constructor(
    private readonly statusManager: StatusManager,
    private readonly logManager: LogManager,
    private readonly clipboardManager: ClipboardManager,
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
        exitCode: null,
        extractedPaths: [],
      });
      return;
    }

    const cwd = resolved.cwd ?? this.options.workspaceFolder;
    const env = { ...process.env, ...resolved.env };
    const startTime = Date.now();

    const { pid, child } = spawnProcess(spawnArgs.executable, spawnArgs.args, { cwd, env });
    this.statusManager.startExecution(resolved.id, pid, startTime);

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = resolved.timeout;
    if (timeoutMs) {
      timeoutHandle = setTimeout(() => {
        this.logManager.appendTimeout(resolved.id, resolved.name, timeoutMs);
        void cancelProcess(pid, this.options.cancelGracePeriodMs);
      }, timeoutMs);
    }

    const pathExtractor = new PathExtractor();
    let revealedLog = false;
    let copiedFirstPath = false;

    const handleChunk = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      const text = chunk.toString();
      this.logManager.appendOutput(resolved.id, resolved.name, stream, text);

      if (resolved.autoOpenLog && !revealedLog) {
        revealedLog = true;
        this.logManager.show(resolved.id, resolved.name);
      }

      const newPaths = pathExtractor.scan(text);
      if (!copiedFirstPath && newPaths.length > 0) {
        copiedFirstPath = true;
        void this.copyFirstPath(resolved, newPaths[0]);
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => handleChunk('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => handleChunk('stderr', chunk));

    await new Promise<void>((resolve) => {
      child.on('exit', (code) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        this.logManager.flush(resolved.id, resolved.name);

        const flushedPaths = pathExtractor.flush();
        if (!copiedFirstPath && flushedPaths.length > 0) {
          copiedFirstPath = true;
          void this.copyFirstPath(resolved, flushedPaths[0]);
        }

        const wasCancelled = this.cancelledPids.delete(pid);
        const status: ExecutionStatus = wasCancelled ? 'cancelled' : code === 0 ? 'success' : 'failed';
        const endTime = Date.now();

        this.statusManager.finishExecution(resolved.id, pid, {
          status,
          endTime,
          durationMs: endTime - startTime,
          exitCode: code,
          extractedPaths: pathExtractor.getExtractedPaths(),
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

  /** Copies the first detected path to the clipboard (spec §3.2 step 6), gated by per-command/global autoCopyPath. */
  private async copyFirstPath(resolved: CommandDefinition, extractedPath: string): Promise<void> {
    const shouldCopy = resolved.autoCopyPath ?? this.options.autoCopyPathDefault;
    if (!shouldCopy) {
      return;
    }
    await this.clipboardManager.copy(extractedPath);
    this.logManager.appendInfo(resolved.id, resolved.name, `Copied path to clipboard: ${extractedPath}`);
    this.options.notifyPathCopied(extractedPath);
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

- [ ] **Step 2: Replace `src/extension.ts:56-65`**

Change:

```typescript
  const cancelGracePeriodMs = vscode.workspace
    .getConfiguration('quickCommandRunner')
    .get<number>('cancelGracePeriodMs', 3000);

  const runner = workspaceFolder
    ? new CommandRunner(statusManager, logManager, { workspaceFolder, cancelGracePeriodMs })
    : undefined;

  const showNotificationsEnabled = (): boolean =>
    vscode.workspace.getConfiguration('quickCommandRunner').get<boolean>('showNotifications', true);
```

to:

```typescript
  const cancelGracePeriodMs = vscode.workspace
    .getConfiguration('quickCommandRunner')
    .get<number>('cancelGracePeriodMs', 3000);

  const showNotificationsEnabled = (): boolean =>
    vscode.workspace.getConfiguration('quickCommandRunner').get<boolean>('showNotifications', true);

  const autoCopyPathDefault = (): boolean =>
    vscode.workspace.getConfiguration('quickCommandRunner').get<boolean>('autoCopyPath', true);

  const runner = workspaceFolder
    ? new CommandRunner(statusManager, logManager, clipboardManager, {
        workspaceFolder,
        cancelGracePeriodMs,
        autoCopyPathDefault: autoCopyPathDefault(),
        notifyPathCopied: (copiedPath: string) => {
          if (showNotificationsEnabled()) {
            void vscode.window.showInformationMessage(`Path copied to clipboard: ${copiedPath}`);
          }
        },
      })
    : undefined;
```

(`clipboardManager` is already constructed earlier in `activate()` at line 27 — no other changes needed.)

- [ ] **Step 3: Replace `package.json:39-53`**

Change:

```json
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
```

to:

```json
    "configuration": {
      "title": "Quick Command Runner",
      "properties": {
        "quickCommandRunner.autoCopyPath": {
          "type": "boolean",
          "default": true,
          "description": "Global default for auto-copying the first detected output path to the clipboard. Per-command \"autoCopyPath\" overrides this."
        },
        "quickCommandRunner.showNotifications": {
          "type": "boolean",
          "default": true,
          "description": "Show start/finish/path-copied notifications for command executions."
        },
        "quickCommandRunner.cancelGracePeriodMs": {
          "type": "number",
          "default": 3000,
          "description": "Delay in milliseconds between SIGTERM and SIGKILL when cancelling a running command."
        }
      }
    },
```

- [ ] **Step 4: Run full verification**

Run: `npm run compile && npm run lint && npm run test:unit`
Expected: compile clean, lint clean, 88 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/commandRunner.ts src/extension.ts package.json
git commit -m "feat: copy first detected output path to clipboard and reveal log on output"
```

---

## Manual smoke test (informational — not executable in this sandbox)

This sandbox has no display, so the Extension Development Host can't run
here. After merging, a developer with VS Code should:

1. Press F5 ("Run Extension"). Add a command with
   `"command": "echo \"outputPath: /tmp/demo-output.txt\""` and
   `"autoCopyPath": true`.
2. Run it — confirm an info notification "Path copied to clipboard:
   /tmp/demo-output.txt" appears, and pasting (Ctrl+V) anywhere yields
   `/tmp/demo-output.txt`.
3. Open the command's log (right-click → Open Log) — confirm a line tagged
   `[info] Copied path to clipboard: /tmp/demo-output.txt` appears.
4. Set `"autoOpenLog": true` on a command — confirm its OutputChannel is
   revealed automatically as soon as the command produces its first line of
   output (no need to right-click → Open Log).
5. Set `"timeout": 1000` on a long-running command (e.g.
   `"command": "sleep 10"`) — confirm after ~1s the command is killed, its
   status becomes "failed" (not "cancelled"), and its log contains a line
   tagged `[timeout] Command exceeded 1000ms and was terminated.`
6. Toggle `quickCommandRunner.autoCopyPath` to `false` in settings (with no
   per-command override) — confirm a path-producing command no longer
   copies to the clipboard or shows the notification, but the run still
   completes normally.
7. Toggle `quickCommandRunner.showNotifications` to `false` — confirm the
   "Path copied to clipboard" notification no longer appears (the clipboard
   copy and log line still happen).

---

## Self-review notes

- **Spec coverage**: §7 (`pathExtractor`/`clipboardManager`, regexes,
  `extractedPaths` ordering) → Task 1 + Task 4. §3.2 step 5
  (incremental scanning, `autoOpenLog` reveal-on-first-output) → Task 4.
  §3.2 step 6 (first-path copy gated by `autoCopyPath`, notification text
  "Path copied to clipboard", logged) → Task 4. §10
  (`quickCommandRunner.autoCopyPath` setting, `showNotifications` gates
  "path-copied" toasts) → Task 4 Step 3 + extension.ts callback.
  `HistoryEntry.extractedPaths` (declared in Phase 1, consumed by Phase 4)
  is now populated via `LastResult.extractedPaths` (Task 3) — Phase 4's
  `historyManager` can read it directly.
- **Carried-over item closed**: Phase 1 review's flagged gap (spec §5.3
  `[timeout]` log line) is closed by Task 2 (`appendTimeout`) + Task 4 Step 1
  (`commandRunner` calls it when the timeout fires).
- **Type consistency**: `CommandRunnerOptions` now has 4 fields
  (`workspaceFolder`, `cancelGracePeriodMs`, `autoCopyPathDefault`,
  `notifyPathCopied`) — consistent across Task 4's `commandRunner.ts` and
  `extension.ts` edits. `LastResult.extractedPaths: string[]` is consistent
  across `types.ts` (Task 3), `statusManager.test.ts` (Task 3),
  `commandViewModel.test.ts` (Task 3), and `commandRunner.ts` (Task 4).
  `PathExtractor`'s public API (`scan`, `flush`, `getExtractedPaths`) is used
  identically in Task 1's tests and Task 4's `commandRunner.ts`.
- **Test count**: 76 (post Phase 2) → 87 (Task 1, +11) → 88 (Task 3, +1) →
  88 (Tasks 2 and 4 add no new `node:test` files).
- **Not addressed (out of scope for Phase 3)**: the Phase 2 final review's
  earlier note (NEW-1) about malformed/empty config files silently producing
  zero `ConfigValidationError`s remains a Phase 4/5 UX polish item.
