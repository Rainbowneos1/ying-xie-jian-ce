(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.analysis = SL.analysis || {};
  const B = SL.core.bytes, F = SL.core.frame, L = SL.core.lsb;

  function mk(id, category, severity, title, detail, evidence, suggestion) {
    return { id, category, severity, title, detail, evidence: evidence || [], suggestion: suggestion || '' };
  }
  const COMBOS = [];
  for (const bits of [1, 2]) for (const channels of ['RGB', 'RGBA']) for (const opaque of [false, true]) COMBOS.push({ bits, channels, opaque });

  function tryLSB(img) {
    const out = [];
    for (const c of COMBOS) {
      const need = 10 * 8;
      if (!img.width * img.height * (c.channels === 'RGBA' ? 4 : 3) / c.bits >= need) continue;
      let head;
      try { head = L.readBytes(img, 10, c.bits, c.channels, c.opaque); } catch (e) { continue; }
      const h = F.parseHeader(head);
      if (!h) continue;
      if (h.method !== 1) continue;
      if (h.total > (img.width * img.height * 4) / 8) continue;
      const all = L.readBytes(img, h.total, c.bits, c.channels, c.opaque);
      const f = F.parseFrame(all);
      out.push({ combo: c, header: h, frame: f });
    }
    return out;
  }

  function tryRobustPilot(img, key) {
    const out = [];
    const list = ['lsbm', 'pvd', 'dct_ss', 'dct_qim', 'dct_rel', 'dwt_qim', 'blk_qim'];
    for (const id of list) {
      const m = SL.stego[id];
      if (!m || !m.readPilot) continue;
      try {
        const pilot = m.readPilot(img, { key });
        if (pilot && pilot.methodId === m.methodId) out.push({ id, pilot, method: m });
      } catch (e) { /* 尺寸不足等方法直接跳过 */ }
    }
    return out;
  }

  async function probe(img, opts) {
    opts = opts || {};
    const findings = [], hits = [];

    if (img.bytes) {
      const af = SL.stego.append.probe(img.bytes);
      if (af) {
        hits.push({ channel: 'append', frame: af, params: {} });
        findings.push(mk('append-frame', '已知帧', 'high', '文件尾检出 STG1 载荷帧',
          '按 file-tail-append 方式写入的标准帧，头部与 CRC 全部通过。基本可确认由本工具或同格式脚本写入。',
          [['method', F.methodName(af.header.method)], ['载荷', B.formatBytes(af.payload.length)], ['CRC', af.crcOk ? '通过' : '失败'], ['位置', 'offset ' + af.offset]],
          '在「提取」工作区自动提取即可得到原始载荷。'));
      }
    }

    let tf = null;
    try { tf = await SL.stego.text.probe(img); } catch (e) { tf = null; }
    if (tf) {
      hits.push({ channel: 'text', frame: tf, params: {} });
      findings.push(mk('text-frame', '已知帧', 'high', 'PNG tEXt 中检出 StegoData 载荷帧',
        '注释块里存放 base64(STG1 帧)，键名固定为 StegoData。此类数据会在多数“重新保存”操作中丢失。',
        [['载荷', B.formatBytes(tf.payload.length)], ['CRC', tf.crcOk ? '通过' : '失败']],
        '在「提取」工作区用 tEXt 通道取出。'));
    }

    let lsb = [];
    if (img.width * img.height >= 16) {
      try { lsb = tryLSB(img); } catch (e) { lsb = []; }
    }
    for (const r of lsb) {
      const c = r.combo, ok = r.frame && r.frame.crcOk;
      const tag = `${c.bits}bit/${c.channels}/${c.opaque ? '仅不透明' : '全部像素'}`;
      hits.push({ channel: 'lsb', frame: r.frame, params: { bits: c.bits, channels: c.channels, opaque: c.opaque } });
      findings.push(mk('lsb-frame-' + c.bits + c.channels + (c.opaque ? 'o' : 'a'), '已知帧', ok ? 'high' : 'medium',
        ok ? `LSB ${tag} 检出可解析载荷帧` : `LSB ${tag} 命中 STG1 头部但 CRC 不符`,
        ok ? '帧头 magic、长度与 CRC32 全部自洽，是本工具/同格式脚本的嵌入结果。' : '头部字段看起来像 STG1，但载荷 CRC 校验失败：可能被轻度处理，或只是像素巧合命中 4 字节。',
        [['method', F.methodName(r.header.method)], ['载荷', B.formatBytes(r.header.payloadLen - 4)],
        ['flags', '0x' + r.header.flags.toString(16)], r.header.split ? ['分片', `${r.header.splitIndex + 1}/${r.header.splitTotal} session ${r.header.session.toString(16)}`] : ['分片', '无']],
        ok ? '在「提取」工作区自动提取。' : '尝试手动指定 bits/通道组合，或先用「清除」再重试。'));
    }

    const keys = opts.keys && opts.keys.length ? opts.keys : [42];
    let robustHits = [];
    if (opts.robust) {
      const px = img.width * img.height;
      if (px <= 1600000) {
        for (const k of keys) robustHits = robustHits.concat(tryRobustPilot(img, k));
      } else {
        findings.push(mk('robust-skip', '已知帧', 'info', '图片过大，跳过鲁棒引导头盲扫', '鲁棒方法需要对整图做 DCT/小波，超过 160 万像素时为保证响应速度跳过。', [['像素', px]], '可在“提取”里手动指定 key 与方法。'));
      }
    }
    for (const r of robustHits) {
      hits.push({ channel: 'robust', id: r.id, params: { key: r.pilot.key, strength: r.pilot.strength, repeat: r.pilot.repeat, ncoef: r.pilot.ncoef } });
      findings.push(mk('pilot-' + r.id, '已知帧', 'high', `${r.method.label} 引导头命中`,
        'WEB1 引导头 CRC16 通过，说明该鲁棒方法确实嵌入过数据；即使后续被压缩，也可尝试按引导头参数解帧。',
        [['key', r.pilot.key], ['载荷位数', r.pilot.payloadBits], ['repeat', r.pilot.repeat], ['strength', r.pilot.strength]],
        '在「提取」里选择对应方法并填入这些参数。'));
    }

    const splitFrames = hits.filter((h) => h.frame && h.frame.header && h.frame.header.split && h.frame.crcOk);
    if (splitFrames.length) {
      const h0 = splitFrames[0].frame.header;
      findings.push(mk('split', '已知帧', 'medium', `当前图片是分片载荷的第 ${h0.splitIndex + 1}/${h0.splitTotal} 片`,
        '多载体 LSB 会把一份载荷按 min(容量)-22 切分，每片单独成帧。需要集齐同一 session 的全部图片才能还原。',
        [['session', h0.session.toString(16)], ['本片大小', B.formatBytes(h0.payloadLen - 4)], ['分片数', h0.splitTotal]],
        '把其余分片图片一起交给「提取」工作区。'));
    }

    if (!hits.length && lsb.length === 0) {
      findings.push(mk('no-frame', '已知帧', 'info', '未发现本工具可解析的载荷帧',
        '已尝试：文件尾扫描、tEXt 的 StegoData、LSB 的 8 种 bits/通道/不透明组合。这不代表图片没有隐写，只代表没有本工具认识的帧格式。',
        [['尝试组合', COMBOS.length], ['文件尾', '已扫描'], ['tEXt', img.png ? '已解析' : '非 PNG 跳过']],
        '继续看下列统计检测项；或使用「提取」的手动模式指定第三方工具的参数。'));
    }
    return { findings, hits, lsbCombos: COMBOS.length, robustHits };
  }

  SL.analysis.frameProbe = { probe, tryLSB, tryRobustPilot, COMBOS };
})();
