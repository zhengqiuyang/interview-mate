/* 演示模式（?demo=1）：只替换 API 适配层，前端与各视图一行不改。
 *
 * 原理：把 window.fetch 对同源 /api/* 的请求转给本地 mock，返回真正的 Response
 * （/api/chat 返回 SSE 流，api.js 的 reader 照常解析），所以：
 *   - 没有服务端、没有 API Key 也能点开看板 / 题库 / 模拟面试；
 *   - 部署到纯静态托管时行为一致（题库随前端走，见 scripts/build-demo.mjs）。
 * 数据只存在浏览器 localStorage，不联网、不写服务端。
 */

const BANNER_ID = 'im-demo-banner';
const DEMO_MODEL = 'interview-mate-demo';

export function isDemoMode() {
  if (typeof location === 'undefined') return false;
  const v = new URLSearchParams(location.search).get('demo');
  if (v === '0' || v === 'false') return false;
  if (v === '1' || v === 'true') return true;
  return typeof location.hostname === 'string' && /\.github\.io$/i.test(location.hostname);
}

/* ---------------- 演示数据（岗位雷达 / 订阅源） ---------------- */

const demoState = {
  lastRun: null,
  jobs: [
    {
      key: 'demo-1', title: '高级后端工程师（Java）', company: '示例科技', location: '上海 · 远程友好',
      salary: '35-55K · 16 薪', url: 'https://example.com/jobs/1', body: '负责订单与支付链路的高并发改造，要求熟悉 JVM 调优、消息队列与分布式事务。',
      sourceName: '演示数据', keywords: ['Java', '高并发'], seen: false,
      publishedAt: Date.now() - 2 * 3600 * 1000,
    },
    {
      key: 'demo-2', title: 'Node.js 全栈工程师', company: '云雀网络', location: '杭州',
      salary: '30-45K', url: 'https://example.com/jobs/2', body: '负责 B 端 SaaS 前后端，TypeScript + Node.js + PostgreSQL，参与架构演进。',
      sourceName: '演示数据', keywords: ['Node.js', 'TypeScript'], seen: false,
      publishedAt: Date.now() - 26 * 3600 * 1000,
    },
    {
      key: 'demo-3', title: '前端工程师（React）', company: '远山数据', location: '北京',
      salary: '25-40K', url: 'https://example.com/jobs/3', body: '数据可视化产品，React + Canvas，关注性能与大屏渲染。',
      sourceName: '演示数据', keywords: ['React'], seen: true,
      publishedAt: Date.now() - 3 * 24 * 3600 * 1000,
    },
    {
      key: 'demo-4', title: 'AI 应用工程师', company: '星尘智能', location: '深圳 · 弹性',
      salary: '40-60K · 期权', url: 'https://example.com/jobs/4', body: 'LLM 应用落地（RAG / Agent），要求有工程化与评测经验。',
      sourceName: '演示数据', keywords: ['LLM', 'RAG'], seen: false,
      publishedAt: Date.now() - 5 * 3600 * 1000,
    },
  ],
  subs: [
    {
      id: 'sub-demo-1', type: 'remoteok', name: 'RemoteOK（演示）', keywords: [], excludes: [],
      enabled: true, lastFetch: Date.now() - 10 * 60 * 1000, lastError: null, lastAdded: 2,
    },
  ],
};

/* ---------------- 演示回答（按 mode 分派） ---------------- */

const MOCK_REPORT = [
  '# 面试评估报告',
  '',
  '**总体评分：78/100**',
  '',
  '## 分项评分',
  '- 技术深度：7/10',
  '- 项目经验：8/10',
  '- 表达结构：7/10',
  '- 匹配度：8/10',
  '',
  '## 亮点',
  '- 能主动讲清技术选型的取舍，举了订单超时补偿的真实例子；',
  '- 对幂等与消息去重的理解到位。',
  '',
  '## 待改进',
  '- 回答偏长，先给结论再展开会更有说服力；',
  '- 被追问「为什么不用 X」时缺少量化对比。',
  '',
  '> 这是演示模式的示例报告，真实报告由你配置的模型生成。',
].join('\n');

