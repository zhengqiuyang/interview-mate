# 60 行的 Markdown 渲染器：先转义再渲染的安全铁律

> 系列第 21 篇（B 线·零依赖造轮子之二）。AI 应用的前端离不开 Markdown 渲染——模型输出几乎都是 MD 格式。marked 42KB、markdown-it 100KB，而聊天场景实际只需要其中一小半语法。这篇讲怎么用 60 行写一个「够用且安全」的渲染器。
> 仓库：https://github.com/zhengqiuyang/interview-mate

## 一、需求裁剪：聊天场景需要哪些语法

统计了项目里所有真实会渲染的模型输出，语法清单收敛到：

| 语法 | 用途 |
| --- | --- |
| `# ## ###` 标题 | 报告分节 |
| `**加粗**`、`` `行内代码` `` | 强调与术语 |
| `- 列表`、`1. 列表` | 建议清单 |
| ` ```代码块``` ` | 代码展示 |
| `[链接](url)` | 资源引用 |
| `> 引用` | 提示块 |
| 段落 | 其余一切 |

表格、脚注、图片、任务列表、嵌套列表——统统不需要。**裁剪需求是第一行代码之前的事**，语法面每砍一项，实现复杂度降一个量级（嵌套结构是真正的大坑，砍掉它就只需逐行状态机）。

## 二、安全铁律：先转义，再渲染

用户内容（和模型输出——它可能被提示注入污染）直接 `innerHTML` 是 XSS 直通车。安全顺序只有一种：

```js
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// 正确：先整体转义，再在「安全字符串」上插入标签
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

// 错误：边解析边拼接原始内容
// const parse = (tokens) => tokens.map(t => t.type === 'bold'
//   ? `<strong>${t.text}</strong>` : t.text).join('');   // t.text 里的 <script> 原样进 DOM
```

先 `esc()` 把所有 HTML 元字符变成实体，之后正则插入的 `<code>`、`<strong>` 都是**我们自己写的标签**，不可能是攻击载荷。链接的 `href` 要额外过一道：只放行 `^https?://` 开头——防 `javascript:` 伪协议。

```js
.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) =>
  /^https?:\/\//.test(url) ? `<a href="${url}" target="_blank" rel="noopener">${text}</a>` : text)
```

（此处 text 已是转义后的安全串——因为 inline 的第一步就是 esc。）

## 三、逐行状态机：60 行的完整实现

```js
export function md(src) {
  const lines = String(src || '').split(/\r?\n/);
  const out = [];
  let list = null;                                   // 'ul' | 'ol'
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,4}\s+/.test(line)) {
      closeList();
      const level = line.match(/^#+/)[0].length;
      out.push(`<h${level}>${inline(line.replace(/^#+\s+/, ''))}</h${level}>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
    } else if (/^\d+[.、)]\s+/.test(line)) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(line.replace(/^\d+[.、)]\s+/, ''))}</li>`);
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('');
}
```

结构就是「一行一个决定」：标题？列表项？空行（结束列表）？否则段落。`closeList()` 在每个非列表分支前调用，保证 `<ul>/<ol>` 永远闭合——**未闭合标签是渲染器最常见的 bug 来源**，用一个集中函数消灭它。

代码块是完整版里额外加的一个状态位（``` 进入/退出，块内不碰 inline），加上也就是十五行的事。

## 四、流式渲染的额外要求

AI 聊天有个特殊工况：**Markdown 是半截的**。流式输出到一半，`**加粗` 只有左星号、代码块只有开 fence。渲染器必须对残缺输入不崩溃、不吞字：

- 未闭合的 `**`：正则 `/\*\*([^*]+)\*\*/` 匹配不上，原文显示——正确行为
- 未闭合的代码 fence：状态机把后续都当代码内容渲染——下一 chunk 补上右 fence 自然恢复
- 每个 chunk 全量重渲 `bubble.innerHTML = md(fullText)`——几百次量级无性能问题，比增量 DOM diff 简单且不易错

**对残缺输入的容忍度，是聊天渲染器和文档渲染器的分水岭**。测试时专门造「砍尾」用例（把正确 MD 从中间截断）跑一遍，比什么测试都管用。

## 五、什么时候升级到正经库

出现以下任一信号就换 markdown-it：需要表格/嵌套列表/图片；要做语法高亮集成；渲染用户上传的任意 MD 文档。但在「渲染自家 AI 输出」的场景里，60 行 + 白名单语法就是最优解——**你看得到每一行在干什么，出了问题十分钟定位**，这在安全相关代码上是真实的奢侈。

## 六、小结

| 原则 | 一句话 |
| --- | --- |
| 先转义后渲染 | 所有实体先变 `&xxx;`，再插入自己的标签 |
| href 白名单 | 只放行 http(s) |
| 集中闭合 | closeList 一处调用，标签永不悬空 |
| 容忍残缺 | 流式半截输入不崩不吞 |
| 需求裁剪 | 嵌套结构不进白名单，复杂度断崖下降 |

---

**https://github.com/zhengqiuyang/interview-mate** —— 求个 star ⭐。
