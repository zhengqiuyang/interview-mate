# 零依赖解析 DOCX：手撕 ZIP 结构、原生解压与 WordprocessingML

> 系列第 17 篇（B 线·零依赖造轮子之三）。需求很朴素：用户上传 Word 简历，提取文本给 AI 分析。npm 生态有 mammoth 一把梭——但一个零依赖项目怎么优雅地解掉 .docx？答案是：docx 本质是个 ZIP，浏览器原生就能解。
> 仓库：https://github.com/zhengqiuyang/interview-mate

## 一、先想清楚 .docx 到底是什么

把 `.docx` 后缀改成 `.zip` 解开，会看到：

```
[Content_Types].xml          ← 部件类型声明
_rels/.rels                  ← 关系图（入口指向 document.xml）
word/document.xml            ← 正文（我们要的）
word/_rels/document.xml.rels
```

所以「解析 docx」分解为三步：**解 ZIP → 定位 `word/document.xml` → XML 转文本**。三步都有原生 API 可用，一行依赖都不用加。

## 二、解 ZIP：读懂四个结构就能定位任意文件

ZIP 格式看着吓人，实际只需要四个结构。解析顺序是倒着的——从文件尾往前找：

```
[Local File Header][数据][Local File Header][数据]...[Central Directory][EOCD]
                                                      ↑ 46字节/条          ↑ 22字节
```

**第一步：找 EOCD（End of Central Directory）**。文件末尾 22 字节的固定结构，签名 `PK\x05\x06`。它记录着中央目录的偏移量：

```js
const buf = new Uint8Array(await file.arrayBuffer());
let eocd = -1;
for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
  if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x05 && buf[i+3] === 0x06) {
    eocd = i; break;
  }
}
if (eocd < 0) throw new Error('不是有效的 docx 文件');
```

为什么从后往前扫、只扫最后 66000 字节？因为 EOCD 后面可能跟着最多 64KB 的注释字段，中央目录本身可能很大——从尾部扫最省事。

**第二步：遍历中央目录**。每条 46 字节（签名 `PK\x01\x02`），关键偏移：`+28` 文件名长度、`+42` 本地头偏移。按文件名长度跳着走，直到找到 `word/document.xml`：

```js
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const cdOffset = dv.getUint32(eocd + 16, true);      // 小端序！
let p = cdOffset, entry = null;
while (p < eocd && buf[p] === 0x50 && buf[p+1] === 0x4b) {
  const nameLen = dv.getUint16(p + 28, true);
  const extraLen = dv.getUint16(p + 30, true);
  const commentLen = dv.getUint16(p + 32, true);
  const localOffset = dv.getUint32(p + 42, true);
  const name = new TextDecoder().decode(buf.slice(p + 46, p + 46 + nameLen));
  if (name === 'word/document.xml') { entry = { localOffset }; break; }
  p += 46 + nameLen + extraLen + commentLen;
}
```

**第三步：从本地头拿数据范围**。中央目录不存数据长度，要到本地头（签名 `PK\x03\x04`）里读：`+8` 压缩方法、`+18` 压缩大小、`+26/+28` 文件名和扩展字段长度，数据起点 = 本地头偏移 + 30 + 两者长度。

```js
const lo = entry.localOffset;
const method = dv.getUint16(lo + 8, true);      // 0=stored, 8=deflate
const compSize = dv.getUint32(lo + 18, true);
const dataStart = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
const raw = buf.slice(dataStart, dataStart + compSize);
```

这里有个 ZIP 设计的「坑」值得知道：压缩大小在本地头里是可能造假的（数据流的本地头可以填 0，真实值只在中央目录）——正规 zip 工具都填真实值，浏览器环境遇到伪造的概率约等于零，但做安全审计时要记得这个字段不可信。

## 三、解压：DecompressionStream 一行流

`method === 8`（deflate）时，用浏览器原生的流式解压：

```js
const xmlBytes = method === 0
  ? raw
  : new Uint8Array(await new Response(
      new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    ).arrayBuffer());
```

三个细节：**`deflate-raw`** 而不是 `deflate`——ZIP 用的是裸 deflate 流（无 zlib 头）；`Blob([raw]).stream()` 把 Uint8Array 转成 Web 流接进管道；`Response` 包一层是为了用 `arrayBuffer()` 收集结果。三个原生 API 串起来，取代了整个 pako 库。

**兼容性**：Chrome/Edge 80+（2020 年起）。我们的语音功能本来就要求 Chrome/Edge，不构成额外门槛。

## 四、WordprocessingML 转文本

解出来的 XML 长这样：`<w:p>` 是段落、`<w:t>` 是文本、`<w:tab/>` 制表符、`<w:br/>` 换行。转换就是几次正则替换：

```js
const xml = new TextDecoder('utf-8').decode(xmlBytes);
return xml
  .replace(/<w:p[^>]*>/g, '\n')          // 段落 → 换行
  .replace(/<w:tab[^>]*\/>/g, '\t')      // 制表符
  .replace(/<w:br[^>]*\/>/g, '\n')       // 软换行
  .replace(/<[^>]+>/g, '')               // 其余标签全剥
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&')                // &amp; 必须最后解，否则 &amp;lt; 会二次解码
  .replace(/\n{3,}/g, '\n\n')            // 压掉连续空行
  .trim();
```

实体解码的顺序是经典陷阱：`&amp;lt;` 的原文其实是字面量 `&lt;`，如果先解 `&lt;` 就会把它错误地变成 `<`。`&amp;` 永远最后解。

## 五、调试段子：我被自己的测试样本坑了一晚上

给这个解析器写测试样本时，用 Node 手搓了一个「标准」DOCX——结果解析永远失败。查了两小时，发现生成 ZIP 本地头时少拼了一个字段：30 字节的头我只拼了 28 字节（少一个日期字段），导致后面所有偏移错位，`method` 读到的是别人的数据。

教训有二：**二进制格式的测试样本必须用独立工具交叉验证**（我后来把样本丢进 7-Zip 能正常打开，才确认是解析器的锅还是样本的锅）；**DataView 的偏移量常量建议对着格式图逐个注释**，肉眼对齐字段是玄学。

## 六、小结

| 步骤 | 原生 API | 替代的库 |
| --- | --- | --- |
| 读 ZIP 结构 | DataView + 指针算术 | JSZip |
| 解压 | DecompressionStream('deflate-raw') | pako |
| XML 转文本 | 正则替换 | mammoth（简化版） |

约 80 行代码，覆盖了 90% 的真实 docx（含中文、表格文本）。剩下 10% 是复杂嵌套对象（图片、SmartArt）——对「提取简历文本」的场景，它们本来就该被丢弃。

---

**https://github.com/zhengqiuyang/interview-mate** —— 求个 star ⭐。
