(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  const B = SL.core.bytes, F = SL.core.frame, I = SL.core.image, M = SL.core.metrics, P = SL.core.png;

  function equalBytes(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function asFrame(f) {
    if (!f) return null;
    if (f.header) return f;
    return f.length ? F.parseFrame(f) : null;
  }
  function methodById(id) {
    return (SL.stego.registry || []).find((m) => m.id === id) || (SL.clean.registry || []).find((m) => m.id === id);
  }
  function toURL(bytes, type) {
    return URL.createObjectURL(new Blob([bytes], { type: type || 'image/png' }));
  }
  function payloadOf(frame) { return frame ? frame.payload : null; }

  async function analyze(img, opts) { return SL.analysis.scan.run(img, opts); }

  async function clean(img, id, params) {
    const m = (SL.clean.registry || []).find((x) => x.id === id);
    if (!m) throw new Error('未知的清除方法：' + id);
    const t0 = performance.now();
    const out = await m.apply(img, params || {});
    out.info = out.info || img.info;
    const bytes = await I.encode(out);
    const metrics = {
      psnr: M.psnr(img, out), maxDelta: M.maxDelta(img, out), changedRatio: M.changedRatio(img, out),
      sizeBefore: img.bytes ? img.bytes.length : null, sizeAfter: bytes.length, ms: performance.now() - t0
    };
    if (img.bytes) out.bytes = bytes;
    out.bytes = bytes;
    out.fileName = (img.fileName || 'image').replace(/\.[^.]+$/, '') + '_' + id + '.png';
    out.url = toURL(bytes);
    return { method: m, image: out, bytes, metrics };
  }

  function checkResult(payload, got, crcOk) {
    const same = equalBytes(payload, got);
    return {
      ok: same && crcOk !== false,
      bytesExpected: payload.length,
      bytesGot: got ? got.length : 0,
      crcOk: crcOk !== false,
      ber: got ? M.ber(payload, got) : 1
    };
  }

  async function embedLSB(img, payload, params, covers) {
    const m = SL.stego.lsb;
    const out = [];
    if (covers && covers.length > 1) {
      const res = m.embedSplit(covers, payload, params);
      const frames = [];
      for (const r of res.images) {
        const bytes = await I.encode(r.image);
        const decoded = await P.decodePNG(bytes);
        const back = m.readFrame(decoded, params);
        if (back) frames.push(back);
        out.push({ image: r.image, bytes, url: toURL(bytes), frame: r.frame, index: r.index, total: r.total, session: r.session, params });
      }
      const joined = joinShards(frames);
      const chk = checkResult(payload, joined && joined.payload, !!joined && !joined.missing.length);
      if (!chk.ok) throw new Error(`无损自检失败：分片回读不一致（${chk.bytesGot}/${chk.bytesExpected} 字节）。已中止，不输出结果。`);
      for (const r of out) r.selfCheck = chk;
      return { images: out, split: true, session: res.session, total: res.total, frame: asFrame(res.images[0].frame), selfCheck: chk };
    }
    const r = m.embedOne(img, payload, params);
    const bytes = await I.encode(r.image);
    const decoded = await P.decodePNG(bytes);
    const back = m.readFrame(decoded, params);
    const chk = checkResult(payload, payloadOf(back), back ? back.crcOk : false);
    r.image.bytes = bytes;
    if (!chk.ok) throw new Error(`无损自检失败：回读 ${chk.bytesGot}/${chk.bytesExpected} 字节，CRC ${chk.crcOk ? '通过' : '失败'}。已中止，不输出结果。`);
    out.push({ image: r.image, bytes, url: toURL(bytes), frame: r.frame, selfCheck: chk, index: 0, total: 1, params });
    return { images: out, split: false, total: 1, frame: asFrame(r.frame), selfCheck: chk };
  }

  async function embed(img, id, payload, params) {
    const m = methodById(id);
    if (!m) throw new Error('未知的隐写方法：' + id);
    params = params || {};
    payload = payload instanceof Uint8Array ? payload : new Uint8Array(payload || []);
    const t0 = performance.now();

    if (id === 'lsb') {
      const r = await embedLSB(img, payload, params, params.covers);
      r.method = m; r.ms = performance.now() - t0;
      return r;
    }
    if (id === 'append') {
      const base = img.exactPNG && img.bytes ? img : { bytes: await I.encode(img) };
      const res = await m.embed(base, payload);
      const back = m.probe(res.bytes);
      const chk = checkResult(payload, payloadOf(back), back ? back.crcOk : false);
      if (!chk.ok) throw new Error('无损自检失败：文件尾帧回读不一致。已中止。');
      const url = toURL(res.bytes, 'image/png');
      return {
        images: [{ image: Object.assign({}, img, { bytes: res.bytes, png: P.parseChunks(res.bytes), exactPNG: true }), bytes: res.bytes, url, frame: res.frame, selfCheck: chk, index: 0, total: 1, params }],
        split: false, total: 1, frame: asFrame(res.frame), method: m, ms: performance.now() - t0
      };
    }
    if (id === 'text') {
      const res = await m.embed(img, payload);
      const back = await m.probe({ png: P.parseChunks(res.bytes) });
      const chk = checkResult(payload, payloadOf(back), back ? back.crcOk : false);
      if (!chk.ok) throw new Error('无损自检失败：tEXt 帧回读不一致。已中止。');
      const url = toURL(res.bytes, 'image/png');
      return {
        images: [{ image: Object.assign({}, img, { bytes: res.bytes, png: P.parseChunks(res.bytes), exactPNG: true }), bytes: res.bytes, url, frame: res.frame, selfCheck: chk, index: 0, total: 1, params }],
        split: false, total: 1, frame: asFrame(res.frame), method: m, ms: performance.now() - t0
      };
    }

    // 鲁棒组
    const res = await m.embed(img, payload, params);
    const bytes = await I.encode(res.image);
    const decoded = await P.decodePNG(bytes);
    let back = null, err = '';
    try { back = m.extract(decoded, params); } catch (e) { err = e.message; }
    const chk = back
      ? checkResult(payload, payloadOf(back.frame), back.frame.crcOk)
      : { ok: false, bytesExpected: payload.length, bytesGot: 0, crcOk: false, ber: 1, reason: err || '引导头或帧未能解出' };
    res.image.bytes = bytes;
    return {
      images: [{ image: res.image, bytes, url: toURL(bytes), frame: res.frame, selfCheck: chk, index: 0, total: 1, params }],
      split: false, total: 1, frame: asFrame(res.frame), pilot: res.pilot, method: m,
      robust: true, selfCheck: chk, ms: performance.now() - t0
    };
  }

  async function extractAuto(img, opts) {
    opts = opts || {};
    const attempts = [];
    const push = (name, ok, extra) => attempts.push(Object.assign({ name, ok: !!ok }, extra || {}));

    if (img.bytes) {
      const af = SL.stego.append.probe(img.bytes);
      push('文件尾附加', af && af.crcOk, af ? { note: '找到 STG1 帧' } : null);
      if (af && af.crcOk) return { ok: true, channel: 'append', frame: af, attempts };
    } else push('文件尾附加', false, { note: '缺少原始字节' });

    let tf = null;
    try { tf = await SL.stego.text.probe(img); } catch (e) { tf = null; }
    push('PNG tEXt', tf && tf.crcOk);
    if (tf && tf.crcOk) return { ok: true, channel: 'text', frame: tf, attempts };

    for (const c of SL.analysis.frameProbe.COMBOS) {
      let frame = null;
      try { frame = SL.stego.lsb.readFrame(img, c); } catch (e) { frame = null; }
      const label = `LSB ${c.bits}bit/${c.channels}${c.opaque ? '/仅不透明' : ''}`;
      push(label, frame && frame.crcOk);
      if (frame && frame.crcOk) return { ok: true, channel: 'lsb', frame, params: c, attempts };
    }

    if (opts.robust !== false) {
      const keys = opts.keys && opts.keys.length ? opts.keys : [42];
      const px = img.width * img.height;
      if (px <= 1600000) {
        for (const id of ['lsbm', 'pvd', 'dct_ss', 'dct_qim', 'dct_rel', 'dwt_qim', 'blk_qim']) {
          const m = SL.stego[id];
          if (!m) continue;
          for (const key of keys) {
            let r = null;
            try { r = m.extract(img, Object.assign({ key }, opts.params || {})); } catch (e) { r = null; }
            push(m.label + ` (key=${key})`, r);
            if (r && r.frame.crcOk) return { ok: true, channel: 'robust', id, frame: r.frame, pilot: r.pilot, params: { key }, attempts };
          }
        }
      } else {
        push('鲁棒引导头', false, { note: '图片过大，已跳过' });
      }
    }
    return { ok: false, attempts };
  }

  async function extractManual(img, id, params) {
    params = params || {};
    if (id === 'append') {
      const f = SL.stego.append.probe(img.bytes);
      return f ? { ok: true, channel: 'append', frame: f } : { ok: false, attempts: [{ name: '文件尾附加', ok: false }] };
    }
    if (id === 'text') {
      const f = await SL.stego.text.probe(img);
      return f ? { ok: true, channel: 'text', frame: f } : { ok: false, attempts: [{ name: 'PNG tEXt', ok: false }] };
    }
    if (id === 'lsb') {
      const f = SL.stego.lsb.readFrame(img, params);
      return f ? { ok: true, channel: 'lsb', frame: f, params } : { ok: false, attempts: [{ name: 'LSB', ok: false }] };
    }
    const m = SL.stego[id];
    if (!m) throw new Error('未知的提取方法：' + id);
    const r = m.extract(img, params);
    return r ? { ok: true, channel: 'robust', id, frame: r.frame, pilot: r.pilot, params } : { ok: false, attempts: [{ name: m.label, ok: false }] };
  }

  function joinShards(frames) {
    const list = frames.filter((f) => f && f.header && f.header.split).sort((a, b) => a.header.splitIndex - b.header.splitIndex);
    if (!list.length) return null;
    const h = list[0].header, missing = [];
    const byIndex = {};
    for (const f of list) if (f.header.session === h.session) byIndex[f.header.splitIndex] = f.payload;
    for (let i = 0; i < h.splitTotal; i++) if (!byIndex[i]) missing.push(i);
    if (missing.length) return { total: h.splitTotal, have: Object.keys(byIndex).length, missing, session: h.session };
    const parts = [];
    for (let i = 0; i < h.splitTotal; i++) parts.push(byIndex[i]);
    const payload = B.concat(...parts);
    return { total: h.splitTotal, have: h.splitTotal, missing: [], session: h.session, payload };
  }

  SL.pipeline = { analyze, clean, embed, extractAuto, extractManual, joinShards, equalBytes, toURL, methodById };
})();
