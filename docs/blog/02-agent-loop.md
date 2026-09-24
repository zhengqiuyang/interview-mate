# 拆解 AI Agent 的执行循环：流式门控、白名单校验与失控防护的设计细节

> 系列第 2 篇。上一篇讲了「不绑定任何厂商的工具调用协议」的整体设计，这篇拆开执行循环本身——那些让 Agent 在真实产品里稳定跑起来的工程细节。
> 仓库：https://github.com/zhengqiuyang/interview-mate （零依赖，clone 即用）

## 一、为什么执行循环值得单独写一篇

工具协议定义了「模型怎么发起调用」，但一个能在产品里用的 Agent 循环还要回答四个问题：

1. 流式输出到一半，怎么知道模型是想调工具还是在正常说话？
2. 模型幻觉出一个不存在的工具怎么办？
3. 模型无限循环调工具怎么办？
4. 用户中途喊停怎么办？

这四个问题对应四个设计：**流式门控、双重白名单、步数上限、可中止信号**。逐个拆。

## 二、循环骨架

```js
export async function agentLoop({ messages, persona, onDelta, onTool, signal, maxSteps = 4 }) {
  const convo = messages.map((m) => ({ ...m }));          // ① 消息快照
  for (let step = 0; step <= maxSteps; step++) {
    let full = '';
    await streamChat({ mode: 'agent', persona, messages: convo }, (d) => {
      full += d;
      if (!/TOOL:/.test(full)) onDelta(full, step);        // ② 流式门控
    }, signal);
    const call = parseToolCall(full);                      // ③ 完整输出后解析
    if (!call) return { text: full, convo };               // 最终回答
    convo.push({ role: 'assistant', content: full });
    const result = await execTool(call);                   // ④ 白名单执行
    onTool(call, result);
    convo.push({ role: 'user',
      content: 'TOOL_RESULT: ' + JSON.stringify(result).slice(0, 4000) });
    if (step === maxSteps - 1) {                           // ⑤ 强制收尾
      convo.push({ role: 'user', content: '（工具调用次数已达上限，请基于现有信息直接给出最终回答）' });
    }
  }
  // 理论上到不了这里；兜底再要一次最终回答
  let full = '';
  await streamChat({ mode: 'agent', persona,
    messages: [...convo, { role: 'user', content: '请直接给出最终回答。' }] },
    (d) => { full += d; onDelta(full); }, signal);
  return { text: full, convo };
}
```

五个标注点就是五个设计。逐个展开。

## 三、流式门控：`/TOOL:/` 的一个正则

流式回调里有一个不起眼的判断：`if (!/TOOL:/.test(full)) onDelta(full)`。

它解决的是体验问题：LLM 的输出是逐 token 到达的，如果无条件渲染，用户会看到 `TOOL: {"name":"my_stats"...}` 这样的协议文本闪现在聊天框里。加了门控之后，一旦检测到输出里出现 `TOOL:` 字样，UI 渲染立即暂停，转而显示「工具调用中」的加载态；调用完成后界面上渲染的是结构化的「工具芯片」（工具名 + 参数摘要 + 状态徽章 + 可展开的结果 JSON）。

注意这是**保守门控**：只要出现 `TOOL:` 子串就停止渲染，宁可少渲染一行正文，也不让协议文本漏出来。代价是极小概率误伤正文里恰好包含这个字样的回答——在中文语境下几乎不发生。

## 四、解析时机：为什么放在完整输出之后

早期版本我在流式过程中就尝试增量解析 `TOOL:` 调用，踩了两个坑：

**JSON 半包**。`{"name": "search_bank", "args": {"query": "mysql` ——到这个分片为止 JSON 是残缺的，解析必炸。要写状态机去拼。

**误触发**。模型在正文里「演示」协议格式（比如解释工具怎么用时打出 `TOOL:` 字样），流式中途会误判为真实调用。

最终方案：解析放在流结束之后，配合宽松正则：

