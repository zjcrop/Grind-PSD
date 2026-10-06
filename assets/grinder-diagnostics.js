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

  function seededNormal(seedText) {
    let state = 2166136261;
    for (const char of seedText) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
    const random = () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let spare = null;
    return () => {
      if (spare !== null) { const value = spare; spare = null; return value; }
      const u = Math.max(random(), 1e-12);
      const v = random();
      const radius = Math.sqrt(-2 * Math.log(u));
      spare = radius * Math.sin(2 * Math.PI * v);
      return radius * Math.cos(2 * Math.PI * v);
    };
  }

  function logisticNormalInterval(mean, sigma, seedText) {
    const normal = seededNormal(seedText);
    const draws = BIN_KEYS.map(() => []);
    for (let draw = 0; draw < 800; draw += 1) {
      const logits = mean.map((share, i) => {
        const p = Math.max(share, 1e-5);
        const logitSd = sigma[i] / Math.max(p * (1 - p), 0.015);
        return Math.log(p) + normal() * Math.min(logitSd, 2.5);
      });
      const max = Math.max(...logits);
      const raw = logits.map((value) => Math.exp(value - max));
      const total = raw.reduce((sum, value) => sum + value, 0);
      raw.forEach((value, i) => draws[i].push(value / total));
    }
    const quantile = (values, q) => {
      const sorted = values.sort((a, b) => a - b);
      return sorted[Math.floor((sorted.length - 1) * q)];
    };
    return draws.map((values) => ({ low: quantile(values, 0.1), high: quantile(values, 0.9) }));
  }

  function diagnose(records, brand, model) {
    const all = records.filter((record) => record.grinder?.brand === brand && record.grinder?.model === model);
    const canonical = all.filter(isCanonicalSixBin);
    const qualityRejected = canonical.filter((record) => record.metrics?.quality?.grade === "D").length;
    const formal = canonical.filter((record) => record.metrics?.quality?.grade !== "D");
    const excluded = all.length - canonical.length;
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
    const looResiduals = [];
    for (let i = 1; i < k - 1; i += 1) {
      const predicted = predictAt(groups, groups[i].order, i);
      if (predicted) {
        looErrors.push(ordinalWasserstein(predicted, groups[i].vector));
        looResiduals.push(predicted.map((share, bin) => groups[i].vector[bin] - share));
      }
    }
    const looError = looErrors.length ? looErrors.reduce((sum, value) => sum + value, 0) / looErrors.length : null;
    const noiseRatio = meanNeighborShift && repeatNoise !== null ? repeatNoise / meanNeighborShift : null;
    const repeatedSettingCount = groups.filter((group) => group.vectors.length > 1).length;
    const protocolKeys = new Set(formal.map((record) => [
      record.sample?.sieveDevice || "未填写筛具",
      record.sample?.method || "未填写方法",
      finite(record.sample?.durationSec) ?? "未填写时长"
    ].join("|")));

    let grade = "M3";
    let gradeLabel = "仅有单点，暂不能拟合刻度响应";
    if (k >= 2 && k < 4) {
      grade = "M2";
      gradeLabel = "低数据量概率预测";
    } else if (k >= 4) {
      if (directionConsistency >= 0.7 && (looError === null || looError <= 0.35) && (noiseRatio === null || noiseRatio <= 0.65)) {
        grade = k >= 5 && repeatedSettingCount > 0 && directionConsistency >= 0.8 && (looError === null || looError <= 0.22) && (noiseRatio === null || noiseRatio <= 0.4)
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
    const looSigma = BIN_KEYS.map((_, bin) => looResiduals.length
      ? Math.sqrt(looResiduals.reduce((sum, residual) => sum + residual[bin] ** 2, 0) / looResiduals.length)
      : 0);
    const repeatSigma = BIN_KEYS.map((_, bin) => {
      const deviations = groups.flatMap((group) => group.vectors.length > 1
        ? group.vectors.map((vector) => vector[bin] - group.vector[bin])
        : []);
      return deviations.length
        ? Math.sqrt(deviations.reduce((sum, value) => sum + value ** 2, 0) / deviations.length)
        : 0;
    });
    const gaps = groups.slice(1).map((group, i) => ({ width: group.order - groups[i].order, left: groups[i], right: group }));
    const sortedGapWidths = gaps.map((gap) => gap.width).sort((a, b) => a - b);
    const typicalGap = sortedGapWidths.length ? sortedGapWidths[Math.floor(sortedGapWidths.length / 2)] : null;
    const baseUncertainty = k < 3 ? 0.10 : k === 3 ? 0.075 : k === 4 ? 0.055 : 0.04;
    const predictions = [];
    gaps.forEach(({ width, left, right }) => {
      [0.25, 0.5, 0.75].forEach((t) => {
        const order = left.order + width * t;
        const vector = interpolate(left, right, order);
        const gapInflation = typicalGap ? Math.min(2.5, Math.sqrt(width / typicalGap)) : 1;
        const curvature = 2 * Math.sqrt(t * (1 - t));
        const sigma = BIN_KEYS.map((_, bin) => Math.sqrt(
          ((1 - t) * repeatSigma[bin]) ** 2 + (t * repeatSigma[bin]) ** 2 +
          (Math.max(baseUncertainty, looSigma[bin]) * curvature * gapInflation) ** 2
        ) * (protocolKeys.size > 1 ? 1.2 : 1));
        const intervals = logisticNormalInterval(vector, sigma, `${brand}/${model}/${left.order}/${right.order}/${t}`);
        predictions.push({
          order, fraction: t, left: left.order, right: right.order,
          pct: vector.map((share) => share * 100),
          intervals: intervals.map((range) => ({ low: range.low * 100, high: range.high * 100 })),
          middlePct: (vector[2] + vector[3]) * 100,
          tailPct: (vector[0] + vector[5]) * 100,
          uncertaintyPct: sigma.reduce((sum, value) => sum + value, 0) / sigma.length * 100
        });
      });
    });
    const candidatePool = predictions;
    const scoreOf = (point) => point.middlePct - 0.5 * point.tailPct;
    const bestPrediction = [...candidatePool].sort((a, b) => scoreOf(b) - scoreOf(a))[0] || null;
    const bestScore = bestPrediction ? scoreOf(bestPrediction) : null;
    const candidateBand = bestPrediction
      ? candidatePool.filter((point) => scoreOf(point) >= bestScore - 5)
      : [];
    const predictedRange = candidateBand.length ? {
      low: Math.min(...candidateBand.map((point) => point.order)),
      high: Math.max(...candidateBand.map((point) => point.order))
    } : null;
    let nextTest = null;
    if (gaps.length) {
      const widest = [...gaps].sort((a, b) => b.width - a.width)[0];
      nextTest = { order: (widest.left.order + widest.right.order) / 2, width: widest.width, left: widest.left.order, right: widest.right.order };
    }

    const evidence = [
      `匹配该机型共 ${all.length} 条本地记录，其中 ${formal.length} 条符合标准六分段；${excluded} 条旧档或自定义筛网记录未进入正式模型。`,
      qualityRejected ? `${qualityRejected} 条 D 级质量记录因质量回收偏差过大，未进入正式模型。` : "未发现因质量回收偏差过大而排除的 D 级测次。",
      `${k} 个有序刻度点，${formal.length - unorderable} 条测次有可用排序值；${unorderable} 条缺少排序值而未进入刻度曲线。`,
      k > 1 ? `${direction}；相邻变化方向一致率 ${Math.round(directionConsistency * 100)}%。${k < 4 ? "方向和曲线形状仍是初步估计，间隔预测采用较宽概率区间。" : ""}` : "目前只有一个不同刻度点；无法从现有数据估计刻度响应方向。补测任意第二个刻度后即可开始区间预测。",
      repeatNoise === null ? "暂无同刻度重复测次，无法估计重复测量离散度。" : `有 ${repeatedSettingCount} 个刻度具备重复测次；平均重复离散度 ${repeatNoise.toFixed(2)} 个筛分档；相邻刻度平均中心移动 ${meanNeighborShift.toFixed(2)} 档。`,
      protocolKeys.size > 1 ? `测量条件覆盖 ${protocolKeys.size} 种筛具/方法/时长组合，跨条件差异可能混入刻度效应。` : "标准筛具、筛分方法和时长未见多个组合造成的明显口径差异。",
      looError === null ? "留一插值误差尚不可计算（需要至少 3 个有序刻度点）。" : `留一交叉验证平均误差 ${looError.toFixed(2)} 个筛分档。`
    ];

    return {
      brand, model, grade, gradeLabel, records: all.length, formalRecords: formal.length,
      excludedRecords: excluded, qualityRejectedRecords: qualityRejected, unorderableRecords: unorderable, groups,
      candidates: mediumCandidates, bestObserved, nextTest, direction,
      directionConsistency, repeatNoise, meanNeighborShift, noiseRatio, looError, repeatedSettingCount, evidence,
      predictions, bestPrediction, predictedRange,
      bins: BIN_LABELS,
      targetNotice: "本页没有把筛分分布等同于冲煮质量。“中等手冲”尚无本项目杯测校准目标；候选值只按 300–800 μm 主体占比与两端尾部作探索性排序，不代表已验证的最佳萃取刻度。",
      modelNotice: "两个不同刻度点即可进行区间内概率预测；测点越少，80%工作预测区间越宽。中心 PSD 使用相邻测点线性插值，概率区间以留一误差、重复测次噪声和数据稀疏先验构造，并保持六段组成约束。区间尚未经过大量实际重复测次校准，不外推；M1–M4 是模型稳定性提示，不是是否给出预测的开关。"
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
