/* 核心工具：存储 / 转义 / Markdown / Toast / Modal / 主题 / 图标 / Canvas 图表 */

/* ---------- 本地存储（带内存回退，便于 Node 环境导入自检） ---------- */
const mem = {};
export const store = {
  get(key, fallback) {
    try {
      if (typeof localStorage === 'undefined') return mem[key] ?? fallback;
      const v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch (_) {
      return fallback;
    }
  },
  set(key, val) {
    mem[key] = val;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(val));
    } catch (_) { /* 空间不足等，忽略 */ }
  },
};

/* ---------- DOM / 格式工具 ---------- */
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function fmtTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* 以日期字符串为种子的确定性随机（每日挑战用） */
export function seededRandom(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

/* ---------- 极简 Markdown 渲染（先转义保证安全） ---------- */
export function md(src) {
  const lines = String(src || '').split(/\r?\n/);
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const inline = (t) =>
    esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,4}\s+/.test(line)) {
      closeList();
      const level = line.match(/^#+/)[0].length;
      out.push(`<h${level}>${inline(line.replace(/^#+\s+/, ''))}</h${level}>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
    } else if (/^\d+[.、)]\s+/.test(line)) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(line.replace(/^\d+[.、)]\s+/, ''))}</li>`);
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('');
}

/* ---------- 图标库（内联 SVG，lucide 风格描边） ---------- */
const P = {
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  'mic-off': '<line x1="2" x2="22" y1="2" y2="22"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M15 9.34V5a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2"/><path d="M19 10v2a7 7 0 0 1-.11 1.23"/><line x1="12" x2="12" y1="19" y2="22"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  star: '<path d="M11.5 3.2a.53.53 0 0 1 1 0l2.1 5.1 5.5.4a.53.53 0 0 1 .3 1l-4.2 3.6 1.3 5.4a.53.53 0 0 1-.8.6L12 16.8l-4.7 2.9a.53.53 0 0 1-.8-.6l1.3-5.4-4.2-3.6a.53.53 0 0 1 .3-1l5.5-.4Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  chevron: '<polyline points="9 18 15 12 9 6"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  cards: '<rect width="18" height="14" x="3" y="5" rx="2"/><path d="m3 15 4-4c.9-.9 2.1-.9 3 0l4 4"/><path d="m14 13 1-1c.9-.9 2.1-.9 3 0l3 3"/>',
  radar: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4"/><path d="m19.1 4.9-2.8 2.8"/>',
  trend: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  bars: '<line x1="6" x2="6" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="18" x2="18" y1="20" y2="14"/><path d="M3 20h18"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 8.7 5 8.7-5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  note: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5Z"/><path d="M15 3v6h6"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  'square': '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  keyboard: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.01"/><path d="M10 8h.01"/><path d="M14 8h.01"/><path d="M18 8h.01"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/><path d="M7 16h10"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  bot: '<rect width="16" height="12" x="4" y="8" rx="3"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M9 17.5v1.5M15 17.5v1.5M6 12H4M20 12h-2"/>',
  building: '<rect width="12" height="18" x="6" y="3" rx="1.5"/><path d="M9 7h.01M12 7h.01M15 7h.01M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01M10 21v-3h4v3"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
};

export function icon(name, size = 16) {
  const d = P[name] || P.info;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}

/* 首次渲染所有 data-icon 占位 */
export function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}

/* ---------- Toast ---------- */
export function toast(msg, type = '') {
  const iconName = type === 'ok' ? 'check' : type === 'err' ? 'x' : 'info';
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="ico">${icon(iconName)}</span><span></span>`;
  el.lastElementChild.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2900);
  setTimeout(() => el.remove(), 3300);
}

/* ---------- Modal ---------- */
export function openModal(html, opts = {}) {
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-mask">
      <div class="modal" ${opts.width ? `style="width:min(${opts.width}px,100%)"` : ''}>
        <div class="modal-head">
          <h3>${opts.title ? (opts.icon ? `<span class="ico">${icon(opts.icon)}</span>` : '') + esc(opts.title) : ''}</h3>
          <button class="modal-close" title="关闭">✕</button>
        </div>
        <div class="modal-body">${html}</div>
      </div>
    </div>`;
  const mask = $('.modal-mask', root);
  const close = () => { root.innerHTML = ''; };
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  $('.modal-close', root).addEventListener('click', close);
  return { el: root, close };
}

