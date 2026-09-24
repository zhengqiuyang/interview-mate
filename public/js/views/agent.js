/* 智能体教练 Mentor：工具调用 + 多步执行 + 多 Agent 会诊
 * 工具协议：模型输出 TOOL: {json} → 本地执行 → TOOL_RESULT 回灌 → 循环（最多 4 次）
 */
import { $, $$, esc, md, icon, toast, staggerIn, openModal, confirmModal, downloadFile } from '../core.js';
import { S, persist, remergeBank } from '../state.js';
import { streamChat, hasKey } from '../api.js';
import { switchView } from '../router.js';
import { catMastery, dueList, isMastered, streakDays, wrongList } from '../srs.js';
import { render as renderBank } from './bank.js';
import { render as renderDashboard } from './dashboard.js';

const MAX_TOOL_CALLS = 4;

const MISSIONS = [
  {
    icon: 'calendar', name: '🎯 距面试冲刺计划',
    desc: '结合面试倒计时与错题本，输出按天拆解的冲刺计划（先去设置里填目标面试日期）',
    prompt: '请用 my_stats() 查看我的目标面试倒计时与掌握度，用 my_wrong() 查看错题本，然后输出一份按天拆解的冲刺计划（精确到每天复习哪些具体题目题干，优先消灭错题与薄弱分类），最后用 add_cards 创建 3 道最可能考到的押题。',
  },
  {
    icon: 'gauge', name: '弱项体检 + 7 天冲刺计划',
    desc: '读取你的学习数据，找出薄弱分类，生成每天可执行的冲刺计划并创建针对弱项的新题',
    prompt: '请先用 my_stats() 了解我的学习情况，找出最薄弱的 2-3 个分类，用 search_bank 查看这些分类的题目，然后：(1) 输出一份 7 天冲刺计划，每天列出具体要复习的题目题干；(2) 用 add_cards 为我创建 3 道针对弱项的原创练习题。',
  },
  {
    icon: 'target', name: '简历 × 岗位匹配',
    desc: '读取你的简历与岗位库，找出最匹配的机会，分析差距并存档',
    prompt: '请用 get_resume() 获取我的简历，用 search_jobs 找出与我技能最匹配的岗位（可多次搜索不同关键词），然后输出 Top5 匹配岗位分析（匹配理由+差距+准备建议），最后用 save_knowledge 保存一份「岗位匹配分析」。',
  },
  {
    icon: 'zap', name: '今日特训清单',
    desc: '根据到期复习与薄弱点，生成今天的特训清单并存入知识库',
    prompt: '请用 my_stats() 查看我的复习状态，针对待复习最多的方向用 search_bank 检索题目，生成一份「今日特训清单」（6-8 题，标注每题原因），并用 save_knowledge 存档。',
  },
];

/* 会诊专家团（内置三位 + 用户自定义） */
const PANEL = [
  { key: 'interviewer', icon: 'mic', name: '首席面试官', tag: '犀利 · 找挂点',
    task: '从考官视角指出我最可能被挂掉的 3 个追问方向，每个方向给出你会怎么层层追问（至少两层），以及期望听到的回答要点。' },
  { key: 'strategist', icon: 'target', name: '求职军师', tag: '策略 · 两周作战',
    task: '给出我两周内的求职作战策略：投递节奏（何时投、投什么类型）、优先补强顺序、每天时间分配。要具体到第几天做什么。' },
  { key: 'coach', icon: 'rotate', name: '复盘教练', tag: '落地 · 今日三件事',
    task: '基于我的数据给出 3 条今天就能做的具体改进动作：每条包含做什么、做多久、怎么算完成。结合我的模拟面试历史给诊断。' },
];

