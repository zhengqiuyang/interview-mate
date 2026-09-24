# 让 Agent 记住用户：长期画像的两种低成本沉淀方案

> 系列第 6 篇。Agent 生态都在讲「记忆」，多数方案的潜台词是向量数据库 + embedding。这篇讲一个更朴素的实现：结构化画像卡——其中一条路径甚至零 token 成本。
> 仓库：https://github.com/zhengqiuyang/interview-mate

## 一、先想清楚：Agent 要记住什么

「记忆」这个词太笼统。拆开看，面试训练场景里 Agent 需要记住的是三类东西：

1. **事实**：你的项目用了什么技术栈（「订单项目用 RabbitMQ 做异步解耦」）
2. **弱点**：你在哪里反复失分（「JVM 调优实战欠缺」「表达啰嗦不结论先行」）
3. **偏好**：你适合什么样的节奏（「在职找工作，每天只有 1 小时」）

注意没有一类是「聊天记录」。完整对话历史既贵（每次都要塞进上下文）又低信噪比（废话占九成）。**记忆的正确形态是蒸馏后的结构化卡片**，不是原账本。

## 二、数据模型：一张卡 120 字符

```js
// 五类画像卡
const PROFILE_TYPES = {
  项目: { icon: '📦' },   // 项目要点，出题时深挖
  失分: { icon: '⚠️' },   // 高频失分点，重点照顾
  薄弱: { icon: '📉' },   // 技术短板，补强优先
  偏好: { icon: '⚙️' },   // 求职节奏与偏好
  亮点: { icon: '⭐' },   // 优势，面试可主动展示
};

// addCards：去重合并，返回真实新增数
export function addCards(list) {
  let n = 0;
  for (const c of list || []) {
    const type = PROFILE_TYPES[c.type] ? c.type : '项目';
    const content = String(c.content).trim().slice(0, 120);
    if (S.profile.cards.some((x) => x.type === type && x.content === content)) continue;
    S.profile.cards.unshift({ id: 'pc-' + Date.now() + '...', type, content,
      source: c.source || 'AI', date: Date.now() });
    n += 1;
  }
  if (S.profile.cards.length > 60) S.profile.cards.length = 60;  // 上限
  if (n) persist('profile');
  return n;
}
```

三个设计决定：

**去重键 = 类型 + 内容**。同一句话从两条路径沉淀两次，只留一条。60 张上限 + 新的顶掉旧的（`unshift` + 截断）——画像应该是「最新鲜的 60 条认知」，不是无限增长的档案。

**`source` 字段**。每张卡记录它从哪来（模拟面试/简历诊断/手动），用户在管理界面能看到，删的时候心里有数。

**120 字符截断**。卡片必须是一句话。模型写长段的冲动很强，掐在数据层。

## 三、沉淀路径一：零 token 的结构化提取

第一条路径不花一分钱，因为**数据本来就是结构化的**。简历诊断输出的是严格 JSON（评分环、雷达维度、要求覆盖清单、风险列表），从里面提取画像卡是纯本地计算：

```js
// 简历诊断完成后自动执行
const cards = [];
(parsed.risks || []).forEach((r) =>
  cards.push({ type: '失分', content: `${r.issue}——${r.fix || ''}`.slice(0, 100) }));
(parsed.coverage || []).filter((c) => c.status !== 'covered').forEach((c) =>
  cards.push({ type: '薄弱', content: `JD 要求未满足：${c.req}`.slice(0, 80) }));
(parsed.radar || []).filter((r) => (r.score || 0) <= 5).forEach((r) =>
  cards.push({ type: '薄弱', content: `维度偏弱：${r.dim} ${r.score}/10` }));
if (cards.length) addCards(cards.map((c) => ({ ...c, source: '简历诊断' })));
```

风险→失分卡、未覆盖要求→薄弱卡、低分维度→薄弱卡。**用户跑完一次诊断，画像自动丰富三条，全程零额外调用**。这提醒我们一个常被跳过的思路：上 LLM 之前先看看手里是不是已经有结构化数据。

## 四、沉淀路径二：LLM 提取非结构化内容

第二条路径针对面试报告——Markdown 文本，没有结构可薅，需要模型来蒸馏。提示词的关键是**「跨场价值」约束**：

```text
你是面试复盘教练。基于面试评估报告提取值得长期记住的候选人画像卡。
严格只输出 JSON：{"cards": [{"type": "项目|失分|薄弱|偏好|亮点", "content": "一句话"}]}
规则：只提取有跨场价值的信息（如「订单项目用 RabbitMQ 异步解耦，
可深挖一致性追问」）；忽略只与本题相关的细节；最多 6 张卡；不编造。
```

「忽略只与本题相关的细节」是这句提示词的灵魂。没有它，模型会把「这次 TCP 三次握手答错了」也存成卡——那是错题本的职责，不是画像的。画像存的是**模式**（表达啰嗦），不是**事件**（某题答错）。

这条路径做成了报告页上的按钮（「沉淀画像」）而不是自动触发——LLM 调用应该由用户发起，成本感知是诚实的产品设计。

## 五、消费：一个工具 + 一处注入

画像的价值在消费端。两个入口：

**`get_profile()` 工具**——Agent 主动查询：

```js
get_profile() {
  const cards = S.profile.cards.slice(0, 20);
  return cards.length
    ? { 画像卡: cards.map((c) => `[${c.type}] ${c.content}`),
        说明: '这些是用户历次面试/诊断沉淀的长期画像，出题与建议应据此个性化' }
    : { 画像卡: [], 说明: '用户还没有画像沉淀，按常规处理' };
}
```

注意那个`说明`字段——告诉模型**拿到画像后该怎么用**（个性化出题），比裸数据有效得多。

**统计概况注入**——`my_stats()` 的返回里带一行「长期画像：N 条（可用 get_profile 读取详情）」。Agent 执行任务时先调 `my_stats`，看到画像非空自然会追调 `get_profile`。这形成了记忆的「索引→详情」两级结构，避免每次全量注入。

效果是累积性的：用的次数越多，画像越厚，Agent 的出题和会诊越贴人——「越用越懂你」不是营销话术，是数据结构的必然。

## 六、与 RAG 路线的对比

| | 画像卡 | 向量库 RAG |
| --- | --- | --- |
| 存储 | localStorage 几 KB | embedding 库 |
| 写入 | 规则提取 / LLM 蒸馏 | 全文切块向量化 |
| 读取 | 全量注入或工具查询 | 相似度检索 top-k |
| 可解释 | 用户可视可删 | 黑盒 |
| 成本 | 一条路径零 token | 写入读取都要 embedding |

RAG 适合「海量非结构化语料」（知识库问答），画像卡适合「对用户本人的认知」。后者天然小规模、高价值、需要用户可控——**能用结构化解决的，别上向量**。

---

**https://github.com/zhengqiuyang/interview-mate** —— 求个 star ⭐。下一篇回到基础设施：零依赖实现 OpenAI 兼容的流式透传。
