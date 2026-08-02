(function attachGrindPsdPolicyCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrindPSDPolicyCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGrindPsdPolicyCore() {
  "use strict";

  const RECORD_PREFIX = "gpsd-";
  const DAILY_SEQUENCE_CAPACITY = 36 ** 3;
  const CHECK_CAPACITY = 36 ** 2;

  function compactPair(value) {
    const text = String(value ?? "")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return `${text}xx`.slice(0, 2);
  }

  function base36(value, width) {
    const numeric = Math.max(0, Math.trunc(Number(value) || 0));
    return numeric.toString(36).padStart(width, "0").slice(-width);
  }

  function dateCode(input) {
    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) throw new Error("Invalid date for record ID");
    return [
      String(date.getFullYear()).slice(-2),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("");
  }

  function createRecordId({ userId, email, now = new Date(), existingIds = [] } = {}) {
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) throw new Error("Invalid date for record ID");
    const emailLocal = String(email || "").split("@")[0];
    const bodyPrefix = `${compactPair(userId)}${compactPair(emailLocal)}${dateCode(date)}`;
    const fullPrefix = `${RECORD_PREFIX}${bodyPrefix}`;
    const used = new Set((existingIds || []).map((id) => String(id || "").toLowerCase()));
    let maxSequence = -1;
    used.forEach((id) => {
      if (!id.startsWith(fullPrefix)) return;
      const token = id.slice(fullPrefix.length, fullPrefix.length + 3);
      if (!/^[0-9a-z]{3}$/.test(token)) return;
      const value = Number.parseInt(token, 36);
      if (Number.isFinite(value)) maxSequence = Math.max(maxSequence, value);
    });
    const sequence = maxSequence + 1;
    if (sequence >= DAILY_SEQUENCE_CAPACITY) {
      throw new Error("Daily record sequence exhausted");
    }
    const sequenceToken = base36(sequence, 3);
    const seed = (date.getTime() + sequence * 131) % CHECK_CAPACITY;
    for (let offset = 0; offset < CHECK_CAPACITY; offset += 1) {
      const checkToken = base36((seed + offset) % CHECK_CAPACITY, 2);
      const candidate = `${fullPrefix}${sequenceToken}${checkToken}`;
      if (!used.has(candidate)) return candidate;
    }
    throw new Error("Unable to allocate collision-free record ID");
  }

  function finiteOrNull(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function parsedRange(range) {
    const text = String(range || "").replace(/,/g, "");
    let match = text.match(/[≥>]\s*(\d+(?:\.\d+)?)/);
    if (match) return { lowerUm: Number(match[1]), upperUm: null };
    match = text.match(/(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)/);
    if (match) return { lowerUm: Number(match[1]), upperUm: Number(match[2]) };
    match = text.match(/[<≤]\s*(\d+(?:\.\d+)?)/);
    if (match) return { lowerUm: null, upperUm: Number(match[1]) };
    return { lowerUm: null, upperUm: null };
  }

  function intervalLabel(lowerUm, upperUm) {
    if (lowerUm !== null && upperUm === null) return `≥ ${lowerUm} μm`;
    if (lowerUm !== null && upperUm !== null) return `${lowerUm}–${upperUm} μm`;
    if (lowerUm === null && upperUm !== null) return `< ${upperUm} μm`;
    return "未定义区间";
  }

  function intervalKey(lowerUm, upperUm) {
    return `${lowerUm === null ? "min" : lowerUm}:${upperUm === null ? "max" : upperUm}`;
  }

  function recordIntervals(record, getSieves) {
    const sieves = typeof getSieves === "function" ? getSieves(record) : [];
    const weights = record?.weightsGrams || {};
    const reportedTotal = Number(record?.totalG);
    const calculatedTotal = Object.values(weights).reduce((sum, value) => {
      const numeric = Number(value);
      return sum + (Number.isFinite(numeric) && numeric >= 0 ? numeric : 0);
    }, 0);
    const total = reportedTotal > 0 ? reportedTotal : calculatedTotal;
    return sieves.map((sieve, index) => {
      const fallback = parsedRange(sieve?.range);
      let lowerUm = finiteOrNull(sieve?.apertureUm);
      let upperUm = null;
      if (index > 0) upperUm = finiteOrNull(sieves[index - 1]?.apertureUm);
      if (lowerUm === null) lowerUm = fallback.lowerUm;
      if (upperUm === null) upperUm = fallback.upperUm;
      if (index === 0 && fallback.upperUm === null) upperUm = null;
      const mass = Math.max(0, Number(weights[sieve?.key]) || 0);
      return {
        key: intervalKey(lowerUm, upperUm),
        lowerUm,
        upperUm,
        range: intervalLabel(lowerUm, upperUm),
        shortLabel: intervalLabel(lowerUm, upperUm).replace(/\s*μm$/, ""),
        massG: mass,
        percentage: total > 0 ? mass / total * 100 : 0
      };
    });
  }

  function compareIntervals(a, b) {
    const aUpper = a.upperUm === null ? Number.POSITIVE_INFINITY : a.upperUm;
    const bUpper = b.upperUm === null ? Number.POSITIVE_INFINITY : b.upperUm;
    if (aUpper !== bUpper) return bUpper - aUpper;
    const aLower = a.lowerUm === null ? Number.NEGATIVE_INFINITY : a.lowerUm;
    const bLower = b.lowerUm === null ? Number.NEGATIVE_INFINITY : b.lowerUm;
    return bLower - aLower;
  }

  function alignPercentageDistributions(records, getSieves) {
    const rows = Array.isArray(records) ? records.filter(Boolean) : [];
    const intervalMap = new Map();
    const perRecord = rows.map((record) => {
      const intervals = recordIntervals(record, getSieves);
      const values = new Map();
      intervals.forEach((interval) => {
        intervalMap.set(interval.key, {
          key: interval.key,
          lowerUm: interval.lowerUm,
          upperUm: interval.upperUm,
          range: interval.range,
          shortLabel: interval.shortLabel
        });
        values.set(interval.key, interval.percentage);
      });
      return { record, values };
    });
    const bins = [...intervalMap.values()].sort(compareIntervals);
    return {
      bins,
      series: perRecord.map(({ record, values }) => ({
        record,
        values: bins.map((bin) => values.get(bin.key) || 0)
      }))
    };
  }

  function orderSelectedIds(selectedIds = [], preferredIds = []) {
    const selected = [];
    const selectedSet = new Set();
    (selectedIds || []).forEach((id) => {
      const key = String(id || "");
      if (!key || selectedSet.has(key)) return;
      selectedSet.add(key);
      selected.push(key);
    });
    const result = [];
    const added = new Set();
    (preferredIds || []).forEach((id) => {
      const key = String(id || "");
      if (!selectedSet.has(key) || added.has(key)) return;
      added.add(key);
      result.push(key);
    });
    selected.forEach((key) => {
      if (added.has(key)) return;
      added.add(key);
      result.push(key);
    });
    return result;
  }

  return Object.freeze({
    RECORD_PREFIX,
    DAILY_SEQUENCE_CAPACITY,
    CHECK_CAPACITY,
    compactPair,
    base36,
    dateCode,
    createRecordId,
    recordIntervals,
    alignPercentageDistributions,
    orderSelectedIds
  });
});

