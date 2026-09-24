/* 面试记录：时间线 / 筛选 / 导出 / 打印 */
import { $, $$, esc, md, icon, toast, openModal, downloadFile, printHtml, fmtDate, fmtTime, downloadShareCard, staggerIn } from '../core.js';
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
    box.innerHTML = `<div class="empty"><div class="empty-ico">${icon('folder', 36)}</div>还没有记录，去来一场模拟面试吧</div>`;
    return;
  }
  for (const s of list) {
    const el = document.createElement('div');
    el.className = 'h-item';
    el.innerHTML = `
      <div class="h-kind">${s.kind === 'mock' ? icon('mic', 18) : icon('clipboard', 18)}</div>
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
  staggerIn(box, '.h-item');
}

/* ---------- 语音复盘：录音回放 + 填充词 / 语速分析 ---------- */

const FILLER_WORDS = ['嗯', '啊', '呃', '然后', '就是', '那个', '其实', '这个'];

function fillerStats(text) {
  const t = String(text || '');
  const counts = {};
  let total = 0;
  for (const w of FILLER_WORDS) {
    const n = t.split(w).length - 1;
    if (n) { counts[w] = n; total += n; }
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { total, top, chars: t.replace(/\s/g, '').length };
}

function renderVoiceReview(s) {
  const msgs = s.messages || [];
  const pairs = [];
  let q = '';
  for (const msg of msgs) {
    if (msg.role === 'assistant') q = msg.content;
    else pairs.push({ q: q.split('\n')[0].slice(0, 70), a: msg.content, audio: msg.audio });
  }
  const withAudio = pairs.filter((p) => p.audio);
  if (!pairs.length) return '<p class="hint">本场会话未保存问答明细。</p>';
  if (!withAudio.length) {
    return `<p class="hint">本场没有录音（语音模式下会自动录音）。以下是问答文字回顾：</p>
      ${pairs.map((p) => `
        <div class="vr-row">
          <div class="vr-q">Q：${esc(p.q)}</div>
          <div class="vr-a">${esc((p.a || '').slice(0, 160))}${(p.a || '').length > 160 ? '…' : ''}</div>
        </div>`).join('')}`;
  }
  // 汇总统计
  let totalFiller = 0, totalChars = 0, totalDur = 0;
  for (const p of withAudio) {
    const st = fillerStats(p.a);
    totalFiller += st.total; totalChars += st.chars; totalDur += p.audio.dur || 0;
  }
  const avgSpeed = totalDur ? Math.round(totalChars / totalDur * 60) : null;
  const speedTip = avgSpeed == null ? '' : avgSpeed > 300
    ? '语速偏快，试着在关键结论前停半拍'
    : avgSpeed < 120 ? '语速偏慢，注意减少长停顿' : '语速适中，保持';
  return `
    <div class="tiles" style="margin-bottom:12px">
      <div class="tile"><div class="tile-ico warn">${icon('volume', 18)}</div>
        <div><div class="tile-num">${withAudio.length}</div><div class="tile-label">录音回答</div></div></div>
      <div class="tile"><div class="tile-ico">${icon('zap', 18)}</div>
        <div><div class="tile-num">${totalFiller}</div><div class="tile-label">填充词总数</div></div></div>
      <div class="tile"><div class="tile-ico ok">${icon('clock', 18)}</div>
        <div><div class="tile-num">${avgSpeed ?? '—'}</div><div class="tile-label">平均语速（字/分）${avgSpeed ? '· ' + speedTip : ''}</div></div></div>
    </div>
    ${withAudio.map((p, i) => {
      const st = fillerStats(p.a);
      const speed = p.audio.dur ? Math.round(st.chars / p.audio.dur * 60) : null;
      return `
      <div class="vr-row">
        <div class="vr-q">${i + 1}. ${esc(p.q)}</div>
        <audio controls preload="none" src="${esc(p.audio.url)}"></audio>
        <div class="vr-meta">
          <span class="badge">${p.audio.dur}s</span>
          ${speed ? `<span class="badge ${speed > 300 || speed < 120 ? 'warn' : 'ok'}">${speed} 字/分</span>` : ''}
          ${st.top.length ? `<span class="badge warn">填充词：${st.top.map(([w, n]) => `${w}×${n}`).join('、')}</span>` : '<span class="badge ok">无填充词</span>'}
        </div>
        <details class="vr-text"><summary>文字稿</summary>${esc(p.a)}</details>
      </div>`;
    }).join('')}`;
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
  const hasVoice = isMock && s.messages?.length;
  const m = openModal(`
    ${hasVoice ? `
    <div class="seg" id="hv-tabs" style="margin-bottom:14px">
      <button data-t="report" class="active">报告</button>
      <button data-t="voice">🎧 语音复盘</button>
    </div>` : ''}
    <div id="hv-report-pane">
      <div class="md">${md(s.reportMd)}</div>
      <div class="result-tools">
        ${isMock ? '<button class="btn small ghost" id="hv-share">✨ 生成分享图</button>' : ''}
        <button class="btn small ghost" id="hv-print">${icon('printer', 14)}打印 / 存为 PDF</button>
        <button class="btn small ghost" id="hv-export">${icon('download', 14)}导出 Markdown</button>
      </div>
    </div>
    ${hasVoice ? '<div id="hv-voice-pane" class="hidden"></div>' : ''}`,
    { title: isMock ? '模拟面试报告' : 'JD 匹配分析', icon: isMock ? 'mic' : 'clipboard', width: 780 });
  if (hasVoice) {
    $$('#hv-tabs button', m.el).forEach((b) => {
      b.onclick = () => {
        $$('#hv-tabs button', m.el).forEach((x) => x.classList.toggle('active', x === b));
        $('#hv-report-pane', m.el).style.display = b.dataset.t === 'report' ? 'block' : 'none';
        const vp = $('#hv-voice-pane', m.el);
        vp.style.display = b.dataset.t === 'voice' ? 'block' : 'none';
        if (b.dataset.t === 'voice' && !vp.childElementCount) vp.innerHTML = renderVoiceReview(s);
      };
    });
  }
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
