# Changelog

All notable changes to this project will be documented in this file.

格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/)。

## [0.20.0] - 2026-11-22

### Added
- **Design System v4（Precision AI Workbench）**：单层无覆写 CSS 架构，重写 `public/css/style.css`，彻底清理历史 v2/v3 样式堆叠；
  左侧栏按「工作台 / 训练与记忆 / 求职与复盘 / 系统」四组归类并显示快捷键角标（`1`–`0`）；
  数据看板顶栏集成「开始模拟面试 / 智能体教练 / 到期复习」高频快捷动作，补齐「投递跟踪」构成 4×2 对称八宫格 KPI，并将「今日简报」与「今日挑战」并排呈现
- **GitHub Pages 在线演示部署**（`.github/workflows/pages.yml`）：推送 `main` 自动发布 `public/`，在 `*.github.io` 域名下默认启用演示模式（也可显式带 `?demo=1`），前端静态资源全部改为相对路径以兼容子路径托管
- **英文文档** `README.en.md` 与全新 v4 实机界面截图（浅色看板 / 深色看板 / 智能体教练 / 题库练习）
- 演示模式 `?demo=1`：把 `/api/*` 换成本地 mock（流式打字机回答、示例评估报告、示例岗位库），
  无服务端、无 API Key、可纯静态托管；与正常模式共用同一套前端，只替换 API 适配层
  （`public/js/demo.js`）。演示题库 `public/js/demo-bank.js` 由 `scripts/build-demo.mjs`
  从 `data/questions.json` 生成，CI 校验漂移

### Fixed
- Canvas 雷达图、折线图、环形图与热力图改为动态读取当前主题 CSS 变量（`--brand` / `--chart-fill` / `--heat-*`），修复切换深色与暖调主题时图表仍显示旧版固定蓝紫色的问题
- `.env` 里的 `PORT` / `HOST` / `INTERVIEW_MATE_DATA_DIR` 之前不生效：dotenv 加载排在常量读取
  与 `lib/jobs.js`、`lib/briefs.js` 之后，现已提前到最前；`HOST_IS_LOOPBACK` 改用真正绑定的
  `HOST`（此前读 `process.env.HOST`，`.env` 写 `0.0.0.0` 时会误跳过 Host 校验）
- 非法数值型环境变量（如 `INTERVIEW_MATE_UPSTREAM_FIRST_BYTE_MS=abc`）不再变成 `NaN`
  让 `setTimeout` 立即触发（误判超时），统一回退默认值并打印告警
- `stream_options` 400 回退的第二次请求补齐首字节超时：此前回退请求挂住会永久 hang

### Removed
- `server.js` 中无调用的 `buildResumeSystemPrompt`（Markdown 版简历诊断提示词）——
  已被 `buildResumeV2SystemPrompt`（JSON 版，含结构化输出约束）取代，死代码易误导

### Changed
- **设计系统 v3（Swiss）**：统一排版刻度（`--fs-*` 五档 + 8pt 间距 + 单一描边色），
  用 1px 描边替代全部卡片投影，移除极光背景 / 噪点 / 渐变标题 / 渐变按钮 / 卡片高光；
  侧栏改为浅色窄导轨，看板问候区从"欢迎卡片"改为页头
- **主题收敛为三套 token**：中性（默认）/ 墨黑 / 暖调，同一套排版骨架；
  移除 aurora · editorial · brutal 三套「设计风格」维度（旧 `im_style` 不再生效，
  主题切换按钮按 中性 → 墨黑 → 暖调 循环）
- **UI 2.0**：移动端导航重建（胶囊 tab，修复标签被压成 31px 竖排、首屏被吃掉 27% 的问题）、
  KPI 两列、题库行改两行布局、筛选条横向滚动、触控区 ≥35px；桌面 KPI 四列 + 内容居中、
  字号收敛到 11.5px 起
- 版本号单一来源：启动横幅 / `/api/health` / `sw.js` 缓存名 / `index.html` 全部
  由 `package.json` 经 `scripts/sync-version.mjs` 管理
- CI：node 18/20/22 矩阵 + eslint 门禁 + 行为测试（`node:test`）+ 启动冒烟 +
  覆盖率报告（仅 22）
- 测试：`node:test` 行为测试 65 用例（SRS / 成就 / jobs 纯函数 / 真实 server 行为 /
  流式代理两段超时与回退 / localStorage 配额 / 演示模式适配层）
