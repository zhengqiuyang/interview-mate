/**
 * 每日简报 · 服务端定时生成
 * 客户端定期推送「学习数据快照」；若服务端配置了 API Key，则按间隔自动生成当日简报，
 * 客户端打开看板时优先取服务端简报，否则用页面 Key 现场生成（或本地兜底）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '..', 'data', 'briefs.json');
const DAY = 24 * 3600 * 1000;

let db = { snapshot: null, snapshotAt: 0, briefs: [], tokens: { p: 0, c: 0, n: 0 } };

function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function load() {
  try {
    if (fs.existsSync(STORE_FILE)) db = Object.assign(db, JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')));
  } catch (e) {
    console.warn('[briefs] 存储读取失败：', e.message);
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.warn('[briefs] 存储写入失败：', e.message);
  }
}

function setSnapshot(text) {
  db.snapshot = String(text || '').slice(0, 6000);
  db.snapshotAt = Date.now();
  save();
}

function hasBriefToday() {
  return db.briefs.some((b) => b.date === dateKey());
}

/* callLLM(system, user) 由 server.js 注入（非流式） */
async function generateToday(callLLM) {
  if (!db.snapshot || Date.now() - db.snapshotAt > 2 * DAY) {
    return { skipped: 'no-fresh-snapshot' };
  }
  if (hasBriefToday()) return { skipped: 'already-generated' };
  try {
    const { text, usage } = await callLLM(
      '你是 InterviewMate 的每日简报官。基于用户学习数据快照输出简短中文 Markdown 简报：## 昨日回顾（一句总结）## 今日重点（3 条，引用具体数据）## 一句加油（简短有个性）。全文 200 字内，不编造。',
      `【数据快照 · ${dateKey()}】\n${db.snapshot}`
    );
    db.tokens.p += usage.p || 0;
    db.tokens.c += usage.c || 0;
    db.tokens.n += 1;
    db.briefs.unshift({ date: dateKey(), text: String(text).slice(0, 4000), at: Date.now() });
    db.briefs = db.briefs.slice(0, 30);
    save();
    console.log('[briefs] 已生成今日简报');
    return { ok: true };
  } catch (e) {
    console.warn('[briefs] 生成失败：', e.message);
    return { error: e.message };
  }
}

function getBriefs(limit = 7) {
  return {
    briefs: db.briefs.slice(0, limit),
    snapshotAge: db.snapshotAt ? Date.now() - db.snapshotAt : null,
    serverTokens: db.tokens,
  };
}

let timer = null;
function startScheduler(intervalMin, callLLM, hasKey) {
  if (timer) clearInterval(timer);
  if (!intervalMin || intervalMin <= 0) return;
  timer = setInterval(async () => {
    if (!hasKey()) return;
    await generateToday(callLLM);
  }, intervalMin * 60 * 1000);
  console.log(`[briefs] 简报调度器已启动，每 ${intervalMin} 分钟检查一次`);
}

module.exports = { load, setSnapshot, generateToday, getBriefs, startScheduler, dateKey };
