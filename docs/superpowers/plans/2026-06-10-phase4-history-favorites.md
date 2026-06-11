# Phase 4: History, Favorites & Recent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist execution history (with favorites and a recently-used list) in `workspaceState`, surface it in a new History sidebar view, and add `⭐ Favorites` / `🕐 Recent` sections to the Commands view.

**Architecture:** Two new pure modules — `historyManager.ts` (persistence, sorting, filtering, favorites, recent, output truncation) and `historyViewModel.ts` (per-entry view formatting) — follow the existing `statusManager`/`commandViewModel` pattern and are unit-tested with `node:test` against a `Memento`-shaped fake. A new `historyProvider.ts` mirrors `commandProvider.ts` as the `TreeDataProvider` for the History view (vscode-dependent, compile/lint-verified only). `commandViewModel.ts` gains an `isFavorite` flag on `CommandTreeItem`'s `contextValue` and a `buildCommandTree` helper that prepends synthetic Favorites/Recent groups. `commandRunner.ts` records history entries (with truncated stdout/stderr) on every process exit and updates the "recent" list on every run. `extension.ts` and `package.json` wire up the new view, commands, and settings.

**Tech Stack:** TypeScript, VS Code Extension API, `node:test` + `node:assert/strict` for pure-module unit tests.

---

## Context for the implementer

- Repo root for all file paths below: `/home/peyman/Desktop/workstation/vscode-command-executer/.worktrees/phase4-history-favorites`
- Baseline: branch `phase4-history-favorites`, branched from `master`, 88/88 unit tests passing (`npm test`).
- `src/types.ts` already defines `HistoryEntry`, `ExecutionStatus`, `ShellType`, `CommandDefinition`, `CommandGroup`, `ConfigLoadResult` — **do not modify `types.ts`**, everything Phase 4 needs is already there.
- Pure modules (no `import 'vscode'`, covered by `test/unit/*.test.ts` run via `npm run test:unit`): `configLoader`, `commandViewModel`, `processManager`, `defaultConfig`, `statusManager`, `pathExtractor`, and (new in this phase) `historyManager`, `historyViewModel`.
- vscode-dependent modules (verified via `npm run compile` + `npm run lint` only, no `node:test`): `logManager`, `clipboardManager`, `commandProvider`, `extension`, `commandRunner`, and (new in this phase) `historyProvider`.
- Test command: `npm test` (runs `npm run compile` then `node --test 'out/test/**/*.test.js'`).
- Lint command: `npm run lint`.

---

### Task 1: `historyManager.ts` — core history persistence, sort, filter

