# 贡献指南

感谢你愿意为 InterviewMate 贡献！这是一个**零依赖、本地优先**的项目，保持简单是它的核心竞争力，请让 PR 也保持这个气质。

## 本地开发

```bash
git clone https://github.com/zhengqiuyang/interview-mate.git
cd interview-mate
node server.js        # 无需 npm install
# 打开 http://127.0.0.1:3000
```

要求 Node.js 18+。前端是原生 ES Modules，无构建步骤——改完刷新即生效。

## 项目结构

```
server.js            # 零依赖服务：静态托管 + LLM 流式代理 + Agent 工具代理
lib/jobs.js          # 岗位雷达引擎（源适配器/关键词过滤/定时调度）
lib/briefs.js        # 每日简报（快照存储/定时生成）
data/questions.json  # 内置题库（内容贡献入口）
public/
  index.html         # 单页应用骨架（所有视图的静态容器）
  css/style.css      # 设计系统（CSS 变量双主题）
  js/
    app.js           # 入口：命令面板/全局搜索/快捷键/新手引导
    router.js        # 视图注册表与切换
    core.js          # 工具库：存储/图标/Markdown/图表/动效/Modal/Toast
    state.js         # 全局状态单例（localStorage 持久化）
    srs.js           # 间隔重复算法（Leitner）+ 打卡/热力
    gamify.js        # XP / 等级 / 成就
    views/*.js       # 每个视图一个模块，导出 init() 与 onShow()
```

## 我想加题目

编辑 `data/questions.json`，按现有格式追加：

```json
{
  "id": "net-99",              // 唯一 ID：分类前缀-序号
  "cat": "net",                // 必须是 categories 里已有的 key
  "diff": 2,                   // 1 基础 / 2 进阶 / 3 高阶
  "tags": ["TCP"],
  "q": "问题",
  "a": "- 要点一\n- 要点二\n- 加分项：..."   // 支持 - 列表与 **加粗**
}
```

要求：真实高频题（面经里反复出现的）、答案「要点式 + 加分项」风格、不抄任何项目原文。

## 我想加官方技能包

`public/js/views/agent.js` 里的 `OFFICIAL_PACKS` 数组追加一项（expert 或 tool），保持「一键安装」即用。

## 我想加视图

1. `public/js/views/你的视图.js`，导出 `init()`（绑定事件，只跑一次）与 `onShow()`（每次切入刷新）
2. `index.html` 加 `<section id="view-xxx" class="view">` 与导航按钮
3. `router.js` 的 `VIEWS` 注册（自动获得命令面板/快捷键入口）

## 提交规范

- commit message：中文或英文均可，格式 `类型: 摘要`（feat / fix / docs / bank / ui）
- PR 请保持小而聚焦，一个 PR 一件事
- CI 会跑：服务端语法检查、题库完整性、15 个前端模块导入自检——本地先跑 `node --check server.js` 再提交

## 行为准则

友好、就事论事。面试准备内容以「帮助理解」为目标，不鼓励背题应付，更不允许加入任何用于在线面试作弊的功能。
