"use strict";

// Grind-PSD 1.3.1 application shell and Supabase-aware interaction state machine.
const Core = window.GrindPSDCore;
const Cloud = window.GrindPSDCloud;
const REPOSITORY = "zjcrop/Grind-PSD";
const APP_VERSION = "1.3.1";
const MAX_COMPARE_RECORDS = 10;
const STORAGE_KEY = "grindPsdAppV5";
const PREVIOUS_STORAGE_KEY = "grindPsdAppV4";
const LEGACY_KEYS = ["grindPsdAppV3", "grindPsdAppV2", "grindAnalyzerV1"];
const COMMUNITY_CACHE_KEY = "grindPsdCommunityCacheV5";
const PREVIOUS_COMMUNITY_CACHE_KEY = "grindPsdCommunityCacheV4";
const GITHUB_SESSION_KEY = "grindPsdGitHubSessionV1";
const APP_CONFIG_PATH = "./data/app-config.json";
const DATABASE_PATH = "./data/database.json";
const USER_DATA_PATH = "./data/users";
const RECENT_GRINDER_WINDOW_MS = 30 * 60 * 1000;
const MAX_BATCH_RECORDS = 20;
const MAX_SYNC_QUEUE_ITEMS = 100;
const PALETTE = ["#d98e32", "#8ab4f8", "#6fbf73", "#e05d8a", "#b085f5", "#4dd0e1", "#ffd54f", "#ff8a65", "#64b5f6", "#c0ca33"];

if (!Core) {
  throw new Error("GrindPSDCore failed to load.");
}

window.addEventListener("error", (event) => {
  reportRuntimeFailure(event.error || event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  reportRuntimeFailure(event.reason);
});

const state = {
  store: null,
  selectedRecordId: null,
  selectedRecordSource: "local",
  communityRecords: [],
  communityMeta: null,
  selectedCommunityIds: new Set(),
  selectedHistoryIds: new Set(),
  wizard: freshWizard(),
  activeTab: "measure",
  deferredInstallPrompt: null,
  migrationMessage: "",
  authMode: "login",
  identityConfirmed: false,
  browsingOnly: false,
  communityFresh: false,
  pendingOperation: null,
  nextRoundTimer: null,
  appConfig: null,
  githubAuth: null,
  deviceAuth: null,
  oauthPromise: null,
  oauthPollCancelled: false,
  syncRefreshTimer: null
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  state.store = loadStore();
  buildStandardRows();
  buildWeighRows();
  prepareMeasurementPage();
  bindEvents();
  if (Cloud) await Cloud.init();
  if (Cloud?.isSignedIn()) await restoreCloudSession();
  else restoreLocalSession();
  updateActiveUser();
  selectNewestRecord();
  renderAll();
  updateNetworkStatus();
  registerServiceWorker();

  if (state.migrationMessage) {
    setTimeout(() => toast(state.migrationMessage, "success"), 300);
  }
  const authNotice = Cloud?.authRedirectNotice?.();
  if (authNotice?.message) {
    setTimeout(() => toast(authNotice.message, authNotice.type === "error" ? "error" : "success"), 350);
  }
  prepareAuthModal();
  if (!state.identityConfirmed) setTimeout(() => openAuthModal(), 80);
  if (Cloud?.isSignedIn()) syncCloudRecords({ quiet: true });
}

async function restoreCloudSession() {
  try {
    const profile = await Cloud.profile();
    if (!profile?.handle) return;
    activateProfile({ id: profile.handle, name: profile.display_name || profile.handle }, true);
  } catch (error) {
    updateNetworkStatus(`云端会话恢复失败：${error.message}`);
  }
}

function restoreLocalSession() {
  const id = Core.normalizeUserId(state.store.activeUserId);
  const profile = state.store.profiles?.[id];
  if (!id || !profile || state.store.settings.rememberLogin === false) return;
  state.store.user = { id, name: profile.name || id, temporary: false };
  state.identityConfirmed = true;
  state.browsingOnly = false;
}

function $(id) {
  return document.getElementById(id);
}

function freshWizard() {
  return {
    mode: "create",
    targetRecordId: null,
    createdAt: null,
    brand: "",
    model: "",
    color: PALETTE[0],
    setting: "",
    settingTurns: null,
    settingOrder: null,
    doseG: null,
    bean: "",
    roastLevel: "",
    durationSec: 60,
    sieveDevice: "Grind-PSD 五筛六分段筛具",
    method: "手动水平往复筛分",
    replicate: 1,
    notes: "",
    sieveProfile: Core.createSieveProfile(Core.SIEVES.filter((sieve) => sieve.apertureUm).map((sieve) => ({
      mesh: sieve.mesh,
      apertureUm: sieve.apertureUm
    }))),
    weightsGrams: Core.normalizeWeights({})
  };
}

function defaultStore() {
  const random = Math.random().toString(36).slice(2, 8);
  const temporaryId = `local-${random}`;
  return {
    schemaVersion: Core.SCHEMA_VERSION,
    user: {
      id: temporaryId,
      name: "本机临时用户",
      temporary: true
    },
    profiles: {},
    activeUserId: "",
    settings: {
      autoSync: false,
      autoUpload: false,
      licenseAcceptedAt: null,
      hasOpenedWizard: false,
      rememberLogin: true
    },
    catalog: {},
    records: [],
    cloudSync: {},
    syncQueue: [],
    lastGrinder: null,
    lastMeasurementAt: null,
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

  try {
    const previous = JSON.parse(localStorage.getItem(PREVIOUS_STORAGE_KEY));
    if (previous && Array.isArray(previous.records)) {
      const normalized = normalizeStore(previous, base);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      state.migrationMessage = `已迁移 Grind-PSD v4 的 ${normalized.records.length} 条本地记录与用户设置。`;
      return normalized;
    }
  } catch (error) {
    // Continue with older compatible formats.
  }

  const migrated = migrateLegacyStores(base);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated.store));
  state.migrationMessage = migrated.message;
  return migrated.store;
}

