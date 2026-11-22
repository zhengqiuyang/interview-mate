/* 交互式代码演练场（Code Lab）：浏览器 JS Worker 沙箱 + 本机 Python/C++17 编译运行 + AI Code Review */
import { $, esc, md, icon, toast, openModal, debounce } from '../core.js';
import { S, persist } from '../state.js';
import { streamChat, hasKey } from '../api.js';
import { isDemoMode } from '../demo.js';
import { grade, markActivity } from '../srs.js';
import { awardXP } from '../gamify.js';
import {
  defaultLangForQuestion,
  getStarter,
  hasTestHarness,
  buildRunnableSource,
} from '../codelab-cases.js';

const LANG_LABEL = {
  javascript: 'JavaScript（浏览器沙箱）',
  python: 'Python 3（本机运行）',
  cpp: 'C++17（本机 g++/clang++）',
};

const WORKER_TIMEOUT_MS = 3000;

async function fetchRuntimes() {
  try {
    const res = await fetch('/api/code/runtimes');
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

/** 在严格 CSP (script-src 'self'; worker-src 'self' blob:) 下用 Blob Web Worker 安全执行 JS */
export function runJsInWorker(source, timeoutMs = WORKER_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') {
      resolve({ ok: false, lang: 'javascript', stage: 'env', stdout: '', stderr: '当前环境不支持 Web Worker', durationMs: 0 });
      return;
    }

    const workerSrc = [
      'const __logs = [];',
      'const __fmt = (a) => {',
      '  if (typeof a === "string") return a;',
      '  try { return JSON.stringify(a); } catch (_) { return String(a); }',
      '};',
      'console.log = (...args) => __logs.push(args.map(__fmt).join(" "));',
      'console.info = console.log;',
      'console.warn = (...args) => __logs.push("[warn] " + args.map(__fmt).join(" "));',
      'console.error = (...args) => __logs.push("[err] " + args.map(__fmt).join(" "));',
      'const __t0 = performance.now();',
      'try {',
      '(function () {',
      source,
      '})();',
      '  self.postMessage({ ok: true, stdout: __logs.join("\\n"), stderr: "", durationMs: Math.round(performance.now() - __t0) });',
      '} catch (e) {',
      '  self.postMessage({ ok: false, stdout: __logs.join("\\n"), stderr: (e && e.message ? e.message : String(e)), durationMs: Math.round(performance.now() - __t0) });',
      '}',
    ].join('\n');

    const url = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
    let worker;
    let settled = false;
    const cleanup = () => {
      if (worker) { try { worker.terminate(); } catch (_) { /* ignore */ } }
      URL.revokeObjectURL(url);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        ok: false,
        lang: 'javascript',
        stage: 'run',
        timedOut: true,
        stdout: '',
        stderr: `运行超时（>${Math.round(timeoutMs / 1000)}s），Worker 已强制终止（可能存在死循环）`,
        durationMs: timeoutMs,
      });
    }, timeoutMs);

    try {
      worker = new Worker(url);
      worker.onmessage = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve({ lang: 'javascript', stage: 'run', ...e.data });
      };
      worker.onerror = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve({
          ok: false,
          lang: 'javascript',
          stage: 'run',
          stdout: '',
          stderr: e?.message || '脚本语法或运行错误',
          durationMs: 0,
        });
      };
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve({ ok: false, lang: 'javascript', stage: 'env', stdout: '', stderr: e.message || String(e), durationMs: 0 });
    }
  });
}

function draftKey(qid, lang) {
  return `${qid || 'free'}:${lang}`;
}

