/* InterviewMate 主入口：路由 / 命令面板 / 快捷键 / 初始化 */
import { $, $$, esc, icon, toast, hydrateIcons, applyTheme, openModal, store } from './core.js';
import { S, initMigrations } from './state.js';
import { checkHealth, loadBank, hasKey } from './api.js';
import { startFlashcards } from './views/flashcards.js';
import { VIEWS, switchView } from './router.js';

/* ---------------- 命令面板 ---------------- */
let paletteSel = 0;

function commands() {
  return [
    ...Object.entries(VIEWS).map(([key, v]) => ({
      name: `前往：${v.label}`, icon: v.icon, keys: v.keys,
      run: () => switchView(key),
    })),
    {
      name: '开始一场模拟面试', icon: 'play', keys: ['mock', 'start', '面试'],
      run: () => { switchView('mock'); setTimeout(() => $('#btn-start-mock').click(), 150); },
    },
    {
      name: '开始到期复习', icon: 'repeat', keys: ['review', '复习'],
      run: () => {
        import('./srs.js').then(({ dueList }) => {
          const qs = dueList().map((id) => S.questions.find((q) => q.id === id)).filter(Boolean);
          if (!qs.length) { toast('当前没有到期卡片'); return; }
          startFlashcards(qs, { source: 'review', title: '到期复习' });
        });
      },
    },
    {
      name: '组卷刷题（10 题）', icon: 'cards', keys: ['quiz', '刷题'],
      run: () => { switchView('bank'); setTimeout(() => $('#btn-quiz').click(), 150); },
    },
    {
      name: '切换深色 / 浅色主题', icon: 'moon', keys: ['theme', 'dark', '主题', '深色'],
      run: toggleTheme,
    },
    {
      name: '导出全量数据备份', icon: 'download', keys: ['backup', 'export', '备份', '导出'],
      run: () => { switchView('settings'); setTimeout(() => $('#btn-export-data').click(), 150); },
    },
    {
      name: '导入自定义题目', icon: 'package', keys: ['import', 'custom', '导入', '自定义'],
      run: () => { switchView('settings'); setTimeout(() => $('#btn-import-questions').click(), 150); },
    },
    {
      name: '全局搜索（题库/知识库/笔记）', icon: 'search', keys: ['search', 'sousuo', '搜索', '查找'],
      run: openGlobalSearch,
    },
    {
      name: '键盘快捷键说明', icon: 'keyboard', keys: ['shortcuts', 'help', '快捷键'],
      run: showShortcuts,
    },
  ];
}

function openPalette() {
  const root = $('#palette-root');
  root.innerHTML = `
    <div class="palette-mask">
      <div class="palette">
        <div class="palette-input-wrap">
          <span class="ico">${icon('command')}</span>
          <input id="palette-input" placeholder="输入命令，如「复习」「dark」「导出」…">
          <kbd>Esc</kbd>
        </div>
        <div class="palette-list" id="palette-list"></div>
      </div>
    </div>`;
  const input = $('#palette-input');
  input.focus();
  paletteSel = 0;

  const close = () => { root.innerHTML = ''; };
  $('.palette-mask', root).addEventListener('click', (e) => { if (e.target === e.currentTarget) close(); });

  function renderList(kw) {
    const all = commands();
    const k = kw.trim().toLowerCase();
    const items = !k ? all : all.filter((c) =>
      c.name.toLowerCase().includes(k) || (c.keys || []).some((x) => x.toLowerCase().includes(k)));
    if (paletteSel >= items.length) paletteSel = Math.max(0, items.length - 1);
    const list = $('#palette-list');
    list.innerHTML = items.length ? items.map((c, i) => `
      <div class="palette-item ${i === paletteSel ? 'sel' : ''}" data-i="${i}">
        <span class="ico">${icon(c.icon)}</span><span>${esc(c.name)}</span>
      </div>`).join('')
      : '<div class="palette-empty">没有匹配的命令</div>';
    $$('.palette-item', list).forEach((el) => {
      el.onclick = () => { const c = items[Number(el.dataset.i)]; close(); c.run(); };
    });
    list._items = items;
  }
  input.addEventListener('input', () => { paletteSel = 0; renderList(input.value); });
  input.addEventListener('keydown', (e) => {
    const items = $('#palette-list')._items || [];
    if (e.key === 'Escape') { close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); paletteSel = Math.min(paletteSel + 1, items.length - 1); renderList(input.value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteSel = Math.max(paletteSel - 1, 0); renderList(input.value); }
    else if (e.key === 'Enter') {
      const c = items[paletteSel];
      if (c) { close(); c.run(); }
    }
  });
  renderList('');
}

