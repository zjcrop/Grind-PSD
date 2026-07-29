"use strict";

const Core = window.GrindPSDCore;
const REPOSITORY = "zjcrop/Grind-PSD";
const STORAGE_KEY = "grindPsdAppV3";
const LEGACY_KEYS = ["grindPsdAppV2", "grindAnalyzerV1"];
const COMMUNITY_CACHE_KEY = "grindPsdCommunityCacheV3";
const DATABASE_PATH = "./data/database.json";
const USER_DATA_PATH = "./data/users";
const PALETTE = ["#d98e32", "#8ab4f8", "#6fbf73", "#e05d8a", "#b085f5", "#4dd0e1", "#ffd54f", "#ff8a65"];

if (!Core) {
  throw new Error("GrindPSDCore failed to load.");
}

const state = {
  store: null,
  selectedRecordId: null,
  selectedRecordSource: "local",
  communityRecords: [],
  communityMeta: null,
  selectedCommunityIds: new Set(),
  wizard: freshWizard(),
  activeTab: "current",
  deferredInstallPrompt: null,
  migrationMessage: ""
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  state.store = loadStore();
  buildStandardRows();
  buildWeighRows();
  bindEvents();
  updateActiveUser();
  selectNewestRecord();
  loadCachedCommunity();
  renderAll();
  updateNetworkStatus();
  registerServiceWorker();

  if (state.store.settings.autoSync && navigator.onLine) {
    syncCommunity({ quiet: true });
  }

  if (state.migrationMessage) {
    setTimeout(() => toast(state.migrationMessage, "success"), 300);
  }

  if (!state.store.records.length && !state.store.settings.hasOpenedWizard) {
    state.store.settings.hasOpenedWizard = true;
    saveStore();
    setTimeout(() => openWizard(), 260);
  }
}

function $(id) {
  return document.getElementById(id);
}

function freshWizard() {
  return {
    brand: "",
    model: "",
    color: PALETTE[0],
    setting: "",
    settingOrder: null,
    doseG: 10,
    bean: "",
    roastLevel: "",
    durationSec: 60,
    sieveDevice: "Grind-PSD 五段筛具",
    method: "手动水平往复筛分",
    replicate: 1,
    notes: "",
    weightsGrams: Core.normalizeWeights({})
  };
}

function defaultStore() {
  const random = Math.random().toString(36).slice(2, 8);
  return {
    schemaVersion: Core.SCHEMA_VERSION,
    user: {
      id: `user-${random}`,
      name: "本地用户"
    },
    settings: {
      autoSync: true,
      hasOpenedWizard: false
    },
    catalog: {},
    records: [],
    lastGrinder: null,
    updatedAt: new Date().toISOString()
  };
}

function loadStore() {
  const base = defaultStore();
  let current = null;
  try {
    current = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    current = null;
  }

  if (current && Array.isArray(current.records)) {
    const normalized = normalizeStore(current, base);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  const migrated = migrateLegacyStores(base);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated.store));
  state.migrationMessage = migrated.message;
  return migrated.store;
}

function normalizeStore(input, base) {
  const userId = Core.normalizeUserId(input.user?.id) || base.user.id;
  const records = (input.records || []).map(Core.normalizeRecord).filter(Boolean);
  const store = {
    ...base,
    ...input,
    schemaVersion: Core.SCHEMA_VERSION,
    user: {
      id: userId,
      name: Core.cleanText(input.user?.name || userId, 60)
    },
    settings: {
      ...base.settings,
      ...(input.settings || {})
    },
    catalog: input.catalog && typeof input.catalog === "object" ? input.catalog : {},
    records: dedupeRecords(records),
    lastGrinder: input.lastGrinder || null
  };
  rebuildCatalogFromRecords(store);
  return store;
}

function migrateLegacyStores(base) {
  const records = [];
  const messages = [];
  let user = { ...base.user };
  let lastGrinder = null;
  const catalog = {};

  try {
    const v2 = JSON.parse(localStorage.getItem(LEGACY_KEYS[0]));
    if (v2 && Array.isArray(v2.records)) {
      user = {
        id: Core.normalizeUserId(v2.user?.id) || user.id,
        name: Core.cleanText(v2.user?.name || v2.user?.id || user.name, 60)
      };
      v2.records.map(Core.normalizeRecord).filter(Boolean).forEach((record) => {
        records.push({ ...record, source: "migrated-v2" });
      });
      lastGrinder = v2.lastGrinder || lastGrinder;
      messages.push(`${v2.records.length} 条上一版记录`);
    }
  } catch (error) {
    // Ignore invalid legacy local data and continue with the original format.
  }

  try {
    const v1 = JSON.parse(localStorage.getItem(LEGACY_KEYS[1]));
    if (v1 && v1.brands && typeof v1.brands === "object") {
      Object.entries(v1.brands).forEach(([brand, brandData]) => {
        ensureCatalogEntry({ catalog }, brand);
        Object.entries(brandData.models || {}).forEach(([model, modelData], modelIndex) => {
          const color = Core.normalizeHexColor(modelData.color, PALETTE[modelIndex % PALETTE.length]);
          ensureCatalogEntry({ catalog }, brand, model, color);
          (modelData.records || []).forEach((legacyRecord) => {
            const createdAt = parseLegacyDate(legacyRecord.time);
            const record = Core.createRecord({
              user,
              grinder: {
                brand,
                model,
                setting: legacyRecord.dial,
                settingOrder: Core.deriveSettingOrder(legacyRecord.dial),
                color
              },
              sample: {
                doseG: legacyRecord.total,
                method: "原版记录：筛分方法未填写",
                durationSec: 0,
                sieveDevice: "",
                replicate: 1
              },
              weightsGrams: legacyRecord.weights,
              notes: "由 grindAnalyzerV1 自动迁移",
              source: "migrated-v1",
              createdAt
            });
            records.push(record);
          });
        });
      });
      if (v1.last) {
        lastGrinder = {
          brand: v1.last.brand,
          model: v1.last.model,
          setting: v1.last.dial || ""
        };
      }
      const count = Object.values(v1.brands).reduce((total, brandData) => {
        return total + Object.values(brandData.models || {}).reduce((modelTotal, modelData) => {
          return modelTotal + (modelData.records || []).length;
        }, 0);
      }, 0);
      if (count) messages.push(`${count} 条原版记录`);
    }
  } catch (error) {
    // Invalid legacy storage must not prevent the app from starting.
  }

  const store = {
    ...base,
    user,
    catalog,
    records: dedupeRecords(records),
    lastGrinder
  };
  rebuildCatalogFromRecords(store);
  return {
    store,
    message: messages.length ? `已迁移 ${messages.join("、")}。` : ""
  };
}

function parseLegacyDate(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(String(value).replace(/\//g, "-"));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function saveStore() {
  state.store.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.store));
}

function dedupeRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    if (!record || seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function ensureCatalogEntry(store, brand, model = "", color = PALETTE[0]) {
  const brandName = Core.cleanText(brand, 80);
  const modelName = Core.cleanText(model, 80);
  if (!brandName) return null;
  if (!store.catalog[brandName]) store.catalog[brandName] = { models: {} };
  if (!modelName) return store.catalog[brandName];
  if (!store.catalog[brandName].models[modelName]) {
    store.catalog[brandName].models[modelName] = {
      color: Core.normalizeHexColor(color, paletteForIndex(catalogModelCount(store)))
    };
  }
  return store.catalog[brandName].models[modelName];
}

function catalogModelCount(store) {
  return Object.values(store.catalog || {}).reduce((total, brand) => {
    return total + Object.keys(brand.models || {}).length;
  }, 0);
}

function rebuildCatalogFromRecords(store) {
  if (!store.catalog || typeof store.catalog !== "object") store.catalog = {};
  store.records.forEach((record) => {
    ensureCatalogEntry(store, record.grinder.brand, record.grinder.model, record.grinder.color);
  });
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  $("newRecordBtn").addEventListener("click", () => openWizard());
  $("syncBtn").addEventListener("click", () => syncCommunity({ quiet: false }));
  $("communitySyncBtn").addEventListener("click", () => syncCommunity({ quiet: false }));
  $("exportBtn").addEventListener("click", exportAllJson);
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", importJsonFile);
  $("installBtn").addEventListener("click", installApp);
  $("settingsBtn").addEventListener("click", openSettings);
  $("saveSettingsBtn").addEventListener("click", saveSettings);

  $("historySearch").addEventListener("input", renderHistory);
  $("historyGrinderFilter").addEventListener("change", renderHistory);
  $("historyGradeFilter").addEventListener("change", renderHistory);
  $("exportCsvBtn").addEventListener("click", () => exportRecordsCsv(getFilteredHistoryRecords(), "grind-psd-local"));
  $("clearRecordsBtn").addEventListener("click", clearLocalRecords);

  $("sel3dScope").addEventListener("change", () => {
    refresh3dGrinderOptions();
    render3D();
  });
  $("sel3dGrinder").addEventListener("change", render3D);
  $("sel3dUnit").addEventListener("change", render3D);

  $("cmpUnit").addEventListener("change", renderCompare);
  $("cmpRecordA").addEventListener("change", renderCompare);
  $("cmpRecordB").addEventListener("change", renderCompare);
  $("swapCompareBtn").addEventListener("click", swapCompare);

  ["communitySearch", "communityUserFilter", "communityBrandFilter", "communityGradeFilter"].forEach((id) => {
    $(id).addEventListener(id === "communitySearch" ? "input" : "change", renderCommunity);
  });
  $("communityImportBtn").addEventListener("click", importSelectedCommunity);
  $("communityCompareBtn").addEventListener("click", compareSelectedCommunity);
  $("communityDownloadBtn").addEventListener("click", downloadSelectedCommunity);
  $("communityCsvBtn").addEventListener("click", () => exportRecordsCsv(getFilteredCommunityRecords(), "grind-psd-community"));
  $("communitySubmitBtn").addEventListener("click", openSubmitModal);

  $("addBrandBtn").addEventListener("click", addBrand);
  $("addModelBtn").addEventListener("click", addModel);
  $("productColor").addEventListener("input", changeProductColor);
  $("sameAsLastBtn").addEventListener("click", sameAsLast);
  $("wizardNext1").addEventListener("click", () => goWizardStep(2));
  $("wizardBack2").addEventListener("click", () => goWizardStep(1));
  $("wizardNext2").addEventListener("click", () => goWizardStep(3));
  $("wizardBack3").addEventListener("click", () => goWizardStep(2));
  $("saveRecordBtn").addEventListener("click", saveWizardRecord);
  $("doseInput").addEventListener("input", updateWeightSummary);

  $("licenseConsent").addEventListener("change", updateSubmitPayload);
  $("copySubmitBtn").addEventListener("click", copySubmitJson);
  $("openIssueBtn").addEventListener("click", openSubmissionIssue);

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => hideModal(button.dataset.close));
  });

  document.querySelectorAll(".overlay").forEach((overlay) => {
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) hideModal(overlay.id);
    });
  });

  document.addEventListener("keydown", handleKeyboard);
  window.addEventListener("resize", debounce(() => {
    renderCurrentChart();
    if (state.activeTab === "array3d") render3D();
    if (state.activeTab === "compare") renderCompare();
  }, 120));
  window.addEventListener("online", () => {
    updateNetworkStatus();
    if (state.store.settings.autoSync) syncCommunity({ quiet: true });
  });
  window.addEventListener("offline", updateNetworkStatus);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    $("installBtn").textContent = "安装 App";
  });
  window.addEventListener("appinstalled", () => {
    state.deferredInstallPrompt = null;
    toast("Grind-PSD 已安装。", "success");
  });
}

