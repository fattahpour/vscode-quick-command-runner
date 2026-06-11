import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_ICONS,
  deriveDisplayStatus,
  formatStatusDescription,
  describeCommandLine,
  buildCommandViewState,
  filterGroups,
  buildCommandTree,
} from '../../src/commandViewModel';
import { CommandStatus, CommandGroup, CommandDefinition } from '../../src/types';

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
    lastResult: { status: 'failed', endTime: 1000, durationMs: 500, exitCode: 1, extractedPaths: [] },
  };
  assert.equal(deriveDisplayStatus(status, false), 'failed');
});

test('deriveDisplayStatus: never run is idle', () => {
  const status: CommandStatus = { active: [], lastResult: null };
  assert.equal(deriveDisplayStatus(status, false), 'idle');
});

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
    lastResult: { status: 'success', endTime: 5000, durationMs: 3200, exitCode: 0, extractedPaths: [] },
  };
  assert.equal(formatStatusDescription('success', status, 0), '✓ 3.2s');
});

test('formatStatusDescription: failed shows exit code', () => {
  const status: CommandStatus = {
    active: [],
    lastResult: { status: 'failed', endTime: 5000, durationMs: 100, exitCode: 1, extractedPaths: [] },
  };
  assert.equal(formatStatusDescription('failed', status, 0), '✗ exit 1');
});

test('formatStatusDescription: failed with no exit code shows ?', () => {
  const status: CommandStatus = {
    active: [],
    lastResult: { status: 'failed', endTime: 5000, durationMs: 100, exitCode: null, extractedPaths: [] },
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
