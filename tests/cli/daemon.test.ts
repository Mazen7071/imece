/**
 * Tests for CLI daemon commands
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { createTempImece, cleanup, fileExists } from '../helpers/setup.js';

const CLI_PATH = join(process.cwd(), 'dist', 'bin.js');

function runCli(args: string[], cwd: string): string {
  return execFileSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function runCliExpectError(args: string[], cwd: string): void {
  expect(() => {
    execFileSync('node', [CLI_PATH, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe'
    });
  }).toThrow();
}

describe('CLI Daemon Commands', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempImece();
    // Initialize imece
    runCli(['init'], tempDir);
    // Register test agent
    runCli(['register', 'test-agent', 'tester', '--model', 'test'], tempDir);
  });

  afterEach(async () => {
    await cleanup(tempDir);
  });

  describe('daemon status', () => {
    it('should show daemon as stopped when not running', () => {
      const output = runCli(['daemon', 'status'], tempDir);
      expect(output).toContain('stopped');
    });
  });

  describe('daemon trigger', () => {
    it('should create trigger file for agent', () => {
      const output = runCli(['daemon', 'trigger', 'test-agent'], tempDir);
      expect(output).toContain('Triggered agent');
    });

    it('should fail without agent name', () => {
      runCliExpectError(['daemon', 'trigger'], tempDir);
    });
  });

  describe('daemon help', () => {
    it('should show daemon commands in help', () => {
      const output = runCli(['help'], tempDir);
      expect(output).toContain('daemon');
      expect(output).toContain('start');
      expect(output).toContain('stop');
      expect(output).toContain('status');
      expect(output).toContain('trigger');
    });
  });
});