(function attachGrinderDiagnostics(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrindPSDDiagnostics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGrinderDiagnostics() {
  "use strict";

  const BIN_KEYS = [
    "mesh18_retained_g", "mesh24_retained_g", "mesh35_retained_g",
    "mesh60_retained_g", "mesh80_retained_g", "pan_lt180_g"
  ];
  const BIN_LABELS = ["≥1000", "800–1000", "500–800", "300–500", "180–300", "<180"];

  function finite(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function isCanonicalSixBin(record) {
    if (record?.standardId !== "grind-psd-sieve-v2" || !record.weightsGrams) return false;
    const bins = record.sieveProfile?.bins;
    return Array.isArray(bins) && bins.length === 6 && bins.every((bin, index) =>
      bin.key === BIN_KEYS[index] && (index === 5 ? bin.apertureUm == null : Number(bin.apertureUm) === [1000, 800, 500, 300, 180][index])
    );
  }

  function vectorFor(record) {
    const weights = BIN_KEYS.map((key) => Math.max(0, Number(record.weightsGrams[key]) || 0));
    const sum = weights.reduce((a, b) => a + b, 0);
    return sum > 0 ? weights.map((weight) => weight / sum) : null;
  }

  function meanVector(vectors) {
    const n = vectors.length;
    return BIN_KEYS.map((_, i) => vectors.reduce((sum, vector) => sum + vector[i], 0) / n);
  }

  function ordinalCenter(vector) {
    return vector.reduce((sum, share, bin) => sum + share * bin, 0);
  }

  // One unit is one ordered sieve-bin step. This is an ordinal comparison,
  // not an estimate of micrometre distance within or beyond open-ended bins.
  function ordinalWasserstein(a, b) {
    let cumulative = 0;
    let distance = 0;
    for (let i = 0; i < a.length - 1; i += 1) {
      cumulative += a[i] - b[i];
      distance += Math.abs(cumulative);
    }
    return distance;
  }

  function settingGroups(records) {
    const bySetting = new Map();
    records.forEach((record) => {
      const order = finite(record.grinder?.settingOrder);
      const vector = vectorFor(record);
      if (order === null || !vector) return;
      const key = String(order);
      if (!bySetting.has(key)) bySetting.set(key, { order, records: [], vectors: [] });
      const group = bySetting.get(key);
      group.records.push(record);
      group.vectors.push(vector);
    });
    return [...bySetting.values()].map((group) => ({
      ...group,
      vector: meanVector(group.vectors),
      labels: [...new Set(group.records.map((record) => record.grinder.setting))],
      center: ordinalCenter(meanVector(group.vectors)),
      repeatSpread: group.vectors.length > 1
        ? group.vectors.reduce((sum, vector) => sum + ordinalWasserstein(vector, meanVector(group.vectors)), 0) / group.vectors.length
        : null
    })).sort((a, b) => a.order - b.order);
  }

  function interpolate(a, b, x) {
    const t = (x - a.order) / (b.order - a.order);
    return a.vector.map((share, i) => share * (1 - t) + b.vector[i] * t);
  }

  function predictAt(groups, x, omittedIndex = -1) {
    const points = groups.filter((_, index) => index !== omittedIndex);
    if (points.length < 2 || x < points[0].order || x > points.at(-1).order) return null;
    for (let i = 0; i < points.length - 1; i += 1) {
      if (x >= points[i].order && x <= points[i + 1].order) {
        return interpolate(points[i], points[i + 1], x);
      }
    }
    return null;
  }

  function diagnose(records, brand, model) {
    const all = records.filter((record) => record.grinder?.brand === brand && record.grinder?.model === model);
    const formal = all.filter(isCanonicalSixBin);
    const excluded = all.length - formal.length;
    const unorderable = formal.filter((record) => finite(record.grinder?.settingOrder) === null).length;
    const groups = settingGroups(formal);
    const k = groups.length;
    const meanNeighborShift = k > 1
      ? groups.slice(1).reduce((sum, group, i) => sum + Math.abs(group.center - groups[i].center), 0) / (k - 1)
      : null;
    const repeatValues = groups.filter((group) => group.repeatSpread !== null).map((group) => group.repeatSpread);
    const repeatNoise = repeatValues.length
      ? repeatValues.reduce((sum, value) => sum + value, 0) / repeatValues.length
      : null;
    const centers = groups.map((group) => group.center);
    const increases = centers.slice(1).filter((center, i) => center > centers[i] + 0.015).length;
    const decreases = centers.slice(1).filter((center, i) => center < centers[i] - 0.015).length;
    const directionalPairs = increases + decreases;
    const directionConsistency = directionalPairs
      ? Math.max(increases, decreases) / Math.max(1, k - 1)
      : 0;
    const direction = increases > decreases ? "刻度增大时整体趋细" : decreases > increases ? "刻度增大时整体趋粗" : "方向暂不明确";

    const looErrors = [];
    for (let i = 1; i < k - 1; i += 1) {
      const predicted = predictAt(groups, groups[i].order, i);
      if (predicted) looErrors.push(ordinalWasserstein(predicted, groups[i].vector));
    }
    const looError = looErrors.length ? looErrors.reduce((sum, value) => sum + value, 0) / looErrors.length : null;
    const noiseRatio = meanNeighborShift && repeatNoise !== null ? repeatNoise / meanNeighborShift : null;

    let grade = "M3";
    let gradeLabel = "数据不足";
    if (k >= 4) {
      if (directionConsistency >= 0.7 && (looError === null || looError <= 0.35) && (noiseRatio === null || noiseRatio <= 0.65)) {
        grade = k >= 5 && directionConsistency >= 0.8 && (looError === null || looError <= 0.22) && (noiseRatio === null || noiseRatio <= 0.4)
          ? "M1" : "M2";
        gradeLabel = grade === "M1" ? "稳定可建模" : "基本可建模";
      } else {
        grade = "M4";
        gradeLabel = "现有数据不支持可靠连续建模";
      }
    }

    const mediumCandidates = groups.map((group) => ({
      order: group.order,
      setting: group.labels.join(" / "),
      n: group.records.length,
      pct: group.vector.map((share) => share * 100),
      middlePct: (group.vector[2] + group.vector[3]) * 100,
      tailPct: (group.vector[0] + group.vector[5]) * 100,
      center: group.center
    }));
    const bestObserved = [...mediumCandidates].sort((a, b) =>
      (b.middlePct - 0.5 * b.tailPct) - (a.middlePct - 0.5 * a.tailPct)
    )[0] || null;
    let nextTest = null;
    if (k >= 2) {
      const gaps = groups.slice(1).map((group, i) => ({
        order: (group.order + groups[i].order) / 2,
        width: group.order - groups[i].order,
        left: groups[i].order,
        right: group.order
      })).sort((a, b) => b.width - a.width);
      if (gaps[0]?.width > 0) nextTest = gaps[0];
    }

    const evidence = [
      `匹配该机型共 ${all.length} 条本地记录，其中 ${formal.length} 条符合标准六分段；${excluded} 条旧档或自定义筛网记录未进入正式模型。`,
      `${k} 个有序刻度点，${formal.length - unorderable} 条测次有可用排序值；${unorderable} 条缺少排序值而未进入刻度曲线。`,
      k > 1 ? `${direction}；相邻变化方向一致率 ${Math.round(directionConsistency * 100)}%。` : "至少需要两个不同且可排序的刻度点才能判断粒径变化方向。",
      repeatNoise === null ? "暂无同刻度重复测次，无法估计重复测量离散度。" : `同刻度重复离散度 ${repeatNoise.toFixed(2)} 个筛分档；相邻刻度平均中心移动 ${meanNeighborShift.toFixed(2)} 档。`,
      looError === null ? "留一插值误差尚不可计算（需要至少 3 个有序刻度点）。" : `留一交叉验证平均误差 ${looError.toFixed(2)} 个筛分档。`
    ];

    return {
      brand, model, grade, gradeLabel, records: all.length, formalRecords: formal.length,
      excludedRecords: excluded, unorderableRecords: unorderable, groups,
      candidates: mediumCandidates, bestObserved, nextTest, direction,
      directionConsistency, repeatNoise, meanNeighborShift, noiseRatio, looError, evidence,
      bins: BIN_LABELS,
      targetNotice: "本页没有把筛分分布等同于冲煮质量。“中等手冲”尚无本项目杯测校准目标；候选值只按 300–800 μm 主体占比与两端尾部作探索性排序，不代表已验证的最佳萃取刻度。",
      modelNotice: "M1–M4 为本项目内部诊断规则（刻度覆盖、方向一致性、留一误差、重复测量噪声），不是行业认证等级。仅在实测刻度范围内线性插值；不外推。"
    };
  }

  function listModels(records) {
    const map = new Map();
    records.forEach((record) => {
      const brand = String(record.grinder?.brand || "").trim();
      const model = String(record.grinder?.model || "").trim();
      if (!brand || !model) return;
      const key = `${brand}\u0000${model}`;
      if (!map.has(key)) map.set(key, { brand, model, records: 0 });
      map.get(key).records += 1;
    });
    return [...map.values()].sort((a, b) => a.brand.localeCompare(b.brand, "zh-CN") || a.model.localeCompare(b.model, "zh-CN"));
  }

  return Object.freeze({ BIN_KEYS, BIN_LABELS, diagnose, isCanonicalSixBin, listModels, ordinalWasserstein });
});