/* 官方技能包（安装即复制进我的工具/专家） */
const OFFICIAL_PACKS = [
  {
    id: 'pk-salary', kind: 'expert', icon: '💰', name: '薪资谈判教练', tag: 'offer 阶段',
    desc: '帮你评估 offer、比价、准备谈判话术与底线策略',
    expert: {
      name: '薪资谈判教练', icon: '💰', tag: 'offer 阶段',
      task: '你是资深薪资谈判顾问。先了解我的情况（可用 my_stats、get_resume），然后帮我评估目标薪资区间、给出谈判开场话术、锚定策略、以及应对 HR 压价的 3 套回应。结合我的技术栈与市场行情给具体数字区间。',
    },
  },
  {
    id: 'pk-en', kind: 'expert', icon: '🇬🇧', name: 'English Interviewer', tag: '外企/英文面',
    desc: '用英文进行技术面试模拟与表达润色',
    expert: {
      name: 'English Interviewer', icon: '🇬🇧', tag: '外企/英文面',
      task: 'You are a senior interviewer at a global tech company. First check my background (use my_stats / get_resume), then: (1) list 5 most likely English interview questions for me, (2) give strong sample answers framework (STAR) for the top 2, (3) point out Chinese-English expression pitfalls for technical terms in my resume. 用中文解释、英文给出问题与范例句。',
    },
  },
  {
    id: 'pk-arch', kind: 'expert', icon: '🏛️', name: '首席架构师评委', tag: '系统设计评审',
    desc: '以晋升答辩评委的标准审视你的系统设计能力',
    expert: {
      name: '首席架构师评委', icon: '🏛️', tag: '系统设计评审',
      task: '你是大厂晋升答辩的架构评委。先用 my_stats 了解我的水平，然后出一道由浅入深的系统设计题链（3 问，从容量估算到权衡取舍），每问给出评分标准（优秀/合格/不合格的答案各长什么样），最后给我的准备路径排序。',
    },
  },
  {
    id: 'pk-github', kind: 'tool', icon: '🐙', name: 'GitHub 仓库情报', tag: 'HTTP 工具',
    desc: 'Agent 可搜索 GitHub 仓库（stars/描述/语言），用于技术选型与学习资料调研',
    tool: {
      name: 'github_search', argsHint: 'query',
      description: '搜索 GitHub 仓库，返回与关键词相关的仓库（star 数、简介、语言）。适合技术选型、找学习项目、调研开源替代品。',
      urlTemplate: 'https://api.github.com/search/repositories?q={{query}}&per_page=5&sort=stars',
    },
  },
  {
    id: 'pk-hn', kind: 'tool', icon: '🟠', name: 'HN 技术情报', tag: 'HTTP 工具',
    desc: 'Agent 可搜索 Hacker News 讨论帖，获取业界观点与技术趋势',
    tool: {
      name: 'hn_search', argsHint: 'query',
      description: '搜索 Hacker News（YC）上的技术讨论帖，返回标题与摘要。适合了解业界对某技术的真实评价与趋势。',
      urlTemplate: 'https://hn.algolia.com/api/v1/search?query={{query}}&hitsPerPage=5&tags=story',
    },
  },
];

/* ---------- 工具执行器 ---------- */

const TOOLS = {
  my_stats() {
    return collectStatsText(true);
  },
  search_bank(args = {}) {
    const kw = String(args.query || '').trim().toLowerCase();
    if (!kw) return { error: 'query 不能为空' };
    const hits = S.questions
      .filter((q) => `${q.q} ${q.a} ${(q.tags || []).join(' ')}`.toLowerCase().includes(kw))
      .slice(0, 8);
    return { 题目: hits.map((q) => ({ id: q.id, 题干: q.q.slice(0, 60), 分类: q.cat, 已掌握: isMastered(q.id) })), 命中数: hits.length };
  },
  get_resume() {
    const r = S.resumes[0];
    if (!r) return { 提示: '用户还没有保存简历，请提醒用户先在「简历工坊」填写并保存' };
    return { 简历全文: r.content.slice(0, 3000) };
  },
  async search_jobs(args = {}) {
    const kw = String(args.query || '').trim().toLowerCase();
    try {
      const res = await fetch('/api/jobs?limit=200');
      const j = await res.json();
      const hits = j.jobs
        .filter((x) => !kw || `${x.title} ${x.company} ${x.body || ''}`.toLowerCase().includes(kw))
        .slice(0, 6);
      return { 岗位: hits.map((x) => ({ 标题: x.title.slice(0, 50), 公司: x.company, 薪资: x.salary || '未知', 摘要: (x.body || '').slice(0, 200) })), 岗位库总数: j.total };
    } catch (e) {
      return { error: '岗位库读取失败：' + e.message };
    }
  },
  add_cards(args = {}) {
    const cards = Array.isArray(args.cards) ? args.cards : [];
    const items = cards
      .filter((c) => c && typeof c.q === 'string' && c.q.trim() && typeof c.a === 'string' && c.a.trim())
      .slice(0, 10)
      .map((c, i) => ({
        id: `custom-${Date.now()}-${i}`,
        q: String(c.q).trim(), a: String(c.a).trim(),
        cat: 'custom', diff: 2, tags: ['Agent生成'],
      }));
    if (!items.length) return { error: 'cards 需为 [{q, a}] 数组' };
    S.custom = [...S.custom, ...items];
    persist('custom');
    remergeBank();
    renderBank();
    renderDashboard();
    return { 已创建练习题: items.length, 说明: '已并入题库自定义分类并进入复习系统' };
  },
  save_knowledge(args = {}) {
    const title = String(args.title || '').trim();
    const content = String(args.content || '').trim();
    if (!title || !content) return { error: 'title 与 content 必填' };
    S.knowledge.unshift({
      id: 'kn-' + Date.now(), title, content,
      tags: Array.isArray(args.tags) ? args.tags.map(String).slice(0, 5) : ['Agent'],
      updated: Date.now(),
    });
    persist('knowledge');
    return { 已保存知识: title };
  },
  search_knowledge(args = {}) {
    const kw = String(args.query || '').trim().toLowerCase();
    if (!kw) return { error: 'query 不能为空' };
    const hits = S.knowledge
      .filter((k) => `${k.title} ${k.content} ${(k.tags || []).join(' ')}`.toLowerCase().includes(kw))
      .slice(0, 5);
    return { 知识条目: hits.map((k) => ({ 标题: k.title, 摘要: (k.content || '').slice(0, 160), 标签: k.tags })), 命中数: hits.length, 知识库总量: S.knowledge.length };
  },
  my_wrong() {
    const wrong = wrongList().slice(0, 8).map((qid) => {
      const q = S.questions.find((x) => x.id === qid);
      const c = S.srs[qid];
      return { 题干: q?.q?.slice(0, 50), 挂科次数: c.lapses, 当前间隔级别: c.box };
    });
    return { 错题数: wrongList().length, 错题: wrong };
  },
  get_profile() {
    const cards = S.profile.cards.slice(0, 20);
    return cards.length
      ? { 画像卡: cards.map((c) => `[${c.type}] ${c.content}`), 说明: '这些是用户历次面试/诊断沉淀的长期画像，出题与建议应据此个性化' }
      : { 画像卡: [], 说明: '用户还没有画像沉淀，按常规处理' };
  },
};

