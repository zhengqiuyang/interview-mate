/* 流式代理（/api/chat）行为测试：两段超时 / stream_options 回退 / 客户端断开传播。
 * 用真实 server（子进程）+ 测试内 mock 上游；超时阈值用 env 缩短到 ~1s。 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;
let base;
let tmpDirs = [];
const mocks = [];

/** 起一个 server 子进程，返回 { child, base, tmp }；base 从启动横幅里解析真实端口 */
async function startServer(extraEnv = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'im-data-'));
  tmpDirs.push(tmp);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: '0',
      INTERVIEW_MATE_DATA_DIR: tmp, // 不写仓库 data/
      INTERVIEW_MATE_JOB_REFRESH_MIN: '0',
      INTERVIEW_MATE_BRIEF_CHECK_MIN: '0',
      INTERVIEW_MATE_UPSTREAM_FIRST_BYTE_MS: '700',
      INTERVIEW_MATE_UPSTREAM_IDLE_MS: '700',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server 启动超时')), 10000);
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
  return { child, base: url, tmp };
}

before(async () => {
  const s = await startServer();
  server = s.child;
  base = s.base;
});

after(() => {
  if (server) server.kill();
  for (const m of mocks) m.close();
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const CHAT_BODY = {
  apiKey: 'test-key-not-real',
  baseURL: '', // 每个用例指向自己的 mock 上游
  messages: [{ role: 'user', content: 'hi' }],
};

function chatChat(payload, targetBase = base) {
  return new Promise((resolve, reject) => {
    const req = http.request(targetBase + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(payload));
  });
}

function startMock(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => {
      mocks.push(srv);
      resolve(srv);
    });
  });
}

test('场景1：上游挂起 → 首字节超时（缩短到 700ms）→ 504', async () => {
  const hung = await startMock(() => { /* 接受连接但永不响应 */ });
  const payload = { ...CHAT_BODY, baseURL: `http://127.0.0.1:${hung.address().port}/v1` };
  const started = Date.now();
  const res = await chatChat(payload);
  const elapsed = Date.now() - started;
  assert.equal(res.status, 504);
  assert.match(res.body, /首字节/);
  assert.ok(elapsed < 5000, `首字节超时应 ~0.7s，实际 ${elapsed}ms`);
});

test('场景2：400 提到 stream_options → 去掉重试一次并成功透传', async () => {
  const calls = [];
  const sse = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n';
  const mock = await startMock((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      calls.push(JSON.parse(raw));
      if (calls.length === 1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Unrecognized request argument supplied: stream_options' } }));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(sse);
      }
    });
  });
  const payload = { ...CHAT_BODY, baseURL: `http://127.0.0.1:${mock.address().port}/v1` };
  const res = await chatChat(payload);
  assert.equal(res.status, 200);
  assert.equal(res.body, sse); // SSE 原文透传
  assert.equal(calls.length, 2);
  assert.ok('stream_options' in calls[0], '第一次请求带 stream_options');
  assert.ok(!('stream_options' in calls[1]), '回退后去掉 stream_options');
});

test('场景3：客户端断开 → 上游收到 abort（连接关闭）', async () => {
  let upstreamClose = null;
  const mock = await startMock((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"delta":"start"}\n\n'); // 先吐一块，保持连接
    req.on('close', () => {
      if (upstreamClose) upstreamClose();
    });
  });
  const closedPromise = new Promise((resolve) => { upstreamClose = resolve; });
  const payload = { ...CHAT_BODY, baseURL: `http://127.0.0.1:${mock.address().port}/v1` };

  const result = await new Promise((resolve) => {
    const req = http.request(base + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      res.once('data', () => {
        // 收到首块后立即断开（模拟用户点 Stop / 关页）
        req.destroy();
        resolve({ clientDisconnected: true });
      });
    });
    req.on('error', () => { /* 客户端主动断开导致的 socket 错误，预期内 */ });
    req.end(JSON.stringify(payload));
  });
  assert.ok(result.clientDisconnected);

  const closed = await Promise.race([
    closedPromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
  ]);
  assert.equal(closed, true, '上游 3s 内应感知到断开（abort 传播）');
});

/* ---- P2 复核遗留：回退请求缺首字节超时 / 非法 env 变 NaN ---- */

test('场景4：400 回退后第二次请求挂住 → 回退请求也有首字节超时（不永久 hang）', async () => {
  const calls = [];
  const mock = await startMock((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      calls.push(JSON.parse(raw));
      if (calls.length === 1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Unrecognized request argument supplied: stream_options' } }));
      }
      // 第二次：接受连接但永不响应 —— 旧实现这里会永久挂住
    });
  });
  const payload = { ...CHAT_BODY, baseURL: `http://127.0.0.1:${mock.address().port}/v1` };
  const started = Date.now();
  const res = await chatChat(payload);
  const elapsed = Date.now() - started;
  assert.equal(calls.length, 2, '应先 400 再回退一次');
  assert.equal(res.status, 504, `回退请求挂住应 504，实际 ${res.status}`);
  assert.match(res.body, /首字节/);
  assert.ok(elapsed < 5000, `回退请求也应在 ~0.7s 超时，实际 ${elapsed}ms`);
});

test('场景5：超时环境变量非法（NaN）→ 回退默认值，不会立刻误超时', async () => {
  const s = await startServer({ INTERVIEW_MATE_UPSTREAM_FIRST_BYTE_MS: 'abc' });
  try {
    const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n';
    const mock = await startMock((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        // 400ms 后才响应：若 NaN 被当成 0ms，这里会立刻 504
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.end(sse);
        }, 400);
      });
    });
    const payload = { ...CHAT_BODY, baseURL: `http://127.0.0.1:${mock.address().port}/v1` };
    const res = await chatChat(payload, s.base);
    assert.equal(res.status, 200, `非法阈值应回退 30s 默认值，实际 ${res.status}: ${res.body}`);
    assert.equal(res.body, sse);
  } finally {
    s.child.kill();
  }
});

test('场景6：本地 Ollama 端点无 apiKey 可正常代理；远端无 apiKey 返回 400', async () => {
  let seenAuth = '';
  const sse = 'data: {"choices":[{"delta":{"content":"local ok"}}]}\n\ndata: [DONE]\n\n';
  const mock = await startMock((req, res) => {
    seenAuth = req.headers.authorization || '';
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(sse);
    });
  });

  const localRes = await chatChat({
    baseURL: `http://127.0.0.1:${mock.address().port}/v1`,
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(localRes.status, 200);
  assert.equal(localRes.body, sse);
  assert.equal(seenAuth, 'Bearer ollama');

  const remoteRes = await chatChat({
    baseURL: 'https://api.openai.com/v1',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(remoteRes.status, 400);
  assert.match(remoteRes.body, /API Key/);
});
