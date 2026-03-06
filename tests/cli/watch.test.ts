/**
 * Tests for CLI watch command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { createTempImece, cleanup } from '../helpers/setup.js';

const CLI_PATH = join(process.cwd(), 'dist', 'bin.js');

function runCli(args: string[], cwd: string): string {
  return execFileSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

describe('CLI Watch Command', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempImece();
    runCli(['init'], tempDir);
    runCli(['register', 'watch-agent', 'tester', '--model', 'test'], tempDir);
  });

  afterEach(async () => {
    await cleanup(tempDir);
  });

  describe('watch help', () => {
    it('should show watch command in help', () => {
      const output = runCli(['help'], tempDir);
      expect(output).toContain('watch');
      expect(output).toContain('monitoring');
    });
  });

  describe('watch command', () => {
    it('should start watch mode and show agents', async () => {
      // Start watch process
      const watchProcess = spawn('node', [CLI_PATH, 'watch', '--interval', '1'], {
        cwd: tempDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      watchProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      // Wait a bit for initial render
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check output
      expect(output).toContain('WATCH MODE');
      expect(output).toContain('AGENTS');

      // Kill the process
      watchProcess.kill('SIGINT');
    });

    it('should show specific agent inbox when --agent flag used', async () => {
      // Send a message to the agent
      runCli(['register', 'sender', 'tester', '--model', 'test'], tempDir);
      runCli(['send', 'sender', 'watch-agent', 'Test message', '--body', 'Test body'], tempDir);

      // Start watch with agent flag
      const watchProcess = spawn('node', [CLI_PATH, 'watch', '--agent', 'watch-agent', '--interval', '1'], {
        cwd: tempDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      watchProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      expect(output).toContain('WATCH MODE');

      watchProcess.kill('SIGINT');
    });
  });
});