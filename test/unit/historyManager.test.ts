import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HistoryManager,
  HistoryMemento,
  filterEntries,
  sortEntries,
  TruncatingBuffer,
  HISTORY_OUTPUT_CAP,
  TRUNCATION_MARKER,
} from '../../src/historyManager';
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
