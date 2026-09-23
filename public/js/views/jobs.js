/* 岗位雷达：订阅公开源自动汇集 + 关键词过滤 + AI 解析 JD */
import { $, $$, esc, md, icon, toast, openModal } from '../core.js';
import { S, persist } from '../state.js';
import { streamChat, hasKey } from '../api.js';
import { switchView } from '../router.js';

let jobsCache = { jobs: [], newCount: 0, lastRun: null };

export function init() {
  $('#btn-add-sub').addEventListener('click', addSub);
  $('#job-sub-type').addEventListener('change', () => {
    const needUrl = ['rss', 'json'].includes($('#job-sub-type').value);
    $('#job-sub-url-field').classList.toggle('hidden', !needUrl);
  });
  $('#btn-jobs-refresh').addEventListener('click', refreshNow);
  $('#btn-jobs-manual').addEventListener('click', openManualAdd);
  $('#jobs-search').addEventListener('input', () => renderList());
  $('#jobs-unread-toggle').addEventListener('click', () => {
    const b = $('#jobs-unread-toggle');
    b.classList.toggle('on');
    renderList();
  });
  $('#btn-jobs-seen').addEventListener('click', markAllSeen);
  $('#jobs-resume').addEventListener('change', renderList);
}

export function onShow() {
  render();
  refreshResumeSelect();
}

/* ---------- 本地简历匹配分 ---------- */

function refreshResumeSelect() {
  const sel = $('#jobs-resume');
  const cur = sel.value;
  sel.innerHTML = '<option value="">匹配简历：未选择</option>' +
    S.resumes.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'you', 'our', 'are', 'will', 'from', 'that', 'this', 'have', 'your', 'who', 'all', 'any', 'not', '但', '的', '与', '和', '或']);