function handleKeyboard(event) {
  if (event.key === "Escape") {
    const open = [...document.querySelectorAll(".overlay:not(.hidden)")].pop();
    if (open) hideModal(open.id);
    return;
  }
  if (event.key !== "Enter" || $("wizard").classList.contains("hidden")) return;
  if (document.activeElement === $("newBrandInput")) addBrand();
  if (document.activeElement === $("newModelInput")) addModel();
  if (document.activeElement === $("dialInput")) goWizardStep(3);
}

function switchTab(name) {
  state.activeTab = name;
  document.querySelectorAll(".tab").forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const active = panel.id === `tab-${name}`;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });

  if (name === "history") renderHistory();
  if (name === "array3d") {
    refresh3dGrinderOptions();
    render3D();
  }
  if (name === "compare") {
    refreshCompareOptions();
    renderCompare();
  }
  if (name === "community") renderCommunity();
  if (name === "current") renderCurrent();
}

function renderAll() {
  updateActiveUser();
  renderCurrent();
  refreshHistoryFilters();
  renderHistory();
  refresh3dGrinderOptions();
  refreshCompareOptions();
  refreshCommunityFilters();
  renderCommunity();
  updateCommunitySummary();
}

function updateActiveUser() {
  $("activeUserText").textContent = `本地用户：${state.store.user.id}`;
}

function updateNetworkStatus(message = "") {
  const online = navigator.onLine;
  $("networkDot").className = `status-dot ${online ? "online" : "offline"}`;
  $("networkText").textContent = message || (online ? "网络可用 · 本地数据已保存" : "离线模式 · 可继续记录，联网后再同步");
}

function openSettings() {
  $("settingsUserId").value = state.store.user.id;
  $("settingsUserName").value = state.store.user.name;
  $("autoSyncInput").checked = Boolean(state.store.settings.autoSync);
  showModal("settingsModal");
}

function saveSettings() {
  const id = Core.normalizeUserId($("settingsUserId").value);
  const name = Core.cleanText($("settingsUserName").value || id, 60);
  if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(id)) {
    toast("用户 ID 必须为 2–48 位小写字母、数字、下划线或连字符。", "error");
    return;
  }

  const previousId = state.store.user.id;
  const previousName = state.store.user.name;
  state.store.user = { id, name };
  state.store.settings.autoSync = $("autoSyncInput").checked;
  if (previousId !== id || previousName !== name) {
    state.store.records = state.store.records.map((record) => {
      if (record.user.id !== previousId) return record;
      return { ...record, user: { id, name }, updatedAt: new Date().toISOString() };
    });
  }
  saveStore();
  hideModal("settingsModal");
  renderAll();
  toast("用户设置已保存。", "success");
}

function openWizard(options = {}) {
  state.wizard = freshWizard();
  if (options.useLast && state.store.lastGrinder) {
    Object.assign(state.wizard, state.store.lastGrinder);
  } else if (state.store.lastGrinder) {
    state.wizard.color = state.store.lastGrinder.color || PALETTE[0];
  }
  $("wizardUserLabel").textContent = `${state.store.user.name} (${state.store.user.id})`;
  $("sameAsLastBtn").hidden = !state.store.lastGrinder;
  clearWizardFields();
  renderWizardStep1();
  goWizardStep(options.useLast ? 2 : 1);
  showModal("wizard");
}

function clearWizardFields() {
  $("newBrandInput").value = "";
  $("newModelInput").value = "";
  $("dialInput").value = "";
  $("dialOrderInput").value = "";
  $("doseInput").value = "10.00";
  $("beanInput").value = "";
  $("roastInput").value = "";
  $("durationInput").value = "60";
  $("deviceInput").value = "Grind-PSD 五段筛具";
  $("methodInput").value = "手动水平往复筛分";
  $("replicateInput").value = "1";
  $("notesInput").value = "";
  document.querySelectorAll("#weighRows input").forEach((input) => {
    input.value = "";
  });
}

function renderWizardStep1() {
  const brands = Object.keys(state.store.catalog).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const brandTags = $("brandTags");
  brandTags.innerHTML = brands.length
    ? brands.map((brand) => `<button class="tag ${brand === state.wizard.brand ? "selected" : ""}" type="button" data-brand="${escapeHtml(brand)}">${escapeHtml(brand)}</button>`).join("")
    : '<span class="note inline-note">还没有品牌，请在下方新增。</span>';
  brandTags.querySelectorAll("[data-brand]").forEach((button) => {
    button.addEventListener("click", () => {
      state.wizard.brand = button.dataset.brand;
      state.wizard.model = "";
      renderWizardStep1();
    });
  });

  const brandData = state.store.catalog[state.wizard.brand];
  $("modelField").hidden = !brandData;
  if (brandData) {
    const models = Object.keys(brandData.models || {}).sort((a, b) => a.localeCompare(b, "zh-CN"));
    $("modelTags").innerHTML = models.length
      ? models.map((model) => {
        const color = Core.normalizeHexColor(brandData.models[model].color);
        return `<button class="tag ${model === state.wizard.model ? "selected" : ""}" type="button" data-model="${escapeHtml(model)}"><span class="dot" style="background:${color}"></span>${escapeHtml(model)}</button>`;
      }).join("")
      : '<span class="note inline-note">该品牌还没有型号，请在下方新增。</span>';
    $("modelTags").querySelectorAll("[data-model]").forEach((button) => {
      button.addEventListener("click", () => {
        state.wizard.model = button.dataset.model;
        state.wizard.color = Core.normalizeHexColor(brandData.models[state.wizard.model]?.color);
        renderWizardStep1();
      });
    });
  }

  const modelData = brandData?.models?.[state.wizard.model];
  $("colorField").hidden = !modelData;
  if (modelData) $("productColor").value = Core.normalizeHexColor(modelData.color);
  $("wizardNext1").disabled = !(state.wizard.brand && state.wizard.model);
}

function addBrand() {
  const brand = Core.cleanText($("newBrandInput").value, 80);
  if (!brand) return;
  ensureCatalogEntry(state.store, brand);
  state.wizard.brand = brand;
  state.wizard.model = "";
  $("newBrandInput").value = "";
  saveStore();
  renderWizardStep1();
}

function addModel() {
  const model = Core.cleanText($("newModelInput").value, 80);
  if (!model || !state.wizard.brand) return;
  const data = ensureCatalogEntry(state.store, state.wizard.brand, model, paletteForIndex(catalogModelCount(state.store)));
  state.wizard.model = model;
  state.wizard.color = data.color;
  $("newModelInput").value = "";
  saveStore();
  renderWizardStep1();
}

function changeProductColor() {
  if (!state.wizard.brand || !state.wizard.model) return;
  const color = Core.normalizeHexColor($("productColor").value);
  state.wizard.color = color;
  ensureCatalogEntry(state.store, state.wizard.brand, state.wizard.model).color = color;
  saveStore();
  renderWizardStep1();
}

function sameAsLast() {
  if (!state.store.lastGrinder) return;
  state.wizard = {
    ...freshWizard(),
    ...state.store.lastGrinder,
    weightsGrams: Core.normalizeWeights({})
  };
  goWizardStep(2);
}

