/* 数据看板 */
import { $, $$, esc, icon, radarChart, lineChart, donutChart, animateNum, staggerIn, md, dateKey, toast } from '../core.js';
import { S, persist } from '../state.js';
import { switchView } from '../router.js';
import { dueList, masteryStats, catMastery, streakDays, heatLevels, dailyQuestion, isDailyDone } from '../srs.js';
import { streamChat, hasKey } from '../api.js';
import { collectStatsText } from './agent.js';
import { startFlashcards } from './flashcards.js';
import { levelInfo, renderAchievements, renderLevelChip } from '../gamify.js';

export function init() {
  $('#btn-brief-refresh')?.addEventListener('click', () => ensureDailyBrief(true).then(renderBrief));
}

export function onShow() { render(); ensureDailyBrief(false).then(renderBrief).catch(() => {}); }

/* ---------- 今日简报：服务端定时 > 客户端 AI > 本地兜底 ---------- */

const BRIEF_KIND = { server: '服务端定时', ai: 'AI 生成', local: '本地版' };

function saveBrief(b) {
  S.dailyBrief = b;
  persist('dailyBrief');
}

export async function ensureDailyBrief(force = false) {
  const today = dateKey();
  if (!force && S.dailyBrief?.date === today) return S.dailyBrief;

  // 推送快照给服务端定时器（fire-and-forget）
  fetch('/api/agent/snapshot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stats: collectStatsText() }),
  }).catch(() => {});

  // 优先取服务端定时生成的简报
  try {
    const j = await fetch('/api/agent/briefs').then((r) => r.json());
    const sv = (j.briefs || []).find((b) => b.date === today);
    if (sv) { saveBrief({ date: today, text: sv.text, kind: 'server' }); return S.dailyBrief; }
  } catch (_) { /* 服务端不可达，继续 */ }

  // 客户端 AI 现场生成
  if (hasKey()) {
    try {
      let full = '';
      await streamChat(
        { mode: 'brief', messages: [{ role: 'user', content: collectStatsText() }] },
        (d) => { full += d; }
      );
      if (full.trim()) { saveBrief({ date: today, text: full, kind: 'ai' }); return S.dailyBrief; }
    } catch (_) { /* 落到本地版 */ }
  }

  // 本地兜底（离线可用）
  const due = dueList().length;
  const weak = catMastery().sort((a, b) => a.pct - b.pct).slice(0, 2);
  const streak = streakDays();
  const mocks = S.sessions.filter((s) => s.kind === 'mock' && s.score != null);
  saveBrief({
    date: today, kind: 'local',
    text: `## 昨日回顾\n连续打卡 **${streak} 天**${mocks.length ? `，最近一场模拟面试 ${mocks[0].score} 分` : ''}，当前待复习 ${due} 题。\n## 今日重点\n- 优先攻克薄弱分类：${weak.map((c) => `**${c.name}**（${c.pct}%）`).join('、')}\n- 完成每日挑战保持手感\n- ${due ? `清空 ${due} 道到期复习题` : '用「提前学新题」开一组闪卡'}\n## 一句加油\n数据不会说谎，今天的每一张卡片都在拉高你的雷达图。`,
  });
  return S.dailyBrief;
}

export function renderBrief() {
  const b = S.dailyBrief;
  const card = $('#dash-brief-card');
  if (!b || !card) return;
  card.classList.remove('hidden');
  $('#brief-kind').textContent = BRIEF_KIND[b.kind] || b.kind;
  $('#dash-brief').innerHTML = md(b.text);
}

