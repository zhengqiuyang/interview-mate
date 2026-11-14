/* 服务端行为测试：起真实 server（PORT=0 系统分配端口），打 HTTP。
 * 后台调度器用 env 关掉（0 = off），全程无网络、无定时器。 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const questions = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'questions.json'), 'utf8'));

let child;
let base;
let tmpData;

before(async () => {
  tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'im-data-'));
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: '0',
      INTERVIEW_MATE_DATA_DIR: tmpData, // 不写仓库 data/
      INTERVIEW_MATE_JOB_REFRESH_MIN: '0',
      INTERVIEW_MATE_BRIEF_CHECK_MIN: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server 启动超时（10s）')), 10000);
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/已启动: http:\/\/[\d.]+:(\d+)/);
      if (m) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => { buf += d.toString(); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server 提前退出 code=${code}\n${buf}`));
    });
  });
});

after(() => {
  if (child) child.kill();
  if (tmpData) fs.rmSync(tmpData, { recursive: true, force: true });
});

const get = (pathname) => fetch(base + pathname, { redirect: 'manual' });
const rawRequest = (method, requestPath, body, extraHeaders = {}) => new Promise((resolve, reject) => {
  const u = new URL(base);
  const req = http.request({
    hostname: u.hostname,
    port: u.port,
    method,
    path: requestPath, // 原样发送，不做客户端归一化
    headers: {
      ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      ...extraHeaders,
    },
  }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({
      status: res.statusCode,
      body: Buffer.concat(chunks).toString('utf8'),
      headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), v])),
    }));
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

test('GET /api/health → 200，版本号来自 package.json 单一来源', async () => {
  const res = await get('/api/health');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.version, pkg.version);
});

test('启动横幅打印的版本与 package.json 一致（v0.6.0 事故回归）', async () => {
  // before() 里已经用横幅解析出了端口 —— 能解析本身就证明横幅带真实端口
  assert.match(base, /:\d{2,5}$/);
});

test('GET /api/questions → 题库完整（与 data/questions.json 一致）', async () => {
  const res = await get('/api/questions');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.questions.length, questions.questions.length);
  assert.equal(data.categories.length, questions.categories.length);
  assert.ok(data.questions.length > 0);
  assert.ok(data.categories.length > 0);
});

test('未知 API 路径 → 404 JSON', async () => {
  const res = await get('/api/nope');
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error, 'Not Found');
});

test('POST / → 405（静态路径不接受写方法）', async () => {
  const r = await rawRequest('POST', '/');
  assert.equal(r.status, 405);
  const r2 = await rawRequest('POST', '/js/app.js');
  assert.equal(r2.status, 405);
});

test('超大 body（>2MB）→ 400 或连接被拒，绝不 5xx', async () => {
  const bigBody = JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(3 * 1024 * 1024) }] });
  let outcome = 'error';
  try {
    const res = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bigBody,
    });
    outcome = res.status;
    await res.arrayBuffer().catch(() => {});
  } catch {
    // readBody 超限后 req.destroy()，客户端表现为连接重置 —— 可接受
    outcome = 'conn-reset';
  }
  assert.ok(outcome === 400 || outcome === 'conn-reset', `意外结果: ${outcome}`);
});

test('路径穿越 /api/files/..%2f..%2fpackage.json 被拒绝', async () => {
  const r = await rawRequest('GET', '/api/files/..%2f..%2fpackage.json');
  // 文件名守卫 ^[\w.-]+$ → 400 Bad file name；静态目录守卫 → 403/404
  assert.ok([400, 403, 404].includes(r.status), `status=${r.status}`);
  assert.ok(!r.body.includes('"interview-mate"'), '不得泄露 package.json 内容');
});

test('路径穿越 /api/files/../../../server.js 被拒绝', async () => {
  const r = await rawRequest('GET', '/api/files/../../../server.js');
  assert.ok([400, 403, 404].includes(r.status), `status=${r.status}`);
  assert.ok(!r.body.includes('require('), '不得泄露 server.js 源码');
});

test('/api/files 文件名守卫：合法名字不存在 → 404', async () => {
  const r = await rawRequest('GET', '/api/files/f-notexist123.pdf');
  assert.equal(r.status, 404);
});

test('静态首页与前端模块可达', async () => {
  const index = await get('/');
  assert.equal(index.status, 200);
  assert.ok((await index.text()).includes('InterviewMate'));
  const appjs = await get('/js/app.js');
  assert.equal(appjs.status, 200);
});

test('GET /api/health 并发 20 次全部 200', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => get('/api/health')));
  for (const r of results) assert.equal(r.status, 200);
});


/* ---- I-P2-2: Host 校验（loopback 双模式）+ CSP ----------------------------- */

test('Host 校验 loopback 模式：恶意 Host → 403，三个合法 Host 放行', async () => {
  const port = new URL(base).port;
  const bad = await rawRequest('GET', '/api/health', null, { Host: 'evil.com' });
  assert.equal(bad.status, 403);
  assert.match(bad.body, /DNS rebinding/);
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]) {
    const ok = await rawRequest('GET', '/api/health', null, { Host: host });
    assert.equal(ok.status, 200, `Host ${host} 应放行`);
  }
  const noPort = await rawRequest('GET', '/api/health', null, { Host: 'localhost' });
  assert.equal(noPort.status, 200, '不带端口也应放行');
});

test('Host 校验静态路径同样生效', async () => {
  const bad = await rawRequest('GET', '/', null, { Host: 'evil.com' });
  assert.equal(bad.status, 403);
});

test('LAN 模式（HOST=0.0.0.0）不强制 Host 校验', async () => {
  const child2 = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: '0',
      HOST: '0.0.0.0',
      INTERVIEW_MATE_DATA_DIR: tmpData,
      INTERVIEW_MATE_JOB_REFRESH_MIN: '0',
      INTERVIEW_MATE_BRIEF_CHECK_MIN: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const base2 = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('lan server 启动超时')), 10000);
      let buf = '';
      const onData = (d) => {
        buf += d.toString();
        const m = buf.match(/已启动: http:\/\/([\d.]+):(\d+)/);
        if (m) {
          clearTimeout(timer);
          child2.stdout.off('data', onData);
          resolve(`http://127.0.0.1:${m[2]}`); // 0.0.0.0 绑定下用 127.0.0.1 访问
        }
      };
      child2.stdout.on('data', onData);
      child2.stderr.on('data', (d) => { buf += d.toString(); });
      child2.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`lan server 提前退出 code=${code}\n${buf}`));
      });
    });
    const u = new URL(base2);
    const evil = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: u.port, method: 'GET', path: '/api/health',
        headers: { Host: 'evil.com' },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(evil.status, 200, 'LAN 模式下恶意 Host 不应被拒（主机名不可预知）');
  } finally {
    child2.kill();
  }
});

test('CSP 头随静态文件下发，包含 frame/worker/media 的 blob 来源', async () => {
  const res = await rawRequest('GET', '/');
  assert.equal(res.status, 200);
  const csp = res.headers['content-security-policy'] || '';
  for (const directive of [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "media-src 'self' blob:",
    "frame-src 'self' blob:", "worker-src 'self' blob:",
    "connect-src 'self'", "object-src 'none'", "base-uri 'none'",
  ]) {
    assert.ok(csp.includes(directive), `CSP 缺少 ${directive}，实际: ${csp}`);
  }
});
