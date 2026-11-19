(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.core = SL.core || {};
  const B = SL.core.bytes;

  function psnr(a, b) {
    let se = 0, n = a.width * a.height * 3;
    for (let i = 0; i < a.width * a.height; i++) for (let c = 0; c < 3; c++) {
      const d = a.data[i * 4 + c] - b.data[i * 4 + c]; se += d * d;
    }
    if (!se) return Infinity;
    return 10 * Math.log10(255 * 255 / (se / n));
  }
  function maxDelta(a, b) {
    let m = 0;
    for (let i = 0; i < a.data.length; i++) m = Math.max(m, Math.abs(a.data[i] - b.data[i]));
    return m;
  }
  function meanDelta(a, b) {
    let s = 0, n = 0;
    for (let i = 0; i < a.data.length; i++) { s += Math.abs(a.data[i] - b.data[i]); n++; }
    return n ? s / n : 0;
  }
  function changedRatio(a, b) {
    let n = 0, total = a.width * a.height;
    for (let i = 0; i < total; i++) {
      const o = i * 4;
      if (a.data[o] !== b.data[o] || a.data[o + 1] !== b.data[o + 1] || a.data[o + 2] !== b.data[o + 2] || a.data[o + 3] !== b.data[o + 3]) n++;
    }
    return n / total;
  }
  function colorCount(img) {
    const s = new Set();
    for (let i = 0; i < img.width * img.height; i++) {
      const o = i * 4;
      s.add(((img.data[o] << 24) | (img.data[o + 1] << 16) | (img.data[o + 2] << 8) | img.data[o + 3]) >>> 0);
    }
    return s.size;
  }
  function alphaStats(img) {
    let transparent = 0, partial = 0;
    for (let i = 3; i < img.data.length; i += 4) { if (img.data[i] === 0) transparent++; else if (img.data[i] < 255) partial++; }
    return { transparent, partial, total: img.width * img.height };
  }
  function lsbOneRatio(img) {
    let one = 0, n = 0;
    for (let i = 0; i < img.data.length; i += 4) for (let c = 0; c < 3; c++) { one += img.data[i + c] & 1; n++; }
    return n ? one / n : 0;
  }
  function ber(a, b) {
    const n = Math.min(a.length, b.length);
    let err = 0;
    for (let i = 0; i < n; i++) { let x = a[i] ^ b[i]; while (x) { err += x & 1; x >>= 1; } }
    err += Math.abs(a.length - b.length) * 8;
    return n ? err / (Math.max(a.length, b.length) * 8) : 1;
  }
  function capacities(img) {
    const n = img.width * img.height;
    const rows = [];
    for (const bits of [1, 2]) for (const ch of ['RGB', 'RGBA']) {
      rows.push({ label: `LSB ${bits}bit ${ch}`, bytes: Math.floor(n * (ch === 'RGBA' ? 4 : 3) * bits / 8) });
    }
    rows.push({ label: '文件尾附加', bytes: Infinity });
    rows.push({ label: 'PNG tEXt', bytes: Infinity });
    return rows;
  }
  function entropy(img) {
    const h = new Uint32Array(256);
    for (let i = 0; i < img.data.length; i += 4) for (let c = 0; c < 3; c++) h[img.data[i + c]]++;
    const n = img.width * img.height * 3; let e = 0;
    for (let i = 0; i < 256; i++) if (h[i]) { const p = h[i] / n; e -= p * Math.log2(p); }
    return e;
  }
  SL.core.metrics = { psnr, maxDelta, meanDelta, changedRatio, colorCount, alphaStats, lsbOneRatio, ber, capacities, entropy };
})();
