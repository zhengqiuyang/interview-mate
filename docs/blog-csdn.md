# 开源｜零依赖打造 AI Agent 面试训练系统：不绑定任何厂商的工具调用协议设计

> 仓库：**https://github.com/zhengqiuyang/interview-mate**
> `git clone` 之后 `node server.js` 一条命令跑起来。0 个 npm 依赖，Node 18+，题库/复习/看板全部离线可用。

## 一、为什么做这个项目

面试准备这个领域，GitHub 上从来不缺资源：CS-Notes、JavaGuide、tech-interview-handbook、system-design-primer……这些项目加起来几十万 star，但它们有一个共同点——**全是静态知识库**，回答的只是「面试考什么」。

而真正决定你能不能拿到 offer 的，是另外两个没人回答的问题：

1. **「你现在答得怎么样？」** —— 背了 500 道题，没有任何反馈闭环；
2. **「什么时候该复习什么？」** —— 昨天看过和三个月前看过，在收藏夹里长得一模一样。

InterviewMate 就是为补上这两个缺口做的：**静态题库 → AI Agent 陪练 → 记忆算法调度 → 求职全流程管理**。目前迭代到 v0.19，约 9000 行代码，11 个模块，从第一行代码起就坚持两件事：零 npm 依赖、数据全部留在本地。

## 二、先看能干什么（30 秒版）

```bash
git clone https://github.com/zhengqiuyang/interview-mate.git
cd interview-mate
node server.js    # 就这样，连 npm install 都没有
```

打开 `http://127.0.0.1:3000`：

| 模块 | 能力 |
| --- | --- |
| 🤖 智能体教练 | 能调用工具、多步执行的 AI Agent——读你的真实数据、直接建题/存档（下文详述） |
| 🎙️ 模拟面试 | AI 面试官逐题追问 + 评分报告；四轮闯关（技术→项目→系统设计→HR）；语音整场 + 录音复盘 |
| 🔁 复习中心 | Leitner 间隔重复、错题本、Cloze 填空卡、限时口述训练 |
| 📚 题库 | 90 道内置高频题（含 Java 专项/手写代码），与 Anki 双向互通 |
| 📡 岗位雷达 | 订阅公开源定时抓取 + 关键词过滤 + 本地简历匹配分 |
| 📋 简历工坊 | 上传 PDF/Word 原生预览、AI 结构化解析、JD 诊断、润色 |
| 📮 投递看板 | 九列状态流转 + 面试提醒 + 转化漏斗统计 |
| 🧠 长期画像 | 跨场沉淀你的项目要点与失分点，Agent 越用越懂你 |

不配 API Key 也能用；AI 功能支持任意 OpenAI 兼容接口（智谱 GLM / OpenAI / DeepSeek / 本地 Ollama）。

## 三、技术核心：不绑定任何厂商的工具调用协议

这是整个项目最值得展开的设计。

想让 LLM「能干活」——查数据、建文件、执行多步任务——主流做法是接各家的 Function Calling API。但这条路有两个问题：把项目绑死在特定厂商上；大量 OpenAI 兼容的第三方/本地模型并不支持。

我的方案：**把工具协议做进提示词，执行放在客户端**。任何能正常对话的模型都能跑。

### 3.1 协议设计

系统提示词里声明工具清单（共 10 个）+ 严格的执行规则：

```text
可用工具（每次最多一个）：
1. my_stats() — 用户学习统计：掌握度/待复习/面试得分/投递进度
2. search_bank(query) — 搜索题库
3. get_resume() — 读取简历全文
4. add_cards(cards) — 直接创建练习题并入复习系统
5. save_knowledge(...) — 写入知识库
……共 10 个

执行规则（严格遵守）：
- 需要调用工具时，只输出一行：TOOL: {"name": "工具名", "args": {...}}
  然后立即停止输出，等待 TOOL_RESULT 消息
- 收到结果后继续：要么调用下一个工具，要么输出最终回答
```

### 3.2 执行循环

模型输出 `TOOL: {...}` → 前端解析 → 本地执行（读写用户浏览器里的真实数据）→ 结果以 `TOOL_RESULT` 回灌 → 模型继续推理。最多 4 轮，防止失控：

