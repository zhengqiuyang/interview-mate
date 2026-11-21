# Changelog

All notable changes to this project will be documented in this file.

格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### Added
- 演示模式 `?demo=1`：把 `/api/*` 换成本地 mock（流式打字机回答、示例评估报告、示例岗位库），
  无服务端、无 API Key、可纯静态托管；与正常模式共用同一套前端，只替换 API 适配层
  （`public/js/demo.js`）。演示题库 `public/js/demo-bank.js` 由 `scripts/build-demo.mjs`
  从 `data/questions.json` 生成，CI 校验漂移

### Fixed
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
- 版本号单一来源：启动横幅 / `/api/health` / sw.js 缓存名 / index.html 全部
  由 package.json 经 `scripts/sync-version.mjs` 管理（v0.19.0 起）
- CI：node 18/20/22 矩阵 + eslint 门禁 + 行为测试（node:test）+ 启动冒烟 +
  覆盖率报告（仅 22）
- 测试：node:test 行为测试 56 用例（SRS / 成就 / jobs 纯函数 / 真实 server 行为 /
  流式代理两段超时与回退）
