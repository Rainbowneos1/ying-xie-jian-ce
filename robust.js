(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.stego = SL.stego || {};
  if (!SL.stego.registry) SL.stego.registry = [];
  const B = SL.core.bytes, F = SL.core.frame, D = SL.core.dct, RNG = SL.core.RNG;
  const PC = F.PILOT_BITS * 4, PR = 4;
  const U = () => SL.stego.dctUtil;

  function params(p) {
    p = p || {};
    return {
      key: Number.isFinite(+p.key) ? (+p.key >>> 0) : 42,
      strength: Math.max(4, Math.min(120, Math.round(+p.strength || 20))),
      repeat: Math.max(2, Math.min(24, Math.round(+p.repeat || 4))),
      ncoef: Math.max(1, Math.min(8, Math.round(+p.ncoef || 8))),
      nbits: Math.max(0, Math.round(+p.nbits || 0))
    };
  }
  function packBits(payload, methodId, p, frameMethod) {
    const frame = F.buildFrame(payload, frameMethod, { bits: 1 });
    const pilot = F.buildPilot({
      methodId, repeat: p.repeat, ncoef: p.ncoef, strength: p.strength,
      payloadBits: frame.length * 8, key: p.key
    });
    const pb = [];
    for (let i = 0; i < F.PILOT_BITS; i++) {
      const b = (pilot[i >> 3] >> (7 - (i & 7))) & 1;
      for (let r = 0; r < PR; r++) pb.push(b);
    }
    return { frame, pilot, bits: Uint8Array.from([...pb, ...B.bytesToBits(frame)]) };
  }
  function tasksOf(pack, p) {
    return [
      { startId: 0, bits: B.bytesToBits(pack.pilot), repeat: PR },
      { startId: PC, bits: pack.bits.subarray(PC), repeat: p.repeat }
    ];
  }
  function vote(nbits, repeat, startId, readFn) {
    const bits = new Uint8Array(nbits);
    for (let i = 0; i < nbits; i++) {
      let ones = 0, tot = 0;
      for (let r = 0; r < repeat; r++) {
        const v = readFn(startId + i * repeat + r);
        if (v == null) { tot = 0; break; }
        tot++; ones += v ? 1 : 0;
      }
      bits[i] = tot > 0 && ones * 2 >= tot ? 1 : 0;
    }
    return bits;
  }
  function dctPass(img, tasks, p, write) {
    const sc = U().schedule(img, p.key, p.ncoef);
    let work = img;
    for (let pass = 0; pass < 2; pass++) {
      const ctx = D.dctImage(work);
      for (const t of tasks) for (let i = 0; i < t.bits.length; i++) for (let r = 0; r < t.repeat; r++) {
        const id = t.startId + i * t.repeat + r;
        if (id < sc.total) write(ctx, U().slot(sc, id), t.bits[i]);
      }
      work = D.composeCoefs(ctx);
    }
    return work;
  }
  function dctRead(img, p, nbits, startId, repeat, read) {
    const sc = U().schedule(img, p.key, p.ncoef);
    const ctx = D.dctImage(img);
    return vote(nbits, repeat, startId, (id) => id >= sc.total ? null : read(ctx, U().slot(sc, id)));
  }
  function qimLevel(v, delta, bit) {
    const q0 = Math.round(v / delta);
    let best = q0, bestD = Infinity;
    for (let k = -2; k <= 2; k++) {
      const q = q0 + k;
      if (((q & 1) >>> 0) !== (bit & 1)) continue;
      const d = Math.abs(q - v / delta);
      if (d < bestD) { bestD = d; best = q; }
    }
    return best * delta;
  }
  const qimBit = (v, delta) => (Math.round(v / delta) & 1) >>> 0;
  function dctTotal(img, p) {
    const bw = Math.floor(img.width / 8), bh = Math.floor(img.height / 8);
    return bw * bh * p.ncoef;
  }
  function dctCap(img, p) {
    p = params(p);
    return Math.max(0, Math.floor((dctTotal(img, p) - PC) / p.repeat / 8) - 14);
  }

  /* dct_qim */
  const dctQim = {
    id: 'dct_qim', label: 'DCT-QIM 量化索引', group: '实验鲁棒', lossless: false,
    desc: '把 8×8 中频系数量化到偶数/奇数格点编码 0/1。strength 即量化步长：越大越抗压缩、画质代价越高。',
    methodId: 4, frameMethod: 213,
    params: [
      { key: 'key', label: '密钥 key', type: 'number', value: 42, min: 0, max: 4294967295 },
      { key: 'strength', label: '量化步长', type: 'number', value: 20, min: 4, max: 120 },
      { key: 'repeat', label: '重复 repeat', type: 'number', value: 4, min: 2, max: 24 },
      { key: 'ncoef', label: '每块载波 ncoef', type: 'number', value: 8, min: 1, max: 8 }
    ],
    capacity: dctCap,
    embed(img, payload, p) {
      p = params(p);
      const pack = packBits(payload, 4, p, 213);
      if (dctTotal(img, p) < PC + pack.frame.length * 8 * p.repeat) throw new Error('容量不足：DCT-QIM 载波不够，请降低 repeat 或换更大图片');
      return {
        image: dctPass(img, tasksOf(pack, p), p, (ctx, s, bit) =>
          D.setCoef(ctx, s.bx, s.by, s.r, s.c, qimLevel(D.coef(ctx, s.bx, s.by, s.r, s.c), p.strength, bit))),
        frame: pack.frame, pilot: pack.pilot, methodId: 4, frameMethod: 213
      };
    },
    readPilot(img, p) {
      p = params(p);
      const bits = dctRead(img, p, F.PILOT_BITS, 0, PR, (ctx, s) => qimBit(D.coef(ctx, s.bx, s.by, s.r, s.c), p.strength));
      return F.parsePilot(B.bitsToBytes(bits));
    },
    extract(img, p) { return robustExtract(dctQim, img, p); }
  };

  /* dct_rel —— 关系法每块只用 4 组互不重叠的中频系数对 */
  const PAIRS = [[0, 1], [2, 3], [4, 5], [6, 7]];
  const REL_NCOEF = 4;
  const relParams = (p) => Object.assign({}, params(p), { ncoef: REL_NCOEF });
  function relCoefs(s) {
    const pr = PAIRS[s.k % PAIRS.length];
    const a = U().MID[pr[0]], b = U().MID[pr[1]];
    return a && b ? [a, b] : null;
  }
  function relWrite(ctx, s, bit, T) {
    const uv = relCoefs(s);
    if (!uv) return;
    const ca = D.coef(ctx, s.bx, s.by, uv[0][0], uv[0][1]);
    const cb = D.coef(ctx, s.bx, s.by, uv[1][0], uv[1][1]);
    const sa = ca >= 0 ? 1 : -1, sb = cb >= 0 ? 1 : -1;
    const m = Math.max(T / 2, (Math.abs(ca) + Math.abs(cb)) / 2);
    const hi = m + T / 2, lo = Math.max(0, m - T / 2);
    D.setCoef(ctx, s.bx, s.by, uv[0][0], uv[0][1], sa * (bit ? hi : lo));
    D.setCoef(ctx, s.bx, s.by, uv[1][0], uv[1][1], sb * (bit ? lo : hi));
  }
  function relRead(ctx, s) {
    const uv = relCoefs(s);
    if (!uv) return 0;
    return Math.abs(D.coef(ctx, s.bx, s.by, uv[0][0], uv[0][1])) >
      Math.abs(D.coef(ctx, s.bx, s.by, uv[1][0], uv[1][1])) ? 1 : 0;
  }
  const dctRel = {
    id: 'dct_rel', label: 'DCT 关系法', group: '实验鲁棒', lossless: false,
    desc: '用同一块内两组中频系数的幅度大小关系编码 bit；关系法隐写分析看到的“梳齿”正是这种比值分布。',
    methodId: 5, frameMethod: 214,
    params: [
      { key: 'key', label: '密钥 key', type: 'number', value: 42, min: 0, max: 4294967295 },
      { key: 'strength', label: '幅度差 T', type: 'number', value: 20, min: 4, max: 120 },
      { key: 'repeat', label: '重复 repeat', type: 'number', value: 4, min: 2, max: 24 },
      { key: 'ncoef', label: '每块载波 ncoef', type: 'number', value: 4, min: 1, max: 4 }
    ],
    capacity(img, p) { return dctCap(img, relParams(p)); },
    embed(img, payload, p) {
      p = relParams(p);
      const pack = packBits(payload, 5, p, 214);
      if (dctTotal(img, p) < PC + pack.frame.length * 8 * p.repeat) throw new Error('容量不足：关系法载波不够，请降低 repeat 或换更大图片');
      return {
        image: dctPass(img, tasksOf(pack, p), p, (ctx, s, bit) => relWrite(ctx, s, bit, p.strength)),
        frame: pack.frame, pilot: pack.pilot, methodId: 5, frameMethod: 214
      };
    },
    readPilot(img, p) {
      p = relParams(p);
      return F.parsePilot(B.bitsToBytes(dctRead(img, p, F.PILOT_BITS, 0, PR, relRead)));
    },
    extract(img, p) { return robustExtract(dctRel, img, p); }
  };

  dctQim.readBits = (img, p, nbits, startId, repeat) =>
    dctRead(img, p, nbits, startId, repeat, (ctx, s) => qimBit(D.coef(ctx, s.bx, s.by, s.r, s.c), params(p).strength));
  dctRel.readBits = (img, p, nbits, startId, repeat) =>
    dctRead(img, relParams(p), nbits, startId, repeat, relRead);

  /* dwt_qim */
  function dwtCtx(img) {
    const w2 = img.width - (img.width & 1), h2 = img.height - (img.height & 1);
    if (w2 < 16 || h2 < 16) throw new Error('图片过小：DWT-QIM 至少需要 16×16');
    const ycc = D.ycbcr(img);
    const y = new Float64Array(w2 * h2);
    for (let r = 0; r < h2; r++) for (let c = 0; c < w2; c++) y[r * w2 + c] = ycc.y[r * img.width + c];
    const b = D.dwt2(y, w2, h2);
    return { ycc, w2, h2, b, n: b.w * b.h, total: 2 * b.w * b.h };
  }
  function dwtSlot(d, id) {
    return id < d.n ? { arr: d.b.lh, i: id } : { arr: d.b.hl, i: id - d.n };
  }
  function expandY(y2, w2, h2, img, ysrc) {
    const y = new Float64Array(ysrc);
    for (let r = 0; r < h2; r++) for (let c = 0; c < w2; c++) y[r * img.width + c] = y2[r * w2 + c];
    return y;
  }
  const dwtQim = {
    id: 'dwt_qim', label: 'DWT-QIM 小波细节', group: '实验鲁棒', lossless: false,
    desc: '对 Y 通道做一级 Haar 小波，在 LH/HL 细节系数上做 QIM。载波量大，但对缩放与强压缩不鲁棒。',
    methodId: 6, frameMethod: 215,
    params: [
      { key: 'key', label: '密钥 key', type: 'number', value: 42, min: 0, max: 4294967295 },
      { key: 'strength', label: '量化步长', type: 'number', value: 20, min: 4, max: 120 },
      { key: 'repeat', label: '重复 repeat', type: 'number', value: 4, min: 2, max: 24 }
    ],
    capacity(img, p) {
      p = params(p);
      const w2 = img.width - (img.width & 1), h2 = img.height - (img.height & 1);
      const total = 2 * (w2 >> 1) * (h2 >> 1);
      return Math.max(0, Math.floor((total - PC) / p.repeat / 8) - 14);
    },
    embed(img, payload, p) {
      p = params(p);
      const pack = packBits(payload, 6, p, 215);
      let work = img, first = dwtCtx(img);
      if (first.total < PC + pack.frame.length * 8 * p.repeat) throw new Error('容量不足：DWT-QIM 细节系数不够');
      const order = new RNG(SL.core.seedFromKey(p.key)).permutation(first.total);
      for (let pass = 0; pass < 2; pass++) {
        const d = pass === 0 ? first : dwtCtx(work);
        for (const t of tasksOf(pack, p)) for (let i = 0; i < t.bits.length; i++) for (let r = 0; r < t.repeat; r++) {
          const id = t.startId + i * t.repeat + r;
          if (id >= d.total) continue;
          const s = dwtSlot(d, order[id]);
          s.arr[s.i] = qimLevel(s.arr[s.i], p.strength, t.bits[i]);
        }
        const y2 = D.idwt2(d.b, d.b.w, d.b.h);
        work = D.compose(img, expandY(y2, d.w2, d.h2, img, d.ycc.y), d.ycc.cb, d.ycc.cr);
      }
      return { image: work, frame: pack.frame, pilot: pack.pilot, methodId: 6, frameMethod: 215 };
    },
    readPilot(img, p) {
      p = params(p);
      const d = dwtCtx(img);
      const order = new RNG(SL.core.seedFromKey(p.key)).permutation(d.total);
      const bits = vote(F.PILOT_BITS, PR, 0, (id) => {
        if (id >= d.total) return null;
        const s = dwtSlot(d, order[id]);
        return qimBit(s.arr[s.i], p.strength);
      });
      return F.parsePilot(B.bitsToBytes(bits));
    },
    readBits(img, p, nbits, startId, repeat) {
      p = params(p);
      const d = dwtCtx(img);
      const order = new RNG(SL.core.seedFromKey(p.key)).permutation(d.total);
      return vote(nbits, repeat, startId, (id) => {
        if (id >= d.total) return null;
        const s = dwtSlot(d, order[id]);
        return qimBit(s.arr[s.i], p.strength);
      });
    },
    extract(img, p) { return robustExtract(dwtQim, img, p); }
  };

  /* blk_qim */
  function blkCtx(img) {
    const bw = Math.floor(img.width / 8), bh = Math.floor(img.height / 8);
    if (!bw || !bh) throw new Error('图片过小：块均值 QIM 至少需要 8×8');
    return { ycc: D.ycbcr(img), bw, bh, total: bw * bh };
  }
  function blkMean(d, bx, by) {
    let s = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) s += d.ycc.y[(by * 8 + r) * d.w + bx * 8 + c];
    return s / 64;
  }
  const blkQim = {
    id: 'blk_qim', label: '块均值 QIM', group: '实验鲁棒', lossless: false,
    desc: '直接对 8×8 块的平均亮度做 QIM，抗噪声强但会产生可见的方块明暗，仅用于教学演示。',
    methodId: 7, frameMethod: 216,
    params: [
      { key: 'key', label: '密钥 key', type: 'number', value: 42, min: 0, max: 4294967295 },
      { key: 'strength', label: '量化步长', type: 'number', value: 20, min: 4, max: 120 },
      { key: 'repeat', label: '重复 repeat', type: 'number', value: 4, min: 2, max: 24 }
    ],
    capacity(img, p) {
      p = params(p);
      const total = Math.floor(img.width / 8) * Math.floor(img.height / 8);
      return Math.max(0, Math.floor((total - PC) / p.repeat / 8) - 14);
    },
    embed(img, payload, p) {
      p = params(p);
      const pack = packBits(payload, 7, p, 216);
      const first = blkCtx(img);
      if (first.total < PC + pack.frame.length * 8 * p.repeat) throw new Error('容量不足：块均值 QIM 块数不够');
      const order = new RNG(SL.core.seedFromKey(p.key)).permutation(first.total);
      let work = img;
      for (let pass = 0; pass < 2; pass++) {
        const d = blkCtx(work);
        d.w = img.width;
        const y = new Float64Array(d.ycc.y);
        for (const t of tasksOf(pack, p)) for (let i = 0; i < t.bits.length; i++) for (let r = 0; r < t.repeat; r++) {
          const id = t.startId + i * t.repeat + r;
          if (id >= d.total) continue;
          const b = order[id], bx = b % d.bw, by = Math.floor(b / d.bw);
          const m = blkMean(d, bx, by);
          const delta = qimLevel(m, p.strength, t.bits[i]) - m;
          for (let rr = 0; rr < 8; rr++) for (let cc = 0; cc < 8; cc++) y[(by * 8 + rr) * img.width + bx * 8 + cc] += delta;
        }
        work = D.compose(img, y, d.ycc.cb, d.ycc.cr);
      }
      return { image: work, frame: pack.frame, pilot: pack.pilot, methodId: 7, frameMethod: 216 };
    },
    readPilot(img, p) {
      p = params(p);
      const d = blkCtx(img); d.w = img.width;
      const order = new RNG(SL.core.seedFromKey(p.key)).permutation(d.total);
      const bits = vote(F.PILOT_BITS, PR, 0, (id) => {
        if (id >= d.total) return null;
        const b = order[id];
        return qimBit(blkMean(d, b % d.bw, Math.floor(b / d.bw)), p.strength);
      });
      return F.parsePilot(B.bitsToBytes(bits));
    },
    readBits(img, p, nbits, startId, repeat) {
      p = params(p);
      const d = blkCtx(img); d.w = img.width;
      const order = new RNG(SL.core.seedFromKey(p.key)).permutation(d.total);
      return vote(nbits, repeat, startId, (id) => {
        if (id >= d.total) return null;
        const b = order[id];
        return qimBit(blkMean(d, b % d.bw, Math.floor(b / d.bw)), p.strength);
      });
    },
    extract(img, p) { return robustExtract(blkQim, img, p); }
  };

  function robustExtract(m, img, p) {
    p = params(p);
    const pilot = m.readPilot(img, p);
    if (pilot && pilot.methodId === m.methodId && pilot.payloadBits > 0) {
      const use = Object.assign({}, p, { repeat: pilot.repeat, ncoef: pilot.ncoef, strength: pilot.strength });
      const bits = m.readBits(img, use, pilot.payloadBits, PC, use.repeat);
      const frame = F.parseFrame(B.bitsToBytes(bits));
      if (frame && frame.header.method === m.frameMethod) return { frame, pilot };
    }
    if (p.nbits > 0) {
      const bits = m.readBits(img, p, p.nbits, PC, PR);
      const frame = F.parseFrame(B.bitsToBytes(bits));
      if (frame) return { frame, pilot: null };
    }
    return null;
  }

  SL.stego.dct_qim = dctQim;
  SL.stego.dct_rel = dctRel;
  SL.stego.dwt_qim = dwtQim;
  SL.stego.blk_qim = blkQim;
  SL.stego.registry.push(dctQim, dctRel, dwtQim, blkQim);
  SL.stego.robustCommon = { params, packBits, vote, PC, PR };
})();
