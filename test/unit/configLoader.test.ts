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
