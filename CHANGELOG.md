# Changelog

All notable changes to this project will be documented in this file.

格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### Removed
- `server.js` 中无调用的 `buildResumeSystemPrompt`（Markdown 版简历诊断提示词）——
  已被 `buildResumeV2SystemPrompt`（JSON 版，含结构化输出约束）取代，死代码易误导

### Changed
- 版本号单一来源：启动横幅 / `/api/health` / sw.js 缓存名 / index.html 全部
  由 package.json 经 `scripts/sync-version.mjs` 管理（v0.19.0 起）
- CI：node 18/20/22 矩阵 + eslint 门禁 + 行为测试（node:test）+ 启动冒烟 +
  覆盖率报告（仅 22）
- 测试：node:test 行为测试 44 用例（SRS / 成就 / jobs 纯函数 / 真实 server 行为）
