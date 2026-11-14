#!/usr/bin/env node
/**
 * 版本号同步：package.json 是唯一来源，sw.js 缓存名和 index.html 的 app.js?v=
 * 由本脚本写入，避免三处手工各改各的。
 *
 *   node scripts/sync-version.mjs           # 把 package.json 的版本写入下列文件
 *   node scripts/sync-version.mjs --check   # 只校验是否一致（CI 用），不一致 exit 1
 *
 * README 的 version badge 是手改的静态徽章，不在这里管。
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

const targets = [
  {
    file: 'public/sw.js',
    pattern: /const CACHE = 'interview-mate-v[^']*';/,
    expect: `const CACHE = 'interview-mate-v${version}';`,
    replacement: `const CACHE = 'interview-mate-v${version}';`,
  },
  {
    file: 'public/index.html',
    pattern: /app\.js\?v=[\w.-]+/,
    expect: `app.js?v=${version}`,
    replacement: `app.js?v=${version}`,
  },
];

const check = process.argv.includes('--check');
let dirty = false;

for (const { file, pattern, expect, replacement } of targets) {
  const full = path.join(root, file);
  const content = fs.readFileSync(full, 'utf8');
  if (content.includes(expect)) {
    console.log(`  ok   ${file} (v${version})`);
    continue;
  }
  if (check) {
    console.error(`  DIFF ${file}: 期望含 ${expect}`);
    dirty = true;
    continue;
  }
  if (!pattern.test(content)) {
    console.error(`  FAIL ${file}: 找不到版本占位（pattern 不匹配），请人工检查`);
    process.exit(1);
  }
  fs.writeFileSync(full, content.replace(pattern, replacement), 'utf8');
  console.log(`  fix  ${file} -> v${version}`);
}

if (dirty) {
  console.error('\n版本不一致：运行 `node scripts/sync-version.mjs` 修复。');
  process.exit(1);
}
console.log(check ? 'check passed' : 'sync done');