export function collectStatsText(forTool = false) {
  const cats = catMastery();
  const mocks = S.sessions.filter((s) => s.kind === 'mock' && s.score != null);
  const avg = mocks.length ? Math.round(mocks.reduce((a, s) => a + s.score, 0) / mocks.length) : null;
  const daysLeft = S.targetDate
    ? Math.ceil((new Date(S.targetDate + 'T23:59:59') - new Date()) / 86400000)
    : null;
  const data = {
    连续打卡天数: streakDays(),
    各分类掌握度: cats.map((c) => `${c.name}: ${c.mastered}/${c.total}（${c.pct}%）`),
    待复习题数: dueList().length,
    错题数: wrongList().length,
    已学题目数: Object.keys(S.srs).length,
    模拟面试: mocks.length ? `共 ${mocks.length} 场均分 ${avg}，最近三场：${mocks.slice(0, 3).map((m) => `${m.score}分`).join('、')}` : '暂无',
    知识库条目: S.knowledge.length,
    目标面试日期: daysLeft != null ? `${S.targetDate}（${daysLeft >= 0 ? `还剩 ${daysLeft} 天` : '已过，请更新' }）` : '未设置',
    长期画像: S.profile.cards.length ? `${S.profile.cards.length} 条（可用 get_profile 读取详情）` : '暂无',
  };
  if (forTool) return data;
  return `连续打卡 ${data.连续打卡天数} 天；待复习 ${data.待复习题数} 题；错题 ${data.错题数} 道；已学 ${data.已学题目数} 题；模拟面试：${data.模拟面试}；分类掌握：${data.各分类掌握度.join('；')}；知识库 ${data.知识库条目} 条；目标面试：${data.目标面试日期}。`;
}

