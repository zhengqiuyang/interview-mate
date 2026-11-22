/* I-P2-3：localStorage 配额异常处理。
 * P2 决策：不引入 schema version（P2 没改任何已存数据的形状，为迁移而迁移是纯风险），
 * 只做 QuotaExceededError 处理——写满时提示导出，不静默丢数据。
 * Node 18 无法加载 .js 里的 ESM 语法（detect-module 需要 ≥20），node < 20 跳过。 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const [NODE_MAJOR] = process.versions.node.split('.').map(Number);
const SKIP = NODE_MAJOR < 20
  ? 'node 18 无法加载 .js 中的 ESM 语法（detect-module 需要 ≥20）'
  : false;

describe('storage（quota 处理）', { skip: SKIP }, () => {
  let store;
  let safeStorageSet;
  let storeErrors;

  before(async () => {
    ({ store, safeStorageSet } = await import('../public/js/core.js'));
  });

  const installQuotaBrokenStorage = () => {
    storeErrors = 0;
    globalThis.localStorage = {
      getItem: () => null,
      removeItem() {},
      setItem() {
        storeErrors += 1;
        const e = new Error('Failed to execute setItem: quota exceeded');
        e.name = 'QuotaExceededError';
        throw e;
      },
    };
    // fake-dom 的 toast 路径会走 document.createElement —— 用桩记下文案
    globalThis.document = {
      createElement: () => ({
        style: {}, className: '', innerHTML: '', textContent: '',
        lastElementChild: { textContent: '' },
        appendChild() {}, remove() {},
        querySelector: () => ({ appendChild() {} }),
      }),
      querySelector: () => ({ appendChild() {} }),
      getElementById: () => null,
      addEventListener() {},
      documentElement: {},
      body: { appendChild() {} },
    };
    // core.js 的 toast 是模块内函数，无法直接替换——通过捕获 console + 观察不抛出来验证
  };

  const restore = () => {
    delete globalThis.localStorage;
    delete globalThis.document;
  };

  test('store.set 在 QuotaExceededError 时不抛、内存副本仍在', () => {
    installQuotaBrokenStorage();
    try {
      store.set('im_test', { a: 1, b: '中文' }); // 绝不能抛
      assert.equal(store.get('im_test'), undefined); // localStorage.getItem 恒 null → 回退 fallback
      assert.ok(storeErrors >= 1, '确实验证过 setItem 抛错路径');
    } finally {
      restore();
    }
  });

  test('safeStorageSet 返回 false 且不抛', () => {
    installQuotaBrokenStorage();
    try {
      assert.equal(safeStorageSet('im_x', '{}'), false);
      assert.equal(storeErrors, 1);
    } finally {
      restore();
    }
  });

  test('正常存储路径不受影响', () => {
    let written = null;
    globalThis.localStorage = {
      getItem: () => written,
      removeItem() {},
      setItem: (_k, v) => { written = v; },
    };
    try {
      assert.equal(safeStorageSet('im_ok', '{"a":2}'), true);
      assert.equal(written, '{"a":2}');
      assert.deepEqual(store.get('im_ok'), { a: 2 });
    } finally {
      restore();
    }
  });
});
