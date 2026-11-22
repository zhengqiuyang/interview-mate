/* Markdown 围栏代码/引用渲染、开源题库 Markdown 解析、全量备份 key 集合单元测试。
 * Node 18 无法加载 .js 中的 ESM 语法，整个套件在 <20 跳过。 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const [NODE_MAJOR] = process.versions.node.split('.').map(Number);
const SKIP = NODE_MAJOR < 20
  ? 'node 18 无法加载 .js 中的 ESM 语法（detect-module 需要 ≥20）'
  : false;

describe('md / md-import / backup-keys', { skip: SKIP }, () => {
  let md;
  let parseMarkdownQuestions;
  let normalizeGithubUrl;
  let BACKUP_KEYS;

  before(async () => {
    ({ md } = await import('../public/js/core.js'));
    ({ parseMarkdownQuestions, normalizeGithubUrl } = await import('../public/js/md-import.js'));
    ({ BACKUP_KEYS } = await import('../public/js/state.js'));
  });

  test('md() 渲染围栏代码块（带语言标签与复制按钮，内部不跑粗体替换且安全转义）', () => {
    const html = md('说明 **加粗**\n```js\nconst a = 1 * 2;\nconst s = "<script>x</script>";\n```\n> 引用提示');
    assert.match(html, /<strong>加粗<\/strong>/);
    assert.match(html, /<div class="code-block">.*<span>js<\/span>.*class="code-copy"/);
    assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'), '代码块应转义 HTML');
    assert.ok(html.includes('const a = 1 * 2;\nconst s ='), '代码块保留原始换行与运算符');
    assert.match(html, /<blockquote><p>引用提示<\/p><\/blockquote>/);
  });

  test('normalizeGithubUrl 将 GitHub blob 链接转为 raw.githubusercontent.com', () => {
    const raw = normalizeGithubUrl('https://github.com/CyC2018/CS-Notes/blob/master/notes/HTTP.md');
    assert.equal(raw, 'https://raw.githubusercontent.com/CyC2018/CS-Notes/master/notes/HTTP.md');
    assert.equal(normalizeGithubUrl('https://example.com/a.md'), 'https://example.com/a.md');
  });

  test('parseMarkdownQuestions 正确切分二级/三级标题问答，忽略代码块内 # 注释与目录', () => {
    const doc = [
      '# 目录',
      '- [TCP](#tcp)',
      '## 目录',
      '1. 第一章',
      '## 1. [TCP 和 UDP 区别](#tcp)',
      'TCP 面向连接且可靠，UDP 无连接且延迟低。',
      '',
      '```python',
      '# 这里是代码注释，绝不能当成题目',
      'def foo():',
      '    return 1',
      '```',
      '',
      '### 2. 什么是 Redis 跳表？',
      '跳表在有序链表上增加多级索引，平均查找复杂度 O(logN)。',
    ].join('\n');
    const items = parseMarkdownQuestions(doc, { defaultTag: 'CS-Notes' });
    assert.equal(items.length, 2);
    assert.equal(items[0].q, 'TCP 和 UDP 区别');
    assert.ok(items[0].a.includes('# 这里是代码注释'));
    assert.equal(items[1].q, '什么是 Redis 跳表？');
    assert.deepEqual(items[1].tags, ['CS-Notes']);
  });

  test('BACKUP_KEYS 覆盖简历、投递看板、画像、游戏化、Token 与自定义工具', () => {
    for (const k of [
      'im_settings', 'im_srs', 'im_resumes', 'im_apps', 'im_profile',
      'im_gamify', 'im_tokens', 'im_custom_tools', 'im_custom_experts', 'im_target_date',
    ]) {
      assert.ok(BACKUP_KEYS.includes(k), `BACKUP_KEYS 缺少 ${k}`);
    }
  });
});
