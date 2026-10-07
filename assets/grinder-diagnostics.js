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
  const BIN_RANGES = [
    { low: 1000, high: Infinity }, { low: 800, high: 1000 },
    { low: 500, high: 800 }, { low: 300, high: 500 },
    { low: 180, high: 300 }, { low: 0, high: 180 }
  ];
  const BROAD_PRIOR = [0.08, 0.20, 0.30, 0.23, 0.12, 0.07];
  const BIN_DIAMETER_UM = [1400, 900, 632, 387, 232, 120];
  const POUR_SCENARIOS = [
    { id: "gentle", label: "轻柔注水", flowRate: 0.75, jetEnergy: 0.55 },
    { id: "standard", label: "常规注水", flowRate: 1, jetEnergy: 1 },
    { id: "energetic", label: "较强扰动", flowRate: 1.25, jetEnergy: 1.55 }
  ];

  function finite(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function isCanonicalSixBin(record) {
    if (record?.standardId !== "grind-psd-sieve-v2" || !record.weightsGrams) return false;
    if (!BIN_KEYS.every((key) => record.weightsGrams[key] !== undefined && Number.isFinite(Number(record.weightsGrams[key])))) return false;
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

  function meanVector(vectors, weights = vectors.map(() => 1)) {
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    return BIN_KEYS.map((_, i) => vectors.reduce((sum, vector, index) => sum + vector[i] * weights[index], 0) / totalWeight);
  }

  function overlaps(source, target) {
    const high = Math.min(source.high, target.high);
    const low = Math.max(source.low, target.low);
    return high > low || (high === Infinity && low === Infinity);
  }

  function rangeForProfileBin(bin, index, bins) {
    const low = finite(bin?.apertureUm);
    const previous = finite(bins[index - 1]?.apertureUm);
    if (low === null) return { low: 0, high: previous ?? 0 };
    return { low, high: previous ?? Infinity };
  }

  function profileBinsFor(record) {
    const profileBins = record.sieveProfile?.bins;
    if (Array.isArray(profileBins) && profileBins.length) return profileBins;
    const weights = record.weightsGrams || {};
    if (weights.pan80_lt300_g !== undefined && weights.mesh80_retained_g === undefined) {
      return [
        { key: BIN_KEYS[0], apertureUm: 1000 }, { key: BIN_KEYS[1], apertureUm: 800 },
        { key: BIN_KEYS[2], apertureUm: 500 }, { key: BIN_KEYS[3], apertureUm: 300 },
        { key: "pan80_lt300_g", apertureUm: null }
      ];
    }
    return BIN_KEYS.map((key, index) => ({ key, apertureUm: [1000, 800, 500, 300, 180, null][index] }));
  }

  function exactReferenceVector(record) {
    return isCanonicalSixBin(record) ? vectorFor(record) : null;
  }

  function referenceAt(order, references) {
    if (!references.length) return BROAD_PRIOR;
    const ordered = references.filter((item) => item.order !== null).sort((a, b) => a.order - b.order);
    if (order !== null && ordered.length) {
      const exact = ordered.find((item) => Math.abs(item.order - order) < 1e-9);
      if (exact) return exact.vector;
      const left = [...ordered].reverse().find((item) => item.order < order);
      const right = ordered.find((item) => item.order > order);
      if (left && right) {
        const fraction = (order - left.order) / (right.order - left.order);
        return left.vector.map((share, index) => share * (1 - fraction) + right.vector[index] * fraction);
      }
      return (left || right).vector;
    }
    return meanVector(references.map((item) => item.vector));
  }

  function modelVectorFor(record, reference) {
    if (isCanonicalSixBin(record)) return { vector: vectorFor(record), imputationRate: 0, inferred: false };
    const bins = profileBinsFor(record);
    const weights = record.weightsGrams || {};
    const masses = Array(BIN_KEYS.length).fill(0);
    const covered = Array(BIN_KEYS.length).fill(false);
    let sourceMass = 0;
    let splitMass = 0;
    let splitCount = 0;
    bins.forEach((bin, index) => {
      const raw = weights[bin.key];
      if (raw === undefined || raw === null || !Number.isFinite(Number(raw))) return;
      const mass = Math.max(0, Number(raw));
      sourceMass += mass;
      const sourceRange = rangeForProfileBin(bin, index, bins);
      const targets = BIN_RANGES.map((range, targetIndex) => ({ range, targetIndex }))
        .filter(({ range }) => overlaps(sourceRange, range))
        .map(({ targetIndex }) => targetIndex);
      if (!targets.length) return;
      targets.forEach((target) => { covered[target] = true; });
      if (!mass) return;
      if (targets.length === 1) {
        masses[targets[0]] += mass;
        return;
      }
      splitCount += 1;
      const targetWeight = targets.reduce((sum, target) => sum + Math.max(reference[target], 0.001), 0);
      targets.forEach((target) => {
        const share = Math.max(reference[target], 0.001) / targetWeight;
        masses[target] += mass * share;
        splitMass += mass * share;
      });
    });
    const knownMass = masses.reduce((sum, mass) => sum + mass, 0);
    if (!knownMass || !sourceMass) return null;
    const missing = covered.map((value, index) => value ? -1 : index).filter((index) => index >= 0);
    let imputedMass = 0;
    if (missing.length) {
      const referenceCovered = covered.reduce((sum, value, index) => sum + (value ? reference[index] : 0), 0);
      const referenceMissing = missing.reduce((sum, index) => sum + reference[index], 0);
      imputedMass = knownMass * referenceMissing / Math.max(referenceCovered, 0.05);
      const missingWeight = missing.reduce((sum, index) => sum + Math.max(reference[index], 0.001), 0);
      missing.forEach((index) => { masses[index] += imputedMass * Math.max(reference[index], 0.001) / missingWeight; });
    }
    const total = masses.reduce((sum, mass) => sum + mass, 0);
    return {
      vector: masses.map((mass) => mass / total),
      imputationRate: Math.min(1, Math.max(splitCount ? 0.25 : 0, (imputedMass + splitMass * 0.35) / Math.max(total, 1e-9))),
      inferred: true
    };
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

  function settingOrderInfo(record) {
    const order = finite(record.grinder?.settingOrder);
    if (order === null) return { order: null, confidence: 0, reason: "未提供可比较排序值" };
    const label = String(record.grinder?.setting || "").trim();
    const source = record.grinder?.settingOrderSource;
    const parts = label.match(/-?\d+(?:\.\d+)?/g) || [];
    if (source === "manual") return { order, confidence: 1, reason: "手动排序" };
    if (source === "composite-inferred" || (parts.length > 1 && source !== "manual")) {
      return { order: null, confidence: 0, reason: "复合刻度被旧规则换算，需手动排序" };
    }
    if (source === "numeric-label" || (parts.length === 1 && /^-?\d+(?:\.\d+)?$/.test(label))) {
      return { order, confidence: 0.9, reason: "单一数字刻度" };
    }
    if (source === "unavailable") return { order: null, confidence: 0, reason: "未提供可比较排序值" };
    return { order, confidence: 0.45, reason: "历史排序来源不明" };
  }

  function settingGroups(records) {
    const bySetting = new Map();
    records.forEach((sample) => {
      const record = sample.record;
      const order = sample.orderInfo ? sample.orderInfo.order : finite(record.grinder?.settingOrder);
      const vector = sample.vector;
      if (order === null || !vector) return;
      const key = String(order);
      if (!bySetting.has(key)) bySetting.set(key, { order, records: [], vectors: [], weights: [], imputationRates: [] });
      const group = bySetting.get(key);
      group.records.push(record);
      group.vectors.push(vector);
      group.weights.push(sample.reliability * (sample.orderInfo?.confidence ?? 0.45));
      group.imputationRates.push(sample.imputationRate);
    });
    return [...bySetting.values()].map((group) => {
      const initial = meanVector(group.vectors, group.weights);
      const deviations = group.vectors.map((item) => ordinalWasserstein(item, initial));
      const sortedDeviations = [...deviations].sort((a, b) => a - b);
      const medianDeviation = sortedDeviations[Math.floor(sortedDeviations.length / 2)] || 0;
      const robustScale = Math.max(0.06, medianDeviation * 1.4826);
      const weights = group.weights.map((weight, index) => {
        const standardized = deviations[index] / (2.5 * robustScale);
        return weight / (1 + standardized ** 2);
      });
      const vector = meanVector(group.vectors, weights);
      const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
      const rawWeight = group.weights.reduce((sum, value) => sum + value, 0) || 1;
      const dispersion = Math.sqrt(group.vectors.reduce((sum, item, index) =>
        sum + weights[index] * ordinalWasserstein(item, vector) ** 2, 0) / totalWeight);
      const effectiveCount = totalWeight ** 2 / Math.max(weights.reduce((sum, value) => sum + value ** 2, 0), 1e-9);
      const confidence = Math.max(0.08, Math.min(1, (rawWeight / group.weights.length) / (1 + dispersion / 0.12)));
      return {
        ...group, weights,
        vector,
        labels: [...new Set(group.records.map((record) => record.grinder.setting))],
        center: ordinalCenter(vector),
        confidence, dispersion, effectiveCount,
        imputationRate: group.imputationRates.reduce((sum, value, index) => sum + value * weights[index], 0) / totalWeight,
        repeatSpread: group.vectors.length > 1
          ? group.vectors.reduce((sum, item, index) => sum + ordinalWasserstein(item, vector) * weights[index], 0) / totalWeight
          : null
      };
    }).sort((a, b) => a.order - b.order);
  }

  function interpolate(a, b, x) {
    const t = (x - a.order) / (b.order - a.order);
    return a.vector.map((share, i) => share * (1 - t) + b.vector[i] * t);
  }

  function attentionSmoothGroups(groups) {
    if (groups.length < 3) return groups;
    return groups.map((group, index) => {
      if (group.confidence >= 0.8) return group;
      const neighborTrend = index === 0
        ? groups[1].vector
        : index === groups.length - 1
          ? groups[index - 1].vector
          : interpolate(groups[index - 1], groups[index + 1], group.order);
      const trust = clamp((group.confidence - 0.2) / 0.6, 0.25, 1);
      const vector = group.vector.map((share, bin) => share * trust + neighborTrend[bin] * (1 - trust));
      return { ...group, vector, center: ordinalCenter(vector), attentionTrust: trust };
    });
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

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  // A transparent relative proxy, not an absolute permeability or CFD solution.
  // d32 approximates surface-area-weighted particle size; fine/coarse interaction
  // adds a packing and migration term that a single-bin score cannot represent.
  function hydraulicResponse(vector) {
    const reciprocalDiameter = vector.reduce((sum, share, bin) => sum + share / BIN_DIAMETER_UM[bin], 0);
    const d32 = reciprocalDiameter > 0 ? 1 / reciprocalDiameter : 0;
    const veryFineShare = vector[5];
    const fineShare = vector[4] + vector[5];
    const coarseShare = vector[0] + vector[1];
    const fineCoarseMix = Math.sqrt(fineShare * coarseShare);
    const relativeResistance = (500 / Math.max(d32, 1)) ** 2 * (1 + 1.5 * veryFineShare + 0.6 * fineCoarseMix);
    const spread = Math.sqrt(vector.reduce((sum, share, bin) => {
      const distance = Math.log(BIN_DIAMETER_UM[bin] / Math.max(d32, 1));
      return sum + share * distance ** 2;
    }, 0));
    return {
      d32Um: d32,
      finePct: fineShare * 100,
      coarsePct: coarseShare * 100,
      mixSpread: spread,
      relativeResistance,
      scenarios: POUR_SCENARIOS.map((scenario) => {
        const migrationRisk = clamp((fineShare * 0.65 + fineCoarseMix * 0.35) * scenario.jetEnergy * 100, 0, 100);
        const channelingTendency = clamp((spread / 1.7 * 35 + fineCoarseMix * 35 + Math.max(0, relativeResistance - 1) * 8) * scenario.jetEnergy, 0, 100);
        return {
          ...scenario,
          pressureDemand: relativeResistance * scenario.flowRate,
          contactTime: relativeResistance / scenario.flowRate,
          migrationRisk,
          channelingTendency
        };
      })
    };
  }

  function measuredSettingProfiles(samples) {
    const byLabel = new Map();
    samples.forEach((sample) => {
      const label = String(sample.record.grinder?.setting || "未标刻度").trim();
      if (!byLabel.has(label)) byLabel.set(label, { setting: label, vectors: [], weights: [], records: [] });
      const group = byLabel.get(label);
      group.vectors.push(sample.vector);
      group.weights.push(sample.reliability);
      group.records.push(sample.record);
    });
    return [...byLabel.values()].map((group) => {
      const vector = meanVector(group.vectors, group.weights);
      const representative = group.records[0];
      return {
        setting: group.setting,
        order: settingOrderInfo(representative).order,
        n: group.records.length,
        vector,
        center: ordinalCenter(vector),
        hydraulics: hydraulicResponse(vector)
      };
    });
  }

  function profileJudgement(point) {
    const vector = point.vector;
    const finePct = (vector[4] + vector[5]) * 100;
    const coarsePct = (vector[0] + vector[1]) * 100;
    const midPct = (vector[2] + vector[3]) * 100;
    const standard = point.hydraulics.scenarios[1];
    const clogging = standard.migrationRisk >= 45 ? "偏高" : standard.migrationRisk >= 30 ? "中等" : "较低";
    let flowNote;
    if (finePct >= 35) {
      flowNote = "细粉占比较高，粉床阻力、慢流和滤纸堵塞警示偏高；容易出现长尾滴滤，注水扰动也可能放大床层不均。";
    } else if (coarsePct >= 40) {
      flowNote = "粗颗粒占比较高，排水可能较快；浅烘或低水温时更需留意萃取不足，注水分布不均时可能出现通道化。";
    } else if (midPct >= 45) {
      flowNote = "中间粒径占主体，预计流动响应相对均衡；实际流速仍受滤杯、滤纸、粉床高度和注水方式影响。";
    } else {
      flowNote = "粗细两端占比都不低，粉床流动和萃取可能更不均；建议观察总滴滤时间与杯中风味再微调。";
    }
    const style = point.hydraulics.mixSpread >= 1.15 ? "宽分布、粗细混合明显"
      : point.hydraulics.mixSpread <= 0.82 ? "分布相对集中"
        : "中等宽度分布";
    const roastFit = finePct >= 35
      ? "偏向浅烘所需的细研磨，但细粉/慢流风险偏高，冲煮时要重点观察堵塞"
      : coarsePct >= 40
        ? "偏向深烘的较粗起步；浅烘使用时更要留意萃取不足"
        : "中间粒径较均衡，可从中浅烘到中深烘的中位建议起步";
    return {
      setting: point.setting,
      n: point.n,
      finePct,
      coarsePct,
      clogging,
      migrationRisk: standard.migrationRisk,
      relativeResistance: point.hydraulics.relativeResistance,
      style, roastFit,
      note: flowNote
    };
  }

  function roastStartingPoints(measuredProfiles, predictions, curveReliable) {
    const pool = curveReliable && predictions.length
      ? [...measuredProfiles, ...predictions.map((point) => ({
        setting: null, order: point.order, n: 0,
        vector: point.pct.map((share) => share / 100),
        center: ordinalCenter(point.pct.map((share) => share / 100)),
        hydraulics: point.hydraulics
      }))]
      : measuredProfiles;
    if (!pool.length) return [];
    const recipes = [
      { roast: "浅烘/极浅烘", quantile: 0.72, hint: "从相对细的一档起步，提高萃取驱动力；若滴滤明显变慢或堵塞警示偏高，先回粗少许并用水温/注水补偿。" },
      { roast: "中浅烘至中深烘", quantile: 0.5, hint: "先取本机 PSD 中位附近的刻度，再按流速和杯测微调。" },
      { roast: "深烘", quantile: 0.28, hint: "从相对粗的一档起步，降低慢流与过度萃取风险；若风味偏薄，再小幅调细。" }
    ];
    const sorted = [...pool].sort((a, b) => a.center - b.center);
    return recipes.map((recipe) => {
      const target = (sorted.length - 1) * recipe.quantile;
      const point = sorted[Math.round(target)];
      return {
        roast: recipe.roast,
        setting: point.setting,
        order: point.order,
        risk: profileJudgement(point).clogging,
        riskIndex: profileJudgement(point).migrationRisk,
        style: profileJudgement(point).style,
        hint: recipe.hint,
        modeled: !point.setting && curveReliable
      };
    });
  }

  function diagnose(records, brand, model) {
    const all = records.filter((record) => record.grinder?.brand === brand && record.grinder?.model === model);
    const modelReferences = all.map((record) => ({
      order: settingOrderInfo(record).order, vector: exactReferenceVector(record)
    })).filter((item) => item.vector);
    const brandReferences = records.filter((record) => record.grinder?.brand === brand)
      .map((record) => ({ order: null, vector: exactReferenceVector(record) })).filter((item) => item.vector);
    const globalReferences = records.map((record) => ({ order: null, vector: exactReferenceVector(record) })).filter((item) => item.vector);
    const usable = all.map((record) => {
      const orderInfo = settingOrderInfo(record);
      const order = orderInfo.order;
      const references = modelReferences.length ? modelReferences : (brandReferences.length ? brandReferences : globalReferences);
      const converted = modelVectorFor(record, referenceAt(order, references));
      if (!converted) return null;
      const gradeReliability = { A: 1, B: 0.9, C: 0.75, D: 0.45 }[record.metrics?.quality?.grade] || 0.85;
      return {
        record, vector: converted.vector, inferred: converted.inferred, orderInfo,
        imputationRate: converted.imputationRate,
        reliability: gradeReliability * (1 - 0.3 * converted.imputationRate)
      };
    }).filter(Boolean);
    const formal = usable.map((item) => item.record);
    const inferredRecords = usable.filter((item) => item.inferred).length;
    const legacyRecords = usable.filter((item) => item.record.standardId === "grind-psd-sieve-v1" || item.record.sieveProfile?.legacy).length;
    const qualityAdjusted = formal.filter((record) => record.metrics?.quality?.grade === "D").length;
    const excluded = all.length - usable.length;
    const unorderable = usable.filter((item) => item.orderInfo.order === null).length;
    const ambiguousOrderRecords = usable.filter((item) => item.orderInfo.reason.includes("复合刻度")).length;
    const groups = settingGroups(usable);
    const fittedGroups = attentionSmoothGroups(groups);
    const k = fittedGroups.length;
    const meanNeighborShift = k > 1
      ? fittedGroups.slice(1).reduce((sum, group, i) => sum + Math.abs(group.center - fittedGroups[i].center), 0) / (k - 1)
      : null;
    const repeatValues = groups.filter((group) => group.repeatSpread !== null).map((group) => group.repeatSpread);
    const repeatNoise = repeatValues.length
      ? repeatValues.reduce((sum, value) => sum + value, 0) / repeatValues.length
      : null;
    const trendPairs = fittedGroups.slice(1).map((group, index) => ({
      change: group.center - fittedGroups[index].center,
      weight: Math.sqrt(group.confidence * fittedGroups[index].confidence)
    }));
    const increaseWeight = trendPairs.filter((pair) => pair.change > 0.015).reduce((sum, pair) => sum + pair.weight, 0);
    const decreaseWeight = trendPairs.filter((pair) => pair.change < -0.015).reduce((sum, pair) => sum + pair.weight, 0);
    const directionalWeight = increaseWeight + decreaseWeight;
    const totalTrendWeight = trendPairs.reduce((sum, pair) => sum + pair.weight, 0);
    const directionConsistency = directionalWeight
      ? Math.max(increaseWeight, decreaseWeight) / Math.max(totalTrendWeight, 1e-9)
      : 0;
    const activeTrendPairs = trendPairs.filter((pair) => Math.abs(pair.change) > 0.015);
    const trendReversals = activeTrendPairs.slice(1).reduce((count, pair, index) =>
      count + (Math.sign(pair.change) !== Math.sign(activeTrendPairs[index].change) ? 1 : 0), 0);
    const direction = increaseWeight > decreaseWeight ? "刻度增大时整体趋细" : decreaseWeight > increaseWeight ? "刻度增大时整体趋粗" : "方向暂不明确";

    const looErrors = [];
    const looResiduals = [];
    for (let i = 1; i < k - 1; i += 1) {
      const predicted = predictAt(fittedGroups, fittedGroups[i].order, i);
      if (predicted) {
        looErrors.push({ value: ordinalWasserstein(predicted, groups[i].vector), weight: groups[i].confidence });
        looResiduals.push({ values: predicted.map((share, bin) => groups[i].vector[bin] - share), weight: groups[i].confidence });
      }
    }
    const looWeight = looErrors.reduce((sum, item) => sum + item.weight, 0);
    const looError = looErrors.length ? looErrors.reduce((sum, item) => sum + item.value * item.weight, 0) / Math.max(looWeight, 1e-9) : null;
    const irregularGrinder = k >= 4 && activeTrendPairs.length >= 3 && (
      directionConsistency < 0.62 || trendReversals >= 2 || (k >= 5 && looError !== null && looError > 0.45)
    );
    const curveReliable = k >= 2 && !irregularGrinder;
    const noiseRatio = meanNeighborShift && repeatNoise !== null ? repeatNoise / meanNeighborShift : null;
    const repeatedSettingCount = groups.filter((group) => group.vectors.length > 1).length;
    const protocolKeys = new Set(formal.map((record) => [
      record.sample?.sieveDevice || "未填写筛具",
      record.sample?.method || "未填写方法",
      finite(record.sample?.durationSec) ?? "未填写时长"
    ].join("|")));

    let grade = "M3";
    let gradeLabel = "仅有单点，暂不能拟合刻度响应";
    if (k >= 2) {
      grade = k >= 5 && repeatedSettingCount > 0 && directionConsistency >= 0.8 &&
        (looError === null || looError <= 0.22) && (noiseRatio === null || noiseRatio <= 0.4)
        ? "M1" : "M2";
      gradeLabel = irregularGrinder
        ? "刻度与 PSD 响应明显不规律，停止跨刻度预测，仅评估实测刻度"
        : grade === "M1"
        ? "重复测量支持稳定建模"
        : directionConsistency < 0.55 || (looError !== null && looError > 0.35) || (noiseRatio !== null && noiseRatio > 0.65)
          ? "离散度较高，保留预测并扩大区间"
          : k < 4 ? "低数据量概率预测" : "基本可建模";
    }

    const mediumCandidates = groups.map((group) => ({
      order: group.order,
      setting: group.labels.join(" / "),
      n: group.records.length,
      pct: group.vector.map((share) => share * 100),
      middlePct: (group.vector[2] + group.vector[3]) * 100,
      tailPct: (group.vector[0] + group.vector[5]) * 100,
      center: group.center,
      confidence: group.confidence,
      dispersion: group.dispersion
    }));
    const measuredProfiles = measuredSettingProfiles(usable);
    const profileAssessments = measuredProfiles.map(profileJudgement);
    const bestObserved = mediumCandidates[0] || (measuredProfiles[0] ? {
      order: measuredProfiles[0].order, setting: measuredProfiles[0].setting,
      n: measuredProfiles[0].n, pct: measuredProfiles[0].vector.map((share) => share * 100),
      center: measuredProfiles[0].center, confidence: null, dispersion: null
    } : null);
    const looSigma = BIN_KEYS.map((_, bin) => looResiduals.length
      ? Math.sqrt(looResiduals.reduce((sum, residual) => sum + residual.values[bin] ** 2 * residual.weight, 0) / Math.max(looResiduals.reduce((sum, residual) => sum + residual.weight, 0), 1e-9))
      : 0);
    const repeatSigma = BIN_KEYS.map((_, bin) => {
      const deviations = groups.flatMap((group) => group.vectors.length > 1
        ? group.vectors.map((vector, index) => ({ value: vector[bin] - group.vector[bin], weight: group.weights[index] }))
        : []);
      return deviations.length
        ? Math.sqrt(deviations.reduce((sum, item) => sum + item.value ** 2 * item.weight, 0) / Math.max(deviations.reduce((sum, item) => sum + item.weight, 0), 1e-9))
        : 0;
    });
    const gaps = curveReliable ? fittedGroups.slice(1).map((group, i) => ({ width: group.order - fittedGroups[i].order, left: fittedGroups[i], right: group })) : [];
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
        const imputationInflation = 1 + ((1 - t) * left.imputationRate + t * right.imputationRate) * 1.25;
        const dispersionInflation = 1 + (left.dispersion + right.dispersion) * 1.5 + (2 - left.confidence - right.confidence) * 0.45;
        const sigma = BIN_KEYS.map((_, bin) => Math.sqrt(
          ((1 - t) * repeatSigma[bin]) ** 2 + (t * repeatSigma[bin]) ** 2 +
          (Math.max(baseUncertainty, looSigma[bin]) * curvature * gapInflation) ** 2
        ) * (protocolKeys.size > 1 ? 1.2 : 1) * imputationInflation * dispersionInflation);
        const intervals = logisticNormalInterval(vector, sigma, `${brand}/${model}/${left.order}/${right.order}/${t}`);
        predictions.push({
          order, fraction: t, left: left.order, right: right.order,
          pct: vector.map((share) => share * 100),
          intervals: intervals.map((range) => ({ low: range.low * 100, high: range.high * 100 })),
          middlePct: (vector[2] + vector[3]) * 100,
          tailPct: (vector[0] + vector[5]) * 100,
          uncertaintyPct: sigma.reduce((sum, value) => sum + value, 0) / sigma.length * 100,
          hydraulics: hydraulicResponse(vector)
        });
      });
    });
    const roastAdvice = roastStartingPoints(measuredProfiles, predictions, curveReliable);
    const predictedRange = predictions.length ? {
      low: Math.min(...predictions.map((point) => point.order)),
      high: Math.max(...predictions.map((point) => point.order))
    } : null;
    const hydraulicEnvelope = predictions.length ? POUR_SCENARIOS.map((scenario, scenarioIndex) => {
      const risks = predictions.map((point) => point.hydraulics.scenarios[scenarioIndex].migrationRisk);
      const demands = predictions.map((point) => point.hydraulics.scenarios[scenarioIndex].pressureDemand);
      return {
        ...scenario,
        migrationRisk: { low: Math.min(...risks), high: Math.max(...risks) },
        pressureDemand: { low: Math.min(...demands), high: Math.max(...demands) }
      };
    }) : [];
    let nextTest = null;
    if (gaps.length) {
      const widest = [...gaps].sort((a, b) => b.width - a.width)[0];
      nextTest = { order: (widest.left.order + widest.right.order) / 2, width: widest.width, left: widest.left.order, right: widest.right.order };
    }

    const evidence = [
      `匹配该机型共 ${all.length} 条本地或社区记录，其中 ${formal.length} 条已转为模型样本；${excluded} 条缺少可用 PSD 数据，无法参与评估。`,
      legacyRecords || inferredRecords
        ? `${legacyRecords} 条旧格式记录、共 ${inferredRecords} 条记录经粒径区间映射或模型插补后纳入；这些记录会扩大预测区间，不会被当成精确实测。`
        : "纳入记录均为完整六段数据，无旧格式拆分或缺项插补。",
      qualityAdjusted ? `${qualityAdjusted} 条 D 级质量记录已降权纳入；质量回收偏差会降低其对中心曲线的影响。` : "未发现需要因严重质量偏差而降权的 D 级测次。",
      `${k} 个有序刻度点，${formal.length - unorderable} 条测次有可信排序值；${unorderable} 条无法安全排序但仍用于实测 PSD 汇总，其中 ${ambiguousOrderRecords} 条复合手动刻度因旧规则换算而被排除出曲线。`,
      irregularGrinder
        ? `刻度响应有明显反向变化（方向一致率 ${Math.round(directionConsistency * 100)}%）；已停止跨刻度插值，避免把不规律刻度伪装成可靠预测。`
        : k > 1 ? `${direction}；置信度加权后的相邻变化方向一致率 ${Math.round(directionConsistency * 100)}%。${k < 4 ? "方向和曲线形状仍是初步估计，间隔预测采用较宽概率区间。" : ""}` : "目前只有一个不同刻度点；无法从现有数据估计刻度响应方向。补测任意第二个可信排序值后即可开始区间预测。",
      repeatNoise === null ? "暂无同刻度重复测次，无法估计重复测量离散度。" : `有 ${repeatedSettingCount} 个刻度具备重复测次；平均重复离散度 ${repeatNoise.toFixed(2)} 个筛分档；相邻刻度平均中心移动 ${meanNeighborShift.toFixed(2)} 档。离散或低质量测次已按注意力权重降低影响。`,
      protocolKeys.size > 1 ? `测量条件覆盖 ${protocolKeys.size} 种筛具/方法/时长组合，跨条件差异可能混入刻度效应。` : "标准筛具、筛分方法和时长未见多个组合造成的明显口径差异。",
      "浅烘/深烘建议是相对细粗的起步值：依据粒径分布与粉床流动风险给出，不代表已经验证的杯测最佳值；烘焙度本身不能由 PSD 反推出。",
      looError === null ? "留一插值误差尚不可计算（需要至少 3 个有序刻度点）。" : `留一交叉验证平均误差 ${looError.toFixed(2)} 个筛分档。`
    ];

    return {
      brand, model, grade, gradeLabel, records: all.length, formalRecords: formal.length,
      inferredRecords, legacyRecords, qualityAdjustedRecords: qualityAdjusted,
      excludedRecords: excluded, qualityRejectedRecords: 0, unorderableRecords: unorderable, groups,
      candidates: mediumCandidates, bestObserved, nextTest, direction,
      ambiguousOrderRecords, irregularGrinder, curveReliable, measuredProfiles, profileAssessments, roastAdvice,
      directionConsistency, repeatNoise, meanNeighborShift, noiseRatio, looError, repeatedSettingCount,
      meanGroupDispersion: groups.length ? groups.reduce((sum, group) => sum + group.dispersion, 0) / groups.length : null,
      meanGroupConfidence: groups.length ? groups.reduce((sum, group) => sum + group.confidence, 0) / groups.length : null, evidence,
      predictions, bestPrediction: null, predictedRange, hydraulicEnvelope,
      bins: BIN_LABELS,
      targetNotice: "建议值按本机可用刻度和对应 PSD 估算；浅烘通常从较细档开始、深烘从较粗档开始，中间烘焙从中位档开始，再按实际流速和杯测调整。没有杯测对照时，不把建议值称为最佳刻度。",
      modelNotice: "水力指标是基于粒径代表值、表面积加权粒径、细粉/粗粉混合项和注水情景的相对代理量，不是绝对渗透率、真实流速或 CFD；表格水力值从中心 PSD 计算，未单独校准区间。轻柔/常规/较强扰动以相对流量与喷流能量表示，用于比较模型响应；系数尚未由本项目滤杯实测校准。实际压降、接触时间、细粉迁移与通道化还受粉床高度、滤纸、滤杯、注水位置和脉冲节奏影响。细粉 35% 与粗粉 40% 是模型筛查阈值，用于提示观察流速、堵塞或萃取不足，不是普适的物理分界。低可信样本按质量等级、插补比例和同刻度离散度降低权重；离散度增加时保留概率预测并扩大区间。"
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
