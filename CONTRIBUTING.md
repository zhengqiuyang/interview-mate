# 贡献指南 · Contributing to InterviewMate

感谢你愿意为 **InterviewMate** 贡献！这是一个**零运行时依赖、本地优先**的项目，保持简单克制是它的核心竞争力，请让 PR 也保持这个气质。

---

## 核心设计原则

1. **零 npm 运行时依赖**：生产代码（`server.js`、`lib/*`、`public/*`）严格只依赖 **Node.js 18+ 内置标准库**与**浏览器原生 Web API**，请勿引入运行时第三方依赖（仅 `eslint` 与 `@eslint/js`/`globals` 作为开发/CI devDependency）。
2. **静态演练兼容（GitHub Pages `?demo=1`）**：任何新增界面与 `/api/*` 路由，需在 `public/js/demo.js` 提供对应的 Mock 拦截与降级说明，保证静态托管预览版同样零报错可用。
3. **单层 CSS Token**：样式统一维护在 `public/css/style.css` 中，颜色/阴影/字体需引用顶层 `--bg` / `--card` / `--ink` / `--brand` 等设计 Token，兼容 **中性 / 墨黑 / 暖调** 三套主题。

---

## 本地开发与校验

```bash
git clone https://github.com/zhengqiuyang/interview-mate.git
cd interview-mate
node server.js        # 无需 npm install，刷新浏览器即见最新前端代码
```

若改动了题库或版本，提交前请执行：

```bash
node scripts/build-demo.mjs          # 修改 data/questions.json 后同步 public/js/demo-bank.js
node scripts/sync-version.mjs        # 修改 package.json 版本后同步 sw.js / index.html

npm run lint                         # ESLint 9 静态检查（需先 npm ci --ignore-scripts）
npm test                             # 运行 80 项 node:test 自动化测试
node scripts/build-demo.mjs --check
node scripts/sync-version.mjs --check
```

---

## 项目结构概览

```text
server.js                 # 零依赖服务：静态托管 + 流式 LLM 代理 + 回环安全校验
lib/
  coderun.js              # 本机沙箱（Node / Python 3 / C++17）
  sync.js                 # 本机 user-state.json 原子落盘同步
  jobs.js / briefs.js     # 岗位雷达抓取与定时每日简报
data/questions.json       # 内置高频题库（265+ 题 / 14 分类）
public/
  index.html              # 单页应用骨架
  css/style.css           # Design System v4 单层样式与三套主题 Token
  js/
    app.js / router.js    # 入口、命令面板、全局搜索、快捷键、路由表
    core.js / state.js    # 存储/图标/Markdown/Canvas 图表/状态与磁盘自动同步
    demo.js / md-import.js# ?demo=1 Mock 适配层 / 开源 Markdown 解析导入
    codelab-cases.js      # Code Lab 多语言预置模板与断言测试集
    views/*.js            # 业务视图（dashboard/agent/mock/bank/codelab/flashcards/...）
```

---

## 我想加题目（`data/questions.json`）

- **原创提炼 & 版权合规**：参考主流知识体系提炼结构化知识点，**禁止直接整段复制粘贴第三方版权题库或书籍原文**。推荐采用「核心结论 → 分点对比/原理拆解 → `> **追问 / 加分项**：...`」。
- **格式与渲染约定**（匹配 `public/js/core.js` `md()`）：
  - 题干 `q` 保持纯文本，不加反引号 `` ` `` 或 Markdown 符号；
  - 答案 `a` 支持 `##` 标题、`-`/`1.` 列表、`>` 引用块、`` `行内代码` ``、`**加粗**` 及 ```` ```cpp ```` / ```` ```python ```` / ```` ```js ```` 围栏代码块（避免使用 Markdown 表格与 `$LaTeX$`）；
  - 避免在 `**加粗**` 内包裹含单独 `*` 的字符（如 `` `*ptr` `` 请放在加粗括号外）；
  - 为 `手写代码` 新增题目时，欢迎同步在 `public/js/codelab-cases.js` 补充可运行的 starter 模板与断言测试集！

## 我想加官方技能包 / 新视图

- **官方技能包**：在 `public/js/views/agent.js` 的 `OFFICIAL_PACKS` 数组追加一项（`expert` 或 `tool`），保持一键安装即用。
- **新视图**：在 `public/js/views/` 新建模块导出 `init()` 与 `onShow()`，`public/index.html` 添加 `<section id="view-xxx" class="view">` 与侧栏按钮，并在 `public/js/router.js` 的 `VIEWS` 注册。

---

## 提交规范与行为准则

- 推荐使用 Conventional Commits：`feat:`、`fix:`、`docs:`、`test:`、`chore:`；单个 PR 聚焦一件事。
- 请勿强行提交 `.env`、`data/user-state.json`、`data/jobs-store.json`、`data/briefs.json`、`data/files/` 等运行期私人数据。
- **行为准则**：友好、就事论事。所有能力以「帮助理解与系统备考」为目标，拒绝任何形式的在线面试实时作弊外挂或违规爬虫功能。
