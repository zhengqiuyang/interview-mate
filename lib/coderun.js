/**
 * 本机代码沙箱执行器（Zero Dependencies）
 *
 * 仅由 server.js 在回环地址（127.0.0.1 / localhost / ::1）请求下调用：
 *   - 支持 JavaScript (Node)、Python 3、C++17 (g++ / clang++)
 *   - 每次运行创建隔离临时目录并清理；编译与运行独立限时并截断超长输出
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const MAX_CODE_BYTES = 64 * 1024;
const MAX_STDIN_BYTES = 16 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const KILL_FLOOD_BYTES = 256 * 1024;
const COMPILE_TIMEOUT_MS = 12000;
const RUN_TIMEOUT_MS = 4000;

let cachedRuntimes = null;

function probeCommand(cmd, args, verifyFn) {
  try {
    const out = execFileSync(cmd, args, {
      timeout: 2500,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const text = String(out || '').trim().split(/\r?\n/)[0] || '';
    if (verifyFn && !verifyFn(text)) return null;
    return { ok: true, cmd, version: text.slice(0, 80) };
  } catch (e) {
    // 某些编译器将版本打印在 stderr，且 exit === 0 时不会抛出；非 0（含 WinStore 假 python3）直接拒绝
    if (e && e.status === 0) {
      const text = String(e.stdout || e.stderr || '').trim().split(/\r?\n/)[0] || '';
      if (!verifyFn || verifyFn(text)) return { ok: true, cmd, version: text.slice(0, 80) };
    }
    return null;
  }
}

function detectRuntimes(force = false) {
  if (cachedRuntimes && !force) return cachedRuntimes;

  const javascript = {
    ok: true,
    cmd: process.execPath,
    version: `Node ${process.version}`,
  };

  const pyCandidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  let python = { ok: false };
  for (const cmd of pyCandidates) {
    const hit = probeCommand(cmd, ['--version'], (v) => /^Python\s+\d/i.test(v));
    if (hit) { python = hit; break; }
  }

  let cpp = { ok: false };
  for (const cmd of ['g++', 'clang++']) {
    const hit = probeCommand(cmd, ['--version'], (v) => v.length > 0);
    if (hit) { cpp = hit; break; }
  }

  cachedRuntimes = { javascript, python, cpp };
  return cachedRuntimes;
}

function execStep(cmd, args, { cwd, timeout, input = '', env = process.env }) {
  return new Promise((resolve) => {
    const start = Date.now();
    const outChunks = [];
    const errChunks = [];
    let outLen = 0;
    let errLen = 0;
    let totalBytes = 0;
    let truncated = false;
    let timedOut = false;
    let finished = false;

    let proc;
    try {
      proc = spawn(cmd, args, { cwd, env, windowsHide: true });
    } catch (e) {
      resolve({
        exitCode: 1,
        timedOut: false,
        truncated: false,
        stdout: '',
        stderr: e.message || String(e),
        durationMs: Date.now() - start,
      });
      return;
    }

    const done = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        exitCode: code === null ? 1 : code,
        timedOut,
        truncated,
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
        durationMs: Date.now() - start,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGKILL'); } catch (_) {
        try { proc.kill(); } catch (_) { /* ignore */ }
      }
    }, timeout);

    const pushChunk = (buf, chunks, curLen) => {
      totalBytes += buf.length;
      if (totalBytes > KILL_FLOOD_BYTES) {
        truncated = true;
        try { proc.kill('SIGKILL'); } catch (_) {
          try { proc.kill(); } catch (_) { /* ignore */ }
        }
        return curLen;
      }
      if (curLen >= MAX_OUTPUT_BYTES) {
        truncated = true;
        return curLen;
      }
      const room = MAX_OUTPUT_BYTES - curLen;
      if (buf.length > room) {
        chunks.push(buf.subarray(0, room));
        truncated = true;
        return MAX_OUTPUT_BYTES;
      }
      chunks.push(buf);
      return curLen + buf.length;
    };

    proc.stdout.on('data', (c) => { outLen = pushChunk(c, outChunks, outLen); });
    proc.stderr.on('data', (c) => { errLen = pushChunk(c, errChunks, errLen); });
    proc.on('error', (e) => {
      errChunks.push(Buffer.from(e.message || String(e)));
      done(1);
    });
    proc.on('close', (code) => done(code));

    try {
      proc.stdin.on('error', () => { /* ignore EPIPE */ });
      if (input) proc.stdin.write(input);
      proc.stdin.end();
    } catch (_) { /* ignore */ }
  });
}

