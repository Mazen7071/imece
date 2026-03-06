/**
 * imece-daemon types
 * Core type definitions for the background agent watcher
 */

/** Agent state in the daemon */
export interface AgentState {
  name: string;
  role: string;
  status: 'online' | 'busy' | 'idle' | 'offline';
  lastHeartbeat: number;
  currentTask: string | null;
  unreadMessages: number;
}

/** Event types emitted by the daemon */
export type DaemonEventType =
  | 'message'
  | 'task-created'
  | 'task-assigned'
  | 'task-completed'
  | 'agent-online'
  | 'agent-offline'
  | 'file-locked'
  | 'file-unlocked'
  | 'broadcast';

/** Event payload structure */
export interface DaemonEvent {
  type: DaemonEventType;
  timestamp: number;
  agent?: string;
  data: unknown;
}

/** Event listener callback */
export type EventListener = (event: DaemonEvent) => void | Promise<void>;

/** Daemon configuration options */
export interface DaemonConfig {
  /** Polling interval in milliseconds (default: 15000) */
  pollInterval: number;
  /** Watch timeline.jsonl for changes (default: true) */
  watchTimeline: boolean;
  /** Auto-claim tasks assigned to this agent (default: false) */
  autoClaim: boolean;
  /** Heartbeat interval in milliseconds (default: 120000) */
  heartbeatInterval: number;
  /** Agent name this daemon watches */
  agentName: string;
}

/** Default daemon configuration */
export const DEFAULT_CONFIG: DaemonConfig = {
  pollInterval: 15000,
  watchTimeline: true,
  autoClaim: false,
  heartbeatInterval: 120000,
  agentName: '',
};

/** Task information from the system */
export interface TaskInfo {
  id: string;
  title: string;
  assignee: string | null;
  status: 'pending' | 'active' | 'done' | 'blocked';
}

/** Lock information */
export interface LockInfo {
  filePath: string;
  agent: string;
  timestamp: number;
}

/** Message from inbox */
export interface InboxMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
  timestamp: number;
  type: string;
  priority?: string;
}

/** Swarm status overview */
export interface SwarmStatus {
  agents: AgentState[];
  tasks: {
    backlog: number;
    active: number;
    done: number;
    blocked: number;
  };
  locks: LockInfo[];
}

/** Timeline entry */
export interface TimelineEntry {
  timestamp: string;
  agent: string;
  type: string;
  message: string;
}

/** Watcher state */
export interface WatcherState {
  isRunning: boolean;
  lastPollTime: number;
  lastTimelineSize: number;
  processedMessageIds: Set<string>;
  pollCount: number;
  errorCount: number;
}
