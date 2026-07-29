"use strict";

const REPO = "zjcrop/Grind-PSD";
const STANDARD_ID = "grind-psd-sieve-v1";
const STORE_KEY = "grindPsdAppV2";
const DATABASE_PATH = "data/database.json";

const SIEVE_BINS = [
  {
    id: "mesh18_retained_g",
    label: "18 目筛上",
    range: ">=1000 μm",
    lowerUm: 1000,
    upperUm: 1400,
    color: "#5470c6"
  },
  {
    id: "mesh24_retained_g",
    label: "24 目筛上",
    range: "800-1000 μm",
    lowerUm: 800,
    upperUm: 1000,
    color: "#1f8a70"
  },
  {
    id: "mesh35_retained_g",
    label: "35 目筛上",
    range: "500-800 μm",
    lowerUm: 500,
    upperUm: 800,
    color: "#62a87c"
  },
  {
    id: "mesh60_retained_g",
    label: "60 目筛上",
    range: "300-500 μm",
    lowerUm: 300,
    upperUm: 500,
    color: "#f2b84b"
  },
  {
    id: "pan80_lt300_g",
    label: "80 目底盘极细粉",
    range: "<300 μm",
    lowerUm: 80,
    upperUm: 300,
    color: "#d95f59"
  }
];

const state = {
  store: loadStore(),
  selectedRecordId: null,
  communityRecords: [],
  selectedCommunityIds: new Set(),
  standard: null
};

const dom = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheDom();
  bindEvents();
  buildWeightInputs();
  renderStandardTable();
  hydrateSettingsFields();
  selectInitialRecord();
  renderAll();
  downloadCommunity({ silent: true });
}

function cacheDom() {
  [
    "new-record-btn",
    "sync-btn",
    "settings-btn",
    "submit-selected-btn",
    "export-record-btn",
    "distribution-chart",
    "chart-unit",
    "metric-grid",
    "record-summary",
    "local-search",
    "local-user-filter",
    "local-table",
    "export-all-btn",
    "import-btn",
    "import-file",
    "download-community-btn",
    "import-community-selected-btn",
    "community-search",
    "community-user-filter",
    "community-status",
    "community-table",
    "compare-unit",
    "compare-a",
    "compare-b",
    "compare-chart",
    "compare-metrics",
    "standard-table",
    "load-standard-btn",
    "record-dialog",
    "record-user-id",
    "record-user-name",
    "record-brand",
    "record-model",
    "record-setting",
    "record-dose",
    "record-bean",
    "record-method",
    "record-notes",
    "brand-list",
    "model-list",
    "weight-inputs",
    "weight-total",
    "same-grinder-btn",
    "save-record-btn",
    "settings-dialog",
    "settings-user-id",
    "settings-user-name",
    "save-settings-btn",
    "submit-dialog",
    "submit-json",
    "copy-submit-json-btn",
    "open-issue-btn",
    "toast"
  ].forEach((id) => {
    dom[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  dom["new-record-btn"].addEventListener("click", openRecordDialog);
  dom["settings-btn"].addEventListener("click", openSettingsDialog);
  dom["sync-btn"].addEventListener("click", () => downloadCommunity({ silent: false }));
  dom["download-community-btn"].addEventListener("click", () => downloadCommunity({ silent: false }));
  dom["import-community-selected-btn"].addEventListener("click", importSelectedCommunityRecords);
  dom["submit-selected-btn"].addEventListener("click", openSubmitDialog);
  dom["export-record-btn"].addEventListener("click", exportSelectedRecord);
  dom["export-all-btn"].addEventListener("click", exportLocalStore);
  dom["import-btn"].addEventListener("click", () => dom["import-file"].click());
  dom["import-file"].addEventListener("change", importFile);
  dom["chart-unit"].addEventListener("change", renderDashboard);
  dom["compare-unit"].addEventListener("change", renderCompare);
  dom["compare-a"].addEventListener("change", renderCompare);
  dom["compare-b"].addEventListener("change", renderCompare);
  dom["local-search"].addEventListener("input", renderLocalTable);
  dom["local-user-filter"].addEventListener("change", renderLocalTable);
  dom["community-search"].addEventListener("input", renderCommunityTable);
  dom["community-user-filter"].addEventListener("change", renderCommunityTable);
  dom["save-record-btn"].addEventListener("click", saveRecordFromDialog);
  dom["same-grinder-btn"].addEventListener("click", fillLastGrinder);
  dom["save-settings-btn"].addEventListener("click", saveSettings);
  dom["copy-submit-json-btn"].addEventListener("click", copySubmitJson);
  dom["open-issue-btn"].addEventListener("click", openIssueForSubmit);
  dom["load-standard-btn"].addEventListener("click", loadStandardJson);

  window.addEventListener("resize", debounce(() => {
    renderDashboardChart();
    renderCompare();
  }, 120));
}

function defaultStore() {
  const generatedUserId = `local-${Math.random().toString(36).slice(2, 8)}`;
  return {
    schemaVersion: "2.0.0",
    user: {
      id: generatedUserId,
      name: "本地用户"
    },
    records: [],
    lastGrinder: null
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultStore();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.records)) return defaultStore();
    return {
      ...defaultStore(),
      ...parsed,
      user: {
        ...defaultStore().user,
        ...(parsed.user || {})
      }
    };
  } catch (error) {
    return defaultStore();
  }
}

function saveStore() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state.store));
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `tab-${name}`);
  });
  if (name === "local") renderLocalTable();
  if (name === "community") renderCommunityTable();
  if (name === "compare") renderCompare();
  if (name === "dashboard") renderDashboard();
}

