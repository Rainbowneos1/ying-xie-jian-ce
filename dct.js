(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.core = SL.core || {};
  const C = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    const a = u === 0 ? Math.sqrt(1 / 8) : Math.sqrt(2 / 8);
    for (let x = 0; x < 8; x++) C[u * 8 + x] = a * Math.cos((2 * x + 1) * u * Math.PI / 16);
  }

  function dct8(block, out) {
    out = out || new Float64Array(64);
    const tmp = new Float64Array(64);
    for (let u = 0; u < 8; u++) for (let c = 0; c < 8; c++) {
      let s = 0; for (let r = 0; r < 8; r++) s += C[u * 8 + r] * block[r * 8 + c];
      tmp[u * 8 + c] = s;
    }
    for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
      let s = 0; for (let c = 0; c < 8; c++) s += tmp[u * 8 + c] * C[v * 8 + c];
      out[u * 8 + v] = s;
    }
    return out;
  }
  function idct8(coef, out) {
    out = out || new Float64Array(64);
    const tmp = new Float64Array(64);
    for (let r = 0; r < 8; r++) for (let v = 0; v < 8; v++) {
      let s = 0; for (let u = 0; u < 8; u++) s += C[u * 8 + r] * coef[u * 8 + v];
      tmp[r * 8 + v] = s;
    }
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      let s = 0; for (let v = 0; v < 8; v++) s += tmp[r * 8 + v] * C[v * 8 + c];
      out[r * 8 + c] = s;
    }
    return out;
  }

  function ycbcr(img) {
    const n = img.width * img.height, y = new Float64Array(n), cb = new Float64Array(n), cr = new Float64Array(n);
    const d = img.data;
    for (let i = 0; i < n; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      const yy = 0.299 * r + 0.587 * g + 0.114 * b;
      y[i] = yy; cr[i] = 0.713 * (r - yy) + 128; cb[i] = 0.564 * (b - yy) + 128;
    }
    return { y, cb, cr };
  }

  function compose(img, y, cb, cr, regionW, regionH) {
    const w = img.width, h = img.height, out = new Uint8ClampedArray(img.data);
    const rw = regionW == null ? w : Math.min(w, regionW);
    const rh = regionH == null ? h : Math.min(h, regionH);
    for (let r = 0; r < rh; r++) for (let c = 0; c < rw; c++) {
      const i = r * w + c, o = i * 4;
      const yy = Math.max(0, Math.min(255, Math.round(y[i])));
      const crv = cr[i], cbv = cb[i];
      out[o] = Math.max(0, Math.min(255, Math.round(yy + 1.402 * (crv - 128))));
      out[o + 1] = Math.max(0, Math.min(255, Math.round(yy - 0.344136 * (cbv - 128) - 0.714136 * (crv - 128))));
      out[o + 2] = Math.max(0, Math.min(255, Math.round(yy + 1.772 * (cbv - 128))));
    }
    return { width: w, height: h, data: out, info: img.info, exact: false };
  }

  function dctImage(img) {
    const w8 = Math.floor(img.width / 8) * 8, h8 = Math.floor(img.height / 8) * 8;
    const bw = w8 / 8, bh = h8 / 8, n = bw * bh;
    const ycc = ycbcr(img);
    const coefs = new Float64Array(n * 64);
    const block = new Float64Array(64), tmp = new Float64Array(64);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        block[r * 8 + c] = ycc.y[(by * 8 + r) * img.width + bx * 8 + c];
      }
      dct8(block, tmp);
      coefs.set(tmp, (by * bw + bx) * 64);
    }
    return { bw, bh, w8, h8, coefs, y: ycc.y, cb: ycc.cb, cr: ycc.cr, img };
  }

  function composeCoefs(blockCtx) {
    const { bw, bh, w8, h8, coefs, y, cb, cr, img } = blockCtx;
    const block = new Float64Array(64), tmp = new Float64Array(64);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const off = (by * bw + bx) * 64;
      for (let i = 0; i < 64; i++) block[i] = coefs[off + i];
      idct8(block, tmp);
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        y[(by * 8 + r) * img.width + bx * 8 + c] = tmp[r * 8 + c];
      }
    }
    return compose(img, y, cb, cr, w8, h8);
  }

  function coef(ctx, bx, by, r, c) {
    return ctx.coefs[((by * ctx.bw + bx) * 64) + r * 8 + c];
  }
  function setCoef(ctx, bx, by, r, c, v) {
    ctx.coefs[((by * ctx.bw + bx) * 64) + r * 8 + c] = v;
  }

  const S2 = Math.SQRT2;
  function splitLast(a, w, h) {
    const hw = w >> 1, lo = new Float64Array(hw * h), hi = new Float64Array(hw * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < hw; x++) {
      const p = y * w + 2 * x, q = p + 1;
      lo[y * hw + x] = (a[p] + a[q]) / S2;
      hi[y * hw + x] = (a[p] - a[q]) / S2;
    }
    return { lo, hi, w: hw, h };
  }
  function mergeLast(lo, hi, hw, h) {
    const w = hw * 2, out = new Float64Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < hw; x++) {
      const l = lo[y * hw + x], d = hi[y * hw + x];
      out[y * w + 2 * x] = (l + d) / S2;
      out[y * w + 2 * x + 1] = (l - d) / S2;
    }
    return out;
  }
  function transpose(a, w, h) {
    const out = new Float64Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + y] = a[y * w + x];
    return out;
  }
  function dwt2(a, w, h) {
    const hw = w >> 1, hh = h >> 1;
    const row = splitLast(a, w, h);
    const L = splitLast(transpose(row.lo, hw, h), h, hw);
    const H = splitLast(transpose(row.hi, hw, h), h, hw);
    return {
      ll: transpose(L.lo, hh, hw), lh: transpose(L.hi, hh, hw),
      hl: transpose(H.lo, hh, hw), hh: transpose(H.hi, hh, hw), w: hw, h: hh
    };
  }
  function idwt2(b, hw, hh) {
    const h = hh * 2, w = hw * 2;
    const tmpL = mergeLast(transpose(b.ll, hw, hh), transpose(b.lh, hw, hh), hh, hw);
    const tmpH = mergeLast(transpose(b.hl, hw, hh), transpose(b.hh, hw, hh), hh, hw);
    return mergeLast(transpose(tmpL, h, hw), transpose(tmpH, h, hw), hw, h);
  }
  SL.core.dct = { C, dct8, idct8, ycbcr, compose, dctImage, composeCoefs, coef, setCoef, dwt2, idwt2 };
})();
