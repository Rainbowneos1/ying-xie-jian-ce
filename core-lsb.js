(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.core = SL.core || {};

  function pixelIndices(img, opaque) {
    if (!opaque) {
      const a = new Uint32Array(img.width * img.height);
      for (let i = 0; i < a.length; i++) a[i] = i;
      return a;
    }
    const tmp = [];
    for (let i = 0; i < img.width * img.height; i++) if (img.data[i * 4 + 3] > 0) tmp.push(i);
    return Uint32Array.from(tmp);
  }
  function capacityBytes(img, bits, channels, opaque) {
    const n = opaque ? pixelIndices(img, true).length : img.width * img.height;
    return Math.floor(n * (channels === 'RGBA' ? 4 : 3) * bits / 8);
  }
  function embed(img, bits, channels, opaque, bitData) {
    const out = new Uint8ClampedArray(img.data);
    const idx = pixelIndices(img, opaque);
    const ch = channels === 'RGBA' ? 4 : 3;
    let p = 0;
    const mask = bits === 1 ? 0xfe : 0xfc;
    for (let c = 0; c < ch; c++) for (let i = 0; i < idx.length; i++) {
      const o = idx[i] * 4 + c;
      if (bits === 1) {
        const b = p < bitData.length ? bitData[p++] : 0;
        out[o] = (out[o] & mask) | b;
      } else {
        const b1 = p < bitData.length ? bitData[p++] : 0;
        const b0 = p < bitData.length ? bitData[p++] : 0;
        out[o] = (out[o] & mask) | (b1 << 1) | b0;
      }
    }
    return { width: img.width, height: img.height, data: out, info: img.info, exact: false };
  }
  function readBits(img, bits, channels, opaque, nbits) {
    const idx = pixelIndices(img, opaque);
    const ch = channels === 'RGBA' ? 4 : 3;
    const out = new Uint8Array(nbits);
    let p = 0;
    for (let c = 0; c < ch && p < nbits; c++) for (let i = 0; i < idx.length && p < nbits; i++) {
      const o = idx[i] * 4 + c;
      for (let b = bits - 1; b >= 0 && p < nbits; b--) out[p++] = (img.data[o] >> b) & 1;
    }
    while (p < nbits) out[p++] = 0;
    return out;
  }
  function readBytes(img, nbytes, bits, channels, opaque) {
    const bitsArr = readBits(img, bits, channels, opaque, nbytes * 8);
    const out = new Uint8Array(nbytes);
    for (let i = 0; i < nbytes; i++) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bitsArr[i * 8 + j];
      out[i] = v;
    }
    return out;
  }
  SL.core.lsb = { pixelIndices, capacityBytes, embed, readBits, readBytes };
})();
