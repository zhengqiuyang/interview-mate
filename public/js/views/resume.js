/* 简历工坊：多版本管理 + 结构化 JD 诊断 + AI 润色 */
import { $, $$, esc, md, icon, toast, openModal, confirmModal, downloadFile, printHtml, radarChart, animateRing } from '../core.js';
import { S, persist, remergeBank } from '../state.js';
import { streamChat, hasKey } from '../api.js';
import { switchView } from '../router.js';
import { markActivity } from '../srs.js';
import { awardXP } from '../gamify.js';
import { render as renderBank } from './bank.js';
import { render as renderDashboard } from './dashboard.js';

const SAMPLE_RESUME = `张三 | 本科 · 计算机科学与技术 | 3 年经验

工作经历：
XX 科技有限公司 · 后端开发工程师（2023.07 - 至今）
- 负责订单中心微服务开发与维护，QPS 峰值 3000+
- 主导慢查询治理，核心接口 P99 从 800ms 降至 120ms
- 搭建 CI/CD 流水线，发布耗时从 30 分钟缩短到 8 分钟

项目经历：
电商订单系统重构（核心开发）
- 将单体拆分为订单/库存/支付三个服务，引入 RabbitMQ 异步解耦
- 设计 Redis + Lua 预扣库存方案，秒杀场景超卖为 0

技能：Java / Spring Boot / MySQL / Redis / RabbitMQ / Docker`;

const SAMPLE_JD = `岗位：高级后端开发工程师（Java）
职责：
- 负责核心交易系统的设计与开发，保障高并发下的稳定性
- 参与技术方案评审，推动服务性能与可用性优化
要求：
- 本科以上，3 年以上 Java 后端经验，基础扎实
- 熟悉 Spring 生态、MySQL 索引优化、JVM 调优
- 熟悉 Redis、消息队列，有分布式系统实战经验
- 有高并发场景（秒杀/抢购）经验者优先
- 良好的沟通与跨团队协作能力`;

let currentId = null;

export function init() {
  $('#btn-analyze').addEventListener('click', analyzeResume);
  $('#btn-fill-sample').addEventListener('click', () => {
    $('#jd-text').value = SAMPLE_JD;
    if (!S.resumes.length) {
      S.resumes.push({ id: 'rs-' + Date.now(), name: '示例简历', content: SAMPLE_RESUME, updated: Date.now() });
      persist('resumes');
      currentId = S.resumes[0].id;
    }
    renderList();
    toast('已填入示例，可直接生成报告', 'ok');
  });
  $('#btn-rs-upload')?.addEventListener('click', () => $('#file-rs-upload')?.click());
  $('#file-rs-upload')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) handleResumeFile(f);
    e.target.value = '';
  });
  // 拖放到左侧卡片直接解析
  const dropZone = $('.rs-left');
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--brand)'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = ''; });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = '';
      const f = e.dataTransfer?.files?.[0];
      if (f) handleResumeFile(f);
    });
  }
  $('#btn-rs-add').addEventListener('click', () => {
    const name = prompt('新版本名称：', `简历 v${S.resumes.length + 1}`);
    if (name === null) return;
    const r = { id: 'rs-' + Date.now(), name: name.trim() || `v${S.resumes.length + 1}`, content: $('#resume-text').value, updated: Date.now() };
    S.resumes.push(r);
    persist('resumes');
    currentId = r.id;
    renderList();
    toast('新版本已创建', 'ok');
  });
  $('#btn-rs-save').addEventListener('click', saveCurrent);
  $('#btn-rs-del').addEventListener('click', async () => {
    if (!currentId) return;
    if (!(await confirmModal('删除当前简历版本？'))) return;
    S.resumes = S.resumes.filter((r) => r.id !== currentId);
    persist('resumes');
    currentId = S.resumes[0]?.id || null;
    renderList();
    toast('已删除', 'ok');
  });
  $('#btn-rs-polish').addEventListener('click', polishResume);
}

export function onShow() { renderList(); }

/* ---------- 版本管理 ---------- */

function saveCurrent(silent = false) {
  const r = S.resumes.find((x) => x.id === currentId);
  const content = $('#resume-text').value;
  if (!r) {
    if (!content.trim()) { if (!silent) toast('先填写简历内容', 'err'); return; }
    S.resumes.push({ id: 'rs-' + Date.now(), name: '默认版本', content, updated: Date.now() });
    currentId = S.resumes[0].id;
  } else {
    r.content = content;
    r.updated = Date.now();
  }
  persist('resumes');
  renderList();
  if (!silent) toast('已保存', 'ok');
}

