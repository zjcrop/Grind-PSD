"use strict";

const assert = require("node:assert/strict");
const Core = require("../assets/psd-core.js");

const record = Core.createRecord({
  user: { id: "tester-01", name: "测试用户" },
  grinder: {
    brand: "Test",
    model: "G1",
    setting: "2圈+5格",
    settingOrder: 2.005,
    color: "#d98e32"
  },
  sample: {
    doseG: 10,
    bean: "sample",
    roastLevel: "浅烘",
    method: "手动水平往复筛分",
    durationSec: 60,
    sieveDevice: "test sieve",
    replicate: 1
  },
  weightsGrams: {
    18: 0.1,
    24: 0.8,
    35: 5.2,
    60: 2.7,
    80: 0.7,
    pan: 0.5
  },
  license: Core.DATA_LICENSE,
  createdAt: "2026-07-29T00:00:00.000Z"
});

assert.equal(record.standardId, "grind-psd-sieve-v2");
assert.equal(record.totalG, 10);
assert.equal(record.metrics.quality.grade, "A");
assert.equal(record.metrics.quality.recoveryPct, 100);
assert.equal(record.metrics.coarsePct, 1);
assert.equal(record.metrics.bodyPct, 60);
assert.equal(record.metrics.finesPct, 5);
assert.equal(
  Core.round(Object.values(record.percentages).reduce((sum, value) => sum + value, 0), 2),
  100
);

const validation = Core.validatePublicRecord(record);
assert.deepEqual(validation.errors, []);
assert.equal(validation.record.grinder.settingOrder, 2.005);

const unlicensed = Core.validatePublicRecord({ ...record, license: null });
assert.ok(unlicensed.errors.some((message) => message.includes("CC BY 4.0")));

const poorRecovery = Core.createRecord({
  ...record,
  id: "gpsd-test-poor-recovery",
  sample: { ...record.sample, doseG: 20 },
  license: Core.DATA_LICENSE
});
assert.equal(poorRecovery.metrics.quality.grade, "D");
assert.ok(Core.validatePublicRecord(poorRecovery).errors.some((message) => message.includes("10%")));

assert.equal(Core.deriveSettingOrder("18"), 18);
assert.equal(Core.deriveSettingOrder("2圈+5格"), 2.005);
assert.equal(Core.deriveSettingOrder("无级刻度"), null);
assert.ok(!Core.recordGroupKey(record).includes("\u001f"));

const custom = Core.createSieveProfile([
  { mesh: 20, apertureUm: 850 },
  { mesh: 50, apertureUm: 300 },
  { mesh: 80, apertureUm: 180 }
]);
assert.equal(custom.bins.length, 4);
assert.equal(custom.bins[1].range, "300–850 μm");
assert.equal(custom.bins.at(-1).range, "< 180 μm");

const legacy = Core.createRecord({
  ...record,
  id: "legacy-five-bin",
  standardId: "grind-psd-sieve-v1",
  sieveProfile: undefined,
  weightsGrams: {
    mesh18_retained_g: 0.1,
    mesh24_retained_g: 0.8,
    mesh35_retained_g: 5.2,
    mesh60_retained_g: 2.7,
    pan80_lt300_g: 1.2
  }
});
assert.equal(legacy.sieveProfile.legacy, true);
assert.equal(Core.getRecordSieves(legacy).at(-1).range, "< 300 μm");

console.log("Grind-PSD core tests passed.");
