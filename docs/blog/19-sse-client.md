# 浏览器端 SSE 解析器：fetch 流读取的协议细节与防御层次

> 系列第 19 篇（B 线·零依赖造轮子之四）。第 7 篇讲了流式透传的两端总览，这篇单挑浏览器端深挖：为什么不能用 EventSource、reader 循环里的分块边界怎么处理、一个解析器要防住多少种「网络现实」。
> 仓库：https://github.com/zhengqiuyang/interview-mate

## 一、EventSource 为什么出局

浏览器原生的 SSE 客户端是 `EventSource`，但它有个致命限制：**只支持 GET**。LLM 对话接口要 POST 一个大 JSON（完整消息历史 + 系统参数），EventSource 直接出局。

剩下的路只有 `fetch` + 手动读流：

```js
const res = await fetch('/api/chat', { method: 'POST', ... });
const reader = res.body.getReader();
```

`res.body` 是 WHATWG ReadableStream，`getReader()` 拿到锁后进入「手动拉取」模式——每次 `read()` 返回一个分块，什么时候流结束由 `done` 告诉你。这是整个解析器的地基。

## 二、分块边界：SSE 行与 TCP 块毫无关系

最核心的认知：**网络分块（chunk）和 SSE 消息（event）是两个完全无关的切分维度**。一个 `data: {...}` 行可能被劈在两个 chunk 里，一个 chunk 也可能装着五行。

处理范式是「缓冲区 + 按行消费 + 半行回填」：

```js
let buf = '';
const decoder = new TextDecoder();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });   // ①
  const parts = buf.split('\n');
  buf = parts.pop();                                 // ②
  for (const lineRaw of parts) {
    // 消费完整行……
  }
}
```

**① `decode(value, {stream: true })`**：和 SSE 行一样，**多字节字符也会被 chunk 劈开**。一个汉字 3 字节，劈在第 2 字节上，`TextDecoder` 不带 stream 标志会输出乱码（U+FFFD）。`stream: true` 告诉解码器「未完的字节先攒着，下个分块接着解」。这是 SSE 解析器里最隐蔽的中文 bug。

**② `parts.pop()`**：split 之后最后一段极可能是半行（没有换行符结尾），塞回缓冲区等下个 chunk 拼完。忘记这一步的症状极具迷惑性——**长回复偶发丢内容、JSON 解析随机失败**，而且分块边界取决于网络抖动，复现全看缘分。

## 三、SSE 行级解析：只认 data:

SSE 规范定义了六种行（`event:`、`data:`、`id:`、`retry:`、注释、空行），OpenAI 系服务只用其中两种半：

```js
const line = lineRaw.trim();
if (!line.startsWith('data:')) continue;     // 其余全跳过
const data = line.slice(5).trim();
if (data === '[DONE]') continue;             // 结束哨兵
try {
  const j = JSON.parse(data);
  const delta = j.choices?.[0]?.delta?.content
             ?? j.choices?.[0]?.message?.content ?? '';
  if (delta) onDelta(delta);
  if (j.usage) usage = j.usage;
} catch (_) { /* 丢弃这一行 */ }
```

防御点逐个说：

**`slice(5).trim()`**：规范说 `data:` 后面可以有一个可选空格，厂商实现不一，trim 一劳永逸。

**`?? message?.content`**：流式响应的增量在 `delta.content`，但有些兼容网关把整段消息放 `message.content`（非流式格式混进流里）——两种都接，宽容换兼容。

**try/catch 包住单行解析**：半行（回填失效时）、厂商私有的心跳行、非 JSON 的注释行，全都炸 parse。**丢一行好过断一流**，这是流式解析的容错哲学。

**顺路收 usage**：末 chunk 里藏着 token 用量，解析循环里一个 `if` 顺手存下——用量统计不需要额外的请求。

## 四、中止：AbortController 的传递链

用户点「停止生成」的瞬间，理想行为是**网络传输也立刻断掉**（而不是把剩余 token 收完再丢弃）。做法是把 `AbortController.signal` 传给 fetch：

```js
const ctrl = new AbortController();
$('#btn-stop').onclick = () => ctrl.abort();
const res = await fetch('/api/chat', { ..., signal: ctrl.signal });
```

中止后 `reader.read()` 会抛 `AbortError`，调用方 catch 这个错误名，把半截回答标记为「（已停止生成）」——**已渲染的内容保留，未到的内容不再等**。整条链路是：UI 按钮 → controller → fetch → reader → 上层 catch，任何一环断了体验就残缺。

## 五、工程化包装：进度条与并发计数

把这套解析包成项目级的 `streamChat`，还要叠两件小事：

**顶部进度条**：进入时 `showProgress()`（nprogress 风格冲到 72%），finally 里 `hideProgress()`。用计数器而不是布尔值——Agent 多任务卡并行时会同时开好几条流，最后一条结束才该收尾：

```js
let progDepth = 0;
export function showProgress() { progDepth += 1; /* ... */ }
export function hideProgress() {
  progDepth = Math.max(0, progDepth - 1);
  if (progDepth > 0) return;      // 还有并交流在跑
  /* 收尾动画 */
}
```

**错误前置**：`if (!res.ok)` 时服务端返回的是 JSON 错误（不是 SSE），先 `await res.json()` 拿到 error 字段再抛——用户看到「模型服务返回 401：无效的 api key」而不是「Unexpected token N in JSON」。

## 六、一个完整的调试心法

流式 bug 的共性是**不确定性**——和网络时序绑定，print 调试法经常抓空。两个惯用手段：

1. **录制原始流**：调试开关下把 `buf` 的每次变化存进数组，出错时 dump 全文——半行回填、字符乱码、行丢失一眼可辨
2. **大回复压测**：让模型输出 3000 字以上长文，分块边界问题在高密度分块下必然复现

## 七、小结

| 防御 | 对付的「网络现实」 |
| --- | --- |
| stream: true 解码 | 多字节字符跨 chunk |
| 半行回填 | SSE 行被 chunk 劈开 |
| data: 前缀过滤 | 注释行 / event 行 / 心跳 |
| 单行 try/catch | 半行 / 私有格式混入 |
| AbortController | 用户反悔 |
| 并发计数进度条 | 多流并行 |

40 行解析器，防的是六种各有脸孔的网络现实。写完它，你对「流」的理解会从名词变成动词。

---

**https://github.com/zhengqiuyang/interview-mate** —— 求个 star ⭐。