function renderList() {
  const box = $('#rs-list');
  box.innerHTML = S.resumes.length
    ? S.resumes.map((r) => `<button class="chip${r.id === currentId ? ' active' : ''}" data-id="${esc(r.id)}">${esc(r.name)}</button>`).join('')
    : '<span class="hint" style="margin:0">还没有简历版本——粘贴内容后点「保存」或「新建版本」</span>';
  $$('[data-id]', box).forEach((b) => {
    b.onclick = () => {
      saveCurrent(true); // 切换前自动保存
      currentId = b.dataset.id;
      renderList();
    };
  });
  const cur = S.resumes.find((x) => x.id === currentId);
  if (cur && $('#resume-text').value !== cur.content) $('#resume-text').value = cur.content;
  $('#rs-meta').textContent = cur
    ? `当前版本「${cur.name}」· 更新于 ${new Date(cur.updated).toLocaleString('zh-CN')}`
    : '提示：可维护多个版本（校招/社招/某公司定制），切换时自动保存';
}

/* ---------- JSON 提取 ---------- */

function extractJson(text) {
  const t = text.replace(/```json|```/g, '').trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('AI 未返回 JSON（可能被截断，请重试）');
  return JSON.parse(t.slice(s, e + 1));
}

/* ---------- 结构化诊断 ---------- */

async function analyzeResume() {
  saveCurrent(true);
  const resume = $('#resume-text').value.trim();
  const jd = $('#jd-text').value.trim();
  if (!resume || !jd) { toast('简历和 JD 都要填写哦', 'err'); return; }
  if (!hasKey()) { toast('请先在「设置」中配置 API Key', 'err'); switchView('settings'); return; }

  const btn = $('#btn-analyze');
  const status = $('#resume-status');
  btn.disabled = true;
  status.textContent = '分析中…';

  const result = $('#resume-result');
  result.innerHTML = '<div class="card"><div class="skeleton-lines"><i></i><i></i><i></i></div></div>';

  const prompt = `【简历内容】\n${resume}\n\n【目标岗位 JD】\n${jd}`;
  let full = '';
  try {
    await streamChat(
      { mode: 'resume', messages: [{ role: 'user', content: prompt }] },
      (d) => { full += d; }
    );
    status.textContent = '';
    let parsed = null;
    try { parsed = extractJson(full); } catch (_) { parsed = null; }
    if (parsed && typeof parsed.score === 'number') {
      result.innerHTML = '';
      result.appendChild(renderReport(parsed, jd));
      S.sessions.unshift({
        id: `resume-${Date.now()}`,
        kind: 'resume',
        date: Date.now(),
        title: (jd.split('\n')[0] || '简历诊断').slice(0, 30),
        score: parsed.score,
        reportJson: parsed,
        reportMd: full,
      });
    } else {
      // JSON 解析失败 → 降级为 Markdown 展示
      result.innerHTML = `<div class="card md">${md(full)}</div>`;
      S.sessions.unshift({
        id: `resume-${Date.now()}`, kind: 'resume', date: Date.now(),
        title: (jd.split('\n')[0] || '简历诊断').slice(0, 30), score: null, reportMd: full,
      });
    }
    S.sessions = S.sessions.slice(0, 100);
    localStorage.setItem('im_sessions', JSON.stringify(S.sessions));
    markActivity();
    awardXP(25, '完成简历诊断');
    toast('诊断完成，已存入「面试记录」', 'ok');
  } catch (e) {
    status.textContent = '';
    result.innerHTML = `<div class="card"><p style="color:var(--danger)">出错了：${esc(e.message)}</p></div>`;
  } finally {
    btn.disabled = false;
  }
}

const STATUS_META = {
  covered: { label: '已覆盖', cls: 'ok', ico: '✓' },
  partial: { label: '部分覆盖', cls: 'warn', ico: '～' },
  missing: { label: '缺失', cls: '', ico: '✕' },
};
const PRIO_META = { high: ['高', 'warn'], mid: ['中', ''], low: ['低', ''] };

