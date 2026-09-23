/* 模拟面试：AI 面试官逐题追问 + 评估报告 + 语音 */
import { $, $$, esc, md, icon, toast, downloadFile, printHtml, fmtTime, confetti, animateRing, downloadShareCard } from '../core.js';
import { S, persist } from '../state.js';
import { streamChat, hasKey } from '../api.js';
import { switchView } from '../router.js';
import { markActivity } from '../srs.js';
import { awardXP } from '../gamify.js';

const ROLE_NAMES = {
  fe: '前端工程师', java: '后端（Java）', go: '后端（Go）', algo: '算法工程师',
  test: '测试工程师', pm: '产品经理', general: '通用软件工程师',
};
const TYPE_NAMES = {
  basics: '技术基础面', project: '项目深挖面', system: '系统设计面',
  behavior: '行为面试', mixed: '综合模拟',
};
const LEVEL_NAMES = { intern: '实习/校招', junior: '初级', senior: '中高级' };

let mock = null; // 进行中的面试会话

/* ---------- 四轮闯关（面试故事线） ---------- */
const CAMPAIGN_ROUNDS = [
  { label: '技术一面', type: 'basics', level: 'junior', count: 3 },
  { label: '项目二面', type: 'project', level: 'junior', count: 4 },
  { label: '系统设计三面', type: 'system', level: 'senior', count: 3 },
  { label: 'HR 终面', type: 'behavior', level: 'junior', count: 3 },
];

function renderRoundChips() {
  const box = $('#chat-rounds');
  const c = S.campaign;
  if (!box) return;
  if (!c || !c.active) { box.innerHTML = ''; return; }
  box.innerHTML = c.rounds.map((r, i) => {
    const cls = r.status === 'done' ? 'ok' : i === c.idx && mock ? 'warn' : '';
    const ico = r.status === 'done' ? '✓' : i === c.idx && mock ? '●' : String(i + 1);
    return `<span class="badge ${cls}" title="${esc(r.label)}">${ico} ${esc(r.label)}${r.score != null ? ` ${r.score}分` : ''}</span>`;
  }).join(' ');
}

export function init() {
  $('#btn-goto-settings').addEventListener('click', () => switchView('settings'));
  $('#mock-count').addEventListener('input', (e) => { $('#mock-count-out').textContent = e.target.value; });
  $('#btn-start-mock').addEventListener('click', startMock);
  $('#btn-send').addEventListener('click', sendAnswer);
  $('#btn-stop').addEventListener('click', () => mock?._ctrl?.abort());
  $('#btn-end-mock').addEventListener('click', () => {
    if (!mock || mock.ended) return;
    if (mock.busy) mock._ctrl?.abort();
    requestMock('我想结束面试，请给出评估报告。', { forceReport: true });
  });
  $('#btn-restart-mock').addEventListener('click', resetMock);
  $('#btn-speak').addEventListener('click', toggleSpeak);
  $('#btn-mic').addEventListener('click', toggleMic);
  $('#btn-voice').addEventListener('click', toggleVoiceLoop);

  // 单场 / 闯关 模式切换
  $$('[data-mode]').forEach((b) => {
    b.addEventListener('click', () => {
      $$('[data-mode]').forEach((x) => x.classList.toggle('active', x === b));
      const isC = b.dataset.mode === 'campaign';
      ['mock-role', 'mock-level', 'mock-lang'].forEach((id) => $('#' + id).disabled = isC);
      $('#mock-type').disabled = isC;
      $('#mock-count').disabled = isC;
    });
  });

  const chatInput = $('#chat-input');
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAnswer(); }
  });
  chatInput.addEventListener('input', () => autoGrow(chatInput));
}

export function onShow() {
  $('#mock-nokey').classList.toggle('hidden', hasKey());
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
}