async function runLocalCode({ lang, code, stdin = '' } = {}) {
  const cleanLang = String(lang || '').trim().toLowerCase();
  if (!['javascript', 'python', 'cpp'].includes(cleanLang)) {
    throw new Error(`不支持的语言：${cleanLang || '(空)'}`);
  }
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('代码不能为空');
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
    throw new Error('代码体积超过 64KB 上限');
  }
  const cleanInput = typeof stdin === 'string' ? stdin.slice(0, MAX_STDIN_BYTES) : '';

  const rt = detectRuntimes();
  if (!rt[cleanLang] || !rt[cleanLang].ok) {
    const tips = {
      python: '未检测到本机 Python 运行时（请安装 Python 3 并加入 PATH）',
      cpp: '未检测到本机 C++ 编译器（请安装 g++ 或 clang++ 并加入 PATH）',
    };
    return {
      ok: false,
      lang: cleanLang,
      stage: 'env',
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr: tips[cleanLang] || '运行时不可用',
      durationMs: 0,
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-codelab-'));
  try {
    if (cleanLang === 'javascript') {
      const file = path.join(tmpDir, 'main.js');
      fs.writeFileSync(file, code, 'utf8');
      const r = await execStep(rt.javascript.cmd, [file], {
        cwd: tmpDir,
        timeout: RUN_TIMEOUT_MS,
        input: cleanInput,
      });
      return {
        ok: !r.timedOut && r.exitCode === 0,
        lang: cleanLang,
        stage: 'run',
        ...r,
        stderr: r.timedOut ? (r.stderr ? r.stderr + '\n' : '') + '运行超时（>4s），已强制终止' : r.stderr,
      };
    }

    if (cleanLang === 'python') {
      const file = path.join(tmpDir, 'main.py');
      fs.writeFileSync(file, code, 'utf8');
      const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
      const r = await execStep(rt.python.cmd, [file], {
        cwd: tmpDir,
        timeout: RUN_TIMEOUT_MS,
        input: cleanInput,
        env,
      });
      return {
        ok: !r.timedOut && r.exitCode === 0,
        lang: cleanLang,
        stage: 'run',
        ...r,
        stderr: r.timedOut ? (r.stderr ? r.stderr + '\n' : '') + '运行超时（>4s），已强制终止' : r.stderr,
      };
    }

    // C++17: 先编译，通过再运行
    const srcFile = path.join(tmpDir, 'main.cpp');
    const binName = process.platform === 'win32' ? 'main.exe' : 'main';
    const binFile = path.join(tmpDir, binName);
    fs.writeFileSync(srcFile, code, 'utf8');

    const compileArgs = ['-std=c++17', '-O2', srcFile, '-o', binFile];
    if (process.platform !== 'win32') compileArgs.push('-pthread');

    const cr = await execStep(rt.cpp.cmd, compileArgs, {
      cwd: tmpDir,
      timeout: COMPILE_TIMEOUT_MS,
    });
    if (cr.timedOut || cr.exitCode !== 0) {
      return {
        ok: false,
        lang: cleanLang,
        stage: 'compile',
        exitCode: cr.exitCode,
        timedOut: cr.timedOut,
        truncated: cr.truncated,
        stdout: cr.stdout,
        stderr: cr.timedOut ? '编译超时（>12s）' : (cr.stderr || cr.stdout || '编译失败'),
        durationMs: cr.durationMs,
      };
    }

    const rr = await execStep(binFile, [], {
      cwd: tmpDir,
      timeout: RUN_TIMEOUT_MS,
      input: cleanInput,
    });
    return {
      ok: !rr.timedOut && rr.exitCode === 0,
      lang: cleanLang,
      stage: 'run',
      ...rr,
      durationMs: cr.durationMs + rr.durationMs,
      stderr: rr.timedOut ? (rr.stderr ? rr.stderr + '\n' : '') + '运行超时（>4s），已强制终止' : rr.stderr,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) { /* ignore cleanup error */ }
  }
}

module.exports = { detectRuntimes, runLocalCode };
