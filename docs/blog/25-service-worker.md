# Service Worker 的缓存策略抉择：一次「改了代码不生效」事故的完整复盘

> 系列第 25 篇（B 线·零依赖造轮子之六）。给项目加 PWA 离线能力当晚，我就被自己的 Service Worker 坑了：改的代码死活不生效，浏览器永远拿到旧版本。这篇是那次事故的完整复盘，以及最终沉淀下来的「网络优先」策略。
> 仓库：https://github.com/zhengqiuyang/interview-mate

## 一、事故现场

时间线还原：

1. 项目加了 SW：`install` 时预缓存核心资源，`fetch` 事件里**缓存优先**（cache-first）——「离线优先，多快好省」
2. 当晚我修了一个 bug（bank.js 的一个空指针），刷新页面——**bug 还在**
3. 加断点、改代码、硬刷新（Ctrl+R）——**bug 还在**
4. 开始怀疑人生：明明服务端返回的是新文件（curl 验证过）

凶手就是缓存优先策略本身：SW 拦截了 `/js/views/bank.js` 的请求，命中了 install 时写入的旧缓存，**根本没问网络**。而 SW 自身的更新机制又是被动的——浏览器只在 SW 文件字节变化时才触发更新流程，内部模块（bank.js）变了它毫不知情。

## 二、PWA 缓存的三层现实

要彻底理解这类事故，得先看清浏览器里叠着的三层缓存：

| 层 | 控制者 | 刷新策略 |
| --- | --- | --- |
| HTTP 缓存 | Cache-Control 头 | 服务端说了算（我们设了 no-store） |
| SW Cache | 你的 Service Worker | **你的代码说了算** |
| SW 本体 | 浏览器 | SW 文件变化触发更新，且新 SW 默认「等待」 |

三层里最危险的是第二层——**它把「缓存」从协议行为变成了业务逻辑**。HTTP 缓存有 ETag 协商、有 max-age 过期，而 cache-first 的 SW 缓存没有过期概念：**写进去什么，就永远是什么，直到你自己删**。

## 三、两条经典路线与它们的坑

**缓存优先（cache-first）**：离线秒开，性能最佳。坑就是上面的事故——**更新即时性为零**。适合 logo、字体、不常变的框架代码。

**网络优先（network-first）**：永远拿最新的，失败才回退缓存。坑是离线首屏慢一拍（要先等网络超时）。适合 HTML、业务代码。

对这个项目（迭代频繁的本地工具）的判断很简单：**更新可靠性 > 离线打开速度**。全部走网络优先。

## 四、最终实现：28 行的稳妥版

```js
const CACHE = 'interview-mate-v0.19.0';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(['/', '/manifest.json', '/icon.svg']))
      .then(() => self.skipWaiting())          // ① 新 SW 立即接管
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))  // ② 旧缓存清理
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;  // ③
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));  // ④
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((cached) =>
          cached || new Response('离线且无缓存', { status: 503 })))
  );
});
```

四个标注点：

**① `skipWaiting()`**：默认新 SW 要等所有旧标签页关闭才接管，本地工具等不起——装完立即上位。

**② 按 CACHE 名版本清理**：缓存名带版本号，activate 时删掉所有不叫当前名字的缓存。**这是唯一需要手动维护的版本点**，每次发版改一处。

**③ API 永不缓存**：`/api/` 前缀直接 return（不进 respondWith），LLM 对话流、题库接口永远走网络。缓存动态 API 是另一个经典深坑。

**④ 成功响应顺手更新缓存**：网络优先不等于不写缓存——每个 200 响应都 `clone()` 一份存进去（body 是流，只能读一次，所以必须 clone）。在线时它是「边用边刷新」的缓存维护，离线时它就是救命的兜底。

## 五、事故教训的浓缩

1. **SW 一旦上线，你的更新通道就捏在自己写的策略里**——选缓存优先前想清楚「我怎么发新版本」
2. 调试 SW 的姿势：DevTools → Application → Service Workers → **Bypass for network**，或者 Unregister 掉重来；`Ctrl+Shift+R` 硬刷新对 SW 缓存**无效**
3. 内部互相 import 的模块没法像入口那样加 `?v=` 版本号——所以「网络优先」不是优化项，是**必选项**
4. 缓存名带版本号 + activate 清理，是唯一要手动维护的钩子，别省

## 六、小结

PWA 的离线能力很诱人，但缓存策略的本质是**在「更新即时性」和「离线可用性」之间选边站**。迭代频繁的应用几乎无脑站前者——网络优先 + 回退缓存，28 行代码，两边都占八成。至于真正的离线优先（offline-first），留给迭代收敛后的成熟产品去考虑。

---

**https://github.com/zhengqiuyang/interview-mate** —— 求个 star ⭐。
