'use strict';

const { createApp } = require('./app');
const { warmupCompileCalibration, warmupRuntimeCalibration } = require('./judge');

const host = process.env.HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '12014', 10);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(JSON.stringify({ ok: false, error: 'PORT must be an integer from 1 to 65535.' }));
  process.exit(1);
}

const server = createApp();

server.listen(port, host, () => {
  console.log(JSON.stringify({ ok: true, service: 'judge_server', url: `http://${host}:${port}` }));

  // Calibrate the compile budget to this machine's real speed so low-spec hosts
  // (slow/throttled CPUs, low RAM) do not hit spurious compile-timeout CEs.
  // Runs once in the background; the first /judge call reuses the cached result.
  warmupCompileCalibration()
    .then((calibration) => {
      if (!calibration) return;
      console.log(JSON.stringify({
        ok: true,
        service: 'judge_server',
        compileCalibration: {
          probeMs: calibration.probeMs,
          compileTimeoutMs: calibration.compileTimeoutMs,
          multiplier: calibration.multiplier,
          calibrated: calibration.ok === true,
        },
      }));
    })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, service: 'judge_server', compileCalibration: { error: error.message } }));
    });

  // Calibrate the run-time limit to this machine's CPU speed so correct
  // solutions do not hit spurious TLE on slow/throttled hosts.
  warmupRuntimeCalibration()
    .then((calibration) => {
      if (!calibration) return;
      console.log(JSON.stringify({
        ok: true,
        service: 'judge_server',
        runtimeCalibration: {
          cpuBenchMs: calibration.benchMs,
          referenceMs: calibration.referenceMs,
          timeLimitMultiplier: Number.isFinite(calibration.multiplier)
            ? Math.round(calibration.multiplier * 100) / 100
            : 1,
          calibrated: calibration.ok === true,
        },
      }));
    })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, service: 'judge_server', runtimeCalibration: { error: error.message } }));
    });
});

function shutdown(signal) {
  server.close(error => {
    if (error) {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, signal, message: 'server stopped' }));
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