export function render() {
  const hour = new Date().getHours();
  const hello = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  $('#dash-hello').textContent = `${hello}，候选人 👋`;
  $('#dash-date').textContent = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  const streak = streakDays();
  const daysLeft = S.targetDate
    ? Math.ceil((new Date(S.targetDate + 'T23:59:59') - new Date()) / 86400000)
    : null;
  $('#dash-streak').innerHTML = `
    ${daysLeft != null ? `
      <div class="streak-flame" style="background:linear-gradient(135deg,#4f6bf0,#7c5cf5);box-shadow:0 4px 14px rgba(79,107,240,.45)">
        ${daysLeft >= 0 ? daysLeft : '⏰'}
      </div>
      <div>
        <div class="streak-num">${daysLeft >= 0 ? daysLeft + ' 天' : '已过期'}</div>
        <div class="streak-label">距目标面试（${S.targetDate}）</div>
      </div>
      <div style="width:1px;height:34px;background:var(--line);margin:0 4px"></div>` : ''}
    <div class="streak-flame">${icon('flame', 22)}</div>
    <div>
      <div class="streak-num">${streak} 天</div>
      <div class="streak-label">连续练习</div>
    </div>`;

  const due = dueList().length;
  const ms = masteryStats();
  const mocks = S.sessions.filter((s) => s.kind === 'mock');
  const avg = mocks.length && mocks.some((m) => m.score != null)
    ? Math.round(mocks.filter((m) => m.score != null).reduce((a, m) => a + m.score, 0) / mocks.filter((m) => m.score != null).length)
    : null;

  $('#dash-tiles').innerHTML = `
    <div class="tile clickable" data-goto="review">
      <div class="tile-ico warn">${icon('repeat', 20)}</div>
      <div><div class="tile-num" data-count="${due}">0</div><div class="tile-label">今日待复习</div></div>
    </div>
    <div class="tile clickable" data-goto="bank">
      <div class="tile-ico">${donutHtml()}</div>
      <div><div class="tile-num" data-count="${ms.pct}" data-suffix="%">0%</div><div class="tile-label">题库掌握率（${ms.mastered}/${ms.total}）</div></div>
    </div>
    <div class="tile clickable" data-goto="jobs">
      <div class="tile-ico gold">${icon('radar', 20)}</div>
      <div><div class="tile-num" id="d-tile-jobs">…</div><div class="tile-label">岗位雷达新岗位</div></div>
    </div>
    <div class="tile clickable" data-goto="knowledge">
      <div class="tile-ico ok">${icon('brain', 20)}</div>
      <div><div class="tile-num" data-count="${S.knowledge.length}">0</div><div class="tile-label">知识库条目</div></div>
    </div>
    <div class="tile clickable" data-goto="history">
      <div class="tile-ico">${icon('mic', 20)}</div>
      <div><div class="tile-num" data-count="${mocks.length}">0${avg != null ? ` <small style="font-size:13px;color:var(--muted)">均分 ${avg}</small>` : ''}</div><div class="tile-label">模拟面试场次</div></div>
    </div>
    <div class="tile clickable" id="d-tile-xp">
      <div class="tile-ico gold">${levelInfo(S.gamify.xp).icon}</div>
      <div><div class="tile-num">Lv.${levelInfo(S.gamify.xp).level}</div><div class="tile-label">${levelInfo(S.gamify.xp).title} · ${S.gamify.xp} XP</div></div>
    </div>`;

  $$('[data-count]', $('#dash-tiles')).forEach((el) =>
    animateNum(el, Number(el.dataset.count), { suffix: el.dataset.suffix || '' }));
  staggerIn($('#dash-tiles'), '.tile', 60);

  // 岗位雷达未读数异步填充
  fetch('/api/jobs?limit=1').then((r) => r.json()).then((j) => {
    const el = document.getElementById('d-tile-jobs');
    if (el) animateNum(el, j.newCount ?? 0);
  }).catch(() => {
    const el = document.getElementById('d-tile-jobs');
    if (el) el.textContent = '—';
  });

  $$('[data-goto]', $('#dash-tiles')).forEach((t) => {
    t.onclick = () => switchView(t.dataset.goto);
  });
  // donut 在 innerHTML 之后绘制
  const donutCv = $('#dash-tiles canvas');
  if (donutCv) donutChart(donutCv, ms.pct, { size: 38 });

  // 雷达
  const cats = catMastery();
  const shortName = (n) => n.length > 6 ? n.slice(0, 5) + '…' : n;
  radarChart($('#dash-radar'), cats.map((c) => shortName(c.name)), cats.map((c) => c.pct));
  $('#dash-radar-note').textContent = cats.length
    ? `覆盖 ${cats.length} 个分类；数值 = 该分类中已掌握题目的占比。`
    : '题库加载中…';

  // 趋势
  const scored = S.sessions
    .filter((s) => s.kind === 'mock' && s.score != null)
    .slice(0, 12)
    .reverse();
  lineChart($('#dash-trend'), scored.map((s) => ({
    label: new Date(s.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
    value: s.score,
  })));
  $('#dash-trend-note').textContent = scored.length >= 2
    ? `最近 ${scored.length} 场，最新 ${scored[scored.length - 1].score} 分。`
    : '完成 2 场以上模拟面试后展示趋势线。';

  // 热力
  const heat = heatLevels(14);
  $('#dash-heat').innerHTML = heat.map((d) =>
    `<div class="heat-cell" data-l="${d.lvl}" title="${d.date} · 练习 ${d.n} 次">${d.date.slice(8)}</div>`
  ).join('');
  const total14 = heat.reduce((a, d) => a + d.n, 0);
  $('#dash-heat-note').textContent = total14
    ? `14 天累计练习 ${total14} 次。`
    : '开始你的第一次练习，点亮热力格。';

  renderLevelChip();
  renderAchievements(document.getElementById('dash-achieve'));
  renderYearHeat();
  renderForecast();

  // 每日挑战
  const dq = dailyQuestion();
  const done = isDailyDone();
  $('#dash-daily').innerHTML = !dq ? '<p class="hint">题库为空</p>' : `
    <div class="daily-q">${esc(dq.q)}</div>
    ${done
      ? `<div class="daily-done">${icon('check')} 今日已完成挑战，明天再来！</div>`
      : `<div class="actions" style="margin-top:6px">
           <button class="btn primary" id="dash-daily-btn">${icon('zap')}开始挑战</button>
           <span class="hint" style="margin:0">每天一道确定性选题，保持手感</span>
         </div>`}`;
  const dailyBtn = $('#dash-daily-btn');
  if (dailyBtn) dailyBtn.onclick = () => startFlashcards([dq], { source: 'daily', title: '今日挑战', onFinish: () => render() });

  // 分类进度
  $('#dash-cats').innerHTML = cats.map((c) => `
    <div class="cat-row">
      <span>${esc(c.name)}</span>
      <div class="bar"><i class="${c.pct >= 80 ? 'ok' : c.pct > 0 ? '' : ''}" style="width:${Math.max(c.pct, 2)}%"></i></div>
      <span class="val"><b>${c.mastered}</b>/${c.total}</span>
    </div>`).join('');
}

function donutHtml() {
  return '<canvas class="tile-donut"></canvas>';
}

/* ---------- 年度热力图（GitHub 贡献图风格，26 周，列对齐到周一） ---------- */
function renderYearHeat() {
  const box = document.getElementById('dash-year-heat');
  if (!box) return;
  const weeks = 26;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7; // 0 = 周一
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - dow);
  const start = new Date(thisMonday);
  start.setDate(thisMonday.getDate() - (weeks - 1) * 7);

  const cells = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setDate(start.getDate() + w * 7 + d);
      const future = day > today;
      const n = future ? 0 : (S.activity[dateKey(day)] || 0);
      const lvl = n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 10 ? 3 : 4;
      cells.push(`<div class="yh-cell${future ? ' future' : ''}" data-l="${lvl}" title="${dateKey(day)} · ${n} 次"></div>`);
    }
  }
  const total = Object.values(S.activity).reduce((a, b) => a + b, 0);
  box.innerHTML = `<div class="yh-grid">${cells.join('')}</div>
    <p class="hint">最近 26 周 · 累计练习 ${total} 次${total === 0 ? '——点亮第一格吧' : ''}</p>`;
}