/* 结构化报告（诊断与历史回看共用） */
export function renderReport(p, jdText = '') {
  const el = document.createElement('div');
  el.className = 'rs-report';
  const cov = (p.coverage || []).map((c) => {
    const m = STATUS_META[c.status] || STATUS_META.missing;
    return `
      <div class="cov-row">
        <span class="badge ${m.cls}">${m.ico} ${m.label}</span>
        <div class="cov-main">
          <div style="font-weight:600">${esc(c.req)}</div>
          <div class="muted" style="font-size:12.5px">${esc(c.evidence || '')}</div>
        </div>
      </div>`;
  }).join('');
  const risks = (p.risks || []).map((r) => `
    <div class="risk-row">
      <div><b>⚠ ${esc(r.issue)}</b><div class="muted" style="font-size:13px">${esc(r.fix || '')}</div></div>
      ${r.example ? `<div class="risk-example">${esc(r.example)}</div>` : ''}
    </div>`).join('');
  const followups = (p.followups || []).map((f, i) => {
    const [label, cls] = PRIO_META[f.priority] || PRIO_META.mid;
    return `
      <div class="fu-row">
        <span class="muted" style="width:26px">${i + 1}.</span>
        <span style="flex:1">${esc(f.q)}</span>
        <span class="badge ${cls}">${label}频</span>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="card rs-hero">
      <div class="rs-ring-col">
        <div class="score-ring big" style="--p:0"><span>--<small>/100</small></span></div>
        <div class="rs-verdict">${esc(p.verdict || '')}</div>
      </div>
      <div class="rs-radar-col">
        <div class="chart-box" style="height:210px"><canvas></canvas></div>
      </div>
      <div class="rs-kw-col">
        <div class="rs-kw-title">JD 核心关键词</div>
        <div class="q-tags">${(p.keywords || []).map((k) => `<span class="q-tag">#${esc(k)}</span>`).join('')}</div>
        <div class="result-tools" style="margin-top:auto">
          <button class="btn small ghost" data-act="export">${icon('download', 13)}导出</button>
          <button class="btn small ghost" data-act="print">${icon('printer', 13)}打印/PDF</button>
        </div>
      </div>
    </div>
    <div class="dash-grid2">
      <div class="card">
        <h3><span class="ico">${icon('check')}</span>JD 要求覆盖</h3>
        ${cov || '<p class="hint">无数据</p>'}
      </div>
      <div class="card">
        <h3><span class="ico">${icon('flame')}</span>追问预测（${(p.followups || []).length}）</h3>
        <div class="fu-list">${followups}</div>
        <div class="actions">
          <button class="btn small primary" data-act="tofu">${icon('cards', 13)}全部转为练习题</button>
          <button class="btn small ghost" data-act="tomock">${icon('mic', 13)}用这份 JD 模拟面试</button>
        </div>
      </div>
    </div>
    ${risks ? `
    <div class="card">
      <h3><span class="ico">${icon('info')}</span>风险点与修改建议</h3>
      ${risks}
    </div>` : ''}`;

  // 动画与图表（插入 DOM 后执行）
  requestAnimationFrame(() => {
    const ring = $('.score-ring', el);
    ring.querySelector('span').innerHTML = `${p.score ?? 0}<small>/100</small>`;
    animateRing(ring, p.score ?? 0);
    radarChart($('canvas', el), (p.radar || []).map((r) => r.dim), (p.radar || []).map((r) => (r.score || 0) * 10));
  });

  $('[data-act="export"]', el).onclick = () =>
    downloadFile(`简历诊断-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(p, null, 2), 'application/json');
  $('[data-act="print"]', el).onclick = () => printHtml('简历诊断报告', `
    <h1>匹配度：${p.score ?? '—'}/100</h1>
    <p>${esc(p.verdict || '')}</p>
    <h2>维度评分</h2><ul>${(p.radar || []).map((r) => `<li>${esc(r.dim)}：${r.score}/10</li>`).join('')}</ul>
    <h2>要求覆盖</h2><ul>${(p.coverage || []).map((c) => `<li>[${c.status}] ${esc(c.req)} —— ${esc(c.evidence || '')}</li>`).join('')}</ul>
    <h2>追问预测</h2><ol>${(p.followups || []).map((f) => `<li>${esc(f.q)}（${f.priority}）</li>`).join('')}</ol>
    <h2>风险与建议</h2><ul>${(p.risks || []).map((r) => `<li><b>${esc(r.issue)}</b>：${esc(r.fix || '')}${r.example ? `　示例：${esc(r.example)}` : ''}</li>`).join('')}</ul>`);
  const tofu = $('[data-act="tofu"]', el);
  if (tofu) tofu.onclick = () => importFollowups(p.followups || []);
  const tomock = $('[data-act="tomock"]', el);
  if (tomock) tomock.onclick = () => {
    if (jdText) {
      // 用 JD 预填模拟面试的项目深挖场景提示
      switchView('mock');
      $('#mock-type').value = 'project';
      toast('已切到「项目深挖面」，开始后面试官会结合岗位方向提问', 'ok');
    }
  };
  return el;
}

/* 追问预测 → 自定义练习题 */
function importFollowups(followups) {
  if (!followups.length) { toast('没有可导入的追问', 'err'); return; }
  const items = followups.slice(0, 10).map((f, i) => ({
    id: `custom-${Date.now()}-${i}`,
    q: f.q,
    a: `此题来自 JD 追问预测（${(PRIO_META[f.priority] || ['中'])[0]}频）。回答思路：\n- 先给结论，再分点展开\n- 结合自己简历中的项目经历给出具体例子（用 STAR：情境-任务-行动-结果）\n- 有数据尽量量化（QPS/P99/百分比）`,
    cat: 'custom',
    diff: 2,
    tags: ['JD追问', 'AI生成'],
  }));
  S.custom = [...S.custom, ...items];
  persist('custom');
  remergeBank();
  renderBank();
  renderDashboard();
  toast(`已导入 ${items.length} 道追问练习题`, 'ok');
  switchView('bank');
  S.bankFilter = { cat: 'custom', q: '', diff: 'all', flag: 'all' };
  renderBank();
}

/* ---------- 文档上传解析：PDF / DOCX / TXT ---------- */

let pdfjsLoading = null;
function ensurePdfJs() {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
    return Promise.resolve(window.pdfjsLib);
  }
  if (pdfjsLoading) return pdfjsLoading;
  pdfjsLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/pdfjs/pdf.min.js';
    s.onload = () => {
      const lib = window.pdfjsLib;
      if (!lib) return reject(new Error('pdf.js 加载异常'));
      lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
      resolve(lib);
    };
    s.onerror = () => reject(new Error('pdf.js 加载失败'));
    document.head.appendChild(s);
  });
  return pdfjsLoading;
}