(function installComparisonOrdering(root) {
  "use strict";
  if (!root || typeof document === "undefined") return;

  const Policy = root.GrindPSDPolicyCore;
  const FALLBACK_COLORS = [
    "#d98e32", "#8ab4f8", "#6fbf73", "#e05d8a", "#b085f5",
    "#4dd0e1", "#ffd54f", "#ff8a65", "#64b5f6", "#c0ca33"
  ];

  function escapeMarkup(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[character]));
  }

  function recordDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || "");
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
  }

  function colorForPosition(index) {
    if (typeof paletteForIndex === "function") return paletteForIndex(index);
    return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  }

  function injectStyles() {
    if (document.getElementById("compareOrderingStyles")) return;
    const style = document.createElement("style");
    style.id = "compareOrderingStyles";
    style.textContent = `
      #multiCompareLegend.multi-compare-legend{display:block;margin:0 0 14px}
      .compare-order-panel{border:1px solid #3a2f26;border-radius:12px;background:#15110e;padding:12px}
      .compare-order-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
      .compare-order-heading strong{font-size:14px;color:#efe6da}
      .compare-order-heading span{font-size:12px;line-height:1.5;color:#a89880;text-align:right}
      .compare-order-list{display:grid;gap:8px;list-style:none;margin:0;padding:0}
      .compare-order-item{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;align-items:center;gap:9px;min-height:48px;padding:7px 8px;border:1px solid #332920;border-radius:10px;background:#0d0b09;user-select:none}
      .compare-order-item[draggable=true]{cursor:grab}
      .compare-order-item.dragging{opacity:.5;border-color:#d98e32;box-shadow:0 0 0 2px rgba(217,142,50,.18)}
      .compare-order-list.pointer-sorting .compare-order-item:not(.dragging){transition:transform .08s ease}
      button.compare-drag-handle{width:34px;height:34px;min-width:34px;padding:0;border:1px solid #4a3b2e;border-radius:8px;background:#201912;color:#d9c8b2;font-size:20px;line-height:1;cursor:grab;touch-action:none}
      button.compare-drag-handle:active{cursor:grabbing}
      .compare-order-dot{width:11px;height:11px;border-radius:50%;box-shadow:0 0 0 2px rgba(255,255,255,.08)}
      .compare-order-copy{min-width:0;display:grid;gap:2px}
      .compare-order-copy strong{font-size:13px;color:#efe6da}
      .compare-order-copy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#b9aa96}
      .compare-order-actions{display:flex;gap:4px}
      button.compare-order-step{width:30px;height:30px;padding:0;border:1px solid #3d3126;border-radius:7px;background:#19130f;color:#cdbba5}
      button.compare-order-step:disabled{opacity:.28}
      @media (max-width:600px){
        .compare-order-heading{display:block}
        .compare-order-heading span{display:block;margin-top:4px;text-align:left}
        .compare-order-item{grid-template-columns:auto auto minmax(0,1fr);gap:8px}
        .compare-order-actions{grid-column:3;justify-self:end;margin-top:-2px}
      }
    `;
    document.head.appendChild(style);
  }

  function refreshListPositions(list) {
    const items = [...list.querySelectorAll("[data-compare-order-id]")];
    items.forEach((item, index) => {
      const position = item.querySelector("[data-compare-position]");
      const dot = item.querySelector("[data-compare-color]");
      const handle = item.querySelector("[data-compare-drag-handle]");
      const up = item.querySelector('[data-compare-step="-1"]');
      const down = item.querySelector('[data-compare-step="1"]');
      if (position) position.textContent = `Z${index + 1}`;
      if (dot) dot.style.background = colorForPosition(index);
      if (handle) handle.setAttribute("aria-label", `拖动第 ${index + 1} 条记录调整对比顺序`);
      if (up) up.disabled = index === 0;
      if (down) down.disabled = index === items.length - 1;
      item.setAttribute("aria-posinset", String(index + 1));
      item.setAttribute("aria-setsize", String(items.length));
    });
  }

  function commitOrder(list) {
    const preferred = [...list.querySelectorAll("[data-compare-order-id]")]
      .map((item) => item.dataset.compareOrderId)
      .filter(Boolean);
    const selected = Policy.orderSelectedIds([...state.selectedHistoryIds], preferred);
    state.selectedHistoryIds = new Set(selected);
    renderMultiCompare();
  }

  function moveItemByStep(item, direction, list) {
    if (direction < 0) {
      const previous = item.previousElementSibling;
      if (previous) list.insertBefore(item, previous);
    } else {
      const next = item.nextElementSibling;
      if (next) list.insertBefore(next, item);
    }
    refreshListPositions(list);
    commitOrder(list);
  }

  function bindSorting(list) {
    let nativeItem = null;
    let nativeCommitted = false;
    let pointerItem = null;
    let pointerHandle = null;
    let pointerId = null;

    list.addEventListener("dragstart", (event) => {
      const item = event.target.closest("[data-compare-order-id]");
      if (!item) return;
      nativeItem = item;
      nativeCommitted = false;
      item.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.dataset.compareOrderId || "");
    });

    list.addEventListener("dragover", (event) => {
      if (!nativeItem) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const target = event.target.closest("[data-compare-order-id]");
      if (!target || target === nativeItem) return;
      const rect = target.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      list.insertBefore(nativeItem, after ? target.nextElementSibling : target);
      refreshListPositions(list);
    });

    function finishNative() {
      if (!nativeItem) return;
      nativeItem.classList.remove("dragging");
      nativeItem = null;
      if (!nativeCommitted) {
        nativeCommitted = true;
        commitOrder(list);
      }
    }

    list.addEventListener("drop", (event) => {
      if (!nativeItem) return;
      event.preventDefault();
      finishNative();
    });
    list.addEventListener("dragend", finishNative);

    list.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest("[data-compare-drag-handle]");
      if (!handle || event.pointerType === "mouse") return;
      const item = handle.closest("[data-compare-order-id]");
      if (!item) return;
      pointerItem = item;
      pointerHandle = handle;
      pointerId = event.pointerId;
      item.classList.add("dragging");
      list.classList.add("pointer-sorting");
      handle.setPointerCapture?.(pointerId);
      event.preventDefault();
    });

    list.addEventListener("pointermove", (event) => {
      if (!pointerItem || event.pointerId !== pointerId) return;
      event.preventDefault();
      pointerItem.style.pointerEvents = "none";
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-compare-order-id]");
      pointerItem.style.pointerEvents = "";
      if (!target || target === pointerItem || target.parentElement !== list) return;
      const rect = target.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      list.insertBefore(pointerItem, after ? target.nextElementSibling : target);
      refreshListPositions(list);
    }, { passive: false });

    function finishPointer(event) {
      if (!pointerItem || event.pointerId !== pointerId) return;
      pointerHandle?.releasePointerCapture?.(pointerId);
      pointerItem.classList.remove("dragging");
      list.classList.remove("pointer-sorting");
      pointerItem = null;
      pointerHandle = null;
      pointerId = null;
      commitOrder(list);
    }

    list.addEventListener("pointerup", finishPointer);
    list.addEventListener("pointercancel", finishPointer);

    list.querySelectorAll("[data-compare-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const item = button.closest("[data-compare-order-id]");
        if (item) moveItemByStep(item, Number(button.dataset.compareStep), list);
      });
    });

    list.querySelectorAll("[data-compare-drag-handle]").forEach((handle) => {
      handle.addEventListener("keydown", (event) => {
        if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const item = handle.closest("[data-compare-order-id]");
        if (item) moveItemByStep(item, event.key === "ArrowUp" ? -1 : 1, list);
      });
    });
  }

  function install() {
    if (root.__grindPsdCompareOrderingInstalled) return;
    if (!Policy || typeof renderMultiCompare !== "function" || typeof drawMultiRecord3D !== "function") return;
    root.__grindPsdCompareOrderingInstalled = true;
    injectStyles();

    renderMultiCompare = function renderMultiCompareSortable() {
      const records = [...state.selectedHistoryIds]
        .map((id) => state.store.records.find((record) => record.id === id))
        .filter(Boolean)
        .slice(0, 10);
      const legend = document.getElementById("multiCompareLegend");
      if (legend) {
        if (records.length < 2) {
          legend.innerHTML = "";
        } else {
          legend.innerHTML = `
            <div class="compare-order-panel">
              <div class="compare-order-heading">
                <strong>对比顺序</strong>
                <span>拖动记录调整 Z1–Z${records.length}；下方 3D 图按此顺序同步重绘。</span>
              </div>
              <ol class="compare-order-list" id="compareOrderList">
                ${records.map((record, index) => `
                  <li class="compare-order-item" data-compare-order-id="${escapeMarkup(record.id)}" draggable="true">
                    <button class="compare-drag-handle" type="button" data-compare-drag-handle title="拖动排序">⠿</button>
                    <i class="compare-order-dot" data-compare-color style="background:${colorForPosition(index)}"></i>
                    <span class="compare-order-copy">
                      <strong data-compare-position>Z${index + 1}</strong>
                      <span>${escapeMarkup(record.grinder.brand)} ${escapeMarkup(record.grinder.model)} · 刻度 ${escapeMarkup(record.grinder.setting)} · ${escapeMarkup(recordDate(record.createdAt))}</span>
                    </span>
                    <span class="compare-order-actions">
                      <button class="compare-order-step" type="button" data-compare-step="-1" aria-label="上移">↑</button>
                      <button class="compare-order-step" type="button" data-compare-step="1" aria-label="下移">↓</button>
                    </span>
                  </li>`).join("")}
              </ol>
            </div>`;
          const list = document.getElementById("compareOrderList");
          if (list) {
            refreshListPositions(list);
            bindSorting(list);
          }
        }
      }
      drawMultiRecord3D(document.getElementById("canvasCmpMulti3d"), records, "pct", document.getElementById("multiCompareNote"));
    };

    if (typeof state !== "undefined" && state.selectedHistoryIds?.size > 1 && state.activeTab === "array3d") {
      renderMultiCompare();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(install, 0), { once: true });
  } else {
    setTimeout(install, 0);
  }
})(typeof window !== "undefined" ? window : null);

