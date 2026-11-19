(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.core = SL.core || {};
  const png = SL.core.png;

  function canvasOf(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    return c;
  }
  function clone(img) {
    return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data), info: img.info, exact: img.exact };
  }
  async function fromBitmap(bmp, fallbackInfo) {
    const w = bmp.width, h = bmp.height;
    const c = canvasOf(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const id = ctx.getImageData(0, 0, w, h);
    return { width: w, height: h, data: id.data, info: fallbackInfo || null, exact: false };
  }
  async function loadFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = file.type || (/\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.webp$/i.test(file.name) ? 'image/webp' : '');
    let img = null, parsed = null, exactPNG = false, warning = '';
    if (png.isPNG(bytes)) {
      try {
        parsed = png.parseChunks(bytes);
        img = await png.decodePNG(bytes);
        exactPNG = true;
      } catch (e) {
        warning = e.code === 'UNSUPPORTED' ? '16-bit/交错 PNG 走浏览器近似解码；输出仍为自写 PNG，提取自洽。' : ('PNG 精确解码失败：' + e.message + '，改用浏览器解码。');
      }
    }
    if (!img) {
      let bmp;
      try { bmp = await createImageBitmap(new Blob([bytes], { type: mime || 'application/octet-stream' })); }
      catch (e) { throw new Error('浏览器无法解码该图片：' + e.message); }
      img = await fromBitmap(bmp, parsed && parsed.info);
      if (bmp.close) bmp.close();
    }
    img.bytes = bytes; img.fileName = file.name; img.mime = mime; img.format = (mime.split('/')[1] || 'bin').toUpperCase();
    img.png = parsed; img.exactPNG = exactPNG; img.warning = warning;
    return img;
  }
  async function encode(img, opts) { return png.encodePNG(img.width, img.height, img.data, opts); }
  async function toURL(img) {
    const bytes = await encode(img);
    return { url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), bytes };
  }
  function drawToCanvas(img, w, h) {
    const c = canvasOf(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
    const src = canvasOf(img.width, img.height), sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, img.width, img.height, 0, 0, w, h);
    return c;
  }
  function fromCanvas(c, src) {
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, c.width, c.height);
    if (src) for (let i = 3; i < d.data.length; i += 4) d.data[i] = src.data[i];
    return { width: c.width, height: c.height, data: d.data, info: src ? src.info : null, exact: false };
  }
  function resize(img, scale) {
    if (Math.abs(scale - 1) < 1e-6) return clone(img);
    const tw = Math.max(1, Math.round(img.width * scale)), th = Math.max(1, Math.round(img.height * scale));
    const tmp = drawToCanvas(img, tw, th);
    const c = canvasOf(img.width, img.height), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, 0, 0, tw, th, 0, 0, img.width, img.height);
    return fromCanvas(c, img);
  }
  function resampleRoundtrip(img, factor) {
    const tw = Math.max(1, Math.round(img.width * factor)), th = Math.max(1, Math.round(img.height * factor));
    const tmp = drawToCanvas(img, tw, th);
    return fromCanvas(tmp.width === img.width && tmp.height === img.height ? tmp : (() => {
      const c = canvasOf(img.width, img.height), ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tmp, 0, 0, tw, th, 0, 0, img.width, img.height); return c;
    })(), img);
  }
  async function jpegRoundtrip(img, quality, keepAlpha) {
    const c = canvasOf(img.width, img.height), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    const blob = await new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', quality));
    if (!blob) throw new Error('JPEG 重编码失败');
    const bmp = await createImageBitmap(blob);
    const out = await fromBitmap(bmp, img.info);
    if (bmp.close) bmp.close();
    if (keepAlpha) for (let i = 3; i < out.data.length; i += 4) out.data[i] = img.data[i];
    return out;
  }
  function blurChannel(data, w, h, ch, radius) {
    const sigma = Math.max(0.1, radius), r = Math.max(1, Math.ceil(sigma * 2.5));
    const k = new Float32Array(r * 2 + 1); let sum = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; sum += v; }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const src = new Float32Array(w * h), tmp = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) src[i] = data[i * 4 + ch];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0; for (let i = -r; i <= r; i++) s += src[y * w + Math.max(0, Math.min(w - 1, x + i))] * k[i + r];
      tmp[y * w + x] = s;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0; for (let i = -r; i <= r; i++) s += tmp[Math.max(0, Math.min(h - 1, y + i)) * w + x] * k[i + r];
      data[(y * w + x) * 4 + ch] = s;
    }
  }
  function unsharpMask(img, radius, amount, threshold) {
    const out = new Uint8ClampedArray(img.data);
    const orig = new Uint8ClampedArray(img.data);
    for (let ch = 0; ch < 3; ch++) blurChannel(out, img.width, img.height, ch, radius);
    for (let i = 0; i < out.length; i += 4) for (let ch = 0; ch < 3; ch++) {
      const diff = orig[i + ch] - out[i + ch];
      out[i + ch] = Math.abs(diff) < (threshold || 0) ? orig[i + ch] : Math.max(0, Math.min(255, orig[i + ch] + amount * diff));
    }
    for (let i = 3; i < out.length; i += 4) out[i] = orig[i];
    return { width: img.width, height: img.height, data: out, info: img.info, exact: false };
  }
  function cropResize(img, px) {
    const w = img.width, h = img.height;
    const cw = Math.max(1, w - px * 2), chh = Math.max(1, h - px * 2);
    const src = canvasOf(w, h), sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), w, h), 0, 0);
    const c = canvasOf(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, px, px, cw, chh, 0, 0, w, h);
    return fromCanvas(c, img);
  }
  function shiftRight(img, px) {
    const { width: w, height: h, data } = img, out = new Uint8ClampedArray(data);
    for (let y = 0; y < h; y++) for (let x = w - 1; x >= px; x--) {
      const s = (y * w + x - px) * 4, d = (y * w + x) * 4;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < px; x++) {
      const s = y * w * 4, d = (y * w + x) * 4;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
    }
    return { width: w, height: h, data: out, info: img.info, exact: false };
  }
  SL.core.image = { loadFile, clone, encode, toURL, resize, resampleRoundtrip, jpegRoundtrip, unsharpMask, cropResize, shiftRight, fromCanvas, canvasOf };
})();
