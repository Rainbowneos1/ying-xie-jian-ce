(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.stego = SL.stego || {};
  const F = SL.core.frame;

  function probe(bytes) {
    if (!bytes) return null;
    let pos = -1;
    while ((pos = bytes.indexOf(0x53, pos + 1)) >= 0) {
      if (pos + 4 > bytes.length) continue;
      if (bytes[pos] !== 0x53 || bytes[pos + 1] !== 0x54 || bytes[pos + 2] !== 0x47 || bytes[pos + 3] !== 0x31) continue;
      const f = F.parseFrame(bytes, pos);
      if (f && f.header.method === 2) return f;
    }
    return null;
  }
  async function embed(img, payload) {
    const frame = F.buildFrame(payload, 2, { bits: 1 });
    const base = img.bytes || await SL.core.image.encode(img);
    return { bytes: SL.core.bytes.concat(base, frame), frame, frameLength: frame.length };
  }
  const method = {
    id: 'append', label: '文件尾附加', group: '无损', lossless: true,
    desc: '把 STG1 帧直接追加到 IEND / 文件尾之后；容量几乎无限，但最容易被容器检测发现。',
    params: [],
    capacity: () => Infinity, embed, probe
  };
  SL.stego.append = method;
  SL.stego.registry.push(method);
})();
