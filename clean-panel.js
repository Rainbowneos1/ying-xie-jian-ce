(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  const U = () => SL.ui;
  const st = () => SL.ui.state;
  const GROUPS = ['轻度', '标准', '深度', '强力', '定向', '附加'];
  let current = null;

  function pick(m) {
    current = m;
    document.getElementById('clean-group-chip').textContent = m.group;
    document.getElementById('clean-title').textContent = m.label;
    document.getElementById('clean-desc').textContent = m.desc;
    document.getElementById('clean-method-id').textContent = m.id;
    U().paramFields(document.getElementById('clean-params'), m.params, {});
    document.getElementById('clean-run').disabled = !st().img;
  }

  function build() {
    U().methodRail(document.getElementById('clean-groups'), SL.clean.registry, GROUPS, pick);
    const first = SL.clean.registry.find((m) => m.id === 'balanced') || SL.clean.registry[0];
    if (first) {
      pick(first);
      const node = document.querySelector(`#clean-groups .method-item[data-id="${first.id}"]`);
      if (node) { node.classList.add('active'); node.closest('.method-group').classList.add('open'); }
    }
  }

  async function run() {
    if (!st().img || !current) return;
    const btn = document.getElementById('clean-run');
    btn.disabled = true;
    U().progress(true, '执行清除', current.label);
    U().setStatus('清除中…', true);
    try {
      const params = U().readParams(document.getElementById('clean-params'));
      const res = await SL.pipeline.clean(st().img, current.id, params);
      st().clean = res;
      render(res);
      U().setStatus('清除完成 · ' + current.label, false);
    } catch (e) {
      console.error(e);
      U().toast('清除失败：' + e.message, 'err');
      U().setStatus('清除失败', false);
    } finally {
      btn.disabled = false;
      U().progress(false);
    }
  }

  function render(res) {
    const B = SL.core.bytes, box = document.getElementById('clean-result');
    box.className = 'clean-result glass';
    box.innerHTML = '';
    const m = res.metrics;
    box.appendChild(U().el(`<div class="result-head"><div><span class="chip">${U().esc(res.method.group)}</span><h3>${U().esc(res.method.label)}</h3></div><span class="method-id">${U().esc(res.method.id)}</span></div>`));
    box.appendChild(U().metricGrid([
      ['PSNR', m.psnr ? m.psnr.toFixed(2) + ' dB' : '∞'],
      ['MAX Δ', m.maxDelta.toFixed(0)],
      ['变化像素', (m.changedRatio * 100).toFixed(1) + '%'],
      ['体积', (m.sizeBefore ? B.formatBytes(m.sizeBefore) + ' → ' : '') + B.formatBytes(m.sizeAfter)],
      ['耗时', m.ms.toFixed(0) + ' ms']
    ]));
    const before = st().previewURL;
    if (before) box.appendChild(U().compare(before, res.image.url));
    const actions = U().el('<div class="result-actions"></div>');
    actions.appendChild(U().downloadRow(res.image.fileName, res.bytes, 'image/png'));
    const use = U().el('<button class="btn btn-ghost btn-sm" type="button">用处理结果作为新载体</button>');
    use.addEventListener('click', async () => {
      const name = (res.image.fileName || 'cleaned').replace(/\.[^.]+$/, '') + '_cleaned.png';
      await U().loadFile(new File([res.bytes], name, { type: 'image/png' }));
      U().toast('已切换载体并重新体检', 'ok');
    });
    actions.appendChild(use);
    box.appendChild(actions);
    box.appendChild(U().el('<p class="muted" style="margin-top:10px">浏览器 JPEG 编码与 PIL 不完全一致，此处结果用于相对比较；输出统一为 PNG，避免二次有损。</p>'));
  }

  SL.ui.cleanPanel = { run };
  SL.ui.panels.push({
    onImage() {
      document.getElementById('clean-run').disabled = !current;
      const box = document.getElementById('clean-result');
      box.className = 'clean-result glass empty-result';
      box.innerHTML = '<div class="empty-result-icon">✦</div><p>执行后显示前后对比与画质指标。</p>';
    },
    onReset() { document.getElementById('clean-run').disabled = true; }
  });
  document.addEventListener('DOMContentLoaded', () => {
    build();
    document.getElementById('clean-run').addEventListener('click', run);
  });
})();
