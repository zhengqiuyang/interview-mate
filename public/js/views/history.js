/* 面试记录：时间线 / 筛选 / 导出 / 打印 */
import { $, $$, esc, md, icon, toast, openModal, downloadFile, printHtml, fmtDate, fmtTime, downloadShareCard } from '../core.js';
import { S } from '../state.js';
import { renderReport } from './resume.js';
import { startFlashcards } from './flashcards.js';

let filter = 'all';

export function init() { /* 筛选 chips 动态渲染 */ }

export function onShow() { render(); }

function render() {
  const chips = $('#hist-filter');
  const kinds = [
    { key: 'all', name: '全部', n: S.sessions.length },
    { key: 'mock', name: '模拟面试', n: S.sessions.filter((s) => s.kind === 'mock').length },
    { key: 'resume', name: '简历诊断', n: S.sessions.filter((s) => s.kind === 'resume').length },
  ];
  chips.innerHTML = '';
  for (const k of kinds) {
    const b = document.createElement('button');
    b.className = `chip${filter === k.key ? ' active' : ''}`;
    b.innerHTML = `${esc(k.name)}<b>${k.n}</b>`;
    b.onclick = () => { filter = k.key; render(); };
    chips.appendChild(b);
  }

  const list = S.sessions.filter((s) => filter === 'all' || s.kind === filter);
  const box = $('#history-list');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<div class="empty"><div class="empty-ico">🗂️</div>还没有记录，去来一场模拟面试吧</div>';
    return;
  }
  for (const s of list) {
    const el = document.createElement('div');
    el.className = 'h-item';
    el.innerHTML = `
      <div class="h-kind">${s.kind === 'mock' ? '🎙️' : '📋'}</div>
      <div class="h-main">
        <div class="h-title">${esc(s.title)}</div>
        <div class="h-sub">${fmtDate(s.date)}${s.elapsed ? ` · 时长 ${fmtTime(s.elapsed)}` : ''}</div>
      </div>
      ${s.score != null ? `<span class="h-score">${s.score}<small style="font-size:11px;color:var(--muted)">分</small></span>` : ''}
      <button class="btn small ghost h-view">查看</button>
      <button class="btn small ghost h-export">${icon('download', 13)}导出</button>
      <button class="btn small danger h-del">删除</button>`;
    $('.h-view', el).onclick = () => viewSession(s);
    $('.h-export', el).onclick = () => {
      const name = s.kind === 'mock' ? '面试报告' : 'JD匹配分析';
      downloadFile(`${name}-${fmtDate(s.date).slice(0, 10)}.md`, s.reportMd, 'text/markdown');
    };
    $('.h-del', el).onclick = async () => {
      const { confirmModal } = await import('../core.js');
      if (!(await confirmModal('确定删除这条记录？删除后不可恢复。'))) return;
      S.sessions = S.sessions.filter((x) => x.id !== s.id);
      localStorage.setItem('im_sessions', JSON.stringify(S.sessions));
      render();
    };
    box.appendChild(el);
  }
}

function viewSession(s) {
  const isMock = s.kind === 'mock';
  if (!isMock && s.reportJson) {
    // 结构化简历诊断报告
    const m = openModal('', { title: '简历诊断报告', icon: 'clipboard', width: 820 });
    $('.modal-body', m.el).innerHTML = '';
    $('.modal-body', m.el).appendChild(renderReport(s.reportJson));
    return;
  }
  const m = openModal('', { title: isMock ? '模拟面试报告' : 'JD 匹配分析', icon: isMock ? 'mic' : 'clipboard', width: 780 });
  $('.modal-body', m.el).innerHTML = `
    <div class="md">${md(s.reportMd)}</div>
    <div class="result-tools">
      ${isMock ? '<button class="btn small ghost" id="hv-share">✨ 生成分享图</button>' : ''}
      <button class="btn small ghost" id="hv-print">${icon('printer', 14)}打印 / 存为 PDF</button>
      <button class="btn small ghost" id="hv-export">${icon('download', 14)}导出 Markdown</button>
    </div>`;
  const shareBtn = $('#hv-share', m.el);
  if (shareBtn) {
    shareBtn.onclick = () => {
      const scoreM = s.reportMd.match(/总体评分[：:]*\s*(\d{1,3})\s*(?:\/|分)?\s*100/);
      const dims = [];
      const re = /[-*]\s*([^\s：:（(]{2,10})[：:]\s*(\d{1,2}(?:\.\d+)?)\s*\/\s*10/g;
      let mm;
      while ((mm = re.exec(s.reportMd))) dims.push({ name: mm[1], score: Number(mm[2]) });
      downloadShareCard({
        title: '模拟面试成绩单',
        subtitle: s.title,
        score: scoreM ? Number(scoreM[1]) : (s.score ?? 0),
        dims,
      }, `面试成绩单-${fmtDate(s.date).slice(0, 10)}.png`);
      toast('分享图已生成', 'ok');
    };
  }
  $('#hv-print', m.el).onclick = () => {
    const title = isMock ? '面试评估报告' : 'JD 匹配分析';
    printHtml(title, `<h1>${title}</h1>${md(s.reportMd)}`);
  };
  $('#hv-export', m.el).onclick = () => {
    const name = isMock ? '面试报告' : 'JD匹配分析';
    downloadFile(`${name}-${fmtDate(s.date).slice(0, 10)}.md`, s.reportMd, 'text/markdown');
  };
}
