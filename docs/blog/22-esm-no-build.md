# 无构建的 ES Modules 工程：模块拆分、循环依赖与浏览器缓存的一次真实事故

> 系列第 22 篇（B 线·零依赖造轮子之五）。没有 Webpack、没有 Vite、没有 node_modules——10 个视图 + 20 个模块全部用原生 ES Modules 直接跑在浏览器里。这篇讲这条路怎么走通，以及一个把项目搞崩过的循环依赖事故。
> 仓库：https://github.com/zhengqiuyang/interview-mate

## 一、无构建的模块图

整个前端的模块组织：

```
js/
  app.js        入口：命令面板、快捷键、初始化
  router.js     视图注册表 + switchView
  core.js       工具库：存储/图标/Modal/Toast/图表/Markdown
  state.js      全局状态单例（localStorage 持久化）
  api.js        streamChat（SSE 解析）
  srs.js        间隔重复算法
  gamify.js     XP/等级/成就
  profile.js    长期画像
  views/*.js    11 个视图，各导出 init() 与 onShow()
```

依赖方向刻意做成**接近树形**：`views → router → views`（唯一的环）、`views → core/state/api`、`core ↔ state`（一个反向引用）。没有构建工具替你做 tree-shaking 和循环分析，**依赖图必须靠纪律维持**。

## 二、视图注册表：路由与入口解耦

最初 `app.js` 直接持有视图映射并导出 `switchView`，各视图反向 import 它——形成 `app → views → app` 的环。某天给 app.js 加载入口加了 `?v=0.2.0` 版本号后，**视图模块还在用缓存的旧 app.js**（无版本号的裸路径），新旧两个 app.js 实例共存，`switchView` 找不到视图直接白屏。

修复方案是把路由抽成独立模块：

```js
// router.js —— 只做注册表和切换，不依赖任何入口状态
import * as dashboard from './views/dashboard.js';
import * as mock from './views/mock.js';
// ……11 个视图

export const VIEWS = {
  dashboard: { label: '数据看板', icon: 'gauge', mod: dashboard, keys: [...] },
  // ……
};

export function switchView(name) {
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  VIEWS[name].mod.onShow();
}
```

视图 import `router.js` 的 `switchView`，app.js 也 import 它——**环被第三者拆解成两条单向边**。这是处理循环依赖最朴素也最有效的手法：找到环上「职责可以被抽出」的那个节点。

## 三、ESM 的循环依赖：为什么有时能跑有时崩

拆 router 之前那个环其实「大部分时候能跑」，这涉及 ESM 循环的微妙语义：

- ESM 模块是**活的绑定**（live binding）：`import { switchView }` 拿到的是引用，模块加载完成前是未初始化的
- **函数声明会提升**：`export function switchView` 在模块体执行前就已可用
- 所以 `views → app.js（部分初始化）` 时调 `switchView` 通常没问题——但如果是 `export const VIEWS = {...}`（const 不提升），视图模块在加载时立即读它就是 undefined

**结论性规律**：ESM 循环里只引用函数是灰色地带（能跑），加载期就消费 const/let 导出是红线（必崩）。无构建工程没有 bundler 帮你重排模块顺序，这条红线比在 Webpack 项目里更容易踩到。

## 四、无构建的日常：改完即生效

这套架构的日常体验：改任何模块，**保存、刷新浏览器、生效**——没有编译步骤、没有 HMR 端口、没有「构建缓存坏了先 rm -rf」。代价是没有 TS 类型检查和打包优化，但换来的心智简单在个人项目里极其值钱。

配套的工程护栏（因为没有编译期检查）：

1. **模块导入自检**：CI 里跑一段 Node 脚本，把每个模块 `import()` 一遍——语法错误、导出名拼错、循环引用导致的初始化崩溃，全部在 CI 拦截：

```yaml
- name: 前端模块导入自检（ESM 链接完整性）
  run: |
    node -e "
      const mods = ['./public/js/app.js', './public/js/router.js', ...];
      (async () => {
        for (const m of mods) await import(m);
        console.log(mods.length + ' 个模块导入通过');
      })();
    "
```

注意模块里不能有加载期 DOM 访问（`document.querySelector` 只许出现在函数体内）——否则 Node 环境自检直接炸。这条纪律本身也是好的模块设计。

2. **入口版本号**：`index.html` 里 `<script src="/js/app.js?v=0.19.0">`，发版改号强制刷新。至于内部互相 import 的模块路径没法加版本号——那就是下一篇 Service Worker 的故事了。

## 五、动态 import：按下需加载和逃生门

`import()` 在无构建工程里有两个妙用：

**交互后加载重模块**：分享卡片生成器（含 Canvas 排版）只在用户点「生成分享图」时 `await import('./core.js')`——虽然这个体量谈不上性能优化，但模式在关键时刻能救命。

**打破加载期循环**：dashboard 需要调用 agent 视图的 `collectStatsText`（形成 `dashboard → agent → router → dashboard` 的加载期环），改成事件或动态 import 都能解。无构建工程里**动态 import 是循环依赖的最后逃生门**。

## 六、什么时候该升级构建工具

出现这些信号再上 Vite：需要 TS；需要 npm 上的库（组件/解析器）；模块数逼近五十；想要单文件打包分发。在那之前，原生 ESM + 一个 lint 级 CI 就是完全体——**浏览器本身已经是最好的模块打包器**。

---

**https://github.com/zhengqiuyang/interview-mate** —— 求个 star ⭐。
