(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.core = SL.core || {};
  const B = SL.core.bytes, crc32 = SL.core.crc32;
  const SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

  function isPNG(data) {
    return !!data && data.length >= 8 && SIG.every((v, i) => data[i] === v);
  }
  function ascii(data, o, n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(data[o + i]); return s; }

  function parseChunks(data) {
    if (!isPNG(data)) throw new Error('不是有效的 PNG 文件');
    let off = 8, end = null, truncated = false;
    const chunks = [];
    while (off + 8 <= data.length) {
      const len = B.u32be(data, off);
      if (off + 12 + len > data.length) { truncated = true; break; }
      const type = ascii(data, off + 4, 4);
      const body = data.subarray(off + 8, off + 8 + len);
      const crc = B.u32be(data, off + 8 + len);
      const calc = crc32(data.subarray(off + 4, off + 8 + len));
      chunks.push({ type, len, data: body, crc, calc, crcOk: crc === calc, offset: off });
      off += 12 + len;
      if (type === 'IEND') { end = off; break; }
    }
    const ihdr = chunks.find((c) => c.type === 'IHDR');
    const info = { width: 0, height: 0, bitDepth: 0, colorType: -1, interlace: 0, text: [], palette: null, trns: null, valid: false };
    if (ihdr && ihdr.len >= 13) {
      const d = ihdr.data;
      info.width = B.u32be(d, 0); info.height = B.u32be(d, 4);
      info.bitDepth = d[8]; info.colorType = d[9]; info.interlace = d[12];
      info.valid = info.width > 0 && info.height > 0;
    }
    const plte = chunks.find((c) => c.type === 'PLTE');
    if (plte) {
      const pal = [];
      for (let i = 0; i + 2 < plte.data.length; i += 3) pal.push([plte.data[i], plte.data[i + 1], plte.data[i + 2]]);
      info.palette = pal;
    }
    const trns = chunks.find((c) => c.type === 'tRNS');
    if (trns) info.trns = trns.data;
    return {
      chunks, info, tail: end == null ? new Uint8Array(0) : data.subarray(end), end,
      truncated, missingIEND: end == null, iendCount: chunks.filter((c) => c.type === 'IEND').length,
      idat: chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)
    };
  }

  async function inflate(data) {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持 DecompressionStream，请使用新版 Chrome / Edge');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function deflate(data) {
    if (typeof CompressionStream === 'undefined') throw new Error('当前浏览器不支持 CompressionStream，请使用新版 Chrome / Edge');
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readTextChunks(parsed) {
    const out = [];
    for (const c of parsed.chunks) {
      if (c.type === 'tEXt') {
        const z = c.data.indexOf(0);
        if (z < 0) continue;
        out.push({ type: 'tEXt', key: ascii(c.data, 0, z), value: ascii(c.data, z + 1, c.data.length - z - 1) });
      } else if (c.type === 'zTXt') {
        const z = c.data.indexOf(0);
        if (z < 0 || z + 2 > c.data.length) continue;
        try {
          const raw = await inflate(c.data.subarray(z + 2));
          out.push({ type: 'zTXt', key: ascii(c.data, 0, z), value: ascii(raw, 0, raw.length) });
        } catch (e) { out.push({ type: 'zTXt', key: ascii(c.data, 0, z), value: '', error: e.message }); }
      } else if (c.type === 'iTXt') {
        const z = c.data.indexOf(0);
        if (z < 0) continue;
        out.push({ type: 'iTXt', key: ascii(c.data, 0, z), value: '' });
      }
    }
    return out;
  }

  function unfilter(raw, width, height, channels, bitDepth) {
    const rowBytes = Math.ceil(width * channels * bitDepth / 8);
    const bpp = Math.max(1, Math.ceil(channels * bitDepth / 8));
    const expect = (rowBytes + 1) * height;
    if (raw.length < expect) throw new Error('PNG IDAT 数据不完整');
    const out = new Uint8Array(rowBytes * height);
    let pos = 0;
    for (let y = 0; y < height; y++) {
      const filter = raw[pos++];
      const row = raw.subarray(pos, pos + rowBytes); pos += rowBytes;
      const cur = out.subarray(y * rowBytes, (y + 1) * rowBytes);
      const prev = y > 0 ? out.subarray((y - 1) * rowBytes, y * rowBytes) : null;
      for (let x = 0; x < rowBytes; x++) {
        const a = x >= bpp ? cur[x - bpp] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= bpp ? prev[x - bpp] : 0;
        let v = row[x];
        if (filter === 1) v += a;
        else if (filter === 2) v += b;
        else if (filter === 3) v += (a + b) >> 1;
        else if (filter === 4) {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        } else if (filter !== 0) throw new Error('未知 PNG 行滤波类型 ' + filter);
        cur[x] = v & 255;
      }
    }
    return out;
  }

  function unpackSample(row, x, bitDepth) {
    if (bitDepth === 8) return row[x];
    if (bitDepth === 16) return (row[x * 2] << 8) | row[x * 2 + 1];
    const bit = x * bitDepth;
    const shift = 8 - bitDepth - (bit % 8);
    return (row[bit >> 3] >> shift) & ((1 << bitDepth) - 1);
  }

  async function decodePNG(data) {
    const parsed = parseChunks(data);
    const info = parsed.info;
    if (!info.valid) throw new Error('PNG 缺少有效 IHDR');
    if (info.interlace) throw Object.assign(new Error('暂不精确支持交错 PNG'), { code: 'UNSUPPORTED' });
    if (info.bitDepth === 16) throw Object.assign(new Error('暂不精确支持 16-bit PNG'), { code: 'UNSUPPORTED' });
    if (!DEPTHS[info.colorType] || !DEPTHS[info.colorType].includes(info.bitDepth)) throw new Error('不支持的 PNG 色彩类型 / 位深');
    if (!parsed.idat.length) throw new Error('PNG 缺少 IDAT');
    const raw = await inflate(B.concat(...parsed.idat));
    const ch = CHANNELS[info.colorType];
    const rows = unfilter(raw, info.width, info.height, ch, info.bitDepth);
    const w = info.width, h = info.height;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const pal = info.palette || [];
    const trns = info.trns;
    let trKey = null;
    if (trns && (info.colorType === 0 || info.colorType === 2)) {
      const n = info.colorType === 0 ? 1 : 3;
      trKey = [];
      for (let i = 0; i < n; i++) trKey.push((trns[i * 2] << 8) | trns[i * 2 + 1]);
    }
    const maxV = (1 << info.bitDepth) - 1;
    const rowBytes = Math.ceil(w * ch * info.bitDepth / 8);
    for (let y = 0; y < h; y++) {
      const row = rows.subarray(y * rowBytes, (y + 1) * rowBytes);
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 255, o = (y * w + x) * 4;
        if (info.colorType === 0) {
          const s = unpackSample(row, x, info.bitDepth);
          r = g = b = info.bitDepth < 8 ? Math.round(s * 255 / maxV) : s;
          if (trKey && s === trKey[0]) a = 0;
        } else if (info.colorType === 2) {
          const s0 = unpackSample(row, x * 3, 8), s1 = unpackSample(row, x * 3 + 1, 8), s2 = unpackSample(row, x * 3 + 2, 8);
          r = s0; g = s1; b = s2;
          if (trKey && s0 === trKey[0] && s1 === trKey[1] && s2 === trKey[2]) a = 0;
        } else if (info.colorType === 3) {
          const idx = unpackSample(row, x, info.bitDepth);
          const p = pal[idx] || [0, 0, 0];
          r = p[0]; g = p[1]; b = p[2];
          if (trns && idx < trns.length) a = trns[idx];
        } else if (info.colorType === 4) {
          const s = unpackSample(row, x * 2, 8), al = unpackSample(row, x * 2 + 1, 8);
          r = g = b = s; a = al;
        } else {
          r = unpackSample(row, x * 4, 8); g = unpackSample(row, x * 4 + 1, 8);
          b = unpackSample(row, x * 4 + 2, 8); a = unpackSample(row, x * 4 + 3, 8);
        }
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
      }
    }
    return { width: w, height: h, data: rgba, info, parsed, chunks: parsed.chunks, tail: parsed.tail, exact: true };
  }

  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    B.w32be(out, 0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    B.w32be(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }
  function textChunk(key, value) {
    const k = B.utf8 ? Array.from(key, (c) => c.charCodeAt(0)) : [];
    const v = Array.from(value, (c) => c.charCodeAt(0));
    const d = new Uint8Array(k.length + 1 + v.length);
    d.set(k, 0); d[k.length] = 0; d.set(v, k.length + 1);
    return chunk('tEXt', d);
  }

  async function encodePNG(width, height, rgba, opts) {
    opts = opts || {};
    if (!width || !height) throw new Error('无效图片尺寸');
    const stride = width * 4;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      const ro = y * (stride + 1);
      raw[ro] = 0;
      raw.set(rgba.subarray(y * stride, (y + 1) * stride), ro + 1);
    }
    const z = await deflate(raw);
    const ihdr = new Uint8Array(13);
    B.w32be(ihdr, 0, width); B.w32be(ihdr, 4, height);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const parts = [SIG, chunk('IHDR', ihdr)];
    for (const t of (opts.text || [])) parts.push(textChunk(t.key, t.value));
    for (let i = 0; i < z.length; i += 65536) parts.push(chunk('IDAT', z.subarray(i, i + 65536)));
    parts.push(chunk('IEND', new Uint8Array(0)));
    return B.concat(...parts);
  }

  SL.core.png = { SIG, isPNG, parseChunks, decodePNG, encodePNG, readTextChunks, chunk, textChunk, inflate, deflate };
})();
