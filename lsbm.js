(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.stego = SL.stego || {};
  const B = SL.core.bytes, F = SL.core.frame, RNG = SL.core.RNG;
  const METHOD_ID = 1, FRAME_METHOD = 210, PILOT_SLOTS = F.PILOT_BITS * 4;

  function params(p) {
    p = p || {};
    return { key: Number.isFinite(+p.key) ? (+p.key >>> 0) : 42 };
  }
  function capacity(img) {
    const bits = img.width * img.height * 3;
    return Math.max(0, Math.floor((bits - PILOT_SLOTS) / 8));
  }
  function slotBits(img, key, offset, nbits) {
    const npx = img.width * img.height, total = npx * 3;
    const slots = new RNG(SL.core.seedFromKey(key)).permutation(total);
    const out = new Uint8Array(nbits);
    for (let i = 0; i < nbits; i++) {
      const s = slots[offset + i];
      const ch = Math.floor(s / npx), px = s % npx;
      out[i] = img.data[px * 4 + ch] & 1;
    }
    return out;
  }
  function embedBits(img, key, bits) {
    const npx = img.width * img.height, total = npx * 3;
    if (bits.length > total) throw new Error('LSBM 容量不足');
    const out = new Uint8ClampedArray(img.data);
    const slots = new RNG(SL.core.seedFromKey(key)).permutation(total);
    const dirs = new RNG(SL.core.seedFromKey(key ^ 0x9e3779b9));
    for (let i = 0; i < bits.length; i++) {
      const s = slots[i], ch = Math.floor(s / npx), px = s % npx, o = px * 4 + ch;
      const cur = out[o];
      const d = dirs.nextU32() & 1;
      if ((cur & 1) !== bits[i]) {
        if (d === 0) out[o] = cur < 255 ? cur + 1 : cur - 1;
        else out[o] = cur > 0 ? cur - 1 : cur + 1;
      }
    }
    return { width: img.width, height: img.height, data: out, info: img.info, exact: false };
  }
  function embed(img, payload, p) {
    p = params(p);
    const frame = F.buildFrame(payload, FRAME_METHOD, { bits: 1 });
    const pilot = F.buildPilot({ methodId: METHOD_ID, repeat: 1, ncoef: 0, strength: 0, payloadBits: frame.length * 8, key: p.key });
    const pilotBits = [];
    for (let i = 0; i < pilot.length * 8; i++) {
      const b = (pilot[i >> 3] >> (7 - (i & 7))) & 1;
      for (let r = 0; r < 4; r++) pilotBits.push(b);
    }
    const bits = Uint8Array.from([...pilotBits, ...B.bytesToBits(frame)]);
    if (bits.length > img.width * img.height * 3) throw new Error(`容量不足：需要 ${Math.ceil(bits.length / 8)} 字节（含引导头），可用 ${capacity(img)} 字节`);
    return { image: embedBits(img, p.key, bits), frame, pilot, methodId: METHOD_ID, frameMethod: FRAME_METHOD };
  }
  function readPilot(img, p) {
    p = params(p);
    const bits = slotBits(img, p.key, 0, PILOT_SLOTS);
    const bytes = new Uint8Array(F.PILOT_LEN);
    for (let i = 0; i < F.PILOT_LEN * 8; i++) {
      let ones = 0;
      for (let r = 0; r < 4; r++) ones += bits[i * 4 + r];
      if (ones >= 2) bytes[i >> 3] |= 1 << (7 - (i & 7));
    }
    return F.parsePilot(bytes);
  }
  function extract(img, p) {
    p = params(p);
    const pilot = readPilot(img, p);
    if (pilot && pilot.methodId === METHOD_ID && pilot.payloadBits > 0) {
      const frameBits = slotBits(img, p.key, PILOT_SLOTS, pilot.payloadBits);
      const frame = F.parseFrame(B.bitsToBytes(frameBits));
      if (frame && frame.header.method === FRAME_METHOD) return { frame, pilot };
    }
    if (p.nbits > 0) {
      const bits = slotBits(img, p.key, 0, p.nbits);
      const frame = F.parseFrame(B.bitsToBytes(bits));
      if (frame && frame.header.method === FRAME_METHOD) return { frame, pilot: null };
    }
    return null;
  }
  const method = {
    id: 'lsbm', label: 'LSBM ±1 匹配', group: '实验鲁棒', lossless: false,
    desc: 'key 决定槽位，LSB 不匹配时随机 ±1；消除值对卡方指纹，但仍不抗重编码。内嵌 WEB1 引导头便于自动提取。',
    params: [{ key: 'key', label: '密钥 key', type: 'number', value: 42, min: 0, max: 4294967295 }],
    capacity, embed, extract, readPilot, methodId: METHOD_ID, frameMethod: FRAME_METHOD
  };
  SL.stego.lsbm = method;
  SL.stego.registry.push(method);
})();
