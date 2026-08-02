(function attachGrindPsdEditSyncV181(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrindPSDEditSyncV181 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGrindPsdEditSyncV181() {
  "use strict";

  const VERSION = "1.8.1";

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function cleanNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric * 1e6) / 1e6 : null;
  }

  function cleanDate(value) {
    const timestamp = Date.parse(String(value || ""));
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : cleanText(value);
  }

  function sortedObject(input) {
    return Object.fromEntries(Object.entries(input || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, typeof value === "number" ? cleanNumber(value) : value]));
  }

  function sieveProjection(record) {
    let bins = Array.isArray(record?.sieveProfile?.bins) ? record.sieveProfile.bins : [];
    if (!bins.length && typeof globalThis !== "undefined" && globalThis.GrindPSDCore?.getRecordSieves) {
      try { bins = globalThis.GrindPSDCore.getRecordSieves(record) || []; } catch (error) { bins = []; }
    }
    return bins.map((bin, index) => ({
      index,
      key: cleanText(bin?.key),
      mesh: cleanNumber(bin?.mesh),
      apertureUm: cleanNumber(bin?.apertureUm),
      range: cleanText(bin?.range),
      label: cleanText(bin?.label || bin?.shortLabel)
    }));
  }

  function recordContentProjection(record) {
    return {
      id: cleanText(record?.id),
      standardId: cleanText(record?.standardId),
      userId: cleanText(record?.user?.id),
      grinder: {
        brand: cleanText(record?.grinder?.brand),
        model: cleanText(record?.grinder?.model),
        setting: cleanText(record?.grinder?.setting),
        settingTurns: cleanNumber(record?.grinder?.settingTurns),
        settingOrder: cleanNumber(record?.grinder?.settingOrder),
        color: cleanText(record?.grinder?.color).toLowerCase()
      },
      sample: {
        doseG: cleanNumber(record?.sample?.doseG),
        bean: cleanText(record?.sample?.bean),
        roastLevel: cleanText(record?.sample?.roastLevel),
        method: cleanText(record?.sample?.method),
        durationSec: cleanNumber(record?.sample?.durationSec),
        sieveDevice: cleanText(record?.sample?.sieveDevice),
        replicate: cleanNumber(record?.sample?.replicate)
      },
      weightsGrams: sortedObject(record?.weightsGrams),
      sieveProfile: sieveProjection(record),
      notes: cleanText(record?.notes),
      createdAt: cleanDate(record?.createdAt)
    };
  }

  function recordContentSignature(record) {
    return JSON.stringify(recordContentProjection(record));
  }

  function partitionUnchangedRecords(localRecords, remoteRecords) {
    const remoteById = new Map((remoteRecords || []).map((record) => [cleanText(record?.id), record]));
    const upload = [];
    const skipped = [];
    (localRecords || []).forEach((record) => {
      const remote = remoteById.get(cleanText(record?.id));
      if (remote && recordContentSignature(record) === recordContentSignature(remote)) skipped.push(record);
      else upload.push(record);
    });
    return { upload, skipped };
  }

  function ownsRecord(record, currentUserId) {
    const owner = cleanText(record?.user?.id);
    const current = cleanText(currentUserId);
    return Boolean(owner && current && owner === current);
  }

  const api = Object.freeze({
    version: VERSION,
    recordContentProjection,
    recordContentSignature,
    partitionUnchangedRecords,
    ownsRecord
  });

  if (typeof document === "undefined") return api;

  const baseRenderRecordSummaryPanel = renderRecordSummaryPanel;
  const baseBindRecordSummaryActions = bindRecordSummaryActions;
  const baseBindRecordTableActions = bindRecordTableActions;
  const baseUploadRecordBatch = typeof uploadRecordBatch === "function" ? uploadRecordBatch : null;
  const baseOpenSubmissionIssue = typeof openSubmissionIssue === "function" ? openSubmissionIssue : null;

  function currentUserId() {
    return cleanText(state.store?.user?.id);
  }

  function findEditableRecord(id) {
    return state.store?.records?.find((record) => record.id === id)
      || state.communityRecords?.find((record) => record.id === id)
      || null;
  }

  function ensureLocalEditableRecord(record) {
    const existing = state.store.records.find((item) => item.id === record.id);
    if (existing) return existing;
    const staged = Core.normalizeRecord({ ...record, source: "cloud-readonly" });
    state.store.records = dedupeRecords([staged, ...state.store.records]);
    ensureCatalogEntry(state.store, staged.grinder.brand, staged.grinder.model, staged.grinder.color);
    saveStore();
    return staged;
  }

  function editRecord(id) {
    const candidate = findEditableRecord(id);
    if (!candidate) {
      toast("未找到需要编辑的记录。", "error");
      return false;
    }
    if (!state.identityConfirmed || state.store.user?.temporary) {
      openAuthModal();
      toast("编辑记录前请先登录本人账户。", "error");
      return false;
    }
    if (!ownsRecord(candidate, currentUserId())) {
      toast("只能编辑当前登录账户本人的记录。", "error");
      return false;
    }
    const record = ensureLocalEditableRecord(candidate);
    ensureCatalogEntry(state.store, record.grinder.brand, record.grinder.model, record.grinder.color);
    saveStore();
    switchTab("measure");
    openWizard({
      prefill: {
        mode: "edit-local",
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
        sieveProfile: record.sieveProfile,
        weightsGrams: Core.normalizeWeights(record.weightsGrams, Core.getRecordSieves(record))
      }
    });
    toast("已进入原记录编辑；保存后沿用同一隐藏记录 ID。", "success");
    return true;
  }

  renderRecordSummaryPanel = function renderRecordSummaryPanelV181(record, sourceLabel, options = {}) {
    let html = baseRenderRecordSummaryPanel(record, sourceLabel, options);
    if (!options.actions || !ownsRecord(record, currentUserId())) return html;
    if (html.includes('data-record-summary-action="edit"')) return html;
    return html.replace(
      '<div class="panel-actions">',
      '<div class="panel-actions"><button class="primary small" type="button" data-record-summary-action="edit">编辑本条记录</button>'
    );
  };

  bindRecordSummaryActions = function bindRecordSummaryActionsV181(container, record) {
    baseBindRecordSummaryActions(container, record);
    container.querySelectorAll('[data-record-summary-action="edit"]').forEach((button) => {
      button.addEventListener("click", () => editRecord(record.id));
    });
  };

  function installHistoryEditButtons(container, community) {
    container.querySelectorAll("[data-view-record]").forEach((viewButton) => {
      const id = viewButton.dataset.viewRecord;
      const record = community
        ? state.communityRecords.find((item) => item.id === id)
        : state.store.records.find((item) => item.id === id);
      const actions = viewButton.closest(".history-detail-actions, .row-actions");
      if (!actions) return;
      const oldButton = actions.querySelector("[data-edit-local], [data-edit-community], [data-edit-record-v181]");
      if (!record || !ownsRecord(record, currentUserId())) {
        oldButton?.remove();
        return;
      }
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.dataset.editRecordV181 = id;
      editButton.textContent = "编辑";
      if (oldButton) oldButton.replaceWith(editButton);
      else viewButton.insertAdjacentElement("afterend", editButton);
      editButton.addEventListener("click", () => editRecord(id));
    });
  }

  bindRecordTableActions = function bindRecordTableActionsV181(container, community) {
    baseBindRecordTableActions(container, community);
    installHistoryEditButtons(container, community);
  };

  function markSkippedAsVerified(records, remoteRecords) {
    const remoteById = new Map((remoteRecords || []).map((record) => [record.id, record]));
    state.store.cloudSync ||= {};
    const checkedAt = new Date().toISOString();
    records.forEach((record) => {
      state.store.cloudSync[record.id] = {
        status: "verified",
        recordUpdatedAt: record.updatedAt,
        checkedAt,
        verifiedAt: checkedAt,
        measurementId: state.store.cloudSync?.[record.id]?.measurementId || null,
        remoteUpdatedAt: remoteById.get(record.id)?.updatedAt || null,
        skippedUnchanged: true
      };
    });
    saveStore();
  }

  async function readRemoteSamples() {
    updateNetworkStatus("正在读取网络样本列表并比对本地内容…");
    const remote = await Cloud.pullRecords();
    return (remote || []).map(Core.normalizeRecord).filter(Boolean);
  }

  uploadAllRecordsToCloud = async function uploadAllRecordsToCloudV181() {
    if (!Cloud?.isSignedIn()) {
      openAuthModal();
      toast("请先登录云端账户，再执行上传。", "error");
      return false;
    }
    if (!navigator.onLine) {
      setCloudSyncIndicator("failed");
      toast("当前离线，无法读取网络样本列表。", "error");
      return false;
    }
    const localRecords = state.store.records.filter((record) => ownsRecord(record, currentUserId()));
    if (!localRecords.length) {
      toast("没有当前登录账户本人的可上传记录。", "error");
      return false;
    }

    setCloudSyncIndicator("syncing");
    let remoteRecords;
    try {
      remoteRecords = await readRemoteSamples();
    } catch (error) {
      setCloudSyncIndicator("failed");
      updateNetworkStatus(`网络样本列表读取失败，已停止上传：${error.message}`);
      toast(`上传前比对失败：${error.message}`, "error");
      return false;
    }

    const { upload, skipped } = partitionUnchangedRecords(localRecords, remoteRecords);
    if (skipped.length) markSkippedAsVerified(skipped, remoteRecords);
    if (!upload.length) {
      setCloudSyncIndicator("success");
      updateNetworkStatus(`无需上传 · ${skipped.length} 条记录已存在且内容未修改`);
      toast(`已跳过 ${skipped.length} 条未修改记录，没有重复上传。`, "success");
      renderAll();
      return true;
    }

    updateNetworkStatus(`比对完成：上传 ${upload.length} 条，跳过未修改 ${skipped.length} 条…`);
    const { uploaded, failures } = await pushRecordsIndividually(upload);
    if (!failures.length) {
      setCloudSyncIndicator("success");
      updateNetworkStatus(`上传完成 · 新增或修改 ${uploaded} 条，跳过 ${skipped.length} 条`);
      toast(`上传完成：${uploaded} 条已写入；${skipped.length} 条未修改记录已跳过。`, "success");
      renderAll();
      return true;
    }
    setCloudSyncIndicator("failed");
    updateNetworkStatus(`上传完成 ${uploaded}/${upload.length}；跳过 ${skipped.length}；失败 ${failures.length}`);
    toast(`上传失败：${failures[0].label || failures[0].id}：${failures[0].error}`, "error");
    renderAll();
    return false;
  };

  async function refreshCommunityForComparison() {
    if (!navigator.onLine || typeof syncCommunity !== "function") return false;
    await syncCommunity({ quiet: true });
    return Boolean(state.communityFresh);
  }

  if (baseUploadRecordBatch) {
    uploadRecordBatch = async function uploadRecordBatchV181(records) {
      const fresh = await refreshCommunityForComparison();
      if (!fresh) {
        toast("未能读取最新网络样本列表，已停止批量上传以避免重复。", "error");
        return false;
      }
      const { upload, skipped } = partitionUnchangedRecords(records, state.communityRecords);
      if (skipped.length) removeQueuedRecordIds(skipped.map((record) => record.id));
      if (!upload.length) {
        saveStore();
        renderSyncLog();
        toast(`已跳过 ${skipped.length} 条未修改的网络样本。`, "success");
        return true;
      }
      const submitted = await baseUploadRecordBatch(upload);
      if (submitted && skipped.length) {
        toast(`已提交 ${upload.length} 条新增或修改记录；跳过 ${skipped.length} 条未修改记录。`, "success");
      }
      return submitted;
    };
  }

  if (baseOpenSubmissionIssue) {
    openSubmissionIssue = async function openSubmissionIssueV181() {
      const record = getSelectedRecord();
      if (!record) return false;
      const fresh = await refreshCommunityForComparison();
      if (!fresh) {
        toast("未能读取最新网络样本列表，已停止上传以避免重复。", "error");
        return false;
      }
      const { upload, skipped } = partitionUnchangedRecords([record], state.communityRecords);
      if (!upload.length && skipped.length) {
        removeQueuedRecordIds([record.id]);
        saveStore();
        hideModal("submitModal");
        toast("该样本已上传且内容未修改，本次已自动跳过。", "success");
        return true;
      }
      return baseOpenSubmissionIssue();
    };
  }

  function installVersionLabel() {
    document.querySelector('meta[name="application-version"]')?.setAttribute("content", VERSION);
    const manifest = document.querySelector('link[rel="manifest"]');
    if (manifest) {
      const url = new URL(manifest.getAttribute("href"), document.baseURI);
      url.searchParams.set("v", VERSION);
      manifest.setAttribute("href", url.href);
    }
    const intro = document.querySelector("#settingsModal .modal-intro");
    if (intro) intro.textContent = String(intro.textContent || "").replace(/Grind-PSD\s+[0-9.]+/, `Grind-PSD ${VERSION}`);
    document.querySelectorAll("#settingsModal .app-about span").forEach((span) => {
      if (/^版本：/.test(span.textContent || "")) span.textContent = `版本：${VERSION}`;
    });
    document.documentElement.dataset.appVersion = VERSION;
  }

  function install() {
    if (root.__grindPsdEditSyncV181Installed) return;
    root.__grindPsdEditSyncV181Installed = true;
    installVersionLabel();
    if (state.activeTab === "history") renderHistory();
    if (state.activeTab === "array3d" || state.activeTab === "current") renderRecordDetail();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();

  return api;
});