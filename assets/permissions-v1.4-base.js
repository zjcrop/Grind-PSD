"use strict";

(function applyGrindPsdPermissionsV14() {
  const Policy = window.GrindPSDPolicyCore;
  if (!Policy || !window.GrindPSDCloud || !window.GrindPSDCore) {
    throw new Error("Grind-PSD v1.4 permission dependencies failed to load.");
  }

  const ADMIN_EMAIL = "zj_crop@163.com";
  const SUPABASE_URL = "https://phwqpxmnrogddrajwpqm.supabase.co";
  const SUPABASE_KEY = "sb_publishable_owicJe5BeJ-4e1ckFwGBjA_luAdvDCO";
  const SESSION_KEY = "grindPsdSupabaseSessionV1";
  const EMAIL_CACHE_KEY = "grindPsdAccountEmailV1";
  const SOURCE_APP = "grind-psd";
  const LOCAL_HIDDEN_KEY = "localHiddenCloudIds";

  const originalCloudPushRecord = Cloud.pushRecord.bind(Cloud);
  const originalOpenWizard = openWizard;
  const originalCloneAsRetest = cloneAsRetest;
  const originalSaveWizardRecord = saveWizardRecord;
  const originalRecordTable = recordTable;
  const originalBindRecordTableActions = bindRecordTableActions;
  const originalRenderRecordDetail = renderRecordDetail;
  const originalUpdateActiveUser = updateActiveUser;

  function session() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
    } catch (error) {
      return null;
    }
  }

  function currentAccountEmail() {
    const live = String(Cloud.user()?.email || "").trim().toLowerCase();
    if (live) {
      try { localStorage.setItem(EMAIL_CACHE_KEY, live); } catch (error) { /* optional cache */ }
      return live;
    }
    try {
      return String(localStorage.getItem(EMAIL_CACHE_KEY) || "").trim().toLowerCase();
    } catch (error) {
      return "";
    }
  }

  function isAdminAccount() {
    return currentAccountEmail() === ADMIN_EMAIL;
  }

  function ensurePolicyState() {
    if (!Array.isArray(state.store?.[LOCAL_HIDDEN_KEY])) state.store[LOCAL_HIDDEN_KEY] = [];
    return state.store[LOCAL_HIDDEN_KEY];
  }

  function hiddenCloudIds() {
    return new Set(ensurePolicyState().map((id) => String(id || "")));
  }

  function canManageLocalRecord(record) {
    if (isAdminAccount()) return true;
    if (record?.user?.id === state.store.user.id) return true;
    return Boolean(state.store.cloudSync?.[record?.id]?.ownedByCurrentAccount);
  }

  function createHiddenRecordId() {
    return Policy.createRecordId({
      userId: state.store?.user?.id || "xx",
      email: currentAccountEmail(),
      now: new Date(),
      existingIds: (state.store?.records || []).map((record) => record.id)
    });
  }

  async function supabaseRequest(path, options = {}, retried = false) {
    const active = session();
    if (!active?.access_token) throw new Error("尚未登录云端账户");
    const response = await fetch(`${SUPABASE_URL}${path}`, {
      method: options.method || "GET",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${active.access_token}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store"
    });
    if (response.status === 401 && !retried) {
      await Cloud.profile().catch(() => null);
      return supabaseRequest(path, options, true);
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (error) { data = text; }
    }
    if (!response.ok) {
      const message = data?.message || data?.hint || data?.details || data?.error || data || `HTTP ${response.status}`;
      throw new Error(String(message).slice(0, 400));
    }
    return data;
  }

  function upsert(table, rows, onConflict) {
    return supabaseRequest(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: rows
    });
  }

  function rpc(name, body) {
    return supabaseRequest(`/rest/v1/rpc/${name}`, {
      method: "POST",
      body
    });
  }

  function cloudSieveRows(record) {
    const profile = Array.isArray(record.sieveProfile?.bins) ? record.sieveProfile.bins : [];
    const weights = record.weightsGrams || {};
    const bins = profile.length ? profile : Core.getRecordSieves(record);
    const intervals = Policy.recordIntervals(record, Core.getRecordSieves);
    return bins.map((item, ordinal) => ({
      ordinal,
      label: item.shortLabel || item.label || item.range || `分段${ordinal + 1}`,
      lower_um: item.apertureUm ?? intervals[ordinal]?.lowerUm ?? null,
      upper_um: intervals[ordinal]?.upperUm ?? null,
      mass_g: Number(weights[item.key] || 0),
      percentage: record.totalG ? Number(weights[item.key] || 0) / Number(record.totalG) * 100 : 0,
      legacy_merged: Boolean(record.standardId === "grind-psd-sieve-v1" || item.legacyMerged)
    }));
  }

  async function pushRecordWithImmutableId(record, deviceInstanceId) {
    if (!record?.id) throw new Error("记录缺少隐藏唯一编码");
    const active = session();
    const uid = active?.user?.id || Cloud.user()?.id;
    if (!uid) throw new Error("尚未登录云端账户");
    const recordId = encodeURIComponent(String(record.id));
    let existing = [];
    try {
      existing = await supabaseRequest(
        `/rest/v1/measurements?select=id,user_id,grinder_id&source_app=eq.${SOURCE_APP}&source_record_id=eq.${recordId}&limit=1`
      );
    } catch (error) {
      if (!isAdminAccount()) return originalCloudPushRecord(record, deviceInstanceId);
      throw error;
    }
    const current = existing?.[0] || null;
    if (current && current.user_id !== uid && !isAdminAccount()) {
      throw new Error("该隐藏测试编码属于其他账户，禁止覆盖");
    }
    const ownerId = current?.user_id || uid;
    let grinderId = current?.grinder_id || null;
    if (!grinderId) {
      const grinderKey = `${record.grinder?.brand || ""}|${record.grinder?.model || ""}`;
      const grinders = await upsert("grinders", [{
        user_id: ownerId,
        brand: record.grinder?.brand || null,
        model: record.grinder?.model || "未命名设备",
        nickname: null,
        source_app: SOURCE_APP,
        source_record_id: grinderKey,
        schema_version: 1,
        deleted_at: null
      }], "user_id,source_app,source_record_id");
      grinderId = grinders?.[0]?.id || null;
    }
    const measurements = await upsert("measurements", [{
      user_id: ownerId,
      grinder_id: grinderId,
      measured_at: record.createdAt || new Date().toISOString(),
      grind_setting: String(record.grinder?.setting || ""),
      total_mass_g: Number(record.totalG || 0),
      reliability: ({ A: 5, B: 4, C: 3, D: 1 }[record.metrics?.quality?.grade] || null),
      quality_label: record.metrics?.quality?.grade || "U",
      notes: record.notes || null,
      distribution_schema: record.standardId === "grind-psd-sieve-v1"
        ? "legacy-five-bin"
        : (String(record.standardId || "").startsWith("custom-") ? "custom" : "sieve-v2"),
      legacy_payload: record,
      source_app: SOURCE_APP,
      source_record_id: record.id,
      device_instance_id: deviceInstanceId || null,
      schema_version: 2,
      deleted_at: null
    }], "user_id,source_app,source_record_id");
    const measurementId = measurements?.[0]?.id || current?.id;
    if (!measurementId) throw new Error("云端测次写入失败");
    const fractions = cloudSieveRows(record);
    try {
      await rpc("replace_measurement_fractions", {
        p_measurement_id: measurementId,
        p_rows: fractions
      });
    } catch (error) {
      if (!isAdminAccount()) return originalCloudPushRecord(record, deviceInstanceId);
      throw new Error(`管理员写入需要先应用 v1.4 数据库迁移：${error.message}`);
    }
    return measurementId;
  }

  Cloud.pushRecord = pushRecordWithImmutableId;
  Cloud.isAdmin = isAdminAccount;
  Cloud.deleteRecord = async function deleteRecordFromCloud(recordId) {
    if (!isAdminAccount()) throw new Error("仅管理员可删除云端记录");
    return rpc("admin_delete_grind_psd_record", { p_source_record_id: String(recordId || "") });
  };

  openWizard = function openWizardV14(options = {}) {
    originalOpenWizard(options);
    if (state.wizard.mode === "create" && !state.wizard.targetRecordId) {
      state.wizard.targetRecordId = createHiddenRecordId();
    }
    if (state.wizard.mode === "edit-local") {
      state.wizard.doseG = options.prefill?.doseG ?? state.wizard.doseG;
      $("wizardTitle").textContent = "编辑本地测试结果";
    }
  };

  cloneAsRetest = function cloneAsRetestV14(id) {
    originalCloneAsRetest(id);
    if (state.wizard?.mode === "create" && !state.wizard.targetRecordId) {
      state.wizard.targetRecordId = createHiddenRecordId();
    }
  };

  saveWizardRecord = async function saveWizardRecordV14() {
    const originalIsSignedIn = Cloud.isSignedIn;
    Cloud.isSignedIn = () => false;
    try {
      return await originalSaveWizardRecord();
    } finally {
      Cloud.isSignedIn = originalIsSignedIn;
    }
  };

  function editLocalRecord(id) {
    const record = state.store.records.find((item) => item.id === id);
    if (!record) return;
    if (!state.identityConfirmed || state.store.user.temporary) {
      openAuthModal();
      toast("编辑记录前请先登录。", "error");
      return;
    }
    if (!canManageLocalRecord(record)) {
      toast("普通账户只能编辑自己的本地记录。", "error");
      return;
    }
    ensureCatalogEntry(state.store, record.grinder.brand, record.grinder.model, record.grinder.color);
    saveStore();
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
    toast("当前修改仅写入本地；确认属于同一次测试后，可手动上传并按隐藏编码覆盖云端。", "success");
  }

  async function deleteCloudRecordAsAdmin(id) {
    if (!isAdminAccount()) {
      toast("仅管理员可删除云端记录。", "error");
      return;
    }
    const record = state.store.records.find((item) => item.id === id);
    if (!record) return;
    if (!window.confirm(`确认从云端删除 ${record.grinder.brand} ${record.grinder.model} · 刻度 ${record.grinder.setting}？`)) return;
    try {
      await Cloud.deleteRecord(id);
      state.store.records = state.store.records.filter((item) => item.id !== id);
      state.store[LOCAL_HIDDEN_KEY] = ensurePolicyState().filter((item) => item !== id);
      if (state.store.cloudSync) delete state.store.cloudSync[id];
      saveStore();
      renderAll();
      toast("管理员已删除云端记录及当前本地副本。", "success");
    } catch (error) {
      toast(`云端删除失败：${error.message}`, "error");
    }
  }

  recordTable = function recordTableV14(records, options = {}) {
    let html = originalRecordTable(records, options);
    html = html
      .replace(/\s*<button type="button" data-edit-community="[^"]+">编辑<\/button>/g, "")
      .replace(/\s*<button class="danger-inline" type="button" data-delete-community="[^"]+">删除<\/button>/g, "");
    if (!options.community) {
      html = html.replace(
        /<button type="button" data-clone-record="([^"]+)">复测<\/button>/g,
        '<button type="button" data-edit-local="$1">编辑本地</button><button type="button" data-clone-record="$1">复测</button>'
      );
      if (isAdminAccount()) {
        html = html.replace(
          /<button type="button" data-delete-record="([^"]+)">删除<\/button>/g,
          '<button type="button" data-delete-record="$1">删除本地</button><button class="danger-inline" type="button" data-delete-cloud="$1">删除云端</button>'
        );
      }
    }
    return html;
  };

  bindRecordTableActions = function bindRecordTableActionsV14(container, community) {
    originalBindRecordTableActions(container, community);
    container.querySelectorAll("[data-edit-local]").forEach((button) => {
      button.addEventListener("click", () => editLocalRecord(button.dataset.editLocal));
    });
    container.querySelectorAll("[data-delete-cloud]").forEach((button) => {
      button.addEventListener("click", () => deleteCloudRecordAsAdmin(button.dataset.deleteCloud));
    });
  };

  deleteLocalRecord = function deleteLocalRecordV14(id) {
    const record = state.store.records.find((item) => item.id === id);
    if (!record) return;
    if (!canManageLocalRecord(record)) {
      toast("普通账户只能删除自己的本地记录。", "error");
      return;
    }
    if (!window.confirm(`删除本地副本：${record.grinder.brand} ${record.grinder.model} · 刻度 ${record.grinder.setting}？云端记录不会被删除。`)) return;
    if (isCloudVerified(record) || record.source === "cloud-readonly") {
      state.store[LOCAL_HIDDEN_KEY] = [...hiddenCloudIds(), id];
    }
    state.store.records = state.store.records.filter((item) => item.id !== id);
    if (state.selectedRecordId === id) {
      state.selectedRecordId = state.store.records[0]?.id || null;
      state.selectedRecordSource = "local";
    }
    saveStore();
    renderAll();
    toast("本地副本已删除；云端数据保持不变。", "success");
  };

  clearLocalRecords = function clearLocalRecordsV14() {
    if (!state.store.records.length) return;
    if (!window.confirm(`确定清空 ${state.store.records.length} 条本地记录？云端记录不会删除。建议先导出备份。`)) return;
    const hidden = hiddenCloudIds();
    state.store.records.forEach((record) => {
      if (isCloudVerified(record) || record.source === "cloud-readonly") hidden.add(record.id);
    });
    state.store[LOCAL_HIDDEN_KEY] = [...hidden];
    state.store.records = [];
    state.selectedRecordId = null;
    state.selectedRecordSource = "local";
    saveStore();
    renderAll();
    toast("本地记录已清空；云端数据未修改。", "success");
  };

  syncCloudRecords = async function syncCloudRecordsReadOnly({ quiet = false } = {}) {
    if (!Cloud?.isSignedIn() || !navigator.onLine) return false;
    try {
      updateNetworkStatus("正在以只读方式核对云端记录…");
      const remote = (await Cloud.pullRecords()).map(Core.normalizeRecord).filter(Boolean);
      const hidden = hiddenCloudIds();
      const merged = new Map(state.store.records.map((record) => [record.id, record]));
      remote.forEach((record) => {
        state.store.cloudSync ||= {};
        state.store.cloudSync[record.id] = {
          status: "verified",
          recordUpdatedAt: record.updatedAt,
          checkedAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
          ownedByCurrentAccount: !isAdminAccount()
        };
        if (hidden.has(record.id)) return;
        const local = merged.get(record.id);
        if (!local || local.source === "cloud-readonly") {
          merged.set(record.id, Core.normalizeRecord({ ...record, source: "cloud-readonly" }));
        }
      });
      state.store.records = dedupeRecords([...merged.values()]);
      saveStore();
      renderAll();
      updateNetworkStatus(`云端只读核对完成 · ${remote.length} 条可见记录`);
      setCloudSyncIndicator("success");
      if (!quiet) toast("云端记录已只读载入；未执行上传、修改或删除。", "success");
      return true;
    } catch (error) {
      setCloudSyncIndicator("failed");
      updateNetworkStatus(`云端只读核对失败，本地记录安全：${error.message}`);
      if (!quiet) toast(`云端核对失败：${error.message}`, "error");
      return false;
    }
  };

  uploadAllRecordsToCloud = async function uploadAllRecordsToCloudV14() {
    if (!Cloud?.isSignedIn()) {
      openAuthModal();
      toast("请先登录云端账户，再执行显式上传。", "error");
      return false;
    }
    if (!navigator.onLine) {
      setCloudSyncIndicator("failed");
      toast("当前离线，无法上传到服务器。", "error");
      return false;
    }
    const localRecords = state.store.records.filter((record) => canManageLocalRecord(record));
    if (!localRecords.length) {
      toast("没有当前账户可上传的本地记录。", "error");
      return false;
    }
    setCloudSyncIndicator("syncing");
    updateNetworkStatus(`正在按隐藏测试编码上传并校验 ${localRecords.length} 条本地记录…`);
    const { uploaded, failures } = await pushRecordsIndividually(localRecords);
    if (!failures.length) {
      setCloudSyncIndicator("success");
      updateNetworkStatus(`显式上传完成 · ${uploaded} 条；同编码记录已覆盖`);
      toast(`上传成功：${uploaded} 条记录已按隐藏编码写入并回读校验。`, "success");
      renderAll();
      return true;
    }
    setCloudSyncIndicator("failed");
    const first = failures[0];
    updateNetworkStatus(`上传完成 ${uploaded}/${localRecords.length}；失败 ${failures.length} 条`);
    toast(`上传失败：${first.label || first.id}：${first.error}`, "error");
    renderAll();
    return false;
  };

  updateActiveUser = function updateActiveUserV14() {
    originalUpdateActiveUser();
    if (isAdminAccount() && $("activeUserText")) {
      $("activeUserText").textContent += " · 管理员";
    }
  };

  renderRecordDetail = function renderRecordDetailV14() {
    originalRenderRecordDetail();
    const count = state.selectedHistoryIds?.size || 0;
    if ($("recordDetailUnit")) {
      $("recordDetailUnit").disabled = count > 1;
      if (count > 1) {
        $("recordDetailUnit").value = "pct";
        $("recordDetailUnit").title = "多记录对比固定使用百分比；不同总粉量可直接比较";
      } else {
        $("recordDetailUnit").title = "";
      }
    }
  };

  drawMultiRecord3D = function drawMultiRecord3DV14(canvas, records, unit = "pct", noteElement = null) {
    const { ctx, width, height } = setupCanvas(canvas);
    const rows = (records || []).slice(0, MAX_COMPARE_RECORDS);
    if (rows.length < 2) {
      drawEmptyCanvas(ctx, width, height, "请在历史记录中选择 2–10 条测次");
      if (noteElement) noteElement.textContent = "筛选记录后勾选需要对比的测次，再点击“对比所选”。";
      return;
    }
    const aligned = Policy.alignPercentageDistributions(rows, Core.getRecordSieves);
    const bins = aligned.bins;
    const series = aligned.series;
    const maxValue = Math.max(...series.flatMap((item) => item.values), 1) * 1.12;
    const compact = width < 520;
    const pad = { left: compact ? 40 : 58, right: compact ? 44 : 72, top: 24, bottom: compact ? 48 : 62 };
    const depthTotal = Math.min(width * 0.22, height * 0.3);
    const stepX = depthTotal / Math.max(1, series.length);
    const stepY = stepX * 0.55;
    const plotW = width - pad.left - pad.right - depthTotal;
    const plotH = height - pad.top - pad.bottom - depthTotal * 0.55;
    const cellW = plotW / Math.max(1, bins.length);
    const barW = Math.max(3, Math.min(42, cellW * 0.48));
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
      ctx.fillText(`${formatPlainNumber(value, 0)}%`, pad.left - 5, y + 3);
    }

    for (let rowIndex = series.length - 1; rowIndex >= 0; rowIndex -= 1) {
      const values = series[rowIndex].values;
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
    ctx.font = `${compact ? 7 : 9}px sans-serif`;
    ctx.textAlign = "center";
    bins.forEach((bin, index) => {
      const label = bin.shortLabel.length > 10 ? `${bin.shortLabel.slice(0, 9)}…` : bin.shortLabel;
      ctx.fillText(label, pad.left + cellW * (index + 0.5), baseY + 18);
    });
    if (noteElement) {
      noteElement.textContent = `${series.length} 条测次已按实际粒径区间对齐并统一换算为百分比；缺失区间按 0% 补全。不同边界不做主观拆分或插值。`;
    }
  };

  window.GrindPSDPermissionsV14 = Object.freeze({
    version: "1.4.0",
    adminEmail: ADMIN_EMAIL,
    isAdminAccount,
    createHiddenRecordId
  });
})();
