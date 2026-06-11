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
    lastResult: { status: 'failed', endTime: 1000, durationMs: 500, exitCode: 1 },
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