function goWizardStep(step) {
  if (step === 2 && !(state.wizard.brand && state.wizard.model)) {
    toast("请先选择品牌和型号。", "error");
    return;
  }

  if (step === 3 && !readWizardStep2()) return;

  [1, 2, 3].forEach((number) => {
    $(`wizardStep${number}`).hidden = number !== step;
  });

  if (step === 1) renderWizardStep1();
  if (step === 2) renderWizardStep2();
  if (step === 3) {
    renderWizardStep3();
    setTimeout(() => document.querySelector("#weighRows input")?.focus(), 40);
  }
}

function renderWizardStep2() {
  $("step2GrinderLabel").textContent = `${state.wizard.brand} ${state.wizard.model}`;
  $("dialInput").value = state.wizard.setting || "";
  $("dialOrderInput").value = state.wizard.settingOrder ?? "";
  $("doseInput").value = formatPlainNumber(state.wizard.doseG, 2);
  $("beanInput").value = state.wizard.bean || "";
  $("roastInput").value = state.wizard.roastLevel || "";
  $("durationInput").value = state.wizard.durationSec || 60;
  $("deviceInput").value = state.wizard.sieveDevice || "Grind-PSD 五段筛具";
  $("methodInput").value = state.wizard.method || "手动水平往复筛分";
  $("replicateInput").value = state.wizard.replicate || 1;
  $("notesInput").value = state.wizard.notes || "";

  const dials = unique(state.store.records
    .filter((record) => record.grinder.brand === state.wizard.brand && record.grinder.model === state.wizard.model)
    .map((record) => record.grinder.setting));
  $("dialHistory").innerHTML = dials.length
    ? `已有刻度：<span class="tag-history">${dials.slice(0, 12).map((dial) => `<button type="button" data-dial="${escapeHtml(dial)}">${escapeHtml(dial)}</button>`).join("")}</span>`
    : "还没有该型号的历史刻度。";
  $("dialHistory").querySelectorAll("[data-dial]").forEach((button) => {
    button.addEventListener("click", () => {
      $("dialInput").value = button.dataset.dial;
      const order = Core.deriveSettingOrder(button.dataset.dial);
      if (order !== null) $("dialOrderInput").value = order;
    });
  });
  setTimeout(() => $("dialInput").focus(), 40);
}

function readWizardStep2() {
  const setting = Core.cleanText($("dialInput").value, 80);
  const doseG = Core.toNumber($("doseInput").value);
  if (!setting) {
    toast("请填写研磨刻度。", "error");
    $("dialInput").focus();
    return false;
  }
  if (doseG <= 0) {
    toast("请填写大于 0 的投粉量。", "error");
    $("doseInput").focus();
    return false;
  }
  const orderText = $("dialOrderInput").value.trim();
  state.wizard.setting = setting;
  state.wizard.settingOrder = orderText === "" ? Core.deriveSettingOrder(setting) : Number(orderText);
  state.wizard.doseG = doseG;
  state.wizard.bean = Core.cleanText($("beanInput").value, 120);
  state.wizard.roastLevel = Core.cleanText($("roastInput").value, 40);
  state.wizard.durationSec = Core.toNumber($("durationInput").value);
  state.wizard.sieveDevice = Core.cleanText($("deviceInput").value, 80);
  state.wizard.method = Core.cleanText($("methodInput").value, 120);
  state.wizard.replicate = Math.max(1, Math.trunc(Core.toNumber($("replicateInput").value) || 1));
  state.wizard.notes = Core.cleanText($("notesInput").value, 500);
  return true;
}

function buildWeighRows() {
  $("weighRows").innerHTML = Core.SIEVES.map((sieve) => `
    <label class="weighing-row">
      <span class="weighing-name">
        <strong>${escapeHtml(sieve.label)}</strong>
        <span>${escapeHtml(sieve.range)} · ${escapeHtml(sieve.description)}</span>
      </span>
      <input type="number" min="0" max="200" step="0.01" inputmode="decimal" placeholder="0.00" data-weight="${escapeHtml(sieve.key)}" aria-label="${escapeHtml(sieve.label)}重量">
    </label>
  `).join("");
  document.querySelectorAll("#weighRows input").forEach((input) => {
    input.addEventListener("input", updateWeightSummary);
  });
}

function renderWizardStep3() {
  $("step3GrinderLabel").textContent = `${state.wizard.brand} ${state.wizard.model} · 刻度 ${state.wizard.setting}`;
  document.querySelectorAll("#weighRows input").forEach((input) => {
    const value = state.wizard.weightsGrams[input.dataset.weight];
    input.value = value ? formatPlainNumber(value, 2) : "";
  });
  updateWeightSummary();
}

function readWeightInputs() {
  const weights = {};
  document.querySelectorAll("#weighRows input").forEach((input) => {
    weights[input.dataset.weight] = Core.toNumber(input.value);
  });
  return Core.normalizeWeights(weights);
}

function updateWeightSummary() {
  const weights = readWeightInputs();
  const total = Core.round(Core.sum(Object.values(weights)), 2);
  const dose = Core.toNumber($("doseInput").value || state.wizard.doseG);
  const quality = Core.calculateQuality(dose, total, {
    durationSec: Core.toNumber($("durationInput").value || state.wizard.durationSec),
    sieveDevice: $("deviceInput").value || state.wizard.sieveDevice
  });
  $("weightTotal").textContent = `${formatNumber(total, 2)} g`;
  $("recoveryTotal").textContent = quality.recoveryPct === null ? "—" : `${formatNumber(quality.recoveryPct, 2)}%`;
  $("qualityPreview").textContent = `${quality.grade} · ${quality.gradeLabel}`;
  $("qualityPreview").style.color = gradeColor(quality.grade);

  const validation = $("weightValidation");
  validation.className = "validation-message";
  if (total <= 0) {
    validation.textContent = "请至少填写一个大于 0 的筛层重量。";
  } else if (quality.grade === "D") {
    validation.classList.add("error");
    validation.textContent = "质量回收误差超过 10%。可以本地保存，但不能提交公开数据库，建议检查静电、漏粉或录入。";
  } else if (quality.grade === "C") {
    validation.classList.add("warn");
    validation.textContent = "质量等级 C：允许本地保存和公开提交，但只适合谨慎比较。";
  } else {
    validation.textContent = `质量回收误差 ${formatNumber(quality.massBalanceErrorPct, 2)}%，满足 ${quality.grade} 级。`;
  }
}

function saveWizardRecord() {
  state.wizard.weightsGrams = readWeightInputs();
  const total = Core.round(Core.sum(Object.values(state.wizard.weightsGrams)), 2);
  if (total <= 0) {
    toast("请至少填写一个筛层的重量。", "error");
    return;
  }

  const record = Core.createRecord({
    user: state.store.user,
    grinder: {
      brand: state.wizard.brand,
      model: state.wizard.model,
      setting: state.wizard.setting,
      settingOrder: state.wizard.settingOrder,
      color: state.wizard.color
    },
    sample: {
      doseG: state.wizard.doseG,
      bean: state.wizard.bean,
      roastLevel: state.wizard.roastLevel,
      method: state.wizard.method,
      durationSec: state.wizard.durationSec,
      sieveDevice: state.wizard.sieveDevice,
      replicate: state.wizard.replicate
    },
    weightsGrams: state.wizard.weightsGrams,
    notes: state.wizard.notes,
    source: "local"
  });

  const catalog = ensureCatalogEntry(state.store, record.grinder.brand, record.grinder.model, record.grinder.color);
  catalog.color = record.grinder.color;
  state.store.records = dedupeRecords([record, ...state.store.records]);
  state.store.lastGrinder = {
    brand: record.grinder.brand,
    model: record.grinder.model,
    color: record.grinder.color,
    setting: record.grinder.setting,
    settingOrder: record.grinder.settingOrder,
    doseG: record.sample.doseG,
    bean: record.sample.bean,
    roastLevel: record.sample.roastLevel,
    durationSec: record.sample.durationSec,
    sieveDevice: record.sample.sieveDevice,
    method: record.sample.method,
    replicate: record.sample.replicate,
    notes: ""
  };
  state.selectedRecordId = record.id;
  state.selectedRecordSource = "local";
  saveStore();
  hideModal("wizard");
  renderAll();
  switchTab("current");
  toast("记录已保存并生成图表。", "success");
}

function selectNewestRecord() {
  if (state.selectedRecordId) return;
  const newest = state.store.records[0];
  if (newest) {
    state.selectedRecordId = newest.id;
    state.selectedRecordSource = "local";
  }
}

function getSelectedRecord() {
  if (!state.selectedRecordId) return null;
  if (state.selectedRecordSource === "community") {
    return state.communityRecords.find((record) => record.id === state.selectedRecordId) || null;
  }
  return state.store.records.find((record) => record.id === state.selectedRecordId)
    || state.communityRecords.find((record) => record.id === state.selectedRecordId)
    || null;
}

