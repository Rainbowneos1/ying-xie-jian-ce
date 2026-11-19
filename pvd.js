(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.stego = SL.stego || {};
  const B = SL.core.bytes, F = SL.core.frame, RNG = SL.core.RNG;
  const METHOD_ID = 2, FRAME_METHOD = 211, PILOT_SLOTS = F.PILOT_BITS * 4, LIMIT = 200000;
  const RANGES = [[0, 7], [8, 15], [16, 31], [32, 63], [64, 127], [128, 255]];
  const KS = RANGES.map(([a, b]) => Math.round(Math.log2(b - a + 1)));

  function params(p) { p = p || {}; return { key: Number.isFinite(+p.key) ? (+p.key >>> 0) : 42 }; }
  function rangeOf(d) {
    for (let i = 0; i < RANGES.length; i++) if (d <= RANGES[i][1]) return { lo: RANGES[i][0], hi: RANGES[i][1], k: KS[i] };
    return { lo: 128, hi: 255, k: 7 };
  }
  function pairList(img, key) {
    const cand = [];
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x + 1 < img.width; x += 2) { cand.push(y * img.width + x); if (cand.length >= LIMIT) break; }
      if (cand.length >= LIMIT) break;
    }
    const order = new RNG(SL.core.seedFromKey(key ^ 0x51ed270b)).permutation(cand.length);
    return order.map((i) => cand[i]);
  }
  function adjust(p1, p2, dNew) {
    if (p1 >= p2) { const lo = Math.max(0, Math.min(255 - dNew, p2)); return [lo + dNew, lo]; }
    const lo = Math.max(0, Math.min(255 - dNew, p1)); return [lo, lo + dNew];
  }
  function capacity(img, p) {
    p = params(p);
    const pairs = pairList(img, p.key);
    let bits = 0;
    for (const pxy of pairs) {
      const x = pxy % img.width, y = Math.floor(pxy / img.width);
      const d = Math.abs(img.data[(y * img.width + x) * 4] - img.data[(y * img.width + x + 1) * 4]);
      bits += rangeOf(d).k;
    }
    return Math.max(0, Math.floor((bits - PILOT_SLOTS) / 8));
  }
  function writeBits(img, key, bits) {
    const out = new Uint8ClampedArray(img.data);
    const pairs = pairList(img, key);
    let bi = 0;
    for (const pxy of pairs) {
      if (bi >= bits.length) break;
      const x = pxy % img.width, y = Math.floor(pxy / img.width);
      const o1 = (y * img.width + x) * 4, o2 = o1 + 4;
      const p1 = out[o1], p2 = out[o2], d = Math.abs(p1 - p2), rg = rangeOf(d);
      let val = 0;
      for (let j = 0; j < rg.k; j++) val = (val << 1) | (bi + j < bits.length ? bits[bi + j] : 0);
      bi += rg.k;
      const [np1, np2] = adjust(p1, p2, rg.lo + val);
      out[o1] = np1; out[o2] = np2;
    }
    return { width: img.width, height: img.height, data: out, info: img.info, exact: false };
  }
  function readBits(img, key, start, nbits) {
    const pairs = pairList(img, key), out = new Uint8Array(nbits);
    let bi = 0, oi = 0;
    for (const pxy of pairs) {
      if (oi >= nbits) break;
      const x = pxy % img.width, y = Math.floor(pxy / img.width);
      const p1 = img.data[(y * img.width + x) * 4], p2 = img.data[(y * img.width + x + 1) * 4];
      const rg = rangeOf(Math.abs(p1 - p2));
      const val = Math.abs(p1 - p2) - rg.lo;
      for (let j = rg.k - 1; j >= 0; j--) {
        if (bi >= start) out[oi++] = (val >> j) & 1;
        bi++;
        if (oi >= nbits) break;
      }
    }
    return out;
  }
  function repeatedPilotBits(pilot) {
    const raw = B.bytesToBits(pilot), out = new Uint8Array(raw.length * 4);
    for (let i = 0; i < raw.length; i++) for (let r = 0; r < 4; r++) out[i * 4 + r] = raw[i];
    return out;
  }
  function embed(img, payload, p) {
    p = params(p);
    const frame = F.buildFrame(payload, FRAME_METHOD, { bits: 1 });
    const pilot = F.buildPilot({ methodId: METHOD_ID, repeat: 1, ncoef: 0, strength: 0, payloadBits: frame.length * 8, key: p.key });
    const bits = B.concat(repeatedPilotBits(pilot), B.bytesToBits(frame));
    const pairs = pairList(img, p.key);
    let capBits = 0;
    for (const pxy of pairs) {
      const x = pxy % img.width, y = Math.floor(pxy / img.width);
      capBits += rangeOf(Math.abs(img.data[(y * img.width + x) * 4] - img.data[(y * img.width + x + 1) * 4])).k;
    }
    if (bits.length > capBits) throw new Error(`容量不足：需要 ${Math.ceil(bits.length / 8)} 字节（含引导头），可用 ${capacity(img, p)} 字节`);
    return { image: writeBits(img, p.key, bits), frame, pilot, methodId: METHOD_ID, frameMethod: FRAME_METHOD };
  }
  function readPilot(img, p) {
    p = params(p);
    const bits = readBits(img, p.key, 0, PILOT_SLOTS);
    const bytes = new Uint8Array(F.PILOT_LEN);
    for (let i = 0; i < F.PILOT_LEN * 8; i++) {
      let ones = 0; for (let r = 0; r < 4; r++) ones += bits[i * 4 + r];
      if (ones >= 2) bytes[i >> 3] |= 1 << (7 - (i & 7));
    }
    return F.parsePilot(bytes);
  }
  function extract(img, p) {
    p = params(p);
    const pilot = readPilot(img, p);
    if (pilot && pilot.methodId === METHOD_ID && pilot.payloadBits > 0) {
      const bits = readBits(img, p.key, PILOT_SLOTS, pilot.payloadBits);
      const frame = F.parseFrame(B.bitsToBytes(bits));
      if (frame && frame.header.method === FRAME_METHOD) return { frame, pilot };
    }
    if (p.nbits > 0) {
      const bits = readBits(img, p.key, 0, p.nbits);
      const frame = F.parseFrame(B.bitsToBytes(bits));
      if (frame && frame.header.method === FRAME_METHOD) return { frame, pilot: null };
    }
    return null;
  }
  const method = {
    id: 'pvd', label: 'PVD 差分分层', group: '实验鲁棒', lossless: false,
    desc: '水平像素对按差值区间分 3~7 bit 嵌入；大差值边缘承载更多信息。内嵌 WEB1 引导头。',
    params: [{ key: 'key', label: '密钥 key', type: 'number', value: 42, min: 0, max: 4294967295 }],
    capacity, embed, extract, readPilot, methodId: METHOD_ID, frameMethod: FRAME_METHOD
  };
  SL.stego.pvd = method;
  SL.stego.registry.push(method);
})();
