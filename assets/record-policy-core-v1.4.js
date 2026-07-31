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
      if (index > 0) {
        upperUm = finiteOrNull(sieves[index - 1]?.apertureUm);
      }
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

  return Object.freeze({
    RECORD_PREFIX,
    DAILY_SEQUENCE_CAPACITY,
    CHECK_CAPACITY,
    compactPair,
    base36,
    dateCode,
    createRecordId,
    recordIntervals,
    alignPercentageDistributions
  });
});
