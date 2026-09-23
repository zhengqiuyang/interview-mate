/* 简历工坊 2.0：简历库 + 文档式在线展示 + AI 智能结构化 + 诊断/润色/匹配 */
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

专业技能：
Java / Spring Boot / MySQL / Redis / RabbitMQ / Docker`;

const SAMPLE_JD = `岗位：高级后端开发工程师（Java）
职责：
- 负责核心交易系统的设计与开发，保障高并发下的稳定性
- 参与技术方案评审，推动服务性能与可用性优化
要求：
- 本科以上，3 年以上 Java 后端经验，基础扎实
- 熟悉 Spring 生态、MySQL 索引优化、JVM 调优
- 熟悉 Redis、消息队列，有分布式系统实战经验
- 有高并发场景（秒杀/抢购）经验者优先`;

const SOURCE_BADGE = { pdf: 'PDF', docx: 'Word', txt: 'TXT', manual: '手动', sample: '示例' };

let currentId = null;
let editMode = false;

export function init() {
  $('#btn-rs-upload')?.addEventListener('click', () => $('#file-rs-upload')?.click());
  $('#file-rs-upload')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) handleResumeFile(f);
    e.target.value = '';
  });
  $('#btn-rs-blank')?.addEventListener('click', () => {
    const r = { id: 'rs-' + Date.now(), name: `空白简历 v${S.resumes.length + 1}`, content: '', source: 'manual', parsed: null, updated: Date.now() };
    S.resumes.push(r);
    persist('resumes');
    currentId = r.id;
    editMode = true;
    renderLibrary();
    renderViewer();
  });
  // 拖拽上传
  const zone = $('#view-resume');
  zone?.addEventListener('dragover', (e) => { e.preventDefault(); });
  zone?.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) handleResumeFile(f);
  });
  // JD 诊断
  $('#btn-analyze').addEventListener('click', analyzeResume);
  $('#btn-fill-sample').addEventListener('click', fillSample);
}

export function onShow() {
  if (!currentId && S.resumes.length) currentId = S.resumes[0].id;
  renderLibrary();
  renderViewer();
}

function currentResume() {
  return S.resumes.find((r) => r.id === currentId) || null;
}

/* ---------- 简历库 ---------- */

function renderLibrary() {
  const box = $('#rs-cards');
  if (!S.resumes.length) {
    box.innerHTML = '<p class="hint" style="margin:4px 0">还没有简历——上传 PDF/Word，或从空白开始写。</p>';
    return;
  }
  box.innerHTML = S.resumes.map((r) => `
    <div class="rs-lib-card ${r.id === currentId ? 'active' : ''}" data-id="${esc(r.id)}">
      <div class="rs-lib-main">
        <div class="rs-lib-name">${esc(r.name)}</div>
        <div class="rs-lib-meta">
          <span class="badge">${SOURCE_BADGE[r.source] || '手动'}</span>
          <span>${(r.content || '').length} 字</span>
          <span>${new Date(r.updated).toLocaleDateString('zh-CN')}</span>
        </div>
      </div>
      <button class="icon-btn sm" data-del="${esc(r.id)}" title="删除">${icon('trash', 15)}</button>
    </div>`).join('');
  $$('.rs-lib-card', box).forEach((el) => {
    el.onclick = (e) => {
      if (e.target.closest('[data-del]')) return;
      currentId = el.dataset.id;
      editMode = false;
      renderLibrary();
      renderViewer();
    };
  });
  $$('[data-del]', box).forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if (!(await confirmModal('删除这份简历？'))) return;
      S.resumes = S.resumes.filter((r) => r.id !== b.dataset.del);
      persist('resumes');
      if (currentId === b.dataset.del) { currentId = S.resumes[0]?.id || null; editMode = false; }
      renderLibrary();
      renderViewer();
    };
  });
}

/* ---------- 文档展示 / 编辑 ---------- */

function renderViewer() {
  const box = $('#rs-viewer');
  const r = currentResume();
  if (!r) {
    box.innerHTML = `
      <div class="card rs-doc-empty">
        <div class="empty-ico">${icon('clipboard', 36)}</div>
        <p><b>从上传一份简历开始</b></p>
        <p class="muted" style="font-size:13px">支持 PDF / Word(.docx) / TXT，拖到本页任意位置即可</p>
        <div class="actions" style="justify-content:center">
          <button class="btn primary" onclick="document.getElementById('btn-rs-upload').click()">${icon('upload', 14)}上传简历文件</button>
          <button class="btn ghost" id="empty-sample">先看示例</button>
        </div>
      </div>`;
    $('#empty-sample')?.addEventListener('click', fillSample);
    return;
  }

  if (editMode) {
    box.innerHTML = `
      <div class="card">
        <div class="actions" style="margin:0 0 12px;justify-content:space-between">
          <b>编辑原文（解析会在保存后自动重做）</b>
          <span>
            <button class="btn small primary" id="rs-edit-save">${icon('check', 13)}保存并重新展示</button>
            <button class="btn small ghost" id="rs-edit-cancel">取消</button>
          </span>
        </div>
        <textarea id="resume-text" rows="20">${esc(r.content || '')}</textarea>
      </div>`;
    $('#rs-edit-save').onclick = () => {
      r.content = $('#resume-text').value;
      r.parsed = null; // 作废结构化缓存
      r.updated = Date.now();
      persist('resumes');
      editMode = false;
      renderLibrary();
      renderViewer();
      toast('已保存', 'ok');
    };
    $('#rs-edit-cancel').onclick = () => { editMode = false; renderViewer(); };
    return;
  }

  const parsed = r.parsed || heuristicParse(r.content || '');
  const hasFile = Boolean(r.fileUrl && r.fileType);
  const view = r.view === 'doc' || !hasFile ? 'doc' : 'native';
  const secHtml = (parsed.sections || []).map((sec) => `
    <div class="rs-doc-sec">
      ${sec.heading ? `<div class="rs-doc-h">${esc(sec.heading)}</div>` : ''}
      <ul class="rs-doc-list">
        ${(sec.lines || []).map((l) => `<li>${esc(String(l).replace(/^[-•·▪]\s*/, ''))}</li>`).join('')}
      </ul>
    </div>`).join('');

  box.innerHTML = `
    <div class="card rs-doc-card">
      <div class="rs-doc-toolbar">
        <span class="badge">${SOURCE_BADGE[r.source] || '手动'}</span>
        <span class="muted" style="font-size:12px">${(r.content || '').length} 字 · 更新于 ${new Date(r.updated).toLocaleString('zh-CN')}</span>
        <span class="muted" style="font-size:12px">${r.parsed ? '✓ AI 结构化' : '启发式解析'}</span>
        <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn small primary" id="rs-ai-parse" ${hasKey() ? '' : 'disabled'} title="${hasKey() ? '' : '需配置 API Key'}">${icon('sparkles', 13)}AI 智能解析</button>
          <button class="btn small ghost" id="rs-edit">${icon('note', 13)}编辑原文</button>
          <button class="btn small ghost" id="rs-polish" ${hasKey() ? '' : 'disabled'}>${icon('palette', 13)}AI 润色</button>
          <button class="btn small ghost" id="rs-match">${icon('radar', 13)}匹配岗位</button>
        </span>
      </div>
      ${hasFile ? `
      <div class="seg" id="rs-view-tabs" style="margin-bottom:14px">
        <button data-v="native" class="${view === 'native' ? 'active' : ''}">📄 原文预览</button>
        <button data-v="doc" class="${view === 'doc' ? 'active' : ''}">🧩 结构化</button>
      </div>` : ''}
      <div id="rs-doc-pane" style="display:${view === 'doc' ? 'block' : 'none'}">
        <div class="rs-doc">
          <div class="rs-doc-head">
            <div class="rs-doc-name">${esc(parsed.name || r.name)}</div>
            ${parsed.headline ? `<div class="rs-doc-title">${esc(parsed.headline)}</div>` : ''}
            ${parsed.contacts?.length ? `<div class="rs-doc-contact">${parsed.contacts.map(esc).join('　·　')}</div>` : ''}
          </div>
          ${parsed.skills?.length ? `
          <div class="rs-doc-skills">
            ${(parsed.skills).slice(0, 18).map((s) => `<span class="q-tag">${esc(String(s).slice(0, 18))}</span>`).join('')}
          </div>` : ''}
          ${secHtml || '<p class="hint">这份简历还没有内容，点「编辑原文」开始写。</p>'}
        </div>
      </div>
      ${hasFile ? `<div id="rs-native-pane" style="display:${view === 'native' ? 'block' : 'none'}"></div>` : ''}
    </div>`;

  const nativePane = $('#rs-native-pane');
  if (nativePane && view === 'native') renderNativeDoc(nativePane, r);
  $$('#rs-view-tabs button').forEach((b) => {
    b.onclick = () => {
      r.view = b.dataset.v;
      persist('resumes');
      $$('#rs-view-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      $('#rs-doc-pane').style.display = b.dataset.v === 'doc' ? 'block' : 'none';
      nativePane.style.display = b.dataset.v === 'native' ? 'block' : 'none';
      if (b.dataset.v === 'native' && !nativePane.childElementCount) renderNativeDoc(nativePane, r);
    };
  });

  $('#rs-edit').onclick = () => { editMode = true; renderViewer(); };
  $('#rs-ai-parse').onclick = () => aiParse(r);
  $('#rs-polish').onclick = () => polishResume(r);
  $('#rs-match').onclick = () => {
    switchView('jobs');
    const sel = document.getElementById('jobs-resume');
    if (sel) {
      const opt = [...sel.options].find((o) => o.value === r.id);
      if (opt) { sel.value = r.id; sel.dispatchEvent(new Event('change')); }
      else toast('进入岗位雷达后请在「匹配简历」中选择本简历');
    }
  };
}

/* ---------- 启发式解析（无 Key 兜底） ---------- */

function heuristicParse(text) {
  const lines = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const out = { name: '', headline: '', contacts: [], skills: [], sections: [] };
  if (!lines.length) return out;
  const contactRe = /(\+?\d[\d\s-]{8,}|\w[\w.+-]*@[\w-]+\.\w+|github\.com\/\w+|leetcode\.cn\/u\/\w+)/i;
  const isHeading = (l) => /^(教育背景|教育经历|学习经历|工作经历|工作经验|实习经历|项目经历|项目经验|专业技能|技能|技术栈|技术|荣誉|奖项|获奖|证书|自我评价|其他)/.test(l) && l.length <= 18;

  let name = '';
  let nameLine = null;
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    const l = lines[i];
    if (contactRe.test(l)) continue;
    if (l.length <= 24 && !isHeading(l) && !/[:：]/.test(l)) { name = l; nameLine = l; }
    break;
  }
  let cur = null;
  for (const l of lines) {
    if (nameLine !== null && l === nameLine) { nameLine = null; continue; }
    if (contactRe.test(l) && l.length < 90) { out.contacts.push(l); continue; }
    if (isHeading(l)) { cur = { heading: l.replace(/[:：]\s*$/, ''), lines: [] }; out.sections.push(cur); continue; }
    if (!cur) { cur = { heading: '', lines: [] }; out.sections.push(cur); }
    cur.lines.push(l);
  }
  const first = out.sections[0];
  if (first && !first.heading) {
    if (!name && first.lines.length) { name = first.lines.shift().slice(0, 24); }
    const hl = first.lines[0] || '';
    if (hl && hl.length <= 34 && !contactRe.test(hl)) { out.headline = first.lines.shift(); }
  }
  const skSec = out.sections.find((s) => /技能|技术栈/.test(s.heading));
  if (skSec) {
    out.skills = skSec.lines.join(' ').split(/[/、,，|·]+/).map((s) => s.trim()).filter((s) => s && s.length <= 16).slice(0, 18);
  }
  out.name = name || out.name;
  // 姓名行形如「张三 | 后端工程师 | 3 年经验」时拆分为姓名 + 头衔
  if (/[|｜]/.test(out.name)) {
    const segs = out.name.split(/[|｜]/).map((s) => s.trim()).filter(Boolean);
    out.name = (segs.shift() || out.name).trim();
    if (!out.headline && segs.length) out.headline = segs.join(' · ');
  }
  out.name = out.name.trim();
  out.sections = out.sections.filter((s) => s.heading || s.lines.length).map((s) => ({ heading: s.heading || '简介', lines: s.lines.slice(0, 50) }));
  return out;
}

/* ---------- AI 智能结构化 ---------- */

async function aiParse(r) {
  if (!hasKey()) { toast('AI 解析需要先配置 API Key', 'err'); switchView('settings'); return; }
  if (!(r.content || '').trim()) { toast('先编辑简历内容', 'err'); return; }
  const btn = $('#rs-ai-parse');
  btn.disabled = true;
  btn.innerHTML = '<span class="typing"><i></i><i></i><i></i></span> 解析中';
  let full = '';
  try {
    await streamChat(
      { mode: 'parse-resume', messages: [{ role: 'user', content: r.content.slice(0, 12000) }] },
      (d) => { full += d; }
    );
    const parsed = extractJson(full);
    if (!parsed || !Array.isArray(parsed.sections)) throw new Error('AI 未返回有效结构');
    r.parsed = parsed;
    r.updated = Date.now();
    persist('resumes');
    renderLibrary();
    renderViewer();
    toast('AI 结构化完成', 'ok');
  } catch (e) {
    toast('AI 解析失败：' + e.message + '（已回退本地解析）', 'err');
  } finally {
    renderViewer();
  }
}

function extractJson(text) {
  const t = String(text || '').replace(/```json|```/g, '').trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('AI 未返回 JSON');
  return JSON.parse(t.slice(s, e + 1));
}

/* ---------- 文件上传：PDF / DOCX / TXT ---------- */

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

async function extractDocxText(file) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持解压（请用 Chrome / Edge）');
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 docx 文件');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const cdOffset = dv.getUint32(eocd + 16, true);
  let p = cdOffset;
  let entry = null;
  while (p < eocd && buf[p] === 0x50 && buf[p + 1] === 0x4b) {
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.slice(p + 46, p + 46 + nameLen));
    if (name === 'word/document.xml') { entry = { localOffset }; break; }
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!entry) throw new Error('docx 中未找到正文');
  const lo = entry.localOffset;
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
    else if (ext === 'doc') { toast('旧版 .doc 暂不支持：请用 Word 另存为 .docx 后再上传', 'err'); return; }
    else { toast('仅支持 PDF / DOCX / TXT', 'err'); return; }
    text = (text || '').trim();
    if (text.length < 20) {
      toast('解析成功但文本太少——这份文件可能是扫描件（图片型 PDF），请上传文字版', 'err');
      return;
    }
    // 原文件上传到本地服务端（供原文预览）
    let fileUrl = null;
    try {
      const up = await fetch('/api/files/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(name),
        },
        body: file,
      });
      const j = await up.json();
      if (up.ok && j.url) fileUrl = j.url;
    } catch (_) { /* 文件保存失败不影响文本导入 */ }

    const r = {
      id: 'rs-' + Date.now(),
      name: name.replace(/\.(pdf|docx|doc|txt|md)$/i, '').slice(0, 24) || '上传简历',
      content: text, parsed: null, source: ext === 'md' ? 'txt' : ext,
      fileUrl, fileType: fileUrl ? ext : null,
      updated: Date.now(),
      view: 'native',
    };
    S.resumes.push(r);
    persist('resumes');
    currentId = r.id;
    editMode = false;
    renderLibrary();
    renderViewer();
    toast(`已导入「${r.name}」${fileUrl ? '，原文预览已就绪' : ''}`, 'ok');
    // 有 Key 时自动做 AI 结构化
    if (hasKey()) aiParse(r);
  } catch (e) {
    toast('解析失败：' + e.message, 'err');
  }
}

/* ---------- 原生文档展示 ---------- */

let docxLibLoading = null;
function ensureDocxLib() {
  if (window.docx) return Promise.resolve(window.docx);
  if (docxLibLoading) return docxLibLoading;
  const load = (src) => new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => no(new Error('加载 ' + src + ' 失败'));
    document.head.appendChild(s);
  });
  docxLibLoading = load('/vendor/docx/jszip.min.js')
    .then(() => load('/vendor/docx/docx-preview.min.js'))
    .then(() => {
      if (!window.docx) throw new Error('docx-preview 加载异常');
      return window.docx;
    });
  return docxLibLoading;
}

async function renderNativeDoc(container, r) {
  if (r.fileType === 'pdf') {
    container.innerHTML = `<iframe class="rs-native-pdf" src="${esc(r.fileUrl)}#zoom=page-fit" title="简历原文"></iframe>`;
    return;
  }
  if (r.fileType === 'docx') {
    container.innerHTML = '<div class="skeleton-lines"><i></i><i></i><i></i></div>';
    try {
      const lib = await ensureDocxLib();
      const buf = await (await fetch(r.fileUrl)).arrayBuffer();
      container.innerHTML = '<div class="rs-native-docx"></div>';
      await lib.renderAsync(buf, container.firstElementChild, null, {
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        renderHeaders: true,
        renderFooters: true,
      });
    } catch (e) {
      container.innerHTML = `<p style="color:var(--danger)">原文渲染失败：${esc(e.message)}（可切到「结构化」标签继续使用 AI 功能）</p>`;
    }
  }
}

function fillSample() {
  if (!S.resumes.some((r) => r.source === 'sample')) {
    S.resumes.push({ id: 'rs-' + Date.now(), name: '示例简历', content: SAMPLE_RESUME, source: 'sample', parsed: null, updated: Date.now() });
    persist('resumes');
  }
  currentId = S.resumes.find((r) => r.source === 'sample').id;
  $('#jd-text').value = SAMPLE_JD;
  editMode = false;
  renderLibrary();
  renderViewer();
  toast('示例已就绪（简历 + JD），可直接生成诊断', 'ok');
}

/* ---------- JD 诊断（作用于当前展示的简历） ---------- */

async function analyzeResume() {
  const r = currentResume();
  const resume = r?.content?.trim() || '';
  const jd = $('#jd-text').value.trim();
  if (!resume) { toast('左侧选择或上传一份简历', 'err'); return; }
  if (!jd) { toast('填写目标岗位 JD（可点「填入示例」）', 'err'); return; }
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
        </div>
      </div>
    </div>
    ${risks ? `
    <div class="card">
      <h3><span class="ico">${icon('info')}</span>风险点与修改建议</h3>
      ${risks}
    </div>` : ''}`;

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
  return el;
}

