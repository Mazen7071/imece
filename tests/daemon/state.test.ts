/**
 * Tests for daemon state management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DaemonState, createHash, getGlobalState, resetGlobalState } from '../../src/daemon/state.js';
import type { AgentState, InboxMessage, LockInfo, SwarmStatus } from '../../src/daemon/types.js';

describe('DaemonState', () => {
  let state: DaemonState;

  beforeEach(() => {
    state = new DaemonState();
  });

  afterEach(() => {
    state.clear();
    resetGlobalState();
  });

  describe('constructor and initial state', () => {
    it('should initialize with default watcher state', () => {
      const watcherState = state.getWatcherState();
      expect(watcherState.isRunning).toBe(false);
      expect(watcherState.lastPollTime).toBe(0);
      expect(watcherState.lastTimelineSize).toBe(0);
      expect(watcherState.processedMessageIds.size).toBe(0);
      expect(watcherState.pollCount).toBe(0);
      expect(watcherState.errorCount).toBe(0);
    });
  });

  describe('watcher state management', () => {
    it('should start watcher', () => {
      state.start();
      const watcherState = state.getWatcherState();
      expect(watcherState.isRunning).toBe(true);
      expect(watcherState.lastPollTime).toBeGreaterThan(0);
    });

    it('should stop watcher', () => {
      state.start();
      state.stop();
      expect(state.getWatcherState().isRunning).toBe(false);
    });

    it('should record poll', () => {
      state.recordPoll();
      const watcherState = state.getWatcherState();
      expect(watcherState.pollCount).toBe(1);
      expect(watcherState.lastPollTime).toBeGreaterThan(0);
    });

    it('should record multiple polls', () => {
      state.recordPoll();
      state.recordPoll();
      state.recordPoll();
      expect(state.getWatcherState().pollCount).toBe(3);
    });

    it('should record error', () => {
      state.recordError();
      expect(state.getWatcherState().errorCount).toBe(1);
    });

    it('should update watcher state partially', () => {
      state.updateWatcherState({ pollCount: 5, errorCount: 2 });
      const watcherState = state.getWatcherState();
      expect(watcherState.pollCount).toBe(5);
      expect(watcherState.errorCount).toBe(2);
      expect(watcherState.isRunning).toBe(false); // unchanged
    });
  });

  describe('message processing', () => {
    it('should check if message is processed', () => {
      expect(state.isMessageProcessed('msg1')).toBe(false);
    });

    it('should mark message as processed', () => {
      state.markMessageProcessed('msg1');
      expect(state.isMessageProcessed('msg1')).toBe(true);
    });

    it('should handle multiple messages', () => {
      state.markMessageProcessed('msg1');
      state.markMessageProcessed('msg2');
      state.markMessageProcessed('msg3');
      expect(state.isMessageProcessed('msg1')).toBe(true);
      expect(state.isMessageProcessed('msg2')).toBe(true);
      expect(state.isMessageProcessed('msg3')).toBe(true);
      expect(state.isMessageProcessed('msg4')).toBe(false);
    });

    it('should prevent memory leak by limiting processed message IDs', () => {
      // Add more than 1000 messages
      for (let i = 0; i < 1100; i++) {
        state.markMessageProcessed(`msg_${i}`);
      }

      // The set should be trimmed to ~1000
      const watcherState = state.getWatcherState();
      expect(watcherState.processedMessageIds.size).toBeLessThanOrEqual(1001);
    });
  });

  describe('agent state management', () => {
    const testAgent: AgentState = {
      name: 'test-agent',
      role: 'developer',
      status: 'online',
      lastHeartbeat: Date.now(),
      currentTask: null,
      unreadMessages: 0
    };

    it('should set agent state', () => {
      state.setAgentState(testAgent);
      const retrieved = state.getAgentState('test-agent');
      expect(retrieved).toEqual(testAgent);
    });

    it('should get undefined for non-existent agent', () => {
      const retrieved = state.getAgentState('non-existent');
      expect(retrieved).toBeUndefined();
    });

    it('should get all agents', () => {
      state.setAgentState(testAgent);
      state.setAgentState({ ...testAgent, name: 'agent2' });
      const agents = state.getAllAgents();
      expect(agents.length).toBe(2);
    });

    it('should update agent field', () => {
      state.setAgentState(testAgent);
      state.updateAgent('test-agent', { status: 'busy', currentTask: 'task123' });
      const updated = state.getAgentState('test-agent');
      expect(updated?.status).toBe('busy');
      expect(updated?.currentTask).toBe('task123');
      expect(updated?.role).toBe('developer'); // unchanged
    });

    it('should not update non-existent agent', () => {
      state.updateAgent('non-existent', { status: 'offline' });
      expect(state.getAgentState('non-existent')).toBeUndefined();
    });

    it('should remove agent', () => {
      state.setAgentState(testAgent);
      state.removeAgent('test-agent');
      expect(state.getAgentState('test-agent')).toBeUndefined();
    });
  });

  describe('message storage', () => {
    const testMessage: InboxMessage = {
      id: 'msg123',
      from: 'sender',
      subject: 'Test',
      body: 'Test message',
      timestamp: Date.now(),
      type: 'message'
    };

    it('should store message', () => {
      state.setMessage(testMessage);
      const retrieved = state.getMessage('msg123');
      expect(retrieved).toEqual(testMessage);
    });

    it('should get undefined for non-existent message', () => {
      const retrieved = state.getMessage('non-existent');
      expect(retrieved).toBeUndefined();
    });

    it('should get messages for agent (unprocessed)', () => {
      state.setMessage(testMessage);
      state.setMessage({ ...testMessage, id: 'msg456' });
      const messages = state.getMessagesForAgent('test-agent');
      expect(messages.length).toBe(2);
    });

    it('should not return processed messages', () => {
      state.setMessage(testMessage);
      state.markMessageProcessed('msg123');
      const messages = state.getMessagesForAgent('test-agent');
      expect(messages.length).toBe(0);
    });
  });

  describe('lock management', () => {
    const testLock: LockInfo = {
      filePath: '/src/test.ts',
      agent: 'test-agent',
      timestamp: Date.now()
    };

    it('should store lock', () => {
      state.setLock(testLock);
      const retrieved = state.getLock('/src/test.ts');
      expect(retrieved).toEqual(testLock);
    });

    it('should get undefined for non-existent lock', () => {
      const retrieved = state.getLock('/non/existent.ts');
      expect(retrieved).toBeUndefined();
    });

    it('should check if file is locked', () => {
      state.setLock(testLock);
      expect(state.isFileLocked('/src/test.ts')).toBe(true);
      expect(state.isFileLocked('/other.ts')).toBe(false);
    });

    it('should remove lock', () => {
      state.setLock(testLock);
      state.removeLock('/src/test.ts');
      expect(state.isFileLocked('/src/test.ts')).toBe(false);
    });

    it('should get all locks', () => {
      state.setLock(testLock);
      state.setLock({ ...testLock, filePath: '/src/other.ts' });
      const locks = state.getAllLocks();
      expect(locks.length).toBe(2);
    });
  });

  describe('timeline hash', () => {
    it('should set timeline hash', () => {
      state.setTimelineHash('abc123', 100);
      expect(state.getTimelineHash()).toBe('abc123');
      expect(state.getWatcherState().lastTimelineSize).toBe(100);
    });

    it('should update timeline hash', () => {
      state.setTimelineHash('hash1', 100);
      state.setTimelineHash('hash2', 200);
      expect(state.getTimelineHash()).toBe('hash2');
    });
  });

  describe('swarm status update', () => {
    it('should update from swarm status', () => {
      const swarmStatus: SwarmStatus = {
        agents: [
          { name: 'agent1', role: 'dev', status: 'online', lastHeartbeat: Date.now(), currentTask: null, unreadMessages: 0 },
          { name: 'agent2', role: 'test', status: 'busy', lastHeartbeat: Date.now(), currentTask: 'task1', unreadMessages: 2 }
        ],
        tasks: { backlog: 1, active: 2, done: 3, blocked: 0 },
        locks: [
          { filePath: '/src/a.ts', agent: 'agent1', timestamp: Date.now() }
        ]
      };

      state.updateFromSwarmStatus(swarmStatus);

      expect(state.getAgentState('agent1')).toBeDefined();
      expect(state.getAgentState('agent2')).toBeDefined();
      expect(state.isFileLocked('/src/a.ts')).toBe(true);
    });
  });

  describe('stats', () => {
    it('should return empty stats initially', () => {
      const stats = state.getStats();
      expect(stats.agents).toBe(0);
      expect(stats.messages).toBe(0);
      expect(stats.locks).toBe(0);
      expect(stats.polls).toBe(0);
      expect(stats.errors).toBe(0);
    });

    it('should return correct stats after operations', () => {
      state.setAgentState({
        name: 'agent1',
        role: 'dev',
        status: 'online',
        lastHeartbeat: Date.now(),
        currentTask: null,
        unreadMessages: 0
      });
      state.setMessage({
        id: 'msg1',
        from: 'sender',
        subject: 'Test',
        body: 'Body',
        timestamp: Date.now(),
        type: 'message'
      });
      state.setLock({
        filePath: '/test.ts',
        agent: 'agent1',
        timestamp: Date.now()
      });
      state.recordPoll();
      state.recordPoll();
      state.recordError();

      const stats = state.getStats();
      expect(stats.agents).toBe(1);
      expect(stats.messages).toBe(1);
      expect(stats.locks).toBe(1);
      expect(stats.polls).toBe(2);
      expect(stats.errors).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all state', () => {
      state.setAgentState({
        name: 'agent1',
        role: 'dev',
        status: 'online',
        lastHeartbeat: Date.now(),
        currentTask: null,
        unreadMessages: 0
      });
      state.setMessage({
        id: 'msg1',
        from: 'sender',
        subject: 'Test',
        body: 'Body',
        timestamp: Date.now(),
        type: 'message'
      });
      state.setLock({
        filePath: '/test.ts',
        agent: 'agent1',
        timestamp: Date.now()
      });
      state.markMessageProcessed('msg1');
      state.recordPoll();

      state.clear();

      const stats = state.getStats();
      expect(stats.agents).toBe(0);
      expect(stats.messages).toBe(0);
      expect(stats.locks).toBe(0);
      expect(stats.polls).toBe(0);

      const watcherState = state.getWatcherState();
      expect(watcherState.processedMessageIds.size).toBe(0);
      expect(watcherState.isRunning).toBe(false);
    });
  });
});

describe('createHash', () => {
  it('should create consistent hash for same input', () => {
    const hash1 = createHash('test data');
    const hash2 = createHash('test data');
    expect(hash1).toBe(hash2);
  });

  it('should create different hash for different input', () => {
    const hash1 = createHash('test data 1');
    const hash2 = createHash('test data 2');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty string', () => {
    const hash = createHash('');
    expect(typeof hash).toBe('string');
  });

  it('should handle long strings', () => {
    const longString = 'a'.repeat(10000);
    const hash = createHash(longString);
    expect(typeof hash).toBe('string');
  });
});

describe('global state', () => {
  afterEach(() => {
    resetGlobalState();
  });

  it('should return same instance on multiple calls', () => {
    const state1 = getGlobalState();
    const state2 = getGlobalState();
    expect(state1).toBe(state2);
  });

  it('should create new instance after reset', () => {
    const state1 = getGlobalState();
    state1.recordPoll();
    expect(state1.getStats().polls).toBe(1);

    resetGlobalState();

    const state2 = getGlobalState();
    expect(state2).not.toBe(state1);
    expect(state2.getStats().polls).toBe(0);
  });
});