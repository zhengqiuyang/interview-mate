/* 题库练习：检索 / 收藏 / 笔记 / 掌握 / AI 追问 / 组卷刷题 */
import { $, $$, esc, md, icon, toast, openModal, debounce, downloadFile, staggerIn } from '../core.js';
import { S, persist } from '../state.js';
import { streamChat, hasKey } from '../api.js';
import { isMastered, nextReviewText } from '../srs.js';
import { switchView } from '../router.js';
import { startFlashcards } from './flashcards.js';

const store2 = (key, val) => persist(key);

export function init() {
  $('#bank-search').addEventListener('input', debounce((e) => {
    S.bankFilter.q = e.target.value;
    render();
  }, 200));
  $('#bank-diff').addEventListener('change', (e) => { S.bankFilter.diff = e.target.value; render(); });
  $('#bank-flag').addEventListener('change', (e) => { S.bankFilter.flag = e.target.value; render(); });
  $('#btn-quiz').addEventListener('click', openQuizDialog);
  $('#btn-export-bank')?.addEventListener('click', () => {
    downloadFile('interview-mate-题库.json', JSON.stringify({
      categories: S.categories,
      questions: S.questions.map(({ id, ...rest }) => (String(id).startsWith('custom-') ? rest : { id, ...rest })),
    }, null, 2), 'application/json');
    toast('题库已导出', 'ok');
  });
}

export function onShow() { render(); }

function catName(k) { return S.categories.find((c) => c.key === k)?.name || k; }