function renderCurrent() {
  const record = getSelectedRecord();
  const container = $("currentContent");
  if (!record) {
    container.innerHTML = `
      <div class="panel">
        <div class="empty-state">
          <div class="empty-icon">◌</div>
          <strong>暂无称重记录</strong>
          <span>点击“＋ 新建称重记录”，按原版三步流程开始。</span>
        </div>
      </div>`;
    return;
  }

  const quality = record.metrics.quality;
  const color = Core.normalizeHexColor(record.grinder.color);
  const sourceLabel = state.selectedRecordSource === "community" ? "社区记录" : "本地记录";
  const rows = Core.SIEVES.map((sieve) => {
    const weight = record.weightsGrams[sieve.key] || 0;
    const pct = record.totalG ? weight / record.totalG * 100 : 0;
    return `
      <tr>
        <td><strong>${escapeHtml(sieve.label)}</strong></td>
        <td>${escapeHtml(sieve.range)}</td>
        <td class="num">${formatNumber(weight, 2)}</td>
        <td class="num">${formatNumber(pct, 2)}%</td>
        <td class="bar-cell"><div class="mini-bar" style="width:${Math.max(1.5, Math.min(100, pct))}%;background:${color}"></div></td>
      </tr>`;
  }).join("");

  container.innerHTML = `
    <div class="panel">
      <div class="record-header">
        <div>
          <div class="record-title">
            <h2>汇总表</h2>
            ${qualityChip(quality)}
          </div>
          <div class="record-meta">
            <span class="badge"><span class="dot" style="background:${color}"></span>${escapeHtml(record.grinder.brand)} ${escapeHtml(record.grinder.model)}</span>
            <span class="badge">刻度 ${escapeHtml(record.grinder.setting)}</span>
            <span class="badge">用户 ${escapeHtml(record.user.id)}</span>
            <span class="badge">${escapeHtml(sourceLabel)}</span>
            <span class="badge">${escapeHtml(formatDateTime(record.createdAt))}</span>
          </div>
        </div>
        <div class="panel-actions">
          ${state.selectedRecordSource === "community"
            ? '<button class="primary small" type="button" data-current-action="import">导入本地</button>'
            : '<button class="primary small" type="button" data-current-action="submit">提交到社区库</button>'}
          <button class="ghost small" type="button" data-current-action="export">导出本条 JSON</button>
          <button class="ghost small" type="button" data-current-action="print">打印</button>
        </div>
      </div>
      <table>
        <thead><tr><th>筛分档</th><th>标称粒径区间</th><th class="num">重量 g</th><th class="num">占比</th><th>分布</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="metrics-grid">
        ${metricCard("投粉量", `${formatNumber(record.sample.doseG, 2)} g`)}
        ${metricCard("五档回收", `${formatNumber(record.totalG, 2)} g`)}
        ${metricCard("质量回收率", quality.recoveryPct === null ? "—" : `${formatNumber(quality.recoveryPct, 2)}%`)}
        ${metricCard("≥1000 μm", `${formatNumber(record.metrics.coarsePct, 2)}%`)}
        ${metricCard("500–1000 μm", `${formatNumber(record.metrics.bodyPct, 2)}%`)}
        ${metricCard("<300 μm", `${formatNumber(record.metrics.finesPct, 2)}%`)}
      </div>
      <p class="note">
        方法：${escapeHtml(record.sample.method || "未记录")} ·
        时长：${record.sample.durationSec ? `${formatNumber(record.sample.durationSec, 0)} s` : "未记录"} ·
        筛具：${escapeHtml(record.sample.sieveDevice || "未记录")} ·
        重复：#${formatNumber(record.sample.replicate || 1, 0)}
        ${record.sample.bean ? ` · 样品：${escapeHtml(record.sample.bean)}` : ""}
        ${record.sample.roastLevel ? ` · 烘焙：${escapeHtml(record.sample.roastLevel)}` : ""}
      </p>
      ${record.notes ? `<p class="note">备注：${escapeHtml(record.notes)}</p>` : ""}
    </div>
    <div class="panel">
      <div class="chart-toolbar">
        <h2>粉径分布柱状图 <span class="hint">${escapeHtml(record.grinder.brand)} ${escapeHtml(record.grinder.model)} · 刻度 ${escapeHtml(record.grinder.setting)}</span></h2>
        <select id="currentChartUnit" aria-label="当前图表单位">
          <option value="g">重量 g</option>
          <option value="pct">占比 %</option>
        </select>
      </div>
      <div class="canvas-scroll"><canvas id="canvasBar" height="380"></canvas></div>
    </div>`;

  container.querySelectorAll("[data-current-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.currentAction;
      if (action === "submit") openSubmitModal();
      if (action === "export") exportSingleRecord(record);
      if (action === "print") window.print();
      if (action === "import") importCommunityRecord(record.id);
    });
  });
  $("currentChartUnit").addEventListener("change", renderCurrentChart);
  renderCurrentChart();
}

