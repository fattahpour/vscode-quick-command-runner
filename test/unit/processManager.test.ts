import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveShell } from '../../src/processManager';

const noFiles = () => false;

test('resolveShell: cmd on win32', () => {
  const result = resolveShell('cmd', { platform: 'win32', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: 'cmd.exe', shellArgs: ['/d', '/s', '/c'] });
});

test('resolveShell: auto on win32 defaults to cmd', () => {
  const result = resolveShell('auto', { platform: 'win32', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: 'cmd.exe', shellArgs: ['/d', '/s', '/c'] });
});

test('resolveShell: bash on win32 uses Git Bash when present', () => {
  const env = { ProgramFiles: 'C:\\Program Files' };
  const gitBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
  const result = resolveShell('bash', {
    platform: 'win32',
    env,
    fileExists: (p) => p === gitBashPath,
  });
  assert.deepEqual(result, { executable: gitBashPath, shellArgs: ['-c'] });
});

test('resolveShell: bash on win32 falls back to WSL when Git Bash missing', () => {
  const result = resolveShell('bash', { platform: 'win32', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: 'wsl.exe', shellArgs: ['-e', 'bash', '-lc'] });
});

test('resolveShell: wsl on win32', () => {
  const result = resolveShell('wsl', { platform: 'win32', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: 'wsl.exe', shellArgs: ['-e', 'bash', '-lc'] });
});

test('resolveShell: powershell on win32', () => {
  const result = resolveShell('powershell', { platform: 'win32', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: 'powershell.exe', shellArgs: ['-NoProfile', '-Command'] });
});

test('resolveShell: bash on linux', () => {
  const result = resolveShell('bash', { platform: 'linux', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: '/bin/bash', shellArgs: ['-c'] });
});

test('resolveShell: gitbash on linux falls back to bash', () => {
  const result = resolveShell('gitbash', { platform: 'linux', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: '/bin/bash', shellArgs: ['-c'] });
});

test('resolveShell: cmd on linux is unsupported', () => {
  const result = resolveShell('cmd', { platform: 'linux', env: {}, fileExists: noFiles });
  assert.equal(result, null);
});

test('resolveShell: powershell on darwin is unsupported', () => {
  const result = resolveShell('powershell', { platform: 'darwin', env: {}, fileExists: noFiles });
  assert.equal(result, null);
});

test('resolveShell: zsh on linux falls back to bash when zsh missing', () => {
  const result = resolveShell('zsh', { platform: 'linux', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: '/bin/bash', shellArgs: ['-c'] });
});

test('resolveShell: zsh on linux uses zsh when present', () => {
  const result = resolveShell('zsh', {
    platform: 'linux',
    env: {},
    fileExists: (p) => p === '/bin/zsh',
  });
  assert.deepEqual(result, { executable: '/bin/zsh', shellArgs: ['-c'] });
});

test('resolveShell: auto on linux uses $SHELL', () => {
  const result = resolveShell('auto', {
    platform: 'linux',
    env: { SHELL: '/usr/bin/fish' },
    fileExists: noFiles,
  });
  assert.deepEqual(result, { executable: '/usr/bin/fish', shellArgs: ['-c'] });
});

test('resolveShell: auto on linux falls back to /bin/sh without $SHELL', () => {
  const result = resolveShell('auto', { platform: 'linux', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: '/bin/sh', shellArgs: ['-c'] });
});

test('resolveShell: pwsh on linux when not installed', () => {
  const result = resolveShell('pwsh', { platform: 'linux', env: {}, fileExists: noFiles });
  assert.equal(result, null);
});

test('resolveShell: pwsh on linux when installed', () => {
  const result = resolveShell('pwsh', {
    platform: 'linux',
    env: {},
    fileExists: (p) => p === '/usr/bin/pwsh',
  });
  assert.deepEqual(result, { executable: '/usr/bin/pwsh', shellArgs: ['-NoProfile', '-Command'] });
});

test('resolveShell: pwsh on win32', () => {
  const result = resolveShell('pwsh', { platform: 'win32', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: 'pwsh.exe', shellArgs: ['-NoProfile', '-Command'] });
});

test('resolveShell: bash on darwin', () => {
  const result = resolveShell('bash', { platform: 'darwin', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: '/bin/bash', shellArgs: ['-c'] });
});

test('resolveShell: sh on darwin', () => {
  const result = resolveShell('sh', { platform: 'darwin', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: '/bin/sh', shellArgs: ['-c'] });
});

test('resolveShell: zsh on darwin uses zsh when present', () => {
  const result = resolveShell('zsh', {
    platform: 'darwin',
    env: {},
    fileExists: (p) => p === '/bin/zsh',
  });
  assert.deepEqual(result, { executable: '/bin/zsh', shellArgs: ['-c'] });
});

test('resolveShell: auto on darwin uses $SHELL', () => {
  const result = resolveShell('auto', {
    platform: 'darwin',
    env: { SHELL: '/bin/zsh' },
    fileExists: noFiles,
  });
  assert.deepEqual(result, { executable: '/bin/zsh', shellArgs: ['-c'] });
});

test('resolveShell: pwsh on darwin when not installed', () => {
  const result = resolveShell('pwsh', { platform: 'darwin', env: {}, fileExists: noFiles });
  assert.equal(result, null);
});

test('resolveShell: sh on linux', () => {
  const result = resolveShell('sh', { platform: 'linux', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: '/bin/sh', shellArgs: ['-c'] });
});
