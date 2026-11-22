/**
 * 最小 DOM stub：让 gamify.js 的 awardXP/toast/confetti 等浏览器路径
 * 能在 node:test 里跑通。只保证「调用不炸 + 可断言状态」，不模拟真实渲染。
 *
 * 用法：必须在动态 import gamify.js 之前调用 installFakeDom()
 * （gamify → core/state/srs 的模块顶层代码本身无需 DOM，这里防的是调用路径）。
 */
export function installFakeDom() {
  const makeEl = (tag = 'div') => ({
    tagName: String(tag).toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    className: '',
    innerHTML: '',
    textContent: '',
    classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false; },
    },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    focus() {},
    click() {},
    closest() { return null; },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    getContext() {
      // canvas 2d：任意方法调用都是 no-op，属性赋值静默成功
      return new Proxy({}, {
        get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : () => {}),
        set: () => true,
      });
    },
    get lastElementChild() { return { textContent: '' }; },
  });

  globalThis.document = {
    createElement: (tag) => makeEl(tag),
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    // getElementById 返回 null → renderLevelChip 等直接早退，符合「不渲染」语义
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
    documentElement: makeEl('html'),
    body: makeEl('body'),
  };
  // confetti 用到的全局量：给一帧就停的动画环境
  globalThis.devicePixelRatio = 1;
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 800;
  globalThis.requestAnimationFrame = () => 0; // 不推进帧，confetti 首帧后自然停
}