export async function openCodeLab(q = null) {
  const runtimes = await fetchRuntimes();
  const initialLang = defaultLangForQuestion(q, runtimes || undefined);
  const qid = q ? q.id : 'free';
  const titleText = q ? q.q : '自由代码演练场（Code Lab）';

  const m = openModal(`
    <div class="cl-top">
      <div class="cl-controls">
        <label class="cl-lang-wrap">
          <span class="muted" style="font-size:12px">运行语言</span>
          <select id="cl-lang" class="input" style="width:auto;min-width:210px">
            <option value="javascript">${LANG_LABEL.javascript}</option>
            <option value="python">${LANG_LABEL.python}</option>
            <option value="cpp">${LANG_LABEL.cpp}</option>
          </select>
        </label>
        <span id="cl-env-badge" class="badge"></span>
        <span id="cl-case-badge" class="badge"></span>
      </div>
      <div class="cl-actions">
        <button class="btn small primary" id="cl-run" title="Ctrl/Cmd + Enter">${icon('play', 13)}运行测试</button>
        <button class="btn small" id="cl-review">${icon('sparkles', 13)}AI Code Review</button>
        <button class="btn small ghost" id="cl-reset">${icon('rotate', 13)}重置模板</button>
        ${q ? `<button class="btn small ghost hidden" id="cl-mark-done">${icon('check', 13)}通过 · 标为已掌握</button>` : ''}
      </div>
    </div>
    <div class="cl-grid">
      <div class="cl-left">
        <div class="cl-editor-head">
          <span>${esc(titleText.slice(0, 72))}${titleText.length > 72 ? '…' : ''}</span>
          <span class="muted" style="font-size:11.5px">Tab 缩进 · Ctrl/Cmd+Enter 运行</span>
        </div>
        <textarea id="cl-editor" class="cl-editor" spellcheck="false"></textarea>
        ${q ? `
        <details class="cl-ref">
          <summary>查看参考思路与题解（建议先手写运行再对照）</summary>
          <div class="md cl-ref-body">${md(q.a)}</div>
        </details>` : ''}
      </div>
      <div class="cl-right">
        <div class="cl-panel">
          <div class="cl-panel-head">
            <span>运行输出</span>
            <span id="cl-run-meta" class="cl-badge">就绪</span>
          </div>
          <pre id="cl-stdout" class="cl-out">点击上方「运行测试」（或 Ctrl+Enter）开始执行…</pre>
          <pre id="cl-stderr" class="cl-err hidden"></pre>
        </div>
        <div class="cl-panel">
          <div class="cl-panel-head">
            <span>AI Code Review</span>
            <span id="cl-rev-meta" class="muted" style="font-size:11.5px"></span>
          </div>
          <div id="cl-review-out" class="md cl-rev-out">写完代码跑通（或报错）后，点「AI Code Review」获取复杂度剖析、边界漏斗与追问。</div>
        </div>
      </div>
    </div>`,
    { title: q ? 'Code Lab · 动手手写与测试' : 'Code Lab · 自由代码演练场', icon: 'terminal', width: 1040 });

  const sel = $('#cl-lang', m.el);
  const editor = $('#cl-editor', m.el);
  const envBadge = $('#cl-env-badge', m.el);
  const caseBadge = $('#cl-case-badge', m.el);
  const runMeta = $('#cl-run-meta', m.el);
  const stdoutEl = $('#cl-stdout', m.el);
  const stderrEl = $('#cl-stderr', m.el);
  const revOut = $('#cl-review-out', m.el);
  const revMeta = $('#cl-rev-meta', m.el);
  const markBtn = $('#cl-mark-done', m.el);

  let curLang = initialLang;
  let lastRun = null;
  let reviewAbort = null;

  sel.value = curLang;

  const updateBadges = () => {
    if (curLang === 'javascript') {
      envBadge.textContent = 'Web Worker 沙箱 ✓';
      envBadge.className = 'badge cl-b-ok';
    } else if (isDemoMode()) {
      envBadge.textContent = '演示模式无本地编译器';
      envBadge.className = 'badge cl-b-warn';
    } else if (runtimes && runtimes[curLang]?.ok && runtimes.localExecAllowed) {
      envBadge.textContent = `本机 ${runtimes[curLang].cmd} ✓`;
      envBadge.className = 'badge cl-b-ok';
    } else if (runtimes && !runtimes.localExecAllowed) {
      envBadge.textContent = '非 127.0.0.1 回环已禁用本地执行';
      envBadge.className = 'badge cl-b-warn';
    } else {
      envBadge.textContent = `未检测到本机 ${curLang === 'cpp' ? 'g++/clang++' : 'Python'}`;
      envBadge.className = 'badge cl-b-warn';
    }

    if (q && hasTestHarness(q.id, curLang)) {
      caseBadge.textContent = '含内置断言测试 ✓';
      caseBadge.className = 'badge cl-b-ok';
    } else {
      caseBadge.textContent = '自由运行模式';
      caseBadge.className = 'badge';
    }
  };

  const loadDraftOrStarter = () => {
    const key = draftKey(qid, curLang);
    const saved = S.codeDrafts?.[key];
    editor.value = typeof saved === 'string' && saved.trim() ? saved : getStarter(q, curLang);
    updateBadges();
  };

  const saveDraft = debounce(() => {
    if (!S.codeDrafts) S.codeDrafts = {};
    S.codeDrafts[draftKey(qid, curLang)] = editor.value;
    persist('codeDrafts');
  }, 400);

  loadDraftOrStarter();

  sel.addEventListener('change', () => {
    if (!S.codeDrafts) S.codeDrafts = {};
    S.codeDrafts[draftKey(qid, curLang)] = editor.value;
    persist('codeDrafts');
    curLang = sel.value;
    loadDraftOrStarter();
    if (markBtn) markBtn.classList.add('hidden');
  });

  editor.addEventListener('input', saveDraft);
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.value = editor.value.slice(0, s) + '  ' + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = s + 2;
      saveDraft();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      $('#cl-run', m.el).click();
    }
  });

  $('#cl-reset', m.el).onclick = () => {
    editor.value = getStarter(q, curLang);
    if (!S.codeDrafts) S.codeDrafts = {};
    S.codeDrafts[draftKey(qid, curLang)] = editor.value;
    persist('codeDrafts');
    toast('已重置为初始模板', 'ok');
  };

  const showResult = (r) => {
    lastRun = r;
    const msText = typeof r.durationMs === 'number' ? ` · ${r.durationMs} ms` : '';
    if (r.ok) {
      runMeta.textContent = `通过${msText}`;
      runMeta.className = 'cl-badge ok';
      if (markBtn && q && hasTestHarness(q.id, curLang)) markBtn.classList.remove('hidden');
    } else if (r.timedOut) {
      runMeta.textContent = `超时终止${msText}`;
      runMeta.className = 'cl-badge err';
    } else if (r.stage === 'compile') {
      runMeta.textContent = `编译失败${msText}`;
      runMeta.className = 'cl-badge err';
    } else {
      runMeta.textContent = `未通过${msText}`;
      runMeta.className = 'cl-badge err';
    }

    stdoutEl.textContent = r.stdout || (r.ok ? '（运行完成，无标准输出）' : '（无标准输出）');
    if (r.stderr) {
      stderrEl.textContent = r.stderr;
      stderrEl.classList.remove('hidden');
    } else {
      stderrEl.textContent = '';
      stderrEl.classList.add('hidden');
    }
  };

  $('#cl-run', m.el).onclick = async () => {
    const code = editor.value;
    if (!code.trim()) { toast('先写点代码再运行', 'err'); return; }
    if (!S.codeDrafts) S.codeDrafts = {};
    S.codeDrafts[draftKey(qid, curLang)] = code;
    persist('codeDrafts');

    const source = buildRunnableSource(q ? q.id : null, curLang, code);
    runMeta.textContent = curLang === 'cpp' ? '编译运行中…' : '运行中…';
    runMeta.className = 'cl-badge warn';
    stdoutEl.textContent = '执行中，请稍候…';
    stderrEl.classList.add('hidden');
    if (markBtn) markBtn.classList.add('hidden');

    if (curLang === 'javascript') {
      const r = await runJsInWorker(source, WORKER_TIMEOUT_MS);
      if (!document.body.contains(stdoutEl)) return;
      showResult(r);
      return;
    }

    try {
      const res = await fetch('/api/code/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: curLang, code: source }),
      });
      const r = await res.json();
      if (!document.body.contains(stdoutEl)) return;
      if (!res.ok) {
        showResult({ ok: false, lang: curLang, stage: 'env', stdout: '', stderr: r.error || `HTTP ${res.status}`, durationMs: 0 });
      } else {
        showResult(r);
      }
    } catch (e) {
      if (!document.body.contains(stdoutEl)) return;
      showResult({ ok: false, lang: curLang, stage: 'env', stdout: '', stderr: e.message || String(e), durationMs: 0 });
    }
  };

  if (markBtn && q) {
    markBtn.onclick = () => {
      grade(q.id, 2);
      markActivity();
      awardXP(20, 'codelab');
      persist('srs');
      window.dispatchEvent(new CustomEvent('im:bank-updated'));
      toast('已标为掌握 +20 XP（计入今日打卡）', 'ok');
      markBtn.disabled = true;
      markBtn.textContent = '已掌握 ✓';
    };
  }

  $('#cl-review', m.el).onclick = async () => {
    if (!isDemoMode() && !hasKey()) {
      toast('先去「设置」填一个 API Key（或配置本地 Ollama），才能使用 AI Code Review', 'err');
      return;
    }
    if (reviewAbort) reviewAbort.abort();
    reviewAbort = new AbortController();
    revMeta.textContent = '评审中…';
    revOut.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';

    const runNote = lastRun
      ? `\n\n【最近运行结果】ok=${lastRun.ok}, stage=${lastRun.stage || 'run'}, durationMs=${lastRun.durationMs ?? '-'}\nstdout:\n${lastRun.stdout || '(空)'}\nstderr:\n${lastRun.stderr || '(空)'}`
      : '\n\n（候选人尚未点击运行）';

    let acc = '';
    try {
      await streamChat(
        {
          mode: 'code-review',
          question: titleText,
          lang: curLang,
          messages: [
            { role: 'user', content: `以下是我用 ${curLang} 编写的代码：\n\`\`\`${curLang}\n${editor.value}\n\`\`\`${runNote}` },
          ],
        },
        (d) => {
          acc += d;
          if (document.body.contains(revOut)) revOut.innerHTML = md(acc);
        },
        reviewAbort.signal
      );
      if (document.body.contains(revMeta)) revMeta.textContent = '评审完成';
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (document.body.contains(revOut)) {
        revOut.innerHTML = `<p style="color:var(--danger)">AI 评审出错：${esc(e.message)}</p>`;
      }
      if (document.body.contains(revMeta)) revMeta.textContent = '出错';
    }
  };

  // 允许模态框关闭时清理任何进行中的 AI 流
  const obs = new MutationObserver(() => {
    if (!document.body.contains(editor)) {
      if (reviewAbort) reviewAbort.abort();
      obs.disconnect();
    }
  });
  obs.observe($('#modal-root'), { childList: true });
}