/* ---------------- 全局搜索（题库 / 知识库 / 笔记） ---------------- */
function openGlobalSearch() {
  const m = openModal(`
    <div class="search-wrap" style="max-width:none">
      <span class="ico">${icon('search')}</span>
      <input id="gs-input" placeholder="搜索题目、知识、笔记…">
    </div>
    <div id="gs-result" style="margin-top:14px;max-height:52vh;overflow-y:auto"></div>`,
    { title: '全局搜索', icon: 'search', width: 680 });
  const input = $('#gs-input', m.el);
  input.focus();

  const renderResults = (kw) => {
    const box = $('#gs-result', m.el);
    const k = kw.trim().toLowerCase();
    if (!k) { box.innerHTML = '<p class="hint" style="text-align:center">输入关键词，同时检索题库、知识库与题目笔记</p>'; return; }
    const qs = S.questions.filter((q) => `${q.q} ${q.a} ${(q.tags || []).join(' ')}`.toLowerCase().includes(k)).slice(0, 8);
    const kn = S.knowledge.filter((x) => `${x.title} ${x.content}`.toLowerCase().includes(k)).slice(0, 6);
    const notes = Object.entries(S.notes)
      .filter(([qid, n]) => n.toLowerCase().includes(k))
      .map(([qid, n]) => S.questions.find((q) => q.id === qid))
      .filter(Boolean)
      .slice(0, 5);
    if (!qs.length && !kn.length && !notes.length) {
      box.innerHTML = '<p class="hint" style="text-align:center">没有匹配结果</p>';
      return;
    }
    box.innerHTML = `
      ${qs.length ? `<div class="gs-group">📚 题库</div>${qs.map((q) => `
        <div class="palette-item gs-item" data-q="${esc(q.id)}">
          <span class="ico">${icon('book')}</span><span>${esc(q.q.slice(0, 60))}</span>
        </div>`).join('')}` : ''}
      ${kn.length ? `<div class="gs-group">🧠 知识库</div>${kn.map((x) => `
        <div class="palette-item gs-item" data-k="${esc(x.id)}">
          <span class="ico">${icon('brain')}</span><span>${esc(x.title.slice(0, 60))}</span>
        </div>`).join('')}` : ''}
      ${notes.length ? `<div class="gs-group">📝 带笔记的题目</div>${notes.map((q) => `
        <div class="palette-item gs-item" data-q="${esc(q.id)}">
          <span class="ico">${icon('note')}</span><span>${esc(q.q.slice(0, 60))}</span>
        </div>`).join('')}` : ''}`;
    $$('.gs-item', box).forEach((el) => {
      el.onclick = async () => {
        m.close();
        if (el.dataset.q) {
          switchView('bank');
          const bankMod = await import('./views/bank.js');
          bankMod.openQuestion(el.dataset.q);
        } else if (el.dataset.k) {
          switchView('knowledge');
          const knMod = await import('./views/knowledge.js');
          knMod.openEntry(el.dataset.k);
        }
      };
    });
  };
  input.addEventListener('input', () => renderResults(input.value));
  renderResults('');
}

/* ---------------- 新手引导 ---------------- */

const ONBOARD_STEPS = [
  {
    icon: '🎯', title: '欢迎来到 InterviewMate',
    body: `这不只是又一个题库——这是一套 <b>AI Agent 驱动的求职训练系统</b>：<br>
    · 🎙️ AI 面试官逐题追问并打分（含四轮闯关、语音整场）<br>
    · 🔁 间隔重复算法决定你「什么时候再复习什么」<br>
    · 🤖 智能体教练能调用工具读写你的真实数据，直接给你建题、排计划<br>
    · 📡 岗位雷达自动汇集机会，简历工坊结构化诊断`,
  },
  {
    icon: '🚀', title: '三步上手',
    body: `1️⃣ <b>设置 → 填 API Key</b>（推荐智谱 GLM，注册即送免费额度；不填也能离线刷题库）<br>
    2️⃣ <b>题库 / 复习中心</b> 用闪卡刷几道题，数据看板开始出现你的雷达图<br>
    3️⃣ <b>模拟面试</b> 来一场（或智能体教练 → 任务卡「弱项体检」），拿到第一份评估报告`,
  },
  {
    icon: '⌨️', title: '高手都在用键盘',
    body: `<kbd>Ctrl+K</kbd> 命令面板　<kbd>1-9</kbd> 切换页面　<kbd>/</kbd> 搜题<br>
    闪卡里 <kbd>空格</kbd> 翻面、<kbd>1/2/3</kbd> 评分<br><br>
    所有数据只存你的浏览器，随时在设置里导出备份。祝早日拿到 offer 🎉`,
  },
];

function showOnboarding() {
  let i = 0;
  const render = () => {
    const s = ONBOARD_STEPS[i];
    const m = openModal(`
      <div style="text-align:center;padding:6px 4px">
        <div style="font-size:46px;animation:emptyFloat 3s ease-in-out infinite">${s.icon}</div>
        <h2 style="margin:10px 0 14px">${s.title}</h2>
        <div style="text-align:left;font-size:14px;line-height:2">${s.body}</div>
        <div style="display:flex;gap:6px;justify-content:center;margin:18px 0 4px">
          ${ONBOARD_STEPS.map((_, j) => `<span class="dot" style="background:${j === i ? 'var(--brand)' : 'var(--chart-grid)'};animation:none"></span>`).join('')}
        </div>
      </div>
      <div class="actions" style="justify-content:center">
        ${i > 0 ? '<button class="btn ghost" id="ob-prev">上一步</button>' : ''}
        <button class="btn primary" id="ob-next">${i === ONBOARD_STEPS.length - 1 ? '开始使用 🚀' : '下一步'}</button>
      </div>`, { width: 560 });
    $('#ob-prev', m.el)?.addEventListener('click', () => { i -= 1; m.close(); render(); });
    $('#ob-next', m.el).addEventListener('click', () => {
      if (i === ONBOARD_STEPS.length - 1) { m.close(); return; }
      i += 1;
      m.close();
      render();
    });
  };
  render();
}

