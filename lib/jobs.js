/**
 * 岗位雷达 · 服务端聚合引擎
 *
 * 订阅若干「源」（公开 API / RSS / 自定义 JSON），按关键词过滤、去重后落盘。
 * 说明：不做需要登录/强反爬的招聘站爬虫；国内 JD 推荐页面复制 → 前端「手动添加」+ AI 解析。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '..', 'data', 'jobs-store.json');
const MAX_JOBS = 400;
const FETCH_TIMEOUT = 15000;

/* ---------------- 存储 ---------------- */

let db = { subs: [], jobs: [], lastRun: null, running: false };

function load() {
  try {
    if (fs.existsSync(STORE_FILE)) db = Object.assign(db, JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')));
  } catch (e) {
    console.warn('[jobs] 存储读取失败，从空库开始：', e.message);
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.warn('[jobs] 存储写入失败：', e.message);
  }
}

/* ---------------- 工具 ---------------- */

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (InterviewMate/0.3 local aggregator)', ...(opts.headers || {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

function matchKeywords(item, keywords, excludes) {
  const hay = `${item.title} ${item.body || ''}`.toLowerCase();
  for (const ex of excludes) {
    if (ex && hay.includes(ex.toLowerCase())) return null;
  }
  const titleLow = (item.title || '').toLowerCase();
  const matched = [];
  let score = 0;
  for (const kw of keywords) {
    if (!kw) continue;
    const k = kw.toLowerCase();
    if (titleLow.includes(k)) { matched.push(kw); score += 2; }
    else if (hay.includes(k)) { matched.push(kw); score += 1; }
  }
  // 有关键词时必须命中至少一个；无关键词 = 收录全部
  if (keywords.filter(Boolean).length && !matched.length) return null;
  item.keywords = matched;
  item.score = score;
  return item;
}

/* ---------------- 源适配器（全部返回统一的岗位数组） ---------------- */

const ADAPTERS = {
  /* RemoteOK 公开 API（国际远程岗位） */
  async remoteok(sub) {
    const res = await fetchWithTimeout('https://remoteok.com/api');
    if (!res.ok) throw new Error(`RemoteOK HTTP ${res.status}`);
    const arr = await res.json();
    return arr.slice(1).map((j) => ({
      title: j.position || j.slug || '未知岗位',
      company: j.company || '',
      location: j.location || 'Remote',
      salary: j.salary || (j.salary_min && j.salary_max ? `${j.salary_min}-${j.salary_max}` : ''),
      url: j.url || j.apply_url || '',
      body: stripHtml(j.description).slice(0, 3000),
      publishedAt: j.date ? Date.parse(j.date) : null,
    }));
  },

  /* Hacker News 每月「Ask HN: Who is hiring」帖子的评论 */
  async hn(sub) {
    const storyRes = await fetchWithTimeout(
      'https://hn.algolia.com/api/v1/search?query=' +
      encodeURIComponent('"Ask HN: Who is hiring"') + '&tags=story&hitsPerPage=1'
    );
    if (!storyRes.ok) throw new Error(`HN HTTP ${storyRes.status}`);
    const story = (await storyRes.json()).hits[0];
    if (!story) throw new Error('未找到 Who is hiring 帖');
    const cmRes = await fetchWithTimeout(
      `https://hn.algolia.com/api/v1/search?tags=comment,story_${story.objectID}&hitsPerPage=200`
    );
    if (!cmRes.ok) throw new Error(`HN 评论 HTTP ${cmRes.status}`);
    const hits = (await cmRes.json()).hits || [];
    return hits.map((h) => {
      const text = stripHtml(h.comment_text).slice(0, 3000);
      const firstLine = (text.split('\n')[0] || '').slice(0, 90);
      return {
        title: firstLine || 'HN 岗位',
        company: firstLine.split(/[|–—:：,，]/)[0].trim().slice(0, 40),
        location: '',
        salary: (text.match(/\$[\d,.]+[kK]?\s*(?:-|–|to)?\s*\$?[\d,.]*[kK]?/) || [''])[0],
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        body: text,
        publishedAt: h.created_at ? Date.parse(h.created_at) : null,
      };
    });
  },

  /* 通用 RSS：正则解析 <item>，零依赖 */
  async rss(sub) {
    const res = await fetchWithTimeout(sub.url);
    if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
    const xml = await res.text();
    const items = xml.match(/<item[\s\S]*?<\/item>/g) || [];
    return items.slice(0, 80).map((blk) => {
      const pick = (tag) => {
        const m = blk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
        if (!m) return '';
        return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim();
      };
      return {
        title: stripHtml(pick('title')).slice(0, 120) || '(无标题)',
        company: stripHtml(pick('author') || pick('source')),
        location: '',
        salary: '',
        url: pick('link'),
        body: stripHtml(pick('description')).slice(0, 2000),
        publishedAt: Date.parse(pick('pubDate')) || null,
      };
    });
  },

  /* 自定义 JSON：期望数组，元素含 title/url，可选 company/location/salary/date/description */
  async json(sub) {
    const res = await fetchWithTimeout(sub.url);
    if (!res.ok) throw new Error(`JSON 源 HTTP ${res.status}`);
    const arr = await res.json();
    if (!Array.isArray(arr)) throw new Error('自定义 JSON 源应返回数组');
    return arr.slice(0, 200).map((j) => ({
      title: String(j.title || j.position || j.name || '(无标题)').slice(0, 120),
      company: String(j.company || j.employer || ''),
      location: String(j.location || j.city || ''),
      salary: String(j.salary || ''),
      url: String(j.url || j.link || ''),
      body: stripHtml(j.description || j.body || j.content || '').slice(0, 2000),
      publishedAt: j.date || j.publishedAt ? Date.parse(j.date || j.publishedAt) : null,
    }));
  },
};

const SOURCE_NAMES = {
  remoteok: 'RemoteOK',
  hn: 'HN 招聘帖',
  rss: 'RSS 源',
  json: 'JSON 源',
  manual: '手动添加',
};

/* ---------------- 抓取调度 ---------------- */

async function refreshAll() {
  if (db.running) return { running: true, added: 0 };
  db.running = true;
  let added = 0;
  const now = Date.now();
  try {
    for (const sub of db.subs) {
      if (!sub.enabled) continue;
      const adapter = ADAPTERS[sub.type];
      if (!adapter) { sub.lastError = `未知源类型 ${sub.type}`; continue; }
      try {
        const raw = await adapter(sub);
        let subAdded = 0;
        for (const item of raw) {
          const matched = matchKeywords(item, sub.keywords || [], sub.excludes || []);
          if (!matched) continue;
          const key = hash(`${sub.type}|${matched.url || matched.title}`);
          if (db.jobs.some((j) => j.key === key)) continue;
          db.jobs.unshift({
            key,
            sourceType: sub.type,
            sourceName: SOURCE_NAMES[sub.type] || sub.type,
            subId: sub.id,
            ...matched,
            fetchedAt: now,
            seen: false,
          });
          subAdded += 1;
          if (db.jobs.length > MAX_JOBS) db.jobs.length = MAX_JOBS;
        }
        added += subAdded;
        sub.lastError = null;
        sub.lastFetch = now;
        sub.lastAdded = subAdded;
      } catch (e) {
        sub.lastError = e.name === 'AbortError' ? '请求超时（15s）' : e.message;
      }
    }
    db.jobs.sort((a, b) => (b.publishedAt || b.fetchedAt) - (a.publishedAt || a.fetchedAt));
    db.lastRun = now;
    save();
    return { running: false, added, at: now };
  } finally {
    db.running = false;
  }
}

/* ---------------- 订阅管理 ---------------- */

function addSub({ type, url, name, keywords = [], excludes = [] }) {
  if (!ADAPTERS[type] && type !== 'manual') throw new Error('不支持的源类型');
  if ((type === 'rss' || type === 'json') && !/^https?:\/\//i.test(url || '')) {
    throw new Error('该源类型需要 http(s) 地址');
  }
  const sub = {
    id: 'sub-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type, url: url || '', name: name || SOURCE_NAMES[type] || type,
    keywords: keywords.map(String).filter(Boolean),
    excludes: excludes.map(String).filter(Boolean),
    enabled: true, lastFetch: null, lastError: null, lastAdded: 0,
  };
  db.subs.push(sub);
  save();
  return sub;
}

function removeSub(id) {
  db.subs = db.subs.filter((s) => s.id !== id);
  save();
}

function toggleSub(id) {
  const s = db.subs.find((x) => x.id === id);
  if (s) { s.enabled = !s.enabled; save(); }
  return s;
}

/* 手动添加一条岗位（粘贴的 JD） */
function addManualJob({ title, company, url, body }) {
  const item = matchKeywords({ title, company, url, body, location: '', salary: '' }, [], []);
  const key = hash(`manual|${title}|${(body || '').slice(0, 60)}`);
  if (db.jobs.some((j) => j.key === key)) return { dup: true };
  db.jobs.unshift({
    key, sourceType: 'manual', sourceName: '手动添加', subId: null,
    ...item, keywords: [], score: 0,
    publishedAt: Date.now(), fetchedAt: Date.now(), seen: false,
  });
  db.jobs.sort((a, b) => (b.publishedAt || b.fetchedAt) - (a.publishedAt || a.fetchedAt));
  save();
  return { dup: false };
}

function markSeen(keys) {
  const set = new Set(keys || []);
  let n = 0;
  for (const j of db.jobs) {
    if (set.has(j.key) && !j.seen) { j.seen = true; n++; }
  }
  if (n) save();
  return n;
}

/* ---------------- 对外接口 ---------------- */

function getJobs({ limit = 100, onlyNew = false } = {}) {
  const list = onlyNew ? db.jobs.filter((j) => !j.seen) : db.jobs;
  return {
    jobs: list.slice(0, limit),
    total: db.jobs.length,
    newCount: db.jobs.filter((j) => !j.seen).length,
    lastRun: db.lastRun,
    running: db.running,
  };
}

function getSubs() {
  return { subs: db.subs, lastRun: db.lastRun };
}

let timer = null;
function startScheduler(intervalMin) {
  if (timer) clearInterval(timer);
  if (!intervalMin || intervalMin <= 0) return;
  // 启动 8 秒后先跑一次，之后按间隔轮询
  setTimeout(() => refreshAll().catch(() => {}), 8000);
  timer = setInterval(() => refreshAll().catch(() => {}), intervalMin * 60 * 1000);
  console.log(`[jobs] 岗位雷达已启动，每 ${intervalMin} 分钟自动抓取`);
}

module.exports = {
  load, refreshAll, addSub, removeSub, toggleSub, addManualJob, markSeen,
  getJobs, getSubs, startScheduler, SOURCE_NAMES,
};
