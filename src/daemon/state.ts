/**
 * imece-daemon state management
 * Handles agent state, caching, and persistence
 */

import type { AgentState, WatcherState, SwarmStatus, InboxMessage, TimelineEntry, LockInfo } from './types.js';

/** State manager for daemon operations */
export class DaemonState {
  private agents: Map<string, AgentState> = new Map();
  private messages: Map<string, InboxMessage> = new Map();
  private locks: Map<string, LockInfo> = new Map();
  private watcherState: WatcherState;
  private lastTimelineHash: string = '';

  constructor() {
    this.watcherState = {
      isRunning: false,
      lastPollTime: 0,
      lastTimelineSize: 0,
      processedMessageIds: new Set(),
      pollCount: 0,
      errorCount: 0,
    };
  }

  /** Get watcher state */
  getWatcherState(): Readonly<WatcherState> {
    return { ...this.watcherState };
  }

  /** Update watcher state */
  updateWatcherState(updates: Partial<WatcherState>): void {
    this.watcherState = { ...this.watcherState, ...updates };
  }

  /** Mark watcher as running */
  start(): void {
    this.watcherState.isRunning = true;
    this.watcherState.lastPollTime = Date.now();
  }

  /** Mark watcher as stopped */
  stop(): void {
    this.watcherState.isRunning = false;
  }

  /** Record a successful poll */
  recordPoll(): void {
    this.watcherState.pollCount++;
    this.watcherState.lastPollTime = Date.now();
  }

  /** Record an error */
  recordError(): void {
    this.watcherState.errorCount++;
  }

  /** Check if message was already processed */
  isMessageProcessed(messageId: string): boolean {
    return this.watcherState.processedMessageIds.has(messageId);
  }

  /** Mark message as processed */
  markMessageProcessed(messageId: string): void {
    this.watcherState.processedMessageIds.add(messageId);

    // Prevent memory leak - keep only last 1000 message IDs
    if (this.watcherState.processedMessageIds.size > 1000) {
      const iterator = this.watcherState.processedMessageIds.values();
      const first = iterator.next();
      if (!first.done) {
        this.watcherState.processedMessageIds.delete(first.value);
      }
    }
  }

  /** Store agent state */
  setAgentState(agent: AgentState): void {
    this.agents.set(agent.name, { ...agent });
  }

  /** Get agent state */
  getAgentState(name: string): AgentState | undefined {
    return this.agents.get(name);
  }

  /** Get all agents */
  getAllAgents(): AgentState[] {
    return Array.from(this.agents.values());
  }

  /** Update agent field */
  updateAgent(name: string, updates: Partial<AgentState>): void {
    const existing = this.agents.get(name);
    if (existing) {
      this.agents.set(name, { ...existing, ...updates });
    }
  }

  /** Remove agent */
  removeAgent(name: string): void {
    this.agents.delete(name);
  }

  /** Store message */
  setMessage(message: InboxMessage): void {
    this.messages.set(message.id, { ...message });
  }

  /** Get message */
  getMessage(id: string): InboxMessage | undefined {
    return this.messages.get(id);
  }

  /** Get all messages for an agent */
  getMessagesForAgent(agentName: string): InboxMessage[] {
    return Array.from(this.messages.values())
      .filter(m => !this.isMessageProcessed(m.id));
  }

  /** Store lock */
  setLock(lock: LockInfo): void {
    this.locks.set(lock.filePath, { ...lock });
  }

  /** Remove lock */
  removeLock(filePath: string): void {
    this.locks.delete(filePath);
  }

  /** Get lock for file */
  getLock(filePath: string): LockInfo | undefined {
    return this.locks.get(filePath);
  }

  /** Get all locks */
  getAllLocks(): LockInfo[] {
    return Array.from(this.locks.values());
  }

  /** Check if file is locked */
  isFileLocked(filePath: string): boolean {
    return this.locks.has(filePath);
  }

  /** Set timeline hash for change detection */
  setTimelineHash(hash: string, size: number): void {
    this.lastTimelineHash = hash;
    this.watcherState.lastTimelineSize = size;
  }

  /** Get timeline hash */
  getTimelineHash(): string {
    return this.lastTimelineHash;
  }

  /** Update swarm status from imece data */
  updateFromSwarmStatus(status: SwarmStatus): void {
    // Update agents
    for (const agent of status.agents) {
      this.setAgentState(agent);
    }

    // Update locks
    for (const lock of status.locks) {
      this.setLock(lock);
    }
  }

  /** Get stats summary */
  getStats(): {
    agents: number;
    messages: number;
    locks: number;
    polls: number;
    errors: number;
  } {
    return {
      agents: this.agents.size,
      messages: this.messages.size,
      locks: this.locks.size,
      polls: this.watcherState.pollCount,
      errors: this.watcherState.errorCount,
    };
  }

  /** Clear all state */
  clear(): void {
    this.agents.clear();
    this.messages.clear();
    this.locks.clear();
    this.watcherState = {
      isRunning: false,
      lastPollTime: 0,
      lastTimelineSize: 0,
      processedMessageIds: new Set(),
      pollCount: 0,
      errorCount: 0,
    };
    this.lastTimelineHash = '';
  }
}

/** Create a simple hash for change detection */
export function createHash(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

/** Singleton state instance */
let globalState: DaemonState | null = null;

/** Get or create global state instance */
export function getGlobalState(): DaemonState {
  if (!globalState) {
    globalState = new DaemonState();
  }
  return globalState;
}

/** Reset global state (for testing) */
export function resetGlobalState(): void {
  globalState = null;
}