/* ---------- 语音：朗读面试官提问 ---------- */
function speakable(text) {
  return text
    .replace(/[#*`>\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function speakText(text, onend) {
  if (!('speechSynthesis' in window)) { onend?.(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(speakable(text).slice(0, 600));
  u.lang = mock?.cfg?.lang === 'en' ? 'en-US' : 'zh-CN';
  u.rate = 1.02;
  u.onend = () => onend?.();
  u.onerror = () => onend?.();
  speechSynthesis.speak(u);
}

function toggleSpeak() {
  const btn = $('#btn-speak');
  const on = !btn.classList.contains('on');
  btn.classList.toggle('on', on);
  if (!on && 'speechSynthesis' in window) speechSynthesis.cancel();
  toast(on ? '已开启朗读，面试官提问将自动播报' : '已关闭朗读');
}

/* ---------- 语音：整场语音面试（自动朗读 → 聆听 → 自动发送） ---------- */
let voiceOn = false;
let voiceRecog = null;
let voiceSilence = null;

function toggleVoiceLoop() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('语音整场面试需要 Chrome / Edge', 'err'); return; }
  voiceOn = !voiceOn;
  $('#btn-voice').classList.toggle('on', voiceOn);
  if (!voiceOn) {
    stopVoiceListen();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    toast('语音整场面试已关闭');
    return;
  }
  toast('语音模式开启：面试官提问自动播报，说完自动聆听你的回答', 'ok');
  // 立即播报最新一条面试官消息
  const last = mock?.messages[mock.messages.length - 1];
  if (mock && !mock.ended && last?.role === 'assistant' && !mock.busy) {
    speakText(last.content, () => startVoiceListen());
  }
}

function stopVoiceListen() {
  clearTimeout(voiceSilence);
  if (voiceRecog) { try { voiceRecog.onend = null; voiceRecog.stop(); } catch (_) { /* noop */ } voiceRecog = null; }
}

function startVoiceListen() {
  if (!voiceOn || !mock || mock.ended || mock.busy) return;
  if ('speechSynthesis' in window && speechSynthesis.speaking) {
    setTimeout(startVoiceListen, 400);
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  stopVoiceListen();
  const r = new SR();
  voiceRecog = r;
  r.lang = mock.cfg.lang === 'en' ? 'en-US' : 'zh-CN';
  r.continuous = true;
  r.interimResults = true;
  const ta = $('#chat-input');
  let base = '';
  ta.placeholder = '🎤 正在聆听…（停顿即自动发送，点击语音模式按钮退出）';
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) base += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    ta.value = (base + interim).trim();
    clearTimeout(voiceSilence);
    // 停顿 1.6s 视为回答完毕
    voiceSilence = setTimeout(() => {
      stopVoiceListen();
      ta.placeholder = '输入你的回答（Enter 发送，Shift + Enter 换行）';
      if (ta.value.trim().length >= 2) sendAnswer();
      else startVoiceListen();
    }, 1600);
  };
  r.onerror = (e) => {
    if (e.error === 'no-speech') return;
    ta.placeholder = '输入你的回答（Enter 发送，Shift + Enter 换行）';
    voiceRecog = null;
  };
  r.onend = () => { voiceRecog = null; };
  try { r.start(); } catch (_) { /* 已在运行 */ }
}
let recog = null;
function toggleMic() {
  const btn = $('#btn-mic');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('当前浏览器不支持语音识别，建议使用 Chrome / Edge', 'err'); return; }
  if (recog) { recog.stop(); return; }
  recog = new SR();
  recog.lang = mock?.cfg?.lang === 'en' ? 'en-US' : 'zh-CN';
  recog.continuous = true;
  recog.interimResults = true;
  let finalText = $('#chat-input').value ? $('#chat-input').value + ' ' : '';
  recog.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    $('#chat-input').value = (finalText + interim).trim();
    autoGrow($('#chat-input'));
  };
  recog.onend = () => { recog = null; btn.classList.remove('recording', 'on'); };
  recog.onerror = (e) => {
    recog = null; btn.classList.remove('recording', 'on');
    if (e.error !== 'aborted') toast('语音识别出错：' + e.error, 'err');
  };
  recog.start();
  btn.classList.add('recording', 'on');
  toast('正在聆听…再点一次结束', 'ok');
}