function buildWeightInputs() {
  dom["weight-inputs"].innerHTML = SIEVE_BINS.map((bin) => `
    <div class="weight-row">
      <div class="weight-name">
        <strong>${escapeHtml(bin.label)}</strong>
        <span>${escapeHtml(bin.range)} · 字段 ${escapeHtml(bin.id)}</span>
      </div>
      <input type="number" min="0" step="0.01" inputmode="decimal" data-bin="${escapeHtml(bin.id)}" placeholder="0.00">
    </div>
  `).join("");

  dom["weight-inputs"].querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", updateWeightTotal);
  });
}

function renderStandardTable() {
  dom["standard-table"].innerHTML = SIEVE_BINS.map((bin) => `
    <tr>
      <td><code>${escapeHtml(bin.id)}</code></td>
      <td>${escapeHtml(bin.label)}</td>
      <td>${escapeHtml(bin.range)}</td>
      <td>筛上重量，单位 g</td>
    </tr>
  `).join("");
}

function hydrateSettingsFields() {
  dom["settings-user-id"].value = state.store.user.id || "";
  dom["settings-user-name"].value = state.store.user.name || "";
}

function openSettingsDialog() {
  hydrateSettingsFields();
  showDialog(dom["settings-dialog"]);
}

function saveSettings(event) {
  event.preventDefault();
  const userId = normalizeUserId(dom["settings-user-id"].value);
  if (!userId) {
    toast("用户 ID 不能为空，只能使用字母、数字、下划线和连字符。", true);
    return;
  }
  state.store.user.id = userId;
  state.store.user.name = dom["settings-user-name"].value.trim() || userId;
  saveStore();
  dom["settings-dialog"].close();
  renderAll();
  toast("用户设置已保存。");
}

function openRecordDialog() {
  fillRecordDefaults();
  showDialog(dom["record-dialog"]);
}

function fillRecordDefaults() {
  dom["record-user-id"].value = state.store.user.id || "";
  dom["record-user-name"].value = state.store.user.name || "";
  dom["record-brand"].value = "";
  dom["record-model"].value = "";
  dom["record-setting"].value = "";
  dom["record-dose"].value = "";
  dom["record-bean"].value = "";
  dom["record-method"].value = "手动摇筛 60 秒";
  dom["record-notes"].value = "";
  dom["weight-inputs"].querySelectorAll("input").forEach((input) => {
    input.value = "";
  });
  updateWeightTotal();
  refreshDatalists();
  if (state.store.lastGrinder) fillLastGrinder();
}

function fillLastGrinder(event) {
  if (event) event.preventDefault();
  const last = state.store.lastGrinder;
  if (!last) {
    toast("还没有上次磨豆机记录。", true);
    return;
  }
  dom["record-brand"].value = last.brand || "";
  dom["record-model"].value = last.model || "";
  dom["record-setting"].value = last.setting || "";
}

function refreshDatalists() {
  const brands = unique(state.store.records.map((record) => record.grinder.brand).filter(Boolean));
  const models = unique(state.store.records.map((record) => record.grinder.model).filter(Boolean));
  dom["brand-list"].innerHTML = brands.map((brand) => `<option value="${escapeHtml(brand)}"></option>`).join("");
  dom["model-list"].innerHTML = models.map((model) => `<option value="${escapeHtml(model)}"></option>`).join("");
}