function filtered() {
  const f = S.bankFilter;
  const kw = f.q.trim().toLowerCase();
  return S.questions.filter((q) => {
    if (f.cat !== 'all' && q.cat !== f.cat) return false;
    if (f.diff !== 'all' && String(q.diff) !== f.diff) return false;
    if (f.flag === 'unmastered' && isMastered(q.id)) return false;
    if (f.flag === 'mastered' && !isMastered(q.id)) return false;
    if (f.flag === 'fav' && !S.favs.includes(q.id)) return false;
    if (f.flag === 'note' && !S.notes[q.id]) return false;
    if (kw) {
      const hay = `${q.q} ${q.a} ${(q.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

export function render() {
  if (!S.bankLoaded) return;
  const { questions } = S;

  // 分类 chips
  const chips = $('#bank-cats');
  chips.innerHTML = '';
  const mkChip = (key, name, count) => {
    const b = document.createElement('button');
    b.className = `chip${S.bankFilter.cat === key ? ' active' : ''}`;
    b.innerHTML = `${esc(name)}<b>${count}</b>`;
    b.onclick = () => { S.bankFilter.cat = key; render(); };
    chips.appendChild(b);
  };
  mkChip('all', '全部', questions.length);
  for (const c of S.categories) mkChip(c.key, c.name, questions.filter((q) => q.cat === c.key).length);

  const list = filtered();
  const masteredCount = questions.filter((q) => isMastered(q.id)).length;
  $('#bank-stats').innerHTML =
    `共 <b>${questions.length}</b> 题 · 已掌握 <b>${masteredCount}</b> · 收藏 <b>${S.favs.length}</b>` +
    (S.bankFilter.cat !== 'all' || S.bankFilter.diff !== 'all' || S.bankFilter.flag !== 'all' || S.bankFilter.q
      ? ` · 当前筛选 <b>${list.length}</b> 题` : '');

  const box = $('#bank-list');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<div class="empty"><div class="empty-ico">🔍</div>没有匹配的题目，换个关键词试试</div>';
    return;
  }
  for (const q of list) {
    const card = document.createElement('div');
    card.className = 'q-card';
    card.dataset.id = q.id;
    const isFav = S.favs.includes(q.id);
    const isDone = isMastered(q.id);
    const note = S.notes[q.id];
    const srsText = nextReviewText(q.id);
    card.innerHTML = `
      <div class="q-head">
        <div class="q-title"><span class="chev">▸</span>${esc(q.q)}</div>
        <div class="q-meta">
          <div class="q-actions">
            <button class="icon-btn sm note-b ${note ? 'on' : ''}" title="我的笔记">${icon('note', 16)}</button>
            <button class="icon-btn sm fav-b ${isFav ? 'on' : ''}" title="收藏">${isFav ? icon('star', 16) : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M11.5 3.2a.53.53 0 0 1 1 0l2.1 5.1 5.5.4a.53.53 0 0 1 .3 1l-4.2 3.6 1.3 5.4a.53.53 0 0 1-.8.6L12 16.8l-4.7 2.9a.53.53 0 0 1-.8-.6l1.3-5.4-4.2-3.6a.53.53 0 0 1 .3-1l5.5-.4Z"/></svg>`}</button>
            <button class="icon-btn sm done-b ${isDone ? 'on' : ''}" title="标记掌握">${icon(isDone ? 'check' : 'square', 16)}</button>
          </div>
          <span class="q-cat">${esc(catName(q.cat))}</span>
          <span class="q-diff">${'●'.repeat(q.diff)}${'○'.repeat(3 - q.diff)}</span>
        </div>
      </div>
      <div class="q-body">
        <div class="q-tags">${(q.tags || []).map((t) => `<span class="q-tag">#${esc(t)}</span>`).join('')}</div>
        ${note ? `<div class="q-note"><b>我的笔记　</b>${md(note)}</div>` : ''}
        <div class="md">${md(q.a)}</div>
        <div class="q-foot">
          <button class="btn small ghost ai-deep">${icon('sparkles', 14)}让 AI 追问这题</button>
          <button class="btn small ghost fc-one">${icon('cards', 14)}闪卡练这题</button>
          ${srsText ? `<span class="srs-info">${esc(srsText)}</span>` : ''}
        </div>
        ${relatedOf(q).length ? `
        <div class="q-related">
          <span class="muted" style="font-size:12px">相关题目：</span>
          ${relatedOf(q).map((r) => `<button class="chip" style="padding:2px 10px;font-size:12px" data-rel="${esc(r.id)}">${esc(r.q.slice(0, 22))}${r.q.length > 22 ? '…' : ''}</button>`).join('')}
        </div>` : ''}
      </div>`;
    $('.q-head', card).onclick = () => card.classList.toggle('open');
    $('.note-b', card).onclick = (e) => { e.stopPropagation(); openNoteModal(q, card); };
    $('.fav-b', card).onclick = (e) => {
      e.stopPropagation();
      const i = S.favs.indexOf(q.id);
      if (i >= 0) S.favs.splice(i, 1); else S.favs.push(q.id);
      store2('favs', S.favs);
      render();
    };
    $('.done-b', card).onclick = (e) => { e.stopPropagation(); toggleMastered(q.id); render(); };
    $('.ai-deep', card).onclick = (e) => { e.stopPropagation(); openDeepdive(q); };
    $('.fc-one', card).onclick = (e) => { e.stopPropagation(); startFlashcards([q], { source: 'review', title: '单题闪卡' }); };
    $$('[data-rel]', card).forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); openQuestion(b.dataset.rel); };
    });
    box.appendChild(card);
  }
  staggerIn(box, '.q-card');
}

/* 同分类同标签的相关题目推荐 */
function relatedOf(q, n = 3) {
  return S.questions
    .filter((x) => x.id !== q.id)
    .map((x) => ({
      q: x,
      score: (x.cat === q.cat ? 2 : 0) + (x.tags || []).filter((t) => (q.tags || []).includes(t)).length,
    }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.q);
}

function toggleMastered(qid) {
  if (isMastered(qid)) {
    const c = S.srs[qid];
    if (c) { c.box = Math.max(0, c.box - 3); }
  } else {
    S.srs[qid] = { box: 4, due: Date.now() + 21 * 24 * 3600 * 1000, reps: 1, lapses: 0, last: Date.now() };
  }
  persist('srs');
}

/* 供全局搜索跳转：清空筛选、渲染、展开并定位到指定题目 */
export function openQuestion(qid) {
  S.bankFilter = { cat: 'all', q: '', diff: 'all', flag: 'all' };
  render();
  const card = document.querySelector(`.q-card[data-id="${qid}"]`);
  if (!card) { toast('没有找到该题目，可能已被删除'); return; }
  card.classList.add('open');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ---------- 笔记 ---------- */
function openNoteModal(q, cardEl) {
  const m = openModal(`
    <label class="field">
      <span>「${esc(q.q.slice(0, 30))}…」的笔记</span>
      <textarea id="note-ta" rows="7" placeholder="记下你的理解、易错点、口诀、面试时的表达框架…（支持 **加粗**、- 列表）">${esc(S.notes[q.id] || '')}</textarea>
    </label>
    <div class="actions" style="justify-content:flex-end">
      <button class="btn ghost" id="note-del">删除笔记</button>
      <button class="btn primary" id="note-save">保存</button>
    </div>`, { title: '我的笔记', icon: 'note', width: 620 });
  $('#note-save', m.el).onclick = () => {
    const v = $('#note-ta', m.el).value.trim();
    if (v) S.notes[q.id] = v; else delete S.notes[q.id];
    store2('notes', S.notes);
    m.close();
    render();
    toast('笔记已保存', 'ok');
  };
  $('#note-del', m.el).onclick = () => {
    delete S.notes[q.id];
    store2('notes', S.notes);
    m.close();
    render();
  };
}

/* ---------- 组卷刷题 ---------- */
function openQuizDialog() {
  const list = filtered();
  const totalAll = S.questions.length;
  const m = openModal(`
    <label class="field">
      <span>出题范围</span>
      <select id="quiz-scope">
        <option value="filter" ${list.length ? '' : 'disabled'}>当前筛选结果（${list.length} 题）</option>
        <option value="all">全部题库（${totalAll} 题）</option>
        <option value="unmastered">只考未掌握（${totalAll - S.questions.filter((q) => isMastered(q.id)).length} 题）</option>
      </select>
    </label>
    <label class="field">
      <span>题目数量</span>
      <select id="quiz-count">
        <option value="5">5 题</option>
        <option value="10" selected>10 题</option>
        <option value="20">20 题</option>
      </select>
    </label>
    <div class="field">
      <span>训练模式</span>
      <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13.5px">
        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="quiz-cloze"> 填空模式（遮住关键术语）</label>
        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="quiz-timed"> 限时口述（60 秒/题）</label>
      </div>
    </div>
    <div class="actions" style="justify-content:flex-end">
      <button class="btn primary" id="quiz-start">${icon('play')}开始刷题</button>
    </div>
    <p class="hint">随机抽题、翻转卡片自评；评「不会/模糊」的题会自动进入复习计划。</p>`,
    { title: '组卷刷题', icon: 'cards', width: 520 });

  $('#quiz-start', m.el).onclick = () => {
    const scope = $('#quiz-scope', m.el).value;
    const count = Number($('#quiz-count', m.el).value);
    let pool = scope === 'all' ? S.questions
      : scope === 'unmastered' ? S.questions.filter((q) => !isMastered(q.id))
      : filtered();
    if (!pool.length) { toast('该范围内没有题目', 'err'); return; }
    // 洗牌抽题
    pool = [...pool];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const cloze = $('#quiz-cloze', m.el).checked;
    const timed = $('#quiz-timed', m.el).checked;
    m.close();
    startFlashcards(pool.slice(0, count), {
      source: 'quiz', title: '组卷刷题',
      cloze, timed,
    });
  };
}

/* ---------- AI 追问（深挖弹窗） ---------- */
function openDeepdive(q) {
  if (!hasKey()) {
    toast('请先在「设置」中配置 API Key', 'err');
    switchView('settings');
    return;
  }
  const m = openModal(`
    <div class="card" style="margin-bottom:14px;background:var(--card-2)">
      <div style="font-weight:600;margin-bottom:6px">${esc(q.q)}</div>
      <div class="md" style="font-size:13.5px;color:var(--muted)">${md(q.a)}</div>
    </div>
    <div class="dd-messages" style="display:flex;flex-direction:column;gap:12px;min-height:120px"></div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <textarea class="dd-input" rows="2" placeholder="输入你的回答，AI 面试官会继续追问…"></textarea>
      <button class="btn primary dd-send">${icon('send', 14)}回答</button>
    </div>`, { title: 'AI 追问训练', icon: 'sparkles' });

  const history = [];
  const ddBox = $('.dd-messages', m.el);
  const ddBubble = (role, text = '') => {
    const el = document.createElement('div');
    el.className = `msg ${role === 'user' ? 'user' : 'ai'}`;
    el.style.maxWidth = '100%';
    el.innerHTML = `<div class="avatar">${role === 'user' ? '🙋' : '🎙️'}</div><div class="bubble md"></div>`;
    $('.bubble', el).innerHTML = text ? md(text) : '<span class="typing"><i></i><i></i><i></i></span>';
    ddBox.appendChild(el);
    ddBox.scrollIntoView(false);
    return $('.bubble', el);
  };

  async function ddTurn() {
    const ta = $('.dd-input', m.el);
    const text = ta.value.trim();
    if (!text || $('.dd-send', m.el).disabled) return;
    ta.value = '';
    ddBubble('user', text);
    history.push({ role: 'user', content: text });
    const bubble = ddBubble('ai');
    $('.dd-send', m.el).disabled = true;
    let full = '';
    try {
      await streamChat(
        { mode: 'deepdive', question: q.q, answer: q.a, messages: history },
        (d) => { full += d; bubble.innerHTML = md(full); }
      );
      history.push({ role: 'assistant', content: full });
    } catch (e) {
      bubble.innerHTML = `<p style="color:var(--danger)">出错了：${esc(e.message)}</p>`;
    }
    $('.dd-send', m.el).disabled = false;
  }
  $('.dd-send', m.el).onclick = ddTurn;
  $('.dd-input', m.el).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ddTurn(); }
  });

  (async () => {
    const bubble = ddBubble('ai');
    let full = '';
    try {
      await streamChat(
        { mode: 'deepdive', question: q.q, answer: q.a, messages: [{ role: 'user', content: '请开始第一个追问。' }] },
        (d) => { full += d; bubble.innerHTML = md(full); }
      );
      history.push({ role: 'user', content: '请开始第一个追问。' }, { role: 'assistant', content: full });
    } catch (e) {
      bubble.innerHTML = `<p style="color:var(--danger)">出错了：${esc(e.message)}</p>`;
    }
    $('.dd-send', m.el).disabled = false;
  })();
}
