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
