(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.stego = SL.stego || {};
  const B = SL.core.bytes, L = SL.core.lsb, F = SL.core.frame;

  function paramsOf(p) {
    p = p || {};
    const bits = Number(p.bits) === 2 ? 2 : 1;
    const channels = p.channels === 'RGBA' ? 'RGBA' : 'RGB';
    const opaque = !!p.opaque;
    return { bits, channels, opaque };
  }
  function frameOpts(p, split) {
    return { bits: p.bits, rgba: p.channels === 'RGBA', opaque: p.opaque, split };
  }
  function capacity(img, p) {
    p = paramsOf(p);
    return L.capacityBytes(img, p.bits, p.channels, p.opaque);
  }
  function embedOne(img, payload, p, split) {
    p = paramsOf(p);
    const frame = F.buildFrame(payload, 1, frameOpts(p, split));
    if (frame.length * 8 > capacity(img, p) * 8) throw new Error(`容量不足：需要 ${frame.length} 字节，可用 ${capacity(img, p)} 字节`);
    const out = L.embed(img, p.bits, p.channels, p.opaque, B.bytesToBits(frame));
    return { image: out, frame, frameLength: frame.length };
  }
  function readFrame(img, p) {
    p = paramsOf(p);
    const cap = capacity(img, p);
    if (cap < 10) return null;
    const head = L.readBytes(img, 10, p.bits, p.channels, p.opaque);
    const h = F.parseHeader(head);
    if (!h || h.method !== 1) return null;
    if (h.total > cap) return null;
    const all = L.readBytes(img, h.total, p.bits, p.channels, p.opaque);
    return F.parseFrame(all);
  }
  function embedSplit(covers, payload, p) {
    p = paramsOf(p);
    const minCap = Math.min(...covers.map((c) => capacity(c, p)));
    const per = minCap - 22;
    if (per <= 0) throw new Error('载体容量不足，无法分片');
    const total = Math.ceil(payload.length / per) || 1;
    if (total > 255) throw new Error('载荷过大：分片数超过 255');
    const session = B.randomU32();
    const images = [];
    for (let i = 0; i < total; i++) {
      const chunk = payload.subarray(i * per, Math.min(payload.length, (i + 1) * per));
      const r = embedOne(covers[i], chunk, p, { total, index: i, session });
      r.image.fileName = covers[i].fileName;
      r.index = i; r.total = total; r.session = session;
      images.push(r);
    }
    return { images, total, session, per, frameLength: per + 22 };
  }
  const method = {
    id: 'lsb', label: 'LSB 低位嵌入', group: '无损', lossless: true,
    desc: '按通道优先逐像素写低位；STG1 帧头 + CRC32，输出后强制回读逐字节自检。',
    params: [
      { key: 'bits', label: '每通道位数', type: 'select', options: [[1, '1 bit'], [2, '2 bit']], value: 1 },
      { key: 'channels', label: '写入通道', type: 'select', options: [['RGB', 'RGB'], ['RGBA', 'RGBA（会改 Alpha）']], value: 'RGB' },
      { key: 'opaque', label: '仅不透明像素', type: 'checkbox', value: true }
    ],
    capacity, embedOne, readFrame, embedSplit
  };
  SL.stego.lsb = method;
  SL.stego.registry = SL.stego.registry || [];
  SL.stego.registry.push(method);
})();
