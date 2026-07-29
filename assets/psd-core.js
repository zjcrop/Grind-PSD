(function attachGrindPsdCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrindPSDCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGrindPsdCore() {
  "use strict";

  const STANDARD_ID = "grind-psd-sieve-v1";
  const SCHEMA_VERSION = "3.0.0";
  const DATA_LICENSE = "CC-BY-4.0";

  const SIEVES = Object.freeze([
    Object.freeze({
      key: "mesh18_retained_g",
      legacyKey: "18",
      mesh: 18,
      apertureUm: 1000,
      label: "18 目筛上",
      shortLabel: "18目",
      range: "≥ 1000 μm",
      description: "极粗段",
      color: "#d98e32"
    }),
    Object.freeze({
      key: "mesh24_retained_g",
      legacyKey: "24",
      mesh: 24,
      apertureUm: 800,
      label: "24 目筛上",
      shortLabel: "24目",
      range: "800–1000 μm",
      description: "粗段",
      color: "#8ab4f8"
    }),
    Object.freeze({
      key: "mesh35_retained_g",
      legacyKey: "35",
      mesh: 35,
      apertureUm: 500,
      label: "35 目筛上",
      shortLabel: "35目",
      range: "500–800 μm",
      description: "中段",
      color: "#6fbf73"
    }),
    Object.freeze({
      key: "mesh60_retained_g",
      legacyKey: "60",
      mesh: 60,
      apertureUm: 300,
      label: "60 目筛上",
      shortLabel: "60目",
      range: "300–500 μm",
      description: "细段",
      color: "#ffd166"
    }),
    Object.freeze({
      key: "pan80_lt300_g",
      legacyKey: "80",
      mesh: 80,
      apertureUm: null,
      label: "80 目档底盘",
      shortLabel: "极细粉",
      range: "< 300 μm",
      description: "极细粉段",
      color: "#e05d5d"
    })
  ]);

  const WEIGHT_KEYS = Object.freeze(SIEVES.map((sieve) => sieve.key));

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  }

  function sum(values) {
    return values.reduce((total, value) => total + toNumber(value), 0);
  }

  function cleanText(value, maxLength = 120) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function normalizeUserId(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
  }

  function normalizeHexColor(value, fallback = "#d98e32") {
    const color = String(value ?? "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
  }

  function normalizeWeights(input = {}) {
    const weights = {};
    SIEVES.forEach((sieve) => {
      const direct = input[sieve.key];
      const legacy = input[sieve.legacyKey] ?? input[sieve.mesh];
      weights[sieve.key] = round(toNumber(direct ?? legacy), 2);
    });
    return weights;
  }

  function calculatePercentages(weights, totalG) {
    const percentages = {};
    SIEVES.forEach((sieve) => {
      percentages[sieve.key.replace(/_g$/, "_pct")] = totalG
        ? round((weights[sieve.key] || 0) / totalG * 100, 2)
        : 0;
    });
    return percentages;
  }

  function calculateQuality(doseG, recoveredG, method = {}) {
    const dose = toNumber(doseG);
    const recovered = toNumber(recoveredG);
    if (!dose) {
      return {
        recoveryPct: null,
        massBalanceErrorPct: null,
        grade: "U",
        gradeLabel: "未评级",
        protocolComplete: false
      };
    }

    const recoveryPct = round(recovered / dose * 100, 2);
    const errorPct = round(Math.abs(recovered - dose) / dose * 100, 2);
    const protocolComplete = toNumber(method.durationSec) > 0 && Boolean(cleanText(method.sieveDevice, 80));
    let grade = "D";
    let gradeLabel = "不建议入库";

    if (errorPct <= 2 && protocolComplete) {
      grade = "A";
      gradeLabel = "高可比";
    } else if (errorPct <= 5) {
      grade = "B";
      gradeLabel = "可比";
    } else if (errorPct <= 10) {
      grade = "C";
      gradeLabel = "谨慎比较";
    }

    return {
      recoveryPct,
      massBalanceErrorPct: errorPct,
      grade,
      gradeLabel,
      protocolComplete
    };
  }

  function calculateMetrics(weights, totalG, sample = {}) {
    if (!totalG) {
      return {
        coarsePct: 0,
        bodyPct: 0,
        finesPct: 0,
        modeBin: "",
        quality: calculateQuality(sample.doseG, 0, sample)
      };
    }

    const pct = (key) => round((weights[key] || 0) / totalG * 100, 2);
    const mode = SIEVES.reduce((best, sieve) => {
      const weight = weights[sieve.key] || 0;
      return weight > best.weight ? { label: sieve.label, weight } : best;
    }, { label: "", weight: -1 });

    return {
      coarsePct: pct("mesh18_retained_g"),
      bodyPct: round(
        pct("mesh24_retained_g") +
        pct("mesh35_retained_g"),
        2
      ),
      finesPct: pct("pan80_lt300_g"),
      modeBin: mode.label,
      quality: calculateQuality(sample.doseG, totalG, sample)
    };
  }

  function deriveSettingOrder(setting) {
    const text = cleanText(setting, 80);
    const matches = text.match(/-?\d+(?:\.\d+)?/g);
    if (!matches || !matches.length) return null;
    if (matches.length === 1) return Number(matches[0]);
    return round(matches.reduce((total, part, index) => {
      const value = Number(part);
      return total + value / (10 ** (index * 3));
    }, 0), 6);
  }

  function makeRecordId() {
    const timestamp = Date.now().toString(36);
    let random = "";
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const values = new Uint32Array(2);
      crypto.getRandomValues(values);
      random = Array.from(values, (value) => value.toString(36)).join("");
    } else {
      random = Math.random().toString(36).slice(2, 14);
    }
    return `gpsd-${timestamp}-${random.slice(0, 16)}`;
  }

  function createRecord(input) {
    const weightsGrams = normalizeWeights(input.weightsGrams);
    const totalG = round(sum(Object.values(weightsGrams)), 2);
    const createdAt = input.createdAt || new Date().toISOString();
    const rawSettingOrder = input.grinder?.settingOrder;
    const settingOrderInput = Number(rawSettingOrder);
    const settingOrder = rawSettingOrder !== "" && rawSettingOrder !== null && rawSettingOrder !== undefined && Number.isFinite(settingOrderInput)
      ? settingOrderInput
      : deriveSettingOrder(input.grinder?.setting);

    const sample = {
      doseG: round(toNumber(input.sample?.doseG || totalG), 2),
      bean: cleanText(input.sample?.bean, 120),
      roastLevel: cleanText(input.sample?.roastLevel, 40),
      method: cleanText(input.sample?.method || "手动水平往复筛分", 120),
      durationSec: round(toNumber(input.sample?.durationSec), 1),
      sieveDevice: cleanText(input.sample?.sieveDevice, 80),
      replicate: Math.max(1, Math.trunc(toNumber(input.sample?.replicate) || 1))
    };

    return {
      schemaVersion: SCHEMA_VERSION,
      standardId: STANDARD_ID,
      id: cleanText(input.id, 80) || makeRecordId(),
      user: {
        id: normalizeUserId(input.user?.id),
        name: cleanText(input.user?.name || input.user?.id, 60)
      },
      grinder: {
        brand: cleanText(input.grinder?.brand, 80),
        model: cleanText(input.grinder?.model, 80),
        setting: cleanText(input.grinder?.setting, 80),
        settingOrder,
        color: normalizeHexColor(input.grinder?.color)
      },
      sample,
      weightsGrams,
      totalG,
      percentages: calculatePercentages(weightsGrams, totalG),
      metrics: calculateMetrics(weightsGrams, totalG, sample),
      notes: cleanText(input.notes, 500),
      license: input.license === DATA_LICENSE ? DATA_LICENSE : null,
      createdAt,
      updatedAt: input.updatedAt || createdAt,
      source: cleanText(input.source || "local", 40)
    };
  }

  function normalizeRecord(input) {
    if (!input || typeof input !== "object") return null;
    if (input.standardId && input.standardId !== STANDARD_ID) return null;
    const record = createRecord({
      ...input,
      id: input.id,
      user: input.user || {},
      grinder: input.grinder || {},
      sample: input.sample || {},
      weightsGrams: input.weightsGrams || input.weights || {},
      source: typeof input.source === "string" ? input.source : "community"
    });
    if (!record.user.id || !record.grinder.brand || !record.grinder.model || !record.grinder.setting || record.totalG <= 0) {
      return null;
    }
    if (input.submission && typeof input.submission === "object") {
      record.submission = {
        channel: cleanText(input.submission.channel, 40),
        githubLogin: cleanText(input.submission.githubLogin, 80),
        issueNumber: Math.trunc(toNumber(input.submission.issueNumber))
      };
    }
    return record;
  }

  function validatePublicRecord(input) {
    const record = normalizeRecord(input);
    const errors = [];
    const warnings = [];

    if (!record) {
      return { record: null, errors: ["记录结构不完整或不符合 Grind-PSD 标准。"], warnings };
    }
    if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(record.user.id)) {
      errors.push("用户 ID 需为 2–48 位小写字母、数字、下划线或连字符。");
    }
    if (record.sample.doseG <= 0) errors.push("公开记录必须填写研磨投粉量。");
    if (!record.sample.sieveDevice) errors.push("公开记录必须注明筛具或筛分装置。");
    if (record.sample.durationSec <= 0) errors.push("公开记录必须填写筛分时长。");
    if (record.metrics.quality.grade === "D") {
      errors.push("回收总重与投粉量偏差超过 10%，不满足公开数据库的质量要求。");
    } else if (record.metrics.quality.grade === "C") {
      warnings.push("质量等级为 C，数据可入库，但仅适合谨慎比较。");
    }
    if (record.license !== DATA_LICENSE) {
      errors.push("公开提交必须同意以 CC BY 4.0 许可发布该条测量数据。");
    }
    return { record, errors, warnings };
  }

  function recordGroupKey(record) {
    return [
      record.user?.id || "",
      record.grinder?.brand || "",
      record.grinder?.model || ""
    ].map((part) => encodeURIComponent(String(part))).join("::");
  }

  function compareSettings(a, b) {
    const aOrder = Number(a.grinder?.settingOrder);
    const bOrder = Number(b.grinder?.settingOrder);
    if (Number.isFinite(aOrder) && Number.isFinite(bOrder) && aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    return String(a.grinder?.setting || "").localeCompare(String(b.grinder?.setting || ""), "zh-CN", {
      numeric: true,
      sensitivity: "base"
    });
  }

  return Object.freeze({
    STANDARD_ID,
    SCHEMA_VERSION,
    DATA_LICENSE,
    SIEVES,
    WEIGHT_KEYS,
    toNumber,
    round,
    sum,
    cleanText,
    normalizeUserId,
    normalizeHexColor,
    normalizeWeights,
    calculatePercentages,
    calculateQuality,
    calculateMetrics,
    deriveSettingOrder,
    makeRecordId,
    createRecord,
    normalizeRecord,
    validatePublicRecord,
    recordGroupKey,
    compareSettings
  });
});
