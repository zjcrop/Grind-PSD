"use strict";

const assert = require("node:assert/strict");
const Core = require("../assets/psd-core.js");
const Diagnostics = require("../assets/grinder-diagnostics.js");

function makeRecord(order, shares, options = {}) {
  return Core.createRecord({
    user: { id: "tester", name: "Tester" },
    grinder: { brand: "Test", model: "Burr A", setting: options.setting || String(order), settingOrder: order, settingOrderSource: options.settingOrderSource ?? "numeric-label" },
    sample: { doseG: shares.reduce((sum, value) => sum + value, 0), durationSec: 60, sieveDevice: "test sieve" },
    weightsGrams: Object.fromEntries(Core.SIEVES.map((sieve, index) => [sieve.key, shares[index]])),
    sieveProfile: options.profile,
    createdAt: `2026-10-0${Math.min(order, 6)}T00:00:00.000Z`
  });
}

function makeLegacyRecord(order, shares, model = "Legacy Burr") {
  const bins = [
    ...Core.SIEVES.slice(0, 4),
    { key: "pan80_lt300_g", apertureUm: null, label: "低于60目旧合并档" }
  ];
  return Core.createRecord({
    user: { id: "tester", name: "Tester" },
    grinder: { brand: "Test", model, setting: String(order), settingOrder: order, settingOrderSource: "legacy-unknown" },
    sample: { doseG: shares.reduce((sum, value) => sum + value, 0), durationSec: 60, sieveDevice: "legacy test sieve" },
    weightsGrams: Object.fromEntries([...Core.SIEVES.slice(0, 4).map((sieve, index) => [sieve.key, shares[index]]), ["pan80_lt300_g", shares[4]]]),
    sieveProfile: { id: "grind-psd-sieve-v1", custom: false, legacy: true, bins },
    createdAt: `2026-09-0${order}T00:00:00.000Z`
  });
}

const regular = [
  makeRecord(1, [5, 20, 35, 25, 10, 5]),
  makeRecord(2, [3, 16, 33, 28, 13, 7]),
  makeRecord(3, [2, 11, 29, 31, 17, 10]),
  makeRecord(4, [1, 8, 24, 32, 21, 14]),
  makeRecord(5, [1, 5, 19, 31, 25, 19])
];
const report = Diagnostics.diagnose(regular, "Test", "Burr A");
assert.equal(report.formalRecords, 5);
assert.equal(report.groups.length, 5);
assert.equal(report.direction, "刻度增大时整体趋细");
assert.equal(report.grade, "M2");
assert.equal(report.bestObserved.setting, "1");
assert.equal(report.nextTest.order, 1.5);
assert.equal(report.candidates[0].pct.length, 6);
assert.ok(Math.abs(report.candidates[2].pct.reduce((sum, value) => sum + value, 0) - 100) < 1e-8);
assert.equal(report.predictions.length, 12);
assert.ok(report.extrapolations.length > 4, "continuous surface must extend farther than fixed 3-click forecast when justified");
assert.ok(report.extrapolations.some(p=>p.order >= 9), "forecasts beyond the previously fixed boundary");
assert.ok(report.extrapolations.every(p=>p.order >= 0), "unverified negative integer labels excluded");
assert.ok(report.extrapolations.every(p=>p.modelReliability >= 0.25 && p.modelReliability <= 1));
assert.ok(report.extrapolations.every(p=>Number.isInteger(p.order)), "do not silently infer fractional ticks");
assert.ok(report.extrapolations.every(p=>p.kind === "extrapolated"));
assert.ok(report.extrapolations.every(p=>p.pct.every(v=>v >= -1e-9)));
assert.ok(report.extrapolations.every(p=>Math.abs(p.pct.reduce((a,b)=>a+b,0)-100)<1e-8));
assert.ok(report.extrapolations.every(p=>p.intervals.every(x=>x.low>=0&&x.high<=100)));
assert.ok(report.extrapolations.filter(p=>p.side==="after").every((point,i,arr)=>i===0||point.modelReliability < arr[i-1].modelReliability));
assert.ok(report.extrapolations.filter(p=>p.side==="after").every((point,i,arr)=>i===0||point.uncertaintyPct >= arr[i-1].uncertaintyPct));
assert.deepEqual(report.surfaceDetail.thresholdsUm,[180,300,500,800,1000]);
const surface=Diagnostics.makeCdfSurface(report.groups);
assert.ok(surface);
for(const observed of report.groups){
  const recovered=surface.evaluate(observed.order);
  assert.ok(recovered.every((x,i)=>Math.abs(x-observed.vector[i])<1e-9),"surface retains observed knots exactly");
}
for(let g=-10;g<=50;g+=0.25){
  const profile=surface.evaluate(g);
  assert.ok(profile.every(x=>Number.isFinite(x)&&x>=-1e-10&&x<=1+1e-10));
  assert.ok(Math.abs(profile.reduce((a,b)=>a+b,0)-1)<1e-8);
  const cdfs=profile.slice().reverse().slice(0,5).map((_,i)=>profile.slice(5-i).reduce((a,b)=>a+b,0));
  assert.ok(cdfs.every((value,i)=>i===0||value+1e-10>=cdfs[i-1]),"CDF must increase across thresholds");
}
const far1=surface.evaluate(1000), far2=surface.evaluate(2000);
assert.ok(far1.every((v,i)=>Math.abs(v-far2[i])<1e-6),"outward curve approaches a bounded PSD limit");
for(let knot of [2,3,4]){
  const eps=1e-4,left=surface.evaluate(knot-eps),at=surface.evaluate(knot),right=surface.evaluate(knot+eps);
  assert.ok(left.every((v,i)=>Math.abs((at[i]-v)/eps-(right[i]-at[i])/eps)<0.005),"surface first derivative should be continuous at observed knots");
}

