/**
 * Tests for daemon watcher
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImeceDaemon, createDaemon } from '../../src/daemon/watcher.js';
import { DEFAULT_CONFIG } from '../../src/daemon/types.js';
import type { DaemonEvent, DaemonEventType } from '../../src/daemon/types.js';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') {
        setTimeout(() => cb(0), 10);
      }
    }),
  })),
}));

describe('ImeceDaemon', () => {
  let daemon: ImeceDaemon;

  beforeEach(() => {
    vi.useFakeTimers();
    daemon = new ImeceDaemon({ agentName: 'test-agent' });
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
    if (daemon.isActive()) {
      await daemon.stop();
    }
  });

  describe('constructor', () => {
    it('should create daemon with default config', () => {
      const d = new ImeceDaemon();
      const config = d.getConfig();
      expect(config.pollInterval).toBe(DEFAULT_CONFIG.pollInterval);
      expect(config.watchTimeline).toBe(DEFAULT_CONFIG.watchTimeline);
      expect(config.heartbeatInterval).toBe(DEFAULT_CONFIG.heartbeatInterval);
    });

    it('should merge custom config', () => {
      const d = new ImeceDaemon({
        pollInterval: 5000,
        agentName: 'custom-agent'
      });
      const config = d.getConfig();
      expect(config.pollInterval).toBe(5000);
      expect(config.agentName).toBe('custom-agent');
    });
  });

  describe('config management', () => {
    it('should get config copy', () => {
      const config1 = daemon.getConfig();
      const config2 = daemon.getConfig();
      expect(config1).not.toBe(config2); // Different objects
      expect(config1).toEqual(config2); // Same values
    });

    it('should update config', () => {
      daemon.updateConfig({ pollInterval: 10000 });
      expect(daemon.getConfig().pollInterval).toBe(10000);
    });
  });

  describe('start/stop', () => {
    it.skip('should start daemon', async () => {
      await daemon.start();
      expect(daemon.isActive()).toBe(true);
    });

    it.skip('should not start twice', async () => {
      await daemon.start();
      const consoleSpy = vi.spyOn(console, 'log');
      await daemon.start();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Already running'));
    });

    it.skip('should stop daemon', async () => {
      await daemon.start();
      await daemon.stop();
      expect(daemon.isActive()).toBe(false);
    });

    it.skip('should restart timers on config update while running', async () => {
      await daemon.start();
      const oldTimer = (daemon as unknown as { pollTimer: NodeJS.Timeout }).pollTimer;
      daemon.updateConfig({ pollInterval: 20000 });
      const newTimer = (daemon as unknown as { pollTimer: NodeJS.Timeout }).pollTimer;
      // Timers should be different after restart
      expect(daemon.getConfig().pollInterval).toBe(20000);
    });
  });

  describe('event handling', () => {
    it('should register event listener', async () => {
      const listener = vi.fn();
      daemon.on('message', listener);

      // Trigger a message event through the daemon
      const emit = (daemon as unknown as { emit: (e: DaemonEvent) => Promise<void> });
      await emit.emit({
        type: 'message',
        timestamp: Date.now(),
        agent: 'test-agent',
        data: { id: 'msg1' }
      });

      expect(listener).toHaveBeenCalled();
    });

    it('should return unsubscribe function', async () => {
      const listener = vi.fn();
      const unsubscribe = daemon.on('message', listener);

      unsubscribe();

      const emit = (daemon as unknown as { emit: (e: DaemonEvent) => Promise<void> });
      await emit.emit({
        type: 'message',
        timestamp: Date.now(),
        agent: 'test-agent',
        data: {}
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle once listener', async () => {
      const listener = vi.fn();
      daemon.once('message', listener);

      const emit = (daemon as unknown as { emit: (e: DaemonEvent) => Promise<void> });
      await emit.emit({
        type: 'message',
        timestamp: Date.now(),
        agent: 'test-agent',
        data: {}
      });
      await emit.emit({
        type: 'message',
        timestamp: Date.now(),
        agent: 'test-agent',
        data: {}
      });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should handle listener errors gracefully', async () => {
      const errorListener = vi.fn(() => { throw new Error('Test error'); });
      const normalListener = vi.fn();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      daemon.on('message', errorListener);
      daemon.on('message', normalListener);

      const emit = (daemon as unknown as { emit: (e: DaemonEvent) => Promise<void> });
      await emit.emit({
        type: 'message',
        timestamp: Date.now(),
        agent: 'test-agent',
        data: {}
      });

      expect(normalListener).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('stats and state', () => {
    it('should get stats', () => {
      const stats = daemon.getStats();
      expect(stats).toHaveProperty('agents');
      expect(stats).toHaveProperty('messages');
      expect(stats).toHaveProperty('locks');
      expect(stats).toHaveProperty('polls');
      expect(stats).toHaveProperty('errors');
    });

    it('should get state', () => {
      const state = daemon.getState();
      expect(state).toHaveProperty('isRunning');
      expect(state).toHaveProperty('lastPollTime');
      expect(state).toHaveProperty('pollCount');
      expect(state).toHaveProperty('errorCount');
    });
  });
});

describe('createDaemon', () => {
  it.skip('should create and start daemon', async () => {
    vi.useFakeTimers();
    const daemon = await createDaemon({ agentName: 'test' });
    expect(daemon.isActive()).toBe(true);
    await daemon.stop();
    vi.useRealTimers();
  });
});