**Files:**
- Create: `src/historyManager.ts`
- Test: `test/unit/historyManager.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/historyManager.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HistoryManager, HistoryMemento, filterEntries, sortEntries } from '../../src/historyManager';
import { HistoryEntry } from '../../src/types';

function createFakeMemento(initial: Record<string, unknown> = {}): HistoryMemento {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    get: <T>(key: string, defaultValue: T): T => (store.has(key) ? (store.get(key) as T) : defaultValue),
    update: (key: string, value: unknown): Thenable<void> => {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    entryId: 'e1',
    commandId: 'build',
    commandSnapshot: { id: 'build', name: 'Build', command: 'npm run build' },
    fullCommand: 'bash -c "npm run build"',
    shell: 'bash',
    cwd: '/workspace',
    startTime: 0,
    endTime: 0,
    durationMs: 0,
    exitCode: 0,
    status: 'success',
    stdout: '',
    stderr: '',
    extractedPaths: [],
    ...overrides,
  };
}

test('HistoryManager.add stores the entry and getAll returns it', () => {
  const manager = new HistoryManager(createFakeMemento(), { historyLimit: 200, recentLimit: 5 });

  manager.add(makeEntry({ entryId: 'a', endTime: 1000 }));

  assert.deepEqual(
    manager.getAll().map((e) => e.entryId),
    ['a'],
  );
});

test('HistoryManager.getAll sorts by endTime descending by default', () => {
  const manager = new HistoryManager(createFakeMemento(), { historyLimit: 200, recentLimit: 5 });

  manager.add(makeEntry({ entryId: 'a', endTime: 1000 }));
  manager.add(makeEntry({ entryId: 'b', endTime: 2000 }));

  assert.deepEqual(
    manager.getAll().map((e) => e.entryId),
    ['b', 'a'],
  );
});

test('HistoryManager.add evicts the oldest entry once historyLimit is exceeded', () => {
  const manager = new HistoryManager(createFakeMemento(), { historyLimit: 2, recentLimit: 5 });

  manager.add(makeEntry({ entryId: 'a', endTime: 1000 }));
  manager.add(makeEntry({ entryId: 'b', endTime: 2000 }));
  manager.add(makeEntry({ entryId: 'c', endTime: 3000 }));

  assert.deepEqual(
    manager.getAll().map((e) => e.entryId),
    ['c', 'b'],
  );
});

test('HistoryManager.clear empties the history', () => {
  const manager = new HistoryManager(createFakeMemento(), { historyLimit: 200, recentLimit: 5 });
  manager.add(makeEntry());

  manager.clear();

  assert.deepEqual(manager.getAll(), []);
});

test('HistoryManager: setSort/getSort and setFilter/getFilter round-trip, defaulting to time/empty', () => {
  const manager = new HistoryManager(createFakeMemento(), { historyLimit: 200, recentLimit: 5 });

  assert.equal(manager.getSort(), 'time');
  assert.equal(manager.getFilter(), '');

  manager.setSort('status');
  manager.setFilter('build');

  assert.equal(manager.getSort(), 'status');
  assert.equal(manager.getFilter(), 'build');
});

test('sortEntries: "time" sorts most recently finished first', () => {
  const entries = [
    makeEntry({ entryId: 'a', endTime: 1000 }),
    makeEntry({ entryId: 'b', endTime: 3000 }),
    makeEntry({ entryId: 'c', endTime: 2000 }),
  ];
  assert.deepEqual(
    sortEntries(entries, 'time').map((e) => e.entryId),
    ['b', 'c', 'a'],
  );
});

test('sortEntries: "duration" sorts longest-running first', () => {
  const entries = [
    makeEntry({ entryId: 'a', durationMs: 100 }),
    makeEntry({ entryId: 'b', durationMs: 500 }),
    makeEntry({ entryId: 'c', durationMs: 200 }),
  ];
  assert.deepEqual(
    sortEntries(entries, 'duration').map((e) => e.entryId),
    ['b', 'c', 'a'],
  );
});

test('sortEntries: "status" sorts alphabetically, tie-broken by most recent first', () => {
  const entries = [
    makeEntry({ entryId: 'a', status: 'success', endTime: 1000 }),
    makeEntry({ entryId: 'b', status: 'failed', endTime: 2000 }),
    makeEntry({ entryId: 'c', status: 'failed', endTime: 3000 }),
  ];
  assert.deepEqual(
    sortEntries(entries, 'status').map((e) => e.entryId),
    ['c', 'b', 'a'],
  );
});

test('filterEntries: empty or whitespace filter text returns all entries', () => {
  const entries = [makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })];
  assert.deepEqual(filterEntries(entries, ''), entries);
  assert.deepEqual(filterEntries(entries, '   '), entries);
});

test('filterEntries: matches command name case-insensitively', () => {
  const entries = [
    makeEntry({ entryId: 'a', commandSnapshot: { id: 'build', name: 'Build', command: 'npm run build' } }),
    makeEntry({ entryId: 'b', commandSnapshot: { id: 'lint', name: 'Lint', command: 'npm run lint' } }),
  ];
  assert.deepEqual(
    filterEntries(entries, 'build').map((e) => e.entryId),
    ['a'],
  );
});

test('filterEntries: matches status case-insensitively', () => {
  const entries = [makeEntry({ entryId: 'a', status: 'failed' }), makeEntry({ entryId: 'b', status: 'success' })];
  assert.deepEqual(
    filterEntries(entries, 'FAILED').map((e) => e.entryId),
    ['a'],
  );
});

test('HistoryManager.getAll applies the active filter and sort together', () => {
  const manager = new HistoryManager(createFakeMemento(), { historyLimit: 200, recentLimit: 5 });

  manager.add(
    makeEntry({
      entryId: 'a',
      status: 'success',
      durationMs: 100,
      endTime: 1000,
      commandSnapshot: { id: 'build', name: 'Build', command: 'npm run build' },
    }),
  );
  manager.add(
    makeEntry({
      entryId: 'b',
      status: 'failed',
      durationMs: 500,
      endTime: 2000,
      commandSnapshot: { id: 'lint', name: 'Lint', command: 'npm run lint' },
    }),
  );
  manager.add(
    makeEntry({
      entryId: 'c',
      status: 'failed',
      durationMs: 50,
      endTime: 3000,
      commandSnapshot: { id: 'lint2', name: 'Lint Again', command: 'npm run lint' },
    }),
  );

  manager.setFilter('lint');
  manager.setSort('duration');

  assert.deepEqual(
    manager.getAll().map((e) => e.entryId),
    ['b', 'c'],
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile`
Expected: FAIL — `Cannot find module '../../src/historyManager'` (or similar TS2307 errors), since `src/historyManager.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/historyManager.ts`:

```typescript
import { HistoryEntry } from './types';

export type HistorySort = 'time' | 'duration' | 'status';

export interface HistoryMemento {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

export interface HistoryManagerOptions {
  historyLimit: number;
  recentLimit: number;
}

const HISTORY_KEY = 'quickCommandRunner.history';

export function filterEntries(entries: HistoryEntry[], filterText: string): HistoryEntry[] {
  const needle = filterText.trim().toLowerCase();
  if (!needle) {
    return entries;
  }
  return entries.filter(
    (entry) =>
      entry.commandSnapshot.name.toLowerCase().includes(needle) ||
      entry.status.toLowerCase().includes(needle),
  );
}

export function sortEntries(entries: HistoryEntry[], sort: HistorySort): HistoryEntry[] {
  const copy = [...entries];
  switch (sort) {
    case 'duration':
      return copy.sort((a, b) => b.durationMs - a.durationMs);
    case 'status':
      return copy.sort((a, b) => {
        const statusCompare = a.status.localeCompare(b.status);
        return statusCompare !== 0 ? statusCompare : b.endTime - a.endTime;
      });
    case 'time':
    default:
      return copy.sort((a, b) => b.endTime - a.endTime);
  }
}

export class HistoryManager {
  private sort: HistorySort = 'time';
  private filterText = '';

  constructor(
    private readonly memento: HistoryMemento,
    private readonly options: HistoryManagerOptions,
  ) {}

  add(entry: HistoryEntry): void {
    const history = this.memento.get<HistoryEntry[]>(HISTORY_KEY, []);
    history.unshift(entry);
    while (history.length > this.options.historyLimit) {
      history.pop();
    }
    void this.memento.update(HISTORY_KEY, history);
  }

  getAll(): HistoryEntry[] {
    const history = this.memento.get<HistoryEntry[]>(HISTORY_KEY, []);
    return sortEntries(filterEntries(history, this.filterText), this.sort);
  }

  clear(): void {
    void this.memento.update(HISTORY_KEY, []);
  }

  setSort(sort: HistorySort): void {
    this.sort = sort;
  }

  getSort(): HistorySort {
    return this.sort;
  }

  setFilter(filterText: string): void {
    this.filterText = filterText;
  }

  getFilter(): string {
    return this.filterText;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all new `historyManager.test.ts` tests pass, plus the existing 88 tests still pass (100/100 total).

- [ ] **Step 5: Commit**

```bash
git add src/historyManager.ts test/unit/historyManager.test.ts
git commit -m "Add historyManager core: persistence, sort, filter"
```

---

### Task 2: `historyManager.ts` — favorites, recent, output truncation

**Files:**
- Modify: `src/historyManager.ts`
- Modify: `test/unit/historyManager.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/historyManager.test.ts`:

```typescript
import { TruncatingBuffer, HISTORY_OUTPUT_CAP, TRUNCATION_MARKER } from '../../src/historyManager';

