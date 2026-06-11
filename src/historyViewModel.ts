import { HistoryEntry } from './types';
import { STATUS_ICONS } from './commandViewModel';

export interface HistoryViewState {
  label: string;
  description: string;
  iconId: string;
  iconColor: string;
  contextValue: string;
  tooltip: string;
}

export function formatRelativeTime(timestampMs: number, now: number): string {
  const diffSec = Math.floor((now - timestampMs) / 1000);
  if (diffSec < 5) {
    return 'just now';
  }
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return `${diffHour}h ago`;
  }
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

export function formatHistoryDescription(entry: HistoryEntry): string {
  return `${entry.durationMs}ms · exit ${entry.exitCode ?? '?'}`;
}

export function buildHistoryViewState(entry: HistoryEntry, now: number): HistoryViewState {
  const icon = STATUS_ICONS[entry.status];
  return {
    label: `${entry.commandSnapshot.name} — ${formatRelativeTime(entry.endTime, now)}`,
    description: formatHistoryDescription(entry),
    iconId: icon.icon,
    iconColor: icon.color,
    contextValue: `history.${entry.status}`,
    tooltip: entry.fullCommand,
  };
}
