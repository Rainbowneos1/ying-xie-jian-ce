# StegoLab · 浏览器端隐写取证工作台

纯前端、零依赖、无构建的单页应用：上传一张图片，在同一页完成 **可疑信号体检 → 去隐写 → 藏入信息 → 提取信息**，并可下载处理后的图片与 JSON 报告。

- 运行入口：`index.html`
- 自测入口：`tests/test.html`（算法层）、`tests/ui-smoke.html`（四工作区 UI 链路）
- 无服务器、无 CDN、无第三方库；全部脚本以传统 `<script src>` 顺序加载并挂在 `window.StegoLab`

## 运行方式

| 方式 | 操作 | 说明 |
| --- | --- | --- |
| 直接打开 | 双击 `index.html` | `file://` 下可用，脚本已避开 ES module 与 `fetch` |
| 本地静态服务 | 在 `stego_web/` 下执行 `python -m http.server 8765`，访问 `http://127.0.0.1:8765/` | 推荐；自测页同样走该方式 |

浏览器要求：Chromium 系 103+（Edge/Chrome）或 Firefox 113+。需要 `DecompressionStream('deflate')`、`CompressionStream`、Canvas 2D、`createImageBitmap`、`crypto.getRandomValues`。IE 与 Safari 15 以下不可用。

## 四工作区

1. **检测**：PNG 容器结构、尾随字节、可疑元数据块、可解析 STG1 帧、LSB 比例与位平面熵、χ²/RS/SPA/PVD、DCT 关系法“梳齿”、高通残差对照、颜色数与网格异常；按 高/中/低 置信分级给出证据、解释与建议，可导出 JSON 报告与容量表。
2. **去隐写**：14 种净化/攻击方法，输出 PNG（避免二次有损），逐项展示 PSNR、maxΔ、像素变化率与体积变化，附前后拖动对比。
3. **隐写**：3 种无损方法 + 7 种实验鲁棒方法；载荷可为文本或任意文件；实时容量提示与多载体分片。
4. **提取**：自动依次尝试文件尾 → tEXt → LSB 八种参数组合 → 鲁棒引导头；也可手动指定参数。支持分片收集与重组、文本预览、二进制下载。

## 方法清单

### 无损（严格回读自检）

| id | 名称 | 说明 |
| --- | --- | --- |
| `lsb` | LSB 低位嵌入 | 1/2 bit × RGB/RGBA × 仅不透明像素；按通道优先逐像素写低位；支持多载体分片 |
| `append` | 文件尾附加 | IEND 之后追加 STG1 帧，不改变像素 |
| `text` | PNG tEXt 文本块 | `StegoData = base64(STG1 帧)`，不改变像素；重存/压缩即丢失 |

三者在生成图片后立即重新解码 → 用同一解码器提取 → 与原始载荷逐字节比对 + CRC32 校验，只有全部通过才显示“回读自检通过”，失败直接报错、不出结果图（分片场景会先重组全部帧再比对）。

### 实验鲁棒（不保证处理后仍可提取）

| id | 名称 | 关键参数 |
| --- | --- | --- |
| `lsbm` | LSBM ±1 匹配 | key |
| `pvd` | PVD 差分分层 | key |
| `dct_ss` | DCT 符号扩频 | key / alpha / repeat / ncoef |
| `dct_qim` | DCT-QIM 量化索引 | key / strength / repeat / ncoef |
| `dct_rel` | DCT 关系法 | key / strength / repeat / ncoef（≤4，系数对不重叠） |
| `dwt_qim` | DWT-QIM 小波细节 | key / strength / repeat |
| `blk_qim` | 块均值 QIM | key / strength / repeat |

鲁棒方法在 STG1 帧前加 16 字节 `WEB1` 引导头（magic/version/method/payload_bits/CRC16，4× 重复嵌入），提取时先解引导头再按长度解帧，也允许手动指定方法硬解。随机调度使用自写的 SplitMix64 确定性 PRNG：同 key 必得同调度。UI 对这些方法标注 `EXPERIMENTAL`，嵌入结果只做“未处理回读”判定，不宣称抗压缩/抗缩放能力。

### 去隐写方法

| 分组 | 方法 |
| --- | --- |
| 轻度 / 标准 / 深度 | `rebuild`（JPEG q95 + 1bit 随机化）、`balanced`（q85 + 1bit + 缩放 0.985）、`aggressive`（q45 + 2bit + 缩放 0.94） |
| 强力 | `jpeg15`、`anti_forensic`（25→55→88 往返）、`ao_overwrite`（自适应覆写 + 锐化）、`strongest`（q15 + 2× 缩放 + USM + 噪声） |
| 定向 | `equalize`（配对幅度拉平）、`mag_shuffle`（块内中频幅度置换）、`noise20`（中频噪声）、`shift4`（右移 4px）、`crop4`（裁边后缩放） |
| 附加 | `jpeg_q45`、`jpeg_q30` |

