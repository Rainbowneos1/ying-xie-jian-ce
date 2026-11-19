(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.stego = SL.stego || {};
  const B = SL.core.bytes, F = SL.core.frame, D = SL.core.dct, RNG = SL.core.RNG;
  if (!SL.stego.registry) SL.stego.registry = [];

  const METHOD_ID = 3, FRAME_METHOD = 212;
  const MID = [[1, 2], [2, 1], [2, 2], [1, 3], [3, 1], [2, 3], [3, 2], [1, 4]];
  const PILOT_CARRIERS = F.PILOT_BITS * 4;

  function hash32(v) {
    let x = v >>> 0;
    x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
  }
  function signOf(id, key) {
    return (hash32((id ^ SL.core.seedFromKey(key)) + 0x9e3779b9) >>> 31) ? 1 : -1;
  }

  function schedule(img, key, ncoef) {
    const bw = Math.floor(img.width / 8), bh = Math.floor(img.height / 8);
    const nblocks = bw * bh;
    const order = new RNG(SL.core.seedFromKey(key)).permutation(Math.max(1, nblocks));
    return { bw, bh, nblocks, order, ncoef: Math.max(1, Math.min(8, ncoef | 0)), total: nblocks * ncoef };
  }
  function slot(sc, id) {
    const bi = Math.floor(id / sc.ncoef), k = id % sc.ncoef;
    const b = sc.order[bi % sc.nblocks];
    const uv = MID[k] || MID[0];
    return { bx: b % sc.bw, by: Math.floor(b / sc.bw), r: uv[0], c: uv[1], k };
  }

  function params(p) {
    p = p || {};
    return {
      key: Number.isFinite(+p.key) ? (+p.key >>> 0) : 42,
      alpha: Math.max(2, Math.min(80, Math.round(+p.alpha || 12))),
      repeat: Math.max(2, Math.min(24, Math.round(+p.repeat || 8))),
      ncoef: Math.max(1, Math.min(8, Math.round(+p.ncoef || 8)))
    };
  }
  function capacity(img, p) {
    p = params(p);
    const bw = Math.floor(img.width / 8), bh = Math.floor(img.height / 8);
    const usable = bw * bh * p.ncoef - PILOT_CARRIERS;
    return Math.max(0, Math.floor(usable / p.repeat / 8) - 14);
  }

  // bits -> carriers；write(ctx, id, bitSign) 由调用方决定如何落系数
  function applyBits(ctx, sc, bits, startId, repeat, key, write) {
    for (let i = 0; i < bits.length; i++) {
      const bs = bits[i] ? 1 : -1;
      for (let r = 0; r < repeat; r++) {
        const id = startId + i * repeat + r;
        if (id >= sc.total) return false;
        const s = slot(sc, id), sg = signOf(id, key);
        write(ctx, s.bx, s.by, s.r, s.c, bs * sg, id);
      }
    }
    return true;
  }
  function collect(ctx, sc, nbits, startId, repeat, key, read) {
    const bits = new Uint8Array(nbits);
    for (let i = 0; i < nbits; i++) {
      let vote = 0;
      for (let r = 0; r < repeat; r++) {
        const id = startId + i * repeat + r;
        if (id >= sc.total) break;
        const s = slot(sc, id), sg = signOf(id, key);
        vote += sg * read(ctx, s.bx, s.by, s.r, s.c, id);
      }
      bits[i] = vote >= 0 ? 1 : 0;
    }
    return bits;
  }

  function ssWrite(alpha) {
    return function (ctx, bx, by, r, c, target) {
      const cur = D.coef(ctx, bx, by, r, c) * target;
      if (cur < alpha) D.setCoef(ctx, bx, by, r, c, target * alpha);
    };
  }
  function ssRead(ctx, bx, by, r, c, id) {
    const v = D.coef(ctx, bx, by, r, c);
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  }

  function payloadBitsOf(payload, p) {
    const frame = F.buildFrame(payload, FRAME_METHOD, { bits: 1 });
    const pilot = F.buildPilot({ methodId: METHOD_ID, repeat: p.repeat, ncoef: p.ncoef, strength: p.alpha, payloadBits: frame.length * 8, key: p.key });
    const pilotBits = [];
    for (let i = 0; i < F.PILOT_BITS; i++) {
      const b = (pilot[i >> 3] >> (7 - (i & 7))) & 1;
      for (let r = 0; r < 4; r++) pilotBits.push(b);
    }
    return { frame, pilot, bits: Uint8Array.from([...pilotBits, ...B.bytesToBits(frame)]) };
  }

  function embed(img, payload, p) {
    p = params(p);
    const pack = payloadBitsOf(payload, p);
    const sc = schedule(img, p.key, p.ncoef);
    const need = PILOT_CARRIERS + (pack.frame.length * 8) * p.repeat;
    if (need > sc.total) throw new Error(`容量不足：需要 ${need} 个 DCT 载波，可用 ${sc.total}（建议缩小 repeat 或改用更大图片）`);
    let work = img;
    for (let pass = 0; pass < 2; pass++) {
      const ctx = D.dctImage(work), w = ssWrite(p.alpha);
      applyBits(ctx, sc, B.bytesToBits(pack.pilot), 0, 4, p.key, w);
      applyBits(ctx, sc, pack.bits.subarray(PILOT_CARRIERS), PILOT_CARRIERS, p.repeat, p.key, w);
      work = D.composeCoefs(ctx);
    }
    return { image: work, frame: pack.frame, pilot: pack.pilot, methodId: METHOD_ID, frameMethod: FRAME_METHOD };
  }

  function readPilot(img, p) {
    p = params(p);
    const sc = schedule(img, p.key, p.ncoef);
    const ctx = D.dctImage(img);
    const bits = collect(ctx, sc, F.PILOT_BITS, 0, 4, p.key, ssRead);
    return F.parsePilot(B.bitsToBytes(bits));
  }

  function extract(img, p) {
    p = params(p);
    p.ncoef = p.ncoef || 8;
    const sc = schedule(img, p.key, p.ncoef);
    const ctx = D.dctImage(img);
    const pilot = readPilot(img, p);
    let nbits = 0, use = p;
    if (pilot && pilot.methodId === METHOD_ID) { nbits = pilot.payloadBits; use = params(Object.assign({}, p, { repeat: pilot.repeat, ncoef: pilot.ncoef })); }
    else if (p.nbits > 0) { nbits = p.nbits; use = params(Object.assign({}, p, { repeat: pilot ? pilot.repeat : p.repeat })); }
    if (!nbits) return null;
    const sc2 = schedule(img, p.key, use.ncoef);
    const bits = collect(ctx, sc2, nbits, PILOT_CARRIERS, use.repeat, p.key, ssRead);
    const frame = F.parseFrame(B.bitsToBytes(bits));
    if (frame && frame.header.method === FRAME_METHOD) return { frame, pilot };
    return null;
  }

  const method = {
    id: 'dct_ss', label: 'DCT 符号扩频', group: '实验鲁棒', lossless: false,
    desc: '把 bit 转成 8×8 中频系数的符号，用 key 派生的随机符号与载波排列做重复投票。alpha 越大越抗压缩，也越伤画质。',
    params: [
      { key: 'key', label: '密钥 key', type: 'number', value: 42, min: 0, max: 4294967295 },
      { key: 'alpha', label: '幅度 alpha', type: 'number', value: 12, min: 2, max: 80 },
      { key: 'repeat', label: '重复 repeat', type: 'number', value: 8, min: 2, max: 24 },
      { key: 'ncoef', label: '每块载波 ncoef', type: 'number', value: 8, min: 1, max: 8 }
    ],
    capacity, embed, extract, readPilot, methodId: METHOD_ID, frameMethod: FRAME_METHOD
  };
  SL.stego.strong = method;
  SL.stego.dct_ss = method;
  SL.stego.dctUtil = { MID, schedule, slot, signOf, applyBits, collect, params, PILOT_CARRIERS, hash32, ssWrite, ssRead };
  SL.stego.registry.push(method);
})();