function updateWeightTotal() {
  const weights = readWeightInputs();
  const total = sum(Object.values(weights));
  dom["weight-total"].textContent = `${formatNumber(total, 2)} g`;
}

function readWeightInputs() {
  const weights = {};
  dom["weight-inputs"].querySelectorAll("input").forEach((input) => {
    weights[input.dataset.bin] = toNumber(input.value);
  });
  return weights;
}

function saveRecordFromDialog(event) {
  event.preventDefault();
  const userId = normalizeUserId(dom["record-user-id"].value);
  const userName = dom["record-user-name"].value.trim() || userId;
  const brand = dom["record-brand"].value.trim();
  const model = dom["record-model"].value.trim();
  const setting = dom["record-setting"].value.trim();
  const weightsGrams = readWeightInputs();
  const totalG = round(sum(Object.values(weightsGrams)), 2);
  const doseG = toNumber(dom["record-dose"].value);

  if (!userId) {
    toast("用户 ID 不能为空，只能使用字母、数字、下划线和连字符。", true);
    return;
  }
  if (!brand || !model || !setting) {
    toast("品牌、型号和研磨刻度必须填写。", true);
    return;
  }
  if (totalG <= 0) {
    toast("筛层重量合计必须大于 0。", true);
    return;
  }
  if (doseG > 0 && Math.abs(doseG - totalG) / doseG > 0.08) {
    const proceed = window.confirm("筛分总重与投粉量偏差超过 8%。这通常意味着损耗、静电或称量录入问题。仍然保存吗？");
    if (!proceed) return;
  }

  state.store.user = { id: userId, name: userName };
  const record = makeRecord({
    userId,
    userName,
    brand,
    model,
    setting,
    doseG,
    bean: dom["record-bean"].value.trim(),
    method: dom["record-method"].value.trim(),
    notes: dom["record-notes"].value.trim(),
    weightsGrams,
    source: "local"
  });

  state.store.records.unshift(record);
  state.store.lastGrinder = { brand, model, setting };
  state.selectedRecordId = record.id;
  saveStore();
  dom["record-dialog"].close();
  renderAll();
  switchTab("dashboard");
  toast("记录已保存。");
}

function makeRecord(input) {
  const totalG = round(sum(Object.values(input.weightsGrams)), 2);
  const percentages = {};
  SIEVE_BINS.forEach((bin) => {
    percentages[bin.id.replace("_g", "_pct")] = totalG ? round((input.weightsGrams[bin.id] || 0) / totalG * 100, 2) : 0;
  });
  const metrics = calculateMetrics(input.weightsGrams, totalG);
  const now = new Date().toISOString();
  const recordBase = {
    schemaVersion: "2.0.0",
    standardId: STANDARD_ID,
    id: "",
    user: {
      id: input.userId,
      name: input.userName
    },
    grinder: {
      brand: input.brand,
      model: input.model,
      setting: input.setting
    },
    sample: {
      doseG: round(input.doseG || totalG, 2),
      bean: input.bean || "",
      method: input.method || "手动摇筛 60 秒"
    },
    weightsGrams: normalizeWeights(input.weightsGrams),
    totalG,
    percentages,
    metrics,
    notes: input.notes || "",
    createdAt: now,
    updatedAt: now,
    source: input.source || "local"
  };
  recordBase.id = buildRecordId(recordBase);
  return recordBase;
}

function buildRecordId(record) {
  const stable = [
    record.standardId,
    record.user.id,
    record.grinder.brand,
    record.grinder.model,
    record.grinder.setting,
    record.createdAt,
    JSON.stringify(record.weightsGrams)
  ].join("|");
  return `gpsd-${hashString(stable)}`;
}

function normalizeWeights(weights) {
  const normalized = {};
  SIEVE_BINS.forEach((bin) => {
    normalized[bin.id] = round(toNumber(weights[bin.id]), 2);
  });
  return normalized;
}