/* ---------- 面试流程 ---------- */
function startMock() {
  if (!hasKey()) {
    toast('请先在「设置」中配置 API Key', 'err');
    switchView('settings');
    return;
  }
  const campaignMode = $('[data-mode].active')?.dataset.mode === 'campaign';
  let cfg = {
    role: $('#mock-role').value,
    type: $('#mock-type').value,
    level: $('#mock-level').value,
    lang: $('#mock-lang').value,
    count: Number($('#mock-count').value),
  };
  if (campaignMode) {
    S.campaign = {
      active: true, idx: 0,
      rounds: CAMPAIGN_ROUNDS.map((r) => ({ ...r, status: 'pending', score: null })),
      role: cfg.role, lang: cfg.lang,
    };
    persist('campaign');
    const r0 = S.campaign.rounds[0];
    cfg = { ...cfg, type: r0.type, level: r0.level, count: r0.count };
  }
  mock = {
    cfg, messages: [], answers: 0,
    startedAt: Date.now(), elapsed: 0,
    busy: false, ended: false, report: null, speakOn: $('#btn-speak').classList.contains('on'),
  };

  $('#mock-setup').classList.add('hidden');
  $('#mock-chat').classList.remove('hidden');
  $('#chat-messages').innerHTML = '';
  $('#chat-target').textContent = cfg.count;
  $('#chat-config-label').textContent = campaignMode
    ? `闯关模式 · ${ROLE_NAMES[cfg.role] || cfg.role} · ${S.campaign.rounds[0].label}`
    : `${ROLE_NAMES[cfg.role] || cfg.role} · ${TYPE_NAMES[cfg.type] || cfg.type} · ${LEVEL_NAMES[cfg.level] || cfg.level}`;
  renderRoundChips();

  clearInterval(mock._timer);
  mock._timer = setInterval(() => {
    if (!mock) return;
    mock.elapsed = Math.floor((Date.now() - mock.startedAt) / 1000);
    $('#chat-timer').textContent = fmtTime(mock.elapsed);
  }, 1000);
  $('#chat-timer').textContent = '00:00';
  $('#chat-messages').innerHTML = '<div class="skeleton-lines"><i></i><i></i><i></i></div>';

  requestMock(null);
}

