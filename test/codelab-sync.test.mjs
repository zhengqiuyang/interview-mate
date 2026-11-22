/* Code Lab 沙箱执行、本机磁盘状态同步与服务端回环安全边界测试 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coderun = require('../lib/coderun.js');
const sync = require('../lib/sync.js');

const [NODE_MAJOR] = process.versions.node.split('.').map(Number);
const SKIP_ESM = NODE_MAJOR < 20
  ? 'node 18 无法加载 .js 中的 ESM 语法（detect-module 需要 ≥20）'
  : false;

function startTempServer(extraEnv = {}) {
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'im-sync-srv-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: '0',
      INTERVIEW_MATE_DATA_DIR: tmpData,
      INTERVIEW_MATE_JOB_REFRESH_MIN: '0',
      INTERVIEW_MATE_BRIEF_CHECK_MIN: '0',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server 启动超时')), 10000);
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/已启动: http:\/\/[\d.]+:(\d+)/);
      if (m) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => { buf += d.toString(); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server 提前退出 code=${code}\n${buf}`));
    });
  });

  const stop = () => {
    try { child.kill(); } catch (_) { /* ignore */ }
    try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  };

  return { ready, stop, tmpData };
}

describe('coderun（本机代码沙箱执行）', () => {
  test('detectRuntimes：Node/JavaScript 必然可用，C++/Python 按本机真实环境探测', () => {
    const rt = coderun.detectRuntimes(true);
    assert.equal(rt.javascript.ok, true);
    assert.equal(typeof rt.python.ok, 'boolean');
    assert.equal(typeof rt.cpp.ok, 'boolean');
  });

  test('JavaScript 正常输出与死循环 4s 超时强制终止', async () => {
    const okRes = await coderun.runLocalCode({
      lang: 'javascript',
      code: 'console.log(2 + 40);',
    });
    assert.equal(okRes.ok, true);
    assert.equal(okRes.stdout.trim(), '42');

    const timeoutRes = await coderun.runLocalCode({
      lang: 'javascript',
      code: 'while (true) {}',
    });
    assert.equal(timeoutRes.ok, false);
    assert.equal(timeoutRes.timedOut, true);
  });

  test('C++17 编译运行与编译报错拦截（若本机存在 g++/clang++）', async (t) => {
    const rt = coderun.detectRuntimes();
    if (!rt.cpp.ok) { t.skip('未检测到 g++/clang++'); return; }

    const okRes = await coderun.runLocalCode({
      lang: 'cpp',
      code: '#include <iostream>\nint main(){ std::cout << "cpp17_ok\\n"; return 0; }',
    });
    assert.equal(okRes.ok, true);
    assert.equal(okRes.stdout.trim(), 'cpp17_ok');

    const badRes = await coderun.runLocalCode({
      lang: 'cpp',
      code: 'int main() { syntax_error_here }',
    });
    assert.equal(badRes.ok, false);
    assert.equal(badRes.stage, 'compile');
  });

  test('Python 3 执行验证（若本机存在 Python 3）', async (t) => {
    const rt = coderun.detectRuntimes();
    if (!rt.python.ok) { t.skip('未检测到 Python 3'); return; }

    const okRes = await coderun.runLocalCode({
      lang: 'python',
      code: 'print(sum([1, 2, 3, 4]))',
    });
    assert.equal(okRes.ok, true);
    assert.equal(okRes.stdout.trim(), '10');
  });
});

