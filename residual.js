(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.analysis = SL.analysis || {};
  const D = SL.core.dct;

  const K = [
    [-1, 2, -2, 2, -1],
    [2, -6, 8, -6, 2],
    [-2, 8, -12, 8, -2],
    [2, -6, 8, -6, 2],
    [-1, 2, -2, 2, -1]
  ];

  function residualStats(img, dx) {
    const w = img.width, h = img.height;
    const y = D.ycbcr(img).y;
    let sum = 0, sum2 = 0, n = 0;
    const hist = new Float64Array(81);
    const step = Math.max(1, Math.ceil(Math.sqrt((w * h) / 900000)));
    for (let ry = 2; ry < h - 2; ry += step) {
      for (let rx = 2; rx < w - 2; rx += step) {
        let s = 0;
        for (let ky = -2; ky <= 2; ky++) for (let kx = -2; kx <= 2; kx++) {
          let sx = rx + kx + dx;
          if (sx < 0) sx += w; else if (sx >= w) sx -= w;
          s += K[ky + 2][kx + 2] * y[(ry + ky) * w + sx];
        }
        const v = s / 12;
        sum += v; sum2 += v * v; n++;
        const bin = Math.max(0, Math.min(80, Math.round(v) + 40));
        hist[bin]++;
      }
    }
    if (!n) return { mean: 0, variance: 0, entropy: 0, n: 0, hist };
    const mean = sum / n, variance = Math.max(0, sum2 / n - mean * mean);
    let ent = 0;
    for (let i = 0; i < 81; i++) if (hist[i]) { const p = hist[i] / n; ent -= p * Math.log2(p); }
    return { mean, variance, entropy: ent, n, hist };
  }

  function run(img) {
    if (img.width < 32 || img.height < 32) return { usable: false };
    const a = residualStats(img, 0);
    const b = residualStats(img, 4);
    const sym = (() => {
      let s = 0, t = 0;
      for (let i = 0; i < 40; i++) { const p = a.hist[i], q = a.hist[80 - i]; s += Math.abs(p - q); t += p + q; }
      return t ? s / t : 0;
    })();
    return {
      usable: true, variance: a.variance, entropy: a.entropy, shiftVariance: b.variance,
      varianceRatio: b.variance > 0 ? a.variance / b.variance : 1, symmetry: sym, samples: a.n
    };
  }
  SL.analysis.residual = { run, K, residualStats };
})();
