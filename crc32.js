(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.core = SL.core || {};
  const TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }
  function crc32(data, seed) {
    let c = ((seed || 0) ^ 0xffffffff) >>> 0;
    for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  crc32.hex = (data) => crc32(data).toString(16).padStart(8, '0');
  SL.core.crc32 = crc32;
})();
