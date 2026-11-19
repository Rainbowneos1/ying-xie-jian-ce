(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  const U = () => SL.ui;
  const st = () => SL.ui.state;

  function renderVerdict(report) {
    const box = document.getElementById('detect-verdict');
    const v = report.verdict;
    const cls = v.level === 'high' ? 'verdict danger' : v.level === 'medium' ? 'verdict warn' : 'verdict info';
    const icon = v.level === 'high' ? '⚠' : v.level === 'medium' ? '◐' : '✓';
    const high = report.findings.filter((f) => f.severity === 'high').length;
    const med = report.findings.filter((f) => f.severity === 'medium').length;
    box.outerHTML = `<div id="detect-verdict" class="${cls} glass">
      <div class="verdict-orb">${icon}</div>
      <div><h3>${U().esc(v.title)}</h3><p>${U().esc(v.text)}</p></div>
      <div class="verdict-score"><b>${high}</b>HIGH · ${med} MEDIUM<br>${U().esc(v.sub)}</div>
    </div>`;
  }

  function renderFindings(report) {
    const list = document.getElementById('detect-findings');
    const head = document.getElementById('findings-count');
    list.innerHTML = '';
    head.textContent = report.findings.length + ' 项';
    report.findings.forEach((f, i) => list.appendChild(U().findingCard(f, i)));
  }

  function renderCapacity(report) {
    const box = document.getElementById('detect-capacity');
    const B = SL.core.bytes;
    box.innerHTML = report.capacities.map((c) => `<div class="cap-row"><span>${U().esc(c.label)}</span><b>${c.bytes === Infinity ? '不限' : B.formatBytes(c.bytes)}</b></div>`).join('');
  }

  async function run() {
    if (!st().img) return;
    const btn = document.getElementById('btn-analyze');
    btn.disabled = true;
    U().progress(true, '正在体检', '容器 / 已知帧 / 空域统计 / 频域梳齿');
    U().setStatus('检测中…', true);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const report = await SL.pipeline.analyze(st().img, { ref: st().ref, robust: false });
      st().report = report;
      renderVerdict(report);
      renderFindings(report);
      renderCapacity(report);
      U().setStatus(`检测完成 · ${report.findings.filter((f) => f.severity === 'high').length} 高置信`, false);
    } catch (e) {
      console.error(e);
      U().toast('检测失败：' + e.message, 'err');
      U().setStatus('检测失败', false);
    } finally {
      btn.disabled = false;
      U().progress(false);
    }
  }

  function exportReport() {
    const report = st().report;
    if (!report) { U().toast('还没有可导出的报告，先执行检测', 'err'); return; }
    const text = JSON.stringify(report, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v), 2);
    const a = U().downloadText('stegolab-report-' + Date.now() + '.json', text, 'application/json');
    document.body.appendChild(a); a.click(); a.remove();
    U().toast('报告已导出', 'ok');
  }

  SL.ui.detectPanel = { run, exportReport };
  SL.ui.panels.push({
    onReset() { document.getElementById('findings-count').textContent = '0 项'; },
    onImage() { if (st().report) { renderVerdict(st().report); renderFindings(st().report); renderCapacity(st().report); } }
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-analyze').addEventListener('click', run);
    document.getElementById('btn-export-report').addEventListener('click', exportReport);
  });
})();
