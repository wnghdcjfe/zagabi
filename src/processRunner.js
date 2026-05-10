'use strict';

const { spawn } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 1_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

function appendLimited(chunks, chunk, state, maxBytes) {
  if (state.truncated) return;

  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  const remaining = maxBytes - state.bytes;

  if (remaining <= 0) {
    state.truncated = true;
    return;
  }

  if (buffer.length > remaining) {
    chunks.push(buffer.subarray(0, remaining));
    state.bytes += remaining;
    state.truncated = true;
    return;
  }

  chunks.push(buffer);
  state.bytes += buffer.length;
}

function stringifyChunks(chunks) {
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Run a process without invoking a shell, with timeout and bounded output.
 *
 * @param {string} command executable path/name
 * @param {string[]} args command arguments
 * @param {object} options runner options
 * @param {string|Buffer} [options.input] stdin contents
 * @param {number} [options.timeoutMs] wall-clock timeout
 * @param {string} [options.cwd] working directory
 * @param {object} [options.env] environment override
 * @param {number} [options.maxOutputBytes] stdout/stderr cap per stream
 * @returns {Promise<object>} process result
 */
function runProcess(command, args = [], options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = Number.isFinite(options.maxOutputBytes)
    ? options.maxOutputBytes
    : DEFAULT_MAX_OUTPUT_BYTES;
  const started = process.hrtime.bigint();
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdoutState = { bytes: 0, truncated: false };
  const stderrState = { bytes: 0, truncated: false };

  return new Promise((resolve) => {
    let child;
    let timedOut = false;
    let spawnError = null;
    let settled = false;

    const finish = (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
      resolve({
        command,
        args,
        cwd: options.cwd,
        exitCode,
        signal,
        timedOut,
        durationMs,
        stdout: stringifyChunks(stdoutChunks),
        stderr: stringifyChunks(stderrChunks),
        stdoutTruncated: stdoutState.truncated,
        stderrTruncated: stderrState.truncated,
        error: spawnError ? spawnError.message : undefined,
      });
    };

    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (error) {
      spawnError = error;
      finish(null, null);
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      if (child && !child.killed) {
        child.kill('SIGKILL');
      }
    }, Math.max(1, timeoutMs));

    child.stdout.on('data', (chunk) => appendLimited(stdoutChunks, chunk, stdoutState, maxOutputBytes));
    child.stderr.on('data', (chunk) => appendLimited(stderrChunks, chunk, stderrState, maxOutputBytes));

    child.on('error', (error) => {
      spawnError = error;
    });

    child.on('close', (code, signal) => finish(code, signal));

    if (options.input !== undefined && options.input !== null) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

module.exports = {
  runProcess,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
};
