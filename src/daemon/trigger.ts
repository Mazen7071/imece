/**
 * Agent Trigger System
 * Handles agent notifications, priority queues, and conflict detection
 */

import type { AgentProfile, AgentStatus, Priority, ImeceTask } from '../types.js';
import { now } from '../utils/time.js';

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION FORMAT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Notification types for agent triggers
 */
export type NotificationType =
  | 'task:assigned'
  | 'task:completed'
  | 'task:blocked'
  | 'message:received'
  | 'agent:status'
  | 'agent:online'
  | 'agent:offline'
  | 'conflict:detected'
  | 'error:recovery';

/**
 * Agent notification structure
 */
export interface AgentNotification {
  /** Unique notification ID */
  id: string;
  /** Notification type */
  type: NotificationType;
  /** Target agent name */
  agent: string;
  /** Notification timestamp */
  timestamp: string;
  /** Priority level */
  priority: Priority;
  /** Notification title */
  title: string;
  /** Detailed message */
  message: string;
  /** Related entity (task ID, message ID, etc.) */
  relatedId?: string | undefined;
  /** Additional metadata */
  meta?: Record<string, unknown> | undefined;
  /** Whether notification requires acknowledgment */
  requiresAck: boolean;
  /** Retry count for failed notifications */
  retryCount: number;
}

/**
 * Create a new agent notification
 */