test('HISTORY_OUTPUT_CAP is 100KB', () => {
  assert.equal(HISTORY_OUTPUT_CAP, 100 * 1024);
});

test('TruncatingBuffer: returns full content when under the cap', () => {
  const buffer = new TruncatingBuffer(20);
  buffer.append('hello');
  buffer.append(' world');
  assert.equal(buffer.toString(), 'hello world');
});

test('TruncatingBuffer: truncates and appends a marker once the cap is exceeded', () => {
  const buffer = new TruncatingBuffer(5);
  buffer.append('hello world');
  assert.equal(buffer.toString(), 'hello' + TRUNCATION_MARKER);
});

test('TruncatingBuffer: stops growing once truncated', () => {
  const buffer = new TruncatingBuffer(5);
  buffer.append('hello world');
  buffer.append(' more text');
  assert.equal(buffer.toString(), 'hello' + TRUNCATION_MARKER);
});

test('TruncatingBuffer: defaults to HISTORY_OUTPUT_CAP', () => {
  const buffer = new TruncatingBuffer();
  buffer.append('x'.repeat(HISTORY_OUTPUT_CAP));
  assert.equal(buffer.toString(), 'x'.repeat(HISTORY_OUTPUT_CAP));
  buffer.append('y');
  assert.equal(buffer.toString(), 'x'.repeat(HISTORY_OUTPUT_CAP) + TRUNCATION_MARKER);
});

test('HistoryManager.getFavorites returns an empty array initially', () => {
  const manager = new HistoryManager(createFakeMemento(), { historyLimit: 200, recentLimit: 5 });
  assert.deepEqual(manager.getFavorites(), []);
  assert.equal(manager.isFavorite('build'), false);
});

test('HistoryManager.toggleFavorite adds and then removes a command id', () => {
  const manager = new HistoryManager(createFakeMemento(), { historyLimit: 200, recentLimit: 5 });

  manager.toggleFavorite('build');
  assert.deepEqual(manager.getFavorites(), ['build']);
  assert.equal(manager.isFavorite('build'), true);

  manager.toggleFavorite('build');
  assert.deepEqual(manager.getFavorites(), []);
  assert.equal(manager.isFavorite('build'), false);
});

test('HistoryManager.getRecent returns an empty array initially', () => {
  const manager = new HistoryManager(createFakeMemento(), { historyLimit: 200, recentLimit: 5 });
  assert.deepEqual(manager.getRecent(), []);
});

test('HistoryManager.recordUsed moves a command id to the front, deduped', () => {
  const manager = new HistoryManager(createFakeMemento(), { historyLimit: 200, recentLimit: 5 });

  manager.recordUsed('build');
  manager.recordUsed('lint');
  manager.recordUsed('build');

  assert.deepEqual(manager.getRecent(), ['build', 'lint']);
});

test('HistoryManager.recordUsed evicts the oldest entry beyond recentLimit', () => {
  const manager = new HistoryManager(createFakeMemento(), { historyLimit: 200, recentLimit: 2 });

  manager.recordUsed('a');
  manager.recordUsed('b');
  manager.recordUsed('c');

  assert.deepEqual(manager.getRecent(), ['c', 'b']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `TruncatingBuffer`, `HISTORY_OUTPUT_CAP`, `TRUNCATION_MARKER`, `getFavorites`, `toggleFavorite`, `isFavorite`, `getRecent`, `recordUsed` are not exported/defined yet (TS2305/TS2339 errors).

- [ ] **Step 3: Write the implementation**

In `src/historyManager.ts`, add these constants near the top (after `const HISTORY_KEY = ...`):

```typescript
const FAVORITES_KEY = 'quickCommandRunner.favorites';
const RECENT_KEY = 'quickCommandRunner.recent';

export const HISTORY_OUTPUT_CAP = 100 * 1024;
export const TRUNCATION_MARKER = '\n…[truncated]';

export class TruncatingBuffer {
  private chunks: string[] = [];
  private length = 0;
  private truncated = false;

  constructor(private readonly cap: number = HISTORY_OUTPUT_CAP) {}

  append(text: string): void {
    if (this.truncated) {
      return;
    }
    this.chunks.push(text);
    this.length += text.length;
    if (this.length > this.cap) {
      this.truncated = true;
    }
  }

  toString(): string {
    const full = this.chunks.join('');
    return this.truncated ? full.slice(0, this.cap) + TRUNCATION_MARKER : full;
  }
}
```

Then add these methods to the `HistoryManager` class, after `getFilter()`:

```typescript
  getFavorites(): string[] {
    return this.memento.get<string[]>(FAVORITES_KEY, []);
  }

  isFavorite(commandId: string): boolean {
    return this.getFavorites().includes(commandId);
  }

  toggleFavorite(commandId: string): void {
    const favorites = this.getFavorites();
    const index = favorites.indexOf(commandId);
    if (index >= 0) {
      favorites.splice(index, 1);
    } else {
      favorites.push(commandId);
    }
    void this.memento.update(FAVORITES_KEY, favorites);
  }

  getRecent(): string[] {
    return this.memento.get<string[]>(RECENT_KEY, []);
  }

  recordUsed(commandId: string): void {
    const recent = this.getRecent().filter((id) => id !== commandId);
    recent.unshift(commandId);
    while (recent.length > this.options.recentLimit) {
      recent.pop();
    }
    void this.memento.update(RECENT_KEY, recent);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `historyManager.test.ts` tests pass (110/110 total: 100 + 10 new).

- [ ] **Step 5: Commit**

```bash
git add src/historyManager.ts test/unit/historyManager.test.ts
git commit -m "Add favorites, recent, and output truncation to historyManager"
```

---

### Task 3: `historyViewModel.ts` — history entry view formatting

**Files:**
- Create: `src/historyViewModel.ts`
- Test: `test/unit/historyViewModel.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/historyViewModel.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeTime, formatHistoryDescription, buildHistoryViewState } from '../../src/historyViewModel';
import { HistoryEntry } from '../../src/types';

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    entryId: 'e1',
    commandId: 'build',
    commandSnapshot: { id: 'build', name: 'Build', command: 'npm run build' },
    fullCommand: 'bash -c "npm run build"',
    shell: 'bash',
    cwd: '/workspace',
    startTime: 0,
    endTime: 0,
    durationMs: 1234,
    exitCode: 0,
    status: 'success',
    stdout: '',
    stderr: '',
    extractedPaths: [],
    ...overrides,
  };
}