async function execTool(call, allowedTools) {
  const name = call.name;
  const isCustom = !TOOLS[name] && S.customTools.some((t) => t.name === name);
  if (allowedTools && !TOOLS[name] && !isCustom) return { error: `工具 ${name} 不在白名单` };
  if (allowedTools && !allowedTools.includes(name) && !allowedTools.includes('*')) {
    return { error: `该专家未授权工具 ${name}` };
  }
  try {
    if (TOOLS[name]) return await TOOLS[name](call.args || {});
    // 自定义 HTTP 工具：经服务端代理抓取（绕开 CORS）
    const t = S.customTools.find((x) => x.name === name);
    let url = t.urlTemplate;
    for (const [k, v] of Object.entries(call.args || {})) {
      url = url.split(`{{${k}}}`).join(encodeURIComponent(String(v)));
    }
    const res = await fetch('/api/tools/http', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const j = await res.json();
    if (!res.ok) return { error: j.error || `HTTP ${res.status}` };
    return { status: j.status, 内容: j.text };
  } catch (e) {
    return { error: e.message };
  }
}

function parseToolCall(text, allowedTools) {
  const m = text.match(/TOOL:\s*(\{[\s\S]*?\})\s*$/);
  if (!m) return null;
  try {
    const call = JSON.parse(m[1]);
    if (call && typeof call.name === 'string' && (TOOLS[call.name] || S.customTools.some((t) => t.name === call.name))) {
      return call;
    }
  } catch (_) { /* JSON 不完整（流式截断），视为未完成 */ }
  return null;
}

/* ---------- 通用 Agent 循环（对话与会诊共用） ---------- */

export async function agentLoop({ messages, persona = 'mentor', personaText = '', allowedTools = null, onDelta, onTool, signal, maxSteps = MAX_TOOL_CALLS }) {
  const convo = messages.map((m) => ({ ...m }));
  const payload = { mode: 'agent', persona, messages: convo };
  if (personaText) { payload.personaText = personaText; payload.persona = 'mentor'; }
  if (S.customTools.length) payload.customTools = S.customTools.map((t) => ({ name: t.name, description: t.description, argsHint: t.argsHint }));
  for (let step = 0; step <= maxSteps; step++) {
    let full = '';
    await streamChat(
      { ...payload, messages: convo },
      (d) => {
        full += d;
        if (!/TOOL:/.test(full)) onDelta?.(full, step);
      },
      signal
    );
    const call = parseToolCall(full, allowedTools);
    if (!call) return { text: full, convo };
    convo.push({ role: 'assistant', content: full });
    const result = await execTool(call, allowedTools);
    onTool?.(call, result);
    convo.push({ role: 'user', content: 'TOOL_RESULT: ' + JSON.stringify(result).slice(0, 4000) });
    if (step === maxSteps - 1) {
      convo.push({ role: 'user', content: '（工具调用次数已达上限，请基于现有信息直接给出最终回答）' });
    }
  }
  // 理论上到不了这里；兜底再要一次最终回答
  let full = '';
  await streamChat(
    { ...payload, messages: [...convo, { role: 'user', content: '请直接给出最终回答。' }] },
    (d) => { full += d; onDelta?.(full); },
    signal
  );
  return { text: full, convo };
}

/* ---------- 对话模式 ---------- */

let history = [];
let busy = false;

export function init() {
  $('#btn-agent-send').addEventListener('click', send);
  $('#agent-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('#btn-agent-stop').addEventListener('click', () => window.__agentCtrl?.abort());
  // 模式切换
  $$('#agent-tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      $$('#agent-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      $('#agent-chat-pane').classList.toggle('hidden', b.dataset.tab !== 'chat');
      $('#agent-panel-pane').classList.toggle('hidden', b.dataset.tab !== 'panel');
      $('#agent-market-pane').classList.toggle('hidden', b.dataset.tab !== 'market');
      if (b.dataset.tab === 'panel') renderPanelCards();
      if (b.dataset.tab === 'market') renderMarket();
    });
  });
  $('#btn-panel-run').addEventListener('click', runPanel);
  $('#btn-tool-new')?.addEventListener('click', () => openToolEditor());
  $('#btn-expert-new')?.addEventListener('click', () => openExpertEditor());
  $('#btn-skills-export')?.addEventListener('click', exportSkills);
  $('#btn-skills-import')?.addEventListener('click', importSkills);
}

/* 全部可选专家（内置 + 自定义） */
function allExperts() {
  return [
    ...PANEL,
    ...S.customExperts.map((e) => ({
      key: e.id, icon: e.icon || '🤖', name: e.name, tag: e.tag || '自定义',
      task: e.task, personaText: `你是「${e.name}」，${e.task}`, custom: true,
    })),
  ];
}

export function onShow() {
  renderMissions();
  renderPanelCards();
  if (!history.length && !$('.msg', $('#agent-messages'))) {
    $('#agent-messages').innerHTML = `
      <div class="msg ai" id="agent-welcome">
        <div class="avatar">${icon('bot')}</div>
        <div class="bubble md">
          <p><strong>我是 Mentor，你的智能体教练。</strong>我可以调用工具读取你的真实数据——题库掌握度、简历、岗位库——然后多步执行任务：制定冲刺计划、匹配岗位、生成特训清单并直接写入你的题库和知识库。</p>
          <p>👉 从下面的任务卡开始，或直接输入指令（如「帮我看看 MySQL 方面我有哪些弱项」）。也可以切到「多 Agent 会诊」让三位专家同时给你看病。</p>
        </div>
      </div>`;
  }
}

function renderMissions() {
  const box = $('#agent-missions');
  box.innerHTML = MISSIONS.map((m, i) => `
    <button class="mission-card" data-i="${i}">
      <div class="mission-ico">${icon(m.icon, 20)}</div>
      <div>
        <div class="mission-name">${esc(m.name)}</div>
        <div class="mission-desc">${esc(m.desc)}</div>
      </div>
      <span class="ico chev">${icon('chevron', 16)}</span>
    </button>`).join('');
  $$('[data-i]', box).forEach((b) => {
    b.onclick = () => {
      const m = MISSIONS[Number(b.dataset.i)];
      $('#agent-input').value = m.prompt;
      send();
    };
  });
  staggerIn(box, '.mission-card', 50);
}

