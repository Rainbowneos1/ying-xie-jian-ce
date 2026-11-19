(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.ui = SL.ui || {};
  SL.ui.panels = SL.ui.panels || [];
  const U = () => SL.ui;
  const state = SL.ui.state = { img: null, ref: null, report: null, clean: null, embed: null, previewURL: null };

  function emit(kind) { for (const p of SL.ui.panels) if (p[kind]) { try { p[kind](state); } catch (e) { console.error(e); } } }
  SL.ui.emit = emit;

  function metaHTML(img) {
    const M = SL.core.metrics, B = SL.core.bytes;
    const a = M.alphaStats(img);
    const info = img.info || {};
    const fmt = (img.format || 'PNG').toUpperCase() + (info.bitDepth ? ' / ' + info.bitDepth + 'bit' : '') +
      (info.colorType != null ? ' / type ' + info.colorType : '');
    const alignW = img.width % 8, alignH = img.height % 8;
    const cells = [
      ['SIZE', img.width + '×' + img.height],
      ['FORMAT', fmt],
      ['BYTES', img.bytes ? B.formatBytes(img.bytes.length) : '—'],
      ['COLORS', M.colorCount(img).toLocaleString()],
      ['ALPHA', a.transparent ? `全透明 ${a.transparent}` : a.partial ? `半透明 ${a.partial}` : '无'],
      ['8×8 GRID', alignW === 0 && alignH === 0 ? '对齐' : `余 ${alignW}×${alignH} px`]
    ];
    return cells.map(([k, v]) => `<div class="meta"><b>${U().esc(v)}</b><span>${k}</span></div>`).join('');
  }

  async function loadFile(file) {
    if (!file) return;
    U().progress(true, '解码图片', file.name);
    U().setStatus('正在解码 ' + file.name, true);
    try {
      const img = await SL.core.image.loadFile(file);
      img.fileName = file.name;
      img.format = (file.type || '').split('/')[1] || (file.name.split('.').pop() || 'png');
      state.img = img;
      state.report = null;
      state.clean = null;
      state.embed = null;
      if (state.previewURL) URL.revokeObjectURL(state.previewURL);
      state.previewURL = URL.createObjectURL(file);
      document.getElementById('preview-original').src = state.previewURL;
      document.getElementById('file-name').textContent = file.name;
      document.getElementById('image-meta').innerHTML = metaHTML(img);
      document.getElementById('upload-empty').hidden = true;
      document.getElementById('upload-loaded').hidden = false;
      document.getElementById('preview-tag').textContent = img.exactPNG ? 'CARRIER · EXACT' : 'CARRIER · APPROX';
      U().setStatus(`${file.name} · ${img.width}×${img.height}`, false);
      if (img.warning) U().toast(img.warning, 'err');
      emit('onImage');
      if (SL.ui.detectPanel) await SL.ui.detectPanel.run();
    } catch (e) {
      console.error(e);
      U().toast('载入失败：' + e.message, 'err');
      U().setStatus('载入失败', false);
    } finally {
      U().progress(false);
    }
  }
  SL.ui.loadFile = loadFile;

  async function loadRef(file) {
    if (!file) return;
    U().progress(true, '解码参考图', file.name);
    try {
      const img = await SL.core.image.loadFile(file);
      img.fileName = file.name;
      state.ref = img;
      document.getElementById('ref-state').textContent = `已载入 ${file.name} · ${img.width}×${img.height}`;
      U().toast('参考图已载入，下次检测会做 mean ± 3σ 标定', 'ok');
      if (state.img) await SL.ui.detectPanel.run();
    } catch (e) {
      U().toast('参考图载入失败：' + e.message, 'err');
    } finally { U().progress(false); }
  }

  function reset() {
    state.img = null; state.ref = null; state.report = null; state.clean = null; state.embed = null;
    if (state.previewURL) URL.revokeObjectURL(state.previewURL);
    state.previewURL = null;
    document.getElementById('upload-empty').hidden = false;
    document.getElementById('upload-loaded').hidden = true;
    document.getElementById('file-input').value = '';
    document.getElementById('ref-state').textContent = '未提供 · χ²/RS/SPA/PVD 仅作参考';
    document.getElementById('preview-original').removeAttribute('src');
    document.getElementById('detect-findings').innerHTML = '';
    document.getElementById('detect-verdict').outerHTML = '<div id="detect-verdict" class="verdict-empty glass"><div class="verdict-orb">⌗</div><div><h3>等待载体</h3><p>载入图片后自动执行一次全量筛查。</p></div></div>';
    document.getElementById('detect-capacity').innerHTML = '<p class="muted">载入图片后计算。</p>';
    document.getElementById('clean-result').className = 'clean-result glass empty-result';
    document.getElementById('clean-result').innerHTML = '<div class="empty-result-icon">✦</div><p>执行后显示前后对比与画质指标。</p>';
    document.getElementById('embed-result').className = 'embed-result glass empty-result';
    document.getElementById('embed-result').innerHTML = '<div class="empty-result-icon">⇩</div><p>生成结果、自检结论与下载入口会出现在这里。</p>';
    document.getElementById('extract-result').className = 'extract-result glass empty-result';
    document.getElementById('extract-result').innerHTML = '<div class="empty-result-icon">⇧</div><p>提取结果、帧信息与载荷下载会出现在这里。</p>';
    U().setStatus('等待载入载体', false);
    emit('onReset');
  }

  function initTabs() {
    const tabs = document.getElementById('tabs');
    const glow = document.getElementById('tab-glow');
    tabs.querySelectorAll('.tab').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        tabs.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        const panel = document.getElementById('panel-' + btn.dataset.tab);
        if (panel) panel.classList.add('active');
        glow.style.transform = `translateX(${i * 100}%)`;
        emit('onTab');
      });
    });
  }

  function initUpload() {
    const dz = document.getElementById('dropzone');
    const input = document.getElementById('file-input');
    dz.addEventListener('click', (e) => { if (!e.target.closest('button') && !e.target.closest('input')) input.click(); });
    input.addEventListener('change', () => loadFile(input.files[0]));
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === dz) dz.classList.remove('dragover'); }));
    dz.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    document.getElementById('btn-change-file').addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
    document.getElementById('btn-ref').addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('ref-input').click(); });
    document.getElementById('ref-input').addEventListener('change', (e) => loadRef(e.target.files[0]));
    document.getElementById('btn-reset').addEventListener('click', reset);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTabs(); initUpload();
    U().setStatus('等待载入载体', false);
  });
  SL.ui.reset = reset;
})();
