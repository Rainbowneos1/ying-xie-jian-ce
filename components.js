(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.ui = SL.ui || {};
  SL.ui.panels = SL.ui.panels || [];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function toast(msg, type) {
    const root = document.getElementById('toast-root');
    const node = el(`<div class="toast ${type === 'err' ? 'err' : type === 'ok' ? 'ok' : ''}">${esc(msg)}</div>`);
    root.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }
  function progress(on, title, sub) {
    const ov = document.getElementById('progress-overlay');
    if (on) {
      document.getElementById('progress-title').textContent = title || '处理中';
      document.getElementById('progress-sub').textContent = sub || '请稍候…';
      ov.hidden = false;
    } else ov.hidden = true;
  }
  function setStatus(text, busy) {
    const pill = document.getElementById('status-pill');
    document.getElementById('status-text').textContent = text;
    pill.classList.toggle('busy', !!busy);
  }
  function severityLabel(s) {
    return { high: 'HIGH', medium: 'MED', low: 'LOW', info: 'INFO' }[s] || 'INFO';
  }
  function findingCard(f, idx) {
    const ev = (f.evidence || []).map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join('');
    return el(`<article class="finding sev-${esc(f.severity)}" style="animation-delay:${Math.min(idx * 30, 240)}ms">
      <div class="finding-head"><span class="sev-badge">${severityLabel(f.severity)}</span>
        <span class="chip">${esc(f.category)}</span><h4>${esc(f.title)}</h4></div>
      <p>${esc(f.detail)}</p>
      ${ev ? `<div class="evidence">${ev}</div>` : ''}
      ${f.suggestion ? `<div class="suggestion">▸ ${esc(f.suggestion)}</div>` : ''}
    </article>`);
  }
  function metricGrid(items) {
    return el(`<div class="metric-grid">${items.map(([k, v]) => `<div class="metric-card"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`);
  }
  function downloadRow(name, bytes, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    a.className = 'btn btn-ghost btn-sm';
    a.textContent = '下载 ' + name;
    a.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(url), 120000));
    return a;
  }
  function downloadText(name, text, mime) {
    return downloadRow(name, new TextEncoder().encode(text), mime || 'text/plain;charset=utf-8');
  }
  function compare(beforeURL, afterURL) {
    const wrap = el(`<div>
      <div class="compare"><img class="before" alt="原始"><div class="after"><img alt="处理后"></div><div class="compare-slider" style="left:50%"></div></div>
      <input type="range" class="compare-range" min="0" max="100" value="50" aria-label="前后对比">
    </div>`);
    const cmp = wrap.querySelector('.compare'), after = wrap.querySelector('.after');
    const afterImg = after.querySelector('img');
    wrap.querySelector('.before').src = beforeURL;
    afterImg.src = afterURL;
    const apply = (pct) => {
      const cw = cmp.clientWidth || cmp.getBoundingClientRect().width;
      after.style.width = pct + '%';
      afterImg.style.maxWidth = 'none';
      afterImg.style.width = cw + 'px';
      afterImg.style.height = '100%';
      afterImg.style.objectFit = 'contain';
      wrap.querySelector('.compare-slider').style.left = pct + '%';
    };
    wrap.querySelector('input').addEventListener('input', (e) => apply(+e.target.value));
    requestAnimationFrame(() => apply(50));
    return wrap;
  }
  function frameTable(frame) {
    const h = frame.header;
    const rows = [
      ['方法', SL.core.frame.methodName(h.method) + ' (0x' + h.method.toString(16) + ')'],
      ['flags', '0x' + h.flags.toString(16)],
      ['载荷长度', h.payloadLen + ' B（含 CRC ' + (frame.crcOk ? '通过' : '失败') + '）'],
      ['CRC32', '0x' + (h.crc >>> 0).toString(16).padStart(8, '0')]
    ];
    if (frame.flagsInfo) frame.flagsInfo.forEach(([k, v]) => rows.push([k, v]));
    if (h.split) rows.push(['分片', `${h.splitIndex + 1}/${h.splitTotal} · session ${h.session.toString(16)}`]);
    rows.push(['帧总长', frame.length + ' B']);
    return el(`<table class="frame-table">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`);
  }
  function selfCheckBlock(chk, robust, ctx) {
    const ok = chk.ok;
    const cls = ok ? 'selfcheck' : 'selfcheck fail';
    if (ctx === 'extract') {
      const title = ok ? '帧校验通过 · 载荷完整' : '帧校验未通过';
      const sub = ok
        ? `帧头长度、CRC32 与载荷一致，共 ${chk.bytesExpected} 字节${chk.crcOk ? '' : '（CRC 缺失）'}。`
        : `帧头或 CRC 校验失败：${chk.reason || '载荷可能被破坏'}。`;
      return el(`<div class="${cls}"><div><b>${title}</b><small>${esc(sub)}</small></div></div>`);
    }
    const title = ok ? '回读自检通过 · 逐字节一致' : '回读自检未通过';
    const sub = ok
      ? `重新解码输出文件并按同参数提取，${chk.bytesExpected} 字节完全一致${chk.crcOk ? '，CRC32 通过' : ''}。`
      : `${robust ? '鲁棒方法不承诺无损提取' : '已中止输出'}：期望 ${chk.bytesExpected} B，实得 ${chk.bytesGot} B${chk.crcOk ? '' : '，CRC 失败'}${chk.reason ? '，' + chk.reason : ''}。`;
    return el(`<div class="${cls}"><div><b>${title}</b><small>${esc(sub)}</small></div></div>`);
  }
  function methodRail(container, methods, groups, onPick) {
    container.innerHTML = '';
    for (const g of groups) {
      const items = methods.filter((m) => m.group === g);
      if (!items.length) continue;
      const node = el(`<div class="method-group"><button type="button">${esc(g)}<i>›</i></button><div class="method-items"></div></div>`);
      node.querySelector('button').addEventListener('click', () => node.classList.toggle('open'));
      const box = node.querySelector('.method-items');
      for (const m of items) {
        const b = el(`<button class="method-item" type="button" data-id="${esc(m.id)}">
          <b>${esc(m.label)}</b><small>${esc(m.group)}</small>
          ${m.lossless ? '<span class="method-badge badge-lossless">LOSSLESS</span>' : '<span class="method-badge badge-experimental">EXPERIMENTAL</span>'}
        </button>`);
        b.addEventListener('click', () => {
          box.parentElement.parentElement.querySelectorAll('.method-item').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          onPick(m);
        });
        box.appendChild(b);
      }
      container.appendChild(node);
    }
  }
  function paramFields(container, params, values) {
    container.innerHTML = '';
    for (const p of params || []) {
      const cur = values[p.key] != null ? values[p.key] : p.value;
      let input;
      if (p.type === 'select') {
        input = document.createElement('select');
        for (const [v, label] of p.options || []) {
          const o = document.createElement('option');
          o.value = String(v); o.textContent = label;
          o.dataset.num = typeof v === 'number' ? '1' : '0';
          input.appendChild(o);
        }
        input.value = String(cur);
      } else if (p.type === 'checkbox') {
        const lab = el(`<label class="check"><span>${esc(p.label || p.key)}</span></label>`);
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = cur !== false;
        input.dataset.key = p.key;
        input.dataset.num = '0';
        input.dataset.bool = '1';
        lab.insertBefore(input, lab.firstChild);
        container.appendChild(lab);
        continue;
      } else {
        input = document.createElement('input');
        input.type = 'number';
        if (p.min != null) input.min = p.min;
        if (p.max != null) input.max = p.max;
        input.value = cur;
        input.dataset.num = '1';
      }
      input.dataset.key = p.key;
      const wrap = el(`<div class="param-field"><label>${esc(p.label || p.key)}</label></div>`);
      wrap.appendChild(input);
      if (p.min != null || p.max != null) {
        const sm = document.createElement('small');
        sm.textContent = `${p.min != null ? p.min : '-∞'} … ${p.max != null ? p.max : '∞'}`;
        wrap.appendChild(sm);
      }
      container.appendChild(wrap);
    }
  }
  function readParams(container) {
    const out = {};
    container.querySelectorAll('input,select').forEach((i) => {
      const k = i.dataset.key;
      if (!k) return;
      if (i.dataset.bool === '1') out[k] = !!i.checked;
      else if (i.dataset.num === '1') out[k] = Number(i.value);
      else out[k] = i.value;
    });
    return out;
  }

  SL.ui.esc = esc; SL.ui.el = el; SL.ui.toast = toast; SL.ui.progress = progress; SL.ui.setStatus = setStatus;
  SL.ui.findingCard = findingCard; SL.ui.metricGrid = metricGrid; SL.ui.downloadRow = downloadRow;
  SL.ui.downloadText = downloadText; SL.ui.compare = compare; SL.ui.frameTable = frameTable;
  SL.ui.selfCheckBlock = selfCheckBlock; SL.ui.methodRail = methodRail; SL.ui.paramFields = paramFields;
  SL.ui.readParams = readParams;
})();
