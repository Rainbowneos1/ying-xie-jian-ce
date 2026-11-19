(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.analysis = SL.analysis || {};
  const D = SL.core.dct;

  const PAIRS = [[[1, 2], [2, 1]], [[2, 2], [1, 3]], [[3, 1], [2, 3]], [[3, 2], [1, 4]]];
  const BINS = 50;

  function ratioCounts(ctx, pairs) {
    const counts = new Float64Array(BINS);
    let total = 0;
    for (let by = 0; by < ctx.bh; by++) for (let bx = 0; bx < ctx.bw; bx++) {
      for (const pr of pairs) {
        const a = Math.abs(D.coef(ctx, bx, by, pr[0][0], pr[0][1]));
        const b = Math.abs(D.coef(ctx, bx, by, pr[1][0], pr[1][1]));
        const s = a + b;
        if (s < 1e-6) continue;
        const r = a / s;
        let bin = Math.floor(r * BINS);
        if (bin >= BINS) bin = BINS - 1;
        counts[bin]++; total++;
      }
    }
    return { counts, total };
  }
  function summarize(hist) {
    const { counts, total } = hist;
    if (!total) return { peakMass: 0, peakBin: 0, shoulder: 0, comb: 0, total: 0 };
    let peakBin = 0, peak = 0;
    for (let i = 0; i < BINS; i++) if (counts[i] > peak) { peak = counts[i]; peakBin = i; }
    let sh = 0, n = 0;
    for (let i = Math.max(0, peakBin - 3); i <= Math.min(BINS - 1, peakBin + 3); i++) { sh += counts[i]; n++; }
    const shoulder = n ? sh / n / total : 0;
    return { peakMass: peak / total, peakBin, shoulder, comb: shoulder > 0 ? (peak / total) / shoulder : 0, total };
  }
  function shiftImg(img, px) {
    const w = img.width, h = img.height, out = new Uint8ClampedArray(img.data);
    for (let y = 0; y < h; y++) for (let x = w - 1; x >= 0; x--) {
      const sx = (x - px + w) % w;
      out[(y * w + x) * 4] = img.data[(y * w + sx) * 4];
      out[(y * w + x) * 4 + 1] = img.data[(y * w + sx) * 4 + 1];
      out[(y * w + x) * 4 + 2] = img.data[(y * w + sx) * 4 + 2];
    }
    return { width: w, height: h, data: out, info: img.info };
  }
  function run(img) {
    const w8 = Math.floor(img.width / 8) * 8, h8 = Math.floor(img.height / 8) * 8;
    if (w8 < 16 || h8 < 16) return { primary: summarize({ counts: new Float64Array(BINS), total: 0 }), shifted: null, excess: 0, colors: 0, usable: false };
    const colors = SL.core.metrics.colorCount(img);
    const ctx = D.dctImage(img);
    const primary = summarize(ratioCounts(ctx, PAIRS));
    let shifted = null, excess = 0;
    const step = Math.max(1, Math.floor(Math.sqrt((w8 * h8) / 200000)));
    if (step === 1) {
      const ctx2 = D.dctImage(shiftImg(img, 4));
      shifted = summarize(ratioCounts(ctx2, PAIRS));
      excess = primary.peakMass - shifted.peakMass;
    }
    return { primary, shifted, excess, colors, usable: true };
  }
  SL.analysis.comb = { run, PAIRS, BINS };
})();