test('formatRelativeTime: less than 5 seconds ago is "just now"', () => {
  assert.equal(formatRelativeTime(1000, 1000), 'just now');
  assert.equal(formatRelativeTime(1000, 4999), 'just now');
});

test('formatRelativeTime: under a minute shows seconds', () => {
  assert.equal(formatRelativeTime(0, 5000), '5s ago');
  assert.equal(formatRelativeTime(0, 59000), '59s ago');
});

test('formatRelativeTime: under an hour shows minutes', () => {
  assert.equal(formatRelativeTime(0, 60000), '1m ago');
  assert.equal(formatRelativeTime(0, 59 * 60 * 1000), '59m ago');
});

test('formatRelativeTime: under a day shows hours', () => {
  assert.equal(formatRelativeTime(0, 60 * 60 * 1000), '1h ago');
  assert.equal(formatRelativeTime(0, 23 * 60 * 60 * 1000), '23h ago');
});

test('formatRelativeTime: a day or more shows days', () => {
  assert.equal(formatRelativeTime(0, 24 * 60 * 60 * 1000), '1d ago');
  assert.equal(formatRelativeTime(0, 3 * 24 * 60 * 60 * 1000), '3d ago');
});

test('formatHistoryDescription: shows duration and exit code', () => {
  assert.equal(formatHistoryDescription(makeEntry({ durationMs: 3200, exitCode: 0 })), '3200ms · exit 0');
});

test('formatHistoryDescription: shows ? when exit code is null', () => {
  assert.equal(formatHistoryDescription(makeEntry({ durationMs: 100, exitCode: null })), '100ms · exit ?');
});

test('buildHistoryViewState: combines label, description, icon, contextValue, and tooltip', () => {
  const entry = makeEntry({
    commandSnapshot: { id: 'build', name: 'Build', command: 'npm run build' },
    fullCommand: 'bash -c "npm run build"',
    durationMs: 3200,
    exitCode: 0,
    status: 'success',
    endTime: 0,
  });

  const viewState = buildHistoryViewState(entry, 5000);

  assert.deepEqual(viewState, {
    label: 'Build — 5s ago',
    description: '3200ms · exit 0',
    iconId: 'pass-filled',
    iconColor: 'testing.iconPassed',
    contextValue: 'history.success',
    tooltip: 'bash -c "npm run build"',
  });
});

