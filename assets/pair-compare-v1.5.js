(function attachPairComparison(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrindPSDPairCompareV15 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPairComparison() {
  "use strict";

  const MIN_FLAT_RECORDS = 2;
  const MAX_FLAT_RECORDS = 4;

  function normalizeFlatSelection(ids = []) {
    const result = [];
    const seen = new Set();
    (ids || []).forEach((id) => {
      const key = String(id || "");
      if (!key || seen.has(key) || result.length >= MAX_FLAT_RECORDS) return;
      seen.add(key);
      result.push(key);
    });
    return result;
  }

  function replaceFlatSelection(ids = [], slotIndex = 0, nextId = "") {
    const selection = normalizeFlatSelection(ids);
    const slot = Number(slotIndex);
    const next = String(nextId || "");
    if (!Number.isInteger(slot) || slot < 0 || slot >= selection.length || !next) return selection;
    if (selection[slot] === next) return selection;
    const existingIndex = selection.indexOf(next);
    if (existingIndex >= 0) {
      [selection[slot], selection[existingIndex]] = [selection[existingIndex], selection[slot]];
      return selection;
    }
    selection[slot] = next;
    return normalizeFlatSelection(selection);
  }

  function moveFlatSelection(ids = [], slotIndex = 0, direction = 0) {
    const selection = normalizeFlatSelection(ids);
    const slot = Number(slotIndex);
    const step = Number(direction) < 0 ? -1 : Number(direction) > 0 ? 1 : 0;
    const target = slot + step;
    if (!Number.isInteger(slot) || !step || slot < 0 || slot >= selection.length || target < 0 || target >= selection.length) {
      return selection;
    }
    [selection[slot], selection[target]] = [selection[target], selection[slot]];
    return selection;
  }

  function appendFlatSelection(ids = [], nextId = "") {
    const selection = normalizeFlatSelection(ids);
    const next = String(nextId || "");
    if (!next || selection.includes(next) || selection.length >= MAX_FLAT_RECORDS) return selection;
    return [...selection, next];
  }

  function removeFlatSelection(ids = [], slotIndex = 0) {
    const selection = normalizeFlatSelection(ids);
    const slot = Number(slotIndex);
    if (!Number.isInteger(slot) || slot < 0 || slot >= selection.length || selection.length <= MIN_FLAT_RECORDS) {
      return selection;
    }
    selection.splice(slot, 1);
    return selection;
  }

  const api = Object.freeze({
    version: "1.6.0",
    MIN_FLAT_RECORDS,
    MAX_FLAT_RECORDS,
    normalizeFlatSelection,
    replaceFlatSelection,
    moveFlatSelection,
    appendFlatSelection,
    removeFlatSelection,
    normalizePair: normalizeFlatSelection,
    replacePairSelection: replaceFlatSelection
  });

  if (typeof document === "undefined") return api;

  const root = typeof window !== "undefined" ? window : globalThis;

  function escapeMarkup(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[character]));
  }

  function shortDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || "");
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
  }

  function recordLabel(record) {
    const grinder = record?.grinder || {};
    const bean = record?.sample?.bean ? ` · ${record.sample.bean}` : "";
    return `${shortDate(record?.createdAt)} · ${grinder.brand || "—"} ${grinder.model || "—"} · 刻度 ${grinder.setting || "—"}${bean}`;
  }

  function colorForIndex(index) {
    return typeof paletteForIndex === "function" ? paletteForIndex(index) : [
      "#d98e32", "#8ab4f8", "#6fbf73", "#e05d8a"
    ][index % 4];
  }

  function injectStyles() {
    if (document.getElementById("pairCompareV15Styles")) return;
    const style = document.createElement("style");
    style.id = "pairCompareV15Styles";
    style.textContent = `
      .pair-compare-panel{margin:0 0 12px;padding:12px;border:1px solid #3a2f26;border-radius:12px;background:#15110e}
      .pair-compare-panel[hidden]{display:none}
      .pair-compare-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
      .pair-compare-head strong{color:#efe6da;font-size:14px}
      .pair-compare-head-copy{display:grid;gap:3px}
      .pair-compare-head-copy span{color:#a89880;font-size:12px}
      .flat-compare-add{white-space:nowrap}
      .pair-selector-grid{display:grid;gap:8px;margin-bottom:12px}
      .flat-selector-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px;border:1px solid #332920;border-radius:9px;background:#0d0b09}
      .flat-selector-index{display:flex;align-items:center;gap:7px;min-width:48px;color:#efe6da;font-size:12px;font-weight:700}
      .flat-selector-dot{width:10px;height:10px;border-radius:50%;box-shadow:0 0 0 2px rgba(255,255,255,.08)}
      .flat-selector-row select{width:100%;min-width:0}
      .flat-selector-actions{display:flex;gap:4px}
      .flat-selector-actions button{width:30px;height:30px;padding:0}
      .flat-selector-actions button:disabled{opacity:.28}
      .pair-chart-shell{border:1px solid #30261f;border-radius:10px;background:#0d0b09;overflow:hidden}
      #canvasCmpPair2d{display:block;width:100%;min-width:0;max-width:100%}
      .pair-compare-note{margin:8px 0 0;color:#8f806e;font-size:11px;line-height:1.5}
      @media(max-width:640px){
        .pair-compare-head{display:grid}
        .flat-compare-add{width:100%}
        .flat-selector-row{grid-template-columns:auto minmax(0,1fr)}
        .flat-selector-row select{grid-column:1/-1}
        .flat-selector-actions{grid-column:1/-1;justify-self:end}
      }
    `;
    document.head.appendChild(style);
  }

  function selectedRecords() {
    return normalizeFlatSelection([...state.selectedHistoryIds])
      .map((id) => state.store.records.find((record) => record.id === id))
      .filter(Boolean);
  }

  function availableRecords() {
    return [...(state.store?.records || [])].sort((a, b) => {
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
  }

  function optionMarkup(records, selectedId) {
    return records.map((record) => {
      const selected = record.id === selectedId ? " selected" : "";
      return `<option value="${escapeMarkup(record.id)}"${selected}>${escapeMarkup(recordLabel(record))}</option>`;
    }).join("");
  }

  function commitSelection(ids) {
    const next = normalizeFlatSelection(ids);
    if (next.length < MIN_FLAT_RECORDS) return;
    state.selectedHistoryIds = new Set(next);
    state.selectedRecordId = next[0];
    if (typeof updateHistorySelectionStatus === "function") updateHistorySelectionStatus();
    renderMultiCompare();
  }

  function selectorRow(record, index, count, allRecords) {
    return `
      <div class="flat-selector-row" data-flat-slot-row="${index}">
        <span class="flat-selector-index"><i class="flat-selector-dot" style="background:${colorForIndex(index)}"></i>Z${index + 1}</span>
        <select data-flat-slot="${index}" aria-label="选择 Z${index + 1} 测次">${optionMarkup(allRecords, record.id)}</select>
        <span class="flat-selector-actions">
          <button class="ghost small" type="button" data-flat-move="-1" data-flat-index="${index}" aria-label="上移 Z${index + 1}"${index === 0 ? " disabled" : ""}>↑</button>
          <button class="ghost small" type="button" data-flat-move="1" data-flat-index="${index}" aria-label="下移 Z${index + 1}"${index === count - 1 ? " disabled" : ""}>↓</button>
          <button class="danger small" type="button" data-flat-remove="${index}" aria-label="移除 Z${index + 1}"${count <= MIN_FLAT_RECORDS ? " disabled" : ""}>×</button>
        </span>
      </div>`;
  }

  function ensurePanel(records) {
    const multi = document.getElementById("multiRecordDetail");
    const canvas3d = document.getElementById("canvasCmpMulti3d");
    if (!multi || !canvas3d) return null;
    let panel = document.getElementById("pairComparePanelV15");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "pairComparePanelV15";
      panel.className = "pair-compare-panel";
      const anchor = document.getElementById("interactive3dToolbar") || canvas3d.closest(".canvas-scroll");
      multi.insertBefore(panel, anchor || null);
    }
    const eligible = records.length >= MIN_FLAT_RECORDS && records.length <= MAX_FLAT_RECORDS;
    panel.hidden = !eligible;
    if (!eligible) return panel;

    const all = availableRecords();
    const nextAvailable = all.find((record) => !records.some((selected) => selected.id === record.id));
    panel.innerHTML = `
      <div class="pair-compare-head">
        <span class="pair-compare-head-copy">
          <strong>平面柱状与曲线对比</strong>
          <span>支持 2–4 条测次；可在本页分别替换、增减和调整 Z 轴顺序。</span>
        </span>
        <button class="ghost small flat-compare-add" type="button" data-flat-add${records.length >= MAX_FLAT_RECORDS || !nextAvailable ? " disabled" : ""}>＋ 增加测次</button>
      </div>
      <div class="pair-selector-grid">
        ${records.map((record, index) => selectorRow(record, index, records.length, all)).join("")}
      </div>
      <div class="pair-chart-shell"><canvas id="canvasCmpPair2d" role="img" aria-label="二至四条测次的平面柱状与曲线对比图"></canvas></div>
      <p class="pair-compare-note" id="pairCompareNoteV15"></p>`;

    panel.querySelectorAll("[data-flat-slot]").forEach((select) => {
      select.addEventListener("change", () => {
        const current = normalizeFlatSelection([...state.selectedHistoryIds]);
        commitSelection(replaceFlatSelection(current, Number(select.dataset.flatSlot), select.value));
      });
    });
    panel.querySelectorAll("[data-flat-move]").forEach((button) => {
      button.addEventListener("click", () => {
        const current = normalizeFlatSelection([...state.selectedHistoryIds]);
        commitSelection(moveFlatSelection(current, Number(button.dataset.flatIndex), Number(button.dataset.flatMove)));
      });
    });
    panel.querySelectorAll("[data-flat-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        const current = normalizeFlatSelection([...state.selectedHistoryIds]);
        commitSelection(removeFlatSelection(current, Number(button.dataset.flatRemove)));
      });
    });
    panel.querySelector("[data-flat-add]")?.addEventListener("click", () => {
      const current = normalizeFlatSelection([...state.selectedHistoryIds]);
      const candidate = availableRecords().find((record) => !current.includes(record.id));
      if (candidate) commitSelection(appendFlatSelection(current, candidate.id));
    });
    return panel;
  }

  function barGeometry(groupCenter, groupWidth, seriesCount, seriesIndex) {
    const usable = groupWidth * 0.78;
    const gap = Math.max(1.5, Math.min(4, groupWidth * 0.025));
    const barWidth = Math.max(2, Math.min(28, (usable - gap * (seriesCount - 1)) / seriesCount));
    const total = barWidth * seriesCount + gap * (seriesCount - 1);
    const x = groupCenter - total / 2 + seriesIndex * (barWidth + gap);
    return { x, width: barWidth, center: x + barWidth / 2 };
  }

  function drawFlatChart(canvas, records, note) {
    if (!canvas || records.length < MIN_FLAT_RECORDS || records.length > MAX_FLAT_RECORDS) return;
    const aligned = GrindPSDPolicyCore.alignPercentageDistributions(records, Core.getRecordSieves);
    const bins = aligned.bins;
    const series = aligned.series;
    const { ctx, width, height } = setupCanvas(canvas);
    const compact = width < 620;
    const pad = { left: compact ? 42 : 58, right: 18, top: 24, bottom: compact ? 54 : 66 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const maxValue = Math.max(...series.flatMap((item) => item.values), 1) * 1.16;
    const groupW = plotW / Math.max(1, bins.length);
    const colors = records.map((_, index) => colorForIndex(index));
    const points = series.map(() => []);

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#3a2f26";
    ctx.fillStyle = "#a89880";
    ctx.font = `${compact ? 8 : 10}px sans-serif`;
    ctx.textAlign = "right";
    for (let tick = 0; tick <= 4; tick += 1) {
      const value = maxValue * tick / 4;
      const y = pad.top + plotH - plotH * tick / 4;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillText(`${formatPlainNumber(value, 0)}%`, pad.left - 6, y + 3);
    }

    bins.forEach((bin, binIndex) => {
      const groupCenter = pad.left + groupW * (binIndex + 0.5);
      series.forEach((item, seriesIndex) => {
        const value = item.values[binIndex] || 0;
        const barH = plotH * value / maxValue;
        const geometry = barGeometry(groupCenter, groupW, series.length, seriesIndex);
        const y = pad.top + plotH - barH;
        ctx.globalAlpha = 0.58;
        ctx.fillStyle = colors[seriesIndex];
        ctx.fillRect(geometry.x, y, geometry.width, barH);
        ctx.globalAlpha = 1;
        points[seriesIndex].push({ x: geometry.center, y, value });
        if (value > 0 && groupW > 82 && series.length <= 3) {
          ctx.fillStyle = "#efe6da";
          ctx.font = `${compact ? 7 : 9}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(`${formatPlainNumber(value, 1)}%`, geometry.center, y - 5);
        }
      });
      ctx.fillStyle = "#a89880";
      ctx.font = `${compact ? 7 : 9}px sans-serif`;
      ctx.textAlign = "center";
      const label = String(bin.shortLabel || bin.range || "");
      ctx.fillText(label.length > 11 ? `${label.slice(0, 10)}…` : label, groupCenter, pad.top + plotH + 18);
    });

    points.forEach((linePoints, seriesIndex) => {
      if (!linePoints.length) return;
      ctx.strokeStyle = colors[seriesIndex];
      ctx.lineWidth = compact ? 1.8 : 2.2;
      ctx.beginPath();
      linePoints.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      linePoints.forEach((point) => {
        ctx.fillStyle = colors[seriesIndex];
        ctx.beginPath();
        ctx.arc(point.x, point.y, compact ? 2.5 : 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#0d0b09";
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    });

    if (note) {
      note.textContent = `${records.length} 条测次固定使用百分比；柱体与折线颜色均对应 Z1–Z${records.length}。不同筛孔区间按实际边界对齐，缺失区间按 0% 补全。`;
    }
  }

  function renderFlatComparison() {
    const records = selectedRecords();
    const panel = ensurePanel(records);
    if (!panel || records.length < MIN_FLAT_RECORDS || records.length > MAX_FLAT_RECORDS) return;
    drawFlatChart(
      document.getElementById("canvasCmpPair2d"),
      records,
      document.getElementById("pairCompareNoteV15")
    );
  }

  function install(attempt = 0) {
    if (root.__grindPsdPairCompareV15Installed) return;
    if (
      typeof renderMultiCompare !== "function" ||
      typeof setupCanvas !== "function" ||
      typeof state === "undefined" ||
      !root.GrindPSDPolicyCore
    ) {
      if (attempt < 60) setTimeout(() => install(attempt + 1), 50);
      return;
    }
    root.__grindPsdPairCompareV15Installed = true;
    injectStyles();
    const originalRenderMultiCompare = renderMultiCompare;
    renderMultiCompare = function renderMultiCompareV16() {
      originalRenderMultiCompare();
      renderFlatComparison();
    };
    if (state.selectedHistoryIds?.size > 1 && state.activeTab === "array3d") renderMultiCompare();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(() => install(), 80), { once: true });
  } else {
    setTimeout(() => install(), 80);
  }

  return api;
});
