/* 投递看板：求职中枢台账（状态流转 / 雷达导入 / 面试提醒 / 转化统计） */
import { $, $$, esc, icon, toast, openModal, confirmModal, staggerIn } from '../core.js';
import { S, persist } from '../state.js';
import { switchView } from '../router.js';
import { awardXP } from '../gamify.js';

const STATUSES = [
  { key: 'applied', name: '已投递', icon: '📨' },
  { key: 'screening', name: '约面/筛选', icon: '📞' },
  { key: 'interview1', name: '一面', icon: '1️⃣' },
  { key: 'interview2', name: '二面', icon: '2️⃣' },
  { key: 'interview3', name: '三面/终面', icon: '3️⃣' },
  { key: 'hr', name: 'HR 面', icon: '🤝' },
  { key: 'offer', name: 'Offer', icon: '🎉' },
  { key: 'rejected', name: '挂了', icon: '❌' },
  { key: 'paused', name: '搁置', icon: '⏸️' },
];
const NEXT = {
  applied: 'screening', screening: 'interview1', interview1: 'interview2',
  interview2: 'interview3', interview3: 'hr', hr: 'offer',
};
const CHANNELS = ['Boss直聘', '内推', '官网', '猎聘', '拉勾', '脉脉', '其他'];
let viewMode = 'board';

const stName = (k) => STATUSES.find((s) => s.key === k)?.name || k;

export function init() {
  $('#ap-new')?.addEventListener('click', () => openEditor());
  $('#ap-import')?.addEventListener('click', openImportFromRadar);
  $$('#ap-mode button').forEach((b) => {
    b.addEventListener('click', () => {
      viewMode = b.dataset.m;
      $$('#ap-mode button').forEach((x) => x.classList.toggle('active', x === b));
      render();
    });
  });
}

export function onShow() { render(); }

/* ---------- 渲染 ---------- */

function daysTo(dateStr) {
  if (!dateStr) return null;
  const d = Math.ceil((new Date(dateStr + 'T23:59:59') - new Date()) / 86400000);
  return d;
}

function render() {
  const apps = S.apps;
  const active = apps.filter((a) => !['offer', 'rejected', 'paused'].includes(a.status));
  const offers = apps.filter((a) => a.status === 'offer');
  const screened = apps.filter((a) => a.status !== 'applied');
  // 即将面试横幅
  const upcoming = apps
    .filter((a) => a.interviewDate && daysTo(a.interviewDate) !== null && daysTo(a.interviewDate) >= 0 && a.status !== 'rejected')
    .sort((a, b) => a.interviewDate.localeCompare(b.interviewDate));
  $('#ap-banner').innerHTML = upcoming.length ? `
    <div class="banner warn" style="margin-bottom:14px">
      ⏰ 即将面试：${upcoming.slice(0, 3).map((a) =>
        `<b>${esc(a.company)}</b>（${daysTo(a.interviewDate) === 0 ? '今天！' : daysTo(a.interviewDate) + ' 天后'}）`).join('、')}
      ${upcoming.length > 3 ? ` 等 ${upcoming.length} 场` : ''}
      <button class="btn small" id="ap-practice">先来一场模拟面试</button>
    </div>` : '';
  $('#ap-practice')?.addEventListener('click', () => { switchView('mock'); toast('建议选「项目深挖面」，面试官会围绕你的经历追问', 'ok'); });

  $('#ap-tiles').innerHTML = `
    <div class="tile"><div class="tile-ico">${icon('send', 20)}</div>
      <div><div class="tile-num">${apps.length}</div><div class="tile-label">总投递</div></div></div>
    <div class="tile clickable" id="ap-t-active"><div class="tile-ico warn">${icon('clock', 20)}</div>
      <div><div class="tile-num">${active.length}</div><div class="tile-label">进行中</div></div></div>
    <div class="tile"><div class="tile-ico ok">${icon('trophy', 20)}</div>
      <div><div class="tile-num">${offers.length}</div><div class="tile-label">Offer</div></div></div>
    <div class="tile"><div class="tile-ico gold">${icon('trend', 20)}</div>
      <div><div class="tile-num">${apps.length ? Math.round((screened.length / apps.length) * 100) : 0}%</div><div class="tile-label">约面/推进率</div></div></div>`;

  if (!apps.length) {
    $('#ap-board').innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        <div class="empty-ico">${icon('send', 36)}</div>
        还没有投递记录——「新建投递」手动添加，或「从岗位雷达导入」已汇集的岗位
      </div>`;
    $('#ap-list').innerHTML = '';
    return;
  }

  if (viewMode === 'board') {
    $('#ap-list').innerHTML = '';
    const board = $('#ap-board');
    board.innerHTML = STATUSES.map((st) => {
      const cards = apps.filter((a) => a.status === st.key);
      return `
      <div class="kb-col" data-st="${st.key}">
        <div class="kb-head">${st.icon} ${st.name} <b>${cards.length}</b></div>
        ${cards.map((a) => `
        <div class="kb-card" data-id="${esc(a.id)}">
          <div class="kb-company">${esc(a.company)} ${a.interviewDate && daysTo(a.interviewDate) >= 0 && a.status !== 'rejected' ? '<span class="badge warn">⏰' + (daysTo(a.interviewDate) === 0 ? '今天' : daysTo(a.interviewDate) + '天') + '</span>' : ''}</div>
          <div class="kb-pos">${esc(a.position)}</div>
          <div class="kb-meta"><span class="badge">${esc(a.channel)}</span>${a.salary ? `<span class="muted" style="font-size:11.5px">${esc(a.salary)}</span>` : ''}</div>
          <div class="kb-foot">
            <span class="muted" style="font-size:11px">${new Date(a.date).toLocaleDateString('zh-CN')}</span>
            ${NEXT[a.status] ? `<button class="btn small ghost" data-adv="${esc(a.id)}" title="推进到 ${stName(NEXT[a.status])}">→</button>` : ''}
          </div>
        </div>`).join('')}
      </div>`;
    }).join('');
    $$('.kb-card', board).forEach((el) => {
      el.onclick = (e) => {
        if (e.target.closest('[data-adv]')) return;
        openEditor(S.apps.find((a) => a.id === el.dataset.id));
      };
    });
    $$('[data-adv]', board).forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        advance(S.apps.find((a) => a.id === b.dataset.adv));
      };
    });
  } else {
    $('#ap-board').innerHTML = '';
    $('#ap-list').innerHTML = apps.map((a) => `
      <div class="h-item">
        <div class="h-kind">${STATUSES.find((s) => s.key === a.status)?.icon || '📨'}</div>
        <div class="h-main">
          <div class="h-title">${esc(a.company)} · ${esc(a.position)}</div>
          <div class="h-sub">${esc(a.channel)} · ${new Date(a.date).toLocaleDateString('zh-CN')}${a.interviewDate ? ` · 面试 ${a.interviewDate}` : ''}</div>
        </div>
        <select class="input" style="width:110px" data-st="${esc(a.id)}">
          ${STATUSES.map((s) => `<option value="${s.key}" ${s.key === a.status ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select>
        <button class="btn small ghost" data-edit="${esc(a.id)}">详情</button>
        <button class="btn small danger" data-del="${esc(a.id)}">删除</button>
      </div>`).join('');
    $$('select[data-st]', $('#ap-list')).forEach((sel) => {
      sel.onchange = () => setStatus(S.apps.find((a) => a.id === sel.dataset.st), sel.value);
    });
    $$('[data-edit]', $('#ap-list')).forEach((b) => { b.onclick = () => openEditor(S.apps.find((a) => a.id === b.dataset.edit)); });
    $$('[data-del]', $('#ap-list')).forEach((b) => {
      b.onclick = async () => {
        if (!(await confirmModal('删除这条投递记录？'))) return;
        S.apps = S.apps.filter((a) => a.id !== b.dataset.del);
        persist('apps');
        render();
      };
    });
  }
}

/* ---------- 状态流转 ---------- */

function setStatus(a, status, silent = false) {
  if (!a || a.status === status) return;
  a.status = status;
  a.history.push({ status, date: Date.now(), note: '' });
  persist('apps');
  if (status === 'offer') {
    awardXP(100, '拿到 offer！');
    toast(`🎉 ${a.company} 进入 Offer！`, 'ok');
  } else if (!silent) {
    toast(`${a.company} → ${stName(status)}`, 'ok');
  }
  render();
}

function advance(a) {
  const next = NEXT[a.status];
  if (next) setStatus(a, next);
}

/* ---------- 编辑弹窗 ---------- */

function openEditor(a = null) {
  const isNew = !a;
  const m = openModal(`
    <div class="settings-grid" style="grid-template-columns:1fr 1fr">
      <label class="field"><span>公司 *</span><input id="ae-company" class="input" value="${a ? esc(a.company) : ''}" placeholder="如：字节跳动"></label>
      <label class="field"><span>岗位 *</span><input id="ae-position" class="input" value="${a ? esc(a.position) : ''}" placeholder="如：后端开发工程师"></label>
      <label class="field"><span>渠道</span>
        <select id="ae-channel">${CHANNELS.map((c) => `<option ${a && a.channel === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="field"><span>薪资范围</span><input id="ae-salary" class="input" value="${a ? esc(a.salary || '') : ''}" placeholder="如：25-40K·16薪"></label>
      <label class="field"><span>投递日期</span><input type="date" id="ae-date" value="${a ? a.date ? new Date(a.date).toISOString().slice(0, 10) : '' : new Date().toISOString().slice(0, 10)}"></label>
      <label class="field"><span>面试日期（可选）</span><input type="date" id="ae-idate" value="${a ? esc(a.interviewDate || '') : ''}"></label>
      <label class="field"><span>使用的简历版本</span>
        <select id="ae-resume">
          <option value="">未指定</option>
          ${S.resumes.map((r) => `<option value="${esc(r.id)}" ${a && a.resumeId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
        </select></label>
      <label class="field"><span>JD 链接（可选）</span><input id="ae-url" class="input" value="${a ? esc(a.jdUrl || '') : ''}" placeholder="https://…"></label>
      <label class="field" style="grid-column:1/-1"><span>备注</span><textarea id="ae-note" rows="3" placeholder="HR 联系方式、面试官风格、谈到哪一步…">${a ? esc(a.note || '') : ''}</textarea></label>
    </div>
    ${a && a.history?.length > 1 ? `
    <div class="muted" style="font-size:12px;font-weight:700;letter-spacing:.1em;margin:14px 0 6px">状态流水</div>
    ${a.history.map((h, i) => `
      <div class="tok-row" style="grid-template-columns:110px 1fr">
        <span class="muted">${new Date(h.date).toLocaleDateString('zh-CN')}</span>
        <span>${STATUSES.find((s) => s.key === h.status)?.icon || ''} ${stName(h.status)}${h.note ? ' · ' + esc(h.note) : ''}</span>
      </div>`).join('')}` : ''}
    <div class="actions" style="justify-content:flex-end">
      <button class="btn primary" id="ae-ok">${icon('check', 14)}${isNew ? '创建投递' : '保存'}</button>
    </div>`,
    { title: isNew ? '新建投递' : `${a.company} · ${a.position}`, icon: 'send', width: 720 });

  $('#ae-ok', m.el).onclick = () => {
    const company = $('#ae-company', m.el).value.trim();
    const position = $('#ae-position', m.el).value.trim();
    if (!company || !position) { toast('公司和岗位必填', 'err'); return; }
    const patch = {
      company, position,
      channel: $('#ae-channel', m.el).value,
      salary: $('#ae-salary', m.el).value.trim(),
      date: new Date($('#ae-date', m.el).value || Date.now()).getTime(),
      interviewDate: $('#ae-idate', m.el).value || '',
      resumeId: $('#ae-resume', m.el).value || null,
      jdUrl: $('#ae-url', m.el).value.trim(),
      note: $('#ae-note', m.el).value.trim(),
    };
    if (isNew) {
      S.apps.unshift({
        id: 'app-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        ...patch, status: 'applied', history: [{ status: 'applied', date: Date.now(), note: '' }],
      });
      awardXP(5, '记录一次投递');
    } else {
      Object.assign(a, patch);
    }
    persist('apps');
    m.close();
    render();
    toast(isNew ? '投递已记录，祝顺利！' : '已保存', 'ok');
  };
}

/* ---------- 从岗位雷达导入 ---------- */

function openImportFromRadar() {
  const m = openModal('<div class="skeleton-lines"><i></i><i></i><i></i></div>', { title: '从岗位雷达导入', icon: 'radar', width: 720 });
  (async () => {
    try {
      const res = await fetch('/api/jobs?limit=40');
      const j = await res.json();
      const jobs = j.jobs || [];
      if (!jobs.length) {
        $('.modal-body', m.el).innerHTML = '<p class="hint">岗位雷达还没有汇集到岗位——先去添加订阅源或手动添加 JD。</p>';
        return;
      }
      $('.modal-body', m.el).innerHTML = `
        <p class="hint">勾选要记入投递的岗位（可多选）：</p>
        ${jobs.slice(0, 20).map((x, i) => `
        <label class="tok-row" style="grid-template-columns:auto 1fr auto;cursor:pointer">
          <input type="checkbox" data-ji="${i}">
          <span><b>${esc(x.company || '未知公司')}</b> · ${esc(x.title.slice(0, 40))}</span>
          <span class="muted" style="font-size:11px">${esc(x.salary || '')}</span>
        </label>`).join('')}
        <div class="actions" style="justify-content:flex-end">
          <button class="btn primary" id="ai-ok">${icon('check', 14)}导入所选</button>
        </div>`;
      $('#ai-ok', m.el).onclick = () => {
        let n = 0;
        $$('[data-ji]', m.el).forEach((cb) => {
          if (!cb.checked) return;
          const x = jobs[Number(cb.dataset.ji)];
          S.apps.unshift({
            id: 'app-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            company: x.company || '未知公司',
            position: x.title.slice(0, 40),
            channel: '其他', salary: x.salary || '',
            date: Date.now(), interviewDate: '', resumeId: null,
            jdUrl: x.url || '', note: '来自岗位雷达导入',
            status: 'applied', history: [{ status: 'applied', date: Date.now(), note: '雷达导入' }],
          });
          n += 1;
        });
        persist('apps');
        m.close();
        render();
        toast(n ? `已导入 ${n} 条投递记录` : '没有勾选任何岗位', n ? 'ok' : 'err');
      };
    } catch (e) {
      $('.modal-body', m.el).innerHTML = `<p style="color:var(--danger)">岗位库读取失败：${esc(e.message)}</p>`;
    }
  })();
}