function normalizeStore(input, base) {
  const userId = Core.normalizeUserId(input.user?.id) || base.user.id;
  const records = (input.records || []).map(Core.normalizeRecord).filter(Boolean);
  const rememberLogin = input.settings?.rememberLogin !== false;
  const profiles = {};
  Object.values(input.profiles || {}).forEach((profile) => {
    const id = Core.normalizeUserId(profile?.id);
    if (!isValidUserId(id) || isTemporaryUserId(id)) return;
    profiles[id] = {
      id,
      name: Core.cleanText(profile.name || id, 60),
      createdAt: profile.createdAt || new Date().toISOString(),
      lastLoginAt: profile.lastLoginAt || null,
      pendingRegistration: Boolean(profile.pendingRegistration)
    };
  });
  if (rememberLogin && isValidUserId(userId) && !isTemporaryUserId(userId)) {
    profiles[userId] = profiles[userId] || {
      id: userId,
      name: Core.cleanText(input.user?.name || userId, 60),
      createdAt: input.updatedAt || new Date().toISOString(),
      lastLoginAt: null,
      pendingRegistration: false
    };
  }
  const store = {
    ...base,
    ...input,
    schemaVersion: Core.SCHEMA_VERSION,
    user: {
      id: userId,
      name: Core.cleanText(input.user?.name || userId, 60),
      temporary: Boolean(input.user?.temporary) || isTemporaryUserId(userId)
    },
    profiles,
    activeUserId: rememberLogin
      ? (profiles[input.activeUserId]?.id || (!isTemporaryUserId(userId) ? userId : ""))
      : "",
    settings: {
      ...base.settings,
      ...(input.settings || {}),
      autoSync: false,
      autoUpload: false
    },
    catalog: input.catalog && typeof input.catalog === "object" ? input.catalog : {},
    records: dedupeRecords(records),
    cloudSync: input.cloudSync && typeof input.cloudSync === "object" ? input.cloudSync : {},
    syncQueue: normalizeSyncQueue(input.syncQueue),
    lastGrinder: input.lastGrinder || null,
    lastMeasurementAt: input.lastMeasurementAt || input.lastGrinder?.measuredAt || null
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

  [LEGACY_KEYS[0], LEGACY_KEYS[1]].forEach((key, index) => {
    try {
      const legacy = JSON.parse(localStorage.getItem(key));
      if (!legacy || !Array.isArray(legacy.records)) return;
      user = {
        id: Core.normalizeUserId(legacy.user?.id) || user.id,
        name: Core.cleanText(legacy.user?.name || legacy.user?.id || user.name, 60),
        temporary: Boolean(legacy.user?.temporary) || isTemporaryUserId(legacy.user?.id)
      };
      legacy.records.map(Core.normalizeRecord).filter(Boolean).forEach((record) => {
        records.push({ ...record, source: index === 0 ? "migrated-v3" : "migrated-v2" });
      });
      lastGrinder = legacy.lastGrinder || lastGrinder;
      messages.push(`${legacy.records.length} 条${index === 0 ? "v3" : "v2"} 记录`);
    } catch (error) {
      // Continue with any other compatible local format.
    }
  });

  try {
    const v1 = JSON.parse(localStorage.getItem(LEGACY_KEYS[2]));
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
    profiles: isValidUserId(user.id) && !isTemporaryUserId(user.id)
      ? {
          [user.id]: {
            id: user.id,
            name: user.name,
            createdAt: new Date().toISOString(),
            lastLoginAt: null
          }
        }
      : {},
    activeUserId: isValidUserId(user.id) && !isTemporaryUserId(user.id) ? user.id : "",
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

async function loadAppConfig() {
  const fallback = {
    repository: REPOSITORY,
    githubAppClientId: "",
    githubAppName: "Grind-PSD Sync",
    authMode: "github-app-device-flow"
  };
  try {
    const response = await fetch(`${APP_CONFIG_PATH}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    return {
      ...fallback,
      ...config,
      repository: config.repository === REPOSITORY ? REPOSITORY : fallback.repository,
      githubAppClientId: String(config.githubAppClientId || "").trim()
    };
  } catch (error) {
    return fallback;
  }
}

function normalizeSyncQueue(value) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(["queued", "authorizing", "processing", "success", "failed"]);
  return value.slice(0, MAX_SYNC_QUEUE_ITEMS).map((item) => {
    if (!item || typeof item !== "object") return null;
    return {
      id: Core.cleanText(item.id || createLocalId("sync"), 100),
      operation: Core.cleanText(item.operation || "upsert_records", 40),
      title: Core.cleanText(item.title || "Grind-PSD 数据同步", 160),
      status: allowed.has(item.status) ? item.status : "queued",
      recordIds: Array.isArray(item.recordIds)
        ? item.recordIds.map((id) => Core.cleanText(id, 100)).filter(Boolean).slice(0, MAX_BATCH_RECORDS)
        : [],
      issueNumber: Number(item.issueNumber) || null,
      issueUrl: /^https:\/\/github\.com\//.test(String(item.issueUrl || "")) ? String(item.issueUrl) : "",
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
      error: Core.cleanText(item.error || "", 500)
    };
  }).filter(Boolean);
}

function createLocalId(prefix) {
  if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

  $("newRecordBtn").addEventListener("click", startMeasurementFlow);
  $("measurementStartBtn").addEventListener("click", startMeasurementFlow);
  $("uploadCloudBtn").addEventListener("click", () => {
    closeActionMenu();
    uploadAllRecordsToCloud();
  });
  $("exportBtn").addEventListener("click", () => {
    closeActionMenu();
    exportAllJson();
  });
  $("importBtn").addEventListener("click", () => {
    closeActionMenu();
    $("importFile").click();
  });
  $("importFile").addEventListener("change", importJsonFile);
  $("installBtn").addEventListener("click", () => {
    closeActionMenu();
    installApp();
  });
  $("settingsBtn").addEventListener("click", openSettings);
  $("saveSettingsBtn").addEventListener("click", saveSettings);
  $("switchUserBtn").addEventListener("click", () => {
    hideModal("settingsModal");
    openAuthModal();
  });

  $("authLoginTab").addEventListener("click", () => setAuthMode("login"));
  $("authRegisterTab").addEventListener("click", () => setAuthMode("register"));
  $("loginUserId").addEventListener("input", updateLoginHint);
  $("loginContinueBtn").addEventListener("click", loginAndContinue);
  $("registerUserId").addEventListener("input", updateRegistrationAvailability);
  $("registerUserName").addEventListener("input", updateRegistrationAvailability);
  $("registerEmail").addEventListener("input", updateRegistrationAvailability);
  $("registerPassword").addEventListener("input", updateRegistrationAvailability);
  $("registerContinueBtn").addEventListener("click", registerAndContinue);
  $("authBrowseOnlyBtn").addEventListener("click", exitAuthToBrowse);
  $("authRegisterExitBtn").addEventListener("click", exitAuthToBrowse);

  $("historyFilterFields").appendChild($("historyFilters"));
  $("historyFilters").hidden = false;
  const historyFilterInputs = [...$("historyFilters").querySelectorAll("input, select")];
  $("openHistoryFilterBtn").addEventListener("click", () => {
    $("historyFilterModal").dataset.snapshot = JSON.stringify(
      Object.fromEntries(historyFilterInputs.map((input) => [input.id, input.value]))
    );
    showModal("historyFilterModal");
  });
  $("cancelHistoryFilterBtn").addEventListener("click", () => {
    const snapshot = JSON.parse($("historyFilterModal").dataset.snapshot || "{}");
    historyFilterInputs.forEach((input) => {
      if (snapshot[input.id] !== undefined) input.value = snapshot[input.id];
    });
    refreshHistoryFilters();
    hideModal("historyFilterModal");
  });
  $("applyHistoryFilterBtn").addEventListener("click", () => {
    refreshHistoryFilters();
    renderHistory();
    hideModal("historyFilterModal");
  });
  $("historyBrandFilter").addEventListener("change", refreshHistoryFilters);
  $("clearHistorySelectionBtn").addEventListener("click", clearHistorySelection);
  $("selectAllHistoryBtn").addEventListener("click", selectAllHistory);
  $("compareHistorySelectionBtn").addEventListener("click", compareHistorySelection);
  $("editCompareSelectionBtn").addEventListener("click", () => switchTab("history"));
  $("exportCsvBtn").addEventListener("click", () => exportRecordsCsv(getFilteredHistoryRecords(), "grind-psd-local"));
  $("clearRecordsBtn").addEventListener("click", clearLocalRecords);

  $("recordDetailUnit").addEventListener("change", renderRecordDetail);

  ["communitySearch", "communityUserFilter", "communityBrandFilter", "communityGradeFilter"].forEach((id) => {
    $(id).addEventListener(id === "communitySearch" ? "input" : "change", renderCommunity);
  });
  $("communityImportBtn").addEventListener("click", importSelectedCommunity);
  $("communityCompareBtn").addEventListener("click", compareSelectedCommunity);
  $("communityDownloadBtn").addEventListener("click", downloadSelectedCommunity);
  $("communityCsvBtn").addEventListener("click", () => exportRecordsCsv(getFilteredCommunityRecords(), "grind-psd-community"));

  $("addBrandBtn").addEventListener("click", addBrand);
  $("addModelBtn").addEventListener("click", addModel);
  $("productColor").addEventListener("input", changeProductColor);
  $("sameAsLastBtn").addEventListener("click", sameAsLast);
  $("wizardNext1").addEventListener("click", () => goWizardStep(2));
  $("wizardBack2").addEventListener("click", () => goWizardStep(1));
  $("wizardNext2").addEventListener("click", () => goWizardStep(3));
  $("wizardBack3").addEventListener("click", returnFromWeighingStep);
  $("wizardExit2").addEventListener("click", exitMeasurementFlow);
  $("wizardExit3").addEventListener("click", exitMeasurementFlow);
  $("wizardExit1").addEventListener("click", exitMeasurementFlow);
  $("wizardCloseBtn").addEventListener("click", exitMeasurementFlow);
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-history-details]")) return;
    document.querySelectorAll("[data-history-details][open]").forEach((details) => {
      details.open = false;
    });
  });
  $("saveRecordBtn").addEventListener("click", saveWizardRecord);
  $("doseInput").addEventListener("input", updateWeightSummary);
  $("addSieveRowBtn").addEventListener("click", () => {
    const rows = readSieveConfigRows();
    const smallest = Math.min(...rows.map((row) => Number(row.apertureUm)).filter(Number.isFinite));
    rows.push({ mesh: "", apertureUm: Math.max(1, Math.round(smallest * 0.75)) });
    state.wizard.sieveProfile = Core.createSieveProfile(rows);
    renderSieveConfigRows();
  });
  $("resetSieveRowsBtn").addEventListener("click", () => {
    state.wizard.sieveProfile = Core.createSieveProfile([
      { mesh: 18, apertureUm: 1000 }, { mesh: 24, apertureUm: 800 },
      { mesh: 35, apertureUm: 500 }, { mesh: 60, apertureUm: 300 },
      { mesh: 80, apertureUm: 180 }
    ]);
    renderSieveConfigRows();
  });


  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => hideModal(button.dataset.close));
  });

  document.querySelectorAll(".overlay").forEach((overlay) => {
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay && !["authModal", "syncChoiceModal"].includes(overlay.id)) {
        hideModal(overlay.id);
      }
    });
  });

  document.addEventListener("keydown", handleKeyboard);
  window.addEventListener("resize", debounce(() => {
    renderCurrentChart();
    if (state.activeTab === "array3d") renderRecordDetail();
  }, 120));
  window.addEventListener("online", () => {
    updateNetworkStatus();
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
    if (open?.id === "authModal") exitAuthToBrowse();
    else if (open?.id === "syncChoiceModal") exitSyncChoice();
    else if (open) hideModal(open.id);
    return;
  }
  if (event.key === "Enter" && !$("authModal").classList.contains("hidden")) {
    if (state.authMode === "register") registerAndContinue();
    else loginAndContinue();
    return;
  }
  if (event.key !== "Enter" || $("wizard").classList.contains("hidden")) return;
  if (document.activeElement === $("newBrandInput")) addBrand();
  if (document.activeElement === $("newModelInput")) addModel();
  if (document.activeElement === $("dialInput")) goWizardStep(3);
}

function closeActionMenu() {
  document.querySelector(".action-menu")?.removeAttribute("open");
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
    renderRecordDetail();
  }
  if (name === "community") renderCommunity();
  if (name === "syncLog") {
    renderSyncLog();
    refreshSyncQueue({ quiet: true });
  }
  if (name === "current") renderCurrent();
}

function renderAll() {
  updateActiveUser();
  renderCurrent();
  refreshHistoryFilters();
  renderHistory();
  renderRecordDetail();
  refreshCommunityFilters();
  renderCommunity();
  updateCommunitySummary();
  renderSyncLog();
}

function updateActiveUser() {
  const active = state.identityConfirmed && !state.browsingOnly && !state.store.user.temporary;
  const label = active
    ? `${state.store.user.name} · ${state.store.user.id}`
    : "尚未登录 · 仅浏览";
  $("activeUserText").textContent = label;
}

function updateNetworkStatus(message = "") {
  const online = navigator.onLine;
  $("networkDot").className = `status-dot ${online ? "online" : "offline"}`;
  $("networkText").textContent = message || (online
    ? (Cloud?.isSignedIn() ? "本地优先 · Supabase 已连接" : "本地优先 · 登录后同步")
    : "离线模式 · 本地记录功能正常");
  clearTimeout(updateNetworkStatus.hideTimer);
  if (message && /(?:完成|成功|一致|已同步)/.test(message)) {
    updateNetworkStatus.hideTimer = setTimeout(() => updateNetworkStatus(), 3200);
  }
}

function setCloudSyncIndicator(status = "") {
  const dot = $("menuSyncDot");
  if (!dot) return;
  dot.hidden = !status;
  dot.className = `menu-sync-dot ${status}`.trim();
  dot.setAttribute("aria-label", status === "success"
    ? "云端同步成功"
    : status === "failed" ? "云端同步失败" : "正在同步到云端");
}

function isCloudVerified(record) {
  const item = state.store.cloudSync?.[record.id];
  return Boolean(item?.status === "verified" && item.recordUpdatedAt === record.updatedAt);
}

function markCloudSync(record, status, detail = {}) {
  state.store.cloudSync ||= {};
  state.store.cloudSync[record.id] = {
    status,
    recordUpdatedAt: record.updatedAt,
    checkedAt: new Date().toISOString(),
    ...detail
  };
  saveStore();
  renderHistory();
}

async function pushAndVerifyRecord(record) {
  markCloudSync(record, "uploading");
  const measurementId = await Cloud.pushRecord(record, deviceInstanceId());
  const verified = await Cloud.verifyRecord(record);
  markCloudSync(record, "verified", {
    measurementId: verified.measurementId || measurementId,
    verifiedAt: verified.verifiedAt
  });
  return verified;
}

async function uploadAllRecordsToCloud() {
  if (!Cloud?.isSignedIn()) {
    openAuthModal();
    toast("请先登录云端账户，再上传本地数据。", "error");
    return false;
  }
  if (!navigator.onLine) {
    setCloudSyncIndicator("failed");
    toast("当前离线，无法上传到服务器。", "error");
    return false;
  }
  // This is an explicit, user-initiated backup of the records held by this
  // browser. Older records may still carry a local/legacy profile ID, so
  // filtering by the newly authenticated handle incorrectly hides them.
  // Supabase ownership is always taken from the authenticated JWT in
  // Cloud.pushRecord; the legacy display ID never controls database access.
  const localRecords = [...state.store.records];
  if (!localRecords.length) {
    toast("当前浏览器没有可上传的本地记录。", "error");
    return false;
  }
  setCloudSyncIndicator("syncing");
  updateNetworkStatus(`正在上传并校验 ${localRecords.length} 条本地记录…`);
  try {
    for (const record of localRecords) await pushAndVerifyRecord(record);
    setCloudSyncIndicator("success");
    updateNetworkStatus(`云端校验完成 · ${localRecords.length} 条记录与本地一致`);
    toast(`上传成功：${localRecords.length} 条服务器记录已回读并确认与本地一致。`, "success");
    renderAll();
    return true;
  } catch (error) {
    const uploading = localRecords.find((record) => state.store.cloudSync?.[record.id]?.status === "uploading");
    if (uploading) markCloudSync(uploading, "failed", { error: error.message });
    setCloudSyncIndicator("failed");
    updateNetworkStatus(`上传或云端校验失败，本地数据未受影响：${error.message}`);
    toast(`上传失败：${error.message}`, "error");
    return false;
  }
}

function isValidUserId(value) {
  return /^[a-z0-9][a-z0-9_-]{1,47}$/.test(String(value || ""));
}

function isTemporaryUserId(value) {
  return /^(?:local|user)-[a-z0-9]{4,12}$/.test(String(value || ""));
}

function onlineUsers() {
  const users = state.communityMeta?.users;
  return users && typeof users === "object" ? users : {};
}

function prepareAuthModal() {
  $("knownUserIds").innerHTML = "";
  $("rememberLoginInput").checked = state.store.settings.rememberLogin !== false;
  updateAuthNetworkStatus();
  updateLoginHint();
  updateRegistrationAvailability();
}

function openAuthModal() {
  clearTimeout(state.nextRoundTimer);
  state.nextRoundTimer = null;
  prepareAuthModal();
  setAuthMode((state.store.activeUserId || Object.keys(state.store.profiles || {}).length) ? "login" : "register");
  showModal("authModal");
  setTimeout(() => {
    const target = state.authMode === "register" ? $("registerEmail") : $("loginUserId");
    target?.focus();
  }, 40);
}

function setAuthMode(mode) {
  state.authMode = mode === "register" ? "register" : "login";
  const register = state.authMode === "register";
  $("authLoginPanel").hidden = register;
  $("authRegisterPanel").hidden = !register;
  $("authLoginTab").classList.toggle("active", !register);
  $("authRegisterTab").classList.toggle("active", register);
  $("authLoginTab").setAttribute("aria-selected", String(!register));
  $("authRegisterTab").setAttribute("aria-selected", String(register));
  if (register) updateRegistrationAvailability();
}

function updateAuthNetworkStatus() {
  const box = $("authNetworkStatus");
  const dot = box.querySelector(".status-dot");
  const text = box.querySelector("span:last-child");
  dot.className = `status-dot ${navigator.onLine ? "online" : "offline"}`;
  text.textContent = navigator.onLine
    ? "Supabase 安全连接可用；业务表已启用 RLS 用户隔离。"
    : "当前离线；可继续使用本地数据，联网后再登录同步。";
}

function updateLoginHint() {
  const email = $("loginUserId").value.trim();
  const hint = $("loginUserHint");
  hint.textContent = email
    ? "将通过 Supabase Auth 验证；密码不会写入本地数据或 GitHub。"
    : "请输入注册邮箱。";
}

async function loginAndContinue() {
  const email = $("loginUserId").value.trim();
  const password = $("loginPassword").value;
  if (!email || password.length < 8 || !navigator.onLine) {
    toast("请输入有效邮箱和至少 8 位密码，并确认网络可用。", "error");
    return;
  }
  const button = $("loginContinueBtn");
  button.disabled = true;
  try {
    await Cloud.signIn(email, password);
    const profile = await Cloud.profile();
    if (!profile?.handle) throw new Error("账户档案缺少用户 ID，请重新注册或联系管理员");
    activateProfile({ id: profile.handle, name: profile.display_name || profile.handle }, $("rememberLoginInput").checked);
    hideModal("authModal");
    $("loginPassword").value = "";
    await syncCloudRecords({ quiet: true });
    toast("云端登录成功，本地与云端记录已核对。", "success");
  } catch (error) {
    toast(`登录失败：${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

function updateRegistrationAvailability() {
  const id = Core.normalizeUserId($("registerUserId").value);
  const status = $("registerIdStatus");
  const button = $("registerContinueBtn");
  status.className = "field-help uniqueness";
  button.disabled = true;
  if (!isValidUserId(id) || isTemporaryUserId(id)) {
    status.textContent = "ID 需为 2–48 位小写字母、数字、_ 或 -，并以字母或数字开头。";
    if (id) status.classList.add("error");
    return;
  }
  if (state.store.profiles?.[id]) {
    status.textContent = "该 ID 本机曾使用；云端仍会执行唯一性校验。";
  }
  const email = $("registerEmail").value.trim();
  const password = $("registerPassword").value;
  if (!email || !email.includes("@") || password.length < 8) {
    status.textContent = "还需填写有效邮箱和至少 8 位密码。";
    return;
  }
  status.textContent = `ID “${id}” 格式有效，提交时进行云端判重。`;
  status.classList.add("ok");
  button.disabled = false;
}

async function registerAndContinue() {
  updateRegistrationAvailability();
  if ($("registerContinueBtn").disabled) return;
  const id = Core.normalizeUserId($("registerUserId").value);
  const name = Core.cleanText($("registerUserName").value || id, 60);
  const email = $("registerEmail").value.trim();
  const password = $("registerPassword").value;
  const button = $("registerContinueBtn");
  button.disabled = true;
  try {
    const result = await Cloud.signUp(email, password, id, name);
    $("registerPassword").value = "";
    if (!result?.access_token) {
      setAuthMode("login");
      $("loginUserId").value = email;
      hideModal("authModal");
      toast("注册已提交，请先完成邮箱验证，再使用邮箱和密码登录。", "success");
      return;
    }
    activateProfile({ id, name, pendingRegistration: false }, true);
    hideModal("authModal");
    await syncCloudRecords({ quiet: true });
    toast("云端账户已注册并登录。", "success");
  } catch (error) {
    toast(`注册失败：${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

function activateProfile(profile, remember = true) {
  const now = new Date().toISOString();
  const id = Core.normalizeUserId(profile.id);
  const normalized = {
    id,
    name: Core.cleanText(profile.name || id, 60),
    createdAt: state.store.profiles?.[id]?.createdAt || now,
    lastLoginAt: now,
    pendingRegistration: Boolean(profile.pendingRegistration)
  };
  if (remember) state.store.profiles[id] = normalized;
  else delete state.store.profiles[id];
  state.store.user = { id, name: normalized.name, temporary: false };
  state.store.activeUserId = remember ? id : "";
  state.store.settings.rememberLogin = remember;
  state.identityConfirmed = true;
  state.browsingOnly = false;
  saveStore();
  updateActiveUser();
}

function exitAuthToBrowse() {
  state.identityConfirmed = false;
  state.browsingOnly = true;
  hideModal("authModal");
  updateActiveUser();
  toast("已退出登录流程；可以浏览和下载公开数据。", "success");
}

function deviceInstanceId() {
  const key = "grindPsdDeviceInstanceV1";
  let value = localStorage.getItem(key);
  if (!/^[0-9a-f-]{36}$/i.test(value || "")) {
    value = crypto.randomUUID();
    localStorage.setItem(key, value);
  }
  return value;
}

async function syncCloudRecords({ quiet = false } = {}) {
  if (!Cloud?.isSignedIn() || !navigator.onLine) return false;
  try {
    updateNetworkStatus("正在核对本地与 Supabase 记录…");
    const remote = (await Cloud.pullRecords()).map(Core.normalizeRecord).filter(Boolean);
    const merged = new Map();
    [...remote, ...state.store.records].forEach((record) => {
      const current = merged.get(record.id);
      if (!current || String(record.updatedAt || record.createdAt) >= String(current.updatedAt || current.createdAt)) {
        merged.set(record.id, record);
      }
    });
    state.store.records = dedupeRecords([...merged.values()]);
    const owned = state.store.records.filter((record) => record.user?.id === state.store.user.id);
    setCloudSyncIndicator("syncing");
    for (const record of owned) await pushAndVerifyRecord(record);
    saveStore();
    renderAll();
    updateNetworkStatus(`Supabase 同步完成 · ${owned.length} 条个人记录`);
    setCloudSyncIndicator("success");
    if (!quiet) toast(`已同步 ${owned.length} 条记录。`, "success");
    return true;
  } catch (error) {
    setCloudSyncIndicator("failed");
    updateNetworkStatus(`云端同步失败，本地记录安全：${error.message}`);
    if (!quiet) toast(`云端同步失败：${error.message}`, "error");
    return false;
  }
}

function startMeasurementFlow() {
  switchTab("measure");
  if (!state.identityConfirmed || state.browsingOnly || state.store.user.temporary) {
    openAuthModal();
    toast("开始测量前请先登录或注册用户 ID。", "error");
    return;
  }
  openWizard({ preferRecent: true });
}

function prepareMeasurementPage() {
  const wizard = $("wizard");
  const workspace = $("measurementWorkspace");
  if (!wizard || !workspace) return;
  workspace.appendChild(wizard);
  wizard.classList.remove("overlay");
  wizard.setAttribute("role", "region");
  wizard.removeAttribute("aria-modal");
}

function showMeasurementWorkspace() {
  $("measurementHome").classList.add("is-active");
  $("wizard").classList.remove("hidden");
  requestAnimationFrame(() => $("wizard").scrollIntoView({ behavior: "smooth", block: "start" }));
}

function resetMeasurementPage() {
  $("wizard").classList.add("hidden");
  $("measurementHome").classList.remove("is-active");
}

function getTemporaryRecords() {
  return state.store.records.filter((record) => isTemporaryUserId(record.user?.id));
}

function getUnsyncedRecords({ includeTemporary = false } = {}) {
  const remoteIds = new Set(state.communityRecords.map((record) => record.id));
  const pendingIds = new Set(state.store.syncQueue
    .filter((item) => ["authorizing", "processing"].includes(item.status))
    .flatMap((item) => item.recordIds));
  return state.store.records.filter((record) => {
    const mine = record.user?.id === state.store.user.id;
    const temporary = includeTemporary && isTemporaryUserId(record.user?.id);
    return (mine || temporary) && !remoteIds.has(record.id) && !pendingIds.has(record.id);
  });
}

function openSyncChoice() {
  $("syncChoiceUserLabel").textContent = `${state.store.user.name} (${state.store.user.id})`;
  $("sessionSyncInput").checked = Boolean(state.store.settings.autoSync);
  $("claimLocalInput").checked = getTemporaryRecords().length > 0;
  $("uploadLocalInput").checked = false;
  $("sessionAutoUploadInput").checked = Boolean(state.store.settings.autoUpload);
  $("syncLicenseInput").checked = Boolean(state.store.settings.licenseAcceptedAt);
  updateSyncChoiceSummary();
  showModal("syncChoiceModal");
}

function updateSyncChoiceSummary() {
  const temporaryCount = getTemporaryRecords().length;
  $("claimLocalRow").hidden = temporaryCount === 0;
  $("claimLocalTitle").textContent = `将 ${temporaryCount} 条本机临时记录归入当前 ID`;
  $("claimLocalHint").textContent = `只改动以 local-/user- 开头的临时记录，不会改动其他正式用户的数据。`;
  const includeTemporary = temporaryCount > 0 && $("claimLocalInput").checked;
  const unsynced = getUnsyncedRecords({ includeTemporary });
  $("uploadLocalRow").hidden = unsynced.length === 0;
  $("uploadLocalTitle").textContent = `上传 ${unsynced.length} 条未同步的本地记录`;
  const needsLicense = $("sessionAutoUploadInput").checked
    || (!$("uploadLocalRow").hidden && $("uploadLocalInput").checked);
  $("syncLicenseRow").hidden = !needsLicense || Boolean(state.store.settings.licenseAcceptedAt);
  const pieces = [
    $("sessionSyncInput").checked ? "本次同步在线库" : "本次仅用本地库",
    includeTemporary ? `归入 ${temporaryCount} 条临时记录` : "",
    $("uploadLocalInput").checked && unsynced.length ? `准备上传 ${Math.min(unsynced.length, MAX_BATCH_RECORDS)} 条` : "",
    $("sessionAutoUploadInput").checked ? "以后保存后自动上传" : ""
  ].filter(Boolean);
  $("syncChoiceMessage").className = "validation-message";
  if (needsLicense && !state.store.settings.licenseAcceptedAt && !$("syncLicenseInput").checked) {
    $("syncChoiceMessage").classList.add("error");
    pieces.push("请先确认公开数据许可");
  }
  $("syncChoiceMessage").textContent = pieces.join(" · ");
}

function reassignTemporaryRecords() {
  const now = new Date().toISOString();
  state.store.records = state.store.records.map((record) => {
    if (!isTemporaryUserId(record.user?.id)) return record;
    return {
      ...record,
      user: { id: state.store.user.id, name: state.store.user.name },
      updatedAt: now,
      source: "local-claimed"
    };
  });
}

async function continueFromSyncChoice() {
  state.store.settings.autoSync = $("sessionSyncInput").checked;
  const wantsUpload = !$("uploadLocalRow").hidden && $("uploadLocalInput").checked;
  const wantsAutoUpload = $("sessionAutoUploadInput").checked;
  if ((wantsUpload || wantsAutoUpload)
    && !state.store.settings.licenseAcceptedAt
    && !$("syncLicenseInput").checked) {
    updateSyncChoiceSummary();
    toast("自动上传前必须确认 CC BY 4.0 数据许可。", "error");
    return;
  }
  if ($("syncLicenseInput").checked && !state.store.settings.licenseAcceptedAt) {
    state.store.settings.licenseAcceptedAt = new Date().toISOString();
  }
  state.store.settings.autoUpload = wantsAutoUpload;
  if (!$("claimLocalRow").hidden && $("claimLocalInput").checked) {
    reassignTemporaryRecords();
  }
  saveStore();
  const unsynced = getUnsyncedRecords();
  if (wantsUpload && unsynced.length) {
    const submitted = await uploadRecordBatch(unsynced.slice(0, MAX_BATCH_RECORDS));
    if (!submitted) queueLocalRecords(unsynced, "等待 GitHub 连接后重试");
  }
  if ($("sessionSyncInput").checked && navigator.onLine) {
    syncCommunity({ quiet: true });
  }
  hideModal("syncChoiceModal");
  renderAll();
  openWizard({ preferRecent: true });
}

function exitSyncChoice() {
  state.store.settings.autoSync = $("sessionSyncInput").checked;
  state.store.settings.autoUpload = $("sessionAutoUploadInput").checked
    && Boolean(state.store.settings.licenseAcceptedAt);
  saveStore();
  hideModal("syncChoiceModal");
  renderAll();
  toast("已退出启动流程；点击“开始测量”可随时继续。", "success");
}

function openSettings() {
  if (!state.identityConfirmed || state.store.user.temporary) {
    openAuthModal();
    return;
  }
  $("settingsUserId").value = state.store.user.id;
  $("settingsUserName").value = state.store.user.name;
  showModal("settingsModal");
}

function saveSettings() {
  const id = state.store.user.id;
  const name = Core.cleanText($("settingsUserName").value || id, 60);
  const previousName = state.store.user.name;
  state.store.user = { id, name, temporary: false };
  if (state.store.profiles[id]) state.store.profiles[id].name = name;
  state.store.settings.autoSync = false;
  state.store.settings.autoUpload = false;
  if (previousName !== name) {
    state.store.records = state.store.records.map((record) => {
      if (record.user.id !== id) return record;
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
  const recent = isLastGrinderRecent();
  if ((options.useLast || options.preferRecent) && recent) {
    Object.assign(state.wizard, state.store.lastGrinder);
  } else if (state.store.lastGrinder) {
    state.wizard.color = state.store.lastGrinder.color || PALETTE[0];
  }
  if (options.prefill) Object.assign(state.wizard, options.prefill);
  if (state.wizard.mode !== "edit-remote") state.wizard.doseG = null;
  $("wizardTitle").textContent = state.wizard.mode === "edit-remote"
    ? "编辑自己的社区记录"
    : "选择或注册研磨设备";
  $("wizardUserLabel").textContent = `${state.store.user.name} (${state.store.user.id})`;
  $("sameAsLastBtn").hidden = !recent || state.wizard.mode === "edit-remote";
  if (recent) {
    $("sameAsLastBtn").textContent = `⚡ 继续 ${state.store.lastGrinder.brand} ${state.store.lastGrinder.model}`;
  }
  clearWizardFields();
  renderWizardStep1();
  goWizardStep(options.useLast || state.wizard.mode === "edit-remote" ? 2 : 1);
  showMeasurementWorkspace();
}

function isLastGrinderRecent() {
  const timestamp = Date.parse(state.store.lastMeasurementAt || state.store.lastGrinder?.measuredAt || "");
  return Boolean(state.store.lastGrinder && Number.isFinite(timestamp) && Date.now() - timestamp <= RECENT_GRINDER_WINDOW_MS);
}

function exitMeasurementFlow() {
  clearTimeout(state.nextRoundTimer);
  state.nextRoundTimer = null;
  resetMeasurementPage();
  toast("已退出本轮测量，现有记录不会受影响。", "success");
}

function clearWizardFields() {
  $("newBrandInput").value = "";
  $("newModelInput").value = "";
  $("dialInput").value = "";
  $("turnsInput").value = "";
  $("dialOrderInput").value = "";
  $("doseInput").value = "";
  $("beanInput").value = "";
  $("roastInput").value = "";
  $("durationInput").value = "60";
  $("deviceInput").value = "Grind-PSD 五筛六分段筛具";
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
  if (!isLastGrinderRecent()) return;
  state.wizard = {
    ...freshWizard(),
    ...state.store.lastGrinder,
    doseG: null,
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
  $("turnsInput").value = state.wizard.settingTurns === null || state.wizard.settingTurns === undefined
    ? ""
    : formatPlainNumber(state.wizard.settingTurns, 2);
  $("dialOrderInput").value = state.wizard.settingOrder ?? "";
  $("beanInput").value = state.wizard.bean || "";
  $("roastInput").value = state.wizard.roastLevel || "";
  $("durationInput").value = state.wizard.durationSec || 60;
  $("deviceInput").value = state.wizard.sieveDevice || "Grind-PSD 五筛六分段筛具";
  $("methodInput").value = state.wizard.method || "手动水平往复筛分";
  $("replicateInput").value = state.wizard.replicate || 1;
  $("notesInput").value = state.wizard.notes || "";
  renderSieveConfigRows();

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

function renderSieveConfigRows() {
  const rows = state.wizard.sieveProfile.bins.filter((bin) => Number.isFinite(Number(bin.apertureUm)));
  $("sieveConfigRows").innerHTML = rows.map((bin, index) => `
    <div class="addrow sieve-config-row">
      <label>目数<input type="number" min="1" step="1" value="${bin.mesh ?? ""}" data-sieve-mesh="${index}" placeholder="自定义"></label>
      <label>孔径 μm<input type="number" min="1" step="1" value="${bin.apertureUm}" data-sieve-aperture="${index}"></label>
      <button class="ghost small" type="button" data-remove-sieve="${index}" ${rows.length <= 1 ? "disabled" : ""}>删除</button>
    </div>`).join("");
  $("sieveConfigRows").querySelectorAll("[data-remove-sieve]").forEach((button) => {
    button.addEventListener("click", () => {
      const current = readSieveConfigRows();
      current.splice(Number(button.dataset.removeSieve), 1);
      state.wizard.sieveProfile = Core.createSieveProfile(current);
      renderSieveConfigRows();
    });
  });
}

function readSieveConfigRows() {
  return [...$("sieveConfigRows").querySelectorAll(".sieve-config-row")].map((row) => ({
    mesh: row.querySelector("[data-sieve-mesh]").value,
    apertureUm: row.querySelector("[data-sieve-aperture]").value
  })).filter((row) => Number(row.apertureUm) > 0);
}

function readWizardStep2() {
  const setting = Core.cleanText($("dialInput").value, 80);
  if (!setting) {
    toast("请填写研磨刻度。", "error");
    $("dialInput").focus();
    return false;
  }
  const turnsText = $("turnsInput").value.trim();
  const settingTurns = turnsText === "" ? null : Number(turnsText);
  if (settingTurns !== null && (!Number.isFinite(settingTurns) || settingTurns < 0)) {
    toast("研磨圈数必须是大于或等于 0 的数字，或留空。", "error");
    $("turnsInput").focus();
    return false;
  }
  const orderText = $("dialOrderInput").value.trim();
  state.wizard.setting = setting;
  state.wizard.settingTurns = settingTurns === null ? null : Core.round(settingTurns, 3);
  state.wizard.settingOrder = orderText === "" ? Core.deriveSettingOrder(setting) : Number(orderText);
  state.wizard.bean = Core.cleanText($("beanInput").value, 120);
  state.wizard.roastLevel = Core.cleanText($("roastInput").value, 40);
  state.wizard.durationSec = Core.toNumber($("durationInput").value);
  state.wizard.sieveDevice = Core.cleanText($("deviceInput").value, 80);
  state.wizard.method = Core.cleanText($("methodInput").value, 120);
  state.wizard.replicate = Math.max(1, Math.trunc(Core.toNumber($("replicateInput").value) || 1));
  state.wizard.notes = Core.cleanText($("notesInput").value, 500);
  const sieveRows = readSieveConfigRows();
  if (!sieveRows.length) {
    toast("请至少保留一张筛网并填写孔径。", "error");
    return false;
  }
  const apertureValues = sieveRows.map((row) => Number(row.apertureUm));
  if (new Set(apertureValues).size !== apertureValues.length) {
    toast("筛网孔径不能重复。", "error");
    return false;
  }
  state.wizard.sieveProfile = Core.createSieveProfile(sieveRows);
  state.wizard.weightsGrams = Core.normalizeWeights(
    state.wizard.weightsGrams,
    state.wizard.sieveProfile.bins
  );
  buildWeighRows();
  return true;
}

function captureWeighingStep() {
  const doseText = $("doseInput").value.trim();
  state.wizard.doseG = doseText === "" ? null : Core.toNumber(doseText);
  state.wizard.weightsGrams = readWeightInputs();
}

function returnFromWeighingStep() {
  captureWeighingStep();
  goWizardStep(2);
}

function buildWeighRows() {
  const sieves = state.wizard?.sieveProfile?.bins || Core.SIEVES;
  $("weighRows").innerHTML = sieves.map((sieve) => `
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
  $("doseInput").value = state.wizard.doseG === null || state.wizard.doseG === undefined
    ? ""
    : formatPlainNumber(state.wizard.doseG, 2);
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
  const sieves = state.wizard?.sieveProfile?.bins || Core.SIEVES;
  return Core.normalizeWeights(weights, sieves);
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

async function saveWizardRecord() {
  captureWeighingStep();
  if (!(state.wizard.doseG > 0)) {
    toast("请填写大于 0 的豆子初始质量。", "error");
    $("doseInput").focus();
    return;
  }
  const total = Core.round(Core.sum(Object.values(state.wizard.weightsGrams)), 2);
  if (total <= 0) {
    toast("请至少填写一个筛层的重量。", "error");
    return;
  }

  const record = Core.createRecord({
    id: state.wizard.targetRecordId || undefined,
    user: state.store.user,
    grinder: {
      brand: state.wizard.brand,
      model: state.wizard.model,
      setting: state.wizard.setting,
      settingTurns: state.wizard.settingTurns,
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
    sieveProfile: state.wizard.sieveProfile,
    notes: state.wizard.notes,
    license: state.wizard.mode === "edit-remote" ? Core.DATA_LICENSE : null,
    source: state.wizard.mode === "edit-remote" ? "local-remote-edit" : "local",
    createdAt: state.wizard.createdAt || undefined,
    updatedAt: new Date().toISOString()
  });

  const catalog = ensureCatalogEntry(state.store, record.grinder.brand, record.grinder.model, record.grinder.color);
  catalog.color = record.grinder.color;
  state.store.records = dedupeRecords([
    record,
    ...state.store.records.filter((item) => item.id !== record.id)
  ]);
  const measuredAt = new Date().toISOString();
  state.store.lastGrinder = {
    brand: record.grinder.brand,
    model: record.grinder.model,
    color: record.grinder.color,
    setting: record.grinder.setting,
    settingTurns: record.grinder.settingTurns,
    settingOrder: record.grinder.settingOrder,
    bean: record.sample.bean,
    roastLevel: record.sample.roastLevel,
    durationSec: record.sample.durationSec,
    sieveDevice: record.sample.sieveDevice,
    method: record.sample.method,
    replicate: record.sample.replicate,
    notes: "",
    measuredAt
  };
  state.store.lastMeasurementAt = measuredAt;
  state.selectedRecordId = record.id;
  state.selectedRecordSource = "local";
  saveStore();
  if (Cloud?.isSignedIn() && navigator.onLine) {
    setCloudSyncIndicator("syncing");
    pushAndVerifyRecord(record)
      .then(() => {
        setCloudSyncIndicator("success");
        updateNetworkStatus("记录已保存到本机，且云端回读校验一致");
        toast("云端上传成功，服务器数据与本地一致。", "success");
      })
      .catch((error) => {
        markCloudSync(record, "failed", { error: error.message });
        setCloudSyncIndicator("failed");
        updateNetworkStatus(`已保存本机；云端上传或校验失败：${error.message}`);
      });
  }
  resetMeasurementPage();
  renderAll();
  switchTab("measure");
  toast("记录已自动保存在本机，可继续开始下一次称测。", "success");
  clearTimeout(state.nextRoundTimer);
  state.nextRoundTimer = null;
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
          <span>点击“＋ 开始测量”，按设备 → 刻度 → 六分段称重流程开始。</span>
        </div>
      </div>`;
    return;
  }

  const sourceLabel = state.selectedRecordSource === "community" ? "社区记录" : "本地记录";
  container.innerHTML = `
    ${renderRecordSummaryPanel(record, sourceLabel, { actions: true })}
    <div class="panel">
      <div class="chart-toolbar">
        <h2>粉径分布柱状图 <span class="hint">${escapeHtml(record.grinder.brand)} ${escapeHtml(record.grinder.model)} · 刻度 ${escapeHtml(record.grinder.setting)}</span></h2>
        <select id="currentChartUnit" aria-label="当前图表单位">
          <option value="g">重量 g</option>
          <option value="pct">占比 %</option>
        </select>
      </div>
      <div class="canvas-scroll"><canvas id="canvasBar" aria-label="当前记录粒径分布柱状图"></canvas></div>
    </div>`;

  bindRecordSummaryActions(container, record);
  $("currentChartUnit").addEventListener("change", renderCurrentChart);
  renderCurrentChart();
}

function renderRecordSummaryPanel(record, sourceLabel, { actions = false } = {}) {
  const quality = record.metrics.quality;
  const color = Core.normalizeHexColor(record.grinder.color);
  const rows = Core.getRecordSieves(record).map((sieve) => {
    const weight = record.weightsGrams[sieve.key] || 0;
    const pct = record.totalG ? weight / record.totalG * 100 : 0;
    const legacyBin = sieve.key === "pan80_lt300_g" && record.sieveProfile?.legacy;
    const sieveName = legacyBin ? "低于 60 目" : sieve.label;
    return `
      <tr>
        <td><strong>${escapeHtml(sieveName)}</strong>${legacyBin ? '<small class="legacy-bin-note">旧五段，未拆分</small>' : ""}</td>
        <td>${escapeHtml(sieve.range)}</td>
        <td class="num">${formatNumber(weight, 2)}</td>
        <td class="num">${formatNumber(pct, 2)}%</td>
        <td class="bar-cell"><div class="mini-bar" style="width:${Math.max(1.5, Math.min(100, pct))}%;background:${color}"></div></td>
      </tr>`;
  }).join("");

  return `
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
            ${record.grinder.settingTurns === null || record.grinder.settingTurns === undefined
              ? ""
              : `<span class="badge">研磨圈数 ${formatNumber(record.grinder.settingTurns, 2)}</span>`}
            <span class="badge">用户 ${escapeHtml(record.user.id)}</span>
            <span class="badge">${escapeHtml(sourceLabel)}</span>
            <span class="badge">${escapeHtml(formatDateTime(record.createdAt))}</span>
          </div>
        </div>
        ${actions ? `<div class="panel-actions">
          <button class="ghost small" type="button" data-record-summary-action="export">导出本条 JSON</button>
          <button class="ghost small" type="button" data-record-summary-action="print">打印</button>
        </div>` : ""}
      </div>
      <table class="current-summary-table">
        <colgroup><col><col><col><col><col></colgroup>
        <thead><tr><th>筛分档</th><th>标称粒径区间</th><th class="num">重量 g</th><th class="num">占比</th><th>分布</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="metrics-grid">
        ${metricCard("豆子初始质量", `${formatNumber(record.sample.doseG, 2)} g`)}
        ${metricCard("回收总质量", `${formatNumber(record.totalG, 2)} g`)}
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
    </div>`;
}

function bindRecordSummaryActions(container, record) {
  container.querySelectorAll("[data-record-summary-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.recordSummaryAction;
      if (action === "export") exportSingleRecord(record);
      if (action === "print") window.print();
    });
  });
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
  const brandSelect = $("historyBrandFilter");
  const modelSelect = $("historyModelFilter");
  const currentBrand = brandSelect.value;
  const currentModel = modelSelect.value;
  const brands = unique(state.store.records.map((record) => record.grinder.brand))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  brandSelect.innerHTML = '<option value="">全部品牌</option>' +
    brands.map((brand) => `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`).join("");
  if (brands.includes(currentBrand)) brandSelect.value = currentBrand;
  const models = unique(state.store.records
    .filter((record) => !brandSelect.value || record.grinder.brand === brandSelect.value)
    .map((record) => record.grinder.model))
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  modelSelect.innerHTML = '<option value="">全部型号</option>' +
    models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join("");
  if (models.includes(currentModel)) modelSelect.value = currentModel;
}

function getFilteredHistoryRecords() {
  const query = $("historySearch").value.trim().toLowerCase();
  const brand = $("historyBrandFilter").value;
  const model = $("historyModelFilter").value;
  const grade = $("historyGradeFilter").value;
  const dateFrom = $("historyDateFrom").value;
  const dateTo = $("historyDateTo").value;
  const sort = $("historySort").value;
  const qualityRank = { A: 5, B: 4, C: 3, D: 2, U: 1 };
  return state.store.records.filter((record) => {
    if (brand && record.grinder.brand !== brand) return false;
    if (model && record.grinder.model !== model) return false;
    if (grade && record.metrics.quality.grade !== grade) return false;
    const day = String(record.createdAt || "").slice(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    if (!query) return true;
    return searchableRecordText(record).includes(query);
  }).sort((a, b) => {
    if (sort === "date-asc") return String(a.createdAt).localeCompare(String(b.createdAt));
    if (sort === "brand-asc") return `${a.grinder.brand} ${a.grinder.model} ${a.createdAt}`.localeCompare(
      `${b.grinder.brand} ${b.grinder.model} ${b.createdAt}`, "zh-CN", { numeric: true }
    );
    if (sort === "quality-desc" || sort === "quality-asc") {
      const delta = (qualityRank[b.metrics.quality.grade] || 0) - (qualityRank[a.metrics.quality.grade] || 0);
      return sort === "quality-desc" ? delta : -delta;
    }
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

function grinderFilterKey(brand, model) {
  return [brand, model].map((part) => encodeURIComponent(String(part || ""))).join("::");
}

function renderHistory() {
  const container = $("historyContent");
  state.selectedHistoryIds = new Set([...state.selectedHistoryIds]
    .filter((id) => state.store.records.some((record) => record.id === id)));
  const records = getFilteredHistoryRecords();
  if (!records.length) {
    container.innerHTML = '<div class="empty">没有符合条件的本地记录。</div>';
    updateHistorySelectionStatus();
    return;
  }
  container.innerHTML = recordTable(records, { community: false, selectable: true });
  bindRecordTableActions(container, false);
  bindHistorySelection(container);
  updateHistorySelectionStatus();
}

function recordTable(records, options = {}) {
  if (options.selectable && !options.community) {
    return `<div class="history-record-list">${records.map((record) => `
      <details class="history-record" data-history-details>
        <summary>
          <input type="checkbox" data-history-select="${escapeHtml(record.id)}" ${state.selectedHistoryIds.has(record.id) ? "checked" : ""} aria-label="选择记录">
          <span class="history-record-line">
            <time>${escapeHtml(formatDateTime(record.createdAt))}</time>
            <strong>${escapeHtml(record.grinder.model)}/${escapeHtml(record.grinder.setting)}</strong>
            <span>${escapeHtml(record.metrics.quality.gradeLabel || "未评级")}${isCloudVerified(record) ? '<i class="record-cloud-dot" title="已同步并通过云端一致性校验" aria-label="已同步到云端"></i>' : ""}</span>
          </span>
        </summary>
        <div class="history-record-detail">
          <div><span>品牌 / 型号</span><strong>${escapeHtml(record.grinder.brand)} ${escapeHtml(record.grinder.model)}</strong></div>
          <div><span>刻度</span><strong>${escapeHtml(record.grinder.setting)}</strong></div>
          <div><span>研磨圈数</span><strong>${record.grinder.settingTurns === null || record.grinder.settingTurns === undefined ? "—" : formatNumber(record.grinder.settingTurns, 2)}</strong></div>
          <div><span>回收总质量</span><strong>${formatNumber(record.totalG, 2)} g</strong></div>
          <div><span>极细粉</span><strong>${formatNumber(record.metrics.finesPct, 2)}%</strong></div>
          <div><span>可靠性</span>${qualityChip(record.metrics.quality)}</div>
          <div><span>样品</span><strong>${record.sample.bean ? escapeHtml(record.sample.bean) : "—"}</strong></div>
          <div class="history-detail-actions">
            <button type="button" data-view-record="${escapeHtml(record.id)}">查看</button>
            <button type="button" data-clone-record="${escapeHtml(record.id)}">复测</button>
            <button type="button" data-delete-record="${escapeHtml(record.id)}">删除</button>
          </div>
        </div>
      </details>`).join("")}</div>`;
  }
  return `
    <table class="record-table">
      <thead>
        <tr>
          ${options.community ? '<th class="select-cell"><input type="checkbox" data-select-all aria-label="全选筛选结果"></th>' : ""}
          ${options.selectable ? '<th class="select-cell">对比</th>' : ""}
          <th>用户</th><th>磨豆机</th><th>刻度</th><th class="num">回收总质量</th>
          <th class="num">极细粉</th><th>等级</th><th>样品</th><th>时间</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${records.map((record) => {
          const canManageCommunity = Boolean(
            options.community &&
            state.identityConfirmed &&
            record.user.id === state.store.user.id
          );
          return `
          <tr>
            ${options.community ? `<td class="select-cell"><input type="checkbox" data-community-select="${escapeHtml(record.id)}" ${state.selectedCommunityIds.has(record.id) ? "checked" : ""} aria-label="选择记录"></td>` : ""}
            ${options.selectable ? `<td class="select-cell" data-label="对比"><input type="checkbox" data-history-select="${escapeHtml(record.id)}" ${state.selectedHistoryIds.has(record.id) ? "checked" : ""} aria-label="选择记录"></td>` : ""}
            <td data-label="用户">${escapeHtml(record.user.id)}</td>
            <td data-label="设备"><span class="dot" style="background:${Core.normalizeHexColor(record.grinder.color)}"></span>${escapeHtml(record.grinder.brand)} ${escapeHtml(record.grinder.model)}</td>
            <td data-label="刻度">${escapeHtml(record.grinder.setting)}</td>
            <td data-label="回收总质量" class="num">${formatNumber(record.totalG, 2)} g</td>
            <td data-label="极细粉" class="num">${formatNumber(record.metrics.finesPct, 2)}%</td>
            <td data-label="等级">${qualityChip(record.metrics.quality)}</td>
            <td data-label="样品" class="wrap-cell">${record.sample.bean ? `<span class="truncate">${escapeHtml(record.sample.bean)}</span>` : "—"}</td>
            <td data-label="日期">${escapeHtml(formatDate(record.createdAt))}</td>
            <td data-label="操作">
              <div class="row-actions">
                <button type="button" data-view-record="${escapeHtml(record.id)}">查看</button>
                ${options.community
                  ? `<button type="button" data-import-record="${escapeHtml(record.id)}">导入</button>
                     <button type="button" data-user-download="${escapeHtml(record.user.id)}">用户库</button>
                     ${canManageCommunity
                       ? `<button type="button" data-edit-community="${escapeHtml(record.id)}">编辑</button>
                          <button class="danger-inline" type="button" data-delete-community="${escapeHtml(record.id)}">删除</button>`
                       : ""}`
                  : `<button type="button" data-clone-record="${escapeHtml(record.id)}">复测</button><button type="button" data-delete-record="${escapeHtml(record.id)}">删除</button>`}
              </div>
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

function bindHistorySelection(container) {
  container.querySelectorAll("[data-history-select]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = checkbox.dataset.historySelect;
      if (checkbox.checked && state.selectedHistoryIds.size >= MAX_COMPARE_RECORDS) {
        checkbox.checked = false;
        toast(`最多同时选择 ${MAX_COMPARE_RECORDS} 条测次。`, "error");
        return;
      }
      if (checkbox.checked) state.selectedHistoryIds.add(id);
      else state.selectedHistoryIds.delete(id);
      updateHistorySelectionStatus();
    });
  });
  container.querySelectorAll("[data-history-details]").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      container.querySelectorAll("[data-history-details][open]").forEach((other) => {
        if (other !== details) other.open = false;
      });
    });
    details.querySelector("summary input")?.addEventListener("click", (event) => event.stopPropagation());
  });
}

function updateHistorySelectionStatus() {
  const count = state.selectedHistoryIds.size;
  $("historySelectionStatus").textContent = `已选择 ${count} / ${MAX_COMPARE_RECORDS} 条`;
  $("compareHistorySelectionBtn").textContent = count > 1 ? "对比所选" : "查看详情";
  $("compareHistorySelectionBtn").disabled = count < 1;
}

function clearHistorySelection() {
  state.selectedHistoryIds.clear();
  renderHistory();
  renderMultiCompare();
}

function selectAllHistory() {
  const records = getFilteredHistoryRecords();
  state.selectedHistoryIds = new Set(records.slice(0, MAX_COMPARE_RECORDS).map((record) => record.id));
  renderHistory();
  renderMultiCompare();
  if (records.length > MAX_COMPARE_RECORDS) {
    toast(`对比最多支持 ${MAX_COMPARE_RECORDS} 条，已选择当前筛选结果的前 ${MAX_COMPARE_RECORDS} 条。`);
  }
}

function compareHistorySelection() {
  if (!state.selectedHistoryIds.size) {
    toast("请至少选择一条记录。", "error");
    return;
  }
  if (state.selectedHistoryIds.size === 1) {
    state.selectedRecordId = [...state.selectedHistoryIds][0];
    state.selectedRecordSource = "local";
  }
  switchTab("array3d");
}

function bindRecordTableActions(container, community) {
  container.querySelectorAll("[data-view-record]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedRecordId = button.dataset.viewRecord;
      state.selectedRecordSource = community ? "community" : "local";
      state.selectedHistoryIds = new Set([button.dataset.viewRecord]);
      renderRecordDetail();
      switchTab("array3d");
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
  container.querySelectorAll("[data-edit-community]").forEach((button) => {
    button.addEventListener("click", () => editOwnedCommunityRecord(button.dataset.editCommunity));
  });
  container.querySelectorAll("[data-delete-community]").forEach((button) => {
    button.addEventListener("click", () => requestDeleteCommunityRecord(button.dataset.deleteCommunity));
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
  if (!state.identityConfirmed || state.store.user.temporary) {
    openAuthModal();
    toast("复测前请先登录对应用户 ID。", "error");
    return;
  }
  const record = state.store.records.find((item) => item.id === id);
  if (!record) return;
  state.wizard = {
    ...freshWizard(),
    brand: record.grinder.brand,
    model: record.grinder.model,
    color: record.grinder.color,
    setting: record.grinder.setting,
    settingTurns: record.grinder.settingTurns,
    settingOrder: record.grinder.settingOrder,
    doseG: null,
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
  switchTab("measure");
  showMeasurementWorkspace();
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
  const overlay = $("sel3dOverlay");
  const current = select.value;
  const currentOverlay = overlay.value;
  const groups = groupRecords(getRecordsForScope($("sel3dScope").value));
  const options = groups.map((group) => `<option value="${escapeHtml(group.key)}">${escapeHtml(group.userId)} · ${escapeHtml(group.brand)} ${escapeHtml(group.model)} (${latestBySetting(group.records).length} 刻度)</option>`).join("");
  select.innerHTML = groups.length
    ? options
    : '<option value="">暂无可用记录</option>';
  if (groups.some((group) => group.key === current)) select.value = current;
  overlay.innerHTML = `<option value="">不叠加</option>${options}`;
  if (groups.some((group) => group.key === currentOverlay) && currentOverlay !== select.value) {
    overlay.value = currentOverlay;
  }
  [...overlay.options].forEach((option) => {
    option.disabled = Boolean(option.value) && option.value === select.value;
  });
  if (overlay.value === select.value) overlay.value = "";
}

function render3D() {
  const groups = groupRecords(getRecordsForScope($("sel3dScope").value));
  const primary = groups.find((item) => item.key === $("sel3dGrinder").value) || groups[0] || null;
  const overlay = groups.find((item) => item.key === $("sel3dOverlay").value) || null;
  if (primary && $("sel3dGrinder").value !== primary.key) $("sel3dGrinder").value = primary.key;
  [...$("sel3dOverlay").options].forEach((option) => {
    option.disabled = Boolean(option.value) && option.value === primary?.key;
  });
  if (overlay?.key === primary?.key) $("sel3dOverlay").value = "";
  const selected = [primary, overlay].filter((group, index, list) => {
    return group && list.findIndex((candidate) => candidate.key === group.key) === index;
  });
  drawArray3D($("canvas3d"), selected, $("sel3dUnit").value, $("note3d"));
}

function refreshCompareOptions() {
  // 多记录对比直接使用历史记录中的勾选集合，无需维护第二套双记录选择器。
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
  renderRecordDetail();
}

function renderRecordDetail() {
  const selectedLocalRecords = [...state.selectedHistoryIds]
    .map((id) => state.store.records.find((record) => record.id === id))
    .filter(Boolean)
    .slice(0, MAX_COMPARE_RECORDS);
  const isMulti = selectedLocalRecords.length > 1;
  $("singleRecordDetail").hidden = isMulti;
  $("multiRecordDetail").hidden = !isMulti;
  $("recordDetailTitle").textContent = isMulti
    ? `对比分析 · ${selectedLocalRecords.length} 条记录`
    : "记录详情";

  if (isMulti) {
    renderMultiCompare();
    return;
  }

  // An older cached v1.2 HTML shell may briefly run the current script during
  // a service-worker rollout. Support its former container ID so mixed assets
  // cannot abort the whole interface with null.innerHTML.
  const summaryContainer = $("singleRecordSummary") || $("singleRecordMeta");
  const chartTitle = $("singleRecordChartTitle");
  const record = selectedLocalRecords[0] || getSelectedRecord();
  if (!record) {
    if (summaryContainer) summaryContainer.innerHTML = "";
    if (chartTitle) chartTitle.textContent = "粉径分布柱状图";
    $("singleRecordNote").textContent = "暂无可查看的记录。请先完成称测，或从历史记录选择一条记录。";
    const { ctx, width, height } = setupCanvas($("canvasRecordDetail"));
    drawEmptyCanvas(ctx, width, height, "暂无记录");
    return;
  }
  state.selectedRecordId = record.id;
  state.selectedRecordSource = state.store.records.some((item) => item.id === record.id) ? "local" : "community";
  const sourceLabel = state.selectedRecordSource === "community" ? "社区记录" : "本地历史记录";
  if (summaryContainer) {
    summaryContainer.innerHTML = renderRecordSummaryPanel(record, sourceLabel, { actions: true });
    bindRecordSummaryActions(summaryContainer, record);
  }
  if (chartTitle) {
    chartTitle.innerHTML = `粉径分布柱状图 <span class="hint">${escapeHtml(record.grinder.brand)} ${escapeHtml(record.grinder.model)} · 刻度 ${escapeHtml(record.grinder.setting)}</span>`;
  }
  $("singleRecordNote").textContent = "以上信息为该次称测保存时的完整记录；切换纵轴不会修改原始数据。";
  drawBarChart($("canvasRecordDetail"), record, $("recordDetailUnit").value);
}

function renderMultiCompare() {
  const records = [...state.selectedHistoryIds]
    .map((id) => state.store.records.find((record) => record.id === id))
    .filter(Boolean)
    .slice(0, MAX_COMPARE_RECORDS);
  $("multiCompareLegend").innerHTML = records.map((record, index) => `
    <span class="multi-legend-item">
      <i style="background:${paletteForIndex(index)}"></i>
      Z${index + 1} · ${escapeHtml(record.grinder.brand)} ${escapeHtml(record.grinder.model)}
      · ${escapeHtml(record.grinder.setting)} · ${escapeHtml(formatDate(record.createdAt))}
    </span>`).join("");
  drawMultiRecord3D($("canvasCmpMulti3d"), records, "pct", $("multiCompareNote"));
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
    reconcileSyncQueueFromDatabase();
    state.communityFresh = true;
    localStorage.setItem(COMMUNITY_CACHE_KEY, JSON.stringify({
      cachedAt: new Date().toISOString(),
      meta: state.communityMeta,
      records: state.communityRecords
    }));
    refreshCommunityFilters();
    updateCommunitySummary();
    renderCommunity();
    renderRecordDetail();
    renderSyncLog();
    updateNetworkStatus(`社区数据库已同步 · ${state.communityRecords.length} 条记录`);
    $("communityStatus").textContent = `已同步 ${state.communityRecords.length} 条记录`;
    if ($("authNetworkStatus")) {
      prepareAuthModal();
    }
    if (!quiet) toast("社区数据库同步完成。", "success");
  } catch (error) {
    state.communityFresh = false;
    updateNetworkStatus("社区数据库同步失败 · 本地记录不受影响");
    $("communityStatus").textContent = `同步失败：${error.message}`;
    if (!quiet) toast(`社区数据库同步失败：${error.message}`, "error");
    if ($("authNetworkStatus")) updateAuthNetworkStatus();
  }
}

function loadCachedCommunity() {
  try {
    const cached = JSON.parse(
      localStorage.getItem(COMMUNITY_CACHE_KEY)
      || localStorage.getItem(PREVIOUS_COMMUNITY_CACHE_KEY)
    );
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
    record.grinder.settingTurns,
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
  toast("社区双对比已停用；请先导入记录，再在历史记录中进行多选对比。", "error");
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

function editOwnedCommunityRecord(id) {
  const record = state.communityRecords.find((item) => item.id === id);
  if (!record || record.user.id !== state.store.user.id || !state.identityConfirmed) {
    toast("只能编辑当前登录 ID 自己的社区记录。", "error");
    return;
  }
  ensureCatalogEntry(
    state.store,
    record.grinder.brand,
    record.grinder.model,
    record.grinder.color
  );
  saveStore();
  openWizard({
    prefill: {
      mode: "edit-remote",
      targetRecordId: record.id,
      createdAt: record.createdAt,
      brand: record.grinder.brand,
      model: record.grinder.model,
      color: record.grinder.color,
      setting: record.grinder.setting,
      settingTurns: record.grinder.settingTurns,
      settingOrder: record.grinder.settingOrder,
      doseG: record.sample.doseG,
      bean: record.sample.bean,
      roastLevel: record.sample.roastLevel,
      durationSec: record.sample.durationSec,
      sieveDevice: record.sample.sieveDevice,
      method: record.sample.method,
      replicate: record.sample.replicate,
      notes: record.notes,
      weightsGrams: Core.normalizeWeights(record.weightsGrams)
    }
  });
}

async function requestDeleteCommunityRecord(id) {
  const record = state.communityRecords.find((item) => item.id === id);
  if (!record || record.user.id !== state.store.user.id || !state.identityConfirmed) {
    toast("只能删除当前登录 ID 自己的社区记录。", "error");
    return;
  }
  if (!window.confirm(`确认删除社区记录 ${record.id}？工作流会核对当前授权的 GitHub 账号。`)) return;
  const submitted = await submitOperation({
    operation: "delete_record",
    schemaVersion: Core.SCHEMA_VERSION,
    standardId: Core.STANDARD_ID,
    userId: state.store.user.id,
    targetId: record.id,
    requestedAt: new Date().toISOString()
  }, `[PSD-DELETE] ${state.store.user.id} · ${record.id}`, "Grind-PSD 社区记录删除");
  if (submitted) toast("删除任务已自动提交；账号校验通过后数据库才会删除。", "success");
}

async function uploadRecordBatch(records) {
  const publicRecords = records
    .map((record) => buildPublicPayload(record, true))
    .filter((record) => Core.validatePublicRecord(record).errors.length === 0);
  if (!publicRecords.length) {
    toast("没有满足公开质量要求的本地记录可上传。", "error");
    return false;
  }
  const skipped = records.length - publicRecords.length;
  const submitted = await submitOperation({
    operation: "upsert_records",
    schemaVersion: Core.SCHEMA_VERSION,
    standardId: Core.STANDARD_ID,
    license: Core.DATA_LICENSE,
    records: publicRecords,
    requestedAt: new Date().toISOString()
  }, `[PSD-BATCH] ${state.store.user.id} · ${publicRecords.length} 条记录`, "Grind-PSD 本地记录批量上传");
  if (submitted) {
    removeQueuedRecordIds(publicRecords.map((record) => record.id));
    state.store.settings.licenseAcceptedAt = state.store.settings.licenseAcceptedAt || new Date().toISOString();
    saveStore();
  }
  if (submitted && skipped) {
    toast(`${skipped} 条记录因回收率或字段不完整未加入上传。`, "error");
  }
  return submitted;
}

function buildIssueBody(payload, heading) {
  const payloadText = Array.isArray(payload.records) && payload.records.length > 1
    ? JSON.stringify(payload)
    : JSON.stringify(payload, null, 2);
  return [
    `## ${heading}`,
    "",
    "请勿修改以下标记之间的 JSON。自动工作流会核验 GitHub 账号、用户 ID、标准和原始克重。",
    "",
    "BEGIN_GRIND_PSD_JSON",
    "```json",
    payloadText,
    "```",
    "END_GRIND_PSD_JSON",
    "",
    `标准：\`${Core.STANDARD_ID}\``
  ].join("\n");
}

async function submitOperation(payload, title, heading) {
  if (!navigator.onLine) {
    toast("当前离线，任务已保留在本机，联网后可从“同步记录”重试。", "error");
    if (Array.isArray(payload.records)) queueLocalRecords(payload.records, "等待网络恢复");
    return false;
  }
  const connected = await connectGitHub();
  if (!connected || !state.githubAuth?.token) return false;
  const ownerId = payload.user?.id
    || payload.userId
    || payload.record?.user?.id
    || payload.records?.[0]?.user?.id
    || "";
  const remoteOwner = onlineUsers()[Core.normalizeUserId(ownerId)]?.githubLogin;
  if (remoteOwner && remoteOwner.toLowerCase() !== state.githubAuth.login.toLowerCase()) {
    toast(`用户 ID ${ownerId} 绑定的是 @${remoteOwner}，当前连接账号 @${state.githubAuth.login} 无权写入。`, "error");
    return false;
  }
  try {
    const issue = await githubApi(`/repos/${REPOSITORY}/issues`, {
      method: "POST",
      body: {
        title,
        body: buildIssueBody(payload, heading)
      }
    });
    const recordIds = payload.operation === "register_user"
      ? [payload.user.id]
      : payload.operation === "delete_record"
        ? [payload.targetId]
        : payload.operation === "update_record"
          ? [payload.targetId]
          : (payload.records || []).map((record) => record.id);
    state.store.syncQueue = normalizeSyncQueue([{
      id: createLocalId("sync"),
      operation: payload.operation,
      title,
      status: "processing",
      recordIds,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: ""
    }, ...state.store.syncQueue]);
    saveStore();
    renderSyncLog();
    scheduleSyncRefresh(7000);
    return true;
  } catch (error) {
    if (error.status === 401 || error.status === 403) disconnectGitHub({ quiet: true });
    toast(`自动提交失败：${error.message}`, "error");
    return false;
  }
}

function queueLocalRecords(records, reason = "") {
  const remoteIds = new Set(state.communityRecords.map((record) => record.id));
  const queuedIds = new Set(state.store.syncQueue
    .filter((item) => item.status === "queued")
    .flatMap((item) => item.recordIds));
  const recordIds = records
    .map((record) => record.id)
    .filter((id) => id && !remoteIds.has(id) && !queuedIds.has(id));
  if (!recordIds.length) return;
  state.store.syncQueue = normalizeSyncQueue([{
    id: createLocalId("sync"),
    operation: "upsert_records",
    title: `${recordIds.length} 条本地记录待上传`,
    status: "queued",
    recordIds,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: reason
  }, ...state.store.syncQueue]);
  saveStore();
  renderSyncLog();
}

function removeQueuedRecordIds(recordIds) {
  const uploaded = new Set(recordIds);
  state.store.syncQueue = state.store.syncQueue.flatMap((item) => {
    if (item.status !== "queued") return [item];
    const remaining = item.recordIds.filter((id) => !uploaded.has(id));
    return remaining.length ? [{ ...item, recordIds: remaining, updatedAt: new Date().toISOString() }] : [];
  });
}

async function uploadAllUnsynced({ quiet = false } = {}) {
  if (!state.identityConfirmed || state.store.user.temporary) {
    openAuthModal();
    if (!quiet) toast("请先登录自己的测量 ID。", "error");
    return false;
  }
  if (!state.store.settings.licenseAcceptedAt) {
    if (!quiet) toast("请先从单条记录上传窗口确认 CC BY 4.0 数据许可。", "error");
    return false;
  }
  const records = getUnsyncedRecords();
  if (!records.length) {
    removeQueuedRecordIds(state.store.records.map((record) => record.id));
    saveStore();
    renderSyncLog();
    if (!quiet) toast("没有待上传的本地记录。", "success");
    return true;
  }
  let uploaded = 0;
  for (let index = 0; index < records.length; index += MAX_BATCH_RECORDS) {
    const batch = records.slice(index, index + MAX_BATCH_RECORDS);
    const ok = await uploadRecordBatch(batch);
    if (!ok) break;
    uploaded += batch.length;
  }
  if (uploaded && !quiet) toast(`已自动提交 ${uploaded} 条记录，正在等待工作流校验。`, "success");
  return uploaded === records.length;
}

async function syncAll({ quiet = false } = {}) {
  await syncCommunity({ quiet: true });
  await refreshSyncQueue({ quiet: true });
  if (state.store.settings.autoUpload && state.githubAuth?.token) {
    await uploadAllUnsynced({ quiet: true });
  }
  if (!quiet) toast("社区数据库、上传队列和处理状态已同步。", "success");
}

function reconcileSyncQueueFromDatabase() {
  const remoteIds = new Set(state.communityRecords.map((record) => record.id));
  const remoteUsers = onlineUsers();
  let changed = false;
  state.store.syncQueue.forEach((item) => {
    if (!["queued", "processing"].includes(item.status) || !item.recordIds.length) return;
    let completed = false;
    if (item.operation === "upsert_records") {
      completed = item.recordIds.every((id) => remoteIds.has(id));
    } else if (item.operation === "register_user") {
      completed = item.recordIds.every((id) => Boolean(remoteUsers[id]));
    } else if (item.operation === "delete_record") {
      completed = item.recordIds.every((id) => !remoteIds.has(id));
    }
    if (!completed) return;
    item.status = "success";
    item.error = "";
    item.updatedAt = new Date().toISOString();
    changed = true;
  });
  if (changed) saveStore();
}

function renderSyncLog() {
  const queue = normalizeSyncQueue(state.store?.syncQueue);
  state.store.syncQueue = queue;
  const counts = queue.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  const pending = (counts.queued || 0) + (counts.authorizing || 0) + (counts.processing || 0);
  $("syncPendingBadge").textContent = String(pending);
  $("syncPendingCount").textContent = String(pending);
  $("syncSuccessCount").textContent = String(counts.success || 0);
  $("syncFailedCount").textContent = String(counts.failed || 0);
  $("syncAuthSummary").textContent = state.githubAuth?.login ? `@${state.githubAuth.login}` : "未连接";
  $("githubConnectionStatus").textContent = state.githubAuth?.login
    ? `已连接 @${state.githubAuth.login}。授权令牌只保存在当前浏览器会话，关闭浏览器后自动清除。`
    : state.appConfig?.githubAppClientId
      ? "尚未连接。首次授权后，本次会话可在应用内自动提交、编辑和删除。"
      : "仓库所有者尚未完成 GitHub App 客户端配置；当前不会回退为公开令牌或手工仓库写入。";
  $("connectGitHubBtn").textContent = state.githubAuth?.login ? "重新连接 GitHub" : "连接 GitHub";
  $("disconnectGitHubBtn").hidden = !state.githubAuth?.login;

  const labels = {
    queued: "待上传",
    authorizing: "等待授权",
    processing: "处理中",
    success: "已入库",
    failed: "失败"
  };
  $("syncQueueContent").innerHTML = queue.length
    ? queue.map((item) => `
      <div class="sync-item">
        <div class="sync-item-main">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(formatDate(item.updatedAt))}${item.recordIds.length ? ` · ${item.recordIds.length} 项` : ""}${item.error ? ` · ${escapeHtml(item.error)}` : ""}${item.issueUrl ? ` · <a href="${escapeHtml(item.issueUrl)}" target="_blank" rel="noopener noreferrer">审计记录 #${item.issueNumber}</a>` : ""}</span>
        </div>
        <span class="sync-state ${escapeHtml(item.status)}">${escapeHtml(labels[item.status] || item.status)}</span>
      </div>`).join("")
    : '<div class="empty">还没有上传任务。保存记录后可自动加入，或点击“同步全部待上传记录”。</div>';
}

function clearFinishedSyncQueue() {
  state.store.syncQueue = state.store.syncQueue.filter((item) => item.status !== "success");
  saveStore();
  renderSyncLog();
}

function scheduleSyncRefresh(delayMs = 10000) {
  clearTimeout(state.syncRefreshTimer);
  state.syncRefreshTimer = setTimeout(() => refreshSyncQueue({ quiet: true }), delayMs);
}

async function refreshSyncQueue({ quiet = false } = {}) {
  const pending = state.store.syncQueue.filter((item) => item.status === "processing" && item.issueNumber);
  if (!pending.length) {
    renderSyncLog();
    if (!quiet) toast("上传处理状态已是最新。", "success");
    return;
  }
  if (!state.githubAuth?.token || !navigator.onLine) {
    renderSyncLog();
    if (!quiet) toast("连接 GitHub 后才能读取任务处理结果。", "error");
    return;
  }
  for (const item of pending.slice(0, 12)) {
    try {
      const issue = await githubApi(`/repos/${REPOSITORY}/issues/${item.issueNumber}`);
      if (issue.state === "closed") {
        item.status = "success";
        item.error = "";
      } else {
        const comments = await githubApi(`/repos/${REPOSITORY}/issues/${item.issueNumber}/comments?per_page=20`);
        const rejected = [...comments].reverse().find((comment) => String(comment.body || "").startsWith("❌"));
        if (rejected) {
          item.status = "failed";
          item.error = Core.cleanText(String(rejected.body).replace(/^❌\s*/, ""), 500);
        }
      }
      item.updatedAt = new Date().toISOString();
    } catch (error) {
      item.error = `状态读取失败：${error.message}`;
      item.updatedAt = new Date().toISOString();
    }
  }
  saveStore();
  renderSyncLog();
  const stillPending = state.store.syncQueue.some((item) => item.status === "processing");
  if (stillPending) scheduleSyncRefresh(12000);
  if (!quiet) toast("上传处理状态已刷新。", "success");
}

async function restoreGitHubSession() {
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(GITHUB_SESSION_KEY));
  } catch (error) {
    saved = null;
  }
  if (!saved?.token || (saved.expiresAt && Date.parse(saved.expiresAt) <= Date.now() + 30000)) {
    sessionStorage.removeItem(GITHUB_SESSION_KEY);
    state.githubAuth = null;
    renderSyncLog();
    return;
  }
  try {
    const user = await githubApi("/user", { token: saved.token });
    state.githubAuth = {
      token: saved.token,
      login: String(user.login || ""),
      userId: String(user.id || ""),
      expiresAt: saved.expiresAt || null
    };
  } catch (error) {
    sessionStorage.removeItem(GITHUB_SESSION_KEY);
    state.githubAuth = null;
  }
  renderSyncLog();
}

function connectGitHub() {
  if (state.githubAuth?.token) {
    renderSyncLog();
    return Promise.resolve(true);
  }
  if (state.oauthPromise) return state.oauthPromise;
  state.oauthPromise = runGitHubConnection().finally(() => {
    state.oauthPromise = null;
  });
  return state.oauthPromise;
}

async function runGitHubConnection() {
  state.oauthPollCancelled = false;
  state.deviceAuth = null;
  $("githubDeviceCodeCard").hidden = true;
  $("copyGithubCodeBtn").hidden = true;
  $("openGithubAuthorizeBtn").hidden = true;
  showModal("githubAuthModal");

  const clientId = state.appConfig?.githubAppClientId;
  if (!clientId) {
    $("githubAuthMessage").textContent = "仓库所有者尚未写入 GitHub App Client ID。为避免泄露仓库令牌，自动上传暂不启用，也不会回退为前端 PAT。";
    return false;
  }

  $("githubAuthMessage").textContent = "正在请求一次性授权码…";
  try {
    const device = await githubOAuthRequest("https://github.com/login/device/code", {
      client_id: clientId
    });
    if (!device.device_code || !device.user_code || !device.verification_uri) {
      throw new Error(device.error_description || device.error || "GitHub 未返回有效授权码");
    }
    state.deviceAuth = {
      ...device,
      expiresAt: Date.now() + Number(device.expires_in || 900) * 1000,
      intervalMs: Math.max(5000, Number(device.interval || 5) * 1000)
    };
    $("githubAuthMessage").textContent = "复制授权码并在 GitHub 授权页确认。完成后本页会自动继续，无需返回 GitHub 手工提交数据。";
    $("githubDeviceCode").textContent = device.user_code;
    $("githubDeviceCodeCard").hidden = false;
    $("copyGithubCodeBtn").hidden = false;
    $("openGithubAuthorizeBtn").hidden = false;

    let intervalMs = state.deviceAuth.intervalMs;
    while (!state.oauthPollCancelled && Date.now() < state.deviceAuth.expiresAt) {
      await wait(intervalMs);
      if (state.oauthPollCancelled) return false;
      const tokenResult = await githubOAuthRequest("https://github.com/login/oauth/access_token", {
        client_id: clientId,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      });
      if (tokenResult.error === "authorization_pending") continue;
      if (tokenResult.error === "slow_down") {
        intervalMs += 5000;
        continue;
      }
      if (tokenResult.error) {
        throw new Error(tokenResult.error_description || tokenResult.error);
      }
      if (!tokenResult.access_token) throw new Error("GitHub 未返回访问令牌");
      const user = await githubApi("/user", { token: tokenResult.access_token });
      const expiresAt = tokenResult.expires_in
        ? new Date(Date.now() + Number(tokenResult.expires_in) * 1000).toISOString()
        : null;
      state.githubAuth = {
        token: tokenResult.access_token,
        login: String(user.login || ""),
        userId: String(user.id || ""),
        expiresAt
      };
      sessionStorage.setItem(GITHUB_SESSION_KEY, JSON.stringify(state.githubAuth));
      state.deviceAuth = null;
      $("githubAuthModal").classList.add("hidden");
      if (!document.querySelector(".overlay:not(.hidden)")) document.body.style.overflow = "";
      renderSyncLog();
      toast(`已连接 GitHub：@${state.githubAuth.login}。`, "success");
      return true;
    }
    if (!state.oauthPollCancelled) throw new Error("授权码已过期，请重新连接");
    return false;
  } catch (error) {
    if (!state.oauthPollCancelled) {
      $("githubAuthMessage").textContent = `连接失败：${error.message}`;
      toast(`GitHub 连接失败：${error.message}`, "error");
    }
    return false;
  }
}

async function githubOAuthRequest(url, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error_description || result.message || `HTTP ${response.status}`);
  }
  return result;
}

async function githubApi(path, options = {}) {
  const token = options.token || state.githubAuth?.token;
  if (!token) throw new Error("尚未连接 GitHub");
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.message || `GitHub API HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return result;
}

function openGitHubAuthorizationPage() {
  const url = state.deviceAuth?.verification_uri;
  if (!/^https:\/\/github\.com\//.test(String(url || ""))) return;
  const opened = window.open(url, "_blank");
  if (!opened) {
    toast("浏览器阻止了授权页，请允许弹窗后重试。", "error");
    return;
  }
  try {
    opened.opener = null;
  } catch (error) {
    // The new tab is still usable when opener is read-only.
  }
}

async function copyGitHubDeviceCode() {
  const code = state.deviceAuth?.user_code || "";
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    toast("GitHub 授权码已复制。", "success");
  } catch (error) {
    toast(`授权码：${code}`, "success");
  }
}

function disconnectGitHub({ quiet = false } = {}) {
  state.oauthPollCancelled = true;
  state.deviceAuth = null;
  state.githubAuth = null;
  sessionStorage.removeItem(GITHUB_SESSION_KEY);
  renderSyncLog();
  if (!quiet) toast("已断开本机 GitHub 会话；仓库中的公开数据不受影响。", "success");
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function openSubmitModal() {
  const record = getSelectedRecord();
  if (!record || state.selectedRecordSource === "community") {
    toast("请先选择一条本地记录。", "error");
    return;
  }
  if (!state.identityConfirmed || record.user.id !== state.store.user.id) {
    toast("只能上传当前登录 ID 自己的本地记录。", "error");
    return;
  }
  $("licenseConsent").checked = Boolean(state.store.settings.licenseAcceptedAt);
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
      settingTurns: record.grinder.settingTurns,
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

async function openSubmissionIssue() {
  const record = getSelectedRecord();
  if (!record) return;
  const payload = JSON.parse($("submitJson").value);
  const validation = Core.validatePublicRecord(payload);
  if (validation.errors.length) {
    toast(validation.errors[0], "error");
    return;
  }
  const submitted = await submitOperation({
    operation: "upsert_records",
    schemaVersion: Core.SCHEMA_VERSION,
    standardId: Core.STANDARD_ID,
    license: Core.DATA_LICENSE,
    records: [payload],
    requestedAt: new Date().toISOString()
  }, `[PSD] ${record.user.id} · ${record.grinder.brand} ${record.grinder.model} · ${record.grinder.setting}`, "Grind-PSD 标准数据提交");
  if (!submitted) return;
  state.store.settings.licenseAcceptedAt = state.store.settings.licenseAcceptedAt || new Date().toISOString();
  removeQueuedRecordIds([record.id]);
  saveStore();
  hideModal("submitModal");
  toast("上传任务已自动提交，正在等待工作流校验入库。", "success");
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
    "record_id", "user_id", "user_name", "brand", "model", "setting", "setting_turns", "setting_order",
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
    record.grinder.settingTurns ?? "",
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
      <td>${sieve.key === "pan_lt180_g"
        ? '<span class="pan-label">低于 80 目<small>筛下</small></span>'
        : escapeHtml(sieve.label)}</td>
      <td>${escapeHtml(sieve.range)}</td>
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
  if (id === "githubAuthModal" && state.deviceAuth) {
    state.oauthPollCancelled = true;
    state.deviceAuth = null;
  }
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
      <div class="install-step"><strong>本地数据</strong>记录与绘图可离线使用；本版不提供网络上传。</div>`;
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
  const sieves = Core.getRecordSieves(record);
  const values = sieves.map((sieve) => {
    return unit === "pct"
      ? (record.totalG ? (record.weightsGrams[sieve.key] || 0) / record.totalG * 100 : 0)
      : (record.weightsGrams[sieve.key] || 0);
  });
  const maxValue = Math.max(...values) * 1.16 || 1;
  drawGrid(ctx, pad, plotW, plotH, maxValue, unit);
  const color = Core.normalizeHexColor(record.grinder.color);
  const groupW = plotW / sieves.length;
  const barW = Math.min(72, groupW * 0.54);

  sieves.forEach((sieve, index) => {
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

function drawArray3D(canvas, groupInput, unit = "g", noteElement = null) {
  const { ctx, width, height } = setupCanvas(canvas);
  const groups = (Array.isArray(groupInput) ? groupInput : [groupInput])
    .filter((group) => group?.records?.length)
    .slice(0, 2);
  if (!groups.length) {
    drawEmptyCanvas(ctx, width, height, "暂无可绘制的刻度记录");
    if (noteElement) noteElement.textContent = "至少需要一组同一用户、同一磨豆机的记录。";
    return;
  }

  const groupRows = groups.map((group) => latestBySetting(group.records));
  const sameModel = groups.length === 1 || groups.every((group) => {
    return group.brand === groups[0].brand && group.model === groups[0].model;
  });
  const alignmentKey = (record) => {
    const order = Number(record.grinder.settingOrder);
    return Number.isFinite(order)
      ? `order:${order}`
      : `label:${String(record.grinder.setting).trim().toLowerCase()}`;
  };

  let slots = [];
  if (groups.length > 1 && sameModel) {
    const slotMap = new Map();
    groupRows.forEach((rows, groupIndex) => {
      rows.forEach((record) => {
        const key = alignmentKey(record);
        if (!slotMap.has(key)) slotMap.set(key, Array(groups.length).fill(null));
        slotMap.get(key)[groupIndex] = record;
      });
    });
    slots = [...slotMap.values()].sort((a, b) => {
      return Core.compareSettings(a.find(Boolean), b.find(Boolean));
    });
  } else {
    const slotCount = Math.max(...groupRows.map((rows) => rows.length));
    slots = Array.from({ length: slotCount }, (_, rowIndex) => {
      return groupRows.map((rows) => rows[rowIndex] || null);
    });
  }

  if (noteElement) {
    if (groups.length === 1) {
      const rows = groupRows[0];
      noteElement.textContent = rows.length >= 3
        ? `${groups[0].userId} · ${groups[0].brand} ${groups[0].model} 共 ${rows.length} 个刻度。近排=较细，远排=较粗。`
        : `当前只有 ${rows.length} 个不同刻度，建议录入 3 个及以上刻度。`;
    } else if (sameModel) {
      noteElement.textContent = `已叠加两组同型号阵列；相同“由细到粗排序值/刻度”共用 Z 轴位置，成对色柱用于直接比较。`;
    } else {
      noteElement.textContent = `已叠加两种不同磨豆机。不同设备刻度值不可直接等同，Z 轴仅按各自“细→粗”序位对齐；建议使用占比 %，结果仅作分布形状比较。`;
    }
  }

  const sieves = Core.getRecordSieves(groups[0].records[0]);
  const values = (record) => sieves.map((sieve) => {
    if (!record) return 0;
    return unit === "pct"
      ? (record.totalG ? (record.weightsGrams[sieve.key] || 0) / record.totalG * 100 : 0)
      : (record.weightsGrams[sieve.key] || 0);
  });
  let maxValue = 0;
  slots.flat().filter(Boolean).forEach((record) => values(record).forEach((value) => {
    maxValue = Math.max(maxValue, value);
  }));
  maxValue = maxValue * 1.12 || 1;

  const compact = width < 520;
  const countX = sieves.length;
  const countZ = Math.max(1, slots.length);
  const depthTotal = Math.min(width * 0.18, height * 0.28, 28 * countZ);
  const depthX = depthTotal / countZ;
  const depthY = depthTotal * 0.55 / countZ;
  const pad = {
    left: compact ? 42 : 60,
    right: compact ? 38 : 78,
    top: groups.length > 1 ? (compact ? 42 : 48) : (compact ? 28 : 36),
    bottom: compact ? 44 : 58
  };
  const plotW = Math.max(120, width - pad.left - pad.right - depthTotal);
  const plotH = Math.max(54, height - pad.top - pad.bottom - depthTotal * 0.55);
  const cell = plotW / countX;
  const groupGap = Math.max(1, cell * 0.025);
  const barW = Math.max(3, Math.min(cell * 0.5, (cell * 0.68 - groupGap * (groups.length - 1)) / groups.length));
  const baseY = height - pad.bottom;
  const scaleY = plotH / maxValue;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#3a2f26";
  for (let index = 0; index <= countX; index += 1) {
    const x = pad.left + cell * index;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x + depthTotal, baseY - depthTotal * 0.55);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(pad.left, baseY);
  ctx.lineTo(pad.left + plotW, baseY);
  ctx.stroke();

  ctx.fillStyle = "#a89880";
  ctx.font = `${compact ? 8 : 10}px sans-serif`;
  ctx.textAlign = "right";
  for (let index = 0; index <= 4; index += 1) {
    const value = maxValue * index / 4;
    const y = baseY - value * scaleY;
    ctx.fillText(`${formatPlainNumber(value, unit === "pct" ? 0 : 1)}${unit === "pct" ? "%" : "g"}`, pad.left - 6, y + 3);
    ctx.strokeStyle = "rgba(58,47,38,.65)";
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
  }

  for (let rowIndex = countZ - 1; rowIndex >= 0; rowIndex -= 1) {
    const offsetX = rowIndex * depthX;
    const offsetY = rowIndex * depthY;
    const brightness = 0.58 + 0.42 * (1 - rowIndex / Math.max(1, countZ - 1));
    slots[rowIndex].forEach((record, groupIndex) => {
      if (!record) return;
      const rawValues = values(record);
      const pairedValues = groups.length === 2 ? values(slots[rowIndex][1 - groupIndex]) : null;
      const rowValues = pairedValues
        ? rawValues.map((value, index) => groupIndex === 0
          ? Math.min(value, pairedValues[index])
          : Math.abs(value - pairedValues[index]))
        : rawValues;
      const baseOffsets = pairedValues && groupIndex === 1
        ? rawValues.map((value, index) => Math.min(value, pairedValues[index]))
        : rawValues.map(() => 0);
      const baseColor = pairedValues && groupIndex === 0
        ? "#777777"
        : Core.normalizeHexColor(groups[groupIndex].color);
      const front = shadeColor(baseColor, brightness);
      const top = shadeColor(baseColor, brightness * 1.25);
      const side = shadeColor(baseColor, brightness * 0.72);
      const groupOffset = groups.length === 2 ? 0 : (groupIndex - (groups.length - 1) / 2) * (barW + groupGap);
      for (let index = 0; index < countX; index += 1) {
        const value = rowValues[index];
        if (value <= 0) continue;
        const segmentColor = pairedValues && groupIndex === 1
          ? Core.normalizeHexColor(groups[rawValues[index] >= pairedValues[index] ? groupIndex : 0].color)
          : baseColor;
        const segmentFront = shadeColor(segmentColor, brightness);
        const segmentTop = shadeColor(segmentColor, brightness * 1.25);
        const segmentSide = shadeColor(segmentColor, brightness * 0.72);
        const barH = value * scaleY;
        const x = pad.left + cell * (index + 0.5) - barW / 2 + offsetX + groupOffset;
        const y = baseY - offsetY - baseOffsets[index] * scaleY;
        const prismX = Math.max(2, depthX * 0.48);
        const prismY = Math.max(1.5, depthY * 0.48);
        ctx.globalAlpha = groups.length > 1 ? 0.88 : 1;
        ctx.fillStyle = segmentSide;
        ctx.beginPath();
        ctx.moveTo(x + barW, y - barH);
        ctx.lineTo(x + barW + prismX, y - barH - prismY);
        ctx.lineTo(x + barW + prismX, y - prismY);
        ctx.lineTo(x + barW, y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = segmentTop;
        ctx.beginPath();
        ctx.moveTo(x, y - barH);
        ctx.lineTo(x + prismX, y - barH - prismY);
        ctx.lineTo(x + barW + prismX, y - barH - prismY);
        ctx.lineTo(x + barW, y - barH);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = segmentFront;
        ctx.fillRect(x, y - barH, barW, barH);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = shadeColor(baseColor, brightness * 1.35);
      ctx.lineWidth = groups.length > 1 ? 1.15 : 1.4;
      ctx.beginPath();
      rowValues.forEach((value, index) => {
        const x = pad.left + cell * (index + 0.5) + offsetX + groupOffset;
        const y = baseY - offsetY - (value + baseOffsets[index]) * scaleY;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.lineWidth = 1;
    });

    const rowLabels = slots[rowIndex].map((record, groupIndex) => {
      return record ? `${String.fromCharCode(65 + groupIndex)}:${record.grinder.setting}` : "";
    }).filter(Boolean).join(" · ");
    ctx.fillStyle = "#efe6da";
    ctx.font = `${compact ? 7 : 9}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(rowLabels, pad.left + plotW + offsetX + 5, baseY - offsetY + 2);
  }

  ctx.fillStyle = "#a89880";
  ctx.font = `${compact ? 8 : 10}px sans-serif`;
  ctx.textAlign = "center";
  sieves.forEach((sieve, index) => {
    ctx.fillText(sieve.shortLabel, pad.left + cell * (index + 0.5), baseY + (compact ? 14 : 19));
    if (!compact) {
      ctx.font = "8px sans-serif";
      ctx.fillText(sieve.range, pad.left + cell * (index + 0.5), baseY + 34);
      ctx.font = "10px sans-serif";
    }
  });

  drawLegend(ctx, groups.map((group, index) => ({
    color: Core.normalizeHexColor(group.color),
    label: `${String.fromCharCode(65 + index)} · ${group.userId} · ${group.brand} ${group.model}`
  })), pad.left, compact ? 8 : 13, width - 8);
  ctx.fillStyle = "#a89880";
  ctx.font = `${compact ? 8 : 9}px sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText("Z：细（近）→ 粗（远）", width - 7, compact ? 31 : 35);
}

function drawMultiRecord3D(canvas, records, unit = "pct", noteElement = null) {
  const { ctx, width, height } = setupCanvas(canvas);
  const rows = (records || []).slice(0, MAX_COMPARE_RECORDS);
  if (rows.length < 2) {
    drawEmptyCanvas(ctx, width, height, "请在历史记录中选择 2–10 条测次");
    if (noteElement) noteElement.textContent = "筛选记录后勾选需要对比的测次，再点击“对比所选”。";
    return;
  }
  const sieves = Core.getRecordSieves(rows[0]);
  const compatible = rows.every((record) => {
    const candidate = Core.getRecordSieves(record);
    return candidate.length === sieves.length &&
      candidate.every((sieve, index) => sieve.range === sieves[index].range);
  });
  if (!compatible) {
    drawEmptyCanvas(ctx, width, height, "所选记录筛孔区间不同，不能逐档对比");
    if (noteElement) noteElement.textContent = "请仅选择使用相同筛网孔径配置的记录。";
    return;
  }
  const valuesFor = (record) => sieves.map((sieve) => unit === "pct"
    ? (record.totalG ? (record.weightsGrams[sieve.key] || 0) / record.totalG * 100 : 0)
    : (record.weightsGrams[sieve.key] || 0));
  const maxValue = Math.max(...rows.flatMap(valuesFor), 1) * 1.12;
  const compact = width < 520;
  const pad = { left: compact ? 40 : 58, right: compact ? 44 : 72, top: 24, bottom: compact ? 40 : 54 };
  const depthTotal = Math.min(width * 0.22, height * 0.3);
  const stepX = depthTotal / Math.max(1, rows.length);
  const stepY = stepX * 0.55;
  const plotW = width - pad.left - pad.right - depthTotal;
  const plotH = height - pad.top - pad.bottom - depthTotal * 0.55;
  const cellW = plotW / sieves.length;
  const barW = Math.max(4, Math.min(46, cellW * 0.48));
  const baseY = height - pad.bottom;
  const scaleY = plotH / maxValue;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#3a2f26";
  ctx.fillStyle = "#a89880";
  ctx.font = `${compact ? 8 : 10}px sans-serif`;
  ctx.textAlign = "right";
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = maxValue * tick / 4;
    const y = baseY - value * scaleY;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillText(`${formatPlainNumber(value, unit === "pct" ? 0 : 1)}${unit === "pct" ? "%" : "g"}`, pad.left - 5, y + 3);
  }

  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const values = valuesFor(rows[rowIndex]);
    const offsetX = rowIndex * stepX;
    const offsetY = rowIndex * stepY;
    const color = paletteForIndex(rowIndex);
    values.forEach((value, index) => {
      const barH = value * scaleY;
      const x = pad.left + cellW * (index + 0.5) - barW / 2 + offsetX;
      const y = baseY - offsetY;
      const prismX = Math.max(2, stepX * 0.42);
      const prismY = Math.max(1, stepY * 0.42);
      ctx.fillStyle = shadeColor(color, 0.68);
      ctx.beginPath();
      ctx.moveTo(x + barW, y - barH);
      ctx.lineTo(x + barW + prismX, y - barH - prismY);
      ctx.lineTo(x + barW + prismX, y - prismY);
      ctx.lineTo(x + barW, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shadeColor(color, 1.12);
      ctx.beginPath();
      ctx.moveTo(x, y - barH);
      ctx.lineTo(x + prismX, y - barH - prismY);
      ctx.lineTo(x + barW + prismX, y - barH - prismY);
      ctx.lineTo(x + barW, y - barH);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(x, y - barH, barW, barH);
    });
    ctx.fillStyle = "#efe6da";
    ctx.font = `${compact ? 7 : 9}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(`Z${rowIndex + 1}`, pad.left + plotW + offsetX + 4, baseY - offsetY + 2);
  }
  ctx.fillStyle = "#a89880";
  ctx.font = `${compact ? 8 : 10}px sans-serif`;
  ctx.textAlign = "center";
  sieves.forEach((sieve, index) => {
    ctx.fillText(sieve.shortLabel, pad.left + cellW * (index + 0.5), baseY + 18);
  });
  if (noteElement) {
    noteElement.textContent = `${rows.length} 条测次已沿 Z 轴分别展示；Z1 为选择列表中的第一条，Z${rows.length} 为最后一条。`;
  }
}

function drawOverlapCompare(canvas, recordA, recordB, unit, requestedColorA, requestedColorB) {
  const { ctx, width, height } = setupCanvas(canvas);
  if (!recordA || !recordB) {
    drawEmptyCanvas(ctx, width, height, "至少需要两条记录才能对比");
    return;
  }

  const value = (record, sieve) => unit === "pct"
    ? (record.totalG ? (record.weightsGrams[sieve.key] || 0) / record.totalG * 100 : 0)
    : (record.weightsGrams[sieve.key] || 0);
  let maxValue = 0;
  const sievesA = Core.getRecordSieves(recordA);
  const sievesB = Core.getRecordSieves(recordB);
  const compatible = sievesA.length === sievesB.length && sievesA.every((sieve, index) => sieve.range === sievesB[index].range);
  if (!compatible) {
    drawEmptyCanvas(ctx, width, height, "筛网孔径配置不同，不能直接逐档重叠");
    return;
  }
  const sieves = sievesA;
  sieves.forEach((sieve) => {
    maxValue = Math.max(maxValue, value(recordA, sieve), value(recordB, sieve));
  });
  maxValue = maxValue * 1.16 || 1;
  const compact = width < 520;
  const pad = compact
    ? { left: 42, right: 12, top: 40, bottom: 42 }
    : { left: 58, right: 22, top: 54, bottom: 58 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  drawGrid(ctx, pad, plotW, plotH, maxValue, unit);

  const colorA = Core.normalizeHexColor(requestedColorA, "#8a8a8a");
  const colorB = Core.normalizeHexColor(requestedColorB, "#d98e32");
  const mixed = "#777777";
  const groupW = plotW / sieves.length;
  const barW = Math.min(72, groupW * 0.5);
  sieves.forEach((sieve, index) => {
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
    { color: mixed, label: "完全重叠区域" }
  ], pad.left, 17, width - pad.right);
}

function colorDistance(colorA, colorB) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function firstDistinctColor(color) {
  return PALETTE.find((candidate) => colorDistance(color, candidate) >= 100) || "#4dd0e1";
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
  const parentWidth = canvas.parentElement?.clientWidth || rect.width || 800;
  const width = Math.max(240, Math.round(parentWidth));
  const height = Math.round(width / 2);
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

function reportRuntimeFailure(reason) {
  const message = reason instanceof Error ? reason.message : String(reason || "未知错误");
  console.error("Grind-PSD runtime failure:", reason);
  const strip = $("networkText");
  if (strip) strip.textContent = `界面运行异常：${message}。请刷新页面以更新 App 缓存。`;
  const element = $("toast");
  if (element) {
    element.textContent = `界面运行异常：${message}`;
    element.className = "toast show error";
  }
}