function calculateMetrics(weights, totalG) {
  if (!totalG) {
    return {
      coarsePct: 0,
      finesPct: 0,
      d10UmApprox: null,
      d50UmApprox: null,
      d90UmApprox: null,
      spanApprox: null,
      modeBin: ""
    };
  }

  const coarsePct = round((weights.mesh18_retained_g || 0) / totalG * 100, 2);
  const finesPct = round((weights.pan80_lt300_g || 0) / totalG * 100, 2);
  const d10 = percentileSize(weights, totalG, 10);
  const d50 = percentileSize(weights, totalG, 50);
  const d90 = percentileSize(weights, totalG, 90);
  const span = d50 ? round((d90 - d10) / d50, 2) : null;
  const mode = SIEVE_BINS.reduce((best, bin) => {
    const value = weights[bin.id] || 0;
    return value > best.value ? { id: bin.id, label: bin.label, value } : best;
  }, { id: "", label: "", value: -1 });

  return {
    coarsePct,
    finesPct,
    d10UmApprox: d10,
    d50UmApprox: d50,
    d90UmApprox: d90,
    spanApprox: span,
    modeBin: mode.label
  };
}

function percentileSize(weights, totalG, percentile) {
  const fineToCoarse = [...SIEVE_BINS].reverse();
  let cumulative = 0;
  const target = percentile / 100 * totalG;
  for (const bin of fineToCoarse) {
    const w = weights[bin.id] || 0;
    const previous = cumulative;
    cumulative += w;
    if (target <= cumulative || bin === fineToCoarse[fineToCoarse.length - 1]) {
      if (w <= 0) return Math.round((bin.lowerUm + bin.upperUm) / 2);
      const ratio = Math.max(0, Math.min(1, (target - previous) / w));
      const size = bin.lowerUm + (bin.upperUm - bin.lowerUm) * ratio;
      return Math.round(size);
    }
  }
  return null;
}

function selectInitialRecord() {
  if (!state.selectedRecordId && state.store.records.length) {
    state.selectedRecordId = state.store.records[0].id;
  }
}

function renderAll() {
  renderDashboard();
  renderFilters();
  renderLocalTable();
  renderCommunityTable();
  renderCompareOptions();
  renderCompare();
}

function renderDashboard() {
  const record = getSelectedRecord();
  if (!record) {
    dom["record-summary"].className = "empty";
    dom["record-summary"].textContent = "暂无记录。点击右上角“新建记录”开始录入。";
    dom["metric-grid"].innerHTML = "";
    clearCanvas(dom["distribution-chart"], "暂无图表数据");
    return;
  }

  dom["record-summary"].className = "";
  dom["record-summary"].innerHTML = `
    <div class="record-meta">
      <span class="badge"><span class="dot"></span>${escapeHtml(record.grinder.brand)} ${escapeHtml(record.grinder.model)}</span>
      <span class="badge">刻度 ${escapeHtml(record.grinder.setting)}</span>
      <span class="badge">用户 ${escapeHtml(record.user.id)}</span>
      <span class="badge">总重 ${formatNumber(record.totalG, 2)} g</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>筛层</th>
          <th>区间</th>
          <th class="num">重量 g</th>
          <th class="num">占比</th>
        </tr>
      </thead>
      <tbody>
        ${SIEVE_BINS.map((bin) => `
          <tr>
            <td>${escapeHtml(bin.label)}</td>
            <td>${escapeHtml(bin.range)}</td>
            <td class="num">${formatNumber(record.weightsGrams[bin.id], 2)}</td>
            <td class="num">${formatNumber(percentFor(record, bin.id), 2)}%</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    ${record.notes ? `<p class="note">${escapeHtml(record.notes)}</p>` : ""}
  `;
  renderMetrics(record);
  renderDashboardChart();
}

function renderMetrics(record) {
  const metrics = [
    ["粗粉", `${formatNumber(record.metrics.coarsePct, 2)}%`],
    ["极细粉", `${formatNumber(record.metrics.finesPct, 2)}%`],
    ["D50 近似", nullableMetric(record.metrics.d50UmApprox, "μm")],
    ["跨度", nullableMetric(record.metrics.spanApprox, "")]
  ];
  dom["metric-grid"].innerHTML = metrics.map(([label, value]) => `
    <div class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("") + `
    <div class="metric">
      <span>D10 / D90 近似</span>
      <strong>${nullableMetric(record.metrics.d10UmApprox, "μm")} / ${nullableMetric(record.metrics.d90UmApprox, "μm")}</strong>
    </div>
    <div class="metric">
      <span>主峰筛层</span>
      <strong>${escapeHtml(record.metrics.modeBin || "-")}</strong>
    </div>
  `;
}

function renderDashboardChart() {
  const record = getSelectedRecord();
  if (!record) return;
  drawDistributionChart(dom["distribution-chart"], [record], dom["chart-unit"].value);
}

