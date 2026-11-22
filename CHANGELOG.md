# Changelog

All notable changes to this project will be documented in this file.

格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/)。

## [0.22.0] - 2026-11-23

### Added
- **题库深度扩容至 265 题 / 14 分类**（新增 105 道原创高质量面试题与代码模板）：
  - **新增「C++ 专项」（35 题，`cpp-1`..`cpp-35`）**：系统覆盖指针/引用、`const`/`constexpr`/`consteval`、内存布局与对齐、虚表/菱形虚继承、移动语义与完美转发、智能指针控制块与线程安全、STL 底层实现（`vector`/`map`/`deque`/SSO）与迭代器失效、`memory_order` 无锁同步、False Sharing `alignas(64)` 与 ASan/TSan 排查
  - **「AI / LLM 工程」扩充至 40 题（`ai-11`..`ai-40`）**：涵盖机器学习基础（偏差方差/AdamW/XGBoost/LightGBM/PR-AUC/数据泄露）、深度学习（ResNet/RMSNorm/Pre-LN/SwiGLU/RoPE 外推/Autograd）、大模型训练与对齐（GQA/MLA/MoE 负载均衡/RLHF-PPO vs DPO vs GRPO/ZeRO-FSDP-TP-PP/BF16/Scaling Laws）、推理加速与工程（PTQ-AWQ-FP8/FlashAttention Online Softmax/投机解码/VLM/受限解码 FSM/YaRN 与 Prefix Caching/Agent 评测与 Guardrails）
  - **「算法与数据结构」扩充至 40 题（`algo-15`..`algo-40`）**：涵盖单调栈/队列、前缀和与差分、位运算与状压 DP、Trie/AC 自动机、线段树懒标记与树状数组、图论最短路/MST/Tarjan、KMP/滚动哈希、背包循环顺序与树形/区间/数位 DP、O(N log N) LIS 还原、跳表/布隆/Cuckoo Filter、蓄水池抽样、海量数据外排序与分治、A*、矩阵快速幂、交换论证与主定理
  - **「手写代码」扩充至 26 题（`code-13`..`code-26`）**：全部配备可直接渲染一键复制的 C++ / Python 围栏代码块——手写 `SharedPtr`、`BoundedBlockingQueue`、五法则 `MyString`、TTAS `SpinLock`、PyTorch Multi-Head Attention、数值稳定 Softmax+CrossEntropy 前反向、LoRA 线性层、RoPE 旋转位置编码、柱状图最大矩形、堆优化 Dijkstra、并查集、K 组翻转链表、最小覆盖子串与 LIS/Trie
- **模拟面试新增 C++ 与 AI/LLM 岗位**：前端岗位下拉与服务端提示词 `ROLE_MAP` 同步支持 `C++ 研发工程师` 与 `AI / LLM 工程师`
- **演示模式样例更新**（`seedDemoData`）：补全 C++ / AI / 算法 / 手写代码练习分布，首屏直观展现完整 14 维能力雷达

### Changed
- **能力雷达图标签优化**（`dashboard.js`）：由固定 5 字符硬截断改为显式 14 分类短标签映射（`C++`、`AI/LLM`、`Go/Py`、`系统设计` 等），避免多维坐标轴出现省略号

## [0.21.0] - 2026-11-22

### Added
- **题库扩容至 160 题 / 13 分类**：新增「Go / Python 专项」（10 题）与「AI / LLM 工程」（10 题，覆盖 Self-Attention、RAG、Agent/ReAct、Prompt 注入防御、LoRA vs RAG、KV Cache/PagedAttention、MCP 等），扩充网络/OS/数据库/算法/手写代码（含规范围栏代码）/前后端/Java/系统设计/行为面试/项目复盘高频题
- **开源题库 Markdown / GitHub 导入器**（`public/js/md-import.js` + `POST /api/bank/fetch-md`）：设置 → 自定义题库支持上传本地 `.md`、粘贴 Markdown 或直接粘贴 GitHub 文件链接自动转为 `raw.githubusercontent.com` 抓取解析 `## / ###` 问答并预览导入，合规接入任意开源面经仓库
- **模拟面试接入「关联简历 + 长期画像」上下文**：开始面试前可选择简历库中的简历并勾选注入历次复盘画像，服务端 `buildMockSystemPrompt` 自动结合简历项目细节与历史薄弱点追问
- **演示模式（`?demo=1`）首屏拟真样例档案**（`seedDemoData`）：空存储首次访问自动注入 7 天备考数据（覆盖 13 分类的掌握进度与雷达多边形、3 场逐次上升的模拟面试记录、4 条投递看板卡片、2 篇知识笔记、4 条长期画像、14 天热力条与未来复习预测），并新增底部「重置示例」按钮
- **Markdown 渲染器增强**：`md()` 新增围栏代码块（`` ```lang ``，带语言标题与一键复制按钮、内部禁用粗体误替换）和 `>` 引用块渲染

### Fixed
- **全量备份遗漏修复**：`BACKUP_KEYS` 从 `state.js` 统一导出，全量导出/导入现已完整覆盖简历库（`im_resumes`）、投递看板（`im_apps`）、长期画像（`im_profile`）、游戏化（`im_gamify`）、Token 用量（`im_tokens`）、自定义工具/专家与目标日期
- **Ollama 本地模型真正免 Key 运行**：前端 `isLocalModel()` 与服务端 `isLocalEndpoint` 对 `localhost` / `127.0.0.1` / `[::1]` 端点放行空 `apiKey`（不再报 400 未配置 Key）
- **路由与计数同步**：`switchView()` 同步更新 `S.view`（切主题时正确重绘当前所在页面图表）；简历工坊侧栏 `#rs-count` 实时更新简历总数

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
