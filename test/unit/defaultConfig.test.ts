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