function renderFilters() {
  fillUserFilter(dom["local-user-filter"], state.store.records, "全部本地用户");
  fillUserFilter(dom["community-user-filter"], state.communityRecords, "全部社区用户");
}

function fillUserFilter(select, records, label) {
  const current = select.value;
  const users = unique(records.map((record) => record.user.id).filter(Boolean)).sort();
  select.innerHTML = `<option value="">${escapeHtml(label)}</option>` + users.map((user) => `<option value="${escapeHtml(user)}">${escapeHtml(user)}</option>`).join("");
  if (users.includes(current)) select.value = current;
}

function renderLocalTable() {
  renderRecordTable({
    container: dom["local-table"],
    records: filterRecords(state.store.records, dom["local-search"].value, dom["local-user-filter"].value),
    source: "local"
  });
}

function renderCommunityTable() {
  renderRecordTable({
    container: dom["community-table"],
    records: filterRecords(state.communityRecords, dom["community-search"].value, dom["community-user-filter"].value),
    source: "community"
  });
}

function renderRecordTable({ container, records, source }) {
  if (!records.length) {
    container.innerHTML = `<div class="empty">${source === "community" ? "暂无社区记录，或尚未同步。" : "暂无本地记录。"}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            ${source === "community" ? '<th class="select-cell">选择</th>' : ""}
            <th>用户</th>
            <th>磨豆机</th>
            <th>刻度</th>
            <th class="num">总重</th>
            <th class="num">极细粉</th>
            <th class="num">D50</th>
            <th>时间</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${records.map((record) => `
            <tr>
              ${source === "community" ? `
                <td><input type="checkbox" data-community-id="${escapeHtml(record.id)}" ${state.selectedCommunityIds.has(record.id) ? "checked" : ""}></td>
              ` : ""}
              <td>${escapeHtml(record.user.id)}</td>
              <td>${escapeHtml(record.grinder.brand)} ${escapeHtml(record.grinder.model)}</td>
              <td>${escapeHtml(record.grinder.setting)}</td>
              <td class="num">${formatNumber(record.totalG, 2)} g</td>
              <td class="num">${formatNumber(record.metrics.finesPct, 2)}%</td>
              <td class="num">${nullableMetric(record.metrics.d50UmApprox, "μm")}</td>
              <td>${formatDate(record.createdAt)}</td>
              <td>
                <div class="row-actions">
                  <button data-view-id="${escapeHtml(record.id)}" data-source="${source}">查看</button>
                  ${source === "local" ? `<button data-delete-id="${escapeHtml(record.id)}">删除</button>` : `<button data-import-id="${escapeHtml(record.id)}">导入</button>`}
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll("[data-view-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const record = findRecord(button.dataset.viewId, button.dataset.source);
      if (!record) return;
      if (button.dataset.source === "community") {
        const localCopy = cloneRecord(record, "community-preview");
        state.store.records = upsertRecord(state.store.records, localCopy);
        saveStore();
        state.selectedRecordId = localCopy.id;
      } else {
        state.selectedRecordId = record.id;
      }
      renderAll();
      switchTab("dashboard");
    });
  });

  container.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", () => deleteLocalRecord(button.dataset.deleteId));
  });

  container.querySelectorAll("[data-import-id]").forEach((button) => {
    button.addEventListener("click", () => importCommunityRecord(button.dataset.importId));
  });

  container.querySelectorAll("[data-community-id]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedCommunityIds.add(checkbox.dataset.communityId);
      else state.selectedCommunityIds.delete(checkbox.dataset.communityId);
    });
  });
}

function filterRecords(records, query, userId) {
  const q = (query || "").trim().toLowerCase();
  return records.filter((record) => {
    if (userId && record.user.id !== userId) return false;
    if (!q) return true;
    const haystack = [
      record.user.id,
      record.user.name,
      record.grinder.brand,
      record.grinder.model,
      record.grinder.setting,
      record.sample.bean,
      record.notes
    ].join(" ").toLowerCase();
    return haystack.includes(q);
  });
}

function deleteLocalRecord(id) {
  const record = state.store.records.find((item) => item.id === id);
  if (!record) return;
  const ok = window.confirm(`删除 ${record.grinder.brand} ${record.grinder.model} 刻度 ${record.grinder.setting}？`);
  if (!ok) return;
  state.store.records = state.store.records.filter((item) => item.id !== id);
  if (state.selectedRecordId === id) state.selectedRecordId = state.store.records[0]?.id || null;
  saveStore();
  renderAll();
  toast("记录已删除。");
}

