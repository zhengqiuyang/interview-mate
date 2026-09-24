# 多 Agent 会诊的设计：并行执行、人设注入与汇总裁决

> 系列第 3 篇。单 Agent 会调工具之后，下一步自然是让多个 Agent 协作。这篇讲 InterviewMate 里「会诊」功能的完整实现：三位专家并行读你的真实数据、各自诊断、最后汇总裁决。
> 仓库：https://github.com/zhengqiuyang/interview-mate

## 一、为什么是「会诊」而不是「流水线」

多 Agent 协作的常见形态是流水线（A 的输出做 B 的输入），但求职诊断这个场景不适合：面试官视角、求职军师视角、复盘教练视角看的是**同一份材料**，意见应该相互独立，最后交叉印证——这正是医院多学科会诊的模式。

所以架构是**扇出-汇总**（fan-out & synthesize）：N 个专家并行独立工作，一个主持人汇总裁决。这种形态还有个隐藏好处：某位专家失败不影响其他专家的结果，天然的故障隔离。

## 二、专家的数据结构：内置 + 自定义统一模型

```js
const PANEL = [
  { key: 'interviewer', icon: 'mic', name: '首席面试官', tag: '犀利 · 找挂点',
    task: '从考官视角指出我最可能被挂掉的 3 个追问方向……' },
  { key: 'strategist', icon: 'target', name: '求职军师', tag: '策略 · 两周作战',
    task: '给出我两周内的求职作战策略……' },
  { key: 'coach', icon: 'rotate', name: '复盘教练', tag: '落地 · 今日三件事',
    task: '基于我的数据给出 3 条今天就能做的具体改进动作……' },
];

function allExperts() {
  return [
    ...PANEL,
    ...S.customExperts.map((e) => ({
      key: e.id, icon: e.icon, name: e.name, tag: e.tag,
      task: e.task,
      personaText: `你是「${e.name}」，${e.task}`,   // 自定义专家走独立人设通道
      custom: true,
    })),
  ];
}
```

关键设计：**内置专家和用户自定义专家是同一个模型**。内置专家的人设在服务端（`buildAgentSystemPrompt(persona)` 按 key 查表），自定义专家的人设是一段文本（`personaText` 字段直传）。用户在界面上创建一个「薪资谈判教练」，和内置专家走完全一样的执行通道——技能市场因此天然成立。

## 三、并行执行：Promise.all + 状态隔离

```js
async function runPanel() {
  const experts = allExperts().filter((e) => S.panelPick.includes(e.key));
  const opinions = {};
  await Promise.all(experts.map(async (p) => {
    const card = document.querySelector(`.panel-card[data-key="${CSS.escape(p.key)}"]`);
    const state = $('.panel-state', card);
    const body = $('.panel-body', card);
    state.textContent = '分析中'; state.className = 'badge warn panel-state';
    try {
      const res = await agentLoop({
        messages: [{ role: 'user', content: p.task }],
        persona: p.custom ? undefined : p.key,
        personaText: p.custom ? p.personaText : '',
        allowedTools: ['*'],
        onDelta: (full) => { body.innerHTML = md(full); },        // 流式进各自的卡
        onTool: (call, result) => { /* 工具芯片渲染进各自的卡 */ },
      });
      body.innerHTML = md(res.text);
      state.textContent = '完成'; state.className = 'badge ok panel-state';
      opinions[p.key] = `${p.name}：\n${res.text}`;
    } catch (e) {
      body.innerHTML = `<p style="color:var(--danger)">出错了：${esc(e.message)}</p>`;
      state.textContent = '失败'; state.className = 'badge warn panel-state';
    }
  }));
  // 汇总裁决……
}
```

三个隔离层次值得注意：

**UI 隔离**。每个专家一张卡，闭包捕获自己的 `card`/`body`/`state` 引用，流式输出互不串台。三位专家同时打字时，各自卡片同时滚动。

**状态隔离**。每张卡有独立的状态徽章（待命 → 分析中 → 完成/失败），`Promise.all` 不因为单个 reject 整体崩掉——try/catch 放在循环体内部。

**数据隔离**。每个专家的 `agentLoop` 拿到的是独立的 `convo` 快照（上一篇讲过 `messages.map(m => ({...m}))`），互相看不见对方的中间过程。

## 四、汇总裁决：让主持人处理冲突

三方意见齐了之后（`opinions` 对象），发起最后一次调用：

```js
await streamChat({
  mode: 'agent', persona: 'mentor',
  messages: [{
    role: 'user',
    content: `三位专家刚对同一位候选人完成会诊，意见如下：\n\n${Object.values(opinions).join('\n\n---\n\n')}\n\n请汇总：指出意见一致与冲突之处，去重合并，输出「本周行动清单 Top5」（每条注明来源专家），最后给一个一句话总判断。`,
  }],
}, (d) => { full += d; synBody.innerHTML = md(full); });
```

这个提示词是会诊的灵魂。它不叫 Mentor「总结」，而叫它做三件更难的事：**找一致**（三方都提的就是高置信结论）、**找冲突**（面试官说基础扎实、军师说优先补基础——谁对？）、**溯源输出**（每条行动注明来自哪位专家）。带溯源的汇总是用户信任多 Agent 输出的关键——你能分清哪句话是谁说的。

## 五、人设工程：专家不是改个名字

实践中踩过的坑：早期版本的「人设」就是一句「你是严格的面试官」，结果三个专家的输出几乎一样——都变成了泛泛的建议清单。有效的差异化要做两件事：

**视角锚定**。每个专家的 task 里写死了输出形态：面试官必须给「追问方向 + 追问话术 + 期望回答要点」；军师必须给「按天拆解的时间表」；教练必须给「做什么/做多久/怎么算完成」。输出形态不同，模型才会真正切换视角。

**数据引用要求**。每个 task 都写明「先调 my_stats / get_resume 了解情况」，并且工具结果会真实回灌——专家不是对着空气演，而是拿着你的错题记录和简历说话。人设 + 真实数据，才有「会诊」的感觉。

## 六、小结

| 设计点 | 方案 |
| --- | --- |
| 协作拓扑 | 扇出-汇总，不是流水线 |
| 并行 | Promise.all + 循环体内 try/catch 故障隔离 |
| 人设 | 输出形态锚定 + 强制引用真实数据 |
| 汇总 | 找一致/找冲突/逐条溯源 |
| 扩展 | 自定义专家与内置同模型，personaText 直通 |

下一篇讲这套东西如何长出「技能市场」——工具和专家如何变成可分享的 JSON。

---

**https://github.com/zhengqiuyang/interview-mate** —— 求个 star ⭐，系列持续更新中。