function importFollowups(followups) {
  if (!followups.length) { toast('没有可导入的追问', 'err'); return; }
  const items = followups.slice(0, 10).map((f, i) => ({
    id: `custom-${Date.now()}-${i}`,
    q: f.q,
    a: `此题来自 JD 追问预测（${(PRIO_META[f.priority] || ['中'])[0]}频）。回答思路：\n- 先给结论，再分点展开\n- 结合自己简历中的项目经历给出具体例子（用 STAR：情境-任务-行动-结果）\n- 有数据尽量量化（QPS/P99/百分比）`,
    cat: 'custom', diff: 2, tags: ['JD追问', 'AI生成'],
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

/* ---------- AI 润色（作用于当前简历） ---------- */

async function polishResume(r) {
  const content = (r.content || '').trim();
  if (!content) { toast('先填写简历内容', 'err'); return; }
  if (!hasKey()) { toast('AI 润色需要先配置 API Key', 'err'); switchView('settings'); return; }

  const m = openModal('<div class="skeleton-lines"><i></i><i></i><i></i></div>', { title: 'AI 润色整份简历', icon: 'sparkles', width: 860 });
  let full = '';
  try {
    await streamChat(
      { mode: 'polish', messages: [{ role: 'user', content }] },
      (d) => { full += d; }
    );
    const parsed = extractJson(full);
    if (!parsed.improved) throw new Error('AI 未返回润色结果');
    $('.modal-body', m.el).innerHTML = `
      <div class="polish-grid">
        <div>
          <div class="polish-label">润色前</div>
          <div class="polish-pane"><pre>${esc(content)}</pre></div>
        </div>
        <div>
          <div class="polish-label ok">润色后</div>
          <div class="polish-pane ok"><pre>${esc(parsed.improved)}</pre></div>
        </div>
      </div>
      <div class="q-note" style="margin-top:12px"><b>改动说明</b><ul style="margin:6px 0 0;padding-left:18px">${(parsed.notes || []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>
      <div class="actions" style="justify-content:flex-end">
        <button class="btn ghost" id="pl-copy">${icon('copy', 13)}复制润色结果</button>
        <button class="btn primary" id="pl-apply">${icon('check', 13)}应用并重新展示</button>
      </div>`;
    $('#pl-copy', m.el).onclick = async () => {
      try { await navigator.clipboard.writeText(parsed.improved); toast('已复制', 'ok'); }
      catch (_) { toast('复制失败', 'err'); }
    };
    $('#pl-apply', m.el).onclick = () => {
      r.content = parsed.improved;
      r.parsed = null;
      r.updated = Date.now();
      persist('resumes');
      m.close();
      renderLibrary();
      renderViewer();
      if (hasKey()) aiParse(r);
      toast('润色已应用', 'ok');
    };
  } catch (e) {
    $('.modal-body', m.el).innerHTML = `<p style="color:var(--danger)">出错了：${esc(e.message)}</p>`;
  }
}
