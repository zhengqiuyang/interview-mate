/* 游戏化引擎测试：等级边界 / XP 累计 / 成就触发。
 * awardXP 会走 toast/confetti 等 DOM 路径，先装 fake DOM 再动态 import。
 * Node 18 无法加载 .js 里的 ESM 语法（detect-module 需要 ≥20），node < 20 跳过。 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installFakeDom } from './helpers/fake-dom.mjs';
installFakeDom();

const [NODE_MAJOR] = process.versions.node.split('.').map(Number);
const SKIP = NODE_MAJOR < 20
  ? 'node 18 无法加载 .js 中的 ESM 语法（detect-module 需要 ≥20）'
  : false;

describe('gamify（游戏化引擎）', { skip: SKIP }, () => {
  let S;
  let levelInfo;
  let awardXP;
  let LEVELS;
  let ACHIEVEMENTS;

  before(async () => {
    ({ S } = await import('../public/js/state.js'));
    ({ levelInfo, awardXP, LEVELS, ACHIEVEMENTS } = await import('../public/js/gamify.js'));
  });

  beforeEach(() => {
    S.gamify = { xp: 0, unlocked: [] };
    S.sessions = [];
    S.questions = [];
    S.srs = {};
    S.knowledge = [];
    S.apps = [];
    S.daily = {};
  });

  test('LEVELS 阈值严格递增，共 7 级', () => {
    assert.equal(LEVELS.length, 7);
    for (let i = 1; i < LEVELS.length; i++) {
      assert.ok(LEVELS[i].xp > LEVELS[i - 1].xp, `Lv.${i + 1} 阈值必须大于 Lv.${i}`);
    }
  });

  test('等级边界：0/99=Lv1，100=Lv2，300=Lv3，700=Lv4，1500=Lv5，3000=Lv6，6000=Lv7', () => {
    const cases = [[0, 1], [99, 1], [100, 2], [299, 2], [300, 3], [699, 3], [700, 4],
      [1499, 4], [1500, 5], [2999, 5], [3000, 6], [5999, 6], [6000, 7], [999999, 7]];
    for (const [xp, expected] of cases) {
      assert.equal(levelInfo(xp).level, expected, `xp=${xp} 应为 Lv.${expected}`);
    }
  });

  test('levelInfo 进度百分比与下一级指针', () => {
    const l1 = levelInfo(50); // Lv1 → Lv2 差 100
    assert.equal(l1.pct, 50);
    assert.equal(l1.next.xp, 100);
    const top = levelInfo(100000); // 满级
    assert.equal(top.level, 7);
    assert.equal(top.next, null);
    assert.equal(top.pct, 100);
  });

  test('awardXP 累计 XP', () => {
    awardXP(30);
    awardXP(70);
    assert.equal(S.gamify.xp, 100);
  });

  test('awardXP 跨过阈值会升级（xp 从 90 + 20 → 110 → Lv2）', () => {
    S.gamify = { xp: 90, unlocked: [] };
    awardXP(20);
    assert.equal(S.gamify.xp, 110);
    assert.equal(levelInfo(S.gamify.xp).level, 2);
  });

  test('成就触发：完成模拟面试 → first_mock + score_80，各 +20 XP', () => {
    S.sessions = [{ kind: 'mock', score: 85 }];
    awardXP(0); // 0 XP 也应触发成就检查
    assert.ok(S.gamify.unlocked.includes('first_mock'));
    assert.ok(S.gamify.unlocked.includes('score_80'));
    assert.equal(S.gamify.xp, 40); // 0 + 20 + 20
    assert.ok(!S.gamify.unlocked.includes('score_90'), '85 分不应解锁 90 分成就');
  });

  test('成就不重复触发：两次 awardXP 不会给两次 first_mock', () => {
    S.sessions = [{ kind: 'mock', score: 85 }];
    awardXP(0);
    awardXP(0);
    const count = S.gamify.unlocked.filter((id) => id === 'first_mock').length;
    assert.equal(count, 1);
    assert.equal(S.gamify.xp, 40);
  });

  test('成就触发：连续打卡 / 掌握 / offer 状态', () => {
    const today = '2026-11-14';
    S.daily = { [today]: 1, '2026-11-13': 1, '2026-11-12': 1 }; // daily_7 不满足（3 天）
    S.apps = [{ status: 'offer' }];
    S.questions = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}` }));
    for (let i = 0; i < 10; i++) S.srs[`q${i}`] = { box: 3, due: 0, reps: 3, lapses: 0, last: 0 };
    awardXP(0);
    assert.ok(S.gamify.unlocked.includes('got_offer'), 'offer 状态应解锁上岸成就');
    assert.ok(S.gamify.unlocked.includes('mastered_10'), '掌握 10 题应解锁');
    assert.ok(!S.gamify.unlocked.includes('daily_7'), '3 天不满足 7 天挑战');
  });

  test('达到 Lv.5 解锁 level_5 成就', () => {
    S.gamify = { xp: 1490, unlocked: [] };
    awardXP(10); // → 1500 = Lv.5，再 +20 成就分
    assert.ok(S.gamify.unlocked.includes('level_5'));
    assert.equal(S.gamify.xp, 1520);
  });

  test('ACHIEVEMENTS id 唯一', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
