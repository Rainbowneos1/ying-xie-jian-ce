(function () {
  'use strict';
  const SL = (window.StegoLab = window.StegoLab || {});
  SL.analysis = SL.analysis || {};
  const B = SL.core.bytes, M = SL.core.metrics;
  const SEV = { high: 0, medium: 1, low: 2, info: 3 };

  function mk(id, category, severity, title, detail, evidence, suggestion) {
    return { id, category, severity, title, detail, evidence: evidence || [], suggestion: suggestion || '' };
  }
  const pct = (v) => (v * 100).toFixed(2) + '%';

  function statFindings(st, comb, res, cal) {
    const out = [];
    const z = (k) => (cal && cal.keys[k] ? cal.keys[k].z : null);
    const ztxt = (k) => {
      const v = z(k);
      return v == null ? '无参考图' : `z=${v.toFixed(2)}`;
    };

    out.push(mk('lsb-ratio', '空域统计', 'info', 'LSB 位平面比例',
      '随机化 LSB 会让 0/1 比例趋近 50%，位平面熵趋近 1。多数自然图像的 LSB 也接近 50%，因此这条只作辅助。',
      [['平均 1 占比', pct(st.lsb.one)], ['R/G/B', st.lsb.channels.map(pct).join(' / ')], ['位平面熵', st.lsb.entropy.toFixed(4)], ['参考图', ztxt('lsbOne')]], ''));

    const chiSev = st.chi.p > 0.99 ? 'medium' : st.chi.p > 0.9 ? 'low' : 'info';
    out.push(mk('chi2', '空域统计', chiSev, `χ² 卡方攻击 p=${st.chi.p.toFixed(4)}`,
      '对值对 (2i, 2i+1) 做卡方检验：顺序 LSB 替换会让值对趋于相等，p 接近 1。自然图像通常 p 很小。',
      [['χ²', st.chi.chi2.toFixed(2)], ['df', st.chi.df], ['p', st.chi.p.toFixed(4)], ['参考图', ztxt('chi2p')]],
      st.chi.p > 0.99 ? '结合参考图确认；无参考图时不要单独当作结论。' : ''));

    const rsSev = Math.abs(st.rs.diff) < 0.01 && Math.abs(st.rs.diffN) < 0.01 ? 'medium' : 'low';
    out.push(mk('rs', '空域统计', rsSev, 'RS 分析',
      'RS（Regular/Singular）用翻转前后平滑度变化估计嵌入率。Rm-Sm 与 R-m-S-m 同时趋近 0，往往对应接近满嵌或极度平滑的图。',
      [['Rm', st.rs.Rm.toFixed(4)], ['Sm', st.rs.Sm.toFixed(4)], ['R-m', st.rs.Rn.toFixed(4)], ['S-m', st.rs.Sn.toFixed(4)], ['差值', (st.rs.diff - st.rs.diffN).toFixed(4)], ['参考图', ztxt('rsAsym')]], ''));

    out.push(mk('spa', '空域统计', 'low', `SPA 类奇偶不平衡 ${st.spa.imbalance.toFixed(4)}`,
      '对水平相邻像素对按 (偶,奇) 差分统计；嵌入会让奇偶计数趋于一致，不平衡量下降。单图无基线，只作趋势指标。',
      [['不平衡量', st.spa.imbalance.toFixed(4)], ['样本对', st.spa.total], ['参考图', ztxt('spaImbalance')]], ''));

    const pvdSev = st.pvd.smallRatio > 0.62 ? 'low' : 'info';
    out.push(mk('pvd', '空域统计', pvdSev, 'PVD 差分区间直方图',
      'PVD 类方法按差值区间分配比特数，区间边界会出现台阶。若小差值对占比异常高，说明像素被平滑/重编码过。',
      [['≤7 占比', pct(st.pvd.smallRatio)], ['区间计数', st.pvd.counts.join(' / ')], ['样本', st.pvd.total]], ''));

    const combSev = !comb.usable ? 'info'
      : (comb.colors > 30 && comb.excess > 0.03 && comb.primary.comb > 1.8) ? 'high'
        : ((comb.excess > 0.012 && comb.primary.comb > 1.4) || (comb.primary.peakMass > 0.08 && comb.primary.comb > 1.6)) ? 'medium'
          : 'info';
    out.push(mk('comb', '频域关系', combSev, `DCT 关系法梳齿 peak=${pct(comb.primary.peakMass)}`,
      '关系法隐写把两组中频系数的幅度比推向 0 或 1，比值直方图会出现尖峰（梳齿）。这是本工具最可靠的空域/频域统计证据；彩色照片需要色数 > 30 才有效。',
      [['峰值占比', pct(comb.primary.peakMass)], ['峰/肩比', comb.primary.comb.toFixed(2)],
      ['平移 4px 峰值', comb.shifted ? pct(comb.shifted.peakMass) : '未计算'], ['校准超额', comb.excess.toFixed(4)], ['颜色数', comb.colors]],
      combSev === 'high' ? '这只说明“像关系法嵌入”，也可能来自强对比插画；请结合其他证据。' : ''));

    out.push(mk('residual', '频域残差', 'info', '高通残差对照',
      '5×5 高通残差的方差与熵对 LSB 随机化敏感；平移 4px 后的同一统计量作为自身对照。',
      [['残差方差', res.usable ? res.variance.toFixed(2) : '—'], ['残差熵', res.usable ? res.entropy.toFixed(3) : '—'],
      ['平移后方差', res.usable ? res.shiftVariance.toFixed(2) : '—'], ['方差比', res.usable ? res.varianceRatio.toFixed(3) : '—'],
      ['±对称偏差', res.usable ? res.symmetry.toFixed(4) : '—']], ''));
    return out;
  }

  async function run(img, opts) {
    opts = opts || {};
    const findings = [];
    const container = await SL.analysis.container.run(img);
    findings.push(...container);
    const probe = await SL.analysis.frameProbe.probe(img, { robust: !!opts.robust, keys: opts.keys });
    findings.push(...probe.findings);

    const st = SL.analysis.lsbStats.stats(img);
    const comb = SL.analysis.comb.run(img);
    const res = SL.analysis.residual.run(img);
    let cal = null;
    if (opts.ref) {
      try { cal = SL.analysis.lsbStats.calibrate(img, opts.ref); } catch (e) { cal = null; }
    }
    findings.push(...statFindings(st, comb, res, cal));

    if (opts.ref) {
      findings.push(mk('calibrated', '校准', 'info', `已用参考图标定（${cal ? cal.tiles : 0} 个瓦片）`,
        cal ? '把参考图切成 3×3 瓦片，按 mean ± 3σ 给出 z 分数；|z| > 3 才算偏离参考分布。' : '参考图过小，无法切出足够瓦片。',
        cal ? Object.keys(cal.keys).slice(0, 5).map((k) => [k, 'z=' + cal.keys[k].z.toFixed(2)]) : [], ''));
    } else {
      findings.push(mk('no-ref', '校准', 'info', '未提供干净参考图',
        'χ² / RS / SPA / PVD / 残差都依赖图像内容本身的先验。没有同源干净图时，这些统计量只能横向比较，不能单独定论。',
        [], '如果有同设备、同场景的干净图，上传后会自动做 mean ± 3σ 标定。'));
    }

    const sorted = findings.sort((a, b) => (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9));
    const high = sorted.filter((f) => f.severity === 'high').length;
    const medium = sorted.filter((f) => f.severity === 'medium').length;
    const verdict = high
      ? { level: 'high', title: '发现可疑隐写信号', sub: `${high} 项高置信命中`, text: '高置信项来自容器结构、可解析载荷帧或关系法梳齿。请结合证据逐条核对，再决定清除或提取。' }
      : medium
        ? { level: 'medium', title: '存在需要复核的信号', sub: `${medium} 项中等置信`, text: '统计量偏离参考区间，但没有决定性证据。建议提供干净参考图，或用「去隐写」重编码后复测。' }
        : { level: 'low', title: '当前工具未发现明显可疑信号', sub: '未检出不代表绝对不存在', text: '已覆盖容器、已知帧、空域统计与频域梳齿。对抗性隐写、加密载荷或非本工具格式仍可能逃过检出。' };

    const capacities = M.capacities(img).concat(
      (SL.stego.registry || []).filter((m) => m.capacity && m.group !== '无损')
        .map((m) => { let v = 0; try { v = m.capacity(img, {}); } catch (e) { v = 0; } return { label: m.label + '（默认参数）', bytes: v }; })
    );
    return {
      generatedAt: new Date().toISOString(),
      image: {
        name: img.fileName || '—', width: img.width, height: img.height, format: img.format,
        bytes: img.bytes ? img.bytes.length : null, exactPNG: !!img.exactPNG,
        colors: M.colorCount(img), alpha: M.alphaStats(img), entropy: M.entropy(img)
      },
      verdict, findings: sorted, stats: st, comb, residual: res, calibration: cal,
      capacities, probeHits: probe.hits.map((h) => ({ channel: h.channel, id: h.id || '', params: h.params }))
    };
  }

  SL.analysis.scan = { run, statFindings, SEV };
})();
