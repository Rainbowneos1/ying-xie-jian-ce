(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.core = SL.core || {};
  const B = SL.core.bytes, crc32 = SL.core.crc32;
  const MAGIC = 'STG1';
  const FLAG_SPLIT = 1, FLAG_RGBA = 2, FLAG_OPAQUE = 4;
  const PILOT_MAGIC = 'WEB1';
  const PILOT_LEN = 20;
  const PILOT_BITS = PILOT_LEN * 8;
  const PILOT_REPEAT = 8;

  function crc16(data) {
    let c = 0xffff;
    for (let i = 0; i < data.length; i++) {
      c ^= data[i] << 8;
      for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    }
    return c & 0xffff;
  }

  function buildFrame(payload, method, opts) {
    opts = opts || {};
    payload = payload instanceof Uint8Array ? payload : new Uint8Array(payload || []);
    const split = opts.split || null;
    const flags = (split ? FLAG_SPLIT : 0) | (opts.rgba ? FLAG_RGBA : 0) | (opts.opaque ? FLAG_OPAQUE : 0) |
      ((((opts.bits || 1) - 1) & 3) << 3);
    const head = new Uint8Array(10);
    for (let i = 0; i < 4; i++) head[i] = MAGIC.charCodeAt(i);
    head[4] = method & 255; head[5] = flags & 255;
    B.w32be(head, 6, payload.length + 4);
    const ext = new Uint8Array(split ? 8 : 0);
    if (split) {
      B.w16be(ext, 0, split.total); B.w16be(ext, 2, split.index);
      B.w32be(ext, 4, split.session >>> 0);
    }
    // CRC32 覆盖「头 + 可选分片头 + 载荷」，与 Python stego_common.build_frame 一致
    const body = B.concat(head, ext, payload);
    const crc = new Uint8Array(4); B.w32be(crc, 0, crc32(body));
    return B.concat(body, crc);
  }

  function parseHeader(bytes, offset) {
    offset = offset || 0;
    if (bytes.length - offset < 10) return null;
    if (B.ascii(bytes, offset, 4) !== MAGIC) return null;
    const method = bytes[offset + 4], flags = bytes[offset + 5];
    const payloadLen = B.u32be(bytes, offset + 6);
    const split = !!(flags & FLAG_SPLIT);
    const extLen = split ? 8 : 0;
    const total = 10 + extLen + payloadLen;
    const h = {
      method, flags, payloadLen, split, extLen, total,
      bits: ((flags >>> 3) & 3) + 1,
      rgba: !!(flags & FLAG_RGBA), opaque: !!(flags & FLAG_OPAQUE),
      splitTotal: 0, splitIndex: 0, session: 0
    };
    if (split) {
      if (bytes.length - offset < 18) return h;
      h.splitTotal = B.u16be(bytes, offset + 10);
      h.splitIndex = B.u16be(bytes, offset + 12);
      h.session = B.u32be(bytes, offset + 14);
    }
    return h;
  }

  function parseFrame(bytes, offset) {
    offset = offset || 0;
    const h = parseHeader(bytes, offset);
    if (!h) return null;
    if (bytes.length - offset < h.total) return null;
    const dataStart = offset + 10 + h.extLen;
    const payload = bytes.subarray(dataStart, dataStart + h.payloadLen - 4);
    const crcAt = dataStart + h.payloadLen - 4;
    const want = B.u32be(bytes, crcAt);
    // 与 buildFrame 对称：CRC 覆盖头 + 分片头 + 载荷
    const got = crc32(bytes.subarray(offset, crcAt));
    return { ok: want === got, header: h, payload, crc: want, crcOk: want === got, length: h.total, offset };
  }

  function buildPilot(info) {
    const d = new Uint8Array(PILOT_LEN);
    for (let i = 0; i < 4; i++) d[i] = PILOT_MAGIC.charCodeAt(i);
    d[4] = 1;
    d[5] = info.methodId & 255;
    d[6] = info.repeat & 255;
    d[7] = info.ncoef & 255;
    B.w16be(d, 8, info.strength & 0xffff);
    B.w32be(d, 10, info.payloadBits >>> 0);
    B.w32be(d, 14, info.key >>> 0);
    B.w16be(d, 18, crc16(d.subarray(0, 18)));
    return d;
  }

  function parsePilot(bytes) {
    if (!bytes || bytes.length < PILOT_LEN) return null;
    for (let i = 0; i < 4; i++) if (bytes[i] !== PILOT_MAGIC.charCodeAt(i)) return null;
    if (bytes[4] !== 1) return null;
    const crc = B.u16be(bytes, 18);
    if (crc !== crc16(bytes.subarray(0, 18))) return null;
    return {
      methodId: bytes[5], repeat: bytes[6], ncoef: bytes[7],
      strength: B.u16be(bytes, 8), payloadBits: B.u32be(bytes, 10),
      key: B.u32be(bytes, 14)
    };
  }

  function methodName(m) {
    return ({ 1: 'LSB', 2: 'APPEND', 3: 'TEXT' })[m] || ('ROBUST-' + m);
  }

  SL.core.frame = {
    MAGIC, PILOT_MAGIC, PILOT_LEN, PILOT_BITS, PILOT_REPEAT,
    FLAG_SPLIT, FLAG_RGBA, FLAG_OPAQUE,
    buildFrame, parseFrame, parseHeader, buildPilot, parsePilot, crc16, methodName
  };
})();
