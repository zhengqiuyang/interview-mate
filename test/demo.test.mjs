/* 演示模式适配层（public/js/demo.js）行为测试：
 * 在 Node 里伪造 location/window，验证 fetch 拦截层返回的形状与 SSE 流。
 * 零网络、零依赖；demo-bank.js 与题库的一致性由 scripts/build-demo.mjs --check 守。 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let demo;
let passthroughCalls = [];

before(async () => {
  globalThis.location = { search: '?demo=1', href: 'http://localhost:8080/?demo=1' };
  globalThis.window = {
    // 占位「真实 fetch」：演示模式只应拦住 /api/*，其余请求必须原样透传给这里
    fetch: async (input) => {
      passthroughCalls.push(String(input));
      return new Response('stub', { status: 200, headers: { 'Content-Type': 'text/javascript' } });
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  demo = await import('../public/js/demo.js');
});

async function apiFetch(path, init) {
  if (!globalThis.window.__imDemoInstalled) demo.installDemoFetch();
  return globalThis.window.fetch(path, init);
}

test('isDemoMode：?demo=1 为真，其它参数为假', () => {
  assert.equal(demo.isDemoMode(), true);
  globalThis.location.search = '?demo=0';
  assert.equal(demo.isDemoMode(), false);
  globalThis.location.search = '';
  assert.equal(demo.isDemoMode(), false);
  globalThis.location.search = '?demo=1';
});

test('installDemoFetch：装上一次后幂等，非演示模式不安装', () => {
  assert.equal(demo.installDemoFetch(), true);
  assert.equal(demo.installDemoFetch(), false); // 第二次调用直接返回 false
  globalThis.location.search = '';
  assert.equal(demo.installDemoFetch(), false);
  globalThis.location.search = '?demo=1';
});

test('/api/health → 声明服务端已配置 Key（页面不再提示「未配置」）', async () => {
  const j = await (await apiFetch('/api/health')).json();
  assert.equal(j.ok, true);
  assert.equal(j.serverKeyConfigured, true);
  assert.equal(j.demo, true);
});

test('/api/questions → 与 data/questions.json 同源的完整题库', async () => {
  const j = await (await apiFetch('/api/questions')).json();
  assert.equal(j.questions.length, 90);
  assert.equal(j.categories.length, 11);
  assert.ok(j.questions.every((q) => q.id && q.q && q.a));
});

test('/api/chat（mock）→ SSE 分片可拼回完整文本', async () => {
  const res = await apiFetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ mode: 'mock', messages: [{ role: 'user', content: '开始面试' }] }),
  });
  assert.equal(res.status, 200);
  assert.ok(res.body, '应返回可读流');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  assert.ok(buf.includes('[DONE]'), '流应以 [DONE] 结束');
  const text = buf.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('data:') && l !== 'data: [DONE]')
    .map((l) => JSON.parse(l.slice(5).trim()))
    .map((j) => j.choices?.[0]?.delta?.content || '')
    .join('');
  assert.ok(text.length > 20, '拼回的面试官提问不应为空');
  assert.match(text, /[？?]/, 'mock 模式的回答应是一个提问');
});

test('/api/chat（mock + forceReport）→ 评估报告带总分与分项，可被 parseReport 解析', async () => {
  const res = await apiFetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ mode: 'mock', forceReport: true, messages: [] }),
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  const text = buf.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('data:') && l !== 'data: [DONE]')
    .map((l) => JSON.parse(l.slice(5).trim()))
    .map((j) => j.choices?.[0]?.delta?.content || '')
    .join('');
  assert.match(text, /总体评分[：:]*\s*\d{1,3}\s*\/\s*100/, '报告需含「总体评分：NN/100」');
  assert.match(text, /[-*]\s*技术深度[：:]\s*\d+\s*\/\s*10/, '报告需含分项评分');
});

test('/api/chat（resume）→ 返回可解析的结构化 JSON', async () => {
  const res = await apiFetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ mode: 'resume', messages: [{ role: 'user', content: '简历 + JD' }] }),
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  const text = buf.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('data:') && l !== 'data: [DONE]')
    .map((l) => JSON.parse(l.slice(5).trim()))
    .map((j) => j.choices?.[0]?.delta?.content || '')
    .join('');
  const j = JSON.parse(text);
  assert.equal(typeof j.score, 'number');
  assert.ok(Array.isArray(j.radar) && j.radar.length >= 4);
  assert.ok(Array.isArray(j.followups) && j.followups.length >= 3);
});

test('/api/jobs 与 /api/jobs/seen → 演示岗位可按字段渲染，已读可标记', async () => {
  const j = await (await apiFetch('/api/jobs?limit=200')).json();
  assert.equal(j.total, j.jobs.length);
  assert.ok(j.jobs.length >= 3);
  for (const job of j.jobs) {
    for (const k of ['key', 'title', 'company', 'sourceName']) assert.ok(job[k], `岗位缺字段 ${k}`);
  }
  const unseen = j.jobs.filter((x) => !x.seen).map((x) => x.key);
  assert.ok(unseen.length > 0);
  const r = await (await apiFetch('/api/jobs/seen', { method: 'POST', body: JSON.stringify({ keys: unseen }) })).json();
  assert.equal(r.marked, unseen.length);
  const after = await (await apiFetch('/api/jobs')).json();
  assert.equal(after.newCount, j.newCount - unseen.length);
});

test('非 /api 请求原样透传（不吞静态资源）', async () => {
  passthroughCalls = [];
  const res = await globalThis.window.fetch('http://localhost:8080/js/app.js');
  assert.deepEqual(passthroughCalls, ['http://localhost:8080/js/app.js'], '静态资源应透传给真正的 fetch');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /javascript/);
  // /api/* 则不应透传
  passthroughCalls = [];
  await globalThis.window.fetch('/api/health');
  assert.deepEqual(passthroughCalls, []);
});