function metricCard(label, value) {
  return `<div class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function qualityChip(quality) {
  const grade = quality?.grade || "U";
  const label = quality?.gradeLabel || "未评级";
  return `<span class="quality-chip"><span class="grade grade-${grade.toLowerCase()}">${escapeHtml(grade)}</span>${escapeHtml(label)}</span>`;
}

function renderCurrentChart() {
  const canvas = $("canvasBar");
  const record = getSelectedRecord();
  if (!canvas || !record) return;
  drawBarChart(canvas, record, $("currentChartUnit")?.value || "g");
}

function refreshHistoryFilters() {
  const current = $("historyGrinderFilter").value;
  const groups = unique(state.store.records.map((record) => grinderFilterKey(record.grinder.brand, record.grinder.model)));
  $("historyGrinderFilter").innerHTML = '<option value="">全部磨豆机</option>' + groups.map((key) => {
    const [brand, model] = key.split("::").map((part) => decodeURIComponent(part));
    return `<option value="${escapeHtml(key)}">${escapeHtml(brand)} ${escapeHtml(model)}</option>`;
  }).join("");
  if (groups.includes(current)) $("historyGrinderFilter").value = current;
}

function getFilteredHistoryRecords() {
  const query = $("historySearch").value.trim().toLowerCase();
  const grinder = $("historyGrinderFilter").value;
  const grade = $("historyGradeFilter").value;
  return state.store.records.filter((record) => {
    if (grinder && grinderFilterKey(record.grinder.brand, record.grinder.model) !== grinder) return false;
    if (grade && record.metrics.quality.grade !== grade) return false;
    if (!query) return true;
    return searchableRecordText(record).includes(query);
  });
}

function grinderFilterKey(brand, model) {
  return [brand, model].map((part) => encodeURIComponent(String(part || ""))).join("::");
}

function renderHistory() {
  const container = $("historyContent");
  const records = getFilteredHistoryRecords();
  if (!records.length) {
    container.innerHTML = '<div class="empty">没有符合条件的本地记录。</div>';
    return;
  }
  container.innerHTML = recordTable(records, { community: false });
  bindRecordTableActions(container, false);
}

function recordTable(records, options = {}) {
  return `
    <table>
      <thead>
        <tr>
          ${options.community ? '<th class="select-cell"><input type="checkbox" data-select-all aria-label="全选筛选结果"></th>' : ""}
          <th>用户</th><th>磨豆机</th><th>刻度</th><th class="num">回收总重</th>
          <th class="num">极细粉</th><th>等级</th><th>样品</th><th>时间</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${records.map((record) => `
          <tr>
            ${options.community ? `<td class="select-cell"><input type="checkbox" data-community-select="${escapeHtml(record.id)}" ${state.selectedCommunityIds.has(record.id) ? "checked" : ""} aria-label="选择记录"></td>` : ""}
            <td>${escapeHtml(record.user.id)}</td>
            <td><span class="dot" style="background:${Core.normalizeHexColor(record.grinder.color)}"></span>${escapeHtml(record.grinder.brand)} ${escapeHtml(record.grinder.model)}</td>
            <td>${escapeHtml(record.grinder.setting)}</td>
            <td class="num">${formatNumber(record.totalG, 2)} g</td>
            <td class="num">${formatNumber(record.metrics.finesPct, 2)}%</td>
            <td>${qualityChip(record.metrics.quality)}</td>
            <td class="wrap-cell">${record.sample.bean ? `<span class="truncate">${escapeHtml(record.sample.bean)}</span>` : "—"}</td>
            <td>${escapeHtml(formatDate(record.createdAt))}</td>
            <td>
              <div class="row-actions">
                <button type="button" data-view-record="${escapeHtml(record.id)}">查看</button>
                ${options.community
                  ? `<button type="button" data-import-record="${escapeHtml(record.id)}">导入</button><button type="button" data-user-download="${escapeHtml(record.user.id)}">用户库</button>`
                  : `<button type="button" data-clone-record="${escapeHtml(record.id)}">复测</button><button type="button" data-delete-record="${escapeHtml(record.id)}">删除</button>`}
              </div>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function bindRecordTableActions(container, community) {
  container.querySelectorAll("[data-view-record]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedRecordId = button.dataset.viewRecord;
      state.selectedRecordSource = community ? "community" : "local";
      renderCurrent();
      switchTab("current");
    });
  });
  container.querySelectorAll("[data-delete-record]").forEach((button) => {
    button.addEventListener("click", () => deleteLocalRecord(button.dataset.deleteRecord));
  });
  container.querySelectorAll("[data-clone-record]").forEach((button) => {
    button.addEventListener("click", () => cloneAsRetest(button.dataset.cloneRecord));
  });
  container.querySelectorAll("[data-import-record]").forEach((button) => {
    button.addEventListener("click", () => importCommunityRecord(button.dataset.importRecord));
  });
  container.querySelectorAll("[data-user-download]").forEach((button) => {
    button.addEventListener("click", () => downloadUserLibrary(button.dataset.userDownload));
  });
  container.querySelectorAll("[data-community-select]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedCommunityIds.add(checkbox.dataset.communitySelect);
      else state.selectedCommunityIds.delete(checkbox.dataset.communitySelect);
    });
  });
  const selectAll = container.querySelector("[data-select-all]");
  if (selectAll) {
    selectAll.addEventListener("change", () => {
      getFilteredCommunityRecords().forEach((record) => {
        if (selectAll.checked) state.selectedCommunityIds.add(record.id);
        else state.selectedCommunityIds.delete(record.id);
      });
      renderCommunity();
    });
  }
}

function deleteLocalRecord(id) {
  const record = state.store.records.find((item) => item.id === id);
  if (!record) return;
  if (!window.confirm(`删除 ${record.grinder.brand} ${record.grinder.model} · 刻度 ${record.grinder.setting}？`)) return;
  state.store.records = state.store.records.filter((item) => item.id !== id);
  if (state.selectedRecordId === id) {
    state.selectedRecordId = state.store.records[0]?.id || null;
    state.selectedRecordSource = "local";
  }
  saveStore();
  renderAll();
  toast("本地记录已删除。", "success");
}

function clearLocalRecords() {
  if (!state.store.records.length) return;
  if (!window.confirm(`确定清空 ${state.store.records.length} 条本地记录？此操作不会删除已公开提交的数据。建议先导出备份。`)) return;
  state.store.records = [];
  state.selectedRecordId = null;
  state.selectedRecordSource = "local";
  saveStore();
  renderAll();
  toast("本地记录已清空。", "success");
}

function cloneAsRetest(id) {
  const record = state.store.records.find((item) => item.id === id);
  if (!record) return;
  state.wizard = {
    ...freshWizard(),
    brand: record.grinder.brand,
    model: record.grinder.model,
    color: record.grinder.color,
    setting: record.grinder.setting,
    settingOrder: record.grinder.settingOrder,
    doseG: record.sample.doseG,
    bean: record.sample.bean,
    roastLevel: record.sample.roastLevel,
    durationSec: record.sample.durationSec,
    sieveDevice: record.sample.sieveDevice,
    method: record.sample.method,
    replicate: (record.sample.replicate || 1) + 1,
    notes: "",
    weightsGrams: Core.normalizeWeights({})
  };
  $("wizardUserLabel").textContent = `${state.store.user.name} (${state.store.user.id})`;
  $("sameAsLastBtn").hidden = !state.store.lastGrinder;
  clearWizardFields();
  showModal("wizard");
  goWizardStep(2);
}

function getRecordsForScope(scope) {
  if (scope === "local") return [...state.store.records];
  if (scope === "community") return [...state.communityRecords];
  return getAllRecords();
}

function getAllRecords() {
  const map = new Map();
  state.communityRecords.forEach((record) => map.set(record.id, record));
  state.store.records.forEach((record) => map.set(record.id, record));
  return [...map.values()];
}

function groupRecords(records) {
  const groups = new Map();
  records.forEach((record) => {
    const key = Core.recordGroupKey(record);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        userId: record.user.id,
        brand: record.grinder.brand,
        model: record.grinder.model,
        color: Core.normalizeHexColor(record.grinder.color),
        records: []
      });
    }
    groups.get(key).records.push(record);
  });
  return [...groups.values()].sort((a, b) => {
    return `${a.brand} ${a.model} ${a.userId}`.localeCompare(`${b.brand} ${b.model} ${b.userId}`, "zh-CN", { numeric: true });
  });
}

function latestBySetting(records) {
  const map = new Map();
  [...records].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).forEach((record) => {
    map.set(record.grinder.setting, record);
  });
  return [...map.values()].sort(Core.compareSettings);
}

function refresh3dGrinderOptions() {
  const select = $("sel3dGrinder");
  const current = select.value;
  const groups = groupRecords(getRecordsForScope($("sel3dScope").value));
  select.innerHTML = groups.length
    ? groups.map((group) => `<option value="${escapeHtml(group.key)}">${escapeHtml(group.userId)} · ${escapeHtml(group.brand)} ${escapeHtml(group.model)} (${latestBySetting(group.records).length} 刻度)</option>`).join("")
    : '<option value="">暂无可用记录</option>';
  if (groups.some((group) => group.key === current)) select.value = current;
}

function render3D() {
  const groups = groupRecords(getRecordsForScope($("sel3dScope").value));
  const group = groups.find((item) => item.key === $("sel3dGrinder").value) || groups[0] || null;
  drawArray3D($("canvas3d"), group, $("sel3dUnit").value, $("note3d"));
}

function refreshCompareOptions() {
  const records = getAllRecords().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const oldA = $("cmpRecordA").value;
  const oldB = $("cmpRecordB").value;
  const options = records.map((record) => {
    const source = state.store.records.some((item) => item.id === record.id) ? "本地" : "社区";
    return `<option value="${escapeHtml(record.id)}">[${source}] ${escapeHtml(record.user.id)} · ${escapeHtml(record.grinder.brand)} ${escapeHtml(record.grinder.model)} · ${escapeHtml(record.grinder.setting)}</option>`;
  }).join("");
  $("cmpRecordA").innerHTML = options || '<option value="">暂无记录</option>';
  $("cmpRecordB").innerHTML = options || '<option value="">暂无记录</option>';
  if (records.some((record) => record.id === oldA)) $("cmpRecordA").value = oldA;
  if (records.some((record) => record.id === oldB)) $("cmpRecordB").value = oldB;
  if (!$("cmpRecordA").value && records[0]) $("cmpRecordA").value = records[0].id;
  if ((!$("cmpRecordB").value || $("cmpRecordB").value === $("cmpRecordA").value) && records[1]) {
    $("cmpRecordB").value = records[1].id;
  }
}

function findAnyRecord(id) {
  return getAllRecords().find((record) => record.id === id) || null;
}

function swapCompare() {
  const a = $("cmpRecordA").value;
  $("cmpRecordA").value = $("cmpRecordB").value;
  $("cmpRecordB").value = a;
  renderCompare();
}

function renderCompare() {
  const a = findAnyRecord($("cmpRecordA").value);
  const b = findAnyRecord($("cmpRecordB").value);
  drawOverlapCompare($("canvasCmp"), a, b, $("cmpUnit").value);

  if (!a || !b) {
    $("compareMetrics").innerHTML = "";
    drawArray3D($("canvasCmp3dA"), null, "g");
    drawArray3D($("canvasCmp3dB"), null, "g");
    return;
  }

  const difference = (valueA, valueB, suffix = "") => `${formatSigned((valueB || 0) - (valueA || 0), 2)}${suffix}`;
  $("compareMetrics").innerHTML = `
    ${deltaCard("极细粉差值 B−A", difference(a.metrics.finesPct, b.metrics.finesPct, " pct"))}
    ${deltaCard("≥1000 μm 差值 B−A", difference(a.metrics.coarsePct, b.metrics.coarsePct, " pct"))}
    ${deltaCard("500–1000 μm 差值 B−A", difference(a.metrics.bodyPct, b.metrics.bodyPct, " pct"))}
    ${deltaCard("回收率差值 B−A", difference(a.metrics.quality.recoveryPct, b.metrics.quality.recoveryPct, " pct"))}`;

  const groups = groupRecords(getAllRecords());
  const groupA = groups.find((group) => group.key === Core.recordGroupKey(a));
  const groupB = groups.find((group) => group.key === Core.recordGroupKey(b));
  $("cmp3dTitleA").textContent = `A · ${a.user.id} · ${a.grinder.brand} ${a.grinder.model}`;
  $("cmp3dTitleB").textContent = `B · ${b.user.id} · ${b.grinder.brand} ${b.grinder.model}`;
  drawArray3D($("canvasCmp3dA"), groupA, "pct");
  drawArray3D($("canvasCmp3dB"), groupB, "pct");
}

function deltaCard(label, value) {
  return `<div class="delta-card">${escapeHtml(label)}<strong>${escapeHtml(value)}</strong></div>`;
}

async function syncCommunity({ quiet = false } = {}) {
  if (!navigator.onLine) {
    if (!quiet) toast("当前处于离线状态，已保留上次缓存的社区数据。", "error");
    updateNetworkStatus("离线模式 · 使用上次社区数据库缓存");
    return;
  }

  $("networkDot").className = "status-dot syncing";
  updateNetworkStatus("正在同步社区数据库…");
  $("communityStatus").textContent = "正在同步…";
  try {
    const response = await fetch(`${DATABASE_PATH}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const database = await response.json();
    const records = Array.isArray(database.records)
      ? database.records.map(Core.normalizeRecord).filter(Boolean)
      : [];
    state.communityRecords = dedupeRecords(records);
    state.communityMeta = {
      updatedAt: database.updatedAt || null,
      users: database.users || {},
      recordCount: database.recordCount ?? state.communityRecords.length,
      userCount: database.userCount ?? unique(state.communityRecords.map((record) => record.user.id)).length
    };
    localStorage.setItem(COMMUNITY_CACHE_KEY, JSON.stringify({
      cachedAt: new Date().toISOString(),
      meta: state.communityMeta,
      records: state.communityRecords
    }));
    refreshCommunityFilters();
    refreshCompareOptions();
    refresh3dGrinderOptions();
    updateCommunitySummary();
    renderCommunity();
    renderCompare();
    updateNetworkStatus(`社区数据库已同步 · ${state.communityRecords.length} 条记录`);
    $("communityStatus").textContent = `已同步 ${state.communityRecords.length} 条记录`;
    if (!quiet) toast("社区数据库同步完成。", "success");
  } catch (error) {
    updateNetworkStatus("社区数据库同步失败 · 本地记录不受影响");
    $("communityStatus").textContent = `同步失败：${error.message}`;
    if (!quiet) toast(`社区数据库同步失败：${error.message}`, "error");
  }
}

function loadCachedCommunity() {
  try {
    const cached = JSON.parse(localStorage.getItem(COMMUNITY_CACHE_KEY));
    if (!cached || !Array.isArray(cached.records)) return;
    state.communityRecords = dedupeRecords(cached.records.map(Core.normalizeRecord).filter(Boolean));
    state.communityMeta = cached.meta || null;
    $("communityStatus").textContent = `已载入缓存 ${state.communityRecords.length} 条`;
  } catch (error) {
    // A broken cache can be replaced by the next successful sync.
  }
}

function updateCommunitySummary() {
  const userCount = state.communityMeta?.userCount
    ?? unique(state.communityRecords.map((record) => record.user.id)).length;
  const recordCount = state.communityMeta?.recordCount ?? state.communityRecords.length;
  $("communityUserCount").textContent = String(userCount);
  $("communityRecordCount").textContent = String(recordCount);
  $("communityUpdatedAt").textContent = state.communityMeta?.updatedAt ? formatDate(state.communityMeta.updatedAt) : "—";
  $("communityCountBadge").textContent = String(state.communityRecords.length);
}

function refreshCommunityFilters() {
  fillSelect(
    $("communityUserFilter"),
    unique(state.communityRecords.map((record) => record.user.id)).sort(),
    "全部用户"
  );
  fillSelect(
    $("communityBrandFilter"),
    unique(state.communityRecords.map((record) => record.grinder.brand)).sort((a, b) => a.localeCompare(b, "zh-CN")),
    "全部品牌"
  );
}

function fillSelect(select, values, defaultLabel) {
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(defaultLabel)}</option>` +
    values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  if (values.includes(current)) select.value = current;
}

function getFilteredCommunityRecords() {
  const query = $("communitySearch").value.trim().toLowerCase();
  const user = $("communityUserFilter").value;
  const brand = $("communityBrandFilter").value;
  const grade = $("communityGradeFilter").value;
  return state.communityRecords.filter((record) => {
    if (user && record.user.id !== user) return false;
    if (brand && record.grinder.brand !== brand) return false;
    if (grade && record.metrics.quality.grade !== grade) return false;
    return !query || searchableRecordText(record).includes(query);
  });
}

function renderCommunity() {
  const container = $("communityContent");
  const records = getFilteredCommunityRecords();
  if (!records.length) {
    container.innerHTML = `<div class="empty">${state.communityRecords.length ? "没有符合筛选条件的记录。" : "社区数据库目前为空，或尚未同步。"}</div>`;
    return;
  }
  container.innerHTML = recordTable(records, { community: true });
  bindRecordTableActions(container, true);
}

function searchableRecordText(record) {
  return [
    record.user.id,
    record.user.name,
    record.grinder.brand,
    record.grinder.model,
    record.grinder.setting,
    record.sample.bean,
    record.sample.roastLevel,
    record.notes
  ].join(" ").toLowerCase();
}

function importCommunityRecord(id) {
  const record = state.communityRecords.find((item) => item.id === id);
  if (!record) return;
  const imported = Core.normalizeRecord({ ...record, source: "community-import" });
  state.store.records = dedupeRecords([imported, ...state.store.records]);
  state.selectedRecordId = imported.id;
  state.selectedRecordSource = "local";
  rebuildCatalogFromRecords(state.store);
  saveStore();
  renderAll();
  toast("社区记录已导入本地，可用于离线对比。", "success");
}

function importSelectedCommunity() {
  const selected = state.communityRecords.filter((record) => state.selectedCommunityIds.has(record.id));
  if (!selected.length) {
    toast("请先选择要导入的社区记录。", "error");
    return;
  }
  selected.forEach((record) => {
    const imported = Core.normalizeRecord({ ...record, source: "community-import" });
    state.store.records = dedupeRecords([imported, ...state.store.records]);
  });
  rebuildCatalogFromRecords(state.store);
  saveStore();
  renderAll();
  toast(`已导入 ${selected.length} 条社区记录。`, "success");
}

function compareSelectedCommunity() {
  const selected = state.communityRecords.filter((record) => state.selectedCommunityIds.has(record.id));
  if (selected.length !== 2) {
    toast("请正好选择 2 条社区记录进行对比。", "error");
    return;
  }
  refreshCompareOptions();
  $("cmpRecordA").value = selected[0].id;
  $("cmpRecordB").value = selected[1].id;
  renderCompare();
  switchTab("compare");
}

function downloadSelectedCommunity() {
  const selected = state.communityRecords.filter((record) => state.selectedCommunityIds.has(record.id));
  if (!selected.length) {
    toast("请先选择要下载的社区记录。", "error");
    return;
  }
  downloadJson({
    schemaVersion: Core.SCHEMA_VERSION,
    standardId: Core.STANDARD_ID,
    exportedAt: new Date().toISOString(),
    records: selected
  }, `grind-psd-community-${dateStamp()}.json`);
}

async function downloadUserLibrary(userId) {
  try {
    const response = await fetch(`${USER_DATA_PATH}/${encodeURIComponent(userId)}.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    downloadJson(data, `grind-psd-user-${userId}.json`);
  } catch (error) {
    toast(`用户库下载失败：${error.message}`, "error");
  }
}

