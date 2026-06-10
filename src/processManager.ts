import * as path from 'path';
import { ResolvedShell, ShellType } from './types';

export interface ShellResolutionContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fileExists: (filePath: string) => boolean;
}

const GITBASH_CANDIDATES = (env: NodeJS.ProcessEnv): string[] => [
  path.win32.join(env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
  path.win32.join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
];

const PWSH_CANDIDATES: Record<string, string[]> = {
  darwin: ['/usr/local/bin/pwsh', '/opt/homebrew/bin/pwsh'],
  linux: ['/usr/bin/pwsh', '/opt/microsoft/powershell/7/pwsh', '/usr/local/bin/pwsh'],
};

const ZSH_CANDIDATES = ['/bin/zsh', '/usr/bin/zsh'];

function findFirst(candidates: string[], fileExists: (p: string) => boolean): string | undefined {
  return candidates.find(fileExists);
}

export function resolveShell(
  shellType: ShellType = 'auto',
  ctx: ShellResolutionContext,
): ResolvedShell | null {
  const { platform, env, fileExists } = ctx;

  if (platform === 'win32') {
    switch (shellType) {
      case 'bash':
      case 'gitbash':
      case 'sh':
      case 'zsh': {
        const gitBash = findFirst(GITBASH_CANDIDATES(env), fileExists);
        if (gitBash) {
          return { executable: gitBash, shellArgs: ['-c'] };
        }
        return { executable: 'wsl.exe', shellArgs: ['-e', 'bash', '-lc'] };
      }
      case 'wsl':
        return { executable: 'wsl.exe', shellArgs: ['-e', 'bash', '-lc'] };
      case 'cmd':
        return { executable: 'cmd.exe', shellArgs: ['/d', '/s', '/c'] };
      case 'powershell':
        return { executable: 'powershell.exe', shellArgs: ['-NoProfile', '-Command'] };
      case 'pwsh':
        return { executable: 'pwsh.exe', shellArgs: ['-NoProfile', '-Command'] };
      case 'auto':
      default:
        return { executable: 'cmd.exe', shellArgs: ['/d', '/s', '/c'] };
    }
  }

  // darwin / linux
  switch (shellType) {
    case 'wsl':
    case 'cmd':
    case 'powershell':
      return null;
    case 'pwsh': {
      const candidates = PWSH_CANDIDATES[platform] ?? PWSH_CANDIDATES.linux;
      const pwsh = findFirst(candidates, fileExists);
      return pwsh ? { executable: pwsh, shellArgs: ['-NoProfile', '-Command'] } : null;
    }
    case 'bash':
    case 'gitbash':
      return { executable: '/bin/bash', shellArgs: ['-c'] };
    case 'sh':
      return { executable: '/bin/sh', shellArgs: ['-c'] };
    case 'zsh': {
      const zsh = findFirst(ZSH_CANDIDATES, fileExists);
      return zsh ? { executable: zsh, shellArgs: ['-c'] } : { executable: '/bin/bash', shellArgs: ['-c'] };
    }
    case 'auto':
    default: {
      const shell = env.SHELL;
      if (shell) {
        return { executable: shell, shellArgs: ['-c'] };
      }
      return { executable: '/bin/sh', shellArgs: ['-c'] };
    }
  }
}