const ANSWERS = {
  free: '连接成功',
  deepdive: '追问：你在这个场景里为什么选择乐观锁而不是悲观锁？如果冲突率很高，你的退化方案是什么？',
  agent: [
    '## 训练建议',
    '',
    '根据你最近的 3 场模拟面试，最该补的是**系统设计中的容量估算**：',
    '',
    '- 先练「估算 → 选型 → 取舍」三段式表达；',
    '- 每道题控制在 90 秒内给出结论；',
    '- 可去题库「系统设计」分类刷 5 题，再回来看复盘。',
    '',
    '> 演示模式：以上内容为示例，真实回答由你配置的模型生成。',
  ].join('\n'),
  brief: [
    '**待复习 6 张卡**，其中 2 张已连续两次「模糊」，建议先过这两张。',
    '',
    '- 昨天完成 1 场模拟面试（技术面），总分 **78**；',
    '- 岗位雷达新增 **3 个匹配岗位**，其中 1 个与你简历匹配度 **72%**；',
    '- 建议今天花 20 分钟补「分布式一致性」追问。',
  ].join('\n'),
  jd: [
    '# 岗位情报速览',
    '这是一个偏后端的资深工程师岗位，核心方向是高并发交易链路。',
    '',
    '## 硬性要求',
    '- 5 年以上 Java 后端经验，熟悉 JVM 调优；',
    '- 有消息队列与分布式事务的落地经验。',
    '',
    '## 加分项',
    '- 有支付/订单域经验；',
    '- 参与过容量规划与稳定性建设。',
    '',
    '## 面试重点预测',
    '1. 订单超时与补偿方案；',
    '2. 消息幂等与去重；',
    '3. 分布式事务选型取舍；',
    '4. JVM 调优定位流程。',
    '',
    '## 备考建议',
    '- 准备一个可量化的压测/优化案例；',
    '- 复习 CAP 与一致性模型的实际取舍。',
    '',
    '> 演示模式：分析为示例内容。',
  ].join('\n'),
  cards: JSON.stringify({
    summary: '材料核心是高并发下的幂等与一致性设计：先定去重键，再做补偿与对账。',
    cards: [
      { q: '消息重复投递时用什么做去重键？', a: '- 业务唯一键 + 操作类型\n- 落库唯一索引兜底', tags: ['消息队列'] },
      { q: '订单超时补偿有哪几种做法？', a: '- 延迟消息\n- 定时对账\n- 状态机 + 重试', tags: ['订单'] },
      { q: '为什么对账是最后一道防线？', a: '- 覆盖所有漏网异常\n- 以账为准，可人工介入', tags: ['一致性'] },
    ],
  }),
  resume: JSON.stringify({
    score: 76,
    verdict: '后端基本功扎实，量化结果偏少，与 JD 的匹配度中等偏上。',
    radar: [
      { dim: '技术深度', score: 8 },
      { dim: '工程经验', score: 7 },
      { dim: '业务理解', score: 6 },
      { dim: '匹配度', score: 7 },
    ],
    coverage: [
      { req: '5 年以上 Java 后端', status: 'covered', evidence: '工作经历显示 6 年 Java 服务端开发' },
      { req: '高并发交易链路', status: 'partial', evidence: '提到订单系统，但未写 QPS / 峰值' },
      { req: '消息队列落地', status: 'covered', evidence: '项目中使用 RabbitMQ 做异步解耦' },
    ],
    followups: [
      { q: '订单超时如何补偿？', priority: 'high' },
      { q: '消息重复投递怎么去重？', priority: 'high' },
      { q: '你们的 QPS 峰值与瓶颈在哪？', priority: 'mid' },
    ],
    risks: [
      { issue: '缺少量化数据', fix: '给每条经历补结果指标', example: '把「优化了下单接口」改写为「下单接口 P99 从 800ms 降到 120ms」' },
    ],
    keywords: ['Java', '高并发', '消息队列', '分布式事务', 'JVM 调优', '订单系统', '补偿', '对账'],
  }),
  'parse-resume': JSON.stringify({
    name: '示例候选人',
    headline: '后端工程师 · 6 年经验',
    contacts: ['demo@example.com'],
    skills: ['Java', 'Spring Boot', 'MySQL', 'RabbitMQ', 'Redis'],
    sections: [
      { heading: '工作经历', lines: ['2020 - 至今 示例科技 · 后端工程师', '负责订单链路重构，引入消息队列异步解耦'] },
      { heading: '教育背景', lines: ['2014 - 2018 示例大学 · 计算机科学与技术 · 本科'] },
    ],
  }),
  profile: JSON.stringify({
    cards: [
      { type: '项目', content: '订单项目用 RabbitMQ 异步解耦，可继续深挖一致性与幂等追问' },
      { type: '薄弱', content: '容量估算缺少量化，回答时先给结论再展开' },
    ],
  }),
  polish: JSON.stringify({
    improved: '- **下单链路重构**：引入 RabbitMQ 异步解耦，下单 P99 从 800ms 降至 120ms，峰值支撑 X QPS',
    notes: ['改为动词开头', '补量化占位', '技术栈具体化'],
  }),
  'code-review': [
    '## 1. 正确性与边界条件',
    '- 核心逻辑已覆盖主路径与常规边界；建议再显式检查 `capacity <= 0`、空集合或大整数加法溢出。',
    '',
    '## 2. 时间与空间复杂度',
    '- 平均时间复杂度达到最优量级，附加空间仅与核心辅助结构呈线性/常数关系。',
    '',
    '## 3. 工程细节与面试追问',
    '- 若需在并发读写场景下使用，你会如何加细粒度锁（分段锁 / 读写锁）或无锁化改造？',
    '',
    '> 演示模式：以上为示例评审，完整本地运行配置 API Key 后会基于你的真实代码与报错动态分析。',
  ].join('\n'),
};