function openSubmitModal() {
  const record = getSelectedRecord();
  if (!record || state.selectedRecordSource === "community") {
    toast("请先选择一条本地记录。", "error");
    return;
  }
  $("licenseConsent").checked = false;
  showModal("submitModal");
  updateSubmitPayload();
}

function buildPublicPayload(record, licensed) {
  return {
    schemaVersion: Core.SCHEMA_VERSION,
    standardId: Core.STANDARD_ID,
    id: record.id,
    user: record.user,
    grinder: {
      brand: record.grinder.brand,
      model: record.grinder.model,
      setting: record.grinder.setting,
      settingOrder: record.grinder.settingOrder,
      color: record.grinder.color
    },
    sample: record.sample,
    weightsGrams: record.weightsGrams,
    totalG: record.totalG,
    notes: record.notes,
    license: licensed ? Core.DATA_LICENSE : null,
    createdAt: record.createdAt
  };
}

function updateSubmitPayload() {
  const record = getSelectedRecord();
  if (!record) return;
  const payload = buildPublicPayload(record, $("licenseConsent").checked);
  const validation = Core.validatePublicRecord(payload);
  $("submitJson").value = JSON.stringify(payload, null, 2);

  const items = [
    {
      type: /^[a-z0-9][a-z0-9_-]{1,47}$/.test(record.user.id) ? "ok" : "error",
      text: `用户 ID：${record.user.id}`
    },
    {
      type: record.standardId === Core.STANDARD_ID ? "ok" : "error",
      text: `标准 ID：${record.standardId}`
    },
    {
      type: record.metrics.quality.grade === "C" ? "warn" : (record.metrics.quality.grade === "D" ? "error" : "ok"),
      text: `质量等级 ${record.metrics.quality.grade} · 回收率 ${record.metrics.quality.recoveryPct === null ? "未评级" : `${formatNumber(record.metrics.quality.recoveryPct, 2)}%`}`
    },
    {
      type: record.sample.durationSec > 0 && record.sample.sieveDevice ? "ok" : "error",
      text: `筛分条件：${record.sample.durationSec || 0} s · ${record.sample.sieveDevice || "未填写筛具"}`
    },
    {
      type: $("licenseConsent").checked ? "ok" : "error",
      text: $("licenseConsent").checked ? "已同意 CC BY 4.0 数据许可" : "尚未同意公开数据许可"
    }
  ];
  validation.warnings.forEach((warning) => items.push({ type: "warn", text: warning }));
  $("submitChecklist").innerHTML = items.map((item) => {
    return `<div class="check-item ${item.type === "ok" ? "" : item.type}">${escapeHtml(item.text)}</div>`;
  }).join("");
  $("openIssueBtn").disabled = validation.errors.length > 0;
}

async function copySubmitJson() {
  try {
    await navigator.clipboard.writeText($("submitJson").value);
    toast("标准 JSON 已复制。", "success");
  } catch (error) {
    $("submitJson").select();
    document.execCommand("copy");
    toast("标准 JSON 已复制。", "success");
  }
}

