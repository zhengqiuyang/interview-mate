/* 岗位雷达纯函数测试：stripHtml / matchKeywords / hash（去重键）。
 * 这三个函数原本是 lib/jobs.js 内部实现，为可测性导出（不改行为）。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import jobs from '../lib/jobs.js';
const { stripHtml, matchKeywords, hash } = jobs;

/* ---------------- stripHtml ---------------- */

test('stripHtml 去标签、实体转空格、压缩空白', () => {
  assert.equal(stripHtml('<b>hello</b> <i>world</i>'), 'hello world');
  assert.equal(stripHtml('<p>多   段\n文本</p><p>第二段</p>'), '多 段 文本 第二段');
  assert.equal(stripHtml('a&amp;b'), 'a b'); // 实体替换为空格（保留语义分隔）
  assert.equal(stripHtml('  padded\t text  '), 'padded text');
});

test('stripHtml 空输入安全', () => {
  assert.equal(stripHtml(''), '');
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(undefined), '');
  assert.equal(stripHtml(123), '123'); // String() 兜底
});

/* ---------------- matchKeywords ---------------- */

test('标题命中记 2 分', () => {
  const item = { title: 'Senior Go Engineer', body: 'remote friendly team' };
  const out = matchKeywords(item, ['go', 'k8s'], []);
  assert.deepEqual(out.keywords, ['go']);
  assert.equal(out.score, 2);
});

test('正文命中记 1 分，大小写不敏感', () => {
  const item = { title: 'Backend Engineer', body: 'Experience with KUBERNETES required' };
  const out = matchKeywords(item, ['kubernetes'], []);
  assert.deepEqual(out.keywords, ['kubernetes']);
  assert.equal(out.score, 1);
});

test('标题命中优先于正文（同时命中只算标题分）', () => {
  const item = { title: 'Go Developer', body: 'go go go' };
  const out = matchKeywords(item, ['go'], []);
  assert.equal(out.score, 2);
});

test('excludes 命中直接拒绝（返回 null）', () => {
  const item = { title: 'Go Engineer', body: '需要坐班成都，接受加班' };
  assert.equal(matchKeywords(item, ['go'], ['成都']), null);
  assert.notEqual(matchKeywords(item, ['go'], ['北京']), null); // 未命中 exclude 不影响
});

test('有关键词但一个都没命中 → 拒绝', () => {
  const item = { title: 'Sales Manager', body: 'sell things' };
  assert.equal(matchKeywords(item, ['go', 'rust'], []), null);
});

test('无关键词 = 收录全部（matched 为空，0 分）', () => {
  const item = { title: '任意岗位', body: '任意内容' };
  const out = matchKeywords(item, [], []);
  assert.notEqual(out, null);
  assert.deepEqual(out.keywords, []);
  assert.equal(out.score, 0);
});

test('关键词数组里的空串被忽略（等价于无关键词）', () => {
  const item = { title: 'No match here', body: '' };
  assert.notEqual(matchKeywords(item, ['', ''], []), null);
});

/* ---------------- hash / 去重键 ---------------- */

test('hash 稳定：同输入必同输出', () => {
  const a = hash('remoteok|https://remoteok.com/jobs/123');
  const b = hash('remoteok|https://remoteok.com/jobs/123');
  assert.equal(a, b);
  assert.equal(typeof a, 'string');
  assert.ok(a.length > 0);
});

test('hash 区分不同输入（去重键不碰撞）', () => {
  const inputs = [
    'remoteok|https://a.com/1',
    'remoteok|https://a.com/2',
    'weworkremotely|https://a.com/1',
    'manual|标题一|摘要',
    'manual|标题二|摘要',
  ];
  const outs = inputs.map(hash);
  assert.equal(new Set(outs).size, outs.length);
});

test('去重键由 type|url 构成 —— 同源同地址必须同键', () => {
  const sub = { type: 'remoteok' };
  const job = { url: 'https://x.com/j/9', title: 't' };
  const keyOf = (type, url) => hash(`${type}|${url}`);
  assert.equal(keyOf(sub.type, job.url), keyOf('remoteok', 'https://x.com/j/9'));
});
