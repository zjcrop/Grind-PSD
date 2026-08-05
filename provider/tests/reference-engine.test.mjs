import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, normalizeRecord, recommendSettingRange } from '../scripts/reference-engine.mjs';

function record(id, grade, order, psd, user = 'u1') {
  return {
    id,
    standardId: 'standard-v1',
    user: { id: user },
    grinder: { brand: 'Demo', model: 'G1', setting: String(order), settingOrder: order },
    metrics: { ...psd, quality: { grade } },
    sample: {}
  };
}

test('fewer than three eligible samples never returns numeric settings', () => {
  const points = [record('1', 'A', 10, { coarsePct: 10, bodyPct: 70, finesPct: 5 })].map(normalizeRecord);
  const result = recommendSettingRange(points, { coarsePct: 10, bodyPct: 70, finesPct: 5 });
  assert.equal(result.available, false);
  assert.equal(result.settingRange, null);
  assert.equal(result.suggestedStart, null);
});

test('C-grade records are excluded and a valid range remains broad', () => {
  const points = [
    record('1', 'A', 10, { coarsePct: 10, bodyPct: 70, finesPct: 5 }, 'u1'),
    record('2', 'B', 11, { coarsePct: 11, bodyPct: 69, finesPct: 6 }, 'u2'),
    record('3', 'A', 12, { coarsePct: 12, bodyPct: 68, finesPct: 7 }, 'u3'),
    record('4', 'C', 50, { coarsePct: 50, bodyPct: 20, finesPct: 20 }, 'u4')
  ].map(normalizeRecord);
  const result = recommendSettingRange(points, { coarsePct: 11, bodyPct: 69, finesPct: 6 });
  assert.equal(result.available, true);
  assert.ok(result.settingRange.maximum - result.settingRange.minimum >= 2);
  assert.equal(result.evidence.eligibleSamples, 3);
});

test('catalog labels current sparse data as insufficient', () => {
  const catalog = buildCatalog({ schemaVersion: '3.0.0', standardId: 's', records: [record('1', 'A', 10, { coarsePct: 10, bodyPct: 70, finesPct: 5 })] });
  assert.equal(catalog.grinders[0].numericReferenceAllowed, false);
  assert.equal(catalog.grinders[0].confidence, 'insufficient');
});
