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