function renderCompareOptions() {
  const records = getAllComparableRecords();
  const options = records.map((record) => `
    <option value="${escapeHtml(record.id)}">${escapeHtml(record.user.id)} · ${escapeHtml(record.grinder.brand)} ${escapeHtml(record.grinder.model)} · ${escapeHtml(record.grinder.setting)}</option>
  `).join("");
  const oldA = dom["compare-a"].value;
  const oldB = dom["compare-b"].value;
  dom["compare-a"].innerHTML = options;
  dom["compare-b"].innerHTML = options;
  if (records.some((record) => record.id === oldA)) dom["compare-a"].value = oldA;
  if (records.some((record) => record.id === oldB)) dom["compare-b"].value = oldB;
  if (!dom["compare-a"].value && records[0]) dom["compare-a"].value = records[0].id;
  if (!dom["compare-b"].value && records[1]) dom["compare-b"].value = records[1].id;
}

function renderCompare() {
  const a = findRecord(dom["compare-a"].value, "all");
  const b = findRecord(dom["compare-b"].value, "all");
  if (!a || !b) {
    clearCanvas(dom["compare-chart"], "至少需要两条记录才能对比。");
    dom["compare-metrics"].innerHTML = "";
    return;
  }
  drawDistributionChart(dom["compare-chart"], [a, b], dom["compare-unit"].value);
  dom["compare-metrics"].innerHTML = `
    <div class="delta-card">
      极细粉差值 B-A
      <strong>${formatSigned(b.metrics.finesPct - a.metrics.finesPct)} pct</strong>
    </div>
    <div class="delta-card">
      D50 差值 B-A
      <strong>${formatSigned((b.metrics.d50UmApprox || 0) - (a.metrics.d50UmApprox || 0))} μm</strong>
    </div>
    <div class="delta-card">
      粗粉差值 B-A
      <strong>${formatSigned(b.metrics.coarsePct - a.metrics.coarsePct)} pct</strong>
    </div>
    <div class="delta-card">
      跨度差值 B-A
      <strong>${formatSigned((b.metrics.spanApprox || 0) - (a.metrics.spanApprox || 0))}</strong>
    </div>
  `;
}

function getAllComparableRecords() {
  const byId = new Map();
  [...state.store.records, ...state.communityRecords].forEach((record) => {
    if (!byId.has(record.id)) byId.set(record.id, record);
  });
  return [...byId.values()];
}