function addBubble(role, text = '') {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role === 'user' ? 'user' : 'ai'}`;
  wrap.innerHTML = `
    <div class="avatar">${role === 'user' ? icon('user') : icon('mic')}</div>
    <div class="bubble md"></div>
    ${role === 'user' ? '' : '<button class="msg-copy" title="复制本条">⧉ 复制</button>'}`;
  $('.bubble', wrap).innerHTML = text ? md(text) : '<span class="typing"><i></i><i></i><i></i></span>';
  const box = $('#chat-messages');
  $$('.skeleton-lines', box).forEach((s) => s.remove());
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
  return $('.bubble', wrap);
}

function setBusy(busy) {
  if (mock) mock.busy = busy;
  $('#btn-send').disabled = busy;
  $('#btn-stop').classList.toggle('hidden', !busy);
}

async function requestMock(userText, opts = {}) {
  if (!mock) return;
  const m = mock;
  if (userText !== null) m.messages.push({ role: 'user', content: userText });

  const forceReport = opts.forceReport || m.answers >= m.cfg.count;
  const bubble = addBubble('ai');
  const ctrl = new AbortController();
  m._ctrl = ctrl;
  setBusy(true);
  let full = '';
  try {
    await streamChat(
      { mode: 'mock', mockConfig: m.cfg, forceReport, messages: m.messages },
      (delta) => {
        full += delta;
        bubble.innerHTML = md(full);
        $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
      },
      ctrl.signal
    );
    m.messages.push({ role: 'assistant', content: full });
    if (forceReport) finishMock(full);
    else {
      // 语音整场模式：自动播报 → 聆听；或普通朗读开关
      if (voiceOn) speakText(full, () => startVoiceListen());
      else if ($('#btn-speak').classList.contains('on')) speakText(full);
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      if (full) m.messages.push({ role: 'assistant', content: full });
      bubble.innerHTML = md(full + '\n\n*（已停止生成）*');
    } else {
      bubble.innerHTML = `<p style="color:var(--danger)">出错了：${esc(e.message)}</p>`;
    }
  } finally {
    setBusy(false);
    if (forceReport) m.ended = true;
    updateQNum();
  }
}

function updateQNum() {
  if (!mock) return;
  $('#chat-qnum').textContent = String(Math.min(mock.answers + 1, mock.cfg.count));
}

function sendAnswer() {
  if (!mock || mock.busy || mock.ended) return;
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  autoGrow(input);
  if (recog) recog.stop();
  addBubble('user', text);
  mock.answers += 1;
  markActivity();
  awardXP(10);
  updateQNum();
  requestMock(text);
}

/** 从报告 Markdown 中提取总分与分项评分 */
function parseReport(text) {
  const totalM = text.match(/总体评分[：:]*\s*(\d{1,3})\s*(?:\/|分)?\s*100/) ||
    text.match(/(\d{1,3})\s*\/\s*100/);
  const dims = [];
  const re = /[-*]\s*([^\s：:（(]{2,10})[：:]\s*(\d{1,2}(?:\.\d+)?)\s*\/\s*10/g;
  let mm;
  while ((mm = re.exec(text))) dims.push({ name: mm[1], score: Number(mm[2]) });
  const body = text
    .split(/\n(?=#)/)
    .filter((sec) => !/^(#|##)\s*(面试评估报告|总体评分|分项评分)/.test(sec.trim()))
    .join('\n');
  return { total: totalM ? Number(totalM[1]) : null, dims, body, raw: text };
}

function finishMock(reportMd) {
  const m = mock;
  if (!m) return;
  clearInterval(m._timer);
  m.ended = true;
  m.report = reportMd;
  if ('speechSynthesis' in window) speechSynthesis.cancel();

  const { total, dims, body, raw } = parseReport(reportMd);
  const card = document.createElement('div');
  card.className = 'report-card';
  card.innerHTML = `
    <div class="report-head">
      <div class="score-ring" style="--p:${total || 0}">
        <span>${total ?? '—'}<small>/100</small></span>
      </div>
      <div class="dim-list">
        ${(dims.length ? dims : [{ name: '综合', score: null }]).map((d) => `
          <div class="dim-row">
            <span>${esc(d.name)}</span>
            <div class="bar"><i style="width:${d.score ? Math.min(d.score * 10, 100) : 0}%"></i></div>
            <span class="val">${d.score ?? '—'}/10</span>
          </div>`).join('')}
      </div>
    </div>
    <div class="md">${md(body || raw)}</div>
    <div class="report-actions">
      <button class="btn small ghost" id="rp-share">${icon('star', 14)}生成分享图</button>
      <button class="btn small ghost" id="rp-export">${icon('download', 14)}导出 Markdown</button>
      <button class="btn small ghost" id="rp-print">${icon('printer', 14)}打印 / 存为 PDF</button>
      <button class="btn small primary" id="rp-again">${icon('rotate', 14)}再来一场</button>
    </div>`;
  $('#chat-messages').appendChild(card);
  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
  requestAnimationFrame(() => animateRing($('.score-ring', card), total ?? 0));
  if ((total ?? 0) >= 80) confetti(2200);
  $('#rp-share').onclick = () => {
    downloadShareCard({
      title: '模拟面试成绩单',
      subtitle: `${ROLE_NAMES[m.cfg.role] || ''} · ${TYPE_NAMES[m.cfg.type] || ''}`,
      score: total ?? 0,
      dims,
    }, `面试成绩单-${new Date().toISOString().slice(0, 10)}.png`);
    toast('分享图已生成，去下载文件夹查看', 'ok');
  };
  $('#rp-export').onclick = () => downloadFile(`面试报告-${new Date().toISOString().slice(0, 10)}.md`, raw, 'text/markdown');
  $('#rp-print').onclick = () => printHtml('面试评估报告', `<h1>面试评估报告</h1>${md(raw)}`);
  $('#rp-again').onclick = resetMock;

  // 闯关模式：推进轮次
  const c = S.campaign;
  if (c?.active && c.idx < c.rounds.length) {
    const round = c.rounds[c.idx];
    round.status = 'done';
    round.score = total;
    c.idx += 1;
    const hasNext = c.idx < c.rounds.length;
    persist('campaign');
    renderRoundChips();
    const act = $('#rp-again');
    if (hasNext) {
      act.innerHTML = `${icon('play', 14)}进入下一轮：${esc(c.rounds[c.idx].label)}`;
      act.onclick = () => {
        resetMock();
        const nr = S.campaign.rounds[S.campaign.idx];
        const cfg2 = {
          role: S.campaign.role, type: nr.type, level: nr.level,
          lang: S.campaign.lang, count: nr.count,
        };
        // 直接以该轮配置开始
        mock = null;
        startCampaignRound(cfg2, nr.label);
      };
    } else {
      act.innerHTML = `${icon('trophy', 14)}查看最终裁定`;
      act.onclick = renderCampaignVerdict;
    }
  }

  S.sessions.unshift({
    id: `mock-${Date.now()}`,
    kind: 'mock',
    date: Date.now(),
    title: `${ROLE_NAMES[m.cfg.role] || ''} · ${TYPE_NAMES[m.cfg.type] || ''}`,
    score: total,
    reportMd: raw,
    elapsed: m.elapsed,
  });
  S.sessions = S.sessions.slice(0, 100);
  localStorage.setItem('im_sessions', JSON.stringify(S.sessions));
  markActivity();
  awardXP(30, '完成一场模拟面试');
  if ((total ?? 0) >= 80) awardXP(20, '高分奖励');
  toast('评估报告已生成，并存入「面试记录」', 'ok');
}

function resetMock() {
  if (mock && mock.busy) mock._ctrl?.abort();
  clearInterval(mock?._timer);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  stopVoiceListen();
  voiceOn = false;
  $('#btn-voice')?.classList.remove('on');
  mock = null;
  $('#mock-chat').classList.add('hidden');
  $('#mock-setup').classList.remove('hidden');
}

/* 以指定轮次配置直接开始一轮闯关面试 */
function startCampaignRound(cfg, roundLabel) {
  mock = {
    cfg, messages: [], answers: 0,
    startedAt: Date.now(), elapsed: 0,
    busy: false, ended: false, report: null, speakOn: false,
  };
  $('#mock-setup').classList.add('hidden');
  $('#mock-chat').classList.remove('hidden');
  $('#chat-messages').innerHTML = '';
  $('#chat-target').textContent = cfg.count;
  $('#chat-config-label').textContent = `闯关模式 · ${ROLE_NAMES[cfg.role] || cfg.role} · ${roundLabel}`;
  renderRoundChips();
  clearInterval(mock._timer);
  mock._timer = setInterval(() => {
    if (!mock) return;
    mock.elapsed = Math.floor((Date.now() - mock.startedAt) / 1000);
    $('#chat-timer').textContent = fmtTime(mock.elapsed);
  }, 1000);
  $('#chat-timer').textContent = '00:00';
  $('#chat-messages').innerHTML = '<div class="skeleton-lines"><i></i><i></i><i></i></div>';
  requestMock(null);
}

/* 闯关终局：本地合成最终裁定 */
function renderCampaignVerdict() {
  const c = S.campaign;
  const done = c.rounds.filter((r) => r.status === 'done' && r.score != null);
  const avg = done.length ? Math.round(done.reduce((a, r) => a + r.score, 0) / done.length) : 0;
  const verdictText = avg >= 85
    ? '表现出色，各轮稳定发挥。保持状态，重点在面试表达的自然度与反问环节的质量。'
    : avg >= 70
      ? '整体过关，离「强 offer」还差一到两个技术面的深度。针对低分轮次的主题做定向补强后可再闯一次。'
      : '当前通过率偏低——建议回到「复习中心」把基础轮覆盖的知识点过一遍，再用智能体教练生成冲刺计划，两周后再战。';
  const card = document.createElement('div');
  card.className = 'report-card';
  card.innerHTML = `
    <div class="report-head">
      <div class="score-ring" style="--p:0"><span>--<small>/100</small></span></div>
      <div class="dim-list">
        <div style="font-weight:800;font-size:16px;margin-bottom:6px">🏁 四轮闯关完成 · 最终裁定</div>
        ${done.map((r) => `
          <div class="dim-row">
            <span>${esc(r.label)}</span>
            <div class="bar"><i style="width:${r.score}%"></i></div>
            <span class="val">${r.score}/100</span>
          </div>`).join('')}
      </div>
    </div>
    <div class="md"><p>${esc(verdictText)}</p></div>
    <div class="report-actions">
      <button class="btn small ghost" id="cv-done">结束闯关</button>
    </div>`;
  $('#chat-messages').appendChild(card);
  card.scrollIntoView({ behavior: 'smooth' });
  animateRing($('.score-ring', card), avg);
  $('.score-ring span', card).innerHTML = `${avg}<small>/100</small>`;
  if (avg >= 75) confetti(2400);
  $('#cv-done', card).onclick = () => {
    S.campaign = null;
    persist('campaign');
    resetMock();
  };
}
