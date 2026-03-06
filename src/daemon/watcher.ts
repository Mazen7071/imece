/**
 * imece-daemon watcher
 * Main daemon core with interval polling, FS watching, and event emission
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import type {
  DaemonConfig,
  DaemonEvent,
  DaemonEventType,
  EventListener,
  AgentState,
  InboxMessage,
  TimelineEntry,
  TaskInfo,
  LockInfo,
  SwarmStatus,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { DaemonState, createHash } from './state.js';

/** Main daemon watcher class */
export class ImeceDaemon {
  private config: Required<DaemonConfig>;
  private state: DaemonState;
  private listeners: Map<DaemonEventType, Set<EventListener>> = new Map();
  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private watchAbortController: AbortController | null = null;
  private isRunning = false;
  private imeceDir: string;

  constructor(config: Partial<DaemonConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<DaemonConfig>;
    this.state = new DaemonState();
    this.imeceDir = join(process.cwd(), '.imece');
  }

  /** Get current configuration */
  getConfig(): Required<DaemonConfig> {
    return { ...this.config };
  }

  /** Update configuration */
  updateConfig(updates: Partial<DaemonConfig>): void {
    this.config = { ...this.config, ...updates } as Required<DaemonConfig>;

    // Restart timers if running
    if (this.isRunning) {
      this.stop();
      this.start();
    }
  }