function answerFor(mode, body) {
  if (mode === 'mock' && body && body.forceReport) return MOCK_REPORT;
  if (mode === 'mock') {
    const msgs = (body && body.messages) || [];
    const asked = msgs.filter((m) => m.role === 'user').length - 1;
    const hasResume = Boolean(body && body.mockConfig && body.mockConfig.resumeSummary);
    return pickMockLine(asked, hasResume);
  }
  return ANSWERS[mode] || '这是演示模式的示例回答。真实内容由你配置的模型生成。';
}

function pickMockLine(n, hasResume = false) {
  const first = hasResume
    ? '看到你简历里提到了高并发订单链路重构和慢查询优化——在这套方案里引入消息队列做异步解耦后，如果下游消费失败，你怎么保证最终一致？举一个你亲手处理过的例子。'
    : '好的。你提到用消息队列做异步解耦——如果下游消费失败，你怎么保证最终一致？举一个你亲手处理过的例子。';
  const lines = [
    first,
    '不错。那同一条消息被重复投递时，你的去重键怎么设计？为什么选这个键而不是业务主键？',
    '换个角度：这套方案峰值 QPS 大概多少，瓶颈先出现在哪一层？你怎么定位的？',
    '最后一个问题：如果让你重做一次，你会改哪一处设计？为什么？',
  ];
  return lines[Math.min(Math.max(n, 0), lines.length - 1)];
}

