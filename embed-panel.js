(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  const U = () => SL.ui;
  const st = () => SL.ui.state;
  const GROUPS = ['无损', '实验鲁棒'];
  let current = null, mode = 'text', payloadFile = null, covers = [];

  function pick(m) {
    current = m;
    document.getElementById('embed-group-chip').textContent = m.group;
    document.getElementById('embed-title').textContent = m.label;
    document.getElementById('embed-desc').textContent = m.desc || '';
    document.getElementById('embed-method-id').textContent = m.id;
    U().paramFields(document.getElementById('embed-params'), m.params, {});
    document.getElementById('embed-run').disabled = !st().img;
    updateCapacity();
  }

  function build() {
    U().methodRail(document.getElementById('embed-methods'), SL.stego.registry, GROUPS, pick);
    const box = U().el(`<div class="ref-row"><input type="file" id="cover-input" multiple hidden accept="image/png,image/jpeg,image/webp">
      <button class="btn btn-ghost btn-sm" id="btn-add-covers" type="button">+ 添加分片载体（可选）</button>
      <span class="ref-state" id="covers-state">仅使用当前图片</span></div>`);
    document.getElementById('embed-params').after(box);
    document.getElementById('btn-add-covers').addEventListener('click', () => document.getElementById('cover-input').click());
    document.getElementById('cover-input').addEventListener('change', async (e) => {
      covers = [];
      for (const f of Array.from(e.target.files || [])) {
        try { const img = await SL.core.image.loadFile(f); img.fileName = f.name; covers.push(img); } catch (err) { U().toast('分片载体载入失败：' + f.name, 'err'); }
      }
      document.getElementById('covers-state').textContent = covers.length ? covers.length + ' 张分片载体（+当前图片）' : '仅使用当前图片';
      updateCapacity();
    });
    const first = SL.stego.registry.find((m) => m.group === '无损');
    if (first) {
      pick(first);
      const node = document.querySelector(`#embed-methods .method-item[data-id="${first.id}"]`);
      if (node) { node.classList.add('active'); node.closest('.method-group').classList.add('open'); }
    }
    document.querySelectorAll('.ptab').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.ptab').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      mode = b.dataset.payload;
      document.getElementById('payload-text').hidden = mode !== 'text';
      document.getElementById('payload-file-drop').hidden = mode !== 'file';
      updateCapacity();
    }));
    document.getElementById('payload-text').addEventListener('input', updateCapacity);
    document.getElementById('payload-file-drop').addEventListener('click', () => document.getElementById('payload-file').click());
    document.getElementById('payload-file').addEventListener('change', (e) => {
      payloadFile = e.target.files[0] || null;
      document.getElementById('payload-file-name').textContent = payloadFile ? `${payloadFile.name} · ${SL.core.bytes.formatBytes(payloadFile.size)}` : '点击选择文件';
      updateCapacity();
    });
  }

  function payloadSize() {
    if (mode === 'file') return payloadFile ? payloadFile.size : 0;
    const v = document.getElementById('payload-text').value;
    return v ? SL.core.bytes.utf8(v).length : 0;
  }

  function capacityOf(m, params) {
    if (!st().img) return 0;
    if (m.id === 'append' || m.id === 'text') return Infinity;
    try { return m.capacity(st().img, params) || 0; } catch (e) { return 0; }
  }

  function updateCapacity() {
    if (!current || !st().img) return;
    const params = U().readParams(document.getElementById('embed-params'));
    const need = payloadSize();
    let cap = capacityOf(current, params);
    let note = '';
    if (current.id === 'lsb' && covers.length) {
      const each = [st().img].concat(covers).map((c) => SL.core.lsb.capacityBytes(c, params.bits || 1, params.channels || 'RGB', params.opaque !== false));
      const min = Math.min(...each);
      cap = Math.max(0, min - 22) * each.length;
      note = ` · ${each.length} 片，每片 ${min} B`;
    }
    const B = SL.core.bytes;
    const text = document.getElementById('embed-capacity-text');
    const bar = document.getElementById('embed-capacity-bar');
    if (!cap) { text.textContent = '容量 —'; bar.style.width = '0%'; return; }
    const pct = cap === Infinity ? (need ? 1 : 0) : Math.min(1, need / cap);
    bar.style.width = (pct * 100).toFixed(1) + '%';
    bar.style.background = need > cap ? 'var(--red)' : '';
    text.textContent = cap === Infinity ? `不限 · 载荷 ${B.formatBytes(need)}` : `${B.formatBytes(need)} / ${B.formatBytes(cap)}${note}`;
  }

  async function getPayload() {
    if (mode === 'file') {
      if (!payloadFile) throw new Error('请选择要隐藏的文件');
      return new Uint8Array(await payloadFile.arrayBuffer());
    }
    const v = document.getElementById('payload-text').value;
    if (!v) throw new Error('请输入要隐藏的文本');
    return SL.core.bytes.utf8(v);
  }

  async function run() {
    if (!st().img || !current) return;
    const btn = document.getElementById('embed-run');
    btn.disabled = true;
    U().progress(true, current.lossless ? '嵌入并回读自检' : '执行鲁棒嵌入', current.label);
    U().setStatus('嵌入中…', true);
    try {
      const payload = await getPayload();
      const params = U().readParams(document.getElementById('embed-params'));
      if (current.id === 'lsb' && covers.length) params.covers = [st().img].concat(covers);
      const res = await SL.pipeline.embed(st().img, current.id, payload, params);
      st().embed = { res, payload };
      render(res, payload);
      U().setStatus(`${current.label} 完成`, false);
    } catch (e) {
      console.error(e);
      U().toast('嵌入失败：' + e.message, 'err');
      U().setStatus('嵌入失败', false);
    } finally {
      btn.disabled = false;
      U().progress(false);
    }
  }

  function render(res, payload) {
    const B = SL.core.bytes, box = document.getElementById('embed-result');
    box.className = 'embed-result glass';
    box.innerHTML = '';
    const chk = res.selfCheck || (res.images[0] && res.images[0].selfCheck);
    box.appendChild(U().el(`<div class="result-head"><div><span class="chip">${U().esc(current.group)}</span><h3>${U().esc(current.label)}</h3></div><span class="method-id">${U().esc(current.id)}</span></div>`));
    if (chk) box.appendChild(U().selfCheckBlock(chk, !!res.robust));
    box.appendChild(U().metricGrid([
      ['载荷', B.formatBytes(payload.length)],
      ['帧长', B.formatBytes(res.frame ? res.frame.length : 0)],
      ['载体数', String(res.total || 1)],
      ['耗时', (res.ms || 0).toFixed(0) + ' ms']
    ]));
    if (res.frame) box.appendChild(U().frameTable(res.frame));
    const actions = U().el('<div class="result-actions"></div>');
    res.images.forEach((r, i) => {
      const name = (st().img.fileName || 'carrier').replace(/\.[^.]+$/, '') +
        (res.total > 1 ? `_part${i + 1}of${res.total}` : '_stego') + '.png';
      const a = U().downloadRow(name, r.bytes, 'image/png');
      actions.appendChild(a);
    });
    box.appendChild(actions);
    if (res.robust) {
      box.appendChild(U().el(`<p class="muted" style="margin-top:10px">实验方法：不保证经过重压缩、缩放或裁剪后仍能提取，也不保证能被 Python 脚本直接读出（随机调度为网页自有实现）。</p>`));
    }
    if (res.total > 1) {
      box.appendChild(U().el(`<p class="muted" style="margin-top:6px">多载体分片：请把 ${res.total} 张图片全部保存，提取时一起提供。</p>`));
    }
  }

  SL.ui.embedPanel = { run };
  SL.ui.panels.push({
    onImage() { document.getElementById('embed-run').disabled = !current; updateCapacity(); },
    onReset() { document.getElementById('embed-run').disabled = true; }
  });
  document.addEventListener('DOMContentLoaded', () => {
    build();
    document.getElementById('embed-run').addEventListener('click', run);
  });
})();
