/* 复习中心：间隔重复队列 + 每日挑战 */
import { $, $$, esc, icon } from '../core.js';
import { S } from '../state.js';
import { dueList, learningList, freshList, masteryStats, streakDays, dailyQuestion, isDailyDone, wrongList } from '../srs.js';
import { startFlashcards } from './flashcards.js';

export function init() { /* 静态骨架 */ }

export function onShow() { render(); }

function qById(id) { return S.questions.find((q) => q.id === id); }
function catName(q) { return S.categories.find((c) => c.key === q.cat)?.name || ''; }

function render() {
  const due = dueList();
  const learning = learningList();
  const ms = masteryStats();
  const streak = streakDays();

  $('#rev-tiles').innerHTML = `
    <div class="tile clickable" id="rev-t-due">
      <div class="tile-ico warn">${icon('clock', 20)}</div>
      <div><div class="tile-num">${due.length}</div><div class="tile-label">待复习（已到期）</div></div>
    </div>
    <div class="tile">
      <div class="tile-ico">${icon('brain', 20)}</div>
      <div><div class="tile-num">${learning.length}</div><div class="tile-label">学习中（未巩固）</div></div>
    </div>
    <div class="tile">
      <div class="tile-ico ok">${icon('check', 20)}</div>
      <div><div class="tile-num">${ms.mastered}<small style="font-size:13px;color:var(--muted)"> / ${ms.total}</small></div><div class="tile-label">已掌握题目</div></div>
    </div>
    <div class="tile">
      <div class="tile-ico gold">${icon('flame', 20)}</div>
      <div><div class="tile-num">${streak} 天</div><div class="tile-label">连续打卡</div></div>
    </div>`;
  $('#rev-t-due').onclick = startReview;

  // 每日挑战
  const dq = dailyQuestion();
  const done = isDailyDone();
  $('#rev-daily').innerHTML = !dq ? '<p class="hint">题库为空</p>' : `
    <div class="daily-q">${esc(dq.q)}</div>
    ${done
      ? `<div class="daily-done">${icon('check')} 今日已完成，明天见！</div>`
      : `<div class="actions" style="margin-top:6px"><button class="btn primary" id="rev-daily-btn">${icon('zap')}开始挑战</button></div>`}`;
  const btn = $('#rev-daily-btn');
  if (btn) btn.onclick = () => startFlashcards([dq], { source: 'daily', title: '今日挑战', onFinish: render });

  // 复习队列
  const preview = due.slice(0, 6).map(qById).filter(Boolean);
  // 错题本：挂过科且未掌握
  const wrong = wrongList().map(qById).filter(Boolean);
  const wrongHtml = wrong.length ? `
      ${wrong.slice(0, 6).map((q) => {
        const c = S.srs[q.id];
        return `<div class="fu-row"><span class="muted" style="width:52px">✕${c.lapses} 次</span><span style="flex:1">${esc(q.q.slice(0, 34))}${q.q.length > 34 ? '…' : ''}</span><span class="q-cat">${esc(catName(q))}</span></div>`;
      }).join('')}
      ${wrong.length > 6 ? `<p class="hint">…还有 ${wrong.length - 6} 道错题</p>` : ''}
      <div class="actions"><button class="btn primary" id="wrong-drill">${icon('zap')}错题重练（${wrong.length}）</button></div>`
    : '<p class="hint">没有错题记录。评「不会」的题会自动进入这里，挂科次数越多排越前。</p>';

  $('#rev-queue').innerHTML = `
    ${preview.length ? `
      <div class="recent-item" style="cursor:default">
        <div class="recent-ico">${icon('book', 15)}</div>
        <div class="recent-main">
          ${preview.map((q) => `<div style="padding:2px 0">· ${esc(q.q.length > 34 ? q.q.slice(0, 34) + '…' : q.q)} <span class="q-cat" style="margin-left:6px">${esc(catName(q))}</span></div>`).join('')}
        </div>
      </div>
      ${due.length > 6 ? `<p class="hint">…以及另外 ${due.length - 6} 题</p>` : ''}`
      : '<p class="hint">当前没有到期卡片。可以提前学习新题，或去题库标记收藏。</p>'}
    <div class="actions">
      <button class="btn primary" id="rev-start" ${due.length ? '' : 'disabled'}>${icon('play')}开始复习（${due.length}）</button>
      <button class="btn ghost" id="rev-fresh">${icon('plus')}提前学 10 道新题</button>
      <button class="btn ghost" id="rev-drill">${icon('zap')}限时闪卡挑战</button>
    </div>
    <h3 style="margin:16px 0 6px;font-size:14px">📕 错题本（${wrong.length}）</h3>
    ${wrongHtml}`;
  $('#wrong-drill')?.addEventListener('click', () => {
    startFlashcards(wrong, { source: 'review', title: '错题重练', onFinish: render });
  });
  $('#rev-start').onclick = startReview;
  $('#rev-fresh').onclick = () => {
    const ids = freshList(10);
    if (!ids.length) { alert('题库里的题都已加入学习，去复习吧！'); return; }
    startFlashcards(ids.map(qById).filter(Boolean), { source: 'review', title: '学习新题', onFinish: render });
  };
  $('#rev-drill').onclick = () => {
    const pool = [...S.questions].sort(() => Math.random() - 0.5).slice(0, 10);
    startFlashcards(pool, { source: 'quiz', title: '限时闪卡挑战', timed: true, onFinish: render });
  };
}

function startReview() {
  const ids = dueList();
  if (!ids.length) return;
  const qs = ids.map(qById).filter(Boolean);
  startFlashcards(qs, { source: 'review', title: '到期复习', onFinish: render });
}
