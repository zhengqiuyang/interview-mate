/* 设置：模型 / 外观 / 数据管理 / 自定义题库 */
import { $, $$, esc, icon, toast, openModal, confirmModal, downloadFile, applyTheme } from '../core.js';
import { S, persist, remergeBank } from '../state.js';
import { streamChat, checkHealth, hasKey } from '../api.js';
import { render as renderBank } from './bank.js';
import { render as renderDashboard } from './dashboard.js';

const CUSTOM_TEMPLATE = `[
  {
    "q": "题目内容（必填）",
    "a": "参考答案（必填，支持 - 列表 与 **加粗**）",
    "diff": 2,
    "tags": ["高频", "手写"]
  }
]`;

const DATA_KEYS = ['im_settings', 'im_theme', 'im_sessions', 'im_srs', 'im_notes', 'im_bank_favs', 'im_activity', 'im_daily', 'im_custom', 'im_knowledge'];

export function init() {
  /* ---- 模型 ---- */
  const sel = $('#set-provider');
  sel.innerHTML = S.providers.map((p) => `<option value="${p.key}">${esc(p.name)}</option>`).join('');
  sel.value = S.settings.provider || 'zhipu';
  if (![...sel.options].some((o) => o.value === sel.value)) sel.value = 'custom';

  $('#set-baseurl').value = S.settings.baseURL || '';
  $('#set-model').value = S.settings.model || '';
  $('#set-key').value = S.settings.apiKey || '';
  const temp = Math.round((S.settings.temperature ?? 0.7) * 10);
  $('#set-temp').value = temp;
  $('#set-temp-out').textContent = (temp / 10).toFixed(1);
  $('#set-temp').addEventListener('input', (e) => {
    $('#set-temp-out').textContent = (Number(e.target.value) / 10).toFixed(1);
  });

  sel.onchange = () => {
    const p = S.providers.find((x) => x.key === sel.value);
    if (!p) return;
    $('#set-baseurl').value = p.baseURL;
    $('#set-model').value = p.model;
  };

  $('#btn-save-settings').onclick = () => {
    S.settings = {
      provider: sel.value,
      baseURL: $('#set-baseurl').value.trim(),
      model: $('#set-model').value.trim(),
      apiKey: $('#set-key').value.trim(),
      temperature: Number($('#set-temp').value) / 10,
    };
    persist('settings');
    toast('设置已保存', 'ok');
    $('#mock-nokey').classList.toggle('hidden', hasKey());
  };

  $('#btn-test-conn').onclick = async () => {
    $('#btn-save-settings').click();
    const out = $('#set-test-result');
    out.textContent = '测试中…';
    try {
      let got = '';
      await streamChat(
        { mode: 'free', messages: [{ role: 'user', content: '请只回复四个字：连接成功' }] },
        (d) => { got += d; }
      );
      out.textContent = got ? `✅ 连接成功（模型响应：${got.trim().slice(0, 20)}）` : '⚠️ 连接成功但未收到内容';
    } catch (e) {
      out.textContent = `❌ ${e.message}`;
    }
  };

  /* ---- Anki 牌组互通 ---- */
  $('#btn-anki-export').onclick = () => {
    const catName = (k) => S.categories.find((c) => c.key === k)?.name || k;
    const lines = ['#separator:tab', '#html:false', '#tags column:3'];
    for (const q of S.questions) {
      const front = q.q.replace(/\t/g, ' ');
      const back = q.a.replace(/\t/g, ' ').replace(/\n/g, '<br>');
      const tags = [catName(q.cat), ...(q.tags || [])].join(' ');
      lines.push(`${front}\t${back}\t${tags}`);
    }
    downloadFile('interview-mate-deck.txt', lines.join('\n'), 'text/plain');
    toast(`已导出 ${S.questions.length} 张卡片（Anki：文件-导入）`, 'ok');
  };

  $('#btn-anki-import').onclick = () => {
    const m = openModal(`
      <label class="field">
        <span>粘贴 Anki 导出的 TSV（制表符分隔：正面\\t背面\\t标签；或纯「问题\\t答案」两列）</span>
        <textarea id="anki-ta" rows="12" placeholder="HTTP 和 HTTPS 的区别…&#9;HTTP 是……&#9;网络"></textarea>
      </label>
      <div class="actions" style="justify-content:flex-end">
        <button class="btn primary" id="anki-ok">${icon('check', 14)}导入</button>
      </div>
      <p class="hint">Anki 中选中笔记 → 文件 → 导出 → 格式选「纯文本 (*.txt)」→ 勾选「包含标签」→ 复制内容粘贴到这里。</p>`,
      { title: '从 Anki 导入', icon: 'cards', width: 680 });
    $('#anki-ok', m.el).onclick = () => {
      const text = $('#anki-ta', m.el).value.trim();
      if (!text) { toast('先粘贴内容', 'err'); return; }
      const items = [];
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim() || line.startsWith('#')) continue;
        const parts = line.split('\t');
        if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
          items.push({
            id: `custom-${Date.now()}-${items.length}`,
            q: parts[0].trim(),
            a: parts[1].trim().replace(/<br\s*\/?>/gi, '\n'),
            cat: 'custom', diff: 2,
            tags: parts[2] ? parts[2].trim().split(/\s+/).slice(0, 4) : ['Anki'],
          });
        }
      }
      if (!items.length) { toast('没有解析出有效行（需制表符分隔）', 'err'); return; }
      S.custom = [...S.custom, ...items];
      persist('custom');
      remergeBank();
      renderBank();
      renderDashboard();
      renderCustomList();
      m.close();
      toast(`从 Anki 导入 ${items.length} 题`, 'ok');
    };
  };

  /* ---- 外观 ---- */
  const syncSeg = () => $$('#theme-choice button').forEach((b) =>
    b.classList.toggle('active', b.dataset.themeVal === S.theme));
  syncSeg();
  $('#theme-choice').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    S.theme = b.dataset.themeVal;
    persist('theme');
    applyTheme(S.theme);
    syncSeg();
    // 图表颜色依赖 CSS 变量，切主题后刷新当前视图
    window.dispatchEvent(new CustomEvent('themechange'));
  });

  /* ---- 数据管理 ---- */
  $('#btn-export-data').onclick = () => {
    const backup = { app: 'interview-mate', version: 2, exportedAt: new Date().toISOString(), data: {} };
    for (const k of DATA_KEYS) {
      try { backup.data[k] = JSON.parse(localStorage.getItem(k)); } catch (_) { /* skip */ }
    }
    downloadFile(`interview-mate-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json');
    toast('备份已下载', 'ok');
  };

  $('#btn-import-data').onclick = () => $('#file-import-data').click();
  $('#file-import-data').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const j = JSON.parse(reader.result);
        if (j.app !== 'interview-mate' || !j.data) throw new Error('不是 InterviewMate 的备份文件');
        if (!(await confirmModal(`将导入 ${Object.keys(j.data).length} 项数据并覆盖当前数据，确定吗？`, { danger: true }))) return;
        for (const [k, v] of Object.entries(j.data)) {
          if (DATA_KEYS.includes(k) && v != null) localStorage.setItem(k, JSON.stringify(v));
        }
        toast('导入成功，即将刷新页面', 'ok');
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        toast('导入失败：' + err.message, 'err');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  $('#btn-clear-practice').onclick = async () => {
    if (!(await confirmModal('将清空复习进度、笔记、收藏、打卡与面试记录（保留模型配置与自定义题库），确定吗？'))) return;
    for (const k of ['im_srs', 'im_notes', 'im_bank_favs', 'im_activity', 'im_daily', 'im_sessions']) localStorage.removeItem(k);
    toast('练习数据已清空，即将刷新', 'ok');
    setTimeout(() => location.reload(), 800);
  };

  $('#btn-clear-all').onclick = async () => {
    if (!(await confirmModal('将清空全部本地数据（包括 API Key 与自定义题库），确定吗？'))) return;
    localStorage.clear();
    toast('已清空，即将刷新', 'ok');
    setTimeout(() => location.reload(), 800);
  };

  /* ---- 自定义题库 ---- */
  $('#btn-import-questions').onclick = openImportQuestions;
  $('#btn-export-custom').onclick = () => {
    if (!S.custom.length) { toast('还没有自定义题目', 'err'); return; }
    downloadFile('interview-mate-custom-questions.json',
      JSON.stringify(S.custom.map(({ id, ...rest }) => rest), null, 2), 'application/json');
  };

  /* ---- 新手引导 ---- */
  $('#btn-onboarding')?.addEventListener('click', () =>
    window.dispatchEvent(new CustomEvent('im:show-onboarding')));
}

export function onShow() {
  renderCustomList();
  checkHealth().then((j) => {
    if (!j) return;
    $('#settings-envhint').textContent = j.serverKeyConfigured
      ? '检测到服务端已通过 .env 配置密钥（页面可不填 Key，页面配置优先生效）。'
      : '服务端未配置密钥，请在本页填写 API Key（推荐智谱 GLM，注册即有免费额度）。';
    $('#mock-nokey').classList.toggle('hidden', hasKey());
  });
}

function renderCustomList() {
  const box = $('#custom-list');
  if (!S.custom.length) {
    box.innerHTML = '<p class="hint" style="margin-top:6px">还没有自定义题目。把你的面经、错题、目标公司真题导进来，配合复习计划食用。</p>';
    return;
  }
  box.innerHTML = S.custom.map((q) => `
    <div class="custom-item">
      <span class="q">${esc(q.q.slice(0, 60))}${q.q.length > 60 ? '…' : ''}</span>
      <span class="badge">${esc(q.tags?.[0] || '自定义')}</span>
      <button class="icon-btn sm" data-del="${esc(q.id)}" title="删除">${icon('trash', 15)}</button>
    </div>`).join('');
  $$('[data-del]', box).forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmModal('删除这道自定义题目？'))) return;
      S.custom = S.custom.filter((q) => q.id !== b.dataset.del);
      persist('custom');
      remergeBank();
      renderBank();
      renderDashboard();
      renderCustomList();
      toast('已删除', 'ok');
    };
  });
}

function openImportQuestions() {
  const m = openModal(`
    <label class="field">
      <span>粘贴 JSON 数组（每题至少包含 q 和 a 字段）</span>
      <textarea id="cq-ta" rows="12" placeholder="${esc(CUSTOM_TEMPLATE)}"></textarea>
    </label>
    <div class="actions" style="justify-content:space-between">
      <button class="btn ghost" id="cq-tpl">插入模板</button>
      <button class="btn primary" id="cq-ok">${icon('check', 14)}导入</button>
    </div>
    <p class="hint">字段：q 题目 / a 答案 / diff 难度 1-3 / tags 标签数组。导入后立即出现在题库「自定义」分类中。</p>`,
    { title: '导入自定义题目', icon: 'package', width: 680 });

  $('#cq-tpl', m.el).onclick = () => { $('#cq-ta', m.el).value = CUSTOM_TEMPLATE; };
  $('#cq-ok', m.el).onclick = () => {
    let arr;
    try {
      arr = JSON.parse($('#cq-ta', m.el).value);
      if (!Array.isArray(arr)) throw new Error('顶层必须是 JSON 数组');
    } catch (e) {
      toast('JSON 解析失败：' + e.message, 'err');
      return;
    }
    const items = [];
    for (const [i, it] of arr.entries()) {
      if (!it || typeof it.q !== 'string' || !it.q.trim() || typeof it.a !== 'string' || !it.a.trim()) {
        toast(`第 ${i + 1} 条缺少 q 或 a 字段，已跳过`, 'err');
        continue;
      }
      items.push({
        id: `custom-${Date.now()}-${i}`,
        q: it.q.trim(),
        a: it.a.trim(),
        cat: 'custom',
        diff: Math.min(3, Math.max(1, Number(it.diff) || 2)),
        tags: Array.isArray(it.tags) ? it.tags.map(String).slice(0, 5) : ['自定义'],
      });
    }
    if (!items.length) { toast('没有可导入的题目', 'err'); return; }
    S.custom = [...S.custom, ...items];
    persist('custom');
    remergeBank();
    renderBank();
    renderDashboard();
    renderCustomList();
    m.close();
    toast(`成功导入 ${items.length} 道题，已并入题库`, 'ok');
  };
}
