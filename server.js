/**
 * InterviewMate · AI 面试陪练 —— 本地服务
 *
 * 零第三方依赖（Node.js 18+），职责：
 *   1. 托管 public/ 下的静态前端
 *   2. 提供 GET /api/questions 内置题库
 *   3. POST /api/chat：将对话转发到任意 OpenAI 兼容的 LLM 服务，并以流式（SSE 原文）透传
 *
 * 配置优先级：页面「设置」中填写 > 服务端环境变量 / .env 文件 > 默认值
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const jobs = require('./lib/jobs.js');
const briefs = require('./lib/briefs.js');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const QUESTIONS_FILE = path.join(ROOT, 'data', 'questions.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

/* ---------------- 极简 .env 加载（文件不存在则跳过） ---------------- */
(function loadDotEnv() {
  try {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch (e) {
    console.warn('[warn] .env 解析失败（忽略）：', e.message);
  }
})();

const DEFAULTS = {
  baseURL: process.env.INTERVIEW_MATE_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
  model: process.env.INTERVIEW_MATE_MODEL || 'glm-4-flash',
  apiKey: process.env.INTERVIEW_MATE_API_KEY || '',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.webm': 'audio/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
};

/* ---------------- 提示词 ---------------- */

const ROLE_MAP = {
  fe: '前端工程师',
  java: '后端工程师（Java）',
  go: '后端工程师（Go）',
  algo: '算法工程师',
  test: '测试工程师',
  pm: '产品经理',
  general: '通用软件工程师',
};

const TYPE_MAP = {
  basics: '技术基础面（八股 + 概念辨析）',
  project: '项目深挖面（围绕候选人项目经历追问细节）',
  system: '系统设计面（场景设计与权衡）',
  behavior: '行为面试（软素质、协作、方法论，用 STAR 方式追问）',
  mixed: '综合模拟（基础 + 项目 + 行为混合出题）',
};

const LEVEL_MAP = {
  intern: '实习/校招，考察基础与潜力',
  junior: '初级（1-3 年），考察基础与工程能力',
  senior: '中高级（3 年以上），考察深度、权衡与架构能力',
};

function buildMockSystemPrompt(cfg) {
  const role = ROLE_MAP[cfg.role] || ROLE_MAP.general;
  const type = TYPE_MAP[cfg.type] || TYPE_MAP.mixed;
  const level = LEVEL_MAP[cfg.level] || LEVEL_MAP.junior;
  const lang = cfg.lang === 'en' ? 'English' : '简体中文';
  return [
    `你是一位经验丰富的${role}面试官，正在进行一场${type}。候选人级别：${level}。整场面试使用${lang}。`,
    `本场共约 ${cfg.count || 5} 个问题。你的行为准则：`,
    '1. 一次只问一个问题，绝不一次抛出多个问题。',
    '2. 收到候选人回答后：先用 1-2 句简短点评（肯定对的部分、指出遗漏或错误），再自然过渡到下一个问题。',
    '3. 适度追问：当候选人的回答含糊或涉及可疑细节时，就同一话题深挖一层，而不是急着换题。',
    '4. 点评简洁、专业、友善，不泄露标准答案的完整内容。',
    '5. 候选人明显跑题时，温和地把面试拉回主线。',
    '6. 你的第一条消息：一段 2-3 句的开场白（自我介绍面试流程），然后提出第一个问题。',
  ].join('\n');
}

const REPORT_INSTRUCTION = [
  '【系统指令】面试到此结束。请基于以上全部对话，输出最终评估报告，严格使用如下 Markdown 格式：',
  '# 面试评估报告',
  '## 总体评分：X/100',
  '（一句话总评）',
  '## 分项评分',
  '- 技术深度：X/10（一句话依据）',
  '- 表达与结构：X/10（一句话依据）',
  '- 问题理解：X/10（一句话依据）',
  '- 岗位匹配度：X/10（一句话依据）',
  '## 亮点',
  '（2-4 条，引用候选人具体回答）',
  '## 待改进',
  '（2-4 条，指出具体知识缺口，可推荐复习方向）',
  '## 复习建议',
  '（2-4 条，给出可执行的下一步）',
  '评分要严格、有区分度、有依据，不要客套。',
].join('\n');

function buildResumeSystemPrompt() {
  return [
    '你是一位资深技术招聘官兼面试辅导专家。用户会提供「简历内容」和「目标岗位 JD」，请输出结构化分析，严格使用如下 Markdown 格式：',
    '# JD 匹配分析',
    '## 匹配度评估：X/100',
    '（一句话结论）',
    '## 关键要求对照',
    '- 要求：… → 简历证据：… / 缺失：…',
    '（逐条对照 JD 的硬性要求与加分项）',
    '## 面试官可能追问的问题',
    '（8-10 个，按追问概率从高到低排列，覆盖技术栈、项目细节、匹配缺口）',
    '## 简历风险点与修改建议',
    '（2-5 条，指出表述不清、量化不足、与 JD 不匹配之处，给出改写示例）',
    '分析要具体、直接，基于用户给出的材料，不要编造不存在的内容。',
  ].join('\n');
}

function buildDeepdiveSystemPrompt(question, answer) {
  return [
    '你是一位严厉但公正的面试官，正在就下面这道面试题对候选人进行深度追问训练。',
    `题干：${question}`,
    `参考答案要点：${answer}`,
    '要求：一次只问一个追问；追问要有梯度（概念 → 原理 → 边界 → 权衡）；候选人答错时先点出问题再给提示；不要一次给出完整答案。',
  ].join('\n');
}

const AGENT_TOOL_SPEC = [
  '可用工具（每次最多一个）：',
  '1. my_stats() — 获取用户学习统计：各分类掌握度、待复习数、错题数、模拟面试历史得分、目标面试倒计时',
  '2. search_bank(query) — 按关键词搜索题库，返回题目（id、题干、分类、是否掌握）',
  '3. get_resume() — 获取用户当前保存的简历全文',
  '4. search_jobs(query) — 搜索已汇集的岗位库（含标题、公司、薪资、JD 摘要）',
  '5. add_cards(cards) — 为用户创建自定义练习题并进入复习系统，cards: [{q, a}]',
  '6. save_knowledge(title, content, tags) — 将内容存入用户知识库',
  '7. search_knowledge(query) — 搜索用户知识库条目（标题/内容/标签）',
  '8. my_wrong() — 获取用户错题本（挂科次数最多的题目）',
  '9. get_profile() — 读取用户长期画像（项目要点/高频失分点/薄弱技术/偏好，来自历次面试与诊断的沉淀）',
  '',
  '执行规则（严格遵守）：',
  '- 需要调用工具时，只输出一行，格式：TOOL: {"name": "工具名", "args": {...}}，然后立即停止输出，等待 TOOL_RESULT 消息。',
  '- 收到 TOOL_RESULT 后继续：要么再调用下一个工具（最多共 4 次），要么输出最终回答。',
  '- 最终回答为结构化中文 Markdown（用 ## 分节、- 列表），内容具体可执行，引用工具结果中的真实数据，不编造。',
  '- 用户如果只是闲聊或简单提问，无需工具，直接回答。',
].join('\n');

const AGENT_PERSONAS = {
  mentor: '你是 InterviewMate 的智能体教练「Mentor」，一个能调用工具、多步执行的面试求职教练，用专业、直接、可执行的口吻帮助用户。',
  interviewer: {
    text: '你是「首席面试官」，一位以严厉著称的技术面试专家。你的任务：基于工具获取的用户真实数据（强烈建议先调 my_stats，可再用 search_bank / get_resume），从考官视角指出该候选人最可能被挂掉的 3 个追问方向，每个方向给出你会怎么层层追问（至少两层的具体问法），以及你期望听到的回答要点。语气专业犀利，不留情面但有建设性。',
  },
  strategist: {
    text: '你是「求职军师」，一位资深职业策略顾问。基于工具获取的用户真实数据（my_stats、get_resume、search_jobs），给出两周内的作战策略：投递节奏（何时投、投什么类型）、优先补强顺序（结合薄弱分类与目标岗位）、每天时间分配建议。要具体到「第几天做什么」。',
  },
  coach: {
    text: '你是「复盘教练」，擅长把数据变成今天就能做的动作。基于工具获取的数据（my_stats、必要时 search_bank），输出 3 条具体改进动作：每条包含做什么、做多久、怎么算完成。如果用户有模拟面试历史，结合分数变化给出针对性诊断。',
  },
};

function customToolLines(extras) {
  return '额外可用工具（用户自定义）：\n' +
    extras.map((t) => `- ${t.name}(${t.argsHint || 'args'}) — ${String(t.description || '').slice(0, 200)}`).join('\n');
}

function buildAgentSystemPrompt(persona, customTools) {
  const p = AGENT_PERSONAS[persona];
  const intro = typeof p === 'string' ? p : (p && p.text) || AGENT_PERSONAS.mentor;
  const extras = Array.isArray(customTools) ? customTools : [];
  return intro + '\n\n' + AGENT_TOOL_SPEC + (extras.length ? '\n\n' + customToolLines(extras) : '');
}

function buildBriefSystemPrompt() {
  return [
    '你是 InterviewMate 的每日简报官。用户会提供一份学习数据快照（JSON/文本），请输出简短的中文 Markdown 每日简报，格式：',
    '## 昨日回顾\n（基于数据的一句总结，有进步要点出来）',
    '## 今日重点\n- （3 条，引用具体数字与题目方向，可直接执行）',
    '## 一句加油\n（简短有个性，不要鸡汤腔）',
    '全文 200 字以内，基于真实数据，不编造。',
  ].join('\n');
}

function buildParseResumePrompt() {
  return [
    '你是简历结构化专家。用户会提供简历原文（可能来自 PDF/Word 提取，含噪音），请解析为结构化 JSON。严格只输出一个 JSON 对象（不要其他文字、不要代码块包裹），格式：',
    '{',
    '"name": "姓名",',
    '"headline": "一句话头衔（如：后端工程师 · 3 年经验）",',
    '"contacts": ["电话/邮箱/GitHub 等联系方式，逐项"]',
    '"skills": ["技能点，拆分到词"]',
    '"sections": [{"heading": "小节名（教育背景/工作经历/项目经历…用原文语义）", "lines": ["该节下的每一行内容，去掉装饰符号，保留时间与量化数据"]}]',
    '}',
    '要求：保持原文事实不改动；噪音行（页码/纯符号）丢弃；无对应内容用空数组；行内不要加 Markdown 符号。',
  ].join('\n');
}

function buildProfilePrompt() {
  return [
    '你是面试复盘教练。基于用户提供的面试评估报告，提取值得长期记住的候选人画像卡。严格只输出一个 JSON 对象（不要其他文字、不要代码块包裹）：',
    '{"cards": [{"type": "项目|失分|薄弱|偏好|亮点", "content": "一句话，具体"}]}',
    '规则：只提取有跨场价值的信息（如「订单项目用 RabbitMQ 异步解耦，可深挖一致性追问」「表达偏啰嗦，结论先行不足」）；忽略只与本题相关的细节；最多 6 张卡；不编造。',
  ].join('\n');
}

function buildJdSystemPrompt() {
  return [
    '你是一位资深技术招聘官。用户会提供一段招聘 JD（岗位描述），请输出结构化分析，严格使用如下 Markdown 格式：',
    '# 岗位情报速览',
    '（一句话：这是什么岗位，核心方向是什么）',
    '## 硬性要求',
    '（逐条列出必须满足的条件）',
    '## 加分项',
    '（逐条列出优先项）',
    '## 面试重点预测',
    '（按追问概率排序的 5-8 个技术问题）',
    '## 备考建议',
    '（针对该 JD 的 2-4 条针对性准备建议）',
    '分析要具体、基于 JD 原文，不要编造不存在的要求。',
  ].join('\n');
}

function buildCardsSystemPrompt() {
  return [
    '你是面试备考专家。用户提供一段学习材料，请提炼成学习卡。严格只输出一个 JSON 对象（不要输出其他任何文字、不要用代码块包裹），格式：',
    '{"summary": "80 字以内的内容摘要", "cards": [{"q": "问题", "a": "答案要点（支持 - 列表）", "tags": ["标签"]}]}',
    '要求：卡片 3-8 张，覆盖材料中最可能被面试问到的知识点；问题要像面试官的追问；答案精炼可背诵。',
  ].join('\n');
}

function buildResumeV2SystemPrompt() {
  return [
    '你是一位资深技术招聘官兼面试辅导专家。用户会提供「简历内容」和「目标岗位 JD」，请输出结构化诊断。严格只输出一个 JSON 对象（不要其他文字、不要代码块包裹），格式：',
    '{',
    '"score": 0到100的整数（JD匹配度，评分严格有区分度）,',
    '"verdict": "一句话总评",',
    '"radar": [{"dim": "维度名（4字以内）", "score": 0到10}](4-6个维度，如：技术深度、工程经验、业务理解、软素质、匹配度),',
    '"coverage": [{"req": "JD要求（原文提炼）", "status": "covered或partial或missing", "evidence": "简历中的依据，缺失时写缺什么"}](逐条对照JD硬性要求与加分项),',
    '"followups": [{"q": "面试官可能追问的问题", "priority": "high或mid或low"}](8-10个，按概率排序),',
    '"risks": [{"issue": "简历风险点", "fix": "修改建议", "example": "改写示例"}](2-4条),',
    '"keywords": ["JD核心关键词"](8-12个)',
    '}',
    '要求：只基于用户提供的材料，不编造；evidence 要引用简历原文关键词；example 给出可直接使用的改写句子。',
  ].join('\n');
}

function buildPolishSystemPrompt() {
  return [
    '你是一位顶级简历教练，擅长把平淡的经历改写成让面试官眼前一亮的表述。用户提供简历内容（或其中一段），请润色。严格只输出一个 JSON 对象（不要其他文字、不要代码块包裹），格式：',
    '{',
    '"improved": "润色后的完整文本（保持原有结构与Markdown格式）",',
    '"notes": ["改动说明1", "改动说明2", ...](3-6条)',
    '}',
    '改写原则：动词开头、量化结果（提供占位如 X% 让用户自行填写）、STAR 结构、技术栈具体化、删除空话套话、每条经历控制在 1-2 行。',
    '红线：不编造事实与数据，不改变经历的时间线与公司，未量化的地方用「X」占位提示用户补充。',
  ].join('\n');
}

const FREE_SYSTEM =
  '你是 InterviewMate，一个友好的面试准备助手。用简体中文简洁、专业地回答问题。';

/* ---------------- 工具函数 ---------------- */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* 二进制读取（文件上传用） */
function readBodyRaw(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('文件过大（上限 20MB）'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // 本地工具，禁缓存保证修改即时生效
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

/* ---------------- LLM 流式代理 ---------------- */

async function proxyChat(res, body) {
  const mode = String(body.mode || 'free');
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages = raw
    .filter(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim()
    )
    .slice(-80)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 30000) }));

  if (!messages.length) {
    return sendJson(res, 400, { error: 'messages 不能为空' });
  }

  let system;
  switch (mode) {
    case 'mock': {
      const cfg = body.mockConfig || {};
      system = buildMockSystemPrompt(cfg);
      if (body.forceReport) system += '\n\n' + REPORT_INSTRUCTION;
      break;
    }
    case 'resume':
      system = buildResumeV2SystemPrompt();
      break;
    case 'polish':
      system = buildPolishSystemPrompt();
      break;
    case 'agent': {
      // 自定义工具说明（客户端传入、客户端执行，服务端只负责告知模型）
      const extras = Array.isArray(body.customTools)
        ? body.customTools
            .filter((t) => t && typeof t.name === 'string' && /^[a-z_][a-z0-9_]{1,20}$/i.test(t.name))
            .slice(0, 8)
        : [];
      const personaText = typeof body.personaText === 'string' ? body.personaText.trim() : '';
      if (personaText) {
        // 自定义专家人设：人设文本 + 完整工具说明
        system = personaText.slice(0, 2000) + '\n\n' + AGENT_TOOL_SPEC +
          (extras.length ? '\n\n' + customToolLines(extras) : '');
      } else {
        system = buildAgentSystemPrompt(body.persona || 'mentor', extras);
      }
      break;
    }
    case 'brief':
      system = buildBriefSystemPrompt();
      break;
    case 'parse-resume':
      system = buildParseResumePrompt();
      break;
    case 'profile':
      system = buildProfilePrompt();
      break;
    case 'jd':
      system = buildJdSystemPrompt();
      break;
    case 'cards':
      system = buildCardsSystemPrompt();
      break;
    case 'deepdive':
      system = buildDeepdiveSystemPrompt(
        String(body.question || ''),
        String(body.answer || '')
      );
      break;
    default:
      system = FREE_SYSTEM;
  }

  const apiKey = (body.apiKey && String(body.apiKey).trim()) || DEFAULTS.apiKey;
  const baseURL = (body.baseURL && String(body.baseURL).trim()) || DEFAULTS.baseURL;
  const model = (body.model && String(body.model).trim()) || DEFAULTS.model;

  if (!apiKey) {
    return sendJson(res, 400, {
      error:
        '未配置 API Key：请在页面「设置」中填写，或在服务端 .env 中配置 INTERVIEW_MATE_API_KEY',
    });
  }

  const endpoint = baseURL.replace(/\/+$/, '') + '/chat/completions';
  const fallbackTemp = mode === 'resume' || mode === 'deepdive' ? 0.4 : 0.7;
  const temperature =
    typeof body.temperature === 'number' && body.temperature >= 0 && body.temperature <= 2
      ? body.temperature
      : fallbackTemp;

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        stream_options: { include_usage: true },
        temperature,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
  } catch (e) {
    return sendJson(res, 502, {
      error: `无法连接模型服务（${endpoint}）：${e.message}`,
    });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    let detail = text.slice(0, 500);
    try {
      const j = JSON.parse(text);
      detail = (j.error && j.error.message) || j.message || detail;
    } catch (_) {
      /* 保留原始片段 */
    }
    return sendJson(res, 502, { error: `模型服务返回 ${upstream.status}：${detail}` });
  }

  // 以 SSE 原文透传，由前端解析 delta
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  const nodeStream = Readable.fromWeb(upstream.body);
  nodeStream.on('error', () => res.end());
  nodeStream.pipe(res);
}