(function installInteractiveMultiRecord3D(root) {
  "use strict";

  const DEFAULT_VIEW = Object.freeze({ yaw: 34, pitch: 30, scale: 1, panX: 0, panY: 0 });
  const VIEW_LIMITS = Object.freeze({
    yawMin: -75,
    yawMax: 75,
    pitchMin: 10,
    pitchMax: 70,
    scaleMin: 0.65,
    scaleMax: 2.5,
    panMin: -800,
    panMax: 800
  });

  function clamp(value, minimum, maximum) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return minimum;
    return Math.min(maximum, Math.max(minimum, numeric));
  }

  function normalizeView(input = {}) {
    return {
      yaw: clamp(input.yaw ?? DEFAULT_VIEW.yaw, VIEW_LIMITS.yawMin, VIEW_LIMITS.yawMax),
      pitch: clamp(input.pitch ?? DEFAULT_VIEW.pitch, VIEW_LIMITS.pitchMin, VIEW_LIMITS.pitchMax),
      scale: clamp(input.scale ?? DEFAULT_VIEW.scale, VIEW_LIMITS.scaleMin, VIEW_LIMITS.scaleMax),
      panX: clamp(input.panX ?? DEFAULT_VIEW.panX, VIEW_LIMITS.panMin, VIEW_LIMITS.panMax),
      panY: clamp(input.panY ?? DEFAULT_VIEW.panY, VIEW_LIMITS.panMin, VIEW_LIMITS.panMax)
    };
  }

  function depthVector(viewInput, rowCount, depthTotal) {
    const view = normalizeView(viewInput);
    const step = Math.max(0, Number(depthTotal) || 0) / Math.max(1, Number(rowCount) || 1);
    const yawRadians = view.yaw * Math.PI / 180;
    const pitchRadians = view.pitch * Math.PI / 180;
    return {
      x: step * Math.sin(yawRadians),
      y: step * Math.sin(pitchRadians),
      step
    };
  }

  function pinchView(startViewInput, startGesture = {}, currentGesture = {}) {
    const startView = normalizeView(startViewInput);
    const startDistance = Math.max(1, Number(startGesture.distance) || 1);
    const currentDistance = Math.max(1, Number(currentGesture.distance) || startDistance);
    const startAngle = Number(startGesture.angle) || 0;
    const currentAngle = Number(currentGesture.angle) || startAngle;
    return normalizeView({
      yaw: startView.yaw + (currentAngle - startAngle) * 180 / Math.PI,
      pitch: startView.pitch,
      scale: startView.scale * currentDistance / startDistance,
      panX: startView.panX + (Number(currentGesture.centerX) || 0) - (Number(startGesture.centerX) || 0),
      panY: startView.panY + (Number(currentGesture.centerY) || 0) - (Number(startGesture.centerY) || 0)
    });
  }

  const api = Object.freeze({
    version: "1.4.1",
    DEFAULT_VIEW,
    VIEW_LIMITS,
    clamp,
    normalizeView,
    depthVector,
    pinchView
  });
  root.GrindPSDInteractive3D = api;

  if (typeof document === "undefined") return;

  const canvasStates = new WeakMap();
  let installed = false;

  function injectStyles() {
    if (document.getElementById("interactive3dStyles")) return;
    const style = document.createElement("style");
    style.id = "interactive3dStyles";
    style.textContent = `
      .interactive-3d-toolbar{display:grid;grid-template-columns:repeat(3,minmax(120px,1fr)) auto;align-items:end;gap:10px;margin:0 0 10px;padding:10px;border:1px solid #3a2f26;border-radius:11px;background:#15110e}
      .interactive-3d-toolbar[hidden]{display:none}
      .interactive-3d-control{display:grid;gap:5px;min-width:0}
      .interactive-3d-control span{display:flex;justify-content:space-between;gap:8px;color:#b9aa96;font-size:11px}
      .interactive-3d-control output{color:#efe6da;font-variant-numeric:tabular-nums}
      .interactive-3d-control input[type=range]{width:100%;margin:0;accent-color:#d98e32}
      .interactive-3d-reset{height:34px;white-space:nowrap}
      #canvasCmpMulti3d{cursor:grab;touch-action:none;overscroll-behavior:contain;outline:none}
      #canvasCmpMulti3d.is-manipulating{cursor:grabbing}
      #canvasCmpMulti3d:focus-visible{box-shadow:0 0 0 2px rgba(217,142,50,.65)}
      .interactive-3d-hint{grid-column:1/-1;color:#8f806e;font-size:11px;line-height:1.5}
      @media(max-width:700px){
        .interactive-3d-toolbar{grid-template-columns:1fr 1fr}
        .interactive-3d-control.zoom{grid-column:1/-1}
        .interactive-3d-reset{width:100%}
      }
    `;
    document.head.appendChild(style);
  }

  function stateFor(canvas) {
    let value = canvasStates.get(canvas);
    if (value) return value;
    value = {
      view: normalizeView(DEFAULT_VIEW),
      records: [],
      unit: "pct",
      noteElement: null,
      pointers: new Map(),
      gesture: null,
      mouseMode: "rotate",
      redrawFrame: 0,
      bound: false,
      toolbar: null
    };
    canvasStates.set(canvas, value);
    return value;
  }

  function gestureSnapshot(points) {
    const list = [...points.values()].slice(0, 2);
    if (list.length < 2) return null;
    const [a, b] = list;
    return {
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      centerX: (a.x + b.x) / 2,
      centerY: (a.y + b.y) / 2,
      angle: Math.atan2(b.y - a.y, b.x - a.x)
    };
  }

  function updateToolbar(canvas) {
    const state = stateFor(canvas);
    const toolbar = state.toolbar;
    if (!toolbar) return;
    const view = state.view;
    const yaw = toolbar.querySelector('[data-view="yaw"]');
    const pitch = toolbar.querySelector('[data-view="pitch"]');
    const scale = toolbar.querySelector('[data-view="scale"]');
    const yawOutput = toolbar.querySelector('[data-output="yaw"]');
    const pitchOutput = toolbar.querySelector('[data-output="pitch"]');
    const scaleOutput = toolbar.querySelector('[data-output="scale"]');
    if (yaw) yaw.value = String(Math.round(view.yaw));
    if (pitch) pitch.value = String(Math.round(view.pitch));
    if (scale) scale.value = String(Math.round(view.scale * 100));
    if (yawOutput) yawOutput.textContent = `${Math.round(view.yaw)}°`;
    if (pitchOutput) pitchOutput.textContent = `${Math.round(view.pitch)}°`;
    if (scaleOutput) scaleOutput.textContent = `${Math.round(view.scale * 100)}%`;
  }

  function ensureToolbar(canvas) {
    const state = stateFor(canvas);
    if (state.toolbar?.isConnected) return state.toolbar;
    const scroll = canvas.closest(".canvas-scroll");
    if (!scroll?.parentElement) return null;
    let toolbar = document.getElementById("interactive3dToolbar");
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.id = "interactive3dToolbar";
      toolbar.className = "interactive-3d-toolbar";
      toolbar.innerHTML = `
        <label class="interactive-3d-control">
          <span>水平旋转 <output data-output="yaw">34°</output></span>
          <input data-view="yaw" type="range" min="-75" max="75" step="1" value="34" aria-label="3D 图水平旋转角度">
        </label>
        <label class="interactive-3d-control">
          <span>俯视角 <output data-output="pitch">30°</output></span>
          <input data-view="pitch" type="range" min="10" max="70" step="1" value="30" aria-label="3D 图俯视角度">
        </label>
        <label class="interactive-3d-control zoom">
          <span>缩放 <output data-output="scale">100%</output></span>
          <input data-view="scale" type="range" min="65" max="250" step="1" value="100" aria-label="3D 图缩放倍率">
        </label>
        <button class="ghost small interactive-3d-reset" type="button" data-view-reset>复位视角</button>
        <div class="interactive-3d-hint">单指或鼠标拖动旋转；双指捏合缩放、双指同向移动平移、双指扭转改变水平角度。桌面端可用滚轮缩放，按 Shift 拖动平移。</div>`;
      scroll.parentElement.insertBefore(toolbar, scroll);
    }
    state.toolbar = toolbar;
    toolbar.querySelectorAll("[data-view]").forEach((input) => {
      if (input.dataset.bound === "true") return;
      input.dataset.bound = "true";
      input.addEventListener("input", () => {
        const current = stateFor(canvas);
        const key = input.dataset.view;
        const raw = Number(input.value);
        current.view = normalizeView({
          ...current.view,
          [key]: key === "scale" ? raw / 100 : raw
        });
        updateToolbar(canvas);
        requestRedraw(canvas);
      });
    });
    const reset = toolbar.querySelector("[data-view-reset]");
    if (reset && reset.dataset.bound !== "true") {
      reset.dataset.bound = "true";
      reset.addEventListener("click", () => {
        const current = stateFor(canvas);
        current.view = normalizeView(DEFAULT_VIEW);
        updateToolbar(canvas);
        requestRedraw(canvas);
      });
    }
    updateToolbar(canvas);
    return toolbar;
  }

  function requestRedraw(canvas) {
    const state = stateFor(canvas);
    if (state.redrawFrame) return;
    state.redrawFrame = requestAnimationFrame(() => {
      state.redrawFrame = 0;
      interactiveDrawMultiRecord3D(canvas, state.records, state.unit, state.noteElement);
    });
  }

  function setView(canvas, patch) {
    const state = stateFor(canvas);
    state.view = normalizeView({ ...state.view, ...patch });
    updateToolbar(canvas);
    requestRedraw(canvas);
  }

  function bindCanvas(canvas) {
    const state = stateFor(canvas);
    if (state.bound) return;
    state.bound = true;
    canvas.tabIndex = 0;

    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    canvas.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture?.(event.pointerId);
      state.pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY
      });
      state.mouseMode = event.shiftKey ? "pan" : "rotate";
      if (state.pointers.size >= 2) {
        state.gesture = {
          startView: { ...state.view },
          start: gestureSnapshot(state.pointers)
        };
      } else {
        state.gesture = null;
      }
      canvas.classList.add("is-manipulating");
      event.preventDefault();
    });

    canvas.addEventListener("pointermove", (event) => {
      const point = state.pointers.get(event.pointerId);
      if (!point) return;
      const previousX = point.x;
      const previousY = point.y;
      point.lastX = previousX;
      point.lastY = previousY;
      point.x = event.clientX;
      point.y = event.clientY;

      if (state.pointers.size >= 2) {
        if (!state.gesture?.start) {
          state.gesture = { startView: { ...state.view }, start: gestureSnapshot(state.pointers) };
        }
        const current = gestureSnapshot(state.pointers);
        if (current && state.gesture.start) {
          state.view = pinchView(state.gesture.startView, state.gesture.start, current);
        }
      } else {
        const dx = point.x - previousX;
        const dy = point.y - previousY;
        if (state.mouseMode === "pan") {
          state.view = normalizeView({
            ...state.view,
            panX: state.view.panX + dx,
            panY: state.view.panY + dy
          });
        } else {
          state.view = normalizeView({
            ...state.view,
            yaw: state.view.yaw + dx * 0.32,
            pitch: state.view.pitch - dy * 0.24
          });
        }
      }
      updateToolbar(canvas);
      requestRedraw(canvas);
      event.preventDefault();
    }, { passive: false });

    function finishPointer(event) {
      if (!state.pointers.has(event.pointerId)) return;
      state.pointers.delete(event.pointerId);
      canvas.releasePointerCapture?.(event.pointerId);
      if (state.pointers.size === 1) {
        const remaining = [...state.pointers.values()][0];
        remaining.lastX = remaining.x;
        remaining.lastY = remaining.y;
        state.gesture = null;
      } else if (state.pointers.size === 0) {
        state.gesture = null;
        canvas.classList.remove("is-manipulating");
      }
      event.preventDefault();
    }

    canvas.addEventListener("pointerup", finishPointer);
    canvas.addEventListener("pointercancel", finishPointer);
    canvas.addEventListener("lostpointercapture", (event) => {
      state.pointers.delete(event.pointerId);
      if (!state.pointers.size) canvas.classList.remove("is-manipulating");
    });

    canvas.addEventListener("wheel", (event) => {
      const factor = Math.exp(-event.deltaY * 0.0014);
      setView(canvas, { scale: state.view.scale * factor });
      event.preventDefault();
    }, { passive: false });

    canvas.addEventListener("keydown", (event) => {
      const key = event.key;
      if (key === "ArrowLeft") setView(canvas, { yaw: state.view.yaw - 4 });
      else if (key === "ArrowRight") setView(canvas, { yaw: state.view.yaw + 4 });
      else if (key === "ArrowUp") setView(canvas, { pitch: state.view.pitch + 4 });
      else if (key === "ArrowDown") setView(canvas, { pitch: state.view.pitch - 4 });
      else if (["+", "="].includes(key)) setView(canvas, { scale: state.view.scale * 1.1 });
      else if (["-", "_"].includes(key)) setView(canvas, { scale: state.view.scale / 1.1 });
      else if (["0", "Home"].includes(key)) {
        state.view = normalizeView(DEFAULT_VIEW);
        updateToolbar(canvas);
        requestRedraw(canvas);
      } else return;
      event.preventDefault();
    });
  }

  function drawPrism(ctx, x, baseY, width, height, faceX, faceY, color) {
    const topY = baseY - height;
    const depthY = -faceY;
    ctx.fillStyle = shadeColor(color, 1.12);
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x + faceX, topY + depthY);
    ctx.lineTo(x + width + faceX, topY + depthY);
    ctx.lineTo(x + width, topY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = shadeColor(color, 0.68);
    ctx.beginPath();
    if (faceX >= 0) {
      ctx.moveTo(x + width, topY);
      ctx.lineTo(x + width + faceX, topY + depthY);
      ctx.lineTo(x + width + faceX, baseY + depthY);
      ctx.lineTo(x + width, baseY);
    } else {
      ctx.moveTo(x, topY);
      ctx.lineTo(x + faceX, topY + depthY);
      ctx.lineTo(x + faceX, baseY + depthY);
      ctx.lineTo(x, baseY);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = color;
    ctx.fillRect(x, topY, width, height);
  }

  function interactiveDrawMultiRecord3D(canvas, records, unit = "pct", noteElement = null) {
    if (!canvas) return;
    const state = stateFor(canvas);
    state.records = (records || []).slice(0, MAX_COMPARE_RECORDS);
    state.unit = unit;
    state.noteElement = noteElement;
    bindCanvas(canvas);
    const toolbar = ensureToolbar(canvas);
    if (toolbar) toolbar.hidden = state.records.length < 2;

    const { ctx, width, height } = setupCanvas(canvas);
    const rows = state.records;
    if (rows.length < 2) {
      drawEmptyCanvas(ctx, width, height, "请在历史记录中选择 2–10 条测次");
      if (noteElement) noteElement.textContent = "筛选记录后勾选需要对比的测次，再点击“对比所选”。";
      return;
    }

    const aligned = GrindPSDPolicyCore.alignPercentageDistributions(rows, Core.getRecordSieves);
    const bins = aligned.bins;
    const series = aligned.series;
    const maxValue = Math.max(...series.flatMap((item) => item.values), 1) * 1.12;
    const compact = width < 520;
    const view = state.view;
    const pad = { left: compact ? 42 : 60, right: compact ? 46 : 76, top: 28, bottom: compact ? 52 : 66 };
    const depthTotal = Math.min(width * 0.28, height * 0.34);
    const depth = depthVector(view, series.length, depthTotal);
    const depthSpanX = Math.abs(depth.x) * Math.max(0, series.length - 1);
    const depthSpanY = Math.abs(depth.y) * Math.max(0, series.length - 1);
    const plotW = Math.max(80, width - pad.left - pad.right - depthSpanX);
    const plotH = Math.max(70, height - pad.top - pad.bottom - depthSpanY);
    const startX = pad.left + (depth.x < 0 ? depthSpanX : 0);
    const baseY = height - pad.bottom;
    const cellW = plotW / Math.max(1, bins.length);
    const barW = Math.max(3, Math.min(42, cellW * 0.48));
    const scaleY = plotH / maxValue;
    const centerX = width / 2;
    const centerY = height / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(centerX + view.panX, centerY + view.panY);
    ctx.scale(view.scale, view.scale);
    ctx.translate(-centerX, -centerY);

    ctx.strokeStyle = "#3a2f26";
    ctx.fillStyle = "#a89880";
    ctx.font = `${compact ? 8 : 10}px sans-serif`;
    ctx.textAlign = "right";
    for (let tick = 0; tick <= 4; tick += 1) {
      const value = maxValue * tick / 4;
      const y = baseY - value * scaleY;
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(startX + plotW, y);
      ctx.stroke();
      ctx.fillText(`${formatPlainNumber(value, 0)}%`, startX - 6, y + 3);
    }

    for (let rowIndex = series.length - 1; rowIndex >= 0; rowIndex -= 1) {
      const values = series[rowIndex].values;
      const offsetX = rowIndex * depth.x;
      const offsetY = rowIndex * depth.y;
      const color = paletteForIndex(rowIndex);
      values.forEach((value, index) => {
        if (value <= 0) return;
        const barH = value * scaleY;
        const x = startX + cellW * (index + 0.5) - barW / 2 + offsetX;
        const y = baseY - offsetY;
        const faceX = depth.x * 0.42;
        const faceY = depth.y * 0.42;
        drawPrism(ctx, x, y, barW, barH, faceX, faceY, color);
      });
      ctx.fillStyle = "#efe6da";
      ctx.font = `${compact ? 7 : 9}px sans-serif`;
      ctx.textAlign = depth.x >= 0 ? "left" : "right";
      const labelX = depth.x >= 0 ? startX + plotW + offsetX + 5 : startX + offsetX - 5;
      ctx.fillText(`Z${rowIndex + 1}`, labelX, baseY - offsetY + 2);
    }

    ctx.fillStyle = "#a89880";
    ctx.font = `${compact ? 7 : 9}px sans-serif`;
    ctx.textAlign = "center";
    bins.forEach((bin, index) => {
      const label = bin.shortLabel.length > 10 ? `${bin.shortLabel.slice(0, 9)}…` : bin.shortLabel;
      ctx.fillText(label, startX + cellW * (index + 0.5), baseY + 18);
    });
    ctx.restore();

    if (noteElement) {
      noteElement.textContent = `${series.length} 条测次按实际粒径区间对齐并换算为百分比，缺失区间按 0% 补全。单指旋转，双指缩放/平移/扭转；当前水平角 ${Math.round(view.yaw)}°、俯视角 ${Math.round(view.pitch)}°、缩放 ${Math.round(view.scale * 100)}%。`;
    }
  }

  function install() {
    if (installed) return;
    if (typeof drawMultiRecord3D !== "function" || typeof setupCanvas !== "function") {
      setTimeout(install, 30);
      return;
    }
    installed = true;
    injectStyles();
    drawMultiRecord3D = interactiveDrawMultiRecord3D;
    const canvas = document.getElementById("canvasCmpMulti3d");
    if (canvas) {
      bindCanvas(canvas);
      ensureToolbar(canvas);
    }
    if (typeof state !== "undefined" && state.selectedHistoryIds?.size > 1 && state.activeTab === "array3d") {
      renderMultiCompare();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(install, 20), { once: true });
  } else {
    setTimeout(install, 20);
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
