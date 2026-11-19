(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.clean = SL.clean || {};
  SL.clean.registry = SL.clean.registry || [];
  const I = SL.core.image, D = SL.core.dct, RNG = SL.core.RNG;
  const U = () => SL.clean.util;

  function pairFlatten(img) {
    const out = new Uint8ClampedArray(img.data);
    for (let i = 0; i < img.width * img.height; i++) for (let c = 0; c < 3; c++) {
      const o = i * 4 + c, v = out[o];
      out[o] = (v & 0xfe) | ((v >> 1) & 1);
    }
    return { width: img.width, height: img.height, data: out, info: img.info, exact: false };
  }
  function shuffleMagnitude(img, seed) {
    const ctx = D.dctImage(img);
    const MID = SL.stego.dctUtil ? SL.stego.dctUtil.MID : [[1, 2], [2, 1], [2, 2], [1, 3]];
    const rng = new RNG(seed);
    for (let by = 0; by < ctx.bh; by++) for (let bx = 0; bx < ctx.bw; bx++) {
      const per = rng.permutation(MID.length);
      const mags = MID.map((uv) => Math.abs(D.coef(ctx, bx, by, uv[0], uv[1])));
      MID.forEach((uv, k) => {
        const sign = D.coef(ctx, bx, by, uv[0], uv[1]) >= 0 ? 1 : -1;
        D.setCoef(ctx, bx, by, uv[0], uv[1], sign * mags[per[k]]);
      });
    }
    const out = D.composeCoefs(ctx);
    for (let i = 3; i < out.data.length; i += 4) out.data[i] = img.data[i];
    return out;
  }
  function addNoise(img, sigma, seed) {
    if (!(sigma > 0)) return I.clone(img);
    const rng = new RNG(seed), out = new Uint8ClampedArray(img.data);
    for (let i = 0; i < img.width * img.height; i++) for (let c = 0; c < 3; c++) out[i * 4 + c] = out[i * 4 + c] + rng.normal() * sigma;
    return { width: img.width, height: img.height, data: out, info: img.info, exact: false };
  }

  const targeted = [
    {
      id: 'equalize', label: '配对幅度拉平', group: '定向',
      desc: '把每个像素值的 LSB 重写为相邻位的值，使 (2i, 2i+1) 值对塌缩。专门清除：LSB 替换、LSB 匹配、值对类方法。',
      params: [], apply: async (img) => pairFlatten(img)
    },
    {
      id: 'mag_shuffle', label: '块内中频幅度置换', group: '定向',
      desc: '在每个 8×8 块内随机重排 8 个中频系数的幅度（保留相位）。对关系法与 DCT-QIM 有效，对空域 LSB 无效。',
      params: [{ key: 'seed', label: '随机种子', type: 'number', value: 1, min: 0, max: 4294967295 }],
      apply: async (img, p) => shuffleMagnitude(img, p.seed == null ? 1 : p.seed)
    },
    {
      id: 'noise20', label: '中频噪声 σ2.0', group: '定向',
      desc: '叠加 σ=2.0 的高斯噪声：幅度足够淹没 LSB 与弱 QIM，但对人眼仍接近不可见。',
      params: [{ key: 'sigma', label: '噪声 σ', type: 'number', value: 2, min: 0.2, max: 8 }],
      apply: async (img, p) => addNoise(img, p.sigma == null ? 2 : +p.sigma, 0x6a09e667)
    },
    {
      id: 'shift4', label: '整体右移 4px', group: '定向',
      desc: '把图像右移 4 像素并循环回绕，破坏 8×8 网格与像素对索引对齐；关系法、PVD、块内 QIM 的载波位置因此错位。',
      params: [], apply: async (img) => I.shiftRight(img, 4)
    },
    {
      id: 'crop4', label: '裁边 4px 后缩放', group: '定向',
      desc: '裁掉 4 像素边框再缩放回原尺寸，会重采样全部像素，破坏任何依赖原始网格对齐的嵌入。',
      params: [{ key: 'px', label: '裁边像素', type: 'number', value: 4, min: 1, max: 32 }],
      apply: async (img, p) => I.cropResize(img, p.px == null ? 4 : Math.max(1, p.px | 0))
    },
    {
      id: 'jpeg_q45', label: '附加 JPEG q45', group: '附加',
      desc: '只做一次 JPEG q45 往返，用于观察“仅重压缩”对各类嵌入的实际杀伤力。',
      params: [], apply: async (img) => U().withAlpha(img, await I.jpegRoundtrip(img, 0.45, false))
    },
    {
      id: 'jpeg_q30', label: '附加 JPEG q30', group: '附加',
      desc: '只做一次 JPEG q30 往返。比 q45 更狠，通常足以毁掉所有中频 QIM 与关系法结构。',
      params: [], apply: async (img) => U().withAlpha(img, await I.jpegRoundtrip(img, 0.3, false))
    }
  ];
  targeted.forEach((m) => { m.kind = 'clean'; SL.clean.registry.push(m); });
  SL.clean.targeted = targeted;
})();
