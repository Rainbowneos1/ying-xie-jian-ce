(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.stego = SL.stego || {};
  const B = SL.core.bytes, F = SL.core.frame, P = SL.core.png;

  async function existingTexts(img) {
    if (!img.png) return [];
    return P.readTextChunks(img.png);
  }
  async function embed(img, payload) {
    if (!img.width) throw new Error('无效图片');
    const frame = F.buildFrame(payload, 3, { bits: 1 });
    const texts = await existingTexts(img);
    const list = texts.filter((t) => t.type === 'tEXt' && t.key !== 'StegoData').map((t) => ({ key: t.key, value: t.value }));
    list.push({ key: 'StegoData', value: B.toBase64(frame) });
    const bytes = await P.encodePNG(img.width, img.height, img.data, { text: list });
    return { bytes, frame, frameLength: frame.length, png: P.parseChunks(bytes) };
  }
  async function probe(img) {
    if (!img.png) return null;
    const texts = await P.readTextChunks(img.png);
    for (const t of texts) {
      if (t.key !== 'StegoData') continue;
      try {
        const frameBytes = B.fromBase64(t.value);
        const f = F.parseFrame(frameBytes);
        if (f && f.header.method === 3) return f;
      } catch (e) { /* ignore */ }
    }
    return null;
  }
  const method = {
    id: 'text', label: 'PNG tEXt 文本块', group: '无损', lossless: true,
    desc: '以 base64(STG1 帧) 写入 tEXt 的 StegoData 字段；兼容性好，但重存/压缩即丢失。',
    params: [],
    capacity: () => Infinity, embed, probe
  };
  SL.stego.text = method;
  SL.stego.registry.push(method);
})();
