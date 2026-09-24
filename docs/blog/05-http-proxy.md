# Agent 连接外部世界的桥：HTTP 工具代理的设计与安全边界

> 系列第 5 篇。Agent 有了内置工具之后，用户的第一诉求一定是「让它能查我自己的接口」。这篇讲自定义 HTTP 工具背后的关键一跳：为什么必须代理、怎么代理、安全边界画在哪。
> 仓库：https://github.com/zhengqiuyang/interview-mate

## 一、问题：CORS 是横在浏览器前的墙

让浏览器里的 Agent 调外部 API，第一反应是直接 `fetch`。但现代浏览器的同源策略会让绝大多数请求死在预检阶段——你控制不了的第三方 API 不会为你的本地工具配 CORS 头，内网接口更不可能。

服务端之间没有这堵墙。所以方案只有一个：**本机 Node 服务做代理**，浏览器把请求交给服务端，服务端去请求目标 API，结果原样带回。

```
浏览器 Agent ──POST /api/tools/http──▶ 本机 Node 服务 ──fetch──▶ 目标 API（任意）
                                       （无同源策略）
```

## 二、代理端的实现：一个端点，四条纪律

```js
if (req.method === 'POST' && pathname === '/api/tools/http') {
  const body = JSON.parse(await readBody(req));
  let target;
  try { target = new URL(body.url); } catch (_) {
    return sendJson(res, 400, { error: 'URL 无效' });
  }
  // 纪律一：协议白名单
  if (!/^https?:$/.test(target.protocol)) {
    return sendJson(res, 400, { error: '仅支持 http(s)' });
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);      // 纪律二：超时
  try {
    const r = await fetch(target, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'InterviewMate-skill/0.8 (local personal tool)' },
    });
    clearTimeout(t);
    // 纪律三：响应截断
    const text = (await r.text()).slice(0, 3000);
    return sendJson(res, 200, { status: r.status, text });
  } catch (e) {
    clearTimeout(t);
    return sendJson(res, 502, { error: e.name === 'AbortError' ? '请求超时（12s）' : e.message });
  }
}
```

四条纪律逐条说理由：

**协议白名单**。`new URL()` 解析后只放行 `http:` / `https:`。这不是防黑客——个人本地工具的威胁模型没那么戏剧化——是防**模型犯傻**：LLM 有时会拼出 `file:///etc/passwd` 这样的「工具调用」，浏览器 fetch 根本不支持 file 协议，但万一某个环境支持呢？一行校验，永绝后患。

**12 秒超时**。Agent 循环里任何一步卡死都是灾难——用户面对的是无响应的界面。AbortController 到点强制断开，错误信息明确标注「请求超时」，模型看到后会自己换个思路。

**响应截断 3000 字符**。工具结果要回灌进 LLM 上下文。一个返回 2MB JSON 的接口如果不截断，轻则浪费 token，重则直接超上下文上限报错。3000 字符够模型判断「查到了什么、下一步干什么」，不够的话用户会自己换个更精准的接口。

**诚实的心跳**。错误统一走 JSON `{error}` 返回给前端，前端把它包装成工具芯片上的「✕ 失败」状态。Agent 的失败要可见，静默失败是最差的失败。

## 三、客户端：URL 模板插值

自定义工具的执行端在浏览器里，核心是参数插值：

```js
async function execTool(call) {
  const t = S.customTools.find((x) => x.name === call.name);
  let url = t.urlTemplate;
  for (const [k, v] of Object.entries(call.args || {})) {
    url = url.split(`{{${k}}}`).join(encodeURIComponent(String(v)));
  }
  const res = await fetch('/api/tools/http', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const j = await res.json();
  if (!res.ok) return { error: j.error || `HTTP ${res.status}` };
  return { status: j.status, 内容: j.text };
}
```

两个细节：**`encodeURIComponent` 包住参数值**——模型给的 query 里带 `&` 或 `#` 会直接拆坏 URL，编码之后模板再拼就稳了；**返回给模型的字段名用中文（`内容`）**——和所有内置工具的返回风格一致，模型对统一的返回结构处理得更稳。

## 四、安全边界：个人工具的诚实答案

这类「让 Agent 发任意请求」的功能，安全讨论绕不开 SSRF（服务端请求伪造）。标准企业方案是域名白名单、内网地址段封禁（169.254.x.x、10.x.x.x……）。

InterviewMate 的选择是**不设防**，理由值得写清楚：

1. 这是**单用户本地工具**，服务只监听 127.0.0.1，能发这个代理请求的只有用户自己的浏览器页面；
2. 「查内网接口」恰恰是真实需求——用户想让 Agent 查自己公司的测试环境，封内网等于砍掉核心场景；
3. 真正的风险在于恶意网页向 `localhost:3000` 发请求——但浏览器对跨域 POST 有预检保护，且请求无法携带凭据，能造成的最坏结果是「让用户的 Agent 多读了一次公开 API」。

安全建模做到「理解威胁、明确取舍」就够了，装企业级防御反而让个人工具不可用。当然，如果哪天做多用户部署，这套边界必须重画——这也是为什么协议白名单、超时、截断这些「防误伤」纪律从一开始就在。

## 五、小结

| 层 | 职责 |
| --- | --- |
| 浏览器（工具定义） | URL 模板 + 参数编码 |
| 本机服务（代理） | 协议白名单 / 12s 超时 / 3KB 截断 / 错误透传 |
| 模型（工具说明书） | description 写得越清楚，调用越准 |

Agent 接外部世界没有黑魔法，就是把「浏览器不能、服务端能」这件事用一个 40 行的端点解决掉。下一篇讲怎么让 Agent 记住用户——长期画像的低成本方案。

---

**https://github.com/zhengqiuyang/interview-mate** —— 求个 star ⭐，系列持续更新。
