# 60 行代码实现 OpenAI 兼容流式代理：SSE 透传的完整拆解

> 系列第 7 篇。所有 AI 功能的地基是同一件事：把用户配置的任意 OpenAI 兼容服务的流式响应，原样搬进浏览器。这篇拆解这条管道的两端——服务端怎么「透」、客户端怎么「解」。
> 仓库：https://github.com/zhengqiuyang/interview-mate

## 一、为什么是透传而不是转发

代理 LLM 响应有两种做法：

- **解析转发**：服务端解析 SSE，重组 JSON，按自己的协议发给前端
- **原样透传**：服务端只当管道，SSE 字节流原封不动过去，解析留给前端

透传的优势是**零维护面**：服务端不理解也不修改内容，OpenAI 格式怎么变，代理层代码一行不用动。所有跟内容相关的逻辑（渲染、工具协议解析、usage 统计）都在客户端，与服务端解耦。个人工具，管道越笨越可靠。

## 二、服务端：fetch + 流式 pipe

```js
async function proxyChat(res, body) {
  // ……校验、拼系统提示词、确定 endpoint/apiKey/temperature……

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model, stream: true,
        stream_options: { include_usage: true },   // ①
        temperature,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
  } catch (e) {
    return sendJson(res, 502, { error: `无法连接模型服务：${e.message}` });
  }

  if (!upstream.ok || !upstream.body) {           // ②
    const text = await upstream.text().catch(() => '');
    let detail = text.slice(0, 500);
    try { detail = JSON.parse(text).error?.message || detail; } catch (_) {}
    return sendJson(res, 502, { error: `模型服务返回 ${upstream.status}：${detail}` });
  }

  // ③ SSE 原文透传
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',                    // ④
  });
  const nodeStream = Readable.fromWeb(upstream.body);
  nodeStream.on('error', () => res.end());
  nodeStream.pipe(res);
}
```

四个标注点：

**① `stream_options: {include_usage: true}`**。OpenAI 系服务默认不在流里带 token 用量，这个参数让最后一个 chunk 附上 `usage` 字段——前面 Token 用量面板的「精确值」就来自这里。兼容性注记：智谱 GLM、DeepSeek 本来就在末 chunk 带 usage，这个参数它们也接受；只有极少数严格校验参数的网关会拒绝，遇到了去掉即可。

**② 错误必须在 writeHead 之前处理**。HTTP 响应头一旦发出（开始流式），状态码就定了，再想返回错误 JSON 已经来不及。所以先等 fetch 完成检查状态码，确认 200 才 writeHead 进入流式模式。上游的错误体里通常有 `error.message`，解析出来透给前端，用户看到的是「模型服务返回 401：无效的 api key」而不是干巴巴的 502。

**③ `Readable.fromWeb(upstream.body)`**。Node 18 的 fetch（undici）返回的是 WHATWG 流，不能直接 pipe 给 HTTP 响应，`stream.Readable.fromWeb` 做标准转换。这是 Node 原生 fetch 时代做流式代理的标准姿势，零依赖。

**④ `X-Accel-Buffering: no`**。如果这个服务哪天部署在 Nginx 后面，这个头告诉 Nginx 别缓冲响应——否则它会攒够 8KB 才往下游发，用户端「流式」变成「卡半天一大坨」。本地直连无所谓，一行头买好保险。

## 三、客户端：SSE 解析器

浏览器端用 `fetch` + reader 手动读流（而不是 `EventSource`——它不支持 POST）：

```js
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const parts = buf.split('\n');
  buf = parts.pop();                              // ① 半行回填
  for (const lineRaw of parts) {
    const line = lineRaw.trim();
    if (!line.startsWith('data:')) continue;      // ②
    const data = line.slice(5).trim();
    if (data === '[DONE]') continue;              // ③
    try {
      const j = JSON.parse(data);
      const delta = j.choices?.[0]?.delta?.content
                 ?? j.choices?.[0]?.message?.content ?? '';
      if (delta) onDelta(delta);
      if (j.usage) usage = j.usage;               // ④
    } catch (_) { /* 半包或非 JSON 行，忽略 */ }
  }
}
```

四个防御点，每个都对应真实网络行为：

**① 半行回填**。TCP 分块不看 SSE 行边界，一个 `data: {...}` 可能被劈成两个 chunk。`split('\n')` 后最后一段是不完整行，塞回 `buf` 等下一个 chunk 拼完。这是所有流式解析的经典套路，忘了它就会随机丢内容。

**② 只认 `data:` 前缀**。SSE 规范里还有 `event:`、`id:`、注释行（冒号开头），不同厂商混用，跳过不认识的行比解析它们稳健。

**③ `[DONE]` 哨兵**。OpenAI 系流以 `data: [DONE]` 结尾，直接跳过。

**④ 顺路收集 usage**。末 chunk 里的用量信息在解析循环里顺手存下，流结束后记账（有真实 usage 用精确值，没有就按字符估算兜底）。解析器不只为渲染服务。

**try/catch 包住每个 JSON.parse**。半包（① 没对齐时）、厂商私有的非 JSON 行，都会炸解析——单行失败跳过继续，流式场景的容错哲学是**丢一行好过断一流**。

## 四、一个容易忽略的体验细节

流式渲染时每个 chunk 都触发一次 `bubble.innerHTML = md(full)`——整段 Markdown 重新渲染。会不会闪烁或卡顿？实践答案：几百次量级的 innerHTML 替换在现代浏览器上无感，比逐字符 DOM 操作简单且快。真正的体验杀手是**滚动条跳变**，每次渲染后补一句 `box.scrollTop = box.scrollHeight` 就稳了。

## 五、小结

| 端 | 关键调用 | 防御点 |
| --- | --- | --- |
| 服务端 | fetch(stream) → Readable.fromWeb → pipe | 错误前置处理 / X-Accel-Buffering |
| 客户端 | reader 循环 → split('\n') → JSON.parse | 半行回填 / data: 过滤 / 单行容错 |

一条 60 行的管道，撑起了项目里所有 AI 功能的「打字机效果」。造这个轮子的收益是彻底搞懂了 SSE——下次见到任何流式接口，套路完全一样。

---

**https://github.com/zhengqiuyang/interview-mate** —— 求个 star ⭐。系列下一篇转向数据侧：间隔重复算法的参数设计。
