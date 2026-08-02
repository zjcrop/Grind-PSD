(function attachGrindPsdEditEntryV17(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrindPSDEditEntryV17 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGrindPsdEditEntryV17() {
  "use strict";

  const VERSION = "1.7.0";

  function ownsRecord(record, currentUserId) {
    const owner = String(record?.user?.id || "").trim();
    const current = String(currentUserId || "").trim();
    return Boolean(owner && current && owner === current);
  }

  function parseOptionalTurns(value) {
    const text = String(value ?? "").trim();
    if (!text) return { valid: true, value: null };
    const numeric = Number(text);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return { valid: false, value: null };
    }
    return { valid: true, value: Math.round(numeric * 1000) / 1000 };
  }

  function nextEntryIndex(currentIndex, total) {
    const index = Number(currentIndex);
    const count = Math.max(0, Number(total) || 0);
    if (!Number.isInteger(index) || index < 0 || index >= count) return -1;
    return index + 1 < count ? index + 1 : -1;
  }

  const api = Object.freeze({ version: VERSION, ownsRecord, parseOptionalTurns, nextEntryIndex });
  if (typeof document === "undefined") return api;

  const root = typeof window !== "undefined" ? window : globalThis;
  const permissionRecordTable = recordTable;
  const localOnlySaveWizardRecord = saveWizardRecord;
  const baseGoWizardStep = goWizardStep;
  const baseCaptureWeighingStep = captureWeighingStep;

  function currentUserId() {
    return String(state.store?.user?.id || "");
  }

  function currentRecord(id) {
    return state.store?.records?.find((record) => record.id === id) || null;
  }

  function installVersionLabel() {
    document.querySelector('meta[name="application-version"]')?.setAttribute("content", VERSION);
    const intro = document.querySelector("#settingsModal .modal-intro");
    if (intro) intro.textContent = intro.textContent.replace(/Grind-PSD\s+[0-9.]+/, `Grind-PSD ${VERSION}`);
    document.querySelectorAll("#settingsModal .app-about span").forEach((span) => {
      if (/^版本：/.test(span.textContent || "")) span.textContent = `版本：${VERSION}`;
    });
    document.documentElement.dataset.appVersion = VERSION;
  }

  function installLayout() {
    const dose = document.getElementById("doseInput")?.closest("label");
    const turns = document.getElementById("turnsInput")?.closest("label");
    const step3 = document.getElementById("wizardStep3");
    if (!dose || !turns || !step3) return false;
    if (!step3.contains(turns)) dose.insertAdjacentElement("afterend", turns);
    turns.classList.add("weighing-turns-field");
    const turnsHelp = turns.querySelector(".field-help");
    if (turnsHelp) turnsHelp.textContent = "单独记录磨盘从零点旋出的圈数；可留空。按回车确认并进入下一项。";
    document.getElementById("doseInput")?.setAttribute("enterkeyhint", "next");
    document.getElementById("turnsInput")?.setAttribute("enterkeyhint", "next");
    installEntryHints();
    return true;
  }

  function installEntryHints() {
    const inputs = finalEntryInputs();
    inputs.forEach((input, index) => {
      input.setAttribute("enterkeyhint", index === inputs.length - 1 ? "done" : "next");
      input.setAttribute("autocomplete", "off");
    });
  }

  function finalEntryInputs() {
    return [
      document.getElementById("doseInput"),
      document.getElementById("turnsInput"),
      ...document.querySelectorAll("#weighRows input[data-weight]")
    ].filter(Boolean);
  }

  function commitTurns({ notify = false } = {}) {
    const input = document.getElementById("turnsInput");
    const parsed = parseOptionalTurns(input?.value);
    if (!parsed.valid) {
      if (notify) toast("研磨圈数必须是大于或等于 0 的数字，或留空。", "error");
      input?.focus();
      return false;
    }
    state.wizard.settingTurns = parsed.value;
    return true;
  }

  captureWeighingStep = function captureWeighingStepV17() {
    baseCaptureWeighingStep();
    return commitTurns({ notify: false });
  };

  returnFromWeighingStep = function returnFromWeighingStepV17() {
    baseCaptureWeighingStep();
    if (!commitTurns({ notify: true })) return;
    goWizardStep(2);
  };

  function focusInput(input) {
    if (!input) return;
    input.focus({ preventScroll: true });
    if (typeof input.select === "function" && input.value !== "") input.select();
    input.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function focusFinalFirst() {
    const step3 = document.getElementById("wizardStep3");
    if (!step3 || step3.hidden) return;
    installEntryHints();
    focusInput(document.getElementById("doseInput"));
  }

  goWizardStep = function goWizardStepV17(step) {
    const result = baseGoWizardStep(step);
    if (Number(step) === 3 && !document.getElementById("wizardStep3")?.hidden) {
      setTimeout(focusFinalFirst, 75);
    }
    return result;
  };

  function confirmEntry(input) {
    if (!input) return false;
    if (input.id === "doseInput") {
      const value = Number(input.value);
      if (!Number.isFinite(value) || value <= 0 || value > 200) {
        toast("豆子初始质量必须大于 0 且不超过 200 g。", "error");
        focusInput(input);
        return false;
      }
      state.wizard.doseG = value;
      updateWeightSummary();
      return true;
    }
    if (input.id === "turnsInput") return commitTurns({ notify: true });
    if (input.matches("#weighRows input[data-weight]")) {
      const text = input.value.trim();
      const value = text === "" ? 0 : Number(text);
      if (!Number.isFinite(value) || value < 0 || value > 200) {
        toast("分段粉重必须在 0–200 g 范围内。", "error");
        focusInput(input);
        return false;
      }
      state.wizard.weightsGrams = readWeightInputs();
      updateWeightSummary();
      return true;
    }
    return false;
  }

  function bindFinalEntryFlow() {
    const step3 = document.getElementById("wizardStep3");
    if (!step3 || step3.dataset.enterFlowV17 === "true") return;
    step3.dataset.enterFlowV17 = "true";
    step3.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.code !== "NumpadEnter") return;
      const input = event.target.closest("input");
      const entries = finalEntryInputs();
      const index = entries.indexOf(input);
      if (index < 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (!confirmEntry(input)) return;
      const next = nextEntryIndex(index, entries.length);
      if (next >= 0) focusInput(entries[next]);
      else document.getElementById("saveRecordBtn")?.focus({ preventScroll: true });
    }, true);
    document.getElementById("turnsInput")?.addEventListener("change", () => commitTurns({ notify: true }));
  }

  recordTable = function recordTableV17(records, options = {}) {
    let html = permissionRecordTable(records, options);
    if (options.community) return html;
    return html.replace(
      /<button type="button" data-edit-local="([^"]+)">编辑本地<\/button>/g,
      (markup, id) => ownsRecord(currentRecord(id), currentUserId())
        ? `<button type="button" data-edit-local="${id}">编辑</button>`
        : ""
    );
  };

  async function uploadEditedRecord(record) {
    if (!Cloud?.isSignedIn() || !navigator.onLine) {
      markCloudSync(record, "pending", { error: "等待联网后覆盖同一云端记录" });
      updateNetworkStatus("编辑已保存到本机；联网后可按同一记录编码覆盖云端");
      toast("编辑已保存到本机；当前离线，云端同记录覆盖将在下次上传时完成。", "success");
      return false;
    }
    setCloudSyncIndicator("syncing");
    updateNetworkStatus("正在按同一隐藏记录编码覆盖本人云端测次…");
    try {
      await pushAndVerifyRecord(record);
      setCloudSyncIndicator("success");
      updateNetworkStatus("编辑已覆盖同一云端测次，并完成回读校验");
      toast("编辑成功：本地记录与同一云端测次已更新一致。", "success");
      renderAll();
      return true;
    } catch (error) {
      markCloudSync(record, "failed", { error: error.message });
      setCloudSyncIndicator("failed");
      updateNetworkStatus(`本地编辑已保存；同记录云端覆盖失败：${error.message}`);
      toast(`本地编辑已保存；云端覆盖失败：${error.message}`, "error");
      return false;
    }
  }

  saveWizardRecord = async function saveWizardRecordV17() {
    const mode = state.wizard?.mode || "create";
    const editing = mode === "edit-local" || mode === "edit-remote";
    const targetId = state.wizard?.targetRecordId || null;
    const before = targetId ? currentRecord(targetId) : null;
    const previousUpdatedAt = before?.updatedAt || null;
    if (editing && (!before || !ownsRecord(before, currentUserId()))) {
      toast("只能编辑当前登录账户本人的记录。", "error");
      return false;
    }
    if (!commitTurns({ notify: true })) return false;
    await localOnlySaveWizardRecord();
    if (!editing || !targetId) return true;
    const saved = currentRecord(targetId);
    if (!saved || saved.updatedAt === previousUpdatedAt) return false;
    return uploadEditedRecord(saved);
  };

  uploadAllRecordsToCloud = async function uploadOwnRecordsToCloudV17() {
    if (!Cloud?.isSignedIn()) {
      openAuthModal();
      toast("请先登录云端账户，再执行上传。", "error");
      return false;
    }
    if (!navigator.onLine) {
      setCloudSyncIndicator("failed");
      toast("当前离线，无法上传到服务器。", "error");
      return false;
    }
    const records = state.store.records.filter((record) => ownsRecord(record, currentUserId()));
    if (!records.length) {
      toast("没有当前登录账户本人的可上传记录。", "error");
      return false;
    }
    setCloudSyncIndicator("syncing");
    updateNetworkStatus(`正在上传并校验本人 ${records.length} 条记录…`);
    const { uploaded, failures } = await pushRecordsIndividually(records);
    if (!failures.length) {
      setCloudSyncIndicator("success");
      updateNetworkStatus(`本人记录上传完成 · ${uploaded} 条；同编码记录已覆盖`);
      toast(`上传成功：本人 ${uploaded} 条记录已写入并回读校验。`, "success");
      renderAll();
      return true;
    }
    setCloudSyncIndicator("failed");
    updateNetworkStatus(`本人记录上传完成 ${uploaded}/${records.length}；失败 ${failures.length} 条`);
    toast(`上传失败：${failures[0].label || failures[0].id}：${failures[0].error}`, "error");
    renderAll();
    return false;
  };

  function injectStyles() {
    if (document.getElementById("editEntryV17Styles")) return;
    const style = document.createElement("style");
    style.id = "editEntryV17Styles";
    style.textContent = `
      #wizardStep3 .weighing-turns-field{margin:0 0 12px}
      #wizardStep3 .weighing-turns-field input{max-width:100%}
      #wizardStep3 input:focus{scroll-margin-block:110px}
    `;
    document.head.appendChild(style);
  }

  function install() {
    if (root.__grindPsdEditEntryV17Installed) return;
    root.__grindPsdEditEntryV17Installed = true;
    injectStyles();
    installVersionLabel();
    installLayout();
    bindFinalEntryFlow();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }

  return api;
});
