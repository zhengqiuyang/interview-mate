/* 知识库：Markdown 知识条目 + 标签 + 全文检索 + AI 剪藏生成学习卡 */
import { $, $$, esc, md, icon, toast, openModal, confirmModal, staggerIn } from '../core.js';
import { S, persist, remergeBank } from '../state.js';
import { streamChat, hasKey } from '../api.js';
import { switchView } from '../router.js';
import { render as renderBank } from './bank.js';
import { render as renderDashboard } from './dashboard.js';
import { awardXP } from '../gamify.js';

let filterTag = 'all';

export function init() {
  $('#kn-search').addEventListener('input', () => render());
  $('#btn-kn-new').addEventListener('click', () => openEditor());
  $('#btn-kn-cards').addEventListener('click', openCardGenerator);
}

export function onShow() { render(); }

function allTags() {
  const set = new Map();
  for (const k of S.knowledge) for (const t of k.tags || []) set.set(t, (set.get(t) || 0) + 1);
  return [...set.entries()].sort((a, b) => b[1] - a[1]);
}

export function render() {
  const kw = ($('#kn-search')?.value || '').trim().toLowerCase();
  const chips = $('#kn-tags');
  const tags = allTags();
  chips.innerHTML = '';
  const mk = (val, label, count) => {
    const b = document.createElement('button');
    b.className = `chip${filterTag === val ? ' active' : ''}`;
    b.innerHTML = `${esc(label)}<b>${count}</b>`;
    b.onclick = () => { filterTag = val; render(); };
    chips.appendChild(b);
  };
  mk('all', '全部', S.knowledge.length);
  for (const [t, n] of tags.slice(0, 12)) mk(t, '#' + t, n);

  const list = S.knowledge.filter((k) => {
    if (filterTag !== 'all' && !(k.tags || []).includes(filterTag)) return false;
    if (kw && !`${k.title} ${k.content}`.toLowerCase().includes(kw)) return false;
    return true;
  });

  $('#kn-stats').innerHTML = S.knowledge.length
    ? `共 <b>${S.knowledge.length}</b> 条知识 · 覆盖 <b>${tags.length}</b> 个标签`
    : '知识库还是空的——手动新建，或用「AI 生成学习卡」把一篇文章变成知识+闪卡。';

  const box = $('#kn-list');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = `<div class="empty"><div class="empty-ico">${icon('brain', 36)}</div>${S.knowledge.length ? '没有匹配的知识条目' : '还没有知识条目<br><small>贴一篇文章给 AI，自动生成摘要和闪卡</small>'}</div>`;
    return;
  }
  for (const k of list) {
    const card = document.createElement('div');
    card.className = 'kn-card';
    card.innerHTML = `
      <div class="kn-title">${esc(k.title)}</div>
      <div class="kn-excerpt">${esc((k.content || '').replace(/[#*\-`>]/g, '').slice(0, 120))}…</div>
      <div class="kn-foot">
        <div class="q-tags">${(k.tags || []).map((t) => `<span class="q-tag">#${esc(t)}</span>`).join('')}</div>
        <div class="kn-actions">
          <span class="muted" style="font-size:11.5px">${new Date(k.updated).toLocaleDateString('zh-CN')}</span>
          <button class="btn small ghost k-view">查看</button>
          <button class="btn small ghost k-edit">编辑</button>
          <button class="btn small danger k-del">删除</button>
        </div>
      </div>`;
    $('.k-view', card).onclick = () => openEntry(k.id);
    $('.k-edit', card).onclick = () => openEditor(k);
    $('.k-del', card).onclick = async () => {
      if (!(await confirmModal(`删除「${k.title.slice(0, 20)}…」？`))) return;
      S.knowledge = S.knowledge.filter((x) => x.id !== k.id);
      persist('knowledge');
      render();
    };
    box.appendChild(card);
  }
  staggerIn(box, '.kn-card');
}

/* 供全局搜索跳转使用 */
export function openEntry(id) {
  const k = S.knowledge.find((x) => x.id === id);
  if (!k) return null;
  return openModal(`<div class="md">${md(k.content)}</div>`, { title: k.title, icon: 'brain', width: 760 });
}

function openEditor(k = null) {
  const m = openModal(`
    <label class="field"><span>标题</span><input id="ke-title" class="input" value="${k ? esc(k.title) : ''}" placeholder="如：MySQL 索引失效的 8 种场景"></label>
    <label class="field"><span>内容（Markdown：支持 **加粗**、- 列表、# 标题）</span>
      <textarea id="ke-content" rows="12" placeholder="把你的理解、踩过的坑、口诀、参考链接都记在这里…">${k ? esc(k.content) : ''}</textarea></label>
    <label class="field"><span>标签（逗号分隔）</span><input id="ke-tags" class="input" value="${k ? esc((k.tags || []).join(', ')) : ''}" placeholder="mysql, 八股"></label>
    <div class="actions" style="justify-content:flex-end"><button class="btn primary" id="ke-ok">${icon('check', 14)}保存</button></div>`,
    { title: k ? '编辑知识' : '新建知识', icon: 'note', width: 680 });
  $('#ke-ok', m.el).onclick = () => {
    const title = $('#ke-title', m.el).value.trim();
    const content = $('#ke-content', m.el).value.trim();
    if (!title || !content) { toast('标题和内容必填', 'err'); return; }
    const tags = $('#ke-tags', m.el).value.split(/[,，、\s]+/).filter(Boolean);
    if (k) {
      Object.assign(k, { title, content, tags, updated: Date.now() });
    } else {
      S.knowledge.unshift({ id: 'kn-' + Date.now(), title, content, tags, updated: Date.now() });
    }
    persist('knowledge');
    m.close();
    render();
    awardXP(5, '新增知识');
    toast('知识已保存', 'ok');
  };
}

/* ---------- AI 剪藏 → 摘要 + 学习卡 ---------- */

function extractJson(text) {
  const t = text.replace(/```json|```/g, '').trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('AI 未返回 JSON（可能被截断，请重试）');
  return JSON.parse(t.slice(s, e + 1));
}

function openCardGenerator() {
  if (!hasKey()) {
    toast('AI 生成需要先配置 API Key', 'err');
    switchView('settings');
    return;
  }
  const m = openModal(`
    <label class="field">
      <span>粘贴任意学习材料（文章 / 面经 / 官方文档 / 论文笔记）</span>
      <textarea id="gen-ta" rows="10" placeholder="AI 会生成：1) 80 字摘要（存入知识库）2) 3-8 张问答卡（可一键导入题库，进入间隔重复复习）"></textarea>
    </label>
    <div class="actions" style="justify-content:space-between">
      <span class="hint" style="margin:0">材料越长效果越好，建议一次一篇文章</span>
      <button class="btn primary" id="gen-ok">${icon('sparkles', 14)}生成学习卡</button>
    </div>
    <div id="gen-result"></div>`,
    { title: 'AI 生成学习卡', icon: 'sparkles', width: 720 });

  $('#gen-ok', m.el).onclick = async () => {
    const content = $('#gen-ta', m.el).value.trim();
    if (!content) { toast('先粘贴材料', 'err'); return; }
    const out = $('#gen-result', m.el);
    out.innerHTML = '<div class="skeleton-lines"><i></i><i></i><i></i></div>';
    let full = '';
    try {
      await streamChat(
        { mode: 'cards', messages: [{ role: 'user', content: content.slice(0, 12000) }] },
        (d) => { full += d; }
      );
      const parsed = extractJson(full);
      if (!parsed.cards?.length) throw new Error('AI 未生成卡片');
      renderGenResult(out, parsed, content);
    } catch (e) {
      out.innerHTML = `<p style="color:var(--danger)">生成失败：${esc(e.message)}</p>`;
    }
  };
}

function renderGenResult(out, parsed, original) {
  out.innerHTML = `
    <div class="q-note" style="margin-top:14px"><b>AI 摘要　</b>${esc(parsed.summary || '')}</div>
    <div style="margin-top:12px;font-weight:600">生成 ${parsed.cards.length} 张学习卡：</div>
    <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px">
      ${parsed.cards.map((c, i) => `
        <div class="card" style="margin:0;padding:12px 16px">
          <div style="font-weight:600">Q${i + 1}：${esc(c.q)}</div>
          <div class="md" style="font-size:13px;color:var(--muted)">${md(c.a)}</div>
        </div>`).join('')}
    </div>
    <div class="actions">
      <button class="btn primary" id="gen-import">${icon('check', 14)}导入题库（${parsed.cards.length} 题）</button>
      <button class="btn ghost" id="gen-kn">${icon('note', 14)}仅存为知识</button>
    </div>`;
  $('#gen-import', out).onclick = () => {
    const items = parsed.cards.map((c, i) => ({
      id: `custom-${Date.now()}-${i}`,
      q: String(c.q).trim(),
      a: String(c.a).trim(),
      cat: 'custom',
      diff: 2,
      tags: Array.isArray(c.tags) && c.tags.length ? c.tags.map(String).slice(0, 5) : ['AI生成'],
    }));
    S.custom = [...S.custom, ...items];
    persist('custom');
    S.knowledge.unshift({
      id: 'kn-' + Date.now(),
      title: original.trim().split('\n')[0].slice(0, 40) || 'AI 剪藏',
      content: parsed.summary || '',
      tags: ['AI生成'], updated: Date.now(),
    });
    persist('knowledge');
    remergeBank();
    renderBank();
    renderDashboard();
    awardXP(10, 'AI 学习卡入库');
    toast(`已导入 ${items.length} 题并保存知识`, 'ok');
  };
  $('#gen-kn', out).onclick = () => {
    S.knowledge.unshift({
      id: 'kn-' + Date.now(),
      title: original.trim().split('\n')[0].slice(0, 40) || 'AI 剪藏',
      content: `${parsed.summary || ''}\n\n${parsed.cards.map((c, i) => `${i + 1}. **${c.q}**\n${c.a}`).join('\n\n')}`,
      tags: ['AI生成'], updated: Date.now(),
    });
    persist('knowledge');
    render();
    toast('已存入知识库', 'ok');
  };
}
