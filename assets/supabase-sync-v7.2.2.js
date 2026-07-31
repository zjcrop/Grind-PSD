"use strict";

(function () {
  const SUPABASE_URL = "https://phwqpxmnrogddrajwpqm.supabase.co";
  const KEY = "sb_publishable_owicJe5BeJ-4e1ckFwGBjA_luAdvDCO";
  const SESSION_KEY = "grindPsdSupabaseSessionV1";
  const SOURCE_APP = "grind-psd";
  const REQUEST_TIMEOUT_MS = 20_000;
  const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
  let session = null;
  let redirectNotice = null;
  let refreshPromise = null;

  function authRedirectUrl() {
    const url = new URL("./", window.location.href);
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  function saveSession(value) {
    session = value && value.access_token ? value : null;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }

  function errorMessage(data, status) {
    if (typeof data === "string" && data.trim()) return data.trim().slice(0, 300);
    return data?.msg
      || data?.message
      || data?.error_description
      || data?.error
      || `HTTP ${status}`;
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function performRequest(path, options = {}) {
    const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
    const headers = {
      apikey: KEY,
      ...(fetchOptions.body ? { "Content-Type": "application/json" } : {}),
      ...(fetchOptions.headers || {})
    };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let response;
    try {
      response = await fetch(`${SUPABASE_URL}${path}`, {
        ...fetchOptions,
        headers,
        cache: "no-store",
        ...(controller ? { signal: controller.signal } : {})
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("连接服务器超时，请检查网络后重试");
      throw new Error(`无法连接服务器：${error?.message || "网络请求失败"}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = text;
      }
    }
    return { response, data };
  }

  async function request(path, options = {}) {
    const retryable = path.startsWith("/rest/v1/") && options.retry !== false;
    const requestOptions = { ...options };
    delete requestOptions.retry;
    let result;
    try {
      result = await performRequest(path, requestOptions);
    } catch (error) {
      if (!retryable) throw error;
      await wait(400);
      result = await performRequest(path, requestOptions);
    }
    if (
      result.response.status === 401
      && session?.refresh_token
      && !path.startsWith("/auth/v1/token")
    ) {
      const refreshed = await refresh();
      if (refreshed) result = await performRequest(path, requestOptions);
    }
    if (retryable && TRANSIENT_STATUS.has(result.response.status)) {
      await wait(500);
      result = await performRequest(path, requestOptions);
    }
    if (!result.response.ok) {
      throw new Error(errorMessage(result.data, result.response.status));
    }
    return result.data;
  }

  async function refresh() {
    if (!session?.refresh_token) return null;
    if (!refreshPromise) {
      refreshPromise = (async () => {
        try {
          const result = await performRequest("/auth/v1/token?grant_type=refresh_token", {
            method: "POST",
            body: JSON.stringify({ refresh_token: session.refresh_token })
          });
          if (!result.response.ok) {
            const error = new Error(errorMessage(result.data, result.response.status));
            error.status = result.response.status;
            throw error;
          }
          saveSession(result.data);
          return result.data;
        } catch (error) {
          if ([400, 401].includes(error?.status)) saveSession(null);
          return null;
        } finally {
          refreshPromise = null;
        }
      })();
    }
    return refreshPromise;
  }

  async function init() {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.has("access_token")) {
      const expiresIn = Number(hash.get("expires_in") || 0);
      saveSession({
        access_token: hash.get("access_token"),
        refresh_token: hash.get("refresh_token"),
        token_type: hash.get("token_type") || "bearer",
        expires_in: expiresIn,
        expires_at: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : null,
        user: null
      });
      try {
        const user = await request("/auth/v1/user", { method: "GET" });
        saveSession({ ...session, user });
        redirectNotice = { type: "success", message: "邮箱验证完成，云端会话已建立。" };
      } catch (error) {
        saveSession(null);
        redirectNotice = { type: "error", message: "邮箱已验证，但登录会话建立失败，请使用邮箱和密码登录。" };
      }
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    } else if (hash.has("error")) {
      const code = hash.get("error_code") || hash.get("error");
      redirectNotice = {
        type: "error",
        message: code === "otp_expired"
          ? "邮箱验证链接已失效，请在登录页重新注册或重发验证邮件。"
          : `邮箱验证失败：${hash.get("error_description") || code}`
      };
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
    try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (error) { session = null; }
    if (!session) return null;
    const expiresAt = Number(session.expires_at || 0) * 1000;
    if (expiresAt && expiresAt < Date.now() + 60000) await refresh();
    return session;
  }

  async function signIn(email, password) {
    const value = await request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    saveSession(value);
    return value;
  }

  async function signUp(email, password, handle, displayName) {
    const value = await request(`/auth/v1/signup?redirect_to=${encodeURIComponent(authRedirectUrl())}`, {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        data: { handle, display_name: displayName || handle }
      })
    });
    if (value?.access_token) saveSession(value);
    if (value?.user && value?.access_token) {
      await upsert("profiles", [{
        user_id: value.user.id,
        handle,
        display_name: displayName || handle
      }], "user_id");
    }
    return value;
  }

  async function signOut() {
    if (session?.access_token) {
      try { await request("/auth/v1/logout", { method: "POST" }); } catch (error) { /* local logout still succeeds */ }
    }
    saveSession(null);
  }

  async function select(table, query = "") {
    return request(`/rest/v1/${table}?${query}`, { headers: { Accept: "application/json" } });
  }

  async function upsert(table, rows, onConflict) {
    return request(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
        Accept: "application/json"
      },
      body: JSON.stringify(rows)
    });
  }

  async function profile() {
    if (!session?.user?.id) return null;
    const rows = await select("profiles", `select=user_id,handle,display_name&user_id=eq.${session.user.id}`);
    return rows[0] || null;
  }

  function sieveRows(record) {
    const profile = Array.isArray(record.sieveProfile?.bins) ? record.sieveProfile.bins : [];
    const weights = record.weightsGrams || {};
    if (profile.length) return profile.map((item, ordinal) => ({
      ordinal,
      label: item.shortLabel || item.label || item.range || `分段${ordinal + 1}`,
      lower_um: item.lowerUm ?? null,
      upper_um: item.upperUm ?? null,
      mass_g: Number(weights[item.key] || 0),
      percentage: record.totalG ? Number(weights[item.key] || 0) / Number(record.totalG) * 100 : null,
      legacy_merged: Boolean(record.standardId === "grind-psd-sieve-v1" || item.legacyMerged)
    }));
    return Object.entries(weights).map(([key, value], ordinal) => ({
      ordinal, label: key, lower_um: null, upper_um: null, mass_g: Number(value || 0),
      percentage: record.totalG ? Number(value || 0) / Number(record.totalG) * 100 : null,
      legacy_merged: Boolean(record.standardId === "grind-psd-sieve-v1")
    }));
  }

  function nearlyEqual(left, right, tolerance = 0.0001) {
    if (left === null || left === undefined || right === null || right === undefined) {
      return left == null && right == null;
    }
    return Math.abs(Number(left) - Number(right)) <= tolerance;
  }

  async function verifyRecord(record) {
    if (!session?.user?.id) throw new Error("尚未登录云端账户");
    const recordId = encodeURIComponent(String(record.id || ""));
    const rows = await select("measurements",
      `select=id,legacy_payload,total_mass_g,quality_label,measurement_fractions(ordinal,label,lower_um,upper_um,mass_g,percentage,legacy_merged)&deleted_at=is.null&source_app=eq.${SOURCE_APP}&source_record_id=eq.${recordId}&limit=1`);
    const cloud = rows[0];
    if (!cloud) throw new Error("服务器回读不到刚上传的记录");

    const payload = cloud.legacy_payload || {};
    const expectedFractions = sieveRows(record).sort((a, b) => a.ordinal - b.ordinal);
    const actualFractions = [...(cloud.measurement_fractions || [])].sort((a, b) => a.ordinal - b.ordinal);
    const sameHeader = payload.id === record.id
      && payload.updatedAt === record.updatedAt
      && payload.grinder?.brand === record.grinder?.brand
      && payload.grinder?.model === record.grinder?.model
      && String(payload.grinder?.setting || "") === String(record.grinder?.setting || "")
      && nearlyEqual(payload.grinder?.settingTurns, record.grinder?.settingTurns)
      && nearlyEqual(cloud.total_mass_g, record.totalG)
      && String(cloud.quality_label || "U") === String(record.metrics?.quality?.grade || "U");
    const sameFractions = expectedFractions.length === actualFractions.length
      && expectedFractions.every((expected, index) => {
        const actual = actualFractions[index];
        return expected.ordinal === actual.ordinal
          && expected.label === actual.label
          && nearlyEqual(expected.lower_um, actual.lower_um)
          && nearlyEqual(expected.upper_um, actual.upper_um)
          && nearlyEqual(expected.mass_g, actual.mass_g)
          && nearlyEqual(expected.percentage, actual.percentage, 0.001)
          && expected.legacy_merged === actual.legacy_merged;
      });
    if (!sameHeader || !sameFractions) throw new Error("服务器数据与本地记录不一致");
    return { measurementId: cloud.id, verifiedAt: new Date().toISOString() };
  }

  async function pushRecord(record, deviceInstanceId) {
    if (!session?.user?.id) throw new Error("尚未登录云端账户");
    const uid = session.user.id;
    const grinderKey = `${record.grinder?.brand || ""}|${record.grinder?.model || ""}`;
    const grinders = await upsert("grinders", [{
      user_id: uid,
      brand: record.grinder?.brand || null,
      model: record.grinder?.model || "未命名设备",
      nickname: null,
      source_app: SOURCE_APP,
      source_record_id: grinderKey,
      schema_version: 1,
      deleted_at: null
    }], "user_id,source_app,source_record_id");
    const grinderId = grinders[0]?.id || null;
    const measurements = await upsert("measurements", [{
      user_id: uid,
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
    const measurementId = measurements[0]?.id;
    if (!measurementId) throw new Error("云端测次写入失败");
    const fractions = sieveRows(record).map((row) => ({ ...row, measurement_id: measurementId }));
    if (fractions.length) await upsert("measurement_fractions", fractions, "measurement_id,ordinal");
    return measurementId;
  }

  async function pullRecords() {
    if (!session?.user?.id) return [];
    const rows = await select("measurements",
      `select=legacy_payload,updated_at&deleted_at=is.null&source_app=eq.${SOURCE_APP}&order=updated_at.asc`);
    return rows.map((row) => row.legacy_payload).filter(Boolean);
  }

  window.GrindPSDCloud = {
    init, signIn, signUp, signOut, profile, pushRecord, verifyRecord, pullRecords,
    authRedirectNotice: () => redirectNotice,
    isSignedIn: () => Boolean(session?.access_token),
    user: () => session?.user || null
  };
})();