async function extractPdfText(file) {
  const lib = await ensurePdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const parts = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let line = '';
    for (const item of tc.items) {
      line += item.str;
      if (item.hasEOL) { parts.push(line); line = ''; }
    }
    if (line) parts.push(line);
    if (p < doc.numPages) parts.push('');
  }
  return parts.join('\n');
}

/* DOCX = ZIP：定位 word/document.xml → 解压（deflate-raw / stored）→ XML 转文本 */
async function extractDocxText(file) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持解压（请用 Chrome / Edge）');
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  // 找 EOCD（文件尾 PK\x05\x06）
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 docx 文件');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const cdOffset = dv.getUint32(eocd + 16, true);
  // 遍历中央目录找目标文件
  let p = cdOffset;
  let docEntry = null;
  while (p < eocd && buf[p] === 0x50 && buf[p + 1] === 0x4b) {
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.slice(p + 46, p + 46 + nameLen));
    if (name === 'word/document.xml') { docEntry = { localOffset }; break; }
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!docEntry) throw new Error('docx 中未找到正文（word/document.xml）');
  // 本地头：method / 压缩大小 / 数据起点
  const lo = docEntry.localOffset;
  const method = dv.getUint16(lo + 8, true);
  const compSize = dv.getUint32(lo + 18, true);
  const nameLen = dv.getUint16(lo + 26, true);
  const extraLen = dv.getUint16(lo + 28, true);
  const dataStart = lo + 30 + nameLen + extraLen;
  const raw = buf.slice(dataStart, dataStart + compSize);
  const xmlBytes = method === 0
    ? raw
    : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  const xml = new TextDecoder('utf-8').decode(xmlBytes);
  // WordprocessingML → 纯文本
  return xml
    .replace(/<w:p[^>]*>/g, '\n')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function handleResumeFile(file) {
  const name = file.name || '上传文档';
  const ext = name.split('.').pop().toLowerCase();
  toast(`正在解析 ${name} …`);
  try {
    let text = '';
    if (ext === 'pdf') text = await extractPdfText(file);
    else if (ext === 'docx') text = await extractDocxText(file);
    else if (ext === 'txt' || ext === 'md') text = await file.text();
    else if (ext === 'doc') {
      toast('旧版 .doc 暂不支持：请用 Word 另存为 .docx 后再上传', 'err');
      return;
    } else {
      toast('仅支持 PDF / DOCX / TXT', 'err');
      return;
    }
    text = (text || '').trim();
    if (text.length < 20) {
      toast('解析成功但文本太少——这份文件可能是扫描件（图片型 PDF），请上传文字版', 'err');
      return;
    }
    openUploadPreview(name, text);
  } catch (e) {
    toast('解析失败：' + e.message, 'err');
  }
}

