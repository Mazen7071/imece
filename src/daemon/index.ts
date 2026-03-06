/**
 * imece-daemon
 * Background agent watcher for imece multi-agent coordination
 */

export { ImeceDaemon, createDaemon } from './watcher.js';
export { DaemonState, getGlobalState, resetGlobalState, createHash } from './state.js';
export type {
  AgentState,
  DaemonConfig,
  DaemonEvent,
  DaemonEventType,
  EventListener,
  InboxMessage,
  LockInfo,
  SwarmStatus,
  TaskInfo,
  TimelineEntry,
  WatcherState,
} from './types.js';
export { DEFAULT_CONFIG } from './types.js';