assert.ok(report.predictions.every((point) => Math.abs(point.pct.reduce((sum, value) => sum + value, 0) - 100) < 1e-8));
assert.ok(report.predictions.every((point) => point.intervals.every((range) => range.low >= 0 && range.high <= 100 && range.low <= range.high)));
assert.ok(report.predictions.every((point) => point.hydraulics.scenarios.length === 3));
assert.ok(report.predictions.every((point) => point.hydraulics.d32Um > 0 && point.hydraulics.relativeResistance > 0));
assert.ok(report.predictions.every((point) => point.hydraulics.scenarios[0].migrationRisk <= point.hydraulics.scenarios[1].migrationRisk));
assert.ok(report.predictions.every((point) => point.hydraulics.scenarios[1].migrationRisk <= point.hydraulics.scenarios[2].migrationRisk));
assert.equal(report.bestPrediction, null);
assert.equal(report.predictedRange.low, 1.25);
assert.equal(report.predictedRange.high, 4.75);
assert.equal(report.hydraulicEnvelope.length, 3);
assert.equal(report.measuredProfiles.length, 5);
assert.equal(report.roastAdvice.length, 6);
assert.ok(report.roastAdvice[0].order < report.roastAdvice[5].order, "deep roast starts coarser than very light roast");
assert.match(report.profileAssessments[0].style, /分布/);

const duplicate = makeRecord(3, [2, 11, 29, 31, 17, 10]);
const duplicateReport = Diagnostics.diagnose([...regular, duplicate], "Test", "Burr A");
assert.equal(duplicateReport.groups[2].records.length, 2);
assert.ok(duplicateReport.groups[2].repeatSpread < 1e-10);
assert.equal(duplicateReport.grade, "M1");

const legacy = makeLegacyRecord(6, [1, 3, 8, 2, 1], "Burr A");
const converted = Diagnostics.diagnose([...regular, legacy], "Test", "Burr A");
assert.equal(converted.records, 6);
assert.equal(converted.formalRecords, 6);
assert.equal(converted.legacyRecords, 1);
assert.equal(converted.inferredRecords, 1);
assert.equal(converted.excludedRecords, 0);
assert.equal(converted.groups.at(-1).vector.length, 6);
assert.equal(converted.unorderableRecords, 1, "legacy sorting without provenance must remain excluded");
assert.equal(Diagnostics.isCanonicalSixBin(legacy), false);

const legacyOnly = Diagnostics.diagnose([
  makeLegacyRecord(1, [1, 4, 7, 2, 1]),
  makeLegacyRecord(3, [1, 3, 8, 2, 1])
], "Test", "Legacy Burr");
assert.equal(legacyOnly.formalRecords, 2);
assert.equal(legacyOnly.legacyRecords, 2);
assert.equal(legacyOnly.groups.length, 0);
assert.equal(legacyOnly.predictions.length, 0);
assert.match(legacyOnly.evidence.join(" "), /旧格式记录/);

const partialRecord = makeRecord(3, [2, 11, 29, 31, 17, 10]);
delete partialRecord.weightsGrams.mesh80_retained_g;
const partialReport = Diagnostics.diagnose([...regular, partialRecord], "Test", "Burr A");
assert.equal(partialReport.inferredRecords, 1);
assert.match(partialReport.evidence.join(" "), /模型插补/);

const poorQuality = makeRecord(8, [1, 8, 24, 32, 21, 14]);
poorQuality.metrics.quality.grade = "D";
const qualityReport = Diagnostics.diagnose([...regular, poorQuality], "Test", "Burr A");
assert.equal(qualityReport.qualityAdjustedRecords, 1);
assert.equal(qualityReport.formalRecords, 6);

