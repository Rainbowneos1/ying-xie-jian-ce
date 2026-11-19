(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  const U = () => SL.ui;
  const st = () => SL.ui.state;
  const CH = { append: '文件尾附加', text: 'PNG tEXt', lsb: 'LSB 低位', robust: '鲁棒实验' };
  let shardFrames = [];

  function decodeText(bytes) {
    try { return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }; }
    catch (e) { return { ok: false, text: '' }; }
  }
  function hexDump(bytes, limit) {
    const n = Math.min(bytes.length, limit || 256);
    const rows = [];
    for (let i = 0; i < n; i += 16) {
      const slice = Array.from(bytes.subarray(i, Math.min(n, i + 16)));
      rows.push(i.toString(16).padStart(6, '0') + '  ' + slice.map((b) => b.toString(16).padStart(2, '0')).join(' ') +
        '  ' + slice.map((b) => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join(''));
    }
    return rows.join('\n') + (bytes.length > n ? '\n… 共 ' + bytes.length + ' 字节' : '');
  }

  function payloadBlock(frame) {
    const bytes = frame.payload, B = SL.core.bytes;
    const t = decodeText(bytes);
    const wrap = U().el(`<div class="payload-preview"><div class="result-head" style="margin:0"><div><span class="chip">PAYLOAD</span><h3>${B.formatBytes(bytes.length)}</h3></div></div>
      <pre>${U().esc(t.ok ? bytes.length > 4000 ? t.text.slice(0, 4000) + '\n…（已截断显示）' : t.text : hexDump(bytes))}</pre></div>`);
    const actions = U().el('<div class="result-actions"></div>');
    const name = t.ok ? 'payload.txt' : 'payload.bin';
    actions.appendChild(U().downloadRow(name, bytes, t.ok ? 'text/plain;charset=utf-8' : 'application/octet-stream'));
    if (t.ok) {
      const btn = U().el('<button class="btn btn-ghost btn-sm" type="button">复制文本</button>');
      btn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(t.text); U().toast('已复制到剪贴板', 'ok'); }
        catch (e) { U().toast('剪贴板不可用（file:// 下可能被限制）', 'err'); }
      });
      actions.appendChild(btn);
    }
    wrap.appendChild(actions);
    return wrap;
  }

  function splitBlock(frame) {
    const h = frame.header;
    if (!h.split) return null;
    const wrap = U().el(`<div class="split-box"><b>分片 ${h.splitIndex + 1}/${h.splitTotal}</b>
      <p class="muted">session ${h.session.toString(16)} · 本片 ${h.payloadLen - 4} 字节。集齐同 session 的全部分片才能还原原始载荷。</p>
      <div class="ref-row"><input type="file" id="shard-input" multiple hidden accept="image/png,image/jpeg,image/webp">
      <button class="btn btn-ghost btn-sm" id="shard-add" type="button">补充其余分片</button><span class="ref-state" id="shard-state">已有 ${shardFrames.length} 片</span></div></div>`);
    wrap.querySelector('#shard-add').addEventListener('click', () => wrap.querySelector('#shard-input').click());
    wrap.querySelector('#shard-input').addEventListener('change', async (e) => {
      for (const f of Array.from(e.target.files || [])) {
        try {
          const img = await SL.core.image.loadFile(f);
          const r = await SL.pipeline.extractAuto(img, { robust: false });
          if (r.ok && r.frame.header.split) shardFrames.push(r.frame);
        } catch (err) { /* 忽略单张失败 */ }
      }
      const joined = SL.pipeline.joinShards(shardFrames);
      const stateEl = wrap.querySelector('#shard-state');
      if (!joined) { stateEl.textContent = '没有可用分片'; return; }
      if (joined.missing.length) {
        stateEl.textContent = `已有 ${joined.have}/${joined.total}，缺第 ${joined.missing.map((i) => i + 1).join(',')} 片`;
        return;
      }
      stateEl.textContent = `已集齐 ${joined.total} 片 · 共 ${joined.payload.length} 字节`;
      const fake = { payload: joined.payload };
      wrap.appendChild(payloadBlock(fake));
      U().toast('分片已重组', 'ok');
    });
    return wrap;
  }

  function render(result) {
    const box = document.getElementById('extract-result');
    box.className = 'extract-result glass';
    box.innerHTML = '';
    if (!result.ok) {
      const tries = (result.attempts || []).map((a) => `<div class="attempt ${a.ok ? 'ok' : ''}"><b>${a.ok ? '✓' : '×'}</b><span>${U().esc(a.name)}</span>${a.note ? `<small>${U().esc(a.note)}</small>` : ''}</div>`).join('');
      box.appendChild(U().el(`<div class="result-head"><div><span class="chip">NO PAYLOAD</span><h3>未发现本工具可解析的信息</h3></div></div>`));
      box.appendChild(U().el(`<p class="muted">已完成下列尝试。可能是第三方工具格式、加密载荷，或确实没有隐写。</p>`));
      box.appendChild(U().el(`<div class="attempt-list">${tries || '<div class="attempt"><b>×</b><span>没有可用尝试</span></div>'}</div>`));
      box.appendChild(U().el(`<p class="muted">下一步：在「手动指定方法」里换成其他 bits/通道/key，或先看检测区的统计证据。</p>`));
      return;
    }
    const frame = result.frame;
    const title = result.channel === 'robust' ? (SL.stego[result.id] ? SL.stego[result.id].label : '鲁棒实验') : CH[result.channel];
    box.appendChild(U().el(`<div class="result-head"><div><span class="chip">FOUND</span><h3>${U().esc(title)}</h3></div><span class="method-id">${U().esc(result.id || result.channel)}</span></div>`));
    box.appendChild(U().selfCheckBlock({ ok: frame.crcOk, bytesExpected: frame.payload.length, bytesGot: frame.payload.length, crcOk: frame.crcOk }, false, 'extract'));
    box.appendChild(U().frameTable(frame));
    if (result.pilot) {
      box.appendChild(U().el(`<div class="evidence"><span>PILOT <b>key=${result.pilot.key} · repeat=${result.pilot.repeat} · strength=${result.pilot.strength}</b></span><span>payloadBits <b>${result.pilot.payloadBits}</b></span></div>`));
    }
    box.appendChild(payloadBlock(frame));
    const split = splitBlock(frame);
    if (split) box.appendChild(split);
    if (result.attempts && result.attempts.length) {
      box.appendChild(U().el(`<details class="manual-details"><summary>查看 ${result.attempts.length} 次尝试</summary><div class="attempt-list">${result.attempts.map((a) => `<div class="attempt ${a.ok ? 'ok' : ''}"><b>${a.ok ? '✓' : '×'}</b><span>${U().esc(a.name)}</span></div>`).join('')}</div></details>`));
    }
  }

  async function auto() {
    if (!st().img) { U().toast('先载入一张图片', 'err'); return; }
    const btn = document.getElementById('extract-auto');
    btn.disabled = true;
    const robust = document.getElementById('extract-robust').checked;
    U().progress(true, '自动提取', robust ? '文件尾 → tEXt → LSB ×8 → 鲁棒引导头' : '文件尾 → tEXt → LSB ×8');
    U().setStatus('提取中…', true);
    try {
      const r = await SL.pipeline.extractAuto(st().img, { robust });
      shardFrames = r.ok && r.frame.header.split ? [r.frame] : [];
      render(r);
      U().setStatus(r.ok ? '提取成功' : '未发现载荷', false);
      if (r.ok) U().toast('已提取载荷', 'ok');
    } catch (e) {
      console.error(e);
      U().toast('提取失败：' + e.message, 'err');
      U().setStatus('提取失败', false);
    } finally {
      btn.disabled = false;
      U().progress(false);
    }
  }

  async function manual() {
    if (!st().img) { U().toast('先载入一张图片', 'err'); return; }
    const id = document.getElementById('extract-method').value;
    const params = {
      key: Number(document.getElementById('extract-key').value) || 0,
      nbits: Number(document.getElementById('extract-nbits').value) || 0,
      bits: Number(document.getElementById('extract-bits').value),
      channels: document.getElementById('extract-channels').value,
      opaque: document.getElementById('extract-opaque').checked
    };
    U().progress(true, '按参数提取', id);
    try {
      const r = await SL.pipeline.extractManual(st().img, id, params);
      if (!r.ok) r.attempts = r.attempts || [];
      render(r);
      U().setStatus(r.ok ? '提取成功' : '该参数下未找到帧', false);
    } catch (e) {
      U().toast('提取失败：' + e.message, 'err');
    } finally { U().progress(false); }
  }

  SL.ui.extractPanel = { auto, manual };
  SL.ui.panels.push({
    onImage() {
      const box = document.getElementById('extract-result');
      box.className = 'extract-result glass empty-result';
      box.innerHTML = '<div class="empty-result-icon">⇧</div><p>提取结果、帧信息与载荷下载会出现在这里。</p>';
      shardFrames = [];
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('extract-auto').addEventListener('click', auto);
    document.getElementById('extract-manual').addEventListener('click', manual);
  });
})();