/* ---------------- 响应构造 ---------------- */

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** 把整段文本切成 SSE 分片，模拟真实流式输出（可被 AbortSignal 中断） */
function sseResponse(text, signal) {
  const enc = new TextEncoder();
  const step = 6;
  const stream = new ReadableStream({
    async start(controller) {
      const push = (payload) => controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`));
      try {
        for (let i = 0; i < text.length; i += step) {
          if (signal && signal.aborted) { controller.close(); return; }
          push({ choices: [{ delta: { content: text.slice(i, i + step) } }] });
          // 演示打字机：约 12ms/6 字，和真实 SSE 的节奏接近
          await new Promise((r) => setTimeout(r, 12));
        }
        controller.enqueue(enc.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (_) {
        try { controller.close(); } catch (_) { /* 已关闭 */ }
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function handleApi(pathname, init, rawUrl) {
  const method = (init && init.method) || 'GET';
  const body = init && init.body ? safeJson(init.body) : null;
  const signal = init && init.signal;

  if (pathname === '/api/health') {
    return jsonResponse({
      ok: true, version: 'demo', demo: true,
      serverKeyConfigured: true, baseURL: 'demo', model: DEMO_MODEL, node: undefined,
    });
  }

  if (pathname === '/api/questions') {
    const { default: bank } = await import('./demo-bank.js');
    return jsonResponse(bank);
  }

  if (pathname === '/api/chat') {
    return sseResponse(answerFor(body && body.mode, body), signal);
  }

  /* 岗位雷达：内存态，刷新页面即复原 */
  if (pathname === '/api/jobs' && method === 'GET') {
    const onlyNew = /[?&]new=1/.test(String(rawUrl));
    const list = onlyNew ? demoState.jobs.filter((j) => !j.seen) : demoState.jobs;
    return jsonResponse({
      jobs: list, total: demoState.jobs.length,
      newCount: demoState.jobs.filter((j) => !j.seen).length,
      lastRun: demoState.lastRun, running: false,
    });
  }
  if (pathname === '/api/jobs/subs' && method === 'GET') {
    return jsonResponse({ subs: demoState.subs, lastRun: demoState.lastRun });
  }
  if (pathname === '/api/jobs/subs' && method === 'POST') {
    const sub = {
      id: 'sub-demo-' + Date.now(), type: (body && body.type) || 'json',
      name: (body && body.name) || '演示订阅', keywords: (body && body.keywords) || [],
      excludes: [], enabled: true, lastFetch: null, lastError: null, lastAdded: 0,
    };
    demoState.subs.push(sub);
    return jsonResponse({ ok: true, sub });
  }
  if (pathname === '/api/jobs/subs/toggle' || pathname === '/api/jobs/subs/delete') {
    const id = body && body.id;
    const idx = demoState.subs.findIndex((s) => s.id === id);
    if (idx >= 0) {
      if (pathname.endsWith('/toggle')) demoState.subs[idx].enabled = !demoState.subs[idx].enabled;
      else demoState.subs.splice(idx, 1);
    }
    return jsonResponse({ ok: true, sub: idx >= 0 ? demoState.subs[idx] : null });
  }
  if (pathname === '/api/jobs/manual') {
    const job = {
      key: 'demo-manual-' + Date.now(), title: (body && body.title) || '手动添加的岗位',
      company: (body && body.company) || '', location: (body && body.location) || '',
      salary: (body && body.salary) || '', url: (body && body.url) || '',
      body: (body && (body.body || body.description)) || '', sourceName: '手动添加',
      keywords: [], seen: false, publishedAt: Date.now(),
    };
    demoState.jobs.unshift(job);
    return jsonResponse({ ok: true, job });
  }
  if (pathname === '/api/jobs/seen') {
    const keys = (body && body.keys) || [];
    let marked = 0;
    for (const j of demoState.jobs) {
      if (keys.includes(j.key) && !j.seen) { j.seen = true; marked++; }
    }
    return jsonResponse({ ok: true, marked });
  }
  if (pathname === '/api/jobs/refresh') {
    demoState.lastRun = Date.now();
    return jsonResponse({ ok: true, running: false, added: 0, lastRun: demoState.lastRun });
  }

  /* 每日简报 / 用量：演示模式没有服务端定时器 */
  if (pathname === '/api/agent/briefs' && method === 'GET') {
    return jsonResponse({ briefs: [], serverTokens: { n: 0, p: 0, c: 0 } });
  }
  if (pathname === '/api/agent/briefs/refresh' || pathname === '/api/agent/snapshot') {
    return jsonResponse({ ok: true, briefs: [] });
  }

  /* 技能市场外部 HTTP 工具：演示模式不真的发请求 */
  if (pathname === '/api/tools/http') {
    return jsonResponse({ status: 200, text: '（演示模式：这里不会真的发起外部请求）' });
  }

  if (pathname === '/api/bank/fetch-md') {
    return jsonResponse({ error: '演示模式不支持远程拉取外部链接，可直接粘贴 Markdown 正文或上传本地 .md 文件导入' }, 400);
  }

  if (pathname === '/api/code/runtimes' && method === 'GET') {
    return jsonResponse({
      javascript: { ok: true, mode: 'browser' },
      python: { ok: false },
      cpp: { ok: false },
      localExecAllowed: false,
      demo: true,
    });
  }
  if (pathname === '/api/code/run') {
    return jsonResponse({
      error: '在线演示模式无本地编译后端：JavaScript 可直接使用浏览器 Web Worker 沙箱运行；Python / C++ 请本地运行 node server.js 解锁真机编译运行。',
    }, 400);
  }
  if (pathname === '/api/sync/state' && method === 'GET') {
    return jsonResponse({ exists: false, updatedAt: 0, data: {}, demo: true });
  }
  if (pathname === '/api/sync/state' && method === 'PUT') {
    return jsonResponse({ ok: true, demo: true, updatedAt: Date.now() });
  }

  if (pathname === '/api/files/upload') {
    return jsonResponse({ error: '演示模式不支持上传文件，请本地运行 node server.js 体验完整功能' }, 400);
  }

  return jsonResponse({ error: '演示模式未知接口：' + pathname }, 404);
}

function safeJson(raw) {
  try { return JSON.parse(raw); } catch (_) { return null; }
}

/** 安装 fetch 适配层；非演示模式直接返回 false。 */
export function installDemoFetch() {
  if (!isDemoMode() || typeof window === 'undefined' || window.__imDemoInstalled) return false;
  window.__imDemoInstalled = true;

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    let pathname = '';
    try { pathname = new URL(raw, location.href).pathname; } catch (_) { pathname = raw; }
    if (pathname.startsWith('/api/')) {
      return handleApi(pathname, init || {}, raw);
    }
    return realFetch(input, init);
  };

  showBanner();
  return true;
}

function dayKeyOffset(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 在空存储的演示模式中注入拟真的 7 天备考样例档案，避免首屏全 0。 */
export function seedDemoData(stateObj = null) {
  if (typeof localStorage === 'undefined') return false;
  if (
    localStorage.getItem('im_demo_seeded')
    || localStorage.getItem('im_srs')
    || localStorage.getItem('im_sessions')
  ) {
    return false;
  }
  const now = Date.now();
  const DAY = 86400000;

  const srs = {};
  const masteredIds = [
    'net-1', 'net-2', 'net-4', 'net-5', 'net-6', 'net-9',
    'os-1', 'os-2', 'os-4',
    'db-1', 'db-2', 'db-3', 'db-4', 'db-7', 'db-11',
    'algo-1', 'algo-2', 'algo-3', 'algo-4', 'algo-15', 'algo-16', 'algo-20', 'algo-23', 'algo-25',
    'code-1', 'code-2', 'code-4', 'code-13', 'code-17', 'code-21',
    'fe-1', 'fe-2', 'fe-5',
    'be-1', 'be-2', 'be-3',
    'java-1', 'java-3', 'java-8',
    'sys-1', 'sys-2',
    'go-1', 'go-2',
    'cpp-1', 'cpp-2', 'cpp-3', 'cpp-5', 'cpp-9', 'cpp-14', 'cpp-16', 'cpp-22',
    'ai-1', 'ai-2', 'ai-3', 'ai-11', 'ai-12', 'ai-18', 'ai-19', 'ai-26', 'ai-34',
    'beh-1', 'beh-2',
    'proj-1', 'proj-2',
  ];
  masteredIds.forEach((id, i) => {
    srs[id] = {
      box: i % 3 === 0 ? 4 : 3,
      due: now + (6 + (i % 9)) * DAY,
      reps: i % 3 === 0 ? 4 : 3,
      lapses: 0,
      last: now - (i % 5 + 1) * DAY,
    };
  });
  // 到期与错题
  srs['net-3'] = { box: 0, due: now - 3600000, reps: 3, lapses: 2, last: now - DAY };
  srs['db-5'] = { box: 0, due: now - 7200000, reps: 4, lapses: 2, last: now - DAY };
  srs['os-3'] = { box: 1, due: now - 1800000, reps: 2, lapses: 1, last: now - 2 * DAY };
  srs['be-4'] = { box: 1, due: now - 5400000, reps: 1, lapses: 0, last: now - 2 * DAY };
  srs['java-2'] = { box: 2, due: now - 900000, reps: 2, lapses: 0, last: now - 3 * DAY };
  srs['sys-3'] = { box: 1, due: now - 600000, reps: 1, lapses: 0, last: now - DAY };
  srs['cpp-28'] = { box: 1, due: now - 1200000, reps: 1, lapses: 0, last: now - DAY };
  // 未来 1-5 天待复习分布
  srs['net-7'] = { box: 1, due: now + DAY, reps: 1, lapses: 0, last: now };
  srs['os-5'] = { box: 2, due: now + DAY, reps: 2, lapses: 0, last: now - DAY };
  srs['db-6'] = { box: 2, due: now + 2 * DAY, reps: 2, lapses: 0, last: now - DAY };
  srs['ai-29'] = { box: 2, due: now + 2 * DAY, reps: 2, lapses: 0, last: now - DAY };
  srs['algo-5'] = { box: 2, due: now + 3 * DAY, reps: 2, lapses: 0, last: now - DAY };
  srs['fe-3'] = { box: 2, due: now + 4 * DAY, reps: 2, lapses: 0, last: now - 2 * DAY };
  srs['java-4'] = { box: 3, due: now + 5 * DAY, reps: 3, lapses: 0, last: now - 2 * DAY };

  const activity = {
    [dayKeyOffset(-17)]: 2,
    [dayKeyOffset(-16)]: 4,
    [dayKeyOffset(-14)]: 3,
    [dayKeyOffset(-13)]: 6,
    [dayKeyOffset(-11)]: 5,
    [dayKeyOffset(-10)]: 2,
    [dayKeyOffset(-8)]: 7,
    [dayKeyOffset(-5)]: 3,
    [dayKeyOffset(-4)]: 6,
    [dayKeyOffset(-3)]: 4,
    [dayKeyOffset(-2)]: 8,
    [dayKeyOffset(-1)]: 11,
    [dayKeyOffset(0)]: 5,
  };

  const sessions = [
    {
      id: 'mock-demo-3',
      kind: 'mock',
      date: now - DAY,
      title: '后端（Java） · 项目深挖面',
      score: 84,
      elapsed: 940,
      reportMd: '# 面试评估报告\n\n**总体评分：84/100**\n\n## 分项评分\n- 技术深度：8.5/10\n- 项目经验：9/10\n- 表达与结构：8/10\n- 岗位匹配度：8.5/10\n\n## 亮点\n- 能用 P99 从 800ms 降至 120ms 的真实指标支撑改造效果；\n- Redis + Lua 预扣库存与对账兜底方案思路清晰。',
      messages: [],
    },
    {
      id: 'mock-demo-2',
      kind: 'mock',
      date: now - 4 * DAY,
      title: '后端（Java） · 综合模拟',
      score: 76,
      elapsed: 820,
      reportMd: '# 面试评估报告\n\n**总体评分：76/100**\n\n## 分项评分\n- 技术深度：7.5/10\n- 项目经验：8/10\n- 表达与结构：7/10\n- 岗位匹配度：8/10',
      messages: [],
    },
    {
      id: 'mock-demo-1',
      kind: 'mock',
      date: now - 8 * DAY,
      title: '通用软件工程师 · 技术基础面',
      score: 68,
      elapsed: 760,
      reportMd: '# 面试评估报告\n\n**总体评分：68/100**\n\n## 分项评分\n- 技术深度：7/10\n- 表达与结构：6.5/10\n- 问题理解：7/10\n- 岗位匹配度：7/10',
      messages: [],
    },
  ];

  const resumes = [
    {
      id: 'rs-demo-1',
      name: '张三 · 高级后端开发简历',
      source: 'sample',
      parsed: null,
      updated: now - 2 * DAY,
      content: [
        '张三 | 后端开发工程师 · 4 年经验',
        '138-0000-0000 | demo@example.com | github.com/demo',
        '',
        '工作经历',
        'XX 科技有限公司 · 后端开发工程师（2022.07 - 至今）',
        '- 负责订单与交易核心链路微服务研发，日常峰值 3500 QPS',
        '- 主导 MySQL 慢查询治理与复合索引重构，核心接口 P99 从 800ms 降至 120ms',
        '- 引入 RabbitMQ 异步削峰与幂等去重表，大促期间支付超时补偿零漏单',
        '',
        '项目经历',
        '高并发秒杀库存扣减重构（技术负责人）',
        '- 设计 Redis + Lua 原子预扣库存 + 异步落库与定时对账兜底，超卖率为 0',
        '',
        '专业技能',
        'Java / Spring Boot / Go / MySQL / Redis / RabbitMQ / Kafka / Docker',
      ].join('\n'),
    },
  ];

  const apps = [
    {
      id: 'app-demo-1', company: '云雀科技', position: '高级后端工程师（交易链路）',
      channel: '内推', salary: '38-55K·16薪', date: now - 6 * DAY,
      interviewDate: dayKeyOffset(3), resumeId: 'rs-demo-1', jdUrl: '',
      note: '一面重点追问订单幂等与补偿对账，二面在三天后', status: 'interview2',
      history: [
        { status: 'applied', date: now - 6 * DAY, note: '' },
        { status: 'interview1', date: now - 3 * DAY, note: '通过' },
        { status: 'interview2', date: now - DAY, note: '约二面' },
      ],
    },
    {
      id: 'app-demo-2', company: '星尘智能', position: 'AI 应用工程师（Agent / RAG）',
      channel: 'Boss直聘', salary: '40-60K', date: now - 4 * DAY,
      interviewDate: '', resumeId: 'rs-demo-1', jdUrl: '',
      note: '已约技术一面，重点准备 RAG 检索与 Tool Calling', status: 'interview1',
      history: [
        { status: 'applied', date: now - 4 * DAY, note: '' },
        { status: 'interview1', date: now - 2 * DAY, note: '' },
      ],
    },
    {
      id: 'app-demo-3', company: '远山数据', position: '后端开发工程师（Go/Java）',
      channel: '官网', salary: '30-45K', date: now - 2 * DAY,
      interviewDate: '', resumeId: 'rs-demo-1', jdUrl: '',
      note: '官网投递等待筛选', status: 'applied',
      history: [{ status: 'applied', date: now - 2 * DAY, note: '' }],
    },
    {
      id: 'app-demo-4', company: '极光云', position: '基础架构研发工程师',
      channel: '内推', salary: '42-58K', date: now - 14 * DAY,
      interviewDate: '', resumeId: 'rs-demo-1', jdUrl: '',
      note: '三面通过已拿口头 Offer', status: 'offer',
      history: [
        { status: 'applied', date: now - 14 * DAY, note: '' },
        { status: 'offer', date: now - 2 * DAY, note: '意向' },
      ],
    },
  ];

  const knowledge = [
    {
      id: 'kn-demo-1',
      title: 'MySQL 慢查询与索引失效排查清单',
      tags: ['MySQL', '索引', '性能调优'],
      updated: now - DAY,
      content: '## 排查三步走\n- 开启慢日志定位 `rows_examined` 异常 SQL\n- 用 `EXPLAIN` 看 `type`（至少 `range`）、`key` 与 `Extra`（避免 `Using filesort`）\n\n```sql\nEXPLAIN SELECT order_id, status FROM orders\nWHERE user_id = 1024 AND created_at >= \'2026-11-01\'\nORDER BY created_at DESC LIMIT 20;\n```',
    },
    {
      id: 'kn-demo-2',
      title: 'Redis 分布式锁防踩坑笔记',
      tags: ['Redis', '分布式', '高并发'],
      updated: now - 3 * DAY,
      content: '- 加锁必须原子 `SET key token NX PX 30000`\n- 解锁必须用 Lua 脚本校验 `token` 再删除，避免误删他人锁\n- 长任务引入 Watchdog 自动续期，关键写库加版本号/ fencing token',
    },
  ];

  const profile = {
    cards: [
      { id: 'pc-d1', type: '项目', content: '订单中心微服务改造：核心接口 P99 从 800ms 降至 120ms，Redis+Lua 预扣库存', source: '简历诊断', date: now - 2 * DAY },
      { id: 'pc-d2', type: '薄弱', content: '系统设计容量估算缺乏具体 QPS / 带宽与存储推演过程', source: '模拟面试', date: now - 4 * DAY },
      { id: 'pc-d3', type: '失分', content: '被追问乐观锁退化方案时缺少高冲突率下改悲观锁/分段的定量对比', source: '模拟面试', date: now - 4 * DAY },
      { id: 'pc-d4', type: '亮点', content: '消息幂等去重键设计与定时对账兜底方案实战经验扎实', source: '模拟面试', date: now - DAY },
    ],
  };

  const gamify = {
    xp: 360,
    unlocked: ['first_mock', 'score_80', 'streak_3', 'mastered_10'],
  };
  const targetDate = dayKeyOffset(14);
  const tokens = {
    log: [
      { t: now - 5 * DAY, m: 'mock', mo: 'glm-4-flash', p: 1850, c: 620, e: false },
      { t: now - 3 * DAY, m: 'resume', mo: 'glm-4-flash', p: 2400, c: 910, e: false },
      { t: now - DAY, m: 'agent', mo: 'glm-4-flash', p: 3100, c: 1240, e: false },
      { t: now - 3600000, m: 'brief', mo: DEMO_MODEL, p: 420, c: 180, e: true },
    ],
  };

  const entries = {
    im_srs: srs,
    im_activity: activity,
    im_sessions: sessions,
    im_resumes: resumes,
    im_apps: apps,
    im_knowledge: knowledge,
    im_profile: profile,
    im_gamify: gamify,
    im_target_date: targetDate,
    im_tokens: tokens,
    im_onboarded: true,
    im_demo_seeded: '1',
  };
  for (const [k, v] of Object.entries(entries)) {
    try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (_) { /* ignore */ }
  }
  if (stateObj) {
    stateObj.srs = srs;
    stateObj.activity = activity;
    stateObj.sessions = sessions;
    stateObj.resumes = resumes;
    stateObj.apps = apps;
    stateObj.knowledge = knowledge;
    stateObj.profile = profile;
    stateObj.gamify = gamify;
    stateObj.targetDate = targetDate;
  }
  return true;
}

/** 顶部演示横幅（仅演示模式） */
export function showBanner() {
  if (!isDemoMode() || typeof document === 'undefined') return;
  if (document.getElementById(BANNER_ID)) return;
  const mount = () => {
    if (document.getElementById(BANNER_ID)) return;
    const bar = document.createElement('div');
    bar.id = BANNER_ID;
    bar.className = 'demo-bar';
    bar.innerHTML = '<b>演示模式</b><span>数据只存在这台设备的浏览器里，AI 回答是本地示例；完整功能请本地运行 <code>node server.js</code></span>'
      + '<a class="btn small ghost" href="https://github.com/zhengqiuyang/interview-mate" target="_blank" rel="noopener">看仓库 ↗</a>'
      + '<button class="btn small ghost" id="demo-reset">重置示例</button>'
      + '<button class="btn small ghost" id="demo-exit">退出演示</button>';
    document.body.prepend(bar);
    const reset = document.getElementById('demo-reset');
    if (reset) {
      reset.addEventListener('click', () => {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith('im_')) localStorage.removeItem(k);
        }
        location.reload();
      });
    }
    const exit = document.getElementById('demo-exit');
    if (exit) {
      exit.addEventListener('click', () => {
        const u = new URL(location.href);
        u.searchParams.delete('demo');
        location.href = u.toString();
      });
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
}