describe('sync（本机磁盘原子同步）', () => {
  test('readState/writeState 只保留合法 im_* 键且正确往返', () => {
    const prev = process.env.INTERVIEW_MATE_DATA_DIR;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'im-sync-unit-'));
    process.env.INTERVIEW_MATE_DATA_DIR = tmp;
    try {
      const empty = sync.readState();
      assert.equal(empty.exists, false);

      const wr = sync.writeState({
        data: {
          im_srs: '{"net-1":{"box":4}}',
          im_notes: '{"net-1":"笔记"}',
          evil_arbitrary_key: 'should_drop',
        },
      });
      assert.equal(wr.ok, true);
      assert.equal(wr.keys, 2);

      const rd = sync.readState();
      assert.equal(rd.exists, true);
      assert.equal(rd.data.im_srs, '{"net-1":{"box":4}}');
      assert.equal(rd.data.im_notes, '{"net-1":"笔记"}');
      assert.equal(rd.data.evil_arbitrary_key, undefined);
    } finally {
      if (prev === undefined) delete process.env.INTERVIEW_MATE_DATA_DIR;
      else process.env.INTERVIEW_MATE_DATA_DIR = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('server（Code Lab 回环限定与 Sync API）', () => {
  test('Loopback 模式放行 /api/code/run 与 /api/sync/state 读写', async () => {
    const srv = startTempServer({ HOST: '127.0.0.1' });
    try {
      const base = await srv.ready;
      const rt = await (await fetch(`${base}/api/code/runtimes`)).json();
      assert.equal(rt.javascript.ok, true);
      assert.equal(rt.localExecAllowed, true);

      const runRes = await (await fetch(`${base}/api/code/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: 'javascript', code: 'console.log("ok_loopback");' }),
      })).json();
      assert.equal(runRes.ok, true);
      assert.equal(runRes.stdout.trim(), 'ok_loopback');

      const putRes = await (await fetch(`${base}/api/sync/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { im_srs: '{"demo":true}' } }),
      })).json();
      assert.equal(putRes.ok, true);

      const getRes = await (await fetch(`${base}/api/sync/state`)).json();
      assert.equal(getRes.exists, true);
      assert.equal(getRes.data.im_srs, '{"demo":true}');
    } finally {
      srv.stop();
    }
  });

  test('LAN 模式（HOST=0.0.0.0）严禁暴露远程代码执行：/api/code/run 返回 403', async () => {
    const srv = startTempServer({ HOST: '0.0.0.0' });
    try {
      const base = await srv.ready;
      const rt = await (await fetch(`${base}/api/code/runtimes`)).json();
      assert.equal(rt.localExecAllowed, false);

      const res = await fetch(`${base}/api/code/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: 'javascript', code: 'console.log(1);' }),
      });
      assert.equal(res.status, 403);
    } finally {
      srv.stop();
    }
  });
});

describe('codelab-cases（预置多语言演练用例与 C++ 可编译检查）', { skip: SKIP_ESM }, () => {
  test('至少 15 道手写题具备完整 starter 与测试驱动', async () => {
    const mod = await import('../public/js/codelab-cases.js');
    const keys = Object.keys(mod.CODELAB_CASES);
    assert.ok(keys.length >= 15, `期望 ≥15 道预置题，实际 ${keys.length}`);
    for (const id of keys) {
      const entry = mod.CODELAB_CASES[id];
      const langs = ['javascript', 'python', 'cpp'].filter((l) => entry[l]);
      assert.ok(langs.length >= 1, `${id} 至少应包含一种语言模板`);
      for (const l of langs) {
        assert.ok(entry[l].starter.length > 10, `${id}:${l} starter 过短`);
        assert.ok(entry[l].harness.length > 20, `${id}:${l} harness 过短`);
        const combined = mod.buildRunnableSource(id, l, entry[l].starter);
        assert.ok(combined.includes(entry[l].starter) && combined.includes(entry[l].harness));
      }
    }
    assert.equal(mod.hasTestHarness('code-1', 'javascript'), true);
    assert.equal(mod.defaultLangForQuestion({ id: 'code-1', a: 'js' }), 'javascript');
  });

  test('code-13..16 C++ starter + harness 可真实编译运行并通过（若本机有 g++）', async (t) => {
    const rt = coderun.detectRuntimes();
    if (!rt.cpp.ok) { t.skip('未检测到 g++/clang++'); return; }
    const mod = await import('../public/js/codelab-cases.js');
    for (const id of ['code-13', 'code-14', 'code-15', 'code-16']) {
      const spec = mod.CODELAB_CASES[id].cpp;
      const src = mod.buildRunnableSource(id, 'cpp', spec.starter);
      const res = await coderun.runLocalCode({ lang: 'cpp', code: src });
      assert.equal(res.ok, true, `${id} C++ 编译运行失败:\n${res.stderr}\n${res.stdout}`);
      assert.ok(res.stdout.includes('PASSED'), `${id} 未输出 PASSED`);
    }
  });
});
