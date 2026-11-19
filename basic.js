(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.clean = SL.clean || {};
  SL.clean.registry = SL.clean.registry || [];
  const I = SL.core.image, RNG = SL.core.RNG;

  function randomizeLSB(img, bits, keepAlpha) {
    const out = new Uint8ClampedArray(img.data);
    const rng = new RNG(0x5bd1e995);
    const mask = bits === 2 ? 0xfc : 0xfe;
    const n = bits === 2 ? 3 : 1;
    for (let i = 0; i < img.width * img.height; i++) {
      for (let c = 0; c < 3; c++) {
        const o = i * 4 + c;
        out[o] = (out[o] & mask) | (rng.nextU32() & n);
      }
    }
    if (!keepAlpha) for (let i = 3; i < out.length; i += 4) out[i] = img.data[i];
    return { width: img.width, height: img.height, data: out, info: img.info, exact: false };
  }
  async function scaleRoundtrip(img, factor) {
    if (Math.abs(factor - 1) < 1e-4) return img;
    return I.resampleRoundtrip(img, factor);
  }
  function withAlpha(src, img) {
    const out = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data), info: img.info, exact: false };
    for (let i = 3; i < out.data.length; i += 4) out.data[i] = src.data[i];
    return out;
  }
  async function jpeg(img, q) { return I.jpegRoundtrip(img, q, false); }

  async function threeTier(img, p) {
    let cur = await jpeg(img, p.quality);
    cur = await scaleRoundtrip(cur, p.scale);
    cur = withAlpha(img, cur);
    cur = randomizeLSB(cur, p.bits, true);
    return cur;
  }

  const basic = [
    {
      id: 'rebuild', label: '轻度净化 · 重建', group: '轻度',
      desc: 'JPEG q95 重编码 + 缩放回原尺寸 + LSB 随机化 1 位。几乎看不出画质损失，足以清掉 LSB 与文件尾/文本块。',
      params: [{ key: 'quality', label: 'JPEG 质量', type: 'number', value: 95, min: 60, max: 100 },
      { key: 'bits', label: '随机化位数', type: 'number', value: 1, min: 1, max: 2 }],
      apply: (img, p) => threeTier(img, { quality: (p.quality || 95) / 100, bits: p.bits || 1, scale: 1 })
    },
    {
      id: 'balanced', label: '标准净化 · 平衡', group: '标准',
      desc: 'JPEG q85 + 0.985 缩放往返 + LSB 随机化。画质仍可接受，可破坏绝大多数空域与部分频域方法。',
      params: [{ key: 'quality', label: 'JPEG 质量', type: 'number', value: 85, min: 40, max: 100 },
      { key: 'bits', label: '随机化位数', type: 'number', value: 1, min: 1, max: 2 }],
      apply: (img, p) => threeTier(img, { quality: (p.quality || 85) / 100, bits: p.bits || 1, scale: 0.985 })
    },
    {
      id: 'aggressive', label: '深度净化 · 强破坏', group: '深度',
      desc: 'JPEG q45 + 0.94 缩放往返 + 随机化 2 位 LSB。画质明显下降，但能破坏关系法、DCT 类嵌入的强结构。',
      params: [{ key: 'quality', label: 'JPEG 质量', type: 'number', value: 45, min: 20, max: 80 },
      { key: 'bits', label: '随机化位数', type: 'number', value: 2, min: 1, max: 2 }],
      apply: (img, p) => threeTier(img, { quality: (p.quality || 45) / 100, bits: p.bits || 2, scale: 0.94 })
    }
  ];
  basic.forEach((m) => { m.kind = 'clean'; SL.clean.registry.push(m); });
  SL.clean.util = { randomizeLSB, scaleRoundtrip, withAlpha, jpeg };
  SL.clean.basic = basic;
})();