async function downloadCommunity({ silent }) {
  try {
    const response = await fetch(`${DATABASE_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const db = await response.json();
    const records = Array.isArray(db.records) ? db.records : [];
    state.communityRecords = records.map(normalizeIncomingRecord).filter(Boolean);
    dom["community-status"].textContent = `已同步 ${state.communityRecords.length} 条社区记录。`;
    renderFilters();
    renderCommunityTable();
    renderCompareOptions();
    renderCompare();
    if (!silent) toast("社区数据库已同步。");
  } catch (error) {
    dom["community-status"].innerHTML = `<span class="warn">社区数据库读取失败：${escapeHtml(error.message)}。本地使用不受影响。</span>`;
    if (!silent) toast("社区数据库读取失败，本地功能仍可用。", true);
  }
}

function importCommunityRecord(id) {
  const record = state.communityRecords.find((item) => item.id === id);
  if (!record) return;
  state.store.records = upsertRecord(state.store.records, cloneRecord(record, "community-import"));
  saveStore();
  renderAll();
  toast("社区记录已导入本地。");
}

function importSelectedCommunityRecords() {
  const selected = state.communityRecords.filter((record) => state.selectedCommunityIds.has(record.id));
  if (!selected.length) {
    toast("请先选择要导入的社区记录。", true);
    return;
  }
  selected.forEach((record) => {
    state.store.records = upsertRecord(state.store.records, cloneRecord(record, "community-import"));
  });
  saveStore();
  renderAll();
  toast(`已导入 ${selected.length} 条社区记录。`);
}

function cloneRecord(record, source) {
  return {
    ...record,
    source,
    importedAt: new Date().toISOString()
  };
}

function openSubmitDialog() {
  const record = getSelectedRecord();
  if (!record) {
    toast("请先选择一条记录。", true);
    return;
  }
  const payload = prepareRecordForSubmit(record);
  dom["submit-json"].value = JSON.stringify(payload, null, 2);
  showDialog(dom["submit-dialog"]);
}

function prepareRecordForSubmit(record) {
  const clean = normalizeIncomingRecord(record);
  clean.source = "github-issue";
  clean.updatedAt = new Date().toISOString();
  return clean;
}

async function copySubmitJson(event) {
  event.preventDefault();
  await navigator.clipboard.writeText(dom["submit-json"].value);
  toast("JSON 已复制。");
}

function openIssueForSubmit(event) {
  event.preventDefault();
  const payload = dom["submit-json"].value;
  if (!payload) return;
  const record = JSON.parse(payload);
  const title = `[PSD] ${record.user.id} ${record.grinder.brand} ${record.grinder.model} ${record.grinder.setting}`;
  const body = [
    "BEGIN_GRIND_PSD_JSON",
    "```json",
    payload,
    "```",
    "END_GRIND_PSD_JSON",
    "",
    "提交说明：请不要修改 BEGIN/END 标记内的 JSON。仓库工作流会校验该记录并写入 data/database.json。"
  ].join("\n");
  const url = `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function exportSelectedRecord(event) {
  if (event) event.preventDefault();
  const record = getSelectedRecord();
  if (!record) {
    toast("没有可导出的记录。", true);
    return;
  }
  downloadJson(prepareRecordForSubmit(record), `${record.id}.json`);
}

function exportLocalStore(event) {
  if (event) event.preventDefault();
  downloadJson(state.store, `grind-psd-local-${new Date().toISOString().slice(0, 10)}.json`);
}

function importFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (Array.isArray(parsed.records)) {
        parsed.records.map(normalizeIncomingRecord).filter(Boolean).forEach((record) => {
          state.store.records = upsertRecord(state.store.records, cloneRecord(record, "import"));
        });
      } else {
        const record = normalizeIncomingRecord(parsed);
        if (!record) throw new Error("不符合 Grind-PSD 标准记录结构");
        state.store.records = upsertRecord(state.store.records, cloneRecord(record, "import"));
      }
      saveStore();
      selectInitialRecord();
      renderAll();
      toast("导入成功。");
    } catch (error) {
      toast(`导入失败：${error.message}`, true);
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

async function loadStandardJson() {
  try {
    const response = await fetch(`data/standard.json?t=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.standard = await response.json();
    toast(`已读取标准 ${state.standard.standardId || STANDARD_ID}。`);
  } catch (error) {
    toast(`读取标准失败：${error.message}`, true);
  }
}

function normalizeIncomingRecord(input) {
  if (!input || input.standardId !== STANDARD_ID || !input.user || !input.grinder || !input.weightsGrams) return null;
  const weights = normalizeWeights(input.weightsGrams);
  const totalG = round(sum(Object.values(weights)), 2);
  if (totalG <= 0) return null;
  const record = {
    schemaVersion: input.schemaVersion || "2.0.0",
    standardId: STANDARD_ID,
    id: input.id || "",
    user: {
      id: normalizeUserId(input.user.id),
      name: String(input.user.name || input.user.id || "").trim()
    },
    grinder: {
      brand: String(input.grinder.brand || "").trim(),
      model: String(input.grinder.model || "").trim(),
      setting: String(input.grinder.setting || "").trim()
    },
    sample: {
      doseG: round(toNumber(input.sample?.doseG || totalG), 2),
      bean: String(input.sample?.bean || "").trim(),
      method: String(input.sample?.method || "").trim() || "手动摇筛 60 秒"
    },
    weightsGrams: weights,
    totalG,
    percentages: {},
    metrics: calculateMetrics(weights, totalG),
    notes: String(input.notes || "").trim(),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || input.createdAt || new Date().toISOString(),
    source: input.source || "unknown"
  };
  if (!record.user.id || !record.grinder.brand || !record.grinder.model || !record.grinder.setting) return null;
  SIEVE_BINS.forEach((bin) => {
    record.percentages[bin.id.replace("_g", "_pct")] = round((record.weightsGrams[bin.id] || 0) / totalG * 100, 2);
  });
  record.id = input.id || buildRecordId(record);
  return record;
}

function getSelectedRecord() {
  if (!state.selectedRecordId) return null;
  return state.store.records.find((record) => record.id === state.selectedRecordId) ||
    state.communityRecords.find((record) => record.id === state.selectedRecordId) ||
    null;
}

