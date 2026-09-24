/* 路由模块：视图注册表 + switchView
 * 独立于 app.js，避免视图 ↔ 入口的循环依赖（也让浏览器缓存旧入口时不出问题） */
import { $$ } from './core.js';

import * as dashboard from './views/dashboard.js';
import * as agent from './views/agent.js';
import * as mock from './views/mock.js';
import * as bank from './views/bank.js';
import * as review from './views/review.js';
import * as jobs from './views/jobs.js';
import * as apps from './views/apps.js';
import * as knowledge from './views/knowledge.js';
import * as resume from './views/resume.js';
import * as history from './views/history.js';
import * as settings from './views/settings.js';

export const VIEWS = {
  dashboard: { label: '数据看板', icon: 'gauge', mod: dashboard, keys: ['kanban', 'dashboard', '看板', '首页'] },
  agent: { label: '智能体教练', icon: 'sparkles', mod: agent, keys: ['agent', 'mentor', '智能体', '教练', 'ai'] },
  mock: { label: '模拟面试', icon: 'mic', mod: mock, keys: ['mianshi', 'interview', '面试', '闯关'] },
  bank: { label: '题库练习', icon: 'book', mod: bank, keys: ['tiku', 'bank', '题库', '刷题'] },
  review: { label: '复习中心', icon: 'repeat', mod: review, keys: ['fuxi', 'review', '复习', 'srs'] },
  jobs: { label: '岗位雷达', icon: 'radar', mod: jobs, keys: ['gangwei', 'jobs', '岗位', '招聘'] },
  apps: { label: '投递看板', icon: 'send', mod: apps, keys: ['toumdi', 'apps', '投递', '看板', 'crm'] },
  knowledge: { label: '知识库', icon: 'brain', mod: knowledge, keys: ['zhishi', 'knowledge', '知识', '笔记'] },
  resume: { label: '简历工坊', icon: 'clipboard', mod: resume, keys: ['jianli', 'resume', '简历', 'jd', '工坊'] },
  history: { label: '面试记录', icon: 'folder', mod: history, keys: ['jilu', 'history', '记录', '报告'] },
  settings: { label: '设置', icon: 'settings', mod: settings, keys: ['shezhi', 'settings', '设置'] },
};

export function switchView(name) {
  if (!VIEWS[name]) name = 'dashboard';
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  VIEWS[name].mod.onShow();
}