function matchScore(job, resumeText) {
  if (!resumeText) return null;
  const resume = resumeText.toLowerCase();
  const text = `${job.title} ${job.body || ''}`.toLowerCase();
  // 提取岗位中的技术词（拉丁词 + 数字版本号）
  const tokens = [...new Set((text.match(/[a-z][a-z+#.0-9]{1,14}/g) || [])
    .filter((t) => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t)))].slice(0, 40);
  if (!tokens.length) return 0;
  const hit = tokens.filter((t) => resume.includes(t));
  return Math.round((hit.length / tokens.length) * 100);
}

function selectedResumeText() {
  const id = $('#jobs-resume')?.value;
  if (!id) return null;
  return S.resumes.find((r) => r.id === id)?.content?.toLowerCase() || null;
}

/* ---------- 数据加载与渲染 ---------- */

async function render() {
  try {
    const [jobsRes, subsRes] = await Promise.all([
      fetch('/api/jobs?limit=200').then((r) => r.json()),
      fetch('/api/jobs/subs').then((r) => r.json()),
    ]);
    jobsCache = jobsRes;
    renderSubs(subsRes.subs);
    renderList();
    updateNavBadge(jobsRes.newCount);
    const lr = jobsRes.lastRun ? `上次抓取：${new Date(jobsRes.lastRun).toLocaleString('zh-CN')}` : '还没有抓取过';
    $('#jobs-stats').innerHTML =
      `已汇集 <b>${jobsRes.total}</b> 个岗位 · 未读 <b>${jobsRes.newCount}</b> · ${esc(lr)}` +
      (subsRes.subs.length ? '' : ' · 先添加一个订阅源开始自动汇集');
  } catch (e) {
    $('#jobs-list').innerHTML = `<div class="empty"><div class="empty-ico">⚠️</div>加载失败：${esc(e.message)}</div>`;
  }
}

function updateNavBadge(n) {
  const badge = $('#nav-jobs-badge');
  if (badge) {
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('hidden', !n);
  }
}

function renderSubs(subs) {
  const box = $('#jobs-subs');
  if (!subs.length) {
    box.innerHTML = '<p class="hint" style="margin:4px 0">还没有订阅。添加下面的内置源（填关键词即可），服务端会定时自动抓取；也可以接入你自己的 JSON/RSS 源。</p>';
    return;
  }
  box.innerHTML = subs.map((s) => `
    <div class="sub-item">
      <div class="sub-main">
        <div class="sub-title">
          <span class="badge">${esc(s.name)}</span>
          <span class="badge ${s.enabled ? 'ok' : ''}">${s.enabled ? '启用' : '停用'}</span>
          ${s.lastError ? `<span class="badge warn" title="${esc(s.lastError)}">上次出错：${esc(s.lastError.slice(0, 26))}</span>` : ''}
          ${s.lastFetch && !s.lastError ? `<span class="muted" style="font-size:12px">${s.lastAdded} 条新 · ${new Date(s.lastFetch).toLocaleTimeString('zh-CN')}</span>` : ''}
        </div>
        <div class="muted" style="font-size:12.5px">
          ${s.keywords?.length ? '关键词：' + s.keywords.map(esc).join('、') : '未设关键词（收录全部）'}
          ${s.excludes?.length ? ' · 排除：' + s.excludes.map(esc).join('、') : ''}
        </div>
      </div>
      <button class="btn small ghost" data-toggle="${esc(s.id)}">${s.enabled ? '停用' : '启用'}</button>
      <button class="btn small danger" data-del="${esc(s.id)}">删除</button>
    </div>`).join('');
  $$('[data-toggle]', box).forEach((b) => {
    b.onclick = async () => {
      await fetch('/api/jobs/subs/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.dataset.toggle }) });
      render();
    };
  });
  $$('[data-del]', box).forEach((b) => {
    b.onclick = async () => {
      await fetch('/api/jobs/subs/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.dataset.del }) });
      toast('订阅已删除');
      render();
    };
  });
}

function renderList() {
  const onlyNew = $('#jobs-unread-toggle')?.classList.contains('on');
  const kw = ($('#jobs-search')?.value || '').trim().toLowerCase();
  const resumeText = selectedResumeText();
  const list = jobsCache.jobs
    .filter((j) => {
      if (onlyNew && j.seen) return false;
      if (kw && !`${j.title} ${j.company} ${j.body || ''}`.toLowerCase().includes(kw)) return false;
      return true;
    })
    .map((j) => ({ ...j, __match: matchScore(j, resumeText) }));
  if (resumeText) list.sort((a, b) => (b.__match ?? -1) - (a.__match ?? -1));
  const box = $('#jobs-list');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = `<div class="empty"><div class="empty-ico">📡</div>${jobsCache.jobs.length ? '没有匹配的岗位' : '还没有汇集到岗位<br><small>添加订阅源 → 点「立即抓取」，或手动粘贴一个 JD</small>'}</div>`;
    return;
  }
  for (const j of list) {
    const card = document.createElement('div');
    card.className = 'job-card';
    card.innerHTML = `
      <div class="job-head">
        <div class="job-title">
          ${j.seen ? '' : '<span class="badge warn">NEW</span>'}
          <b>${esc(j.title)}</b>
        </div>
        <div class="job-meta">
          <span class="badge">${esc(j.sourceName)}</span>
          ${j.url ? `<a href="${esc(j.url)}" target="_blank" rel="noopener" class="btn small ghost">原帖 ↗</a>` : ''}
        </div>
      </div>
      <div class="job-sub-line">
        ${j.__match != null ? `<span class="badge ${j.__match >= 60 ? 'ok' : j.__match >= 35 ? 'warn' : ''}">匹配 ${j.__match}%</span>` : ''}
        ${j.company ? `<span>🏢 ${esc(j.company)}</span>` : ''}
        ${j.location ? `<span>📍 ${esc(j.location)}</span>` : ''}
        ${j.salary ? `<span>💰 ${esc(j.salary)}</span>` : ''}
        ${j.publishedAt ? `<span>🕐 ${new Date(j.publishedAt).toLocaleDateString('zh-CN')}</span>` : ''}
        ${(j.keywords || []).map((k) => `<span class="badge ok">✓ ${esc(k)}</span>`).join('')}
      </div>
      <div class="job-body hidden md"></div>
      <div class="job-actions">
        <button class="btn small ghost j-toggle">${icon('chevron', 13)}详情</button>
        <button class="btn small primary j-ai">${icon('sparkles', 13)}AI 岗位情报</button>
      </div>`;
    $('.j-toggle', card).onclick = () => {
      const body = $('.job-body', card);
      body.classList.toggle('hidden');
      if (!body.classList.contains('hidden')) {
        body.innerHTML = j.body
          ? `<p style="white-space:pre-wrap;font-size:13.5px;color:var(--muted)">${esc(j.body)}</p>`
          : '<p class="muted">（无详情，查看原帖）</p>';
      }
    };
    $('.j-ai', card).onclick = () => analyzeJd(j);
    box.appendChild(card);
  }
}

/* ---------- 订阅管理 ---------- */

async function addSub() {
  const type = $('#job-sub-type').value;
  const url = $('#job-sub-url').value.trim();
  const name = $('#job-sub-name').value.trim();
  const keywords = $('#job-sub-kw').value.split(/[,，、\s]+/).filter(Boolean);
  const excludes = $('#job-sub-ex').value.split(/[,，、\s]+/).filter(Boolean);
  const res = await fetch('/api/jobs/subs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, url, name, keywords, excludes }),
  });
  const j = await res.json();
  if (!res.ok) { toast(j.error || '添加失败', 'err'); return; }
  $('#job-sub-name').value = '';
  $('#job-sub-url').value = '';
  $('#job-sub-kw').value = '';
  $('#job-sub-ex').value = '';
  toast('订阅已添加，正在首次抓取…', 'ok');
  refreshNow();
}

async function refreshNow() {
  const btn = $('#btn-jobs-refresh');
  btn.disabled = true;
  btn.textContent = '抓取中…';
  try {
    const res = await fetch('/api/jobs/refresh', { method: 'POST' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error);
    toast(`抓取完成，新增 ${j.added} 个岗位`, 'ok');
  } catch (e) {
    toast('抓取失败：' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${icon('rotate', 14)}立即抓取`;
    render();
  }
}

async function markAllSeen() {
  const keys = jobsCache.jobs.map((j) => j.key);
  await fetch('/api/jobs/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys }) });
  toast('已全部标为已读', 'ok');
  render();
}

/* ---------- 手动添加（粘贴 JD） ---------- */

function openManualAdd() {
  const m = openModal(`
    <label class="field"><span>岗位标题</span><input id="jm-title" class="input" placeholder="如：高级后端工程师 - 交易系统"></label>
    <label class="field"><span>公司 / 来源（可选）</span><input id="jm-company" class="input" placeholder="如：某某科技 / Boss直聘"></label>
    <label class="field"><span>链接（可选）</span><input id="jm-url" class="input" placeholder="https://…"></label>
    <label class="field"><span>JD 正文（整段复制粘贴）</span><textarea id="jm-body" rows="10" placeholder="岗位职责与任职要求…"></textarea></label>
    <div class="actions" style="justify-content:flex-end"><button class="btn primary" id="jm-ok">${icon('check', 14)}保存</button></div>`,
    { title: '手动添加岗位', icon: 'plus', width: 640 });
  $('#jm-ok', m.el).onclick = async () => {
    const title = $('#jm-title', m.el).value.trim();
    const body = $('#jm-body', m.el).value.trim();
    if (!title || !body) { toast('标题和正文必填', 'err'); return; }
    const res = await fetch('/api/jobs/manual', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, company: $('#jm-company', m.el).value.trim(), url: $('#jm-url', m.el).value.trim() }),
    });
    const j = await res.json();
    m.close();
    if (j.dup) { toast('这条岗位已存在'); return; }
    toast('已加入岗位列表', 'ok');
    render();
  };
}

/* ---------- AI 岗位情报 ---------- */

function analyzeJd(j) {
  if (!hasKey()) {
    toast('AI 分析需要先配置 API Key', 'err');
    switchView('settings');
    return;
  }
  const jdText = `岗位：${j.title}\n公司：${j.company || '未知'}\n地点：${j.location || '-'}\n薪资：${j.salary || '-'}\n\n${j.body || j.title}`;
  const m = openModal('<div class="skeleton-lines"><i></i><i></i><i></i></div>', { title: 'AI 岗位情报', icon: 'sparkles', width: 720 });
  (async () => {
    let full = '';
    try {
      await streamChat(
        { mode: 'jd', messages: [{ role: 'user', content: jdText }] },
        (d) => {
          full += d;
          $('.modal-body', m.el).innerHTML = `<div class="md">${md(full)}</div>`;
        }
      );
      const tools = document.createElement('div');
      tools.className = 'result-tools';
      tools.innerHTML = `
        <button class="btn small ghost" id="jd-save">${icon('note', 13)}存入知识库</button>
        <button class="btn small ghost" id="jd-diag">${icon('clipboard', 13)}结合简历深度诊断</button>`;
      $('.modal-body', m.el).appendChild(tools);
      $('#jd-save', tools).onclick = () => {
        S.knowledge.unshift({
          id: 'kn-' + Date.now(), title: `[JD] ${j.title}`,
          content: full, tags: ['JD分析', ...(j.keywords || [])], updated: Date.now(),
        });
        persist('knowledge');
        toast('已存入知识库', 'ok');
        m.close();
      };
      $('#jd-diag', tools).onclick = () => {
        $('#jd-text').value = jdText;
        m.close();
        switchView('resume');
        toast('JD 已填入，粘贴简历后点「生成匹配分析」', 'ok');
      };
    } catch (e) {
      $('.modal-body', m.el).innerHTML = `<p style="color:var(--danger)">出错了：${esc(e.message)}</p>`;
    }
  })();
}
