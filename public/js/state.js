/* 全局状态单例 */
import { store } from './core.js';

const PROVIDERS = [
  { key: 'zhipu', name: '智谱 GLM（推荐）', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { key: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { key: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { key: 'moonshot', name: '月之暗面 Kimi', baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { key: 'ollama', name: 'Ollama（本地，无需 Key）', baseURL: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
  { key: 'custom', name: '自定义（OpenAI 兼容）', baseURL: '', model: '' },
];

/* 旧版 im_bank_mastered（掌握列表）迁移到 SRS box4 */
function migrateMastered() {
  const old = store.get('im_bank_mastered', []);
  if (!old.length) return;
  const srs = store.get('im_srs', {});
  let changed = false;
  for (const id of old) {
    if (!srs[id]) { srs[id] = { box: 4, due: 0, reps: 1, lapses: 0, last: 0 }; changed = true; }
  }
  if (changed) store.set('im_srs', srs);
  localStorage.removeItem('im_bank_mastered');
}

export const S = {
  view: 'dashboard',
  providers: PROVIDERS,
  settings: store.get('im_settings', {
    provider: 'zhipu',
    baseURL: PROVIDERS[0].baseURL,
    model: PROVIDERS[0].model,
    apiKey: '',
    temperature: 0.7,
  }),
  theme: store.get('im_theme', 'auto'),
  style: store.get('im_style', 'aurora'),
  questions: [],
  categories: [],
  custom: store.get('im_custom', []),
  bankFilter: { cat: 'all', q: '', diff: 'all', flag: 'all' },
  srs: store.get('im_srs', {}),
  notes: store.get('im_notes', {}),
  favs: store.get('im_bank_favs', []),
  activity: store.get('im_activity', {}),
  daily: store.get('im_daily', {}),
  sessions: store.get('im_sessions', []),
  knowledge: store.get('im_knowledge', []),
  resumes: store.get('im_resumes', []),
  campaign: store.get('im_campaign', null),
  dailyBrief: store.get('im_daily_brief', null),
  gamify: store.get('im_gamify', { xp: 0, unlocked: [] }),
  customTools: store.get('im_custom_tools', []),
  customExperts: store.get('im_custom_experts', []),
  panelPick: store.get('im_panel_pick', ['interviewer', 'strategist', 'coach']),
  targetDate: store.get('im_target_date', ''),
  profile: store.get('im_profile', { cards: [] }),
  serverKey: false,
  bankLoaded: false,
};

const KEYMAP = {
  settings: 'im_settings',
  theme: 'im_theme',
  style: 'im_style',
  srs: 'im_srs',
  notes: 'im_notes',
  favs: 'im_bank_favs',
  activity: 'im_activity',
  daily: 'im_daily',
  sessions: 'im_sessions',
  custom: 'im_custom',
  knowledge: 'im_knowledge',
  resumes: 'im_resumes',
  campaign: 'im_campaign',
  dailyBrief: 'im_daily_brief',
  gamify: 'im_gamify',
  customTools: 'im_custom_tools',
  customExperts: 'im_custom_experts',
  panelPick: 'im_panel_pick',
  targetDate: 'im_target_date',
  profile: 'im_profile',
};

export function persist(key) {
  const storageKey = KEYMAP[key] || 'im_' + key;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, JSON.stringify(S[key]));
  } catch (_) { /* 忽略 */ }
}

/* 合并内置题库 + 自定义题库 */
export function mergeBank(builtin) {
  const cats = [...builtin.categories];
  if (S.custom.length && !cats.find((c) => c.key === 'custom')) {
    cats.push({ key: 'custom', name: '自定义' });
  }
  S.categories = cats;
  S.questions = [...builtin.questions, ...S.custom];
  S.bankLoaded = true;
}

/* 自定义题变化后重新合并（内置分类定义保持稳定） */
export const BUILTIN_CATS = [
  { key: 'net', name: '计算机网络' }, { key: 'os', name: '操作系统' }, { key: 'db', name: '数据库 & 缓存' },
  { key: 'algo', name: '算法与数据结构' }, { key: 'code', name: '手写代码' }, { key: 'fe', name: '前端' },
  { key: 'be', name: '后端 & 分布式' }, { key: 'java', name: 'Java 专项' },
  { key: 'sys', name: '系统设计' }, { key: 'behavior', name: '行为面试' }, { key: 'project', name: '项目复盘' },
];

export function remergeBank() {
  const builtinQs = S.questions.filter((q) => !String(q.id).startsWith('custom-'));
  mergeBank({ categories: BUILTIN_CATS, questions: builtinQs });
}

export function initMigrations() {
  migrateMastered();
}