export function confirmModal(msg, { title = '确认操作', danger = true } = {}) {
  return new Promise((resolve) => {
    const m = openModal(`
      <p style="font-size:14.5px">${esc(msg)}</p>
      <div class="actions" style="justify-content:flex-end">
        <button class="btn ghost" data-no>取消</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>确定</button>
      </div>`, { title });
    $('[data-no]', m.el).onclick = () => { m.close(); resolve(false); };
    $('[data-yes]', m.el).onclick = () => { m.close(); resolve(true); };
  });
}

/* ---------- 主题 ---------- */
const media = (typeof matchMedia !== 'undefined') ? matchMedia('(prefers-color-scheme: dark)') : null;

export function effectiveTheme(pref) {
  if (pref === 'dark' || pref === 'light') return pref;
  return media && media.matches ? 'dark' : 'light';
}

export function applyTheme(pref) {
  const real = effectiveTheme(pref);
  document.documentElement.dataset.theme = real;
  // 设计风格（aurora / editorial / brutal），与明暗主题正交
  try { document.documentElement.dataset.style = S_STYLE(); } catch (_) { /* state 未就绪时忽略 */ }
  const btn = $('#theme-toggle');
  if (btn) {
    const icoEl = $('span[data-icon], span.ico', btn) || btn.firstElementChild;
    if (icoEl) icoEl.innerHTML = icon(real === 'dark' ? 'sun' : 'moon');
    const em = $('em', btn);
    if (em) em.textContent = real === 'dark' ? '浅色模式' : '深色模式';
  }
}

/* 延迟读取风格设置，规避 core ↔ state 循环依赖 */
function S_STYLE() {
  try {
    return JSON.parse(localStorage.getItem('im_style'))?.replace(/"/g, '') || 'aurora';
  } catch (_) {
    return (localStorage.getItem('im_style') || '"aurora"').replace(/"/g, '') || 'aurora';
  }
}

/* ---------- Canvas 图表（零依赖） ---------- */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function setupCanvas(canvas) {
  const dpr = (typeof devicePixelRatio !== 'undefined') ? devicePixelRatio : 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(rect.width, 60);
  const h = Math.max(rect.height, 60);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/* 雷达图：labels[], values[0..100] */
export function radarChart(canvas, labels, values) {
  const { ctx, w, h } = setupCanvas(canvas);
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) / 2 - 34;
  const n = labels.length;
  const grid = cssVar('--chart-grid') || '#e3e8f4';
  const ink = cssVar('--chart-ink') || '#8a93a8';
  if (!n || R <= 10) return;
  const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;

  for (let g = 1; g <= 4; g++) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = angle(i % n);
      const r = (R * g) / 4;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.stroke();
  }
  for (let i = 0; i < n; i++) {
    const a = angle(i);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.strokeStyle = grid; ctx.stroke();
  }
  // 数据面
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, 'rgba(79,107,240,0.42)');
  grad.addColorStop(1, 'rgba(124,92,245,0.30)');
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    const a = angle(idx);
    const r = R * Math.max(Math.min((values[idx] || 0) / 100, 1), 0.02);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = '#4f6bf0'; ctx.lineWidth = 2; ctx.stroke();
  // 顶点与标签
  ctx.font = '11px ' + (cssVar('--font') || 'sans-serif');
  ctx.fillStyle = ink;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const a = angle(i);
    const lx = cx + Math.cos(a) * (R + 20);
    const ly = cy + Math.sin(a) * (R + 16);
    ctx.fillText(labels[i], lx, ly, 64);
  }
}

/* 折线图：points [{label, value}] */
export function lineChart(canvas, points, { min = 0, max = 100 } = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  const pad = { l: 30, r: 14, t: 14, b: 26 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const grid = cssVar('--chart-grid') || '#e3e8f4';
  const ink = cssVar('--chart-ink') || '#8a93a8';
  ctx.font = '10px ' + (cssVar('--font') || 'sans-serif');
  ctx.fillStyle = ink;
  for (let g = 0; g <= 4; g++) {
    const y = pad.t + (ih * g) / 4;
    ctx.strokeStyle = grid; ctx.beginPath();
    ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    const val = Math.round(max - ((max - min) * g) / 4);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(String(val), pad.l - 6, y);
  }
  if (!points.length) return;
  const X = (i) => pad.l + (points.length === 1 ? iw / 2 : (iw * i) / (points.length - 1));
  const Y = (v) => pad.t + ih - ((v - min) / (max - min)) * ih;
  const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  grad.addColorStop(0, 'rgba(79,107,240,0.25)');
  grad.addColorStop(1, 'rgba(79,107,240,0)');
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(X(i), Y(p.value)) : ctx.lineTo(X(i), Y(p.value))));
  ctx.lineTo(X(points.length - 1), h - pad.b);
  ctx.lineTo(X(0), h - pad.b);
  ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(X(i), Y(p.value)) : ctx.lineTo(X(i), Y(p.value))));
  ctx.strokeStyle = '#4f6bf0'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(X(i), Y(p.value), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = '#4f6bf0'; ctx.lineWidth = 2; ctx.stroke();
  });
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const step = Math.ceil(points.length / 7);
  points.forEach((p, i) => { if (i % step === 0) ctx.fillText(p.label, X(i), h - pad.b + 6); });
}

