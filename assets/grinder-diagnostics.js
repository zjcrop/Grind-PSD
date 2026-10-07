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

  function settingGroups(records) {
    const bySetting = new Map();
    records.forEach((sample) => {
      const record = sample.record;
      const order = finite(record.grinder?.settingOrder);
      const vector = sample.vector;
      if (order === null || !vector) return;
      const key = String(order);
      if (!bySetting.has(key)) bySetting.set(key, { order, records: [], vectors: [], weights: [], imputationRates: [] });
      const group = bySetting.get(key);
      group.records.push(record);
      group.vectors.push(vector);
      group.weights.push(sample.reliability);
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

  function diagnose(records, brand, model) {
    const all = records.filter((record) => record.grinder?.brand === brand && record.grinder?.model === model);
    const modelReferences = all.map((record) => ({
      order: finite(record.grinder?.settingOrder), vector: exactReferenceVector(record)
    })).filter((item) => item.vector);
    const brandReferences = records.filter((record) => record.grinder?.brand === brand)
      .map((record) => ({ order: null, vector: exactReferenceVector(record) })).filter((item) => item.vector);
    const globalReferences = records.map((record) => ({ order: null, vector: exactReferenceVector(record) })).filter((item) => item.vector);
    const usable = all.map((record) => {
      const order = finite(record.grinder?.settingOrder);
      const references = modelReferences.length ? modelReferences : (brandReferences.length ? brandReferences : globalReferences);
      const converted = modelVectorFor(record, referenceAt(order, references));
      if (!converted) return null;
      const gradeReliability = { A: 1, B: 0.9, C: 0.75, D: 0.45 }[record.metrics?.quality?.grade] || 0.85;
      return {
        record, vector: converted.vector, inferred: converted.inferred,
        imputationRate: converted.imputationRate,
        reliability: gradeReliability * (1 - 0.3 * converted.imputationRate)
      };
    }).filter(Boolean);
    const formal = usable.map((item) => item.record);
    const inferredRecords = usable.filter((item) => item.inferred).length;
    const legacyRecords = usable.filter((item) => item.record.standardId === "grind-psd-sieve-v1" || item.record.sieveProfile?.legacy).length;
    const qualityAdjusted = formal.filter((record) => record.metrics?.quality?.grade === "D").length;
    const excluded = all.length - usable.length;
    const unorderable = usable.filter((item) => finite(item.record.grinder?.settingOrder) === null).length;
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
      gradeLabel = grade === "M1"
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
    const bestObserved = mediumCandidates[0] || null;
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
    const gaps = fittedGroups.slice(1).map((group, i) => ({ width: group.order - fittedGroups[i].order, left: fittedGroups[i], right: group }));
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
      `匹配该机型共 ${all.length} 条本地或社区记录，其中 ${formal.length} 条已转为模型样本；${excluded} 条缺少可用研磨刻度或筛分质量数据，无法参与曲线。`,
      legacyRecords || inferredRecords
        ? `${legacyRecords} 条旧格式记录、共 ${inferredRecords} 条记录经粒径区间映射或模型插补后纳入；这些记录会扩大预测区间，不会被当成精确实测。`
        : "纳入记录均为完整六段数据，无旧格式拆分或缺项插补。",
      qualityAdjusted ? `${qualityAdjusted} 条 D 级质量记录已降权纳入；质量回收偏差会降低其对中心曲线的影响。` : "未发现需要因严重质量偏差而降权的 D 级测次。",
      `${k} 个有序刻度点，${formal.length - unorderable} 条测次有可用排序值；${unorderable} 条缺少排序值但仍用于 PSD 汇总，无法定位到刻度间隔。`,
      k > 1 ? `${direction}；置信度加权后的相邻变化方向一致率 ${Math.round(directionConsistency * 100)}%。${k < 4 ? "方向和曲线形状仍是初步估计，间隔预测采用较宽概率区间。" : ""}` : "目前只有一个不同刻度点；无法从现有数据估计刻度响应方向。补测任意第二个刻度后即可开始区间预测。",
      repeatNoise === null ? "暂无同刻度重复测次，无法估计重复测量离散度。" : `有 ${repeatedSettingCount} 个刻度具备重复测次；平均重复离散度 ${repeatNoise.toFixed(2)} 个筛分档；相邻刻度平均中心移动 ${meanNeighborShift.toFixed(2)} 档。离散或低质量测次已按注意力权重降低影响。`,
      protocolKeys.size > 1 ? `测量条件覆盖 ${protocolKeys.size} 种筛具/方法/时长组合，跨条件差异可能混入刻度效应。` : "标准筛具、筛分方法和时长未见多个组合造成的明显口径差异。",
      looError === null ? "留一插值误差尚不可计算（需要至少 3 个有序刻度点）。" : `留一交叉验证平均误差 ${looError.toFixed(2)} 个筛分档。`
    ];

    return {
      brand, model, grade, gradeLabel, records: all.length, formalRecords: formal.length,
      inferredRecords, legacyRecords, qualityAdjustedRecords: qualityAdjusted,
      excludedRecords: excluded, qualityRejectedRecords: 0, unorderableRecords: unorderable, groups,
      candidates: mediumCandidates, bestObserved, nextTest, direction,
      directionConsistency, repeatNoise, meanNeighborShift, noiseRatio, looError, repeatedSettingCount,
      meanGroupDispersion: groups.length ? groups.reduce((sum, group) => sum + group.dispersion, 0) / groups.length : null,
      meanGroupConfidence: groups.length ? groups.reduce((sum, group) => sum + group.confidence, 0) / groups.length : null, evidence,
      predictions, bestPrediction: null, predictedRange, hydraulicEnvelope,
      bins: BIN_LABELS,
      targetNotice: "研磨建议现在展示不同刻度的水力响应与注水情景范围，不给出由单一粒径占比推导的‘最佳刻度’。细粉、粗颗粒和中间粒径共同参与计算；候选带表示有数据支持的区间，不等同于杯测最佳区间。",
      modelNotice: "水力指标是基于粒径代表值、表面积加权粒径、细粉/粗粉混合项和注水情景的相对代理量，不是绝对渗透率、真实流速或 CFD；表格水力值从中心 PSD 计算，未单独校准区间。轻柔/常规/较强扰动以相对流量与喷流能量表示，用于比较模型响应；系数尚未由本项目滤杯实测校准。实际压降、接触时间、细粉迁移与通道化还受粉床高度、滤纸、滤杯、注水位置和脉冲节奏影响。低可信样本按质量等级、插补比例和同刻度离散度降低权重；离散度增加时保留概率预测并扩大区间。"
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