function addMsg(role, html) {
  const box = $('#agent-messages');
  $('#agent-welcome')?.remove();
  const el = document.createElement('div');
  el.className = `msg ${role === 'user' ? 'user' : 'ai'}`;
  el.innerHTML = `<div class="avatar">${role === 'user' ? icon('user') : icon('bot')}</div><div class="bubble md"></div>${role === 'user' ? '' : '<button class="msg-copy" title="复制本条">⧉ 复制</button>'}`;
  $('.bubble', el).innerHTML = html;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return $('.bubble', el);
}

async function send() {
  if (busy) return;
  const input = $('#agent-input');
  const text = input.value.trim();
  if (!text) return;
  if (!hasKey()) { toast('智能体需要先配置 API Key', 'err'); switchView('settings'); return; }
  input.value = '';
  addMsg('user', md(text));
  history.push({ role: 'user', content: text });
  await runChat();
}

async function runChat() {
  busy = true;
  $('#btn-agent-send').disabled = true;
  $('#btn-agent-stop').classList.remove('hidden');
  const ctrl = new AbortController();
  window.__agentCtrl = ctrl;
  let bubble = addMsg('ai', '<span class="typing"><i></i><i></i><i></i></span>');

  try {
    const res = await agentLoop({
      messages: history,
      onDelta: (full) => {
        bubble.innerHTML = md(full);
        $('#agent-messages').scrollTop = $('#agent-messages').scrollHeight;
      },
      onTool: (call, result) => {
        bubble.remove();
        bubble = addMsg('ai', '<span class="typing"><i></i><i></i><i></i></span>');
        toolChip(call, result);
      },
      signal: ctrl.signal,
    });
    bubble.innerHTML = md(res.text);
    history = res.convo;
    history.push({ role: 'assistant', content: res.text });
  } catch (e) {
    if (e.name === 'AbortError') bubble.innerHTML = md('*（已停止）*');
    else bubble.innerHTML = `<p style="color:var(--danger)">出错了：${esc(e.message)}</p>`;
  } finally {
    busy = false;
    $('#btn-agent-send').disabled = false;
    $('#btn-agent-stop').classList.add('hidden');
  }
}

function toolChip(call, result) {
  const short = JSON.stringify(call.args ?? {}).slice(0, 40);
  const ok = result && !result.error;
  const el = document.createElement('div');
  el.className = 'tool-chip';
  el.innerHTML = `${icon('cpu', 13)} <b>${esc(call.name)}</b>(<span class="muted">${esc(short)}</span>)
    <span class="badge ${ok ? 'ok' : 'warn'}">${ok ? '✓ 完成' : '✕ ' + (result?.error || '失败')}</span>
    <details><summary>结果</summary><pre>${esc(JSON.stringify(result, null, 1).slice(0, 1200))}</pre></details>`;
  $('#agent-messages').appendChild(el);
  $('#agent-messages').scrollTop = $('#agent-messages').scrollHeight;
}

/* ---------- 多 Agent 会诊 ---------- */

function renderPanelCards() {
  const picked = S.panelPick.filter((k) => allExperts().some((e) => e.key === k));
  const experts = allExperts().filter((e) => picked.includes(e.key));
  // 专家选择 chips
  const pickBox = $('#panel-pick');
  if (pickBox) {
    pickBox.innerHTML = allExperts().map((e) => `
      <button class="chip${picked.includes(e.key) ? ' active' : ''}" data-pk="${esc(e.key)}">
        ${e.icon} ${esc(e.name)}${e.custom ? ' ⭐' : ''}
      </button>`).join('');
    $$('[data-pk]', pickBox).forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.pk;
        const i = S.panelPick.indexOf(k);
        if (i >= 0) S.panelPick.splice(i, 1);
        else if (S.panelPick.length >= 5) { toast('会诊团最多 5 位专家'); return; }
        else S.panelPick.push(k);
        if (!S.panelPick.length) S.panelPick = ['interviewer'];
        persist('panelPick');
        renderPanelCards();
      };
    });
  }
  $('#panel-grid').innerHTML = experts.map((p) => `
    <div class="panel-card" data-key="${esc(p.key)}">
      <div class="panel-head">
        <div class="mission-ico">${p.icon}</div>
        <div><b>${esc(p.name)}</b><div class="muted" style="font-size:11.5px">${esc(p.tag)}</div></div>
        <span class="badge panel-state" style="margin-left:auto">待命</span>
      </div>
      <div class="panel-tools"></div>
      <div class="panel-body md"></div>
    </div>`).join('') + `
    <div class="panel-card synthesis" data-key="synthesis">
      <div class="panel-head">
        <div class="mission-ico">${icon('sparkles', 18)}</div>
        <div><b>会诊结论</b><div class="muted" style="font-size:11.5px">Mentor 汇总${experts.length}方意见</div></div>
        <span class="badge panel-state" style="margin-left:auto">待各方完成</span>
      </div>
      <div class="panel-body md"></div>
    </div>`;
}

