import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpawnArgs, resolveShell, spawnProcess, cancelProcess } from '../../src/processManager';
import { CommandDefinition } from '../../src/types';

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

test('buildSpawnArgs: command uses resolved shell (linux auto -> /bin/sh)', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', command: 'npm test' };
  const result = buildSpawnArgs(def, { platform: 'linux', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: '/bin/sh', args: ['-c', 'npm test'] });
});

test('buildSpawnArgs: command with explicit bash shell', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', command: 'echo hi', shell: 'bash' };
  const result = buildSpawnArgs(def, { platform: 'linux', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: '/bin/bash', args: ['-c', 'echo hi'] });
});

test('buildSpawnArgs: .sh file with no explicit shell infers bash', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', file: 'scripts/build.sh', args: ['--release'] };
  const result = buildSpawnArgs(def, { platform: 'linux', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: '/bin/bash', args: ['scripts/build.sh', '--release'] });
});

test('buildSpawnArgs: .ps1 file infers powershell -File', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', file: 'scripts/deploy.ps1' };
  const result = buildSpawnArgs(def, { platform: 'win32', env: {}, fileExists: noFiles });
  assert.deepEqual(result, {
    executable: 'powershell.exe',
    args: ['-NoProfile', '-File', 'scripts/deploy.ps1'],
  });
});

test('buildSpawnArgs: .bat file on win32 uses cmd', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', file: 'scripts/build.bat', args: ['Release'] };
  const result = buildSpawnArgs(def, { platform: 'win32', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: 'cmd.exe', args: ['/d', '/s', '/c', 'scripts/build.bat', 'Release'] });
});

test('buildSpawnArgs: .py file uses python3 on non-windows', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', file: 'scripts/run.py', args: ['--fast'] };
  const result = buildSpawnArgs(def, { platform: 'linux', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: 'python3', args: ['scripts/run.py', '--fast'] });
});

test('buildSpawnArgs: executable file with no extension spawns directly', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', file: './my-tool', args: ['--version'] };
  const result = buildSpawnArgs(def, { platform: 'linux', env: {}, fileExists: noFiles });
  assert.deepEqual(result, { executable: './my-tool', args: ['--version'] });
});

test('buildSpawnArgs: returns null when shell is unsupported on this platform', () => {
  const def: CommandDefinition = { id: 'x', name: 'X', command: 'dir', shell: 'cmd' };
  const result = buildSpawnArgs(def, { platform: 'linux', env: {}, fileExists: noFiles });
  assert.equal(result, null);
});

test('spawnProcess runs a command and captures stdout', async () => {
  const { child } = spawnProcess(process.execPath, ['-e', "console.log('hello')"], {
    cwd: process.cwd(),
    env: process.env,
  });

  let output = '';
  child.stdout?.on('data', (chunk) => {
    output += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('exit', (code) => resolve(code));
  });

  assert.equal(exitCode, 0);
  assert.match(output, /hello/);
});

test('cancelProcess terminates a running process', async () => {
  const { pid, child } = spawnProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: process.cwd(),
    env: process.env,
  });

  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  await cancelProcess(pid, 50);
  await exited;

  assert.notEqual(child.signalCode, null);
});
