'use strict';

const { execFile, spawn } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 1_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_CPU_SAMPLE_INTERVAL_MS = 250;
const DEFAULT_MEMORY_SAMPLE_INTERVAL_MS = 100;

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

function parseCpuPercent(value) {
  const parsed = Number(String(value || '').trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sampleCpuPercent(pid) {
  if (!Number.isInteger(pid) || process.platform === 'win32') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    execFile('ps', ['-o', '%cpu=', '-p', String(pid)], { timeout: 200 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(parseCpuPercent(stdout));
    });
  });
}

function parseRssKb(value) {
  const parsed = Number(String(value || '').trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sampleMemoryBytes(pid) {
  if (!Number.isInteger(pid) || process.platform === 'win32') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    execFile('ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 200 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const rssKb = parseRssKb(stdout);
      resolve(rssKb === null ? null : Math.round(rssKb * 1024));
    });
  });
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
 * @param {boolean} [options.trackCpuTime] approximate child CPU time via ps sampling
 * @param {number} [options.cpuSampleIntervalMs] CPU sampling interval
 * @param {boolean} [options.trackMemory] approximate peak RSS via ps sampling
 * @param {number} [options.memorySampleIntervalMs] memory sampling interval
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
    let timer = null;
    let cpuSampler = null;
    let cpuSamplePending = false;
    let cpuTimeMs = options.trackCpuTime ? 0 : null;
    let cpuTimeAvailable = false;
    let lastCpuSampleAt = started;
    let memorySampler = null;
    let memorySamplePending = false;
    let peakMemoryBytes = null;
    let memorySampleAvailable = false;

    const collectCpuSample = () => {
      if (!options.trackCpuTime || !child || settled || cpuSamplePending) return;

      cpuSamplePending = true;
      sampleCpuPercent(child.pid).then((cpuPercent) => {
        const now = process.hrtime.bigint();
        const elapsedMs = Number((now - lastCpuSampleAt) / 1_000_000n);
        lastCpuSampleAt = now;

        if (cpuPercent !== null) {
          cpuTimeAvailable = true;
          cpuTimeMs += elapsedMs * (cpuPercent / 100);
        }
      }).finally(() => {
        cpuSamplePending = false;
      });
    };

    const collectMemorySample = () => {
      if (!options.trackMemory || !child || settled || memorySamplePending) return;

      memorySamplePending = true;
      sampleMemoryBytes(child.pid).then((memoryBytes) => {
        if (memoryBytes !== null) {
          memorySampleAvailable = true;
          peakMemoryBytes = peakMemoryBytes === null
            ? memoryBytes
            : Math.max(peakMemoryBytes, memoryBytes);
        }
      }).finally(() => {
        memorySamplePending = false;
      });
    };

    const finish = (exitCode, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (cpuSampler) clearInterval(cpuSampler);
      if (memorySampler) clearInterval(memorySampler);

      const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
      resolve({
        command,
        args,
        cwd: options.cwd,
        exitCode,
        signal,
        timedOut,
        durationMs,
        cpuTimeMs: cpuTimeAvailable ? Math.round(cpuTimeMs) : null,
        cpuTimeAvailable,
        peakMemoryBytes,
        memorySampleAvailable,
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

    timer = setTimeout(() => {
      timedOut = true;
      if (child && !child.killed) {
        child.kill('SIGKILL');
      }
    }, Math.max(1, timeoutMs));

    if (options.trackCpuTime) {
      const sampleIntervalMs = Number.isFinite(options.cpuSampleIntervalMs)
        ? Math.max(50, options.cpuSampleIntervalMs)
        : DEFAULT_CPU_SAMPLE_INTERVAL_MS;
      cpuSampler = setInterval(collectCpuSample, sampleIntervalMs);
      collectCpuSample();
    }

    if (options.trackMemory) {
      const sampleIntervalMs = Number.isFinite(options.memorySampleIntervalMs)
        ? Math.max(50, options.memorySampleIntervalMs)
        : DEFAULT_MEMORY_SAMPLE_INTERVAL_MS;
      memorySampler = setInterval(collectMemorySample, sampleIntervalMs);
      collectMemorySample();
    }

    child.stdout.on('data', (chunk) => appendLimited(stdoutChunks, chunk, stdoutState, maxOutputBytes));
    child.stderr.on('data', (chunk) => appendLimited(stderrChunks, chunk, stderrState, maxOutputBytes));
    child.stdin.on('error', (error) => {
      if (error && error.code === 'EPIPE') return;
      spawnError = error;
    });

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
  DEFAULT_CPU_SAMPLE_INTERVAL_MS,
  DEFAULT_MEMORY_SAMPLE_INTERVAL_MS,
};
