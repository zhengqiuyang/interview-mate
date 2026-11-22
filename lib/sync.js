/**
 * 本机用户学习状态持久化同步（突破浏览器 localStorage 容量与清缓存风险）
 *
 * 读取 DATA_DIR/user-state.json（默认仓库 data/user-state.json，已 gitignore）；
 * 仅接受 im_* 命名空间键名，采用临时文件 + rename 原子落盘。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_STATE_BYTES = 2 * 1024 * 1024;
const KEY_RE = /^im_[a-z0-9_]{1,40}$/;

function getStateFile() {
  const dir = process.env.INTERVIEW_MATE_DATA_DIR || path.join(__dirname, '..', 'data');
  return path.join(dir, 'user-state.json');
}

function readState() {
  const file = getStateFile();
  if (!fs.existsSync(file)) {
    return { exists: false, updatedAt: 0, data: {} };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || typeof raw.data !== 'object' || raw.data === null) {
      return { exists: false, updatedAt: 0, data: {}, corrupt: true };
    }
    const clean = {};
    for (const [k, v] of Object.entries(raw.data)) {
      if (KEY_RE.test(k) && v !== undefined && v !== null) clean[k] = v;
    }
    return {
      exists: Object.keys(clean).length > 0,
      updatedAt: Number(raw.updatedAt) || 0,
      data: clean,
    };
  } catch (_) {
    return { exists: false, updatedAt: 0, data: {}, corrupt: true };
  }
}

function writeState(payload) {
  if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
    throw new Error('无效的状态负载：缺少 data 对象');
  }
  const clean = {};
  for (const [k, v] of Object.entries(payload.data)) {
    if (!KEY_RE.test(k)) continue;
    if (v === undefined || v === null) continue;
    clean[k] = v;
  }

  const updatedAt = Date.now();
  const content = JSON.stringify({ app: 'interview-mate', version: 1, updatedAt, data: clean }, null, 2);
  if (Buffer.byteLength(content, 'utf8') > MAX_STATE_BYTES) {
    throw new Error('同步状态体积超过 2MB 上限');
  }

  const file = getStateFile();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (_) {
    // Windows 偶发独占重命名回退覆盖写入并清理临时文件
    fs.writeFileSync(file, content, 'utf8');
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
  return { ok: true, updatedAt, keys: Object.keys(clean).length };
}

module.exports = { getStateFile, readState, writeState };
