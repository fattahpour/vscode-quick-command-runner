import { QuickCommandRunnerConfig } from './types';

export const DEFAULT_CONFIG: QuickCommandRunnerConfig = {
  groups: [
    {
      name: 'Build',
      commands: [
        {
          id: 'build',
          name: 'Build',
          description: 'Run the project build script',
          command: 'npm run build',
          shell: 'auto',
        },
      ],
    },
  ],
};
