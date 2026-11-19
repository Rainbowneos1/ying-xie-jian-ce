(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.analysis = SL.analysis || {};
  const B = SL.core.bytes, crc32 = SL.core.crc32;

  const KNOWN = ['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'mDCv', 'cLLi',
    'bKGD', 'hIST', 'tRNS', 'pHYs', 'sPLT', 'tIME', 'iTXt', 'tEXt', 'zTXt', 'eXIf', 'acTL', 'fcTL', 'fdAT', 'oFFs', 'pCAL', 'sCAL', 'sTER', 'dSIG'];
  const META = ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'iCCP', 'sPLT', 'pCAL', 'sCAL', 'oFFs', 'dSIG'];

  function mk(id, category, severity, title, detail, evidence, suggestion) {
    return { id, category, severity, title, detail, evidence: evidence || [], suggestion: suggestion || '' };
  }

  async function run(img) {
    const out = [];
    const bytes = img.bytes;
    if (!bytes) return [mk('no-bytes', '容器', 'info', '当前图片没有原始字节', '浏览器解码路径未保留原始文件数据，容器层检查被跳过。', [], '重新上传原始文件。')];
    if (!SL.core.png.isPNG(bytes)) {
      out.push(mk('non-png', '容器', 'info', '非 PNG 容器，chunk 级取证不可用',
        `当前文件是 ${img.format || '未知格式'}。JPEG/WebP 的隐写痕迹主要在 DCT 系数量化和量化表上，本工具不做 DCT 系数直读，因此容器层只能给出空结论。`,
        [['格式', img.format || '—'], ['体积', B.formatBytes(bytes.length)]],
        '如需完整容器取证，请先转为 PNG；对 JPEG 建议直接看「去隐写」里的重编码档位。'));
      return out;
    }

    let p;
    try { p = SL.core.png.parseChunks(bytes); } catch (e) {
      return [mk('png-broken', '容器', 'high', 'PNG 结构无法解析', e.message, [], '文件可能被截断或头部被破坏。')];
    }
    const info = p.info;
    const chunks = p.chunks;
    const types = chunks.map((c) => c.type);

    const badCrc = chunks.filter((c) => !c.crcOk);
    if (badCrc.length) {
      out.push(mk('crc', '容器', 'high', `${badCrc.length} 个 chunk CRC 校验失败`,
        'CRC 与块内容不符：可能是人为改写像素后没有更新 CRC，也可能是传输损坏。隐写工具通常会自动修正 CRC，所以这条只算“结构异常”。',
        badCrc.slice(0, 6).map((c) => [c.type, `期望 ${c.crc.toString(16)}`]),
        '把图片另存一次再检测；若仍失败，说明文件被非标准工具改写过。'));
    }
    if (p.truncated) out.push(mk('trunc', '容器', 'high', '文件被截断', 'chunk 长度声明超出文件末尾。', [['已解析块', chunks.length]], '文件不完整，像素数据可能缺失。'));
    if (p.missingIEND) out.push(mk('no-iend', '容器', 'high', '缺少 IEND 结束块', '规范 PNG 必须以 IEND 结束；缺失常见于被工具裁剪或附加数据的文件。', [['块数', chunks.length]], '用图像工具重新导出一次。'));
    if (p.iendCount > 1) out.push(mk('multi-iend', '容器', 'high', `出现 ${p.iendCount} 个 IEND 块`, '多 IEND 意味文件被拼接，后半段可能是另一张图或附加载荷。', [], '检查 IEND 之后的数据。'));
    if (p.tail && p.tail.length) {
      const head = p.tail.subarray(0, 32);
      const txt = Array.from(head).map((b) => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
      out.push(mk('tail', '容器', 'high', `IEND 之后还有 ${B.formatBytes(p.tail.length)} 尾随数据`,
        '这些字节不属于任何 PNG 块，是“文件尾附加”隐写最典型的形态。可能还包含压缩包、另一张图片或纯文本。',
        [['长度', p.tail.length + ' B'], ['开头', txt], ['前 8 字节', Array.from(p.tail.subarray(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join(' ')]],
        '用「提取」工作区的文件尾附加通道直接取出；或在十六进制编辑器里查看 IEND 之后的内容。'));
    }

    const unknown = chunks.filter((c) => !KNOWN.includes(c.type));
    if (unknown.length) {
      out.push(mk('unknown-chunk', '容器', 'medium', `发现 ${unknown.length} 个非标准 chunk`,
        '没有出现在 PNG 规范里的块类型，通常是隐写工具的自定义数据块。',
        unknown.slice(0, 6).map((c) => [c.type, c.len + ' B']),
        '记录块名后可在十六进制编辑器定位；本工具的提取通道暂不解析自定义块。'));
    }

    const dups = {};
    for (const t of types) dups[t] = (dups[t] || 0) + 1;
    const dupList = Object.keys(dups).filter((t) => dups[t] > 1 && t !== 'IDAT');
    if (dupList.length) {
      out.push(mk('dup-chunk', '容器', 'medium', '存在重复 chunk',
        '除 IDAT 允许多块外，重复的块会让不同解析器读到不同结果，也常被用来夹带数据。',
        dupList.map((t) => [t, dups[t] + ' 次']), '用标准工具重新编码一次。'));
    }

    let text = [];
    try { text = await SL.core.png.readTextChunks(p); } catch (e) { text = []; }
    const metaChunks = chunks.filter((c) => META.includes(c.type));
    if (text.length || metaChunks.length) {
      const ev = text.slice(0, 8).map((t) => [t.key, (t.value || '').slice(0, 60) + ((t.value || '').length > 60 ? '…' : '')]);
      if (!ev.length) for (const c of metaChunks.slice(0, 6)) ev.push([c.type, c.len + ' B']);
      const longB64 = text.find((t) => (t.value || '').length > 64 && /^[A-Za-z0-9+/=]+$/.test(t.value));
      out.push(mk('meta', '容器', longB64 ? 'high' : 'low', `发现 ${text.length + metaChunks.length} 处文本/元数据`,
        '文本块本身合法（相机、编辑器都会写），但长 base64 串、或键名可疑的块常被当作载荷容器。',
        ev, longB64 ? '疑似 base64 载荷，可在「提取」里尝试 tEXt 通道。' : '逐条核对键值是否来自可信软件。'));
    }

    const total = bytes.length;
    const idatLen = p.idat.reduce((s, d) => s + d.length, 0);
    const rawBytes = info.width * info.height * 4;
    const ratio = rawBytes > 0 ? idatLen / rawBytes : 0;
    if (ratio > 1.02) {
      out.push(mk('idat-inflate', '容器', 'medium', 'IDAT 压缩后反而比原始像素更大',
        '正常照片/插画的 deflate 压缩率远小于 1。压缩率接近或超过 1 说明像素被加密或随机化（例如 LSB 被随机填充后熵升高）。',
        [['IDAT', B.formatBytes(idatLen)], ['原始 RGBA', B.formatBytes(rawBytes)], ['比值', ratio.toFixed(3)]],
        '结合 LSB 统计一起看；若 LSB 比例也异常，基本可判定为随机化类隐写。'));
    }
    if (idatLen > 0 && idatLen / total > 0.995 && p.tail.length === 0) {
      out.push(mk('no-overhead', '容器', 'info', '容器几乎没有冗余空间', '文件体积几乎全部是压缩像素数据，不存在追加式载荷的容身之处。', [['IDAT 占比', (100 * idatLen / total).toFixed(1) + '%']], ''));
    }
    const sig = crc32(bytes.subarray(0, 8));
    out.push(mk('ok', '容器', 'info', 'PNG 结构自检完成',
      `已解析 ${chunks.length} 个 chunk，IHDR ${info.width}×${info.height}，位深 ${info.bitDepth}，颜色类型 ${info.colorType}，交错 ${info.interlace}。`,
      [['块数', chunks.length], ['IDAT', p.idat.length], ['CRC', badCrc.length ? '有失败' : '全部通过'], ['签名指纹', (sig >>> 0).toString(16)]], ''));
    return out;
  }

  SL.analysis.container = { run, KNOWN, META };
})();
