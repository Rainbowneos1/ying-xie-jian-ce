(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.clean = SL.clean || {};
  SL.clean.registry = SL.clean.registry || [];
  const I = SL.core.image, U = () => SL.clean.util;

  async function chainJpeg(img, qualities) {
    let cur = img;
    for (const q of qualities) {
      cur = await I.jpegRoundtrip(cur, q, false);
      cur = U().withAlpha(img, cur);
    }
    return cur;
  }

  const enhanced = [
    {
      id: 'jpeg15', label: '单轮 JPEG q15', group: '强力',
      desc: '一次极端量化的 JPEG 往返。量化表把中高频系数几乎全部抹平，是所有 DCT 域方法的通用杀手；画质损失很大。',
      params: [],
      apply: async (img) => U().withAlpha(img, await I.jpegRoundtrip(img, 0.15, false))
    },
    {
      id: 'anti_forensic', label: '反取证往返 25→55→88', group: '强力',
      desc: '先用低质量抹掉高频，再逐步提高质量“补”回纹理。多次量化会留下不一致的量化表痕迹，专门对抗基于压缩历史一致性的检测。',
      params: [],
      apply: (img) => chainJpeg(img, [0.25, 0.55, 0.88])
    },
    {
      id: 'ao_overwrite', label: 'AO 覆写（自适应覆写 + 锐化）', group: '强力',
      desc: 'JPEG q20 抹平 → USM 锐化重建边缘 → q60 覆盖 → 随机化 2 位 LSB。同时破坏频域与空域两类痕迹。',
      params: [{ key: 'amount', label: '锐化强度', type: 'number', value: 0.8, min: 0, max: 3 }],
      apply: async (img, p) => {
        let cur = await I.jpegRoundtrip(img, 0.2, false);
        cur = U().withAlpha(img, cur);
        cur = I.unsharpMask(cur, 1.0, p.amount == null ? 0.8 : p.amount, 2);
        cur = await I.jpegRoundtrip(cur, 0.6, false);
        cur = U().withAlpha(img, cur);
        return U().randomizeLSB(cur, 2, true);
      }
    },
    {
      id: 'strongest', label: '最强档（q15 + 2× 缩放 + USM + 噪声）', group: '强力',
      desc: '把所有手段叠在一起：q15、0.5× 再放大、锐化、2 位 LSB 随机化与 σ1.5 噪声。画质代价最大，用于“宁可毁图也要清除”。',
      params: [{ key: 'noise', label: '噪声 σ', type: 'number', value: 1.5, min: 0, max: 6 }],
      apply: async (img, p) => {
        let cur = await I.jpegRoundtrip(img, 0.15, false);
        cur = U().withAlpha(img, cur);
        cur = await I.resampleRoundtrip(cur, 0.5);
        cur = U().withAlpha(img, cur);
        cur = I.unsharpMask(cur, 1.2, 1.0, 2);
        cur = U().randomizeLSB(cur, 2, true);
        const sigma = p.noise == null ? 1.5 : +p.noise;
        if (sigma > 0) {
          const RNG = SL.core.RNG, rng = new RNG(0x2545f491);
          const out = new Uint8ClampedArray(cur.data);
          for (let i = 0; i < cur.width * cur.height; i++) for (let c = 0; c < 3; c++) {
            out[i * 4 + c] = out[i * 4 + c] + rng.normal() * sigma;
          }
          cur = { width: cur.width, height: cur.height, data: out, info: cur.info, exact: false };
        }
        return cur;
      }
    }
  ];
  enhanced.forEach((m) => { m.kind = 'clean'; SL.clean.registry.push(m); });
  SL.clean.enhanced = enhanced;
})();