/* ---------- 未来 7 天复习量预测 ---------- */
function renderForecast() {
  const box = document.getElementById('dash-forecast');
  if (!box) return;
  const DAY = 24 * 3600 * 1000;
  const now = Date.now();
  const buckets = new Array(7).fill(0);
  let overdue = 0;
  for (const c of Object.values(S.srs)) {
    if (c.box >= 4 || !c.due) continue;
    if (c.due <= now) { overdue += 1; buckets[0] += 1; continue; }
    const diff = Math.floor((c.due - now) / DAY);
    if (diff < 7) buckets[diff + 1] += 1;
  }
  const max = Math.max(...buckets, 1);
  const labels = ['今天', '+1', '+2', '+3', '+4', '+5', '+6'];
  box.innerHTML = `
    <div class="fc-forecast">
      ${buckets.map((n, i) => `
        <div class="fcf-col" title="${labels[i]}：${n} 题">
          <div class="fcf-bar" style="height:${Math.max((n / max) * 96, 4)}px"><span>${n || ''}</span></div>
          <em>${labels[i]}</em>
        </div>`).join('')}
    </div>
    <p class="hint">${overdue ? `已有 <b>${overdue}</b> 题到期，先清掉今天的存量。` : '复习节奏平稳，按计划推进即可。'}</p>`;
}
