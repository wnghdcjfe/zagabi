#!/usr/bin/env node
'use strict';

// One-command launcher: verifies the C++ toolchain, checks the port, prints the
// URLs students should use, and then boots the judge server in this process.
// Windows users can double-click start-windows.cmd instead of typing env vars.

const net = require('node:net');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const { resolveCompiler, withCompilerRuntimePath } = require('../src/judge');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT || '12014', 10);

function log(text = '') {
  console.log(text);
}

// Some interfaces carry an IPv4 address that no other PC on the LAN can ever
// reach: 464XLAT/DS-Lite translation addresses on IPv6-only networks, APIPA
// link-local addresses left over from a failed DHCP, ranges VPN clients park
// on, /32 interfaces that own no subnet, and virtual adapters for VMs.
// Printing those as "같은 네트워크" sends students to a dead address.
const VIRTUAL_IFACE_PATTERN = /^(bridge|vmnet|vboxnet|utun|tun|tap|ppp|awdl|llw)/i;

const SKIP_REASONS = {
  clat: 'IPv6 전용 네트워크의 IPv4 변환용(464XLAT/DS-Lite) 주소',
  'link-local': 'DHCP를 받지 못했을 때 붙는 link-local 주소',
  benchmark: 'VPN·가상 네트워크가 쓰는 대역',
  'no-subnet': '자기 자신만 가리키는 /32 주소',
  virtual: '가상머신·VPN용 가상 어댑터',
};

function skipReason(iface, info) {
  if (VIRTUAL_IFACE_PATTERN.test(iface)) return 'virtual';
  if (info.address.startsWith('192.0.0.')) return 'clat';
  if (info.address.startsWith('169.254.')) return 'link-local';
  if (info.address.startsWith('198.18.') || info.address.startsWith('198.19.')) return 'benchmark';
  if (info.netmask === '255.255.255.255') return 'no-subnet';
  return null;
}

function lanAddresses() {
  const usable = [];
  const skipped = [];
  for (const [iface, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.internal) continue;
      if (info.family !== 'IPv4' && info.family !== 4) continue;
      const reason = skipReason(iface, info);
      if (reason) skipped.push({ iface, address: info.address, reason });
      else usable.push({ iface, address: info.address });
    }
  }
  return { usable, skipped };
}

function installHint(platform) {
  if (platform === 'win32') {
    return [
      '  1) MSYS2 설치: https://www.msys2.org/',
      '  2) "MSYS2 UCRT64" 터미널에서:',
      '       pacman -Syu',
      '       pacman -S --needed mingw-w64-ucrt-x86_64-gcc',
      '  3) 이 창을 닫고 start-windows.cmd 를 다시 실행',
      '',
      '  기본 경로(C:\\msys64\\ucrt64\\bin\\g++.exe)에 설치했다면 PATH 설정은 필요 없습니다.',
      '  다른 곳에 설치했다면 JUDGE_CXX 로 g++.exe 전체 경로를 지정하세요:',
      '       $env:JUDGE_CXX="D:\\tools\\msys64\\ucrt64\\bin\\g++.exe"',
    ].join('\n');
  }
  if (platform === 'darwin') {
    return '  xcode-select --install';
  }
  return '  sudo apt-get install -y g++      # 또는 배포판에 맞는 패키지';
}

async function detectCompiler() {
  const compiler = await resolveCompiler();
  const env = withCompilerRuntimePath(process.env, compiler);
  const probe = spawnSync(compiler, ['--version'], { env, encoding: 'utf8' });

  if (probe.error || probe.status !== 0) {
    return { ok: false, compiler, reason: probe.error ? probe.error.message : `exit ${probe.status}` };
  }

  const version = String(probe.stdout || '').split('\n')[0].trim();
  return { ok: true, compiler, version };
}

function isPortBusy(host, port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
        resolve(error.code);
        return;
      }
      reject(error);
    });
    probe.once('listening', () => probe.close(() => resolve(null)));
    probe.listen(port, host);
  });
}

function portBusyHint(port) {
  if (process.platform === 'win32') {
    return [
      '  실행 중인 서버를 먼저 종료하세요 (PowerShell):',
      `      Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object OwningProcess`,
      '      Stop-Process -Id <OwningProcess>',
    ].join('\n');
  }
  return [
    '  실행 중인 서버를 먼저 종료하세요:',
    `      lsof -tiTCP:${port} -sTCP:LISTEN | xargs kill`,
  ].join('\n');
}

async function main() {
  if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
    console.error(`[중단] PORT 값이 잘못되었습니다: ${process.env.PORT}`);
    process.exit(1);
  }

  log('코딩살구클럽 채점 서버를 시작합니다.');
  log(`  Node.js  ${process.version} (${process.platform})`);

  const compiler = await detectCompiler();
  if (compiler.ok) {
    log(`  컴파일러 ${compiler.compiler}`);
    log(`           ${compiler.version}`);
    // Pin the resolved path so every judge request skips compiler lookup.
    if (!process.env.JUDGE_CXX) process.env.JUDGE_CXX = compiler.compiler;
  } else if (process.env.JUDGE_SKIP_COMPILER_CHECK) {
    log(`  컴파일러 [경고] ${compiler.compiler} 를 실행할 수 없습니다 (${compiler.reason}). 확인을 건너뜁니다.`);
  } else {
    console.error('');
    console.error(`[중단] C++ 컴파일러를 찾지 못했습니다: ${compiler.compiler}`);
    console.error(`       원인: ${compiler.reason}`);
    console.error('       이 상태로 서버를 켜면 모든 제출이 컴파일 에러(CE)로 채점됩니다.');
    console.error('');
    console.error(installHint(process.platform));
    console.error('');
    console.error('       컴파일러 없이 그래도 켜려면: JUDGE_SKIP_COMPILER_CHECK=1');
    process.exit(1);
  }

  const busy = await isPortBusy(HOST, PORT);
  if (busy) {
    console.error('');
    console.error(`[중단] ${HOST}:${PORT} 포트를 이미 사용 중입니다 (${busy}).`);
    console.error('');
    console.error(portBusyHint(PORT));
    console.error('');
    console.error(`       다른 포트로 띄우려면: PORT=12015 (PowerShell: $env:PORT="12015")`);
    process.exit(1);
  }

  log('');
  log('  접속 주소');
  log(`    이 PC        http://127.0.0.1:${PORT}`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    const { usable, skipped } = lanAddresses();
    for (const entry of usable) {
      log(`    같은 네트워크  http://${entry.address}:${PORT}`);
    }
    if (usable.length === 0) {
      log('    같은 네트워크  없음 — 다른 PC에서 접속할 수 있는 IPv4 주소가 없습니다');
      for (const entry of skipped) {
        log(`                   ${entry.iface} ${entry.address} 는 ${SKIP_REASONS[entry.reason]}`);
      }
      log('                   학생 PC에서는 각자 서버를 띄우고 127.0.0.1 주소를 쓰세요.');
    }
  }
  log(`    헬스체크      http://127.0.0.1:${PORT}/health`);
  log('');
  log('  종료하려면 Ctrl+C');
  log('');

  require('../src/server');
}

main().catch((error) => {
  console.error(`[중단] ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