function openUploadPreview(fileName, text) {
  const m = openModal(`
    <div class="polish-grid" style="grid-template-columns:1fr 240px">
      <div>
        <div class="polish-label">解析结果（${text.length} 字）</div>
        <div class="polish-pane" style="max-height:320px"><pre>${esc(text.slice(0, 6000))}${text.length > 6000 ? '\n…（已截断预览，载入后为全文）' : ''}</pre></div>
      </div>
      <div>
        <div class="polish-label">下一步</div>
        <p class="hint" style="margin:4px 0 10px">载入后自动创建新版本「${esc(fileName.slice(0, 16))}」，可直接 AI 诊断、润色或匹配岗位。</p>
        <button class="btn primary" id="up-load" style="width:100%">${icon('check', 14)}载入为简历版本</button>
      </div>
    </div>`,
    { title: `📄 ${fileName}`, icon: 'clipboard', width: 780 });
  $('#up-load', m.el).onclick = () => {
    const r = { id: 'rs-' + Date.now(), name: fileName.replace(/\.(pdf|docx|doc|txt|md)$/i, '').slice(0, 24) || '上传简历', content: text, updated: Date.now() };
    S.resumes.push(r);
    persist('resumes');
    currentId = r.id;
    renderList();
    m.close();
    toast(`已载入「${r.name}」（${text.length} 字）`, 'ok');
  };
}

/* ---------- AI 润色 ---------- */

async function polishResume() {
  saveCurrent(true);
  const ta = $('#resume-text');
  const content = ta.value.trim();
  if (!content) { toast('先填写简历内容', 'err'); return; }
  if (!hasKey()) { toast('AI 润色需要先配置 API Key', 'err'); switchView('settings'); return; }

  // 支持只润色选中的片段
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
  const target = sel.length > 20 ? sel : content;
  const partial = sel.length > 20;

  const m = openModal('<div class="skeleton-lines"><i></i><i></i><i></i></div>', { title: partial ? 'AI 润色（选中片段）' : 'AI 润色整份简历', icon: 'sparkles', width: 860 });
  let full = '';
  try {
    await streamChat(
      { mode: 'polish', messages: [{ role: 'user', content: target }] },
      (d) => { full += d; }
    );
    const parsed = extractJson(full);
    if (!parsed.improved) throw new Error('AI 未返回润色结果');
    $('.modal-body', m.el).innerHTML = `
      <div class="polish-grid">
        <div>
          <div class="polish-label">润色前</div>
          <div class="polish-pane"><pre>${esc(target)}</pre></div>
        </div>
        <div>
          <div class="polish-label ok">润色后</div>
          <div class="polish-pane ok"><pre>${esc(parsed.improved)}</pre></div>
        </div>
      </div>
      <div class="q-note" style="margin-top:12px"><b>改动说明</b><ul style="margin:6px 0 0;padding-left:18px">${(parsed.notes || []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>
      <div class="actions" style="justify-content:flex-end">
        <button class="btn ghost" id="pl-copy">${icon('copy', 13)}复制润色结果</button>
        <button class="btn primary" id="pl-apply">${icon('check', 13)}${partial ? '替换选中片段' : '应用整份润色'}</button>
      </div>`;
    $('#pl-copy', m.el).onclick = async () => {
      try { await navigator.clipboard.writeText(parsed.improved); toast('已复制', 'ok'); }
      catch (_) { toast('复制失败', 'err'); }
    };
    $('#pl-apply', m.el).onclick = () => {
      if (partial) {
        ta.value = ta.value.slice(0, ta.selectionStart) + parsed.improved + ta.value.slice(ta.selectionEnd);
      } else {
        ta.value = parsed.improved;
      }
      saveCurrent(true);
      m.close();
      toast('润色已应用并保存', 'ok');
    };
  } catch (e) {
    $('.modal-body', m.el).innerHTML = `<p style="color:var(--danger)">出错了：${esc(e.message)}</p>`;
  }
}