  /** Register event listener */
  on(event: DaemonEventType, listener: EventListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  /** Register one-time event listener */
  once(event: DaemonEventType, listener: EventListener): void {
    const unsubscribe = this.on(event, async (e) => {
      unsubscribe();
      await listener(e);
    });
  }

  /** Emit event to all listeners */
  private async emit(event: DaemonEvent): Promise<void> {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          await listener(event);
        } catch (err) {
          console.error(`[daemon] Event listener error:`, err);
        }
      }
    }

    // Also emit to wildcard listeners
    const wildcards = this.listeners.get('*' as DaemonEventType);
    if (wildcards) {
      for (const listener of wildcards) {
        try {
          await listener(event);
        } catch (err) {
          console.error(`[daemon] Wildcard listener error:`, err);
        }
      }
    }
  }

  /** Start the daemon */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[daemon] Already running');
      return;
    }

    console.log(`[daemon] Starting watcher for agent: ${this.config.agentName}`);
    this.isRunning = true;
    this.state.start();

    // Initial poll
    await this.poll();

    // Start polling timer
    this.pollTimer = setInterval(() => {
      this.poll().catch(err => {
        console.error('[daemon] Poll error:', err);
        this.state.recordError();
      });
    }, this.config.pollInterval);

    // Start heartbeat timer
    if (this.config.heartbeatInterval > 0) {
      this.heartbeatTimer = setInterval(() => {
        this.sendHeartbeat().catch(err => {
          console.error('[daemon] Heartbeat error:', err);
        });
      }, this.config.heartbeatInterval);
    }

    // Start FS watcher if enabled
    if (this.config.watchTimeline) {
      this.startTimelineWatcher();
    }

    await this.emit({
      type: 'agent-online',
      timestamp: Date.now(),
      agent: this.config.agentName,
      data: { message: 'Daemon started' },
    });

    console.log('[daemon] Watcher started successfully');
  }

  /** Stop the daemon */
  async stop(): Promise<void> {
    console.log('[daemon] Stopping watcher...');

    this.isRunning = false;
    this.state.stop();

    // Clear timers
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Abort FS watcher
    if (this.watchAbortController) {
      this.watchAbortController.abort();
      this.watchAbortController = null;
    }

    await this.emit({
      type: 'agent-offline',
      timestamp: Date.now(),
      agent: this.config.agentName,
      data: { message: 'Daemon stopped' },
    });

    console.log('[daemon] Watcher stopped');
  }

  /** Check if daemon is running */
  isActive(): boolean {
    return this.isRunning;
  }

  /** Main polling function */
  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Check inbox
      await this.checkInbox();

      // Check swarm status
      await this.checkSwarmStatus();

      // Check timeline for new events
      await this.checkTimeline();

      this.state.recordPoll();
    } catch (err) {
      console.error('[daemon] Poll error:', err);
      this.state.recordError();
    }
  }

  /** Check inbox for new messages */
  private async checkInbox(): Promise<void> {
    if (!this.config.agentName) return;

    try {
      const inboxDir = join(this.imeceDir, 'inbox', this.config.agentName);

      // Check if inbox directory exists
      try {
        await fs.access(inboxDir);
      } catch {
        return; // No inbox yet
      }

      const files = await fs.readdir(inboxDir);
      const messageFiles = files.filter(f => f.startsWith('msg_') && f.endsWith('.json'));

      for (const file of messageFiles) {
        const messageId = file.replace('msg_', '').replace(/\.json$/, '').split('_')[0];

        if (!messageId || this.state.isMessageProcessed(messageId)) {
          continue;
        }

        const filePath = join(inboxDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        const message: InboxMessage = JSON.parse(content);

        // Store and emit
        this.state.setMessage(message);
        this.state.markMessageProcessed(messageId);

        await this.emit({
          type: 'message',
          timestamp: Date.now(),
          agent: this.config.agentName,
          data: message,
        });

        // Auto-claim tasks if enabled
        if (this.config.autoClaim && message.type === 'task-delegate') {
          await this.autoClaimTask(message);
        }
      }
    } catch (err) {
      console.error('[daemon] Inbox check error:', err);
    }
  }

  /** Auto-claim a task */
  private async autoClaimTask(message: InboxMessage): Promise<void> {
    // Extract task ID from body
    const match = message.body.match(/Task ID:\s*(\S+)/);
    if (match) {
      const taskId = match[1];
      console.log(`[daemon] Auto-claiming task: ${taskId}`);
      await this.runImeceCommand(`task claim ${taskId} ${this.config.agentName}`);
    }
  }

  /** Check swarm status */
  private async checkSwarmStatus(): Promise<void> {
    try {
      const result = await this.runImeceCommand('status --json');
      const status: SwarmStatus = JSON.parse(result);

      // Update state
      this.state.updateFromSwarmStatus(status);

      // Check for status changes
      for (const agent of status.agents) {
        const existing = this.state.getAgentState(agent.name);

        if (!existing) {
          // New agent detected
          await this.emit({
            type: 'agent-online',
            timestamp: Date.now(),
            agent: agent.name,
            data: agent,
          });
        } else if (existing.status !== agent.status) {
          // Status changed
          await this.emit({
            type: agent.status === 'offline' ? 'agent-offline' : 'agent-online',
            timestamp: Date.now(),
            agent: agent.name,
            data: agent,
          });
        }
      }
    } catch (err) {
      // Status might not support --json yet
      // Silently ignore for backward compatibility
    }
  }

  /** Check timeline for new events */
  private async checkTimeline(): Promise<void> {
    try {
      const timelinePath = join(this.imeceDir, 'timeline.jsonl');

      let content: string;
      try {
        content = await fs.readFile(timelinePath, 'utf8');
      } catch {
        return; // No timeline yet
      }

      const hash = createHash(content);
      const size = content.length;

      // Check if changed
      if (hash === this.state.getTimelineHash()) {
        return; // No changes
      }

      this.state.setTimelineHash(hash, size);

      // Parse new entries
      const lines = content.trim().split('\n').filter(Boolean);
      const entries: TimelineEntry[] = lines.map(line => JSON.parse(line));

      // Process recent entries (last 10)
      const recent = entries.slice(-10);

      for (const entry of recent) {
        // Skip own entries
        if (entry.agent === this.config.agentName) continue;

        // Determine event type
        let eventType: DaemonEventType = 'broadcast';
        if (entry.type.includes('task')) eventType = 'task-created';
        if (entry.type.includes('lock')) eventType = 'file-locked';

        await this.emit({
          type: eventType,
          timestamp: new Date(entry.timestamp).getTime(),
          agent: entry.agent,
          data: entry,
        });
      }
    } catch (err) {
      console.error('[daemon] Timeline check error:', err);
    }
  }

  /** Start watching timeline.jsonl for changes */
  private async startTimelineWatcher(): Promise<void> {
    const timelinePath = join(this.imeceDir, 'timeline.jsonl');

    // Check if file exists
    try {
      await fs.access(timelinePath);
    } catch {
      console.log('[daemon] timeline.jsonl not found, skipping FS watcher');
      return;
    }

    // Use polling-based watching for cross-platform compatibility
    let lastMtime = 0;

    const checkFile = async () => {
      if (!this.isRunning) return;

      try {
        const stats = await fs.stat(timelinePath);
        if (stats.mtimeMs > lastMtime) {
          lastMtime = stats.mtimeMs;
          await this.checkTimeline();
        }
      } catch {
        // File might not exist
      }

      if (this.isRunning) {
        setTimeout(checkFile, 1000); // Check every second
      }
    };

    checkFile();
    console.log('[daemon] FS watcher started for timeline.jsonl');
  }

  /** Send heartbeat */
  private async sendHeartbeat(): Promise<void> {
    if (!this.config.agentName) return;

    try {
      await this.runImeceCommand(`heartbeat ${this.config.agentName}`);
      console.log(`[daemon] Heartbeat sent for ${this.config.agentName}`);
    } catch (err) {
      console.error('[daemon] Heartbeat failed:', err);
    }
  }

  /** Run imece CLI command */
  private runImeceCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('npx', ['@oxog/imece', ...command.split(' ')], {
        cwd: process.cwd(),
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Command failed with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }

  /** Get daemon stats */
  getStats() {
    return this.state.getStats();
  }

  /** Get current state */
  getState() {
    return this.state.getWatcherState();
  }
}

/** Create and start a daemon instance */
export async function createDaemon(config: Partial<DaemonConfig> = {}): Promise<ImeceDaemon> {
  const daemon = new ImeceDaemon(config);
  await daemon.start();
  return daemon;
}

/** Default export */
export default ImeceDaemon;
