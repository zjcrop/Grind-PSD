export const QUALITY_WEIGHTS = { A: 1, B: 0.65 };
export const MIN_NUMERIC_REFERENCE_SAMPLES = 3;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}
function normalizedDistance(target, point) {
  const terms = [['coarsePct', 30], ['bodyPct', 50], ['finesPct', 15]];
  let total = 0;
  let used = 0;
  for (const [key, scale] of terms) {
    const a = finite(target?.[key]);
    const b = finite(point?.[key]);
    if (a === null || b === null) continue;
    total += ((a - b) / scale) ** 2;
    used += 1;
  }
  return used ? Math.sqrt(total / used) : Number.POSITIVE_INFINITY;
}
export function normalizeRecord(record) {
  const grade = String(record?.metrics?.quality?.grade ?? '').toUpperCase();
  const settingOrder = finite(record?.grinder?.settingOrder);
  return {
    id: record?.id ?? null,
    grinder: {
      brand: String(record?.grinder?.brand ?? '').trim(),
      model: String(record?.grinder?.model ?? '').trim(),
      setting: String(record?.grinder?.setting ?? '').trim(),
      settingOrder
    },
    contributorId: record?.user?.id ?? null,
    standardId: record?.standardId ?? null,
    qualityGrade: grade,
    eligible: Boolean(QUALITY_WEIGHTS[grade]) && settingOrder !== null,
    weight: QUALITY_WEIGHTS[grade] ?? 0,
    psd: {
      coarsePct: finite(record?.metrics?.coarsePct),
      bodyPct: finite(record?.metrics?.bodyPct),
      finesPct: finite(record?.metrics?.finesPct)
    },
    roastLevel: record?.sample?.roastLevel || null,
    createdAt: record?.createdAt ?? null
  };
}
export function confidenceFor(points) {
  const eligible = points.filter((point) => point.eligible);
  const contributors = new Set(eligible.map((point) => point.contributorId).filter(Boolean)).size;
  if (eligible.length >= 12 && contributors >= 3) return 'high';
  if (eligible.length >= 6 && contributors >= 2) return 'medium';
  if (eligible.length >= MIN_NUMERIC_REFERENCE_SAMPLES) return 'low';
  return 'insufficient';
}
export function recommendSettingRange(points, targetPsd) {
  const eligible = points.filter((point) => point.eligible && Number.isFinite(point.grinder.settingOrder));
  const confidence = confidenceFor(points);
  const ranked = eligible
    .map((point) => ({ point, distance: normalizedDistance(targetPsd, point.psd) }))
    .filter((item) => Number.isFinite(item.distance))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.min(7, eligible.length));
  const basis = ranked.map((item) => item.point);
  if (basis.length < MIN_NUMERIC_REFERENCE_SAMPLES) {
    return {
      available: false,
      confidence: 'insufficient',
      settingRange: null,
      suggestedStart: null,
      tendency: basis.length ? 'nearest-observation-only' : 'no-comparable-data',
      evidence: { eligibleSamples: eligible.length, neighborSamples: basis.length },
      warnings: ['有效样本少于3条，不提供具体刻度范围。', '仅可依据目标粒径判断更细、相近或更粗的方向。']
    };
  }
  const orders = basis.map((point) => point.grinder.settingOrder);
  const q1 = quantile(orders, 0.25);
  const q3 = quantile(orders, 0.75);
  const observedMin = Math.min(...orders);
  const observedMax = Math.max(...orders);
  const span = Math.max(observedMax - observedMin, Math.abs(median(orders) || 0) * 0.04, 1);
  const padding = confidence === 'high' ? span * 0.15 : confidence === 'medium' ? span * 0.3 : span * 0.5;
  return {
    available: true,
    confidence,
    settingRange: { minimum: Math.min(observedMin, q1) - padding, maximum: Math.max(observedMax, q3) + padding, unit: 'settingOrder' },
    suggestedStart: median(orders),
    tendency: 'approximate-range',
    evidence: {
      eligibleSamples: eligible.length,
      neighborSamples: basis.length,
      contributorCount: new Set(basis.map((point) => point.contributorId).filter(Boolean)).size,
      nearestDistance: ranked[0]?.distance ?? null
    },
    warnings: [
      '该结果是宽范围起点，不是精确刻度。',
      '磨豆机零点、刀盘磨损、豆子脆性、筛分操作和静电均会造成偏移。',
      '应结合实际流速、总时长和杯测结果继续微调。'
    ]
  };
}
export function buildCatalog(database) {
  const records = (database.records ?? []).map(normalizeRecord);
  const groups = new Map();
  for (const point of records) {
    const key = `${point.grinder.brand}\u0000${point.grinder.model}\u0000${point.standardId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(point);
  }
  const grinders = [...groups.values()].map((points) => {
    const first = points[0];
    const eligible = points.filter((point) => point.eligible);
    return {
      grinderId: `${first.grinder.brand}:${first.grinder.model}`.toLowerCase().replace(/\s+/g, '-'),
      brand: first.grinder.brand,
      model: first.grinder.model,
      standardId: first.standardId,
      confidence: confidenceFor(points),
      precisionPolicy: 'approximate-range-only',
      sampleCount: points.length,
      eligibleSampleCount: eligible.length,
      contributorCount: new Set(eligible.map((point) => point.contributorId).filter(Boolean)).size,
      observedSettings: [...new Set(points.map((point) => point.grinder.setting).filter(Boolean))],
      points,
      numericReferenceAllowed: eligible.length >= MIN_NUMERIC_REFERENCE_SAMPLES,
      warnings: eligible.length >= MIN_NUMERIC_REFERENCE_SAMPLES ? ['Only broad ranges may be shown; exact-setting claims are prohibited.'] : ['Insufficient evidence for a numeric setting range.', 'Show grind-direction guidance only.']
    };
  }).sort((a, b) => `${a.brand}${a.model}`.localeCompare(`${b.brand}${b.model}`, 'zh-CN'));
  return {
    contract: 'grinder-reference/1.0',
    precisionPolicy: {
      exactSettingProhibited: true,
      minimumEligibleSamplesForNumericRange: MIN_NUMERIC_REFERENCE_SAMPLES,
      acceptedQualityGrades: Object.keys(QUALITY_WEIGHTS),
      mandatoryConsumerLabel: '参考范围，需结合实际流速与杯测修正'
    },
    source: {
      schemaVersion: database.schemaVersion ?? null,
      standardId: database.standardId ?? null,
      updatedAt: database.updatedAt ?? null,
      recordCount: database.recordCount ?? records.length
    },
    grinders
  };
}