const noisyLowConfidence = makeRecord(3, [40, 25, 15, 10, 6, 4]);
noisyLowConfidence.metrics.quality.grade = "D";
const noisyHighConfidence = makeRecord(3, [40, 25, 15, 10, 6, 4]);
noisyHighConfidence.metrics.quality.grade = "A";
const lowConfidenceReport = Diagnostics.diagnose([...regular, noisyLowConfidence], "Test", "Burr A");
const highConfidenceReport = Diagnostics.diagnose([...regular, noisyHighConfidence], "Test", "Burr A");
const referenceCenter = regular[2].weightsGrams.mesh35_retained_g / Object.values(regular[2].weightsGrams).reduce((sum, value) => sum + value, 0);
const lowConfidenceCenter = lowConfidenceReport.groups[2].vector[2];
const highConfidenceCenter = highConfidenceReport.groups[2].vector[2];
assert.ok(Math.abs(lowConfidenceCenter - referenceCenter) < Math.abs(highConfidenceCenter - referenceCenter));
assert.ok(lowConfidenceReport.groups[2].dispersion > 0);
assert.ok(lowConfidenceReport.groups[2].confidence < highConfidenceReport.groups[2].confidence);
assert.ok(lowConfidenceReport.predictions.find((point) => point.order === 2.75).pct[2] > highConfidenceReport.predictions.find((point) => point.order === 2.75).pct[2]);
assert.ok(lowConfidenceReport.predictions.find((point) => point.left === 2 && point.right === 3).uncertaintyPct > report.predictions.find((point) => point.left === 2 && point.right === 3).uncertaintyPct);

const zigzag = [
  makeRecord(1, [1, 2, 3, 4, 20, 70]),
  makeRecord(2, [40, 25, 15, 10, 6, 4]),
  makeRecord(3, [1, 1, 3, 5, 20, 70]),
  makeRecord(4, [45, 25, 15, 8, 5, 2])
];
const zigzagReport = Diagnostics.diagnose(zigzag, "Test", "Burr A");
assert.equal(zigzagReport.grade, "M2");
assert.equal(zigzagReport.irregularGrinder, true);
assert.equal(zigzagReport.predictions.length, 0);
assert.equal(zigzagReport.extrapolations.length, 0);
assert.match(zigzagReport.gradeLabel, /不规律/);
assert.equal(zigzagReport.profileAssessments.length, 4, "irregular settings still receive measured PSD assessments");

const composite = [
  makeRecord(1, [4, 18, 33, 25, 13, 7], { setting: "2圈+5格" }),
  makeRecord(2, [2, 10, 25, 30, 20, 13], { setting: "2圈+8格" })
];
const compositeReport = Diagnostics.diagnose(composite, "Test", "Burr A");
assert.equal(compositeReport.groups.length, 0, "composite labels are never numerically guessed");
assert.equal(compositeReport.predictions.length, 0);
assert.equal(compositeReport.extrapolations.length, 0);
assert.equal(compositeReport.ambiguousOrderRecords, 2);
assert.equal(compositeReport.measuredProfiles.length, 2);
assert.equal(compositeReport.roastAdvice.length, 0, "never recommend roast settings without verified order");

const manuallyOrderedComposite = [
  makeRecord(1, [4, 18, 33, 25, 13, 7], { setting: "2圈+5格", settingOrderSource: "manual" }),
  makeRecord(2, [2, 10, 25, 30, 20, 13], { setting: "2圈+8格", settingOrderSource: "manual" })
];
assert.equal(Diagnostics.diagnose(manuallyOrderedComposite, "Test", "Burr A").groups.length, 2);
const mismatchedOrder = makeRecord(9, [4, 18, 33, 25, 13, 7]);
mismatchedOrder.grinder.settingOrder = 10;
assert.equal(Diagnostics.diagnose([mismatchedOrder], "Test", "Burr A").groups.length, 0);

const fineHeavy = makeRecord(1, [0, 0, 5, 10, 30, 55]);
const fineReport = Diagnostics.diagnose([fineHeavy], "Test", "Burr A");
assert.equal(fineReport.profileAssessments[0].clogging, "偏高");
assert.match(fineReport.profileAssessments[0].note, /堵塞/);
const sparse = Diagnostics.diagnose(regular.slice(0, 2), "Test", "Burr A");
assert.equal(sparse.grade, "M2");
assert.equal(sparse.predictions.length, 3);
assert.equal(sparse.looError, null);
assert.equal(Diagnostics.diagnose(regular.slice(0, 1), "Test", "Burr A").predictions.length, 0);

console.log("grinder diagnostics tests passed");