async function runPanel() {
  if (busy) return;
  if (!hasKey()) { toast('会诊需要先配置 API Key', 'err'); switchView('settings'); return; }
  const experts = allExperts().filter((e) => S.panelPick.includes(e.key));
  if (!experts.length) { toast('先在上方选择至少一位专家'); return; }
  busy = true;
  const btn = $('#btn-panel-run');
  btn.disabled = true;
  btn.innerHTML = '<span class="typing"><i></i><i></i><i></i></span> 会诊中…';

  const opinions = {};
  await Promise.all(experts.map(async (p) => {
    const card = document.querySelector(`.panel-card[data-key="${CSS.escape(p.key)}"]`);
    if (!card) return;
    const state = $('.panel-state', card);
    const body = $('.panel-body', card);
    const toolsBox = $('.panel-tools', card);
    state.textContent = '分析中'; state.className = 'badge warn panel-state';
    try {
      const res = await agentLoop({
        messages: [{ role: 'user', content: p.task }],
        persona: p.custom ? undefined : p.key,
        personaText: p.custom ? p.personaText : '',
        allowedTools: ['*'],
        onDelta: (full) => { body.innerHTML = md(full); },
        onTool: (call, result) => {
          const chip = document.createElement('div');
          chip.className = 'tool-chip';
          chip.innerHTML = `${icon('cpu', 12)} <b>${esc(call.name)}</b> <span class="badge ${result?.error ? 'warn' : 'ok'}">${result?.error ? '✕' : '✓'}</span>`;
          toolsBox.appendChild(chip);
        },
      });
      body.innerHTML = md(res.text);
      state.textContent = '完成'; state.className = 'badge ok panel-state';
      opinions[p.key] = `${p.name}：\n${res.text}`;
    } catch (e) {
      body.innerHTML = `<p style="color:var(--danger)">出错了：${esc(e.message)}</p>`;
      state.textContent = '失败'; state.className = 'badge warn panel-state';
    }
  }));

  // 汇总裁决
  const synCard = document.querySelector('.panel-card[data-key="synthesis"]');
  const synState = $('.panel-state', synCard);
  const synBody = $('.panel-body', synCard);
  if (Object.keys(opinions).length) {
    synState.textContent = '汇总中'; synState.className = 'badge warn panel-state';
    try {
      let full = '';
      await streamChat(
        {
          mode: 'agent', persona: 'mentor',
          messages: [{ role: 'user', content: `三位专家刚对同一位候选人完成会诊，意见如下：\n\n${Object.values(opinions).join('\n\n---\n\n')}\n\n请汇总：指出意见一致与冲突之处，去重合并，输出「本周行动清单 Top5」（每条注明来源专家），最后给一个一句话总判断。` }],
        },
        (d) => { full += d; synBody.innerHTML = md(full); }
      );
      synState.textContent = '完成'; synState.className = 'badge ok panel-state';
      const { confetti } = await import('../core.js');
      confetti(1500);
    } catch (e) {
      synBody.innerHTML = `<p style="color:var(--danger)">汇总失败：${esc(e.message)}</p>`;
      synState.textContent = '失败';
    }
  } else {
    synState.textContent = '三方均未产出';
  }

  busy = false;
  btn.disabled = false;
  btn.innerHTML = `${icon('sparkles', 14)}开始会诊`;
}

/* ---------- 技能市场 ---------- */

