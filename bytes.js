(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.core = SL.core || {};
  const B = {};

  B.concat = (...parts) => {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  B.u16be = (d, o) => (d[o] << 8) | d[o + 1];
  B.u32be = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
  B.w16be = (d, o, v) => { d[o] = (v >>> 8) & 255; d[o + 1] = v & 255; };
  B.w32be = (d, o, v) => { d[o] = (v >>> 24) & 255; d[o + 1] = (v >>> 16) & 255; d[o + 2] = (v >>> 8) & 255; d[o + 3] = v & 255; };
  B.ascii = (d, o, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d[o + i]); return s; };
  B.bytesToBits = (data) => {
    const out = new Uint8Array(data.length * 8);
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      out[i * 8] = (v >>> 7) & 1; out[i * 8 + 1] = (v >>> 6) & 1;
      out[i * 8 + 2] = (v >>> 5) & 1; out[i * 8 + 3] = (v >>> 4) & 1;
      out[i * 8 + 4] = (v >>> 3) & 1; out[i * 8 + 5] = (v >>> 2) & 1;
      out[i * 8 + 6] = (v >>> 1) & 1; out[i * 8 + 7] = v & 1;
    }
    return out;
  };
  B.bitsToBytes = (bits) => {
    const out = new Uint8Array(Math.floor(bits.length / 8));
    for (let i = 0; i < out.length; i++) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | (bits[i * 8 + j] & 1);
      out[i] = v;
    }
    return out;
  };
  B.toBase64 = (data) => {
    let s = '';
    const step = 0x8000;
    for (let i = 0; i < data.length; i += step) s += String.fromCharCode.apply(null, data.subarray(i, i + step));
    return btoa(s);
  };
  B.fromBase64 = (s) => {
    const raw = atob((s || '').replace(/\s+/g, ''));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  };
  B.utf8 = (s) => new TextEncoder().encode(s);
  B.fromUtf8 = (d) => new TextDecoder().decode(d);
  B.hex = (d) => Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
  B.randomBytes = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
  B.randomU32 = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; };
  B.formatBytes = (n) => {
    if (!Number.isFinite(n)) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 2 : 1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  };
  B.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  SL.core.bytes = B;
})();