/* ---------------- API 路由 ---------------- */

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      serverKeyConfigured: Boolean(DEFAULTS.apiKey),
      baseURL: DEFAULTS.baseURL,
      model: DEFAULTS.model,
      node: process.version,
    });
  }

  if (req.method === 'GET' && pathname === '/api/questions') {
    try {
      const data = await fs.promises.readFile(QUESTIONS_FILE, 'utf8');
      return sendJson(res, 200, JSON.parse(data));
    } catch (e) {
      return sendJson(res, 500, { error: '题库加载失败：' + e.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    try {
      const body = JSON.parse(await readBody(req));
      return await proxyChat(res, body);
    } catch (e) {
      return sendJson(res, 400, { error: '请求解析失败：' + e.message });
    }
  }

  /* ---- 岗位雷达 ---- */
  if (pathname.startsWith('/api/jobs')) {
    try {
      if (req.method === 'GET' && pathname === '/api/jobs') {
        const url = new URL(req.url, 'http://x');
        return sendJson(res, 200, jobs.getJobs({
          limit: Math.min(Number(url.searchParams.get('limit')) || 100, 300),
          onlyNew: url.searchParams.get('new') === '1',
        }));
      }
      if (req.method === 'GET' && pathname === '/api/jobs/subs') {
        return sendJson(res, 200, jobs.getSubs());
      }
      if (req.method === 'POST' && pathname === '/api/jobs/refresh') {
        const result = await jobs.refreshAll();
        return sendJson(res, 200, result);
      }
      if (req.method === 'POST' && pathname === '/api/jobs/subs') {
        const body = JSON.parse(await readBody(req));
        const sub = jobs.addSub(body);
        return sendJson(res, 200, { ok: true, sub });
      }
      if (req.method === 'POST' && pathname === '/api/jobs/subs/delete') {
        const body = JSON.parse(await readBody(req));
        jobs.removeSub(body.id);
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/jobs/subs/toggle') {
        const body = JSON.parse(await readBody(req));
        const sub = jobs.toggleSub(body.id);
        return sendJson(res, 200, { ok: true, sub });
      }
      if (req.method === 'POST' && pathname === '/api/jobs/manual') {
        const body = JSON.parse(await readBody(req));
        return sendJson(res, 200, jobs.addManualJob(body));
      }
      if (req.method === 'POST' && pathname === '/api/jobs/seen') {
        const body = JSON.parse(await readBody(req));
        return sendJson(res, 200, { ok: true, marked: jobs.markSeen(body.keys) });
      }
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
    return sendJson(res, 404, { error: 'Not Found' });
  }

  /* ---- 技能市场：HTTP 工具代理（绕开浏览器 CORS，服务端代抓） ---- */
  if (req.method === 'POST' && pathname === '/api/tools/http') {
    try {
      const body = JSON.parse(await readBody(req));
      let target;
      try { target = new URL(body.url); } catch (_) { return sendJson(res, 400, { error: 'URL 无效' }); }
      if (!/^https?:$/.test(target.protocol)) return sendJson(res, 400, { error: '仅支持 http(s)' });
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      try {
        const r = await fetch(target, {
          signal: ctrl.signal,
          headers: { 'User-Agent': 'InterviewMate-skill/0.8 (local personal tool)' },
        });
        clearTimeout(t);
        const text = (await r.text()).slice(0, 3000);
        return sendJson(res, 200, { status: r.status, text });
      } catch (e) {
        clearTimeout(t);
        return sendJson(res, 502, { error: e.name === 'AbortError' ? '请求超时（12s）' : e.message });
      }
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  /* ---- 简历原文件：上传与展示 ---- */
  const FILES_DIR = path.join(ROOT, 'data', 'files');
  if (req.method === 'POST' && pathname === '/api/files/upload') {
    try {
      let name = 'file';
      try { name = decodeURIComponent(req.headers['x-file-name'] || 'file'); } catch (_) { /* ignore */ }
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (!['pdf', 'docx', 'txt', 'md', 'webm', 'mp3', 'm4a', 'ogg'].includes(ext)) {
        return sendJson(res, 400, { error: '不支持的文件类型' });
      }
      const buf = await readBodyRaw(req);
      if (!buf.length) return sendJson(res, 400, { error: '空文件' });
      fs.mkdirSync(FILES_DIR, { recursive: true });
      const id = 'f-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const saved = `${id}.${ext}`;
      fs.writeFileSync(path.join(FILES_DIR, saved), buf);
      return sendJson(res, 200, { ok: true, url: '/api/files/' + saved, name, size: buf.length });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  if (req.method === 'GET' && pathname.startsWith('/api/files/')) {
    const rel = pathname.replace('/api/files/', '');
    if (!/^[\w.-]+$/.test(rel)) { res.writeHead(400); res.end('Bad file name'); return; }
    const fp = path.join(FILES_DIR, rel);
    if (!fp.startsWith(FILES_DIR) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
      res.writeHead(404); res.end('Not Found'); return;
    }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=86400',
    });
    fs.createReadStream(fp).pipe(res);
    return;
  }

  /* ---- 智能体简报 ---- */
  if (pathname.startsWith('/api/agent')) {
    try {
      if (req.method === 'POST' && pathname === '/api/agent/snapshot') {
        const body = JSON.parse(await readBody(req));
        briefs.setSnapshot(body.stats || '');
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'GET' && pathname === '/api/agent/briefs') {
        return sendJson(res, 200, briefs.getBriefs());
      }
      if (req.method === 'POST' && pathname === '/api/agent/briefs/refresh') {
        if (!DEFAULTS.apiKey) return sendJson(res, 400, { error: '服务端未配置 API Key（.env）' });
        return sendJson(res, 200, await briefs.generateToday(callLLM));
      }
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
    return sendJson(res, 404, { error: 'Not Found' });
  }

  return sendJson(res, 404, { error: 'Not Found' });
}

/* ---------------- LLM 非流式调用（服务端定时简报用，返回用量） ---------------- */
async function callLLM(system, user) {
  if (!DEFAULTS.apiKey) throw new Error('服务端未配置 API Key');
  const endpoint = DEFAULTS.baseURL.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEFAULTS.apiKey}` },
    body: JSON.stringify({
      model: DEFAULTS.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const j = await res.json();
  const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  const usage = j.usage || {};
  return { text, usage: { p: usage.prompt_tokens || 0, c: usage.completion_tokens || 0 } };
}

/* ---------------- 启动 ---------------- */

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (_) {
    pathname = '/';
  }
  if (pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, pathname);
    } catch (e) {
      sendJson(res, 500, { error: '服务器内部错误：' + e.message });
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }
  serveStatic(res, pathname);
});

server.listen(PORT, HOST, () => {
  jobs.load();
  briefs.load();
  const refreshMin = Number(process.env.INTERVIEW_MATE_JOB_REFRESH_MIN ?? 30);
  jobs.startScheduler(refreshMin);
  const briefMin = Number(process.env.INTERVIEW_MATE_BRIEF_CHECK_MIN ?? 720);
  briefs.startScheduler(briefMin, callLLM, () => Boolean(DEFAULTS.apiKey));
  console.log('');
  console.log('  🎯 InterviewMate · AI 面试陪练 v0.6.0');
  console.log(`  已启动: http://${HOST}:${PORT}`);
  console.log(`  服务端 Key: ${DEFAULTS.apiKey ? '已配置（.env）' : '未配置（可在页面设置中填写）'}`);
  console.log(`  岗位雷达: 自动抓取${refreshMin > 0 ? `每 ${refreshMin} 分钟` : '已关闭'}`);
  console.log(`  每日简报: ${DEFAULTS.apiKey ? `调度器每 ${briefMin} 分钟检查` : '等待服务端 Key（页面 Key 也可现场生成）'}`);
  console.log('');
});