function renderMarket() {
  // 我的工具
  const toolBox = $('#my-tools');
  toolBox.innerHTML = S.customTools.length
    ? S.customTools.map((t) => `
      <div class="sub-item">
        <div class="sub-main">
          <div class="sub-title"><span class="badge">${esc(t.name)}</span> ${esc((t.description || '').slice(0, 40))}</div>
          <div class="muted" style="font-size:12px">${esc((t.urlTemplate || '').slice(0, 70))}</div>
        </div>
        <button class="btn small ghost" data-tedit="${esc(t.id)}">编辑</button>
        <button class="btn small danger" data-tdel="${esc(t.id)}">删除</button>
      </div>`).join('')
    : '<p class="hint">还没有自定义工具。可从下方官方包安装，或新建一个 HTTP 工具接入你自己的接口。</p>';
  $$('[data-tedit]', toolBox).forEach((b) => { b.onclick = () => openToolEditor(S.customTools.find((t) => t.id === b.dataset.tedit)); });
  $$('[data-tdel]', toolBox).forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmModal('删除该工具？'))) return;
      S.customTools = S.customTools.filter((t) => t.id !== b.dataset.tdel);
      persist('customTools');
      renderMarket();
    };
  });

  // 我的专家
  const exBox = $('#my-experts');
  exBox.innerHTML = S.customExperts.length
    ? S.customExperts.map((e) => `
      <div class="sub-item">
        <div class="sub-main">
          <div class="sub-title"><span class="badge">${e.icon || '🤖'} ${esc(e.name)}</span> <span class="badge ok">${esc(e.tag || '自定义')}</span></div>
          <div class="muted" style="font-size:12px">${esc((e.task || '').slice(0, 60))}</div>
        </div>
        <button class="btn small ghost" data-eedit="${esc(e.id)}">编辑</button>
        <button class="btn small danger" data-edel="${esc(e.id)}">删除</button>
      </div>`).join('')
    : '<p class="hint">还没有自定义专家。安装官方包或新建，即可加入多 Agent 会诊团（⭐标记）。</p>';
  $$('[data-eedit]', exBox).forEach((b) => { b.onclick = () => openExpertEditor(S.customExperts.find((e) => e.id === b.dataset.eedit)); });
  $$('[data-edel]', exBox).forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmModal('删除该专家？'))) return;
      S.customExperts = S.customExperts.filter((e) => e.id !== b.dataset.edel);
      S.panelPick = S.panelPick.filter((k) => k !== b.dataset.edel);
      persist('customExperts'); persist('panelPick');
      renderMarket();
    };
  });

  // 官方技能包
  $('#pack-grid').innerHTML = OFFICIAL_PACKS.map((p) => {
    const installed = p.kind === 'tool'
      ? S.customTools.some((t) => t.name === p.tool.name)
      : S.customExperts.some((e) => e.name === p.expert.name);
    return `
    <div class="pack-card">
      <div class="pack-head">
        <div class="mission-ico">${p.icon}</div>
        <div><b>${esc(p.name)}</b><div class="muted" style="font-size:11.5px">${esc(p.tag)}</div></div>
        <span class="badge ${p.kind === 'tool' ? '' : 'ok'}" style="margin-left:auto">${p.kind === 'tool' ? '工具' : '专家'}</span>
      </div>
      <div class="muted" style="font-size:12.5px;flex:1">${esc(p.desc)}</div>
      <button class="btn small ${installed ? '' : 'primary'}" data-pk="${p.id}" ${installed ? 'disabled' : ''}>
        ${installed ? '已安装' : '一键安装'}
      </button>
    </div>`;
  }).join('');
  $$('[data-pk]', $('#pack-grid')).forEach((b) => {
    b.onclick = () => {
      const p = OFFICIAL_PACKS.find((x) => x.id === b.dataset.pk);
      if (p.kind === 'tool') {
        if (S.customTools.some((t) => t.name === p.tool.name)) return;
        S.customTools.push({ id: 'ct-' + Date.now(), ...p.tool });
        persist('customTools');
        toast(`工具「${p.name}」已安装，Mentor 现在可以调用它`, 'ok');
      } else {
        if (S.customExperts.some((e) => e.name === p.expert.name)) return;
        S.customExperts.push({ id: 'ce-' + Date.now(), ...p.expert });
        persist('customExperts');
        toast(`专家「${p.name}」已安装，去会诊面板勾选 TA`, 'ok');
      }
      renderMarket();
    };
  });
}

