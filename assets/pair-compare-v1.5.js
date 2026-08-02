(function attachPairComparison(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrindPSDPairCompareV15 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPairComparison() {
  "use strict";

  function normalizePair(ids = []) {
    const result = [];
    const seen = new Set();
    (ids || []).forEach((id) => {
      const key = String(id || "");
      if (!key || seen.has(key) || result.length >= 2) return;
      seen.add(key);
      result.push(key);
    });
    return result;
  }

  function replacePairSelection(ids = [], slotIndex = 0, nextId = "") {
    const pair = normalizePair(ids);
    const slot = Number(slotIndex) === 1 ? 1 : 0;
    const next = String(nextId || "");
    if (pair.length !== 2 || !next) return pair;
    const otherSlot = slot === 0 ? 1 : 0;
    if (pair[slot] === next) return pair;
    if (pair[otherSlot] === next) return [pair[1], pair[0]];
    pair[slot] = next;
    return normalizePair(pair);
  }

  const api = Object.freeze({
    version: "1.5.0",
    normalizePair,
    replacePairSelection
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

  function injectStyles() {
    if (document.getElementById("pairCompareV15Styles")) return;
    const style = document.createElement("style");
    style.id = "pairCompareV15Styles";
    style.textContent = `
      .pair-compare-panel{margin:0 0 12px;padding:12px;border:1px solid #3a2f26;border-radius:12px;background:#15110e}
      .pair-compare-panel[hidden]{display:none}
      .pair-compare-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
      .pair-compare-head strong{color:#efe6da;font-size:14px}
      .pair-compare-head span{color:#a89880;font-size:12px;text-align:right}
      .pair-selector-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
      .pair-selector-grid label{display:grid;gap:5px;min-width:0;color:#b9aa96;font-size:12px}
      .pair-selector-grid select{width:100%;min-width:0}
      .pair-chart-shell{border:1px solid #30261f;border-radius:10px;background:#0d0b09;overflow:auto}
      #canvasCmpPair2d{display:block;width:100%;min-width:560px}
      .pair-compare-note{margin:8px 0 0;color:#8f806e;font-size:11px;line-height:1.5}
      @media(max-width:640px){
        .pair-compare-head{display:block}
        .pair-compare-head span{display:block;margin-top:4px;text-align:left}
        .pair-selector-grid{grid-template-columns:1fr}
      }
    `;
    document.head.appendChild(style);
  }

  function selectedRecords() {
    return [...state.selectedHistoryIds]
      .map((id) => state.store.records.find((record) => record.id === id))
      .filter(Boolean)
      .slice(0, 10);
  }

  function availableRecords() {
    return [...(state.store?.records || [])].sort((a, b) => {
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
  }

  function optionMarkup(records, selectedId, otherId) {
    return records.map((record) => {
      const selected = record.id === selectedId ? " selected" : "";
      const disabled = record.id === otherId ? " disabled" : "";
      return `<option value="${escapeMarkup(record.id)}"${selected}${disabled}>${escapeMarkup(recordLabel(record))}</option>`;
    }).join("");
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
    panel.hidden = records.length !== 2;
    if (records.length !== 2) return panel;

    const all = availableRecords();
    panel.innerHTML = `
      <div class="pair-compare-head">
        <strong>两测次平面柱状对比</strong>
        <span>可在本页直接替换 Z1 或 Z2，无需返回历史记录。</span>
      </div>
      <div class="pair-selector-grid">
        <label><span>Z1 测次</span><select data-pair-slot="0">${optionMarkup(all, records[0].id, records[1].id)}</select></label>
        <label><span>Z2 测次</span><select data-pair-slot="1">${optionMarkup(all, records[1].id, records[0].id)}</select></label>
      </div>
      <div class="pair-chart-shell"><canvas id="canvasCmpPair2d" role="img" aria-label="两条测次的平面并列柱状对比图"></canvas></div>
      <p class="pair-compare-note" id="pairCompareNoteV15"></p>`;

    panel.querySelectorAll("[data-pair-slot]").forEach((select) => {
      select.addEventListener("change", () => {
        const current = normalizePair([...state.selectedHistoryIds]);
        const next = replacePairSelection(current, Number(select.dataset.pairSlot), select.value);
        if (next.length !== 2) return;
        state.selectedHistoryIds = new Set(next);
        state.selectedRecordId = next[0];
        if (typeof updateHistorySelectionStatus === "function") updateHistorySelectionStatus();
        renderMultiCompare();
      });
    });
    return panel;
  }

  function drawPairChart(canvas, records, note) {
    if (!canvas || records.length !== 2) return;
    const aligned = GrindPSDPolicyCore.alignPercentageDistributions(records, Core.getRecordSieves);
    const bins = aligned.bins;
    const series = aligned.series;
    const { ctx, width, height } = setupCanvas(canvas);
    const compact = width < 620;
    const pad = { left: compact ? 42 : 58, right: 18, top: 48, bottom: compact ? 54 : 66 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const maxValue = Math.max(...series.flatMap((item) => item.values), 1) * 1.16;
    const groupW = plotW / Math.max(1, bins.length);
    const gap = Math.max(2, groupW * 0.05);
    const barW = Math.max(3, Math.min(34, (groupW - gap * 3) / 2));
    const colors = [paletteForIndex(0), paletteForIndex(1)];

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
      const center = pad.left + groupW * (binIndex + 0.5);
      series.forEach((item, seriesIndex) => {
        const value = item.values[binIndex] || 0;
        const barH = plotH * value / maxValue;
        const x = center + (seriesIndex === 0 ? -barW - gap / 2 : gap / 2);
        const y = pad.top + plotH - barH;
        ctx.fillStyle = colors[seriesIndex];
        ctx.fillRect(x, y, barW, barH);
        if (value > 0 && groupW > 48) {
          ctx.fillStyle = "#efe6da";
          ctx.font = `${compact ? 7 : 9}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(`${formatPlainNumber(value, 1)}%`, x + barW / 2, y - 4);
        }
      });
      ctx.fillStyle = "#a89880";
      ctx.font = `${compact ? 7 : 9}px sans-serif`;
      ctx.textAlign = "center";
      const label = String(bin.shortLabel || bin.range || "");
      ctx.fillText(label.length > 11 ? `${label.slice(0, 10)}…` : label, center, pad.top + plotH + 18);
    });

    ctx.font = `${compact ? 9 : 10}px sans-serif`;
    ctx.textAlign = "left";
    let legendX = pad.left;
    records.forEach((record, index) => {
      const label = `Z${index + 1} · ${record.grinder.brand} ${record.grinder.model} · ${record.grinder.setting}`;
      ctx.fillStyle = colors[index];
      ctx.fillRect(legendX, 16, 12, 12);
      ctx.fillStyle = "#efe6da";
      ctx.fillText(label.length > 34 ? `${label.slice(0, 33)}…` : label, legendX + 17, 26);
      legendX += Math.min(width * 0.48, 18 + ctx.measureText(label).width + 24);
    });

    if (note) {
      note.textContent = "二维图固定使用百分比；不同筛孔区间按实际边界并列，任一测次缺失的区间按 0% 补全。";
    }
  }

  function renderPairComparison() {
    const records = selectedRecords();
    const panel = ensurePanel(records);
    if (!panel || records.length !== 2) return;
    drawPairChart(
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
    renderMultiCompare = function renderMultiCompareV15() {
      originalRenderMultiCompare();
      renderPairComparison();
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
