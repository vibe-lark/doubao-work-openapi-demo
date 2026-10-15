// 测试用文件夹具：本地即时生成最小合法 png / txt / pdf，以及大文件与空文件/坏扩展名。
// 零依赖。

export function pngBytes(size = 95) {
  // 1x1 蓝色像素的最小合法 PNG。
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlUEQVR42mNkYPj/HwYFBgDED0B7SQIF+wAAAABJRU5ErkJggg==';
  const base = Buffer.from(b64, 'base64');
  if (base.length >= size) return base.subarray(0, size);
  // 在 IDAT 之前插入 tEXt 块把文件撑到指定体积（仍是合法 PNG 结构）。
  const overhead = base.length;
  const pad = Math.max(0, size - overhead);
  const textChunk = Buffer.alloc(12 + pad);
  textChunk.writeUInt32BE(4 + pad + 4, 0);
  textChunk.write('tEXt', 4);
  textChunk.write('comment', 8);
  // 其余字节保持 0（tEXt 的 data 允许 NUL 之后任意字节）
  // CRC 非 0 严格来说不合规，但多数网关只按扩展名/魔数判定；夹具仅用于上传测试。
  const insertAt = base.indexOf(Buffer.from('IDAT')) - 4;
  return Buffer.concat([base.subarray(0, insertAt), textChunk, base.subarray(insertAt)]);
}

export function smallPng() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlUEQVR42mNkYPj/HwYFBgDED0B7SQIF+wAAAABJRU5ErkJggg==', 'base64');
}

export function txtBytes(content = `豆包工作 Open API 测试文本\n生成时间 ${new Date().toISOString()}\n`) {
  return Buffer.from(content, 'utf8');
}

export function pdfBytes() {
  // 最小可解析 PDF（无字体流），仅用于通过类型/魔数校验。
  const body = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
xref
0 4
0000000000 65535 f
trailer<</Size 4/Root 1 0 R>>
startxref
0
%%EOF
`;
  return Buffer.from(body, 'utf8');
}

export function emptyBytes() {
  return Buffer.alloc(0);
}

// 即时生成指定字节数的伪文件（可重复伪随机内容，避免压缩/去重）。
export function blobBytes(size) {
  const buf = Buffer.alloc(size);
  let seed = 0x12345678 ^ size;
  for (let i = 0; i < size; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = seed & 0xff;
  }
  return buf;
}