function findRecord(id, source) {
  if (!id) return null;
  if (source === "local") return state.store.records.find((record) => record.id === id) || null;
  if (source === "community") return state.communityRecords.find((record) => record.id === id) || null;
  return getAllComparableRecords().find((record) => record.id === id) || null;
}

function upsertRecord(records, incoming) {
  const without = records.filter((record) => record.id !== incoming.id);
  return [incoming, ...without];
}

function drawDistributionChart(canvas, records, unit) {
  const ctx = setupCanvas(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  const pad = { left: 58, right: 22, top: 30, bottom: 56 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const values = records.map((record) => SIEVE_BINS.map((bin) => unit === "gram" ? record.weightsGrams[bin.id] : percentFor(record, bin.id)));
  const maxValue = Math.max(1, ...values.flat()) * 1.15;
  const groupW = plotW / SIEVE_BINS.length;
  const barW = Math.min(34, groupW / (records.length + 0.6));

  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, pad, plotW, plotH, maxValue, unit);

  SIEVE_BINS.forEach((bin, binIndex) => {
    records.forEach((record, recordIndex) => {
      const value = values[recordIndex][binIndex] || 0;
      const x = pad.left + groupW * binIndex + groupW / 2 - (barW * records.length) / 2 + barW * recordIndex;
      const barH = value / maxValue * plotH;
      const y = pad.top + plotH - barH;
      ctx.fillStyle = records.length === 1 ? bin.color : paletteForRecord(recordIndex);
      roundRect(ctx, x, y, barW * 0.82, barH, 4);
      ctx.fill();
    });

    ctx.fillStyle = "#5c6a62";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(bin.label.replace("筛上", ""), pad.left + groupW * binIndex + groupW / 2, pad.top + plotH + 20);
    ctx.font = "10px sans-serif";
    ctx.fillText(bin.range, pad.left + groupW * binIndex + groupW / 2, pad.top + plotH + 36);
  });

  if (records.length > 1) {
    drawLegend(ctx, records, pad.left, 16);
  }
}

function drawGrid(ctx, pad, plotW, plotH, maxValue, unit) {
  ctx.strokeStyle = "#d7ded8";
  ctx.fillStyle = "#5c6a62";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const value = maxValue * i / 4;
    const y = pad.top + plotH - plotH * i / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillText(unit === "gram" ? `${formatNumber(value, 1)}g` : `${formatNumber(value, 0)}%`, pad.left - 8, y + 4);
  }
}

function drawLegend(ctx, records, x, y) {
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";
  records.forEach((record, index) => {
    const label = `${record.grinder.brand} ${record.grinder.model} ${record.grinder.setting}`;
    const lx = x + index * 260;
    ctx.fillStyle = paletteForRecord(index);
    ctx.fillRect(lx, y, 12, 12);
    ctx.fillStyle = "#17201b";
    ctx.fillText(label.slice(0, 28), lx + 18, y + 11);
  });
}

function paletteForRecord(index) {
  return ["#1f8a70", "#2867b2", "#b23b3b", "#7c5ab8"][index % 4];
}

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || canvas.parentElement.clientWidth || 800;
  const height = Number(canvas.getAttribute("height")) || 360;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function clearCanvas(canvas, message) {
  const ctx = setupCanvas(canvas);
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || canvas.parentElement.clientWidth || 800;
  const height = Number(canvas.getAttribute("height")) || 360;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#5c6a62";
  ctx.font = "14px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, Math.abs(h) / 2, Math.abs(w) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function percentFor(record, binId) {
  return record.totalG ? (record.weightsGrams[binId] || 0) / record.totalG * 100 : 0;
}

function nullableMetric(value, unit) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${formatNumber(value, unit ? 0 : 2)}${unit ? ` ${unit}` : ""}`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN");
}

function formatNumber(value, digits) {
  const number = Number(value || 0);
  return number.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatSigned(value) {
  const rounded = round(value, 2);
  return `${rounded > 0 ? "+" : ""}${formatNumber(rounded, 2)}`;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function sum(values) {
  return values.reduce((total, value) => total + toNumber(value), 0);
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeUserId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function showDialog(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "open");
}

function toast(message, isError = false) {
  dom.toast.textContent = message;
  dom.toast.style.background = isError ? "#b23b3b" : "#17201b";
  dom.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => dom.toast.classList.remove("show"), 2600);
}