```js
export async function agentLoop({ messages, onDelta, onTool, maxSteps = 4 }) {
  for (let step = 0; step <= maxSteps; step++) {
    let full = '';
    await streamChat({ messages }, (d) => {
      full += d;
      if (!/TOOL:/.test(full)) onDelta(full);   // 流式渲染非工具文本
    });
    const call = parseToolCall(full);            // 提取输出末尾的 TOOL 调用
    if (!call) return { text: full };            // 没有调用 → 最终回答，结束
    const result = await execTool(call);         // 白名单校验 + 本地执行
    onTool(call, result);                        // UI 渲染「工具芯片」
    messages.push(
      { role: 'assistant', content: full },
      { role: 'user', content: 'TOOL_RESULT: ' + JSON.stringify(result) },
    );
  }
}
```

三个值得展开的工程细节：

**白名单双重校验**。`parseToolCall` 只接受注册表里存在的工具名，`execTool` 执行前再校验一次——模型「幻觉」出一个不存在的工具、或被提示注入诱导时，直接返回错误对象，绝不执行。

**流式渲染的门控**。一旦在输出流里检测到 `TOOL:` 字样就暂停 UI 渲染，避免把协议文本亮给用户；界面上只显示渲染好的「工具芯片」（🔧 工具名 + 参数摘要 + ✓ 完成 + 可展开的结果 JSON），用户能看到 Agent 每一步在干什么。

**会诊的并行化**。多 Agent 会诊（首席面试官 / 求职军师 / 复盘教练）复用同一个 `agentLoop`，只是注入不同的人设。`Promise.all` 并行跑三个循环，各自独立调用工具、流式渲染，最后由 Mentor 汇总三方意见输出行动清单。

### 3.3 这个方案的边界（诚实说缺点）

协议遵守率依赖模型能力。强模型（GPT-4 / GLM-4 级）遵守率接近 100%；小参数模型偶尔会把 `TOOL:` 写进正文、或输出后忘记停止。所以解析放在**完整输出之后**而非流式中途，配合宽松正则（匹配末尾调用、容忍前后缀文本）做容错。实测：换任何 OpenAI 兼容服务，包括本地 Ollama 跑的开源模型，协议都能稳定工作。

## 四、其他几个有意思的设计

**零依赖是刻意的**。server.js 一个文件 + 原生 ES Modules 前端，没有构建步骤、没有 node_modules、没有版本地狱。代价是自己造了一批轮子：SSE 流式解析（约 40 行）、Canvas 雷达图（约 80 行）、DOCX 解析（docx 本质是 ZIP，用浏览器原生 `DecompressionStream` 解压 + XML 转文本）、Markdown 渲染器（约 60 行）。换来的是「clone 即用」和极低的维护成本。

**数据主权**。所有学习数据、简历、API Key 存用户自己的浏览器 localStorage，岗位订阅存本地文件，唯一的网络请求就是用户自己配的 LLM 服务。做个人工具，这条边界值得守住。

**三套设计风格**。极光（玻璃质感渐变）/ 编辑部（衬线大标题 + 纸张底色 + 朱砂点睛）/ 粗野主义（墨线描边 + 硬投影 + 荧光黄），CSS 变量 + `data-style` 属性切换，与明暗主题正交组合。

## 五、写在最后

项目从第一行代码到 v0.19 共 19 个版本，全部开源（MIT）：

**https://github.com/zhengqiuyang/interview-mate**

如果你在准备面试，或者对「提示词工具协议」「零依赖前端工程」这些话题感兴趣，欢迎 clone 下来玩玩——真的 30 秒就能跑起来。觉得有用的话**求个 star ⭐**，这是持续更新的最大动力；题库贡献和 PR 尤其欢迎。

> 这是系列第一篇。后续计划拆成一个完整的系列：Agent 执行循环的工程细节、零依赖解析 DOCX、多 Agent 并行会诊、间隔重复算法的参数设计、语音面试状态机、开源第一周的 50 个克隆者教会我的事……感兴趣可以先 star 占个座。

---

*环境要求：Node.js 18+（推荐 20+），任意现代浏览器。AI 功能需自备 OpenAI 兼容 API Key（智谱 GLM 注册即有免费额度）。*
