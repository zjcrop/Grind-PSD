"use strict";

const assert = require("node:assert/strict");
const Core = require("../assets/psd-core.js");
const Diagnostics = require("../assets/grinder-diagnostics.js");

function makeRecord(order, shares, options = {}) {
  return Core.createRecord({
    user: { id: "tester", name: "Tester" },
    grinder: { brand: "Test", model: "Burr A", setting: String(order), settingOrder: order },
    sample: { doseG: shares.reduce((sum, value) => sum + value, 0), durationSec: 60, sieveDevice: "test sieve" },
    weightsGrams: Object.fromEntries(Core.SIEVES.map((sieve, index) => [sieve.key, shares[index]])),
    sieveProfile: options.profile,
    createdAt: `2026-10-0${Math.min(order, 6)}T00:00:00.000Z`
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
assert.equal(report.bestObserved.setting, "2");
assert.equal(report.nextTest.order, 1.5);
assert.equal(report.candidates[0].pct.length, 6);
assert.ok(Math.abs(report.candidates[2].pct.reduce((sum, value) => sum + value, 0) - 100) < 1e-8);

const duplicate = makeRecord(3, [2, 11, 29, 31, 17, 10]);
const duplicateReport = Diagnostics.diagnose([...regular, duplicate], "Test", "Burr A");
assert.equal(duplicateReport.groups[2].records.length, 2);
assert.ok(duplicateReport.groups[2].repeatSpread < 1e-10);
assert.equal(duplicateReport.grade, "M1");

const legacyProfile = {
  id: "grind-psd-sieve-v1", custom: false, legacy: true,
  bins: [...Core.SIEVES.slice(0, 4), { key: "pan80_lt300_g", apertureUm: null }]
};
const legacy = makeRecord(6, [1, 3, 8, 2, 1, 0], { profile: legacyProfile });
const excluded = Diagnostics.diagnose([...regular, legacy], "Test", "Burr A");
assert.equal(excluded.records, 6);
assert.equal(excluded.formalRecords, 5);
assert.equal(excluded.excludedRecords, 1);
assert.equal(Diagnostics.isCanonicalSixBin(legacy), false);

const poorQuality = makeRecord(8, [1, 8, 24, 32, 21, 14]);
poorQuality.metrics.quality.grade = "D";
const qualityReport = Diagnostics.diagnose([...regular, poorQuality], "Test", "Burr A");
assert.equal(qualityReport.qualityRejectedRecords, 1);
assert.equal(qualityReport.formalRecords, 5);

const zigzag = [
  makeRecord(1, [1, 2, 3, 4, 20, 70]),
  makeRecord(2, [40, 25, 15, 10, 6, 4]),
  makeRecord(3, [1, 1, 3, 5, 20, 70]),
  makeRecord(4, [45, 25, 15, 8, 5, 2])
];
assert.equal(Diagnostics.diagnose(zigzag, "Test", "Burr A").grade, "M4");
assert.equal(Diagnostics.diagnose(regular.slice(0, 2), "Test", "Burr A").grade, "M3");

console.log("grinder diagnostics tests passed");