test('buildHistoryViewState: uses the failed icon and contextValue for failed entries', () => {
  const entry = makeEntry({ status: 'failed', exitCode: 1, endTime: 0 });

  const viewState = buildHistoryViewState(entry, 0);

  assert.equal(viewState.iconId, 'error');
  assert.equal(viewState.iconColor, 'testing.iconFailed');
  assert.equal(viewState.contextValue, 'history.failed');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile`
Expected: FAIL — `Cannot find module '../../src/historyViewModel'` (TS2307), since `src/historyViewModel.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/historyViewModel.ts`:

```typescript
import { HistoryEntry } from './types';
import { STATUS_ICONS } from './commandViewModel';

export interface HistoryViewState {
  label: string;
  description: string;
  iconId: string;
  iconColor: string;
  contextValue: string;
  tooltip: string;
}

export function formatRelativeTime(timestampMs: number, now: number): string {
  const diffSec = Math.floor((now - timestampMs) / 1000);
  if (diffSec < 5) {
    return 'just now';
  }
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return `${diffHour}h ago`;
  }
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

export function formatHistoryDescription(entry: HistoryEntry): string {
  return `${entry.durationMs}ms · exit ${entry.exitCode ?? '?'}`;
}

export function buildHistoryViewState(entry: HistoryEntry, now: number): HistoryViewState {
  const icon = STATUS_ICONS[entry.status];
  return {
    label: `${entry.commandSnapshot.name} — ${formatRelativeTime(entry.endTime, now)}`,
    description: formatHistoryDescription(entry),
    iconId: icon.icon,
    iconColor: icon.color,
    contextValue: `history.${entry.status}`,
    tooltip: entry.fullCommand,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `historyViewModel.test.ts` tests pass (119/119 total: 110 + 9 new).

- [ ] **Step 5: Commit**

```bash
git add src/historyViewModel.ts test/unit/historyViewModel.test.ts
git commit -m "Add historyViewModel for History view formatting"
```

---

### Task 4: Favorites/Recent in `commandViewModel.ts` and `commandProvider.ts`

**Files:**
- Modify: `src/commandViewModel.ts`
- Modify: `test/unit/commandViewModel.test.ts`
- Modify: `src/commandProvider.ts`
- Modify: `src/extension.ts`

This task depends on `src/historyManager.ts` from Tasks 1–2 (`HistoryManager` with `getFavorites()`, `getRecent()`, `isFavorite()`).

- [ ] **Step 1: Write the failing tests**

In `test/unit/commandViewModel.test.ts`, replace the existing test `'buildCommandViewState: combines status, description, tooltip, contextValue, and icon'` (currently around line 114) with:

```typescript
test('buildCommandViewState: combines status, description, tooltip, contextValue, and icon (not favorited)', () => {
  const def: CommandDefinition = {
    id: 'build',
    name: 'Build',
    command: 'npm run build',
    cwd: '/workspace',
    description: 'Builds the project',
  };
  const status: CommandStatus = {
    active: [],
    lastResult: { status: 'success', endTime: 5000, durationMs: 3200, exitCode: 0, extractedPaths: [] },
  };

  const viewState = buildCommandViewState(def, status, false, 0, false);

  assert.deepEqual(viewState, {
    status: 'success',
    description: '✓ 3.2s',
    tooltip: 'npm run build\ncwd: /workspace\nBuilds the project',
    contextValue: 'cmd.success.nofav',
    iconId: 'pass-filled',
    iconColor: 'testing.iconPassed',
  });
});

test('buildCommandViewState: contextValue carries .fav when the command is a favorite', () => {
  const def: CommandDefinition = { id: 'build', name: 'Build', command: 'npm run build' };
  const status: CommandStatus = { active: [], lastResult: null };

  const viewState = buildCommandViewState(def, status, false, 0, true);

  assert.equal(viewState.contextValue, 'cmd.idle.fav');
});
```

Then, at the end of `test/unit/commandViewModel.test.ts`, append tests for `buildCommandTree`:

```typescript
import { buildCommandTree } from '../../src/commandViewModel';

test('buildCommandTree: returns groups unchanged when there are no favorites or recents', () => {
  assert.deepEqual(buildCommandTree(SAMPLE_GROUPS, [], [], ''), SAMPLE_GROUPS);
});

test('buildCommandTree: prepends a Favorites group containing the favorited command', () => {
  const result = buildCommandTree(SAMPLE_GROUPS, ['lint'], [], '');
  assert.equal(result[0].name, '⭐ Favorites');
  assert.deepEqual(
    result[0].commands.map((c) => c.id),
    ['lint'],
  );
  assert.deepEqual(result.slice(1), SAMPLE_GROUPS);
});

test('buildCommandTree: prepends a Recent group after Favorites in MRU order', () => {
  const result = buildCommandTree(SAMPLE_GROUPS, ['lint'], ['compose-up', 'build'], '');
  assert.equal(result[0].name, '⭐ Favorites');
  assert.equal(result[1].name, '🕐 Recent');
  assert.deepEqual(
    result[1].commands.map((c) => c.id),
    ['compose-up', 'build'],
  );
});

test('buildCommandTree: omits Favorites/Recent groups when empty', () => {
  const result = buildCommandTree(SAMPLE_GROUPS, [], ['build'], '');
  assert.equal(result[0].name, '🕐 Recent');
  assert.deepEqual(result.slice(1), SAMPLE_GROUPS);
});

test('buildCommandTree: respects the active filter for Favorites/Recent', () => {
  const result = buildCommandTree(SAMPLE_GROUPS, ['compose-up'], ['lint'], 'lint');
  // 'compose-up' does not match the filter 'lint', so Favorites is empty and omitted
  assert.equal(result[0].name, '🕐 Recent');
  assert.deepEqual(
    result[0].commands.map((c) => c.id),
    ['lint'],
  );
  assert.deepEqual(
    result.slice(1).map((g) => g.name),
    ['Build'],
  );
});

test('buildCommandTree: ignores favorite/recent ids that no longer exist in any group', () => {
  assert.deepEqual(buildCommandTree(SAMPLE_GROUPS, ['ghost'], ['ghost'], ''), SAMPLE_GROUPS);
});
```

Note: `import { buildCommandTree } from '../../src/commandViewModel';` should be merged into the existing import block at the top of the file (alongside `buildCommandViewState`, `filterGroups`, etc.) rather than added as a second `import` statement from the same module.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile`
Expected: FAIL — `buildCommandTree` is not exported (TS2305), and `buildCommandViewState` is called with 5 arguments but only accepts 4 (TS2554).

- [ ] **Step 3: Write the implementation**

In `src/commandViewModel.ts`, replace the `buildCommandViewState` function (and its preceding `CommandViewState` interface stays the same) with:

```typescript
export function buildCommandViewState(
  def: CommandDefinition,
  commandStatus: CommandStatus,
  isInvalid: boolean,
  now: number,
  isFavorite: boolean,
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
    contextValue: `cmd.${status}.${isFavorite ? 'fav' : 'nofav'}`,
    iconId: icon,
    iconColor: color,
  };
}
```

Then add `buildCommandTree` after `filterGroups` at the end of the file:

```typescript
export function buildCommandTree(
  groups: CommandGroup[],
  favoriteIds: string[],
  recentIds: string[],
  filterText: string,
): CommandGroup[] {
  const filtered = filterGroups(groups, filterText);

  const allCommands = new Map<string, CommandDefinition>();
  for (const group of groups) {
    for (const cmd of group.commands) {
      allCommands.set(cmd.id, cmd);
    }
  }

  const filteredIds = new Set<string>();
  for (const group of filtered) {
    for (const cmd of group.commands) {
      filteredIds.add(cmd.id);
    }
  }

  const resolveIds = (ids: string[]): CommandDefinition[] =>
    ids
      .filter((id) => filteredIds.has(id))
      .map((id) => allCommands.get(id))
      .filter((cmd): cmd is CommandDefinition => cmd !== undefined);

  const favoriteCommands = resolveIds(favoriteIds);
  const recentCommands = resolveIds(recentIds);

  const result: CommandGroup[] = [];
  if (favoriteCommands.length > 0) {
    result.push({ name: '⭐ Favorites', commands: favoriteCommands });
  }
  if (recentCommands.length > 0) {
    result.push({ name: '🕐 Recent', commands: recentCommands });
  }
  result.push(...filtered);
  return result;
}
```

Now update `src/commandProvider.ts`. Replace the entire file with:

```typescript
import * as vscode from 'vscode';
import { CommandDefinition, CommandGroup, ConfigLoadResult } from './types';
import { StatusManager, StatusChangeSubscription } from './statusManager';
import { HistoryManager } from './historyManager';
import { buildCommandViewState, buildCommandTree } from './commandViewModel';

export class GroupTreeItem extends vscode.TreeItem {
  constructor(public readonly group: CommandGroup) {
    super(group.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'group';
  }
}

export class CommandTreeItem extends vscode.TreeItem {
  constructor(
    public readonly def: CommandDefinition,
    isInvalid: boolean,
    statusManager: StatusManager,
    isFavorite: boolean,
  ) {
    super(def.name, vscode.TreeItemCollapsibleState.None);

    const status = statusManager.getStatus(def.id);
    const viewState = buildCommandViewState(def, status, isInvalid, Date.now(), isFavorite);

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
    private readonly historyManager: HistoryManager,
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
    const { config, validCommands, invalidCommands } = this.getConfig();
    const tree = buildCommandTree(
      config.groups,
      this.historyManager.getFavorites(),
      this.historyManager.getRecent(),
      this.filterText,
    );

    if (!element) {
      return tree.map((group) => new GroupTreeItem(group));
    }

    if (element instanceof GroupTreeItem) {
      const isSyntheticGroup = element.group.name === '⭐ Favorites' || element.group.name === '🕐 Recent';
      return element.group.commands.map((def) => {
        const isInvalid = isSyntheticGroup
          ? !validCommands.has(def.id)
          : invalidCommands.has(`${element.group.name}/${def.id}`);
        const isFavorite = this.historyManager.isFavorite(def.id);
        return new CommandTreeItem(def, isInvalid, this.statusManager, isFavorite);
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

Finally, in `src/extension.ts`:

1. Add an import for `HistoryManager` alongside the other manager imports:

```typescript
import { ClipboardManager } from './clipboardManager';
import { HistoryManager } from './historyManager';
import { CommandRunner } from './commandRunner';
```

(insert the `HistoryManager` import line between the existing `ClipboardManager` and `CommandRunner` imports)

2. Instantiate `historyManager` alongside the other managers:

```typescript
  const statusManager = new StatusManager();
  const logManager = new LogManager();
  const clipboardManager = new ClipboardManager();
  const historyManager = new HistoryManager(context.workspaceState, { historyLimit: 200, recentLimit: 5 });
```

3. Pass it into `CommandProvider`:

```typescript
  const provider = new CommandProvider(() => configResult, statusManager, historyManager);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 119 existing/updated tests pass, plus 6 new `buildCommandTree` tests and a net +1 from replacing the single `buildCommandViewState` test with two variants (126/126 total). Also run `npm run lint` — expect no errors.

- [ ] **Step 5: Commit**

```bash
git add src/commandViewModel.ts test/unit/commandViewModel.test.ts src/commandProvider.ts src/extension.ts
git commit -m "Add Favorites/Recent sections to the Commands view"
```

---

### Task 5: `historyProvider.ts` — TreeDataProvider for the History view

**Files:**
- Create: `src/historyProvider.ts`

This module imports `vscode`, so it is **not** covered by `node:test`. Verify it via `npm run compile` and `npm run lint`.

- [ ] **Step 1: Write the implementation**

Create `src/historyProvider.ts`:

```typescript
import * as vscode from 'vscode';
import { HistoryEntry } from './types';
import { HistoryManager } from './historyManager';
import { buildHistoryViewState } from './historyViewModel';

export class HistoryTreeItem extends vscode.TreeItem {
  constructor(public readonly entry: HistoryEntry) {
    super('', vscode.TreeItemCollapsibleState.None);

    const viewState = buildHistoryViewState(entry, Date.now());
    this.label = viewState.label;
    this.description = viewState.description;
    this.tooltip = viewState.tooltip;
    this.contextValue = viewState.contextValue;
    this.iconPath = new vscode.ThemeIcon(viewState.iconId, new vscode.ThemeColor(viewState.iconColor));
  }
}

export class HistoryProvider implements vscode.TreeDataProvider<HistoryTreeItem>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<HistoryTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly historyManager: HistoryManager) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: HistoryTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: HistoryTreeItem): HistoryTreeItem[] {
    if (element) {
      return [];
    }
    return this.historyManager.getAll().map((entry) => new HistoryTreeItem(entry));
  }

  dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }
}
```

- [ ] **Step 2: Verify it compiles and lints cleanly**

Run: `npm run compile`
Expected: PASS — no TypeScript errors.

Run: `npm run lint`
Expected: PASS — no lint errors.

Run: `npm test`
Expected: PASS — 126/126 (no new `node:test` tests added in this task; count unchanged from Task 4).

- [ ] **Step 3: Commit**

```bash
git add src/historyProvider.ts
git commit -m "Add HistoryProvider TreeDataProvider for the History view"
```

---

### Task 6: Wire `historyManager` into `commandRunner.ts`

**Files:**
- Modify: `src/commandRunner.ts`
- Modify: `src/extension.ts`

This module imports `vscode`-dependent siblings (`logManager`, `clipboardManager`), so it is **not** covered by `node:test`. Verify via `npm run compile` and `npm run lint`.

- [ ] **Step 1: Write the implementation**

Replace the entire contents of `src/commandRunner.ts` with:

```typescript
import * as crypto from 'crypto';
import * as fs from 'fs';
import { CommandDefinition, ExecutionStatus, HistoryEntry } from './types';
import { buildSpawnArgs, cancelProcess, spawnProcess, ShellResolutionContext } from './processManager';
import { StatusManager } from './statusManager';
import { LogManager } from './logManager';
import { ClipboardManager } from './clipboardManager';
import { PathExtractor } from './pathExtractor';
import { HistoryManager, TruncatingBuffer } from './historyManager';

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
    private readonly historyManager: HistoryManager,
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

    this.historyManager.recordUsed(resolved.id);

    const fullCommand = [spawnArgs.executable, ...spawnArgs.args].join(' ');
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
    const stdoutBuffer = new TruncatingBuffer();
    const stderrBuffer = new TruncatingBuffer();
    let revealedLog = false;
    let copiedFirstPath = false;

    const handleChunk = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      const text = chunk.toString();
      this.logManager.appendOutput(resolved.id, resolved.name, stream, text);
      (stream === 'stdout' ? stdoutBuffer : stderrBuffer).append(text);

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

        const historyEntry: HistoryEntry = {
          entryId: crypto.randomUUID(),
          commandId: resolved.id,
          commandSnapshot: resolved,
          fullCommand,
          shell: resolved.shell ?? 'auto',
          cwd,
          startTime,
          endTime,
          durationMs: endTime - startTime,
          exitCode: code,
          status,
          stdout: stdoutBuffer.toString(),
          stderr: stderrBuffer.toString(),
          extractedPaths: pathExtractor.getExtractedPaths(),
        };
        this.historyManager.add(historyEntry);

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

In `src/extension.ts`, update the `CommandRunner` instantiation to pass `historyManager` as the 4th constructor argument:

```typescript
  const runner = workspaceFolder
    ? new CommandRunner(statusManager, logManager, clipboardManager, historyManager, {
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

- [ ] **Step 2: Verify it compiles, lints, and tests pass**

Run: `npm test`
Expected: PASS — 126/126 (unchanged; `commandRunner.ts` has no `node:test` coverage).

Run: `npm run lint`
Expected: PASS — no lint errors.

- [ ] **Step 3: Commit**

```bash
git add src/commandRunner.ts src/extension.ts
git commit -m "Record history entries and update recent list on every run"
```

---

### Task 7: History view, commands, and settings wiring

**Files:**
- Modify: `src/logManager.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Add `LogManager.hasChannel`**

In `src/logManager.ts`, add this method to the `LogManager` class, immediately after `clear()`:

```typescript
  hasChannel(commandId: string): boolean {
    return this.channels.has(commandId);
  }
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run compile`
Expected: PASS — no TypeScript errors.

- [ ] **Step 3: Replace `src/extension.ts` with the fully-wired version**

Replace the entire contents of `src/extension.ts` with:

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
import { HistoryManager, HistorySort } from './historyManager';
import { CommandRunner } from './commandRunner';
import { CommandProvider, CommandTreeItem } from './commandProvider';
import { HistoryProvider, HistoryTreeItem } from './historyProvider';
import { describeCommandLine } from './commandViewModel';

const EMPTY_CONFIG: ConfigLoadResult = {
  config: { groups: [] },
  validCommands: new Map(),
  invalidCommands: new Map(),
  errors: [],
};

const SORT_OPTIONS: { label: string; value: HistorySort }[] = [
  { label: 'Time', value: 'time' },
  { label: 'Duration', value: 'duration' },
  { label: 'Status', value: 'status' },
];

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const workspaceFolder = folder?.uri.fsPath;

  const statusManager = new StatusManager();
  const logManager = new LogManager();
  const clipboardManager = new ClipboardManager();

  const historyLimitSetting = (): number =>
    vscode.workspace.getConfiguration('quickCommandRunner').get<number>('historyLimit', 200);

  const recentLimitSetting = (): number =>
    vscode.workspace.getConfiguration('quickCommandRunner').get<number>('recentLimit', 5);

  const historyManager = new HistoryManager(context.workspaceState, {
    historyLimit: historyLimitSetting(),
    recentLimit: recentLimitSetting(),
  });

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

  const provider = new CommandProvider(() => configResult, statusManager, historyManager);
  const treeView = vscode.window.createTreeView('quickCommandRunnerCommands', {
    treeDataProvider: provider,
  });

  const historyProvider = new HistoryProvider(historyManager);
  const historyTreeView = vscode.window.createTreeView('quickCommandRunnerHistory', {
    treeDataProvider: historyProvider,
  });

  const cancelGracePeriodMs = vscode.workspace
    .getConfiguration('quickCommandRunner')
    .get<number>('cancelGracePeriodMs', 3000);

  const showNotificationsEnabled = (): boolean =>
    vscode.workspace.getConfiguration('quickCommandRunner').get<boolean>('showNotifications', true);

  const autoCopyPathDefault = (): boolean =>
    vscode.workspace.getConfiguration('quickCommandRunner').get<boolean>('autoCopyPath', true);

  const runner = workspaceFolder
    ? new CommandRunner(statusManager, logManager, clipboardManager, historyManager, {
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

  const runCommand = async (def: CommandDefinition): Promise<void> => {
    if (!runner) {
      void vscode.window.showErrorMessage('Quick Command Runner: no workspace folder is open.');
      return;
    }

    if (!showNotificationsEnabled()) {
      await runner.run(def);
      historyProvider.refresh();
      return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Running "${def.name}"`, cancellable: true },
      async (_progress, token) => {
        token.onCancellationRequested(() => runner.cancel(def.id));
        await runner.run(def);
      },
    );

    historyProvider.refresh();

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
    historyTreeView,
    provider,
    historyProvider,
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
      historyProvider.refresh();
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

    vscode.commands.registerCommand('quickCommandRunner.toggleFavorite', (item?: CommandTreeItem) => {
      if (!item) {
        return;
      }
      historyManager.toggleFavorite(item.def.id);
      provider.refresh();
    }),

    vscode.commands.registerCommand('quickCommandRunner.historySort', async () => {
      const picked = await vscode.window.showQuickPick(
        SORT_OPTIONS.map((option) => option.label),
        { placeHolder: 'Sort history by' },
      );
      if (!picked) {
        return;
      }
      const option = SORT_OPTIONS.find((candidate) => candidate.label === picked);
      if (!option) {
        return;
      }
      historyManager.setSort(option.value);
      historyProvider.refresh();
    }),

    vscode.commands.registerCommand('quickCommandRunner.historyFilter', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'Filter history by command name or status',
        value: historyManager.getFilter(),
      });
      if (value === undefined) {
        return;
      }
      historyManager.setFilter(value);
      historyProvider.refresh();
    }),

    vscode.commands.registerCommand('quickCommandRunner.historyClear', async () => {
      const choice = await vscode.window.showWarningMessage(
        'Clear all command history? This cannot be undone.',
        { modal: true },
        'Clear History',
      );
      if (choice !== 'Clear History') {
        return;
      }
      historyManager.clear();
      historyProvider.refresh();
    }),

    vscode.commands.registerCommand('quickCommandRunner.historyRerun', async (item?: HistoryTreeItem) => {
      if (!item) {
        return;
      }
      await runCommand(item.entry.commandSnapshot);
    }),

    vscode.commands.registerCommand('quickCommandRunner.historyOpenLog', async (item?: HistoryTreeItem) => {
      if (!item) {
        return;
      }
      const { entry } = item;
      if (logManager.hasChannel(entry.commandId)) {
        logManager.show(entry.commandId, entry.commandSnapshot.name);
        return;
      }
      const content = [
        `$ ${entry.fullCommand}`,
        '',
        '--- stdout ---',
        entry.stdout,
        '--- stderr ---',
        entry.stderr,
      ].join('\n');
      const doc = await vscode.workspace.openTextDocument({ content, language: 'log' });
      await vscode.window.showTextDocument(doc, { preview: false });
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

- [ ] **Step 4: Replace `package.json` with the fully-wired version**

Replace the entire contents of `package.json` with:

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
  "activationEvents": ["onStartupFinished"],
  "main": "./out/src/extension.js",
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
        },
        {
          "id": "quickCommandRunnerHistory",
          "name": "History"
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
        },
        "quickCommandRunner.historyLimit": {
          "type": "number",
          "default": 200,
          "description": "Maximum number of command history entries to keep."
        },
        "quickCommandRunner.recentLimit": {
          "type": "number",
          "default": 5,
          "description": "Maximum number of commands shown in the \"Recent\" section of the Commands view."
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
      { "command": "quickCommandRunner.createConfig", "title": "Create Config", "category": "Quick Command Runner" },
      { "command": "quickCommandRunner.toggleFavorite", "title": "Toggle Favorite", "icon": "$(star-full)" },
      { "command": "quickCommandRunner.historySort", "title": "Sort History", "icon": "$(list-ordered)", "category": "Quick Command Runner" },
      { "command": "quickCommandRunner.historyFilter", "title": "Filter History", "icon": "$(filter)", "category": "Quick Command Runner" },
      { "command": "quickCommandRunner.historyClear", "title": "Clear History", "icon": "$(clear-all)", "category": "Quick Command Runner" },
      { "command": "quickCommandRunner.historyRerun", "title": "Re-run", "icon": "$(play)" },
      { "command": "quickCommandRunner.historyOpenLog", "title": "Open Log", "category": "Quick Command Runner" }
    ],
    "menus": {
      "view/title": [
        { "command": "quickCommandRunner.refresh", "when": "view == quickCommandRunnerCommands", "group": "navigation@1" },
        { "command": "quickCommandRunner.search", "when": "view == quickCommandRunnerCommands", "group": "navigation@2" },
        { "command": "quickCommandRunner.clearFilter", "when": "view == quickCommandRunnerCommands && quickCommandRunner.filterActive", "group": "navigation@3" },
        { "command": "quickCommandRunner.refresh", "when": "view == quickCommandRunnerHistory", "group": "navigation@1" },
        { "command": "quickCommandRunner.historySort", "when": "view == quickCommandRunnerHistory", "group": "navigation@2" },
        { "command": "quickCommandRunner.historyFilter", "when": "view == quickCommandRunnerHistory", "group": "navigation@3" },
        { "command": "quickCommandRunner.historyClear", "when": "view == quickCommandRunnerHistory", "group": "navigation@4" }
      ],
      "view/item/context": [
        {
          "command": "quickCommandRunner.run",
          "when": "view == quickCommandRunnerCommands && viewItem =~ /^cmd\\.(idle|success|failed|cancelled)\\.(fav|nofav)$/",
          "group": "inline"
        },
        {
          "command": "quickCommandRunner.cancel",
          "when": "view == quickCommandRunnerCommands && viewItem =~ /^cmd\\.running\\.(fav|nofav)$/",
          "group": "inline"
        },
        {
          "command": "quickCommandRunner.toggleFavorite",
          "when": "view == quickCommandRunnerCommands && viewItem =~ /^cmd\\./",
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
        },
        {
          "command": "quickCommandRunner.historyRerun",
          "when": "view == quickCommandRunnerHistory && viewItem =~ /^history\\./",
          "group": "inline"
        },
        {
          "command": "quickCommandRunner.historyOpenLog",
          "when": "view == quickCommandRunnerHistory && viewItem =~ /^history\\./",
          "group": "1_log"
        }
      ]
    }
  },
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

- [ ] **Step 5: Verify it compiles, lints, and tests pass**

Run: `npm test`
Expected: PASS — 126/126 (unchanged; this task only touches `node:test`-uncovered modules and `package.json`).

Run: `npm run lint`
Expected: PASS — no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/logManager.ts src/extension.ts package.json
git commit -m "Wire up History view, favorite/history commands, and history settings"
```

---

## Final Verification

After Task 7, run the full suite once more from the worktree root:

```bash
npm test
```

Expected: `126/126` tests passing (88 baseline; net new tests: Task1 +12, Task2 +10, Task3 +9, Task4 +7 net — final total 126).

Then proceed to a final holistic code review of the whole `phase4-history-favorites` branch diff against `master`, followed by `superpowers:finishing-a-development-branch`.
