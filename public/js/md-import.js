/* 开源题库 Markdown 解析器与 GitHub Raw URL 转换工具
 * 纯函数模块，可在浏览器与 Node 测试环境下运行。 */

const SKIP_HEADING_RE = /^(目录|table of contents|toc|license|许可证|参考|参考资料|references|致谢|acknowledgements|contributors|贡献者|前言|简介|overview|summary|appendix|附录)$/i;

/** 将常见 GitHub blob 链接转为 raw.githubusercontent.com 直链 */
export function normalizeGithubUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  const m = s.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
  if (m) {
    return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
  }
  return s;
}

function cleanHeading(raw) {
  return String(raw || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(?:Q\d+[:：.\s]+|\d+[.、)\s]+)/i, '')
    .trim();
}

function collectByPattern(lines, headingRe, defaultTag, max) {
  const items = [];
  const seen = new Set();
  let curTitle = '';
  let buf = [];
  let inCode = false;

  const flush = () => {
    const q = cleanHeading(curTitle);
    const a = buf.join('\n').trim();
    if (!q || q.length < 3 || SKIP_HEADING_RE.test(q) || a.length < 8) return;
    if (seen.has(q)) return;
    seen.add(q);
    items.push({
      q: q.slice(0, 200),
      a: a.slice(0, 8000),
      diff: 2,
      tags: defaultTag ? [String(defaultTag).trim().slice(0, 20)] : ['开源导入'],
    });
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('```')) {
      inCode = !inCode;
      if (curTitle) buf.push(raw);
      continue;
    }
    if (!inCode) {
      const m = raw.match(headingRe);
      if (m) {
        flush();
        if (items.length >= max) break;
        curTitle = m[1];
        buf = [];
        continue;
      }
    }
    if (curTitle) buf.push(raw);
  }
  if (items.length < max) flush();
  return items;
}

/**
 * 将 Markdown 文档解析为题库数组 [{q, a, diff, tags}]
 * 优先按 ## / ### / #### 切分（绕开代码块内 # 注释）；若无二级以上标题，回退按一级标题切分。
 */
export function parseMarkdownQuestions(mdText, opts = {}) {
  const defaultTag = opts.defaultTag === undefined ? '开源导入' : opts.defaultTag;
  const max = Math.min(Math.max(Number(opts.max) || 200, 1), 500);
  const lines = String(mdText || '').split(/\r?\n/);
  const primary = collectByPattern(lines, /^#{2,4}\s+(.+?)\s*#*$/, defaultTag, max);
  if (primary.length) return primary;
  return collectByPattern(lines, /^#\s+(.+?)\s*#*$/, defaultTag, max);
}
