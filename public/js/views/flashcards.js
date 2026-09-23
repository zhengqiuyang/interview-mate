/* 闪卡引擎：复习 / 组卷刷题 / 每日挑战 共用的全屏翻转卡片流程 */
import { $, $$, esc, md, icon, toast, confetti } from '../core.js';
import { S } from '../state.js';
import { grade, markDailyDone } from '../srs.js';
import { awardXP } from '../gamify.js';

/* ---------- Cloze 填空：遮住答案中的关键术语，主动回忆再翻面 ---------- */

const CLOZE_STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'not', 'all', 'and', 'are', 'was', 'you', 'can', 'use', 'has', 'have', 'will', 'from', 'they', 'its', 'into', 'when', 'each', '像', '如']);

function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toCloze(text) {
  const terms = [];
  // 优先遮加粗段（**…**）
  for (const m of text.matchAll(/\*\*([^*\n]{2,16})\*\*/g)) terms.push(m[1]);
  // 再遮技术词（英文术语）
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9+#.-]{2,14}/g)) {
    const t = m[0];
    if (!CLOZE_STOP.has(t.toLowerCase()) && !/^[A-Z]\.$/.test(t)) terms.push(t);
  }
  let out = text;
  let n = 0;
  const used = new Set();
  for (const t of terms) {
    if (n >= 5) break;
    const key = t.toLowerCase();
    if (used.has(key)) continue;
    const re = new RegExp(escapeReg(t), 'g');
    if (!re.test(out)) continue;
    out = out.replace(re, '▁'.repeat(Math.min(Math.max(t.length, 3), 10)));
    used.add(key);
    n += 1;
  }
  return n >= 2 ? out : null;
}

/**
 * @param {Array} questions 题目对象数组 {id, q, a, cat, ...}
 * @param {Object} opts {source:'review'|'quiz'|'daily', title:'…'}
 */