function openSubmissionIssue() {
  const record = getSelectedRecord();
  if (!record) return;
  const payload = JSON.parse($("submitJson").value);
  const validation = Core.validatePublicRecord(payload);
  if (validation.errors.length) {
    toast(validation.errors[0], "error");
    return;
  }
  const title = `[PSD] ${record.user.id} · ${record.grinder.brand} ${record.grinder.model} · ${record.grinder.setting}`;
  const body = [
    "## Grind-PSD 标准数据提交",
    "",
    "请勿修改以下标记之间的 JSON。自动工作流会校验原始数据并写入社区数据库。",
    "",
    "BEGIN_GRIND_PSD_JSON",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "END_GRIND_PSD_JSON",
    "",
    `标准：\`${Core.STANDARD_ID}\``,
    `数据许可：${Core.DATA_LICENSE}`
  ].join("\n");
  const url = `https://github.com/${REPOSITORY}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    toast("浏览器阻止了新窗口，请允许弹窗后重试。", "error");
    return;
  }
  hideModal("submitModal");
  toast("已打开 GitHub。发布 Issue 后，数据会自动校验并入库。", "success");
}

function exportAllJson() {
  downloadJson({
    schemaVersion: Core.SCHEMA_VERSION,
    standardId: Core.STANDARD_ID,
    exportedAt: new Date().toISOString(),
    user: state.store.user,
    catalog: state.store.catalog,
    records: state.store.records
  }, `grind-psd-local-${dateStamp()}.json`);
}

function exportSingleRecord(record) {
  downloadJson(buildPublicPayload(record, false), `${record.id}.json`);
}

function exportRecordsCsv(records, prefix) {
  if (!records.length) {
    toast("没有可导出的记录。", "error");
    return;
  }
  const headers = [
    "record_id", "user_id", "user_name", "brand", "model", "setting", "setting_order",
    "dose_g", ...Core.WEIGHT_KEYS, "recovered_g", "recovery_pct", "quality_grade",
    "coarse_pct", "body_500_1000_pct", "fines_lt300_pct", "bean", "roast_level",
    "method", "duration_sec", "sieve_device", "replicate", "created_at", "notes"
  ];
  const rows = records.map((record) => [
    record.id,
    record.user.id,
    record.user.name,
    record.grinder.brand,
    record.grinder.model,
    record.grinder.setting,
    record.grinder.settingOrder ?? "",
    record.sample.doseG,
    ...Core.WEIGHT_KEYS.map((key) => record.weightsGrams[key]),
    record.totalG,
    record.metrics.quality.recoveryPct ?? "",
    record.metrics.quality.grade,
    record.metrics.coarsePct,
    record.metrics.bodyPct,
    record.metrics.finesPct,
    record.sample.bean,
    record.sample.roastLevel,
    record.sample.method,
    record.sample.durationSec,
    record.sample.sieveDevice,
    record.sample.replicate,
    record.createdAt,
    record.notes
  ]);
  const csv = "\ufeff" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  downloadText(csv, `${prefix}-${dateStamp()}.csv`, "text/csv;charset=utf-8");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function importJsonFile(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const before = state.store.records.length;
      if (parsed.brands && !parsed.records) {
        importLegacyV1Object(parsed);
      } else {
        const candidates = Array.isArray(parsed.records) ? parsed.records : [parsed];
        const normalized = candidates.map(Core.normalizeRecord).filter(Boolean);
        if (!normalized.length) throw new Error("文件中没有符合当前标准的记录");
        normalized.forEach((record) => {
          state.store.records = dedupeRecords([{ ...record, source: "import" }, ...state.store.records]);
        });
      }
      rebuildCatalogFromRecords(state.store);
      saveStore();
      selectNewestRecord();
      renderAll();
      toast(`导入完成，新增 ${state.store.records.length - before} 条记录。`, "success");
    } catch (error) {
      toast(`导入失败：${error.message}`, "error");
    }
  };
  reader.readAsText(file);
}

function importLegacyV1Object(v1) {
  Object.entries(v1.brands || {}).forEach(([brand, brandData]) => {
    Object.entries(brandData.models || {}).forEach(([model, modelData]) => {
      const color = Core.normalizeHexColor(modelData.color);
      (modelData.records || []).forEach((legacyRecord) => {
        const record = Core.createRecord({
          user: state.store.user,
          grinder: {
            brand,
            model,
            setting: legacyRecord.dial,
            settingOrder: Core.deriveSettingOrder(legacyRecord.dial),
            color
          },
          sample: {
            doseG: legacyRecord.total,
            method: "原版导入：筛分方法未填写",
            durationSec: 0,
            sieveDevice: ""
          },
          weightsGrams: legacyRecord.weights,
          notes: "由原版 Grind-PSD JSON 导入",
          source: "import-v1",
          createdAt: parseLegacyDate(legacyRecord.time)
        });
        state.store.records = dedupeRecords([record, ...state.store.records]);
      });
    });
  });
}

function buildStandardRows() {
  $("standardRows").innerHTML = Core.SIEVES.map((sieve) => `
    <tr>
      <td>${escapeHtml(sieve.label)}</td>
      <td>${escapeHtml(sieve.range)}</td>
      <td><code>${escapeHtml(sieve.key)}</code></td>
    </tr>`).join("");
}

function showModal(id) {
  const modal = $(id);
  if (!modal) return;
  document.querySelectorAll(".overlay:not(.hidden)").forEach((other) => {
    if (other.id !== id) other.classList.add("hidden");
  });
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function hideModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.add("hidden");
  if (!document.querySelector(".overlay:not(.hidden)")) document.body.style.overflow = "";
}

async function installApp() {
  if (state.deferredInstallPrompt) {
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    return;
  }

  const ua = navigator.userAgent.toLowerCase();
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (standalone) {
    $("installInstructions").innerHTML = '<div class="install-step"><strong>已安装</strong>当前正在以 App 模式运行，数据仍保存在此设备。</div>';
  } else if (/iphone|ipad|ipod/.test(ua)) {
    $("installInstructions").innerHTML = `
      <div class="install-step"><strong>iPhone / iPad</strong>使用 Safari 打开本页，点击底部“分享”按钮，再选择“添加到主屏幕”。</div>
      <div class="install-step"><strong>注意</strong>不要使用微信内置浏览器安装；iOS 的本地数据与 Safari 网站数据关联。</div>`;
  } else {
    $("installInstructions").innerHTML = `
      <div class="install-step"><strong>Android / 桌面 Chrome 或 Edge</strong>打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。</div>
      <div class="install-step"><strong>离线能力</strong>首次联网打开后，记录与绘图可离线使用；社区同步和提交仍需要网络。</div>`;
  }
  showModal("installModal");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}

function drawBarChart(canvas, record, unit) {
  const { ctx, width, height } = setupCanvas(canvas);
  const pad = { left: 58, right: 22, top: 28, bottom: 58 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const values = Core.SIEVES.map((sieve) => {
    return unit === "pct"
      ? (record.totalG ? (record.weightsGrams[sieve.key] || 0) / record.totalG * 100 : 0)
      : (record.weightsGrams[sieve.key] || 0);
  });
  const maxValue = Math.max(...values) * 1.16 || 1;
  drawGrid(ctx, pad, plotW, plotH, maxValue, unit);
  const color = Core.normalizeHexColor(record.grinder.color);
  const groupW = plotW / Core.SIEVES.length;
  const barW = Math.min(72, groupW * 0.54);

  Core.SIEVES.forEach((sieve, index) => {
    const value = values[index];
    const barH = plotH * value / maxValue;
    const x = pad.left + groupW * (index + 0.5) - barW / 2;
    const y = pad.top + plotH - barH;
    const gradient = ctx.createLinearGradient(0, y, 0, pad.top + plotH);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, shadeColor(color, 0.55));
    ctx.fillStyle = gradient;
    roundedRectPath(ctx, x, y, barW, barH, 5);
    ctx.fill();
    if (value > 0) {
      ctx.fillStyle = "#efe6da";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${formatPlainNumber(value, unit === "pct" ? 1 : 2)}${unit === "pct" ? "%" : "g"}`, x + barW / 2, y - 7);
    }
    ctx.fillStyle = "#a89880";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(sieve.shortLabel, x + barW / 2, pad.top + plotH + 21);
    ctx.font = "10px sans-serif";
    ctx.fillText(sieve.range, x + barW / 2, pad.top + plotH + 39);
  });
}

function drawGrid(ctx, pad, plotW, plotH, maxValue, unit) {
  ctx.clearRect(0, 0, pad.left + plotW + pad.right, pad.top + plotH + pad.bottom);
  ctx.strokeStyle = "#3a2f26";
  ctx.fillStyle = "#a89880";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  for (let index = 0; index <= 4; index += 1) {
    const value = maxValue * index / 4;
    const y = pad.top + plotH - plotH * index / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillText(`${formatPlainNumber(value, unit === "pct" ? 0 : 1)}${unit === "pct" ? "%" : "g"}`, pad.left - 8, y + 4);
  }
}

