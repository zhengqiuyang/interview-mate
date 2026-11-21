import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 由 data/questions.json 生成 public/js/demo-bank.js（演示模式题库快照）。
 *
 *   node scripts/build-demo.mjs          写入
 *   node scripts/build-demo.mjs --check  只校验是否与真题库一致（CI 用，漂移则 exit 1）
 *
 * 为什么要生成而不是直接 fetch data/questions.json：
 * 演示模式要能纯静态托管（public/ 单独发布），届时没有服务端也没有仓库根的 data/，
 * 题库必须以模块形式随前端一起走；生成文件保证单一事实来源仍是 data/questions.json。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data', 'questions.json');
const OUT = path.join(ROOT, 'public', 'js', 'demo-bank.js');

const bank = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const content = [
  '/* 自动生成，请勿手改。来源 data/questions.json；重新生成：node scripts/build-demo.mjs */',
  `export default ${JSON.stringify(bank, null, 2)};`,
  '',
].join('\n');

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== content) {
    console.error('demo-bank.js 与 data/questions.json 不一致，请运行 node scripts/build-demo.mjs');
    process.exit(1);
  }
  console.log(`demo-bank.js 与题库一致（${bank.questions.length} 题 / ${bank.categories.length} 分类）`);
} else {
  fs.writeFileSync(OUT, content);
  console.log(`已生成 ${path.relative(ROOT, OUT)}（${bank.questions.length} 题 / ${bank.categories.length} 分类）`);
}
