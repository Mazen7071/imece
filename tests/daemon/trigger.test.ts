/**
 * Tests for daemon trigger system
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createNotification,
  PriorityQueue,
  getAgentAvailability,
  detectConflict,
  findBestAgent,
  generateAutoResponse,
  calculateRetryDelay,
  determineRecoveryStrategy,
  AgentTriggerSystem,
  DEFAULT_RECOVERY_CONFIG,
  AUTO_RESPONSES
} from '../../src/daemon/trigger.js';
import type { AgentProfile, Priority } from '../../src/types.js';
import type { AgentNotification, AutoResponseTemplate } from '../../src/daemon/trigger.js';

describe('Trigger System', () => {
  describe('createNotification', () => {
    it('should create a notification with default values', () => {
      const notification = createNotification('test-agent', 'task:assigned', 'New Task', 'You have a new task');

      expect(notification.agent).toBe('test-agent');
      expect(notification.type).toBe('task:assigned');
      expect(notification.title).toBe('New Task');
      expect(notification.message).toBe('You have a new task');
      expect(notification.priority).toBe('normal');
      expect(notification.requiresAck).toBe(false);
      expect(notification.retryCount).toBe(0);
      expect(notification.id).toMatch(/^notif_/);
    });

    it('should create a notification with custom options', () => {
      const notification = createNotification(
        'agent1',
        'message:received',
        'Message',
        'Content',
        { priority: 'high', relatedId: 'task123', requiresAck: true }
      );

      expect(notification.priority).toBe('high');
      expect(notification.relatedId).toBe('task123');
      expect(notification.requiresAck).toBe(true);
    });
  });

  describe('PriorityQueue', () => {
    let queue: PriorityQueue<string>;

    beforeEach(() => {
      queue = new PriorityQueue<string>();
    });

    it('should enqueue and dequeue items', () => {
      queue.enqueue('1', 'first', 'normal');
      queue.enqueue('2', 'second', 'high');

      expect(queue.size).toBe(2);
      expect(queue.dequeue()?.data).toBe('second'); // high priority first
      expect(queue.dequeue()?.data).toBe('first');
      expect(queue.isEmpty).toBe(true);
    });

    it('should maintain priority order', () => {
      queue.enqueue('1', 'low', 'low');
      queue.enqueue('2', 'urgent', 'urgent');
      queue.enqueue('3', 'normal', 'normal');
      queue.enqueue('4', 'high', 'high');

      const order = [];
      while (!queue.isEmpty) {
        order.push(queue.dequeue()?.priority);
      }

      expect(order).toEqual(['urgent', 'high', 'normal', 'low']);
    });

    it('should peek without removing', () => {
      queue.enqueue('1', 'item', 'high');

      expect(queue.peek()?.data).toBe('item');
      expect(queue.size).toBe(1);
    });

    it('should remove item by id', () => {
      queue.enqueue('1', 'item1', 'normal');
      queue.enqueue('2', 'item2', 'normal');

      expect(queue.remove('1')).toBe(true);
      expect(queue.size).toBe(1);
      expect(queue.remove('nonexistent')).toBe(false);
    });

    it('should increment attempts', () => {
      queue.enqueue('1', 'item', 'normal');
      queue.incrementAttempts('1', 'test error');

      const item = queue.peek();
      expect(item?.attempts).toBe(1);
      expect(item?.lastError).toBe('test error');
    });

    it('should get items by priority', () => {
      queue.enqueue('1', 'urgent1', 'urgent');
      queue.enqueue('2', 'normal1', 'normal');
      queue.enqueue('3', 'urgent2', 'urgent');

      const urgentItems = queue.getByPriority('urgent');
      expect(urgentItems.length).toBe(2);
    });
  });

  describe('getAgentAvailability', () => {
    it('should return available for online/idle agents', () => {
      const onlineAgent = { status: 'online' } as AgentProfile;
      const idleAgent = { status: 'idle' } as AgentProfile;

      expect(getAgentAvailability(onlineAgent)).toBe('available');
      expect(getAgentAvailability(idleAgent)).toBe('available');
    });

    it('should return busy for busy/waiting agents', () => {
      const busyAgent = { status: 'busy' } as AgentProfile;
      const waitingAgent = { status: 'waiting' } as AgentProfile;

      expect(getAgentAvailability(busyAgent)).toBe('busy');
      expect(getAgentAvailability(waitingAgent)).toBe('busy');
    });

    it('should return offline for offline agents', () => {
      const offlineAgent = { status: 'offline' } as AgentProfile;
      expect(getAgentAvailability(offlineAgent)).toBe('offline');
    });
  });

  describe('detectConflict', () => {
    it('should detect offline conflict', () => {
      const agent: AgentProfile = {
        name: 'test',
        status: 'offline',
        role: 'tester',
        capabilities: [],
        currentTask: null,
        model: 'test',
        registeredAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        filesWorkingOn: [],
        isLead: false,
        meta: {}
      };

      const conflict = detectConflict(agent);
      expect(conflict).not.toBeNull();
      expect(conflict?.type).toBe('offline');
    });

    it('should detect busy conflict', () => {
      const agent: AgentProfile = {
        name: 'test',
        status: 'busy',
        currentTask: 'task123',
        role: 'tester',
        capabilities: [],
        model: 'test',
        registeredAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        filesWorkingOn: [],
        isLead: false,
        meta: {}
      };

      const conflict = detectConflict(agent);
      expect(conflict).not.toBeNull();
      expect(conflict?.type).toBe('busy');
      expect(conflict?.currentTaskId).toBe('task123');
    });

    it('should return null for available agent', () => {
      const agent: AgentProfile = {
        name: 'test',
        status: 'online',
        role: 'tester',
        capabilities: [],
        currentTask: null,
        model: 'test',
        registeredAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        filesWorkingOn: [],
        isLead: false,
        meta: {}
      };

      const conflict = detectConflict(agent);
      expect(conflict).toBeNull();
    });
  });

  describe('findBestAgent', () => {
    it('should find available agent', () => {
      const agents: AgentProfile[] = [
        { name: 'offline', status: 'offline', role: 't', capabilities: [], currentTask: null, model: 't', registeredAt: '', lastSeen: '', filesWorkingOn: [], isLead: false, meta: {} },
        { name: 'busy', status: 'busy', role: 't', capabilities: [], currentTask: null, model: 't', registeredAt: '', lastSeen: '', filesWorkingOn: [], isLead: false, meta: {} },
        { name: 'available', status: 'online', role: 't', capabilities: [], currentTask: null, model: 't', registeredAt: '', lastSeen: '', filesWorkingOn: [], isLead: false, meta: {} }
      ];

      const best = findBestAgent(agents);
      expect(best?.name).toBe('available');
    });

    it('should return null if all offline', () => {
      const agents: AgentProfile[] = [
        { name: 'offline1', status: 'offline', role: 't', capabilities: [], currentTask: null, model: 't', registeredAt: '', lastSeen: '', filesWorkingOn: [], isLead: false, meta: {} },
        { name: 'offline2', status: 'offline', role: 't', capabilities: [], currentTask: null, model: 't', registeredAt: '', lastSeen: '', filesWorkingOn: [], isLead: false, meta: {} }
      ];

      const best = findBestAgent(agents);
      expect(best).toBeNull();
    });
  });

  describe('generateAutoResponse', () => {
    it('should generate response from template', () => {
      const response = generateAutoResponse('will-do');
      expect(response.subject).toBe('Task Accepted');
      expect(response.priority).toBe('normal');
    });

    it('should include all template types', () => {
      const templates: AutoResponseTemplate[] = ['acknowledge', 'will-do', 'busy-queue', 'offline-notify', 'conflict-detected', 'error-recovery'];

      for (const template of templates) {
        const response = generateAutoResponse(template);
        expect(response.subject).toBeTruthy();
        expect(response.body).toBeTruthy();
      }
    });
  });

  describe('calculateRetryDelay', () => {
    it('should calculate exponential backoff', () => {
      const config = { ...DEFAULT_RECOVERY_CONFIG, exponentialBackoff: true };

      expect(calculateRetryDelay(0, config)).toBe(1000);
      expect(calculateRetryDelay(1, config)).toBe(2000);
      expect(calculateRetryDelay(2, config)).toBe(4000);
    });

    it('should respect max delay', () => {
      const config = { ...DEFAULT_RECOVERY_CONFIG, exponentialBackoff: true, maxDelayMs: 5000 };

      expect(calculateRetryDelay(10, config)).toBe(5000);
    });

    it('should use base delay without exponential', () => {
      const config = { ...DEFAULT_RECOVERY_CONFIG, exponentialBackoff: false };

      expect(calculateRetryDelay(0, config)).toBe(1000);
      expect(calculateRetryDelay(5, config)).toBe(1000);
    });
  });

  describe('determineRecoveryStrategy', () => {
    it('should retry network errors', () => {
      const error = new Error('Network timeout');
      const result = determineRecoveryStrategy(error, 0, DEFAULT_RECOVERY_CONFIG);

      expect(result.strategy).toBe('retry');
      expect(result.nextAction).toBe('retry');
      expect(result.delayMs).toBe(1000);
    });

    it('should requeue for offline agent', () => {
      const error = new Error('Agent is offline');
      const result = determineRecoveryStrategy(error, 0, DEFAULT_RECOVERY_CONFIG);

      expect(result.strategy).toBe('requeue');
      expect(result.nextAction).toBe('continue');
    });

    it('should abort after max retries', () => {
      const error = new Error('Network timeout');
      const result = determineRecoveryStrategy(error, 3, DEFAULT_RECOVERY_CONFIG);

      expect(result.success).toBe(false);
      expect(result.nextAction).toBe('abort');
    });
  });

  describe('AgentTriggerSystem', () => {
    let system: AgentTriggerSystem;

    beforeEach(() => {
      system = new AgentTriggerSystem();
    });

    it('should queue and get notifications', () => {
      const notification = createNotification('agent1', 'task:assigned', 'Task', 'Message');
      system.queueNotification(notification);

      const stats = system.getQueueStats();
      expect(stats.size).toBe(1);

      const next = system.getNextNotification();
      expect(next?.agent).toBe('agent1');
    });

    it('should process with conflict check', async () => {
      const notification = createNotification('agent1', 'task:assigned', 'Task', 'Message');

      const result = await system.processWithConflictCheck(notification, 'online');
      expect(result.shouldProcess).toBe(true);
      expect(result.conflict).toBeNull();
    });

    it('should block busy agent for non-urgent', async () => {
      const notification = createNotification('agent1', 'task:assigned', 'Task', 'Message', { priority: 'normal' });

      const result = await system.processWithConflictCheck(notification, 'busy');
      expect(result.shouldProcess).toBe(false);
      expect(result.conflict?.type).toBe('busy');
    });

    it('should allow urgent notifications for busy agent', async () => {
      const notification = createNotification('agent1', 'task:assigned', 'Urgent', 'Message', { priority: 'urgent' });

      const result = await system.processWithConflictCheck(notification, 'busy');
      expect(result.shouldProcess).toBe(true);
    });

    it('should handle failures', () => {
      const notification = createNotification('agent1', 'task:assigned', 'Task', 'Message');
      const error = new Error('Network error');

      const result = system.handleFailure(notification, error);
      expect(result.strategy).toBe('retry');
    });
  });
});