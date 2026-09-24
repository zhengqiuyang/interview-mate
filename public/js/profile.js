/* Agent 长期记忆画像：跨场沉淀的「用户画像卡」 */
import { store, icon, esc, toast, openModal, confirmModal } from './core.js';
import { S, persist } from './state.js';

export const PROFILE_TYPES = {
  项目: { icon: '📦', cls: '' },
  失分: { icon: '⚠️', cls: 'warn' },
  薄弱: { icon: '📉', cls: 'warn' },
  偏好: { icon: '⚙️', cls: '' },
  亮点: { icon: '⭐', cls: 'ok' },
};

const MAX_CARDS = 60;

/* 去重合并画像卡，返回新增数量 */
export function addCards(list) {
  let n = 0;
  for (const c of list || []) {
    if (!c || !c.content) continue;
    const type = PROFILE_TYPES[c.type] ? c.type : '项目';
    const content = String(c.content).trim().slice(0, 120);
    if (!content) continue;
    if (S.profile.cards.some((x) => x.type === type && x.content === content)) continue;
    S.profile.cards.unshift({
      id: 'pc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      type, content, source: c.source || 'AI', date: Date.now(),
    });
    n += 1;
  }
  if (S.profile.cards.length > MAX_CARDS) S.profile.cards.length = MAX_CARDS;
  if (n) persist('profile');
  return n;
}

export function profileStats() {
  const byType = {};
  for (const c of S.profile.cards) byType[c.type] = (byType[c.type] || 0) + 1;
  return { total: S.profile.cards.length, byType };
}

/* 看板画像卡 */
export function renderProfileCard(container) {
  if (!container) return;
  const st = profileStats();
  if (!st.total) {
    container.innerHTML = '<p class="hint">还没有画像。完成简历诊断或模拟面试后，系统会自动沉淀你的项目要点与失分点——Agent 将越来越懂你。</p>';
    return;
  }
  container.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${Object.entries(PROFILE_TYPES).filter(([k]) => st.byType[k]).map(([k, v]) =>
        `<span class="badge ${v.cls}">${v.icon} ${k} ${st.byType[k]}</span>`).join('')}
      <button class="btn small ghost" id="profile-manage" style="margin-left:auto">管理</button>
    </div>
    <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">
      ${S.profile.cards.slice(0, 4).map((c) => `
        <div class="recent-item" style="border:0;padding:2px 0">
          <div class="recent-ico" style="width:26px;height:26px;font-size:14px">${PROFILE_TYPES[c.type].icon}</div>
          <div class="recent-main" style="font-size:13px">${esc(c.content)}</div>
        </div>`).join('')}
      ${st.total > 4 ? `<p class="hint">…共 ${st.total} 条</p>` : ''}
    </div>`;
  $('#profile-manage', container)?.addEventListener('click', openProfileModal);
}

/* 画像管理弹窗 */
export function openProfileModal() {
  const st = profileStats();
  const m = openModal(`
    ${st.total ? Object.entries(PROFILE_TYPES).map(([k, v]) => {
      const cards = S.profile.cards.filter((c) => c.type === k);
      if (!cards.length) return '';
      return `
        <div class="muted" style="font-size:12px;font-weight:700;letter-spacing:.1em;margin:12px 0 6px">${v.icon} ${k}（${cards.length}）</div>
        ${cards.map((c) => `
          <div class="tok-row" style="grid-template-columns:1fr auto auto">
            <span>${esc(c.content)}</span>
            <span class="muted" style="font-size:11px">${esc(c.source)} · ${new Date(c.date).toLocaleDateString('zh-CN')}</span>
            <button class="icon-btn sm" data-pdel="${esc(c.id)}">${icon('trash', 14)}</button>
          </div>`).join('')}`;
    }).join('') : '<p class="hint">还没有画像卡。来源：模拟面试报告的「沉淀画像」按钮、简历诊断的自动沉淀。</p>'}
    <div class="actions" style="justify-content:flex-end">
      <button class="btn small danger" id="profile-clear">${icon('trash', 13)}清空画像</button>
    </div>`,
    { title: '我的长期画像', icon: 'brain', width: 720 });
  $$('[data-pdel]', m.el).forEach((b) => {
    b.onclick = () => {
      S.profile.cards = S.profile.cards.filter((c) => c.id !== b.dataset.pdel);
      persist('profile');
      m.close();
      openProfileModal();
    };
  });
  $('#profile-clear', m.el).onclick = async () => {
    if (!(await confirmModal('清空全部画像卡？Agent 会「失忆」哦'))) return;
    S.profile.cards = [];
    persist('profile');
    m.close();
    toast('画像已清空');
  };
}
