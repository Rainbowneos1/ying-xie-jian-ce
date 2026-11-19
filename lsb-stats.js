(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.analysis = SL.analysis || {};

  function phi(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }
  function chi2Survival(x, df) {
    const z = (Math.pow(x / df, 1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
    return 1 - phi(z);
  }

  function lsbStats(img) {
    const d = img.data, n = img.width * img.height;
    const ones = [0, 0, 0], planes = [0, 0, 0];
    let allOnes = 0, allBits = 0;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) if (d[i * 4 + c] & 1) ones[c]++;
    }
    for (let c = 0; c < 3; c++) {
      ones[c] /= Math.max(1, n);
      allOnes += ones[c]; allBits++;
    }
    let ent = 0;
    for (let c = 0; c < 3; c++) {
      const p = ones[c];
      if (p > 0 && p < 1) ent += -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p)) / 3;
    }
    return { channels: ones, one: allOnes / allBits, entropy: ent };
  }

  function chi2Attack(img) {
    const d = img.data, n = img.width * img.height;
    let chi = 0, df = 0;
    const res = [];
    for (let c = 0; c < 3; c++) {
      const hist = new Float64Array(256);
      for (let i = 0; i < n; i++) hist[d[i * 4 + c]]++;
      let ch = 0;
      for (let v = 0; v < 256; v += 2) {
        const obs = hist[v] + hist[v + 1];
        if (obs < 5) continue;
        const exp = obs / 2;
        ch += (hist[v] - exp) * (hist[v] - exp) / exp;
      }
      res.push({ chi2: ch, p: chi2Survival(ch, 127) });
      chi += ch; df += 127;
    }
    return { channels: res, chi2: chi / 3, p: chi2Survival(chi / 3, 127), df: 127 };
  }
  const f1 = (x) => x ^ 1;
  const fm1 = (x) => { const y = ((x + 1) ^ 1) - 1; return y < 0 ? 0 : (y > 255 ? 255 : y); };

  function rsAnalysis(img) {
    const d = img.data, w = img.width, h = img.height;
    const step = h > 900 ? Math.ceil(h / 900) : 1;
    const MASK = [0, 1, 1, 0];
    let own = 0, rp = 0, sp = 0, rn = 0, sn = 0;
    const g = [0, 0, 0, 0], gp = [0, 0, 0, 0], gn = [0, 0, 0, 0];
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x + 3 < w; x += 4) {
        for (let k = 0; k < 4; k++) {
          const o = (y * w + x + k) * 4;
          const v = d[o] + d[o + 1] + d[o + 2];
          g[k] = v / 3;
          gp[k] = MASK[k] ? f1(d[o]) : d[o];
          gn[k] = MASK[k] ? fm1(d[o]) : d[o];
        }
        const f0 = Math.abs(g[0] - g[1]) + Math.abs(g[1] - g[2]) + Math.abs(g[2] - g[3]);
        const fp = Math.abs(gp[0] - gp[1]) + Math.abs(gp[1] - gp[2]) + Math.abs(gp[2] - gp[3]);
        const fn = Math.abs(gn[0] - gn[1]) + Math.abs(gn[1] - gn[2]) + Math.abs(gn[2] - gn[3]);
        own++;
        if (fp > f0) rp++; else if (fp < f0) sp++;
        if (fn > f0) rn++; else if (fn < f0) sn++;
      }
    }
    const N = Math.max(1, own);
    return { Rm: rp / N, Sm: sp / N, Rn: rn / N, Sn: sn / N, diff: (rp - sp) / N, diffN: (rn - sn) / N, asym: ((rp - sp) - (rn - sn)) / N };
  }

  function spaStat(img) {
    const d = img.data, w = img.width, h = img.height;
    const step = h > 900 ? Math.ceil(h / 900) : 1;
    const even = new Float64Array(256), odd = new Float64Array(256);
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x + 1 < w; x++) {
        const a = d[(y * w + x) * 4], b = d[(y * w + x + 1) * 4];
        const lo = a < b ? a : b, hi = a < b ? b : a;
        const m = (lo + hi) >> 1;
        if (((hi - lo) & 1) === 0) even[m]++; else odd[m]++;
      }
    }
    let diff = 0, total = 0;
    for (let m = 1; m < 255; m++) {
      diff += Math.abs(even[m] - odd[m]);
      total += even[m] + odd[m];
    }
    return { imbalance: total ? diff / total : 0, total };
  }

  function pvdStat(img) {
    const d = img.data, w = img.width, h = img.height;
    const R = [7, 15, 31, 63, 127, 255];
    const counts = [0, 0, 0, 0, 0, 0];
    let total = 0;
    const step = h > 900 ? Math.ceil(h / 900) : 1;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x + 1 < w; x += 2) {
        const a = d[(y * w + x) * 4], b = d[(y * w + x + 1) * 4];
        const diff = Math.abs(a - b);
        for (let i = 0; i < 6; i++) if (diff <= R[i]) { counts[i]++; break; }
        total++;
      }
    }
    return { counts, total, smallRatio: total ? counts[0] / total : 0 };
  }

  function stats(img) {
    const lsb = lsbStats(img);
    const chi = chi2Attack(img);
    const rs = rsAnalysis(img);
    const spa = spaStat(img);
    const pvd = pvdStat(img);
    const flat = {
      lsbOne: lsb.one, lsbEntropy: lsb.entropy,
      chi2p: chi.p, rsDiff: rs.diff, rsDiffN: rs.diffN, rsAsym: rs.asym,
      spaImbalance: spa.imbalance, pvdSmall: pvd.smallRatio
    };
    return { lsb, chi, rs, spa, pvd, flat };
  }

  function tileStats(img, tiles) {
    const list = [];
    const tw = Math.max(64, Math.floor(img.width / 3)), th = Math.max(64, Math.floor(img.height / 3));
    for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) {
      const x0 = tx * tw, y0 = ty * th;
      const w = Math.min(tw, img.width - x0), h = Math.min(th, img.height - y0);
      if (w < 64 || h < 64) continue;
      const sub = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), info: img.info };
      for (let r = 0; r < h; r++) sub.data.set(img.data.subarray(((y0 + r) * img.width + x0) * 4, ((y0 + r) * img.width + x0 + w) * 4), r * w * 4);
      list.push(stats(sub).flat);
      if (list.length >= (tiles || 9)) break;
    }
    return list;
  }
  function calibrate(img, refImg) {
    const tiles = tileStats(refImg, 9);
    if (tiles.length < 2) return null;
    const main = stats(img).flat;
    const keys = Object.keys(main), out = {};
    for (const k of keys) {
      const vals = tiles.map((t) => t[k]).filter((v) => Number.isFinite(v));
      if (!vals.length) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, vals.length - 1));
      const floor = Math.max(1e-6, Math.abs(mean) * 0.005);
      const sigma = Math.max(sd, floor);
      out[k] = { value: main[k], mean, sd, z: (main[k] - mean) / sigma };
    }
    return { keys: out, tiles: tiles.length };
  }

  SL.analysis.lsbStats = { stats, calibrate, tileStats, chi2Survival, lsbStats, chi2Attack, rsAnalysis, spaStat, pvdStat };
})();