export function createNotification(
  agent: string,
  type: NotificationType,
  title: string,
  message: string,
  options?: {
    priority?: Priority;
    relatedId?: string;
    meta?: Record<string, unknown>;
    requiresAck?: boolean;
  }
): AgentNotification {
  return {
    id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
    type,
    agent,
    timestamp: now(),
    priority: options?.priority ?? 'normal',
    title,
    message,
    relatedId: options?.relatedId,
    meta: options?.meta,
    requiresAck: options?.requiresAck ?? false,
    retryCount: 0
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY QUEUE
// ═══════════════════════════════════════════════════════════════════════════════

const PRIORITY_ORDER: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3
};

/**
 * Priority-based execution queue item
 */
export interface QueueItem<T> {
  /** Unique queue item ID */
  id: string;
  /** Item priority */
  priority: Priority;
  /** Payload data */
  data: T;
  /** Timestamp when added */
  addedAt: string;
  /** Number of attempts */
  attempts: number;
  /** Last error if failed */
  lastError?: string;
}

/**
 * Priority queue for agent tasks
 */
export class PriorityQueue<T> {
  private items: QueueItem<T>[] = [];

  /**
   * Add item to queue with priority ordering
   */
  enqueue(id: string, data: T, priority: Priority = 'normal'): void {
    const item: QueueItem<T> = {
      id,
      data,
      priority,
      addedAt: now(),
      attempts: 0
    };

    // Insert based on priority (lower index = higher priority)
    const insertIndex = this.items.findIndex(
      item => PRIORITY_ORDER[item.priority] > PRIORITY_ORDER[priority]
    );

    if (insertIndex === -1) {
      this.items.push(item);
    } else {
      this.items.splice(insertIndex, 0, item);
    }
  }

  /**
   * Remove and return highest priority item
   */
  dequeue(): QueueItem<T> | undefined {
    return this.items.shift();
  }

  /**
   * Peek at highest priority item without removing
   */
  peek(): QueueItem<T> | undefined {
    return this.items[0];
  }

  /**
   * Remove specific item by ID
   */
  remove(id: string): boolean {
    const index = this.items.findIndex(item => item.id === id);
    if (index !== -1) {
      this.items.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all items (for debugging)
   */
  getAll(): QueueItem<T>[] {
    return [...this.items];
  }

  /**
   * Get queue size
   */
  get size(): number {
    return this.items.length;
  }

  /**
   * Check if queue is empty
   */
  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Increment attempt count for item
   */
  incrementAttempts(id: string, error?: string): void {
    const item = this.items.find(i => i.id === id);
    if (item) {
      item.attempts++;
      if (error) item.lastError = error;
    }
  }

  /**
   * Get items by priority
   */
  getByPriority(priority: Priority): QueueItem<T>[] {
    return this.items.filter(item => item.priority === priority);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFLICT DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Agent availability status
 */
export type AgentAvailability = 'available' | 'busy' | 'offline' | 'unknown';

/**
 * Conflict information
 */
export interface AgentConflict {
  /** Agent name */
  agent: string;
  /** Type of conflict */
  type: 'busy' | 'offline' | 'task-conflict' | 'file-locked';
  /** Description */
  message: string;
  /** Current task if busy */
  currentTaskId?: string | undefined;
  /** Time since status changed */
  since?: string | undefined;
}

/**
 * Detect if agent can accept new work
 */
export function getAgentAvailability(agent: AgentProfile): AgentAvailability {
  switch (agent.status) {
    case 'online':
    case 'idle':
      return 'available';
    case 'busy':
    case 'waiting':
      return 'busy';
    case 'offline':
      return 'offline';
    default:
      return 'unknown';
  }
}

/**
 * Check for conflicts when assigning work to agent
 */
export function detectConflict(
  agent: AgentProfile,
  relatedTaskIds?: string[]
): AgentConflict | null {
  const availability = getAgentAvailability(agent);

  if (availability === 'offline') {
    return {
      agent: agent.name,
      type: 'offline',
      message: `Agent '${agent.name}' is offline`,
      currentTaskId: agent.currentTask ?? undefined,
      since: agent.lastSeen
    };
  }

  if (availability === 'busy') {
    return {
      agent: agent.name,
      type: 'busy',
      message: `Agent '${agent.name}' is busy with task: ${agent.currentTask ?? 'unknown'}`,
      currentTaskId: agent.currentTask ?? undefined
    };
  }

  // Check for task conflicts
  if (relatedTaskIds && agent.currentTask) {
    const hasConflict = relatedTaskIds.includes(agent.currentTask);
    if (hasConflict) {
      return {
        agent: agent.name,
        type: 'task-conflict',
        message: `Agent '${agent.name}' already working on related task`,
        currentTaskId: agent.currentTask
      };
    }
  }

  return null;
}

/**
 * Find best available agent from a list
 */
export function findBestAgent(agents: AgentProfile[]): AgentProfile | null {
  // Prefer available agents, then busy ones, never offline
  const available = agents.filter(a => getAgentAvailability(a) === 'available');

  if (available.length > 0) {
    // Pick agent with least recent activity (likely most available)
    const sorted = available.sort((a, b) =>
      new Date(a.lastSeen).getTime() - new Date(b.lastSeen).getTime()
    );
    return sorted[0] ?? null;
  }

  // Fall back to busy agents if none available
  const busy = agents.filter(a => getAgentAvailability(a) === 'busy');
  if (busy.length > 0) {
    return busy[0] ?? null;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-RESPONSE TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Auto-response template types
 */
export type AutoResponseTemplate =
  | 'acknowledge'
  | 'will-do'
  | 'busy-queue'
  | 'offline-notify'
  | 'conflict-detected'
  | 'error-recovery';

/**
 * Auto-response template messages
 */
export const AUTO_RESPONSES: Record<AutoResponseTemplate, {
  subject: string;
  body: string;
  priority: Priority;
}> = {
  acknowledge: {
    subject: 'Message Received',
    body: 'Your message has been received and will be processed.',
    priority: 'low'
  },
  'will-do': {
    subject: 'Task Accepted',
    body: 'I have accepted the task and will begin work shortly.',
    priority: 'normal'
  },
  'busy-queue': {
    subject: 'Queued for Later',
    body: 'I am currently busy. Your request has been queued and will be processed when I become available.',
    priority: 'normal'
  },
  'offline-notify': {
    subject: 'Agent Offline',
    body: 'The target agent is currently offline. Your message will be delivered when they return.',
    priority: 'high'
  },
  'conflict-detected': {
    subject: 'Conflict Detected',
    body: 'A conflict was detected. The task has been reassigned to an available agent.',
    priority: 'high'
  },
  'error-recovery': {
    subject: 'Error - Retrying',
    body: 'An error occurred while processing your request. Retrying...',
    priority: 'high'
  }
};

/**
 * Generate auto-response based on template
 */
export function generateAutoResponse(
  template: AutoResponseTemplate,
  context?: {
    agentName?: string;
    taskId?: string;
    originalMessage?: string;
  }
): { subject: string; body: string; priority: Priority } {
  const response = { ...AUTO_RESPONSES[template] };

  // Customize message with context
  if (context?.agentName) {
    response.body = response.body.replace(/\{agent\}/g, context.agentName);
  }
  if (context?.taskId) {
    response.body = response.body.replace(/\{task\}/g, context.taskId);
  }

  return response;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR RECOVERY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Error recovery strategies
 */
export type RecoveryStrategy =
  | 'retry'           // Retry the operation
  | 'requeue'         // Re-add to queue with lower priority
  | 'fallback'        // Use fallback agent
  | 'notify'          // Notify about failure
  | 'skip';           // Skip and continue

/**
 * Recovery configuration
 */
export interface RecoveryConfig {
  /** Maximum retry attempts */
  maxRetries: number;
  /** Base delay in ms */
  baseDelayMs: number;
  /** Max delay in ms */
  maxDelayMs: number;
  /** Whether to use exponential backoff */
  exponentialBackoff: boolean;
  /** Fallback agent name if available */
  fallbackAgent?: string;
}

/** Default recovery configuration */
export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  exponentialBackoff: true
};

/**
 * Recovery result
 */
export interface RecoveryResult {
  /** Whether recovery succeeded */
  success: boolean;
  /** Strategy used */
  strategy: RecoveryStrategy;
  /** Next action to take */
  nextAction: 'retry' | 'continue' | 'abort';
  /** Delay before next attempt (if retrying) */
  delayMs?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Calculate retry delay with exponential backoff
 */
export function calculateRetryDelay(
  attempt: number,
  config: RecoveryConfig
): number {
  if (!config.exponentialBackoff) {
    return config.baseDelayMs;
  }

  const delay = config.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Determine recovery strategy based on error type
 */
export function determineRecoveryStrategy(
  error: Error,
  attempt: number,
  config: RecoveryConfig
): RecoveryResult {
  const errorMessage = error.message.toLowerCase();

  // Network-related errors - retry
  if (errorMessage.includes('network') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('econn')) {
    if (attempt < config.maxRetries) {
      return {
        success: true,
        strategy: 'retry',
        nextAction: 'retry',
        delayMs: calculateRetryDelay(attempt, config)
      };
    }
    return {
      success: false,
      strategy: 'notify',
      nextAction: 'abort',
      error: 'Max retries exceeded for network error'
    };
  }

  // Conflict errors - fallback
  if (errorMessage.includes('conflict') ||
      errorMessage.includes('busy') ||
      errorMessage.includes('locked')) {
    if (config.fallbackAgent) {
      return {
        success: true,
        strategy: 'fallback',
        nextAction: 'continue'
      };
    }
    return {
      success: true,
      strategy: 'requeue',
      nextAction: 'continue'
    };
  }

  // Agent offline - requeue
  if (errorMessage.includes('offline')) {
    return {
      success: true,
      strategy: 'requeue',
      nextAction: 'continue'
    };
  }

  // Unknown errors - notify
  return {
    success: false,
    strategy: 'notify',
    nextAction: 'abort',
    error: error.message
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN TRIGGER MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Agent Trigger System - Main class
 */
export class AgentTriggerSystem {
  private notificationQueue: PriorityQueue<AgentNotification>;
  private recoveryConfig: RecoveryConfig;

  constructor(config?: Partial<RecoveryConfig>) {
    this.notificationQueue = new PriorityQueue<AgentNotification>();
    this.recoveryConfig = { ...DEFAULT_RECOVERY_CONFIG, ...config };
  }

  /**
   * Queue a notification for an agent
   */
  queueNotification(notification: AgentNotification): void {
    this.notificationQueue.enqueue(
      notification.id,
      notification,
      notification.priority
    );
  }

  /**
   * Get next notification to process
   */
  getNextNotification(): AgentNotification | undefined {
    return this.notificationQueue.dequeue()?.data;
  }

  /**
   * Process notification with conflict checking
   */
  async processWithConflictCheck(
    notification: AgentNotification,
    agentStatus: AgentStatus
  ): Promise<{
    shouldProcess: boolean;
    conflict: AgentConflict | null;
    response?: { subject: string; body: string; priority: Priority };
  }> {
    // Check if agent is available
    const isBusy = agentStatus === 'busy' || agentStatus === 'waiting';
    const isOffline = agentStatus === 'offline';

    if (isOffline) {
      return {
        shouldProcess: false,
        conflict: {
          agent: notification.agent,
          type: 'offline',
          message: `Agent '${notification.agent}' is offline`
        },
        response: generateAutoResponse('offline-notify', {
          agentName: notification.agent
        })
      };
    }

    if (isBusy && notification.priority !== 'urgent') {
      return {
        shouldProcess: false,
        conflict: {
          agent: notification.agent,
          type: 'busy',
          message: `Agent '${notification.agent}' is busy`
        },
        response: generateAutoResponse('busy-queue', {
          agentName: notification.agent
        })
      };
    }

    return {
      shouldProcess: true,
      conflict: null
    };
  }

  /**
   * Handle failed notification
   */
  handleFailure(notification: AgentNotification, error: Error): RecoveryResult {
    const result = determineRecoveryStrategy(error, notification.retryCount, this.recoveryConfig);

    if (result.nextAction === 'retry' && result.delayMs) {
      // Re-queue with incremented retry count
      notification.retryCount++;
      this.notificationQueue.enqueue(
        notification.id,
        notification,
        notification.priority
      );
    }

    return result;
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): {
    size: number;
    byPriority: Record<Priority, number>;
  } {
    const byPriority: Record<Priority, number> = {
      urgent: this.notificationQueue.getByPriority('urgent').length,
      high: this.notificationQueue.getByPriority('high').length,
      normal: this.notificationQueue.getByPriority('normal').length,
      low: this.notificationQueue.getByPriority('low').length
    };

    return {
      size: this.notificationQueue.size,
      byPriority
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS (types only - functions are exported inline)
// ═══════════════════════════════════════════════════════════════════════════════