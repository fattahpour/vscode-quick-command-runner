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