```js
function parseToolCall(text) {
  const m = text.match(/TOOL:\s*(\{[\s\S]*?\})\s*$/);   // 只匹配输出末尾
  if (!m) return null;
  try {
    const call = JSON.parse(m[1]);
    if (call && typeof call.name === 'string' && TOOLS[call.name]) return call;
  } catch (_) { /* 半包或非法 JSON，视为未完成 */ }
  return null;
}
```

两个容错点：正则锚定在 `$`（末尾），正文中间出现 `TOOL:` 不触发；JSON 解析失败静默返回 null，当作普通回答处理。实测把协议遵守率的问题降到了可忽略。

## 五、双重白名单

模型「幻觉工具」是真实会发生的事——尤其小参数模型，会自信地调用 `search_questions`（实际叫 `search_bank`）。防御分两层：

**第一层在解析**（上面的 `TOOLS[call.name]`）：名字不在注册表里，直接当普通回答处理，不进入工具逻辑。

**第二层在执行**：

```js
async function execTool(call, allowedTools) {
  const isCustom = !TOOLS[call.name] && S.customTools.some((t) => t.name === call.name);
  if (allowedTools && !allowedTools.includes(call.name) && !allowedTools.includes('*')) {
    return { error: `该专家未授权工具 ${call.name}` };
  }
  if (TOOLS[call.name]) return await TOOLS[call.name](call.args || {});
  // 自定义 HTTP 工具走服务端代理……
}
```

第二层是给「多 Agent 会诊」准备的：每个专家可以有自己的工具授权范围，即使提示注入骗过了第一层，执行时依然拦得住。错误以 `{error}` 对象回灌给模型——它看到错误会自我纠正，换成合法工具重试，这个过程用户在工具芯片里看得一清二楚。

## 六、失控防护：步数上限 + 强制收尾

`maxSteps = 4` 不是拍脑袋。分析过真实的失败模式：模型对某个工具的结果不满意，反复重调同样的工具，每次参数微调——死循环烧 token。

上限的精妙处在 `step === maxSteps - 1` 时注入的那句「（工具调用次数已达上限，请基于现有信息直接给出最终回答）」。不给这句话，模型在下一轮还会试图调用；给了这句话，等于明确告知「游戏结束，交卷」。绝大多数模型会乖乖输出总结。

另外 `TOOL_RESULT` 回灌时截断到 4000 字符：工具返回的大 JSON（比如 20 条岗位列表）全量塞回去既浪费 token 又稀释关键信息。截断策略在提示词里同步声明了，模型知道结果是节选。

## 七、可中止：AbortController 贯穿始终

`signal` 参数从 UI 的「停止」按钮一路传到 `fetch`。被中止时流式读取抛 `AbortError`，循环向上冒泡，UI 把半截回答标记为「（已停止生成）」。用户永远有反悔的权力——这对长循环的 Agent 尤其重要，四轮工具调用 + 每轮流式生成，全程可能一两分钟。

## 八、小结

| 设计 | 解决的问题 | 一句话原则 |
| --- | --- | --- |
| 流式门控 | 协议文本漏到 UI | 宁可少渲染，不可漏协议 |
| 末尾解析 | JSON 半包 / 误触发 | 流结束再解析，正则锚定末尾 |
| 双重白名单 | 工具幻觉 / 提示注入 | 解析拦一道，执行再拦一道 |
| 步数上限 | 无限循环烧 token | 上限前一句「交卷」提示 |
| 可中止 | 用户反悔 | AbortController 贯穿 |

这些细节没有一个是论文里的东西，全是真实跑起来之后被问题逼出来的。下一篇讲多 Agent 会诊怎么把这个循环并行化——三位专家同时干活时，状态隔离和失败隔离又是另一组问题。

---

**https://github.com/zhengqiuyang/interview-mate** —— 觉得有用求个 star ⭐。系列持续更新：执行循环 → 多 Agent 并行 → 技能市场 → 零依赖造轮子 → 间隔重复算法……
