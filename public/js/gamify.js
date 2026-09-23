/* 游戏化引擎：XP / 等级 / 成就（Duolingo 式进度系统） */
import { $, icon, toast, confetti } from './core.js';
import { S, persist } from './state.js';
import { streakDays, masteryStats, isMastered } from './srs.js';

export const LEVELS = [
  { xp: 0, title: '新手上路', icon: '🌱' },
  { xp: 100, title: '见习工程师', icon: '📗' },
  { xp: 300, title: '进阶选手', icon: '⚡' },
  { xp: 700, title: '面试常客', icon: '🎯' },
  { xp: 1500, title: 'offer 候选人', icon: '🚀' },
  { xp: 3000, title: '面试收割机', icon: '🏆' },
  { xp: 6000, title: '传说面神', icon: '👑' },
];

export function levelInfo(xp) {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].xp) idx = i;
  const cur = LEVELS[idx];
  const next = LEVELS[idx + 1] || null;
  const pct = next ? Math.round(((xp - cur.xp) / (next.xp - cur.xp)) * 100) : 100;
  return { level: idx + 1, ...cur, next, pct, xp };
}

export const ACHIEVEMENTS = [
  { id: 'first_mock', icon: '🎙️', name: '初次登场', desc: '完成第一场模拟面试' },
  { id: 'mock_10', icon: '🎤', name: '身经百战', desc: '累计 10 场模拟面试' },
  { id: 'score_80', icon: '🎖️', name: '稳了', desc: '单场模拟面试 ≥ 80 分' },
  { id: 'score_90', icon: '🥇', name: '面神时刻', desc: '单场模拟面试 ≥ 90 分' },
  { id: 'streak_3', icon: '🔥', name: '小火苗', desc: '连续打卡 3 天' },
  { id: 'streak_7', icon: '🌋', name: '烈火燎原', desc: '连续打卡 7 天' },
  { id: 'streak_30', icon: '☄️', name: '三十而立', desc: '连续打卡 30 天' },
  { id: 'mastered_10', icon: '📘', name: '十全十美', desc: '掌握 10 道题' },
  { id: 'mastered_50', icon: '📚', name: '知识海绵', desc: '掌握 50 道题' },
  { id: 'master_all', icon: '🧠', name: '全图鉴', desc: '掌握全部内置题库' },
  { id: 'daily_7', icon: '📅', name: '周挑战者', desc: '累计完成 7 次每日挑战' },
  { id: 'kn_20', icon: '🗂️', name: '第二大脑', desc: '知识库积累 20 条' },
  { id: 'level_5', icon: '🚀', name: 'offer 候选人', desc: '达到 Lv.5' },
];

function checkAch() {
  const g = S.gamify;
  const ms = masteryStats();
  const mocks = S.sessions.filter((s) => s.kind === 'mock');
  const best = Math.max(0, ...mocks.map((m) => m.score ?? 0));
  const streak = streakDays();
  const builtinAll = S.questions.filter((q) => !String(q.id).startsWith('custom-'));
  const cond = {
    first_mock: mocks.length >= 1,
    mock_10: mocks.length >= 10,
    score_80: best >= 80,
    score_90: best >= 90,
    streak_3: streak >= 3,
    streak_7: streak >= 7,
    streak_30: streak >= 30,
    mastered_10: ms.mastered >= 10,
    mastered_50: ms.mastered >= 50,
    master_all: builtinAll.length > 0 && builtinAll.every((q) => isMastered(q.id)),
    daily_7: Object.keys(S.daily).length >= 7,
    kn_20: S.knowledge.length >= 20,
    level_5: levelInfo(g.xp).level >= 5,
  };
  let newly = [];
  for (const a of ACHIEVEMENTS) {
    if (!g.unlocked.includes(a.id) && cond[a.id]) {
      g.unlocked.push(a.id);
      newly.push(a);
    }
  }
  if (newly.length) {
    persist('gamify');
    for (const a of newly) {
      toast(`${a.icon} 达成成就「${a.name}」 +20 XP`, 'ok');
    }
    g.xp += newly.length * 20;
    persist('gamify');
    if (typeof document !== 'undefined') confetti(1500);
    renderLevelChip();
  }
}

export function awardXP(n, reason = '') {
  const g = S.gamify;
  const before = levelInfo(g.xp).level;
  g.xp += n;
  if (reason) toast(`+${n} XP · ${reason}`, 'ok');
  persist('gamify');
  const after = levelInfo(g.xp).level;
  if (after > before) {
    const li = levelInfo(g.xp);
    toast(`${li.icon} 升级！Lv.${li.level} ${li.title}`, 'ok');
    if (typeof document !== 'undefined') confetti(2000);
  }
  renderLevelChip();
  checkAch();
}

/* 侧栏等级条 */
export function renderLevelChip() {
  const el = document.getElementById('level-chip');
  if (!el) return;
  const li = levelInfo(S.gamify.xp);
  el.innerHTML = `
    <div class="lv-icon">${li.icon}</div>
    <div class="lv-main">
      <div class="lv-title">Lv.${li.level} ${li.title}</div>
      <div class="bar" style="height:5px"><i style="width:${li.pct}%"></i></div>
      <div class="lv-sub">${li.xp} XP${li.next ? ` · 距 Lv.${li.level + 1} 还差 ${li.next.xp - li.xp}` : ' · 已满级'}</div>
    </div>`;
}

/* 看板成就墙 */
export function renderAchievements(container) {
  if (!container) return;
  const g = S.gamify;
  container.innerHTML = ACHIEVEMENTS.map((a) => {
    const on = g.unlocked.includes(a.id);
    return `<div class="ach-card ${on ? '' : 'locked'}" title="${a.desc}">
      <div class="ach-icon">${a.icon}</div>
      <div class="ach-name">${a.name}</div>
      <div class="ach-desc">${a.desc}</div>
      ${on ? '' : '<div class="ach-lock">🔒</div>'}
    </div>`;
  }).join('');
}
