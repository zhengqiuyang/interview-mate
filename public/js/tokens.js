/* Token 用量记录与统计
 * 优先记录接口返回的真实 usage；缺失时按中英文加权估算（est=true 标注）
 */
import { store, dateKey } from './core.js';
import { S } from './state.js';

const KEY = 'im_tokens';
const MAX_LOG = 600;

/* 常见模型参考价（美元 / 每百万 token：[输入, 输出]，仅供粗估） */
export const PRICE_TABLE = {
  'glm-4-flash': [0, 0],
  'glm-4-air': [0.001, 0.001],
  'glm-4-plus': [0.0355, 0.0355],
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4o': [2.5, 10],
  'deepseek-chat': [0.27, 1.1],
  'moonshot-v1-8k': [1.68, 1.68],
};

export const MODE_NAMES = {
  mock: '模拟面试', agent: '智能体教练', resume: '简历诊断', polish: '简历润色',
  jd: '岗位情报', cards: '学习卡生成', deepdive: 'AI 追问', brief: '每日简报', free: '测试/其他',
};

/* 中英文加权估算：中文≈1字1token，英文≈4字符1token */
export function estimateTokens(text) {
  const s = String(text || '');
  let cjk = 0;
  for (const ch of s) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) cjk += 1;
  }
  return Math.round(cjk + (s.length - cjk) / 4);
}

function load() {
  return store.get(KEY, { log: [] });
}

export function recordTokens(mode, model, promptTok, completionTok, est) {
  const db = load();
  db.log.push({
    t: Date.now(), m: mode || 'free', mo: model || '',
    p: Math.max(0, Math.round(promptTok || 0)),
    c: Math.max(0, Math.round(completionTok || 0)),
    e: Boolean(est),
  });
  if (db.log.length > MAX_LOG) db.log = db.log.slice(-MAX_LOG);
  store.set(KEY, db);
}

export function clearTokens() {
  store.set(KEY, { log: [] });
}

export function exportTokens() {
  return JSON.stringify(load(), null, 2);
}

export function tokenStats() {
  const db = load();
  const today = dateKey();
  const month = today.slice(0, 7);
  const stats = {
    total: { p: 0, c: 0, n: 0, est: 0 },
    today: { p: 0, c: 0, n: 0 },
    month: { p: 0, c: 0, n: 0 },
    byMode: {},
    byDay: {},
    byModel: {},
    recent: [],
  };
  for (let i = db.log.length - 1; i >= 0; i--) {
    const e = db.log[i];
    const d = new Date(e.t);
    const dk = dateKey(d);
    stats.total.p += e.p; stats.total.c += e.c; stats.total.n += 1;
    if (e.e) stats.total.est += 1;
    if (dk === today) { stats.today.p += e.p; stats.today.c += e.c; stats.today.n += 1; }
    if (dk.slice(0, 7) === month) { stats.month.p += e.p; stats.month.c += e.c; stats.month.n += 1; }
    const m = stats.byMode[e.m] || (stats.byMode[e.m] = { p: 0, c: 0, n: 0 });
    m.p += e.p; m.c += e.c; m.n += 1;
    const day = stats.byDay[dk] || (stats.byDay[dk] = { p: 0, c: 0 });
    day.p += e.p; day.c += e.c;
    const mo = stats.byModel[e.mo] || (stats.byModel[e.mo] = { p: 0, c: 0, n: 0 });
    mo.p += e.p; mo.c += e.c; mo.n += 1;
    if (stats.recent.length < 12) stats.recent.push(e);
  }
  return stats;
}

/* 按内置价目表粗估费用（美元），未知模型返回 null */
export function estimateCost(stats) {
  let cost = 0, known = false;
  for (const [model, v] of Object.entries(stats.byModel)) {
    const price = PRICE_TABLE[model.toLowerCase()];
    if (!price) continue;
    known = true;
    cost += (v.p / 1e6) * price[0] + (v.c / 1e6) * price[1];
  }
  return known ? cost : null;
}

/* 最近 N 天序列（供折线图） */
export function daySeries(days = 14) {
  const stats = tokenStats();
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dk = dateKey(d);
    const v = stats.byDay[dk] || { p: 0, c: 0 };
    out.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, p: v.p, c: v.c });
  }
  return out;
}