function drawArray3D(canvas, group, unit = "g", noteElement = null) {
  const { ctx, width, height } = setupCanvas(canvas);
  if (!group || !group.records.length) {
    drawEmptyCanvas(ctx, width, height, "暂无可绘制的刻度记录");
    if (noteElement) noteElement.textContent = "至少需要同一用户、同一磨豆机的记录。";
    return;
  }

  const rows = latestBySetting(group.records);
  if (noteElement) {
    noteElement.textContent = rows.length >= 3
      ? `${group.userId} · ${group.brand} ${group.model} 共 ${rows.length} 个刻度。近排=较细，远排=较粗；排序优先使用“由细到粗排序值”。`
      : `当前只有 ${rows.length} 个不同刻度（${rows.map((record) => record.grinder.setting).join("、")}），建议录入 3 个及以上刻度。`;
  }

  const values = (record) => Core.SIEVES.map((sieve) => {
    return unit === "pct"
      ? (record.totalG ? (record.weightsGrams[sieve.key] || 0) / record.totalG * 100 : 0)
      : (record.weightsGrams[sieve.key] || 0);
  });
  let maxValue = 0;
  rows.forEach((record) => values(record).forEach((value) => {
    maxValue = Math.max(maxValue, value);
  }));
  maxValue = maxValue * 1.12 || 1;

  const countX = Core.SIEVES.length;
  const countZ = rows.length;
  const depthTotal = Math.min(160, 34 * countZ);
  const depthX = depthTotal / Math.max(1, countZ);
  const depthY = depthTotal * 0.6 / Math.max(1, countZ);
  const pad = { left: 68, right: 70, top: 38, bottom: 68 };
  const plotW = Math.max(310, width - pad.left - pad.right - depthTotal);
  const plotH = Math.max(190, height - pad.top - pad.bottom - depthTotal * 0.6);
  const cell = plotW / countX;
  const barW = cell * 0.5;
  const baseY = height - pad.bottom;
  const scaleY = plotH / maxValue;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#3a2f26";
  for (let index = 0; index <= countX; index += 1) {
    const x = pad.left + cell * index;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x + depthTotal, baseY - depthTotal * 0.6);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(pad.left, baseY);
  ctx.lineTo(pad.left + plotW, baseY);
  ctx.stroke();

  ctx.fillStyle = "#a89880";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  for (let index = 0; index <= 4; index += 1) {
    const value = maxValue * index / 4;
    const y = baseY - value * scaleY;
    ctx.fillText(`${formatPlainNumber(value, unit === "pct" ? 0 : 1)}${unit === "pct" ? "%" : "g"}`, pad.left - 8, y + 4);
    ctx.strokeStyle = "rgba(58,47,38,.65)";
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
  }

  const baseColor = Core.normalizeHexColor(group.color);
  for (let rowIndex = countZ - 1; rowIndex >= 0; rowIndex -= 1) {
    const record = rows[rowIndex];
    const rowValues = values(record);
    const offsetX = rowIndex * depthX;
    const offsetY = rowIndex * depthY;
    const brightness = 0.55 + 0.45 * (1 - rowIndex / Math.max(1, countZ - 1));
    const front = shadeColor(baseColor, brightness);
    const top = shadeColor(baseColor, brightness * 1.3);
    const side = shadeColor(baseColor, brightness * 0.7);
    for (let index = 0; index < countX; index += 1) {
      const value = rowValues[index];
      if (value <= 0) continue;
      const barH = value * scaleY;
      const x = pad.left + cell * (index + 0.5) - barW / 2 + offsetX;
      const y = baseY - offsetY;
      const prismX = depthX * 0.58;
      const prismY = depthY * 0.58;
      ctx.fillStyle = side;
      ctx.beginPath();
      ctx.moveTo(x + barW, y - barH);
      ctx.lineTo(x + barW + prismX, y - barH - prismY);
      ctx.lineTo(x + barW + prismX, y - prismY);
      ctx.lineTo(x + barW, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = top;
      ctx.beginPath();
      ctx.moveTo(x, y - barH);
      ctx.lineTo(x + prismX, y - barH - prismY);
      ctx.lineTo(x + barW + prismX, y - barH - prismY);
      ctx.lineTo(x + barW, y - barH);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = front;
      ctx.fillRect(x, y - barH, barW, barH);
    }
    ctx.strokeStyle = shadeColor(baseColor, brightness * 1.45);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    rowValues.forEach((value, index) => {
      const x = pad.left + cell * (index + 0.5) + offsetX;
      const y = baseY - offsetY - value * scaleY;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = "#efe6da";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`刻度 ${record.grinder.setting}`, pad.left + plotW + offsetX + 7, baseY - offsetY + 2);
  }

  ctx.fillStyle = "#a89880";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  Core.SIEVES.forEach((sieve, index) => {
    ctx.fillText(sieve.shortLabel, pad.left + cell * (index + 0.5), baseY + 22);
    ctx.font = "9px sans-serif";
    ctx.fillText(sieve.range, pad.left + cell * (index + 0.5), baseY + 38);
    ctx.font = "11px sans-serif";
  });
  ctx.fillStyle = "#efe6da";
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${group.userId} · ${group.brand} ${group.model}`, pad.left, 20);
  ctx.fillStyle = "#a89880";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("Z：细（近）→ 粗（远）", width - 10, 20);
}

function drawOverlapCompare(canvas, recordA, recordB, unit) {
  const { ctx, width, height } = setupCanvas(canvas);
  if (!recordA || !recordB) {
    drawEmptyCanvas(ctx, width, height, "至少需要两条记录才能对比");
    return;
  }

  const value = (record, sieve) => unit === "pct"
    ? (record.totalG ? (record.weightsGrams[sieve.key] || 0) / record.totalG * 100 : 0)
    : (record.weightsGrams[sieve.key] || 0);
  let maxValue = 0;
  Core.SIEVES.forEach((sieve) => {
    maxValue = Math.max(maxValue, value(recordA, sieve), value(recordB, sieve));
  });
  maxValue = maxValue * 1.16 || 1;
  const pad = { left: 58, right: 22, top: 54, bottom: 58 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  drawGrid(ctx, pad, plotW, plotH, maxValue, unit);

  const colorA = Core.normalizeHexColor(recordA.grinder.color, "#8ab4f8");
  const colorB = Core.normalizeHexColor(recordB.grinder.color, "#e05d5d");
  const mixed = mixColors(colorA, colorB);
  const groupW = plotW / Core.SIEVES.length;
  const barW = Math.min(72, groupW * 0.5);
  Core.SIEVES.forEach((sieve, index) => {
    const valueA = value(recordA, sieve);
    const valueB = value(recordB, sieve);
    const heightA = plotH * valueA / maxValue;
    const heightB = plotH * valueB / maxValue;
    const overlapHeight = Math.min(heightA, heightB);
    const maxHeight = Math.max(heightA, heightB);
    const x = pad.left + groupW * (index + 0.5) - barW / 2;
    const baseY = pad.top + plotH;
    if (overlapHeight > 0) {
      ctx.fillStyle = mixed;
      ctx.fillRect(x, baseY - overlapHeight, barW, overlapHeight);
    }
    if (maxHeight > overlapHeight) {
      ctx.fillStyle = heightA > heightB ? colorA : colorB;
      ctx.fillRect(x, baseY - maxHeight, barW, maxHeight - overlapHeight);
    }
    ctx.strokeStyle = "rgba(255,255,255,.16)";
    ctx.strokeRect(x, baseY - maxHeight, barW, maxHeight);
    ctx.fillStyle = "#a89880";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(sieve.shortLabel, x + barW / 2, baseY + 21);
    ctx.font = "9px sans-serif";
    ctx.fillText(sieve.range, x + barW / 2, baseY + 38);
  });

  drawLegend(ctx, [
    { color: colorA, label: `A · ${recordA.user.id} · ${recordA.grinder.brand} ${recordA.grinder.model} ${recordA.grinder.setting}` },
    { color: colorB, label: `B · ${recordB.user.id} · ${recordB.grinder.brand} ${recordB.grinder.model} ${recordB.grinder.setting}` },
    { color: mixed, label: "重叠区域" }
  ], pad.left, 17, width - pad.right);
}

function drawLegend(ctx, items, startX, y, maxX) {
  let x = startX;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  items.forEach((item) => {
    const label = item.label.length > 34 ? `${item.label.slice(0, 33)}…` : item.label;
    const needed = 18 + ctx.measureText(label).width + 24;
    if (x + needed > maxX) return;
    ctx.fillStyle = item.color;
    ctx.fillRect(x, y, 12, 12);
    ctx.fillStyle = "#efe6da";
    ctx.fillText(label, x + 17, y + 10);
    x += needed;
  });
}

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(620, rect.width || canvas.parentElement?.clientWidth || 800);
  const height = Number(canvas.getAttribute("height")) || 400;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.height = `${height}px`;
  canvas.style.width = `${width}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function drawEmptyCanvas(ctx, width, height, message) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#a89880";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function shadeColor(hex, factor) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value * factor)))).join(",")})`;
}

function mixColors(colorA, colorB) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  return `rgb(${a.map((value, index) => Math.round((value + b[index]) / 2)).join(",")})`;
}

function hexToRgb(hex) {
  const normalized = Core.normalizeHexColor(hex).slice(1);
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16)
  ];
}

function gradeColor(grade) {
  return {
    A: "#6fbf73",
    B: "#8ab4f8",
    C: "#ffd166",
    D: "#e05d5d",
    U: "#a89880"
  }[grade] || "#a89880";
}

function paletteForIndex(index) {
  return PALETTE[index % PALETTE.length];
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))];
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatPlainNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "0";
}

function formatSigned(value, digits = 2) {
  const number = Core.round(Number(value) || 0, digits);
  return `${number > 0 ? "+" : ""}${formatNumber(number, digits)}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

function debounce(callback, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), wait);
  };
}

function downloadJson(data, filename) {
  downloadText(JSON.stringify(data, null, 2), filename, "application/json;charset=utf-8");
}

function downloadText(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function toast(message, type = "") {
  const element = $("toast");
  element.textContent = message;
  element.className = `toast show ${type}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    element.className = "toast";
  }, 3200);
}
