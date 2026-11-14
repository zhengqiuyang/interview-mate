/* 间隔重复引擎（Leitner 简化版）行为测试。
 * srs.js 是浏览器 ESM，但依赖的 state/core 在 Node 下走内存 fallback（store 有
 * localStorage 守卫），可直接 import，无需 DOM。
 * Node 18 无法把 .js 里的 ESM 语法按模块加载（detect-module 需要 ≥20），
 * 因此本文件在 node < 20 上整体跳过——服务端行为由 server/jobs 测试覆盖。 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const DAY = 24 * 3600 * 1000;
const MIN = 60 * 1000;
const [NODE_MAJOR] = process.versions.node.split('.').map(Number);
const SKIP = NODE_MAJOR < 20
  ? 'node 18 无法加载 .js 中的 ESM 语法（detect-module 需要 ≥20）'
  : false;

describe('srs（间隔重复引擎）', { skip: SKIP }, () => {
  let S;
  let dateKey;
  let BOX_INTERVALS;
  let grade;
  let getCard;
  let isMastered;
  let dueList;
  let learningList;
  let markActivity;
  let streakDays;
  let masteryStats;

  before(async () => {
    ({ S } = await import('../public/js/state.js'));
    ({ dateKey } = await import('../public/js/core.js'));
    ({
      BOX_INTERVALS, grade, getCard, isMastered, dueList,
      learningList, markActivity, streakDays, masteryStats,
    } = await import('../public/js/srs.js'));
  });

  beforeEach(() => {
    S.srs = {};
    S.questions = [];
    S.activity = {};
  });

  test('盒子间隔表：0=10min 1=1天 2=3天 3=7天 4=21天', () => {
    assert.deepEqual(BOX_INTERVALS, [10 * MIN, DAY, 3 * DAY, 7 * DAY, 21 * DAY]);
  });

  test('「不会」(g=0) → 落回 box0、lapses+1、10 分钟后到期', () => {
    grade('q1', 2);          // 先升到 box1
    const c = grade('q1', 0); // 再答不会
    assert.equal(c.box, 0);
    assert.equal(c.reps, 2);
    assert.equal(c.lapses, 1);
    const left = c.due - Date.now();
    assert.ok(left > 10 * MIN - 5000 && left <= 10 * MIN + 1000, `due 偏差过大: ${left}ms`);
  });

  test('「模糊」(g=1) → 至少 box1、1 天后到期', () => {
    const c = grade('q1', 1);
    assert.equal(c.box, 1);
    const left = c.due - Date.now();
    assert.ok(left > DAY - 5000 && left <= DAY + 1000, `due 偏差过大: ${left}ms`);
  });

  test('「掌握」(g=2) → 逐级升级，box3 → 7 天、box4 封顶 → 21 天', () => {
    let c = { box: -1, due: 0, reps: 0, lapses: 0, last: 0 };
    const boxes = [];
    for (let i = 0; i < 5; i++) {
      c = grade('q1', 2);
      boxes.push(c.box);
    }
    assert.deepEqual(boxes, [1, 2, 3, 4, 4]); // box4 封顶
    assert.ok(c.due - Date.now() > 21 * DAY - 5000, '封顶后应 21 天后到期');
  });

  test('掌握定义：box >= 3', () => {
    grade('q1', 2); grade('q1', 2);
    assert.equal(isMastered('q1'), false); // box2
    grade('q1', 2);
    assert.equal(isMastered('q1'), true); // box3
    assert.equal(isMastered('q404'), false); // 没答过的题
  });

  test('dueList 只列 box<4 且已到期且题库中存在的卡', () => {
    S.questions = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }];
    const now = Date.now();
    S.srs = {
      q1: { box: 1, due: now - 1000, reps: 1, lapses: 0, last: now },   // 到期 → 收
      q2: { box: 4, due: now - 9999, reps: 5, lapses: 0, last: now },   // box4 → 不收
      q3: { box: 2, due: now + 99999, reps: 2, lapses: 0, last: now },  // 未到期 → 不收
      q9: { box: 0, due: now - 1, reps: 1, lapses: 0, last: now },      // 题库外 → 不收
    };
    assert.deepEqual(dueList(), ['q1']);
    assert.deepEqual(learningList(), ['q1', 'q3']); // 0 < box < 3
  });

  test('markActivity 累计当天次数；streakDays 连续天数从昨天/今天起算', () => {
    markActivity();
    markActivity(3);
    const today = dateKey();
    assert.equal(S.activity[today], 4);
    assert.equal(streakDays(), 1);

    const yesterday = dateKey(new Date(Date.now() - DAY));
    S.activity[yesterday] = 1;
    assert.equal(streakDays(), 2); // 昨天 + 今天
  });

  test('streakDays：今天没练不打断，只看昨天往回数', () => {
    const yesterday = dateKey(new Date(Date.now() - DAY));
    S.activity[yesterday] = 1;
    assert.equal(streakDays(), 1); // 今天没练不算断
    const before = dateKey(new Date(Date.now() - 2 * DAY));
    S.activity[before] = 1;
    assert.equal(streakDays(), 2);
  });

  test('masteryStats 基于题库统计掌握比例', () => {
    S.questions = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }];
    grade('q1', 2); grade('q1', 2); grade('q1', 2); // q1 掌握
    grade('q2', 2);                                  // q2 box1 未掌握
    const ms = masteryStats();
    assert.equal(ms.total, 3);
    assert.equal(ms.mastered, 1);
    assert.equal(ms.seen, 2);
    assert.equal(ms.pct, 33);
  });

  test('grade 返回同一张卡的最新状态（getCard 同步）', () => {
    grade('q1', 2);
    assert.equal(getCard('q1').box, 1);
    grade('q1', 2);
    assert.equal(getCard('q1').box, 2);
    assert.equal(getCard('nope'), null);
  });
});
