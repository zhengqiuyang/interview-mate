/* 间隔重复（Leitner 盒子简化版）+ 活跃度/连续打卡
 *
 * 每题一张卡：{box:0..4, due:时间戳, reps, lapses, last}
 * box 越高 → 距下次复习间隔越长：0:10min 1:1天 2:3天 3:7天 4:21天
 * 掌握定义：box >= 3
 */
import { S } from './state.js';
import { store, dateKey, seededRandom } from './core.js';

const DAY = 24 * 3600 * 1000;
export const BOX_INTERVALS = [10 * 60 * 1000, DAY, 3 * DAY, 7 * DAY, 21 * DAY];

export function getCard(qid) {
  return S.srs[qid] || null;
}

export function isMastered(qid) {
  const c = S.srs[qid];
  return Boolean(c && c.box >= 3);
}

export function nextReviewText(qid) {
  const c = S.srs[qid];
  if (!c || c.reps === 0) return '';
  const left = c.due - Date.now();
  if (left <= 0) return '待复习';
  const min = Math.round(left / 60000);
  if (min < 60) return `${Math.max(min, 1)} 分钟后复习`;
  const d = Math.ceil(left / DAY);
  return `${d} 天后复习`;
}

/* 评分：0=不会 1=模糊 2=掌握 */
export function grade(qid, g) {
  const now = Date.now();
  const c = S.srs[qid] || { box: 0, due: 0, reps: 0, lapses: 0, last: 0 };
  c.reps += 1;
  c.last = now;
  if (g === 0) { c.box = 0; c.lapses += 1; }
  else if (g === 1) { c.box = Math.max(1, c.box); }
  else { c.box = Math.min(4, c.box + 1); }
  c.due = now + BOX_INTERVALS[c.box];
  S.srs[qid] = c;
  store.set('im_srs', S.srs);
  markActivity();
  return c;
}

export function dueList() {
  const now = Date.now();
  return Object.entries(S.srs)
    .filter(([, c]) => c.box < 4 && c.due <= now)
    .map(([qid]) => qid)
    .filter((qid) => S.questions.find((q) => q.id === qid));
}

export function learningList() {
  return Object.entries(S.srs)
    .filter(([, c]) => c.box > 0 && c.box < 3)
    .map(([qid]) => qid);
}

/* 错题本：挂过科（lapses>0）且尚未掌握的题，按挂科次数排序 */
export function wrongList() {
  return Object.entries(S.srs)
    .filter(([, c]) => c.lapses > 0 && c.box < 3)
    .sort((a, b) => b[1].lapses - a[1].lapses)
    .map(([qid]) => qid)
    .filter((qid) => S.questions.find((q) => q.id === qid));
}

/* 随机挑 n 道未学过的题（无卡片记录） */
export function freshList(n, filterFn) {
  const pool = S.questions.filter((q) => !S.srs[q.id] && (filterFn ? filterFn(q) : true));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).map((q) => q.id);
}

export function masteryStats() {
  const total = S.questions.length;
  const mastered = S.questions.filter((q) => isMastered(q.id)).length;
  const seen = Object.keys(S.srs).filter((qid) => S.questions.find((q) => q.id === qid)).length;
  return { total, mastered, seen, pct: total ? Math.round((mastered / total) * 100) : 0 };
}

export function catMastery() {
  return S.categories.map((c) => {
    const qs = S.questions.filter((q) => q.cat === c.key);
    const m = qs.filter((q) => isMastered(q.id)).length;
    return { key: c.key, name: c.name, total: qs.length, mastered: m, pct: qs.length ? Math.round((m / qs.length) * 100) : 0 };
  }).filter((c) => c.total > 0);
}

/* ---------- 活跃度 / 打卡 ---------- */
export function markActivity(n = 1) {
  const k = dateKey();
  S.activity[k] = (S.activity[k] || 0) + n;
  store.set('im_activity', S.activity);
}

export function streakDays() {
  let streak = 0;
  const d = new Date();
  // 今天还没练不打断连续（从昨天起算）
  if (!S.activity[dateKey(d)]) d.setDate(d.getDate() - 1);
  for (;;) {
    if (S.activity[dateKey(d)]) { streak += 1; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

export function heatLevels(days = 14) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const n = S.activity[dateKey(d)] || 0;
    const lvl = n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 10 ? 3 : 4;
    out.push({ date: dateKey(d), n, lvl });
  }
  return out;
}

/* ---------- 每日挑战（按日期确定性选题） ---------- */
export function dailyQuestion() {
  if (!S.questions.length) return null;
  const rnd = seededRandom(dateKey());
  return S.questions[Math.floor(rnd() * S.questions.length)];
}

export function isDailyDone() {
  return Boolean(S.daily[dateKey()]);
}

export function markDailyDone(qid) {
  S.daily[dateKey()] = qid;
  store.set('im_daily', S.daily);
}