export function startFlashcards(questions, opts = {}) {
  if (!questions.length) { toast('没有可用的题目'); return; }
  const root = $('#fc-root');
  const title = opts.title || '闪卡练习';
  let idx = 0;
  let flipped = false;
  let timerId = null;
  const summary = { again: 0, hard: 0, good: 0 };

  root.innerHTML = `
    <div class="fc-overlay">
      <div class="fc-top">
        <div class="fc-title"><span class="ico">${icon('cards')}</span>${esc(title)}</div>
        <div class="fc-progress-wrap">
          <span><b id="fc-idx">1</b> / ${questions.length}</span>
          <div class="bar" style="flex:1"><i id="fc-bar" style="width:${100 / questions.length}%"></i></div>
        </div>
        <button class="btn small ghost" id="fc-close">${icon('x')}退出</button>
      </div>
      <div class="fc-main" id="fc-main"></div>
      <div class="fc-grades" id="fc-grades"></div>
    </div>`;

  const close = () => {
    document.removeEventListener('keydown', onKey);
    clearInterval(timerId);
    root.innerHTML = '';
    if (opts.onExit) opts.onExit();
  };
  $('#fc-close').onclick = close;

  function renderCard() {
    const q = questions[idx];
    flipped = false;
    clearInterval(timerId);
    const note = S.notes[q.id];
    $('#fc-idx').textContent = idx + 1;
    $('#fc-bar').style.width = `${((idx + 1) / questions.length) * 100}%`;
    const clozeText = opts.cloze ? toCloze(q.a) : null;
    $('#fc-main').innerHTML = `
      <div class="fc-scene" id="fc-scene">
        <div class="fc-card" id="fc-card">
          <div class="fc-face front">
            <span class="fc-label">${opts.cloze && clozeText ? '填空模式' : '题目'} · ${esc(catName(q))}${opts.timed ? ' · 限时口述' : ''}</span>
            <div class="fc-q">${esc(q.q)}</div>
            ${clozeText ? `
              <div class="fc-cloze">
                <div class="fc-label" style="font-size:11px">把 ▁ 处补全，出声作答</div>
                <div class="md">${md(clozeText)}</div>
              </div>` : ''}
            ${note ? `<div class="q-note"><b>我的笔记</b>${md(note)}</div>` : ''}
            ${opts.timed ? `
              <div class="fc-timer">
                <div class="bar" style="flex:1"><i id="fc-timer-bar" style="width:100%;transition:width 1s linear"></i></div>
                <b id="fc-timer-num" style="min-width:34px;text-align:right">60</b>
              </div>` : ''}
            <div class="fc-hint">${icon('rotate')} ${opts.timed ? '限时 60 秒，时间到自动翻面；也可' : ''}点击卡片或按 <kbd>空格</kbd> 翻面看参考答案</div>
          </div>
          <div class="fc-face back">
            <span class="fc-label">参考答案</span>
            <div class="fc-a md">${md(q.a)}</div>
            <div class="fc-hint">按 <kbd>1</kbd> 不会 · <kbd>2</kbd> 模糊 · <kbd>3</kbd> 掌握</div>
          </div>
        </div>
      </div>`;
    $('#fc-grades').innerHTML = `
      <button class="btn fc-grade again" data-g="0" disabled>不会<small>10 分钟后再见</small></button>
      <button class="btn fc-grade hard" data-g="1" disabled>模糊<small>明天继续</small></button>
      <button class="btn fc-grade good" data-g="2" disabled>掌握<small>间隔拉长</small></button>`;
    $('#fc-scene').onclick = flip;
    $$('.fc-grade').forEach((b) => { b.onclick = () => doGrade(Number(b.dataset.g)); });

    // 限时口述：60 秒倒数，到点自动翻面
    if (opts.timed) {
      let left = 60;
      const numEl = () => $('#fc-timer-num');
      const barEl = () => $('#fc-timer-bar');
      timerId = setInterval(() => {
        left -= 1;
        if (numEl()) numEl().textContent = String(Math.max(left, 0));
        if (barEl()) barEl().style.width = `${Math.max(left, 0) / 60 * 100}%`;
        if (left <= 0) {
          clearInterval(timerId);
          if (!flipped) { flip(); toast('⏱ 时间到——看看你漏了什么'); }
        }
      }, 1000);
    }
  }

  function catName(q) {
    return S.categories.find((c) => c.key === q.cat)?.name || '题目';
  }

  function flip() {
    if (flipped) return;
    flipped = true;
    $('#fc-card').classList.add('flipped');
    $$('.fc-grade').forEach((b) => { b.disabled = false; });
  }

  function doGrade(g) {
    if (!flipped) { flip(); return; }
    const q = questions[idx];
    grade(q.id, g);
    awardXP(g === 2 ? 5 : g === 1 ? 3 : 2);
    if (g === 0) summary.again += 1;
    else if (g === 1) summary.hard += 1;
    else summary.good += 1;
    if (opts.source === 'daily') { markDailyDone(q.id); awardXP(15, '完成每日挑战'); }
    if (idx + 1 >= questions.length) renderSummary();
    else { idx += 1; renderCard(); }
  }

  function renderSummary() {
    const total = summary.again + summary.hard + summary.good;
    const rate = total ? Math.round((summary.good / total) * 100) : 0;
    $('#fc-bar').style.width = '100%';
    if (rate >= 80 || (opts.source === 'daily' && summary.good > 0)) confetti();
    $('#fc-main').innerHTML = `
      <div class="fc-summary">
        <div style="font-size:44px">${rate >= 80 ? '🏆' : rate >= 50 ? '💪' : '🌱'}</div>
        <h2>本轮完成！掌握率 ${rate}%</h2>
        <div class="card" style="text-align:left">
          <div class="fc-sum-row"><span>✅ 掌握</span><b style="color:var(--ok)">${summary.good} 题</b></div>
          <div class="fc-sum-row"><span>🤔 模糊</span><b style="color:var(--warn)">${summary.hard} 题</b></div>
          <div class="fc-sum-row"><span>❌ 不会</span><b style="color:var(--danger)">${summary.again} 题</b></div>
        </div>
        <p class="hint" style="text-align:center">「不会」的题已进入今日复习队列，记忆曲线会安排回炉。</p>
        <div class="actions" style="justify-content:center">
          <button class="btn primary" id="fc-again">${icon('repeat')}再练「不会」的题</button>
          <button class="btn ghost" id="fc-done">完成</button>
        </div>
      </div>`;
    $('#fc-grades').innerHTML = '';
    $('#fc-done').onclick = close;
    $('#fc-again').onclick = () => {
      const againQs = questions.filter((q, i) => {
        // 本轮中被评为「不会」的：直接按 summary 无法区分，重新查询 box==0 且刚评过的
        const c = S.srs[q.id];
        return c && c.box === 0 && c.last > Date.now() - 30 * 60 * 1000;
      });
      if (!againQs.length) { toast('本轮没有标记为「不会」的题目'); return; }
      startFlashcards(againQs, { ...opts, title: '错题回炉' });
    };
    if (opts.onFinish) opts.onFinish(summary);
  }

  function onKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); if (!flipped) flip(); }
    else if (e.key === 'Escape') close();
    else if (flipped && ['1', '2', '3'].includes(e.key)) doGrade(Number(e.key) - 1);
  }
  document.addEventListener('keydown', onKey);

  renderCard();
}