/* ---------------- 快捷键 ---------------- */
function showShortcuts() {
  openModal(`
    <table style="width:100%;font-size:14px;border-collapse:collapse">
      ${[
        ['<kbd>Ctrl</kbd> + <kbd>K</kbd>', '打开命令面板'],
        ['<kbd>1</kbd> … <kbd>9</kbd> / <kbd>0</kbd>', '切换十个页面'],
        ['<kbd>/</kbd>', '聚焦题库搜索框'],
        ['<kbd>?</kbd>', '显示本帮助'],
        ['<kbd>Esc</kbd>', '关闭弹窗 / 闪卡'],
        ['闪卡中 <kbd>空格</kbd>', '翻转卡片'],
        ['闪卡中 <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd>', '评分：不会 / 模糊 / 掌握'],
        ['对话中 <kbd>Enter</kbd>', '发送（Shift+Enter 换行）'],
      ].map(([k, v]) => `<tr><td style="padding:7px 4px;white-space:nowrap">${k}</td><td style="padding:7px 4px;color:var(--muted)">${v}</td></tr>`).join('')}
    </table>`, { title: '键盘快捷键', icon: 'keyboard', width: 480 });
}

function toggleTheme() {
  const cur = document.documentElement.dataset.theme;
  S.theme = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem('im_theme', JSON.stringify(S.theme));
  applyTheme(S.theme);
  $$('#theme-choice button').forEach((b) => b.classList.toggle('active', b.dataset.themeVal === S.theme));
  window.dispatchEvent(new CustomEvent('themechange'));
  toast(`已切换到${S.theme === 'dark' ? '深色' : '浅色'}主题`, 'ok');
}

function onGlobalKey(e) {
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
    return;
  }
  if (typing) return;
  if (e.key === '?') { e.preventDefault(); showShortcuts(); }
  else if (e.key === '/') {
    e.preventDefault();
    switchView('bank');
    setTimeout(() => $('#bank-search').focus(), 100);
  } else if (/^[0-9]$/.test(e.key)) {
    const names = Object.keys(VIEWS);
    const idx = e.key === '0' ? 9 : Number(e.key) - 1;
    const target = names[idx];
    if (target) switchView(target);
  }
}

/* ---------------- 初始化 ---------------- */
function reportFatal(msg) {
  const el = document.getElementById('fatal-error');
  if (el) {
    el.textContent = '应用初始化出错：' + msg;
    el.classList.remove('hidden');
  }
  console.error('[InterviewMate]', msg);
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => reportFatal(e.message));
  window.addEventListener('unhandledrejection', (e) => reportFatal(e.reason?.message || String(e.reason)));
}

async function init() {
  initMigrations();
  hydrateIcons();
  applyTheme(S.theme);

  // 跟随系统主题变化
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (S.theme === 'auto') applyTheme('auto');
    });
  }
  // 主题切换后重绘当前视图图表
  window.addEventListener('themechange', () => VIEWS[S.view]?.mod.onShow());

  $$('.nav-item').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#palette-btn').addEventListener('click', openPalette);
  document.addEventListener('keydown', onGlobalKey);
  // 新手引导（首次使用且无学习数据时弹出；设置页可重看）
  window.addEventListener('im:show-onboarding', showOnboarding);
  if (!store.get('im_onboarded', false)) {
    const hasData = S.sessions.length || Object.keys(S.srs).length;
    if (!hasData) {
      showOnboarding();
    }
    store.set('im_onboarded', true);
  }

  // PWA：注册 Service Worker（静态缓存，离线可用）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 本地 http 或隐私模式，忽略 */ });
  }

  // 各视图绑定事件
  for (const v of Object.values(VIEWS)) v.mod.init();

  // 健康检查（决定无 Key 横幅与设置页提示）
  checkHealth().then((j) => {
    $('#mock-nokey').classList.toggle('hidden', hasKey());
    if (j && j.serverKeyConfigured) {
      $('#settings-envhint').textContent = '检测到服务端已通过 .env 配置密钥（页面可不填 Key，页面配置优先生效）。';
    }
  });

  // 加载题库后进入看板
  try {
    const builtin = await loadBank();
    const { mergeBank } = await import('./state.js');
    mergeBank(builtin);
  } catch (e) {
    toast('题库加载失败：' + e.message, 'err');
  }
  switchView('dashboard');
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init().catch((e) => reportFatal(e.message)));
  } else {
    init().catch((e) => reportFatal(e.message));
  }
}
