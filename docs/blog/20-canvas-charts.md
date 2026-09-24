# 零依赖 Canvas 图表：雷达图、折线图与 DPR 适配的一个不落

> 系列第 20 篇（B 线·零依赖造轮子之一）。数据看板需要雷达图、折线图、环形图——Chart.js 一行 npm install 的事，为什么要手写？因为在零依赖的约束下，你会发现 Canvas 图表的核心知识其实只有三块：DPR、路径、坐标换算。
> 仓库：https://github.com/zhengqiuyang/interview-mate

## 一、先解决最隐蔽的坑：DPR

高 DPI 屏幕上 Canvas 默认是模糊的——因为 CSS 像素和物理像素是两倍关系，浏览器把一张低分辨率位图拉伸显示了。标准解法三行：

```js
function setupCanvas(canvas) {
  const dpr = devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;        // 物理像素
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 之后一切按 CSS 像素画
  return { ctx, w: rect.width, h: rect.height };
}
```

精髓在 `setTransform(dpr, ...)` 之后：**所有绘制代码都不用感知 DPR 的存在**，照常按 CSS 像素坐标画，缩放交给变换矩阵。这一步漏掉的话，要么模糊，要么每个坐标都要手动乘 dpr（写到怀疑人生）。

## 二、雷达图：多边形路径 + 循环变量

雷达图是三者里最有「数学感」的，但拆开就是初中学的三角函数：

```js
function radarChart(canvas, labels, values) {
  const { ctx, w, h } = setupCanvas(canvas);
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) / 2 - 34;              // 给标签留边
  const n = labels.length;
  const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;  // 从正上方起

  // 1) 同心网格
  for (let g = 1; g <= 4; g++) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = angle(i % n), r = (R * g) / 4;
      i === 0 ? ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
              : ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.strokeStyle = gridColor; ctx.stroke();
  }
  // 2) 轴线 + 标签（略）
  // 3) 数据面：渐变填充 + 描边
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, 'rgba(79,107,240,0.42)');
  grad.addColorStop(1, 'rgba(124,92,245,0.30)');
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const idx = i % n, a = angle(idx);
    const r = R * Math.max(Math.min((values[idx] || 0) / 100, 1), 0.02);
    i === 0 ? ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
            : ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
}
```

两个实践细节：`- Math.PI / 2` 让第 0 个顶点朝正上方（雷达图的视觉惯例）；数据面半径钳制最小 2%——零值顶点缩成一个点贴着圆心，多边形直接退化看不见。

**标签防溢出**：第 0 个标签在正上方，`textAlign='center'` 即可；但左右两侧的标签若居中对齐会超出画布——所以按角度余弦动态选择 `left/center/right`。小细节，逃过一次返工。

## 三、折线图：坐标轴换算 + 渐变面积

折线图的本体是一个纯数学函数——**数值域到像素域的线性映射**：

```js
const pad = { l: 30, r: 14, t: 14, b: 26 };
const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
const X = (i) => pad.l + (points.length === 1 ? iw / 2 : (iw * i) / (points.length - 1));
const Y = (v) => pad.t + ih - ((v - min) / (max - min)) * ih;
```

有了 `X(i)` 和 `Y(v)`，画线、画点、画面积填充都是水到渠成的循环。值得写的两笔：

**面积渐变要「向下淡出」**：`createLinearGradient(0, pad.t, 0, h - pad.b)`，顶部 rgba 25% 到底部全透明——比纯色填充高级一个档次，也就三行代码。

**x 轴标签抽样**：数据点多了标签会叠。`const step = Math.ceil(points.length / 7)`，每 step 个画一个，7 是横空间能舒服容纳的经验值。

## 四、环形图：一行 arc 的快乐

```js
ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
ctx.strokeStyle = trackColor; ctx.lineWidth = 5; ctx.stroke();          // 底环
ctx.beginPath();
ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct / 100);
ctx.strokeStyle = grad; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke();  // 数据环
```

从 `-Math.PI/2`（12 点钟方向）起画，`lineCap='round'` 给端点一个圆头——进度环的所有精致感就来自这两个决定。

## 五、与主题系统联动：CSS 变量读进 Canvas

Canvas 画的内容不跟随 CSS 主题切换（它不知道 CSS 的存在）。解法是绘制时从计算样式里读变量：

```js
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
const gridColor = cssVar('--chart-grid');
```

网格线、坐标文字全部取自 CSS 变量，暗色主题切换时 `--chart-grid` 变了，视图重渲染时图表跟着变。前提是你把主题做成了 CSS 变量系统（这个项目里恰好有），否则 Canvas 永远是主题盲区。

## 六、什么时候该放弃手写

诚实划线：手写适合**饼图/折线/雷达/环形**这类「绑定数据、样式克制」的场景。一旦需要 tooltips、图例交互、坐标轴缩放、动画补间——Chart.js 和 ECharts 的十年积累不是白给的，手写会陷入无边泥潭。判断标准一句话：**交互富起来之前，手写是知识投资；交互富起来之后，手写是自负**。

---

**https://github.com/zhengqiuyang/interview-mate** —— 求个 star ⭐。