/* 环形图：pct 0-100，返回 Promise（动画可选静态） */
export function donutChart(canvas, pct, { size = 44 } = {}) {
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  const { ctx } = setupCanvas(canvas);
  const w = size, h = size;
  const cx = w / 2, cy = h / 2, R = w / 2 - 4;
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = cssVar('--chart-grid') || '#e3e8f4'; ctx.lineWidth = 5; ctx.stroke();
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#4f6bf0'); grad.addColorStop(1, '#7c5cf5');
  ctx.beginPath();
  ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(pct / 100, 1));
  ctx.strokeStyle = grad; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke();
}

/* ---------- 文件下载 ---------- */
export function downloadFile(filename, content, type = 'text/plain') {
  const blob = new Blob([content], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- 动效工具 ---------- */

/* 数字滚动（ease-out），用于统计瓦片与得分 */
export function animateNum(el, to, { dur = 700, suffix = '' } = {}) {
  if (!el || typeof to !== 'number' || Number.isNaN(to)) return;
  const from = 0;
  const start = performance.now();
  const step = (now) => {
    const p = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* conic-gradient 评分环从 0 转到目标值 */
export function animateRing(el, targetPct, dur = 900) {
  if (!el) return;
  const start = performance.now();
  const step = (now) => {
    const p = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.style.setProperty('--p', (targetPct * eased).toFixed(1));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* 列表交错入场：给容器内直接子元素设置递增 animation-delay */
export function staggerIn(container, selector, step = 36, cap = 12) {
  if (!container) return;
  $$(`${selector}:not(.in)`, container).forEach((el, i) => {
    el.style.animationDelay = Math.min(i, cap) * step + 'ms';
    el.classList.add('in');
  });
}

/* 礼花特效（canvas，零依赖） */
export function confetti(duration = 1600) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;z-index:999;pointer-events:none';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#4f6bf0', '#7c5cf5', '#f97316', '#fbbf24', '#34d399', '#f43f5e'];
  const parts = Array.from({ length: 130 }, () => ({
    x: Math.random() * innerWidth,
    y: -20 - Math.random() * innerHeight * 0.3,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    vy: 2.6 + Math.random() * 3.4,
    vx: -1.6 + Math.random() * 3.2,
    rot: Math.random() * Math.PI * 2,
    vr: -0.12 + Math.random() * 0.24,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  (function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const fade = t > duration - 400 ? Math.max((duration - t) / 400, 0) : 1;
    ctx.globalAlpha = fade;
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.03;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else canvas.remove();
  })(start);
}

/* ---------- 微交互引擎：卡片聚光灯 / 按钮涟漪 / AI 消息复制 ---------- */

export function initMicroInteractions() {
  // 卡片聚光灯：光斑跟随指针（Linear/Vercel 风格）
  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.card, .tile, .q-card, .kn-card, .job-card, .panel-card, .mission-card, .pack-card, .h-item');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    card.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  // 按钮涟漪
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.btn, .nav-item, .chip, .mission-card, .palette-item');
    if (!btn || btn.disabled) return;
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.2;
    const r = document.createElement('span');
    r.className = 'ripple';
    r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px`;
    btn.appendChild(r);
    setTimeout(() => r.remove(), 650);
  }, { passive: true });

  // AI 消息一键复制
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.msg-copy');
    if (!btn) return;
    const bubble = btn.closest('.msg')?.querySelector('.bubble');
    if (!bubble) return;
    try {
      await navigator.clipboard.writeText(bubble.innerText);
      btn.textContent = '✓ 已复制';
      toast('已复制到剪贴板', 'ok');
      setTimeout(() => { btn.textContent = '⧉ 复制'; }, 1500);
    } catch (_) {
      toast('复制失败', 'err');
    }
  });
}

/* ---------- 顶部流式进度条（nprogress 风格） ---------- */

let progEl = null;
let progDepth = 0; // 支持并发请求计数

export function showProgress() {
  progDepth += 1;
  if (!progEl) {
    progEl = document.createElement('div');
    progEl.className = 'top-progress';
    document.body.appendChild(progEl);
  }
  progEl.style.transition = 'none';
  progEl.style.width = '0%';
  progEl.style.opacity = '1';
  requestAnimationFrame(() => {
    progEl.style.transition = 'width .35s ease';
    progEl.style.width = '72%';
  });
}

export function hideProgress() {
  progDepth = Math.max(0, progDepth - 1);
  if (progDepth > 0 || !progEl) return;
  progEl.style.transition = 'width .25s ease, opacity .4s .2s';
  progEl.style.width = '100%';
  setTimeout(() => { progEl.style.opacity = '0'; }, 240);
}

/* ---------- 分享卡片：Canvas 生成可分享的成绩图 ---------- */

export function drawShareCard({ title, subtitle, score, max = 100, dims = [], footer = 'InterviewMate · AI 面试陪练' }) {
  const W = 1200, H = 675;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const FONT = '"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';

  // 背景：深色渐变 + 两团光斑
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0d1526');
  bg.addColorStop(1, '#1b1f4b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  for (const [x, y, r, c] of [[W * 0.85, H * 0.1, 340, 'rgba(79,107,240,0.35)'], [W * 0.05, H * 0.95, 300, 'rgba(124,92,245,0.28)']]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // 左侧：评分环
  const cx = 250, cy = H / 2 + 14, R = 150;
  ctx.lineWidth = 26;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  const ring = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  ring.addColorStop(0, '#4f6bf0');
  ring.addColorStop(1, '#9a7cf8');
  ctx.strokeStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(score / max, 1));
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 92px ${FONT}`;
  ctx.fillText(String(score), cx, cy + 18);
  ctx.font = `500 26px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('/ ' + max, cx, cy + 58);

  // 右侧：标题 + 副标题 + 维度条
  const RX = 500, RW = W - RX - 80;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 46px ${FONT}`;
  ctx.fillText(title.slice(0, 14), RX, 150);
  if (subtitle) {
    ctx.font = `400 24px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(subtitle.slice(0, 26), RX, 196);
  }
  ctx.font = `400 22px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }), RX, H - 92);

  let y = 260;
  for (const d of dims.slice(0, 6)) {
    ctx.font = `600 24px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(String(d.name).slice(0, 6), RX, y + 8);
    const barX = RX + 120, barW = RW - 200;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, barX, y - 10, barW, 16, 8); ctx.fill();
    const g2 = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    g2.addColorStop(0, '#4f6bf0'); g2.addColorStop(1, '#9a7cf8');
    ctx.fillStyle = g2;
    roundRect(ctx, barX, y - 10, Math.max(barW * Math.min(d.score / 10, 1), 16), 16, 8); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(`${d.score}/10`, barX + barW + 16, y + 8);
    y += 52;
  }

  // 底部水印
  ctx.font = `700 22px ${FONT}`;
  const grad = ctx.createLinearGradient(RX, 0, W - 80, 0);
  grad.addColorStop(0, '#8ea2ff'); grad.addColorStop(1, '#c0aefb');
  ctx.fillStyle = grad;
  ctx.textAlign = 'right';
  ctx.fillText(footer, W - 80, H - 60);

  return cv.toDataURL('image/png');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function downloadShareCard(opts, filename = 'interview-mate-成绩单.png') {
  const url = drawShareCard(opts);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* 在新窗口打印（用于报告导出 PDF） */
export function printHtml(title, bodyHtml) {
  const win = window.open('', '_blank');
  if (!win) { toast('浏览器拦截了新窗口，请允许弹窗后重试', 'err'); return; }
  win.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    body{font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;max-width:760px;margin:40px auto;padding:0 24px;color:#182134;line-height:1.7}
    h1{font-size:22px;border-bottom:2px solid #4f6bf0;padding-bottom:8px}
    h2{font-size:16px;margin-top:22px;color:#4f6bf0}
    code{background:#f0f2f8;padding:1px 5px;border-radius:4px}
    li{margin:4px 0}
    .ft{margin-top:40px;font-size:12px;color:#94a0b8;border-top:1px dashed #ddd;padding-top:10px}
  </style></head><body>${bodyHtml}<p class="ft">由 InterviewMate · AI 面试陪练生成 — ${new Date().toLocaleString('zh-CN')}</p></body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 300);
}
