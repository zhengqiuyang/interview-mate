# 间隔重复的参数设计：五个盒子的间隔怎么定、什么叫「掌握」

> 系列第 28 篇（C 线·产品与算法设计之一）。Anki 的 FSRS 算法有六个参数和一篇论文；这个项目用的是它的曾祖父——Leitner 盒子。但「简化版」不等于「拍脑袋版」：这篇讲每个参数背后的取舍。
> 仓库：https://github.com/zhengqiuyang/interview-mate

## 一、算法本体：十行的 Leitner

```js
const BOX_INTERVALS = [10 * 60 * 1000, DAY, 3 * DAY, 7 * DAY, 21 * DAY];

// 评分：0=不会 1=模糊 2=掌握
export function grade(qid, g) {
  const now = Date.now();
  const c = S.srs[qid] || { box: 0, due: 0, reps: 0, lapses: 0, last: 0 };
  c.reps += 1;
  c.last = now;
  if (g === 0) { c.box = 0; c.lapses += 1; }        // 不会 → 打回原点
  else if (g === 1) { c.box = Math.max(1, c.box); } // 模糊 → 原地踏步
  else { c.box = Math.min(4, c.box + 1); }          // 掌握 → 升一级
  c.due = now + BOX_INTERVALS[c.box];
  S.srs[qid] = c;
  store.set('im_srs', S.srs);
  return c;
}
```

每题一张卡 `{box, due, reps, lapses, last}`，评分驱动盒子升降，到期时间由盒子查表。就这么多——**产品里最值钱的算法往往是最简单的那个**，前提是每个参数都答得出「为什么」。

## 二、间隔序列：10 分钟 → 1 → 3 → 7 → 21 天

这是全算法最需要辩护的参数。Anki 默认间隔大约是 1 → 3 → 7 → 15+ 天，我们前面加了个 10 分钟，依据是使用场景：

**面试准备是「冲刺型」记忆，不是「终身型」记忆**。用户的目标周期是 2-6 周，不是把知识保存十年。所以间隔序列整体压缩：box0 的 10 分钟意味着「刚才答错的题，这场刷题结束前再见到它」——这不是记忆曲线，是**即时纠错**。短期冲刺里，答错后 10 分钟重见的效果远好于明天再见。

1 → 3 → 7 大致沿着艾宾浩斯遗忘曲线的复习点；21 天封顶（而不是 Anki 式的数月数年）是因为：三周后再见一道题，对面试而言已经足够「长期」，继续拉长间隔只为了让统计好看。

**模糊的原地踏步**（`Math.max(1, c.box)`）是个微妙设计：答「模糊」不降级、不升级，但把 due 重置为当前盒子间隔。语义是「你还没忘，但也不牢，同样的间隔再考一次」。降级（回到上一盒）试过，体感很差——「明明会说只是不流利，凭什么退回去」。

## 三、「掌握」的定义：box ≥ 3

`isMastered = box >= 3`（即 7 天间隔或更高）。为什么不是 4（顶格）？

因为**「掌握」是个用户可见的产品概念**（掌握率、雷达图、成就），它需要诚实地早到而不是苛刻地迟到。box3 的语义是「连续答对三次，已经撑过一周」——这满足用户对「我会了」的预期。box4 留给「三周还能答对」，那是压舱石，不必拿出来炫耀。

反面教训：早期版本把 box4 才算掌握，用户刷了三十题掌握率还是 0%，直接挫败。**进度系统的数字要在诚实和激励之间取平衡**，纯算法视角选不出这个阈值。

## 四、挂科权重与错题本

`lapses` 字段只增不减，即使后来升到 box4 也保留历史。错题本按挂科次数排序：

```js
export function wrongList() {
  return Object.entries(S.srs)
    .filter(([, c]) => c.lapses > 0 && c.box < 3)   // 挂过且未掌握
    .sort((a, b) => b[1].lapses - a[1].lapses)
    .map(([qid]) => qid);
}
```

注意过滤条件是 `lapses > 0 && box < 3`——挂过但已掌握的题**移出错题本**。要不要保留历史是产品抉择：保留显得「记仇」，清除显得「宽容」。对面试训练，「曾经的错」已经转化为画像（另一个系统），错题本只装当前债务。

## 五、streak 的从宽裁定

```js
export function streakDays() {
  let streak = 0;
  const d = new Date();
  // 今天还没练不打断连续（从昨天起算）
  if (!S.activity[dateKey(d)]) d.setDate(d.getDate() - 1);
  for (;;) {
    if (S.activity[dateKey(d)]) { streak += 1; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}
```

今天还没打卡不算断（从昨天倒推）——Duolingo 式的宽容。严格的版本（今天必须练才不断）会让用户在深夜 23:50 焦虑补卡，**打卡机制的目标是形成习惯，不是制造焦虑**。少这一行，卸载率会替你补上教训。

## 六、每日挑战的确定性选题

```js
export function dailyQuestion() {
  const rnd = seededRandom(dateKey());   // 以日期字符串为种子
  return S.questions[Math.floor(rnd() * S.questions.length)];
}
```

同一个种子永远产出同一道题——**今天全世界的用户（好吧，是你所有的设备）看到的是同一道「今日挑战」**。确定性选题让「每日一题」有了仪式感，还顺便解决了多端一致的小问题。seededRandom 用的是 xorshift，五行搞定，不值得引入任何库。

## 七、与 Anki 的差距，及为什么够用

| | Leitner（本实现） | FSRS（Anki 4代） |
| --- | --- | --- |
| 参数 | 5 个固定间隔 | 6 个按个人记忆史拟合 |
| 输入 | 三档自评 | 四档自评 |
| 适应性 | 无 | 根据遗忘记录动态调间隔 |

差距真实存在：重度用户（上千卡、数月周期）会感受到 Leitner 的间隔不够贴合。但面试场景的用户画像是「几十到几百题、几周周期」——**在低样本量下，FSRS 拟合不出优势，Leitner 的可解释性反而成了体验**（用户能理解「连对三次+一周后再见=掌握」）。算法选型的第一问不是「哪个更强」，是「哪个的适用条件和你一致」。

---

**https://github.com/zhengqiuyang/interview-mate** —— 求个 star ⭐。