function openToolEditor(t = null) {
  const m = openModal(`
    <label class="field"><span>工具名（字母数字下划线，模型用它调用）</span>
      <input id="te-name" class="input" value="${t ? esc(t.name) : ''}" placeholder="如 corp_wiki_search"></label>
    <label class="field"><span>用途描述（给模型看，越清楚越容易被正确调用）</span>
      <input id="te-desc" class="input" value="${t ? esc(t.description) : ''}" placeholder="搜索公司内部知识库，返回相关文档摘要"></label>
    <label class="field"><span>参数名（逗号分隔，与 URL 模板对应）</span>
      <input id="te-args" class="input" value="${t ? esc(t.argsHint || '') : ''}" placeholder="query"></label>
    <label class="field"><span>URL 模板（GET 请求，{{参数名}} 为占位符）</span>
      <input id="te-url" class="input" value="${t ? esc(t.urlTemplate) : ''}" placeholder="https://内网地址/api/search?q={{query}}"></label>
    <div class="actions" style="justify-content:flex-end"><button class="btn primary" id="te-ok">${icon('check', 14)}保存</button></div>
    <p class="hint">执行由本机服务代理（绕开 CORS），12 秒超时，返回前 3000 字符。仅配置你信任的地址。</p>`,
    { title: t ? '编辑工具' : '新建 HTTP 工具', icon: 'cpu', width: 640 });
  $('#te-ok', m.el).onclick = () => {
    const name = $('#te-name', m.el).value.trim();
    const url = $('#te-url', m.el).value.trim();
    if (!/^[a-z_][a-z0-9_]{1,20}$/i.test(name)) { toast('工具名格式不对（字母开头，2-21 位）', 'err'); return; }
    if (!/^https?:\/\//.test(url) || !url.includes('{{')) { toast('URL 需以 http(s) 开头并包含 {{参数}} 占位符', 'err'); return; }
    if (TOOLS[name]) { toast('与内置工具重名', 'err'); return; }
    const item = {
      id: t?.id || 'ct-' + Date.now(),
      name, urlTemplate: url,
      description: $('#te-desc', m.el).value.trim() || '自定义工具',
      argsHint: $('#te-args', m.el).value.trim() || 'args',
    };
    S.customTools = t ? S.customTools.map((x) => (x.id === t.id ? item : x)) : [...S.customTools, item];
    persist('customTools');
    m.close();
    renderMarket();
    toast('工具已保存', 'ok');
  };
}

function openExpertEditor(e = null) {
  const m = openModal(`
    <label class="field"><span>专家名称</span><input id="ee-name" class="input" value="${e ? esc(e.name) : ''}" placeholder="如：英语面试官"></label>
    <label class="field"><span>图标（一个 emoji）+ 标签</span>
      <div style="display:flex;gap:10px">
        <input id="ee-icon" class="input" style="max-width:90px" value="${e ? esc(e.icon || '🤖') : '🤖'}">
        <input id="ee-tag" class="input" value="${e ? esc(e.tag || '') : ''}" placeholder="如：外企/英文面">
      </div></label>
    <label class="field"><span>任务指令（这位专家做什么、怎么输出；可用工具会自动注入）</span>
      <textarea id="ee-task" rows="8" placeholder="你是……。先用 my_stats 了解我的情况，然后……">${e ? esc(e.task) : ''}</textarea></label>
    <div class="actions" style="justify-content:flex-end"><button class="btn primary" id="ee-ok">${icon('check', 14)}保存</button></div>`,
    { title: e ? '编辑专家' : '新建专家', icon: 'brain', width: 640 });
  $('#ee-ok', m.el).onclick = () => {
    const name = $('#ee-name', m.el).value.trim();
    const task = $('#ee-task', m.el).value.trim();
    if (!name || !task) { toast('名称和任务指令必填', 'err'); return; }
    const item = {
      id: e?.id || 'ce-' + Date.now(),
      name, task,
      icon: $('#ee-icon', m.el).value.trim().slice(0, 4) || '🤖',
      tag: $('#ee-tag', m.el).value.trim() || '自定义',
    };
    S.customExperts = e ? S.customExperts.map((x) => (x.id === e.id ? item : x)) : [...S.customExperts, item];
    persist('customExperts');
    m.close();
    renderMarket();
    toast('专家已保存，去会诊面板勾选 TA', 'ok');
  };
}

function exportSkills() {
  const data = { app: 'interview-mate-skills', version: 1, tools: S.customTools, experts: S.customExperts };
  downloadFile('interview-mate-skills.json', JSON.stringify(data, null, 2), 'application/json');
  toast('技能已导出，可分享给朋友', 'ok');
}

function importSkills() {
  const m = openModal(`
    <label class="field"><span>粘贴技能 JSON（别人导出的文件内容）</span>
      <textarea id="im-ta" rows="10" placeholder='{"app":"interview-mate-skills", ...}'></textarea></label>
    <div class="actions" style="justify-content:flex-end"><button class="btn primary" id="im-ok">${icon('check', 14)}导入</button></div>`,
    { title: '导入技能', icon: 'package', width: 640 });
  $('#im-ok', m.el).onclick = () => {
    try {
      const j = JSON.parse($('#im-ta', m.el).value);
      if (j.app !== 'interview-mate-skills') throw new Error('不是 InterviewMate 技能文件');
      let n = 0;
      for (const t of (j.tools || [])) {
        if (t?.name && t.urlTemplate && !S.customTools.some((x) => x.name === t.name) && !TOOLS[t.name]) {
          S.customTools.push({ id: 'ct-' + Date.now() + '-' + n, name: t.name, urlTemplate: t.urlTemplate, description: t.description || '', argsHint: t.argsHint || 'args' });
          n++;
        }
      }
      for (const e of (j.experts || [])) {
        if (e?.name && e.task && !S.customExperts.some((x) => x.name === e.name)) {
          S.customExperts.push({ id: 'ce-' + Date.now() + '-' + n, name: e.name, task: e.task, icon: e.icon || '🤖', tag: e.tag || '导入' });
          n++;
        }
      }
      persist('customTools'); persist('customExperts');
      m.close();
      renderMarket();
      toast(`导入 ${n} 项技能`, 'ok');
    } catch (e) {
      toast('导入失败：' + e.message, 'err');
    }
  };
}