## 无损保证与边界

- **保证范围**：`lsb` / `append` / `text` 在“本工具输出 → 本工具提取”闭环内逐字节无损；分片链路额外保证重组顺序与 CRC。
- **不保证**：任何二次编辑（聊天软件转发、截图、缩放、转 JPEG、平台压缩）都会破坏 LSB 与 tEXt；`append` 在部分平台重存时被截断。
- **检测口径**：结论统一表述为“发现可疑信号 / 当前工具检出”，不宣称图片绝对存在或不存在隐写。无独立干净参考图时，χ²/RS/SPA/PVD 只展示统计量，不单独作为高置信结论；梳齿命中要求同时满足峰占比与色数条件。
- **浏览器数值差异**：浏览器 JPEG 编码、缩放与 PIL 不完全一致，因此清除效果用于演示与相对比较，**不复现 Python 脚本的精确 BER 数值**。
- **鲁棒方法**：网页自有 PRNG 与参数调度，生成的图片**不保证能被现有 Python 脚本直接提取**；反之亦然。

## 与 Python 脚本的互通性

互通部分已逐字节比对验证（帧十六进制 + LSB 写入后像素 SHA-256 均与 `stego_common.py` 完全一致）：

- STG1 帧：`>4sBBI` 头（magic/method/flags/payload_len） + 可选 `>HHI` 分片头 + 载荷 + CRC32；**CRC32 覆盖“头 + 分片头 + 载荷”**。
- flags：bit0 分片、bit1 RGBA、bit2 仅不透明像素、bit3-4 表示 bits-1（0x18 位段）。
- 方法号：`1 = LSB`、`2 = APPEND`、`3 = TEXT`；tEXt 关键字 `StegoData`，值为 base64(帧)。
- LSB 写入顺序：通道优先（R→G→B→A）→ 行优先像素 → 每组 `bits` 位按高位到低位写入。

因此 `stego_extract.py --method lsb|append|text` 可读取网页产出的图片（参数需一致：bits / channels / opaque-only），反向亦然。鲁棒方法不在互通范围内。

## 目录结构

```text
stego_web/
├── index.html              单页骨架：品牌栏 / 上传区 / 四工作区 / 结果区
├── README.md
├── css/style.css           暗色取证实验室主题
├── js/
│   ├── core/               crc32 / bytes / png / frame / lsb / image / dct / prng / metrics
│   ├── analysis/           container / frame-probe / lsb-stats / comb / residual / scan
│   ├── stego/              lsb / append / text / lsbm / pvd / strong / robust
│   ├── clean/              basic / enhanced / targeted
│   ├── pipeline.js         analyze / clean / embed / extract 编排与自检
│   └── ui/                 app / detect-panel / clean-panel / embed-panel / extract-panel / components
└── tests/
    ├── test.html           算法层 19 项断言（逐字节往返、分片重组、检测口径）
    └── ui-smoke.html       四工作区 12 项 UI 链路（iframe 驱动真实 DOM）
```

## 自测

```text
tests/test.html      期望标题 PASS 19/19
tests/ui-smoke.html  期望标题 PASS 12/12
```

`test.html` 覆盖：PNG 精确编解码、CRC/帧解析、LSB 八种参数组合、append、tEXt、三载体分片重组、7 种鲁棒方法未处理回读、检测分级阈值。
`ui-smoke.html` 覆盖：载入与体检渲染、标准净化 + 指标、处理结果回填为新载体、LSB 单载体/分片嵌入与自检、分片缺口提示与重组下载、文件尾通道回读、干净图“未发现载荷”、鲁棒方法实验徽标、重置、运行期无 `console.error`。

两项均为零依赖页面，可直接双击打开，也可在无头浏览器中读取 `document.title` 做回归。若用 `playwright-cli` 且本机未装 Playwright 自带 Chromium，可加 `--browser=msedge` 复用系统 Edge。

## 已知限制

- 单位置上限 40MP / 4096×4096；超限直接拒绝。
- PNG 解码走自写管线（支持 8-bit 灰度/RGB/调色板/灰度+Alpha/RGBA）；16-bit 与交错 PNG 回退到 `createImageBitmap` 并标注“近似解码”，但输出仍为自写 PNG，故“输出 → 提取”闭环自洽。
- 隐写图禁止走 `canvas.toBlob`：浏览器会做色彩管理与 Alpha 预乘，破坏低位与像素原值。
- 大图 DCT/多轮嵌入按 8×8 分块处理并让出主线程，进度条显示已完成块数。
