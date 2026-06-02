'use strict';

const { createApp } = require('./app');

const host = process.env.HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '12014', 10);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(JSON.stringify({ ok: false, error: 'PORT must be an integer from 1 to 65535.' }));
  process.exit(1);
}

const server = createApp();

server.listen(port, host, () => {
  console.log(JSON.stringify({ ok: true, service: 'judge_server', url: `http://${host}:${port}` }));
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
