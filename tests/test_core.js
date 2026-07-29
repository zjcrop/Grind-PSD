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
    80: 1.2
  },
  license: Core.DATA_LICENSE,
  createdAt: "2026-07-29T00:00:00.000Z"
});

assert.equal(record.standardId, "grind-psd-sieve-v1");
assert.equal(record.totalG, 10);
assert.equal(record.metrics.quality.grade, "A");
assert.equal(record.metrics.quality.recoveryPct, 100);
assert.equal(record.metrics.coarsePct, 1);
assert.equal(record.metrics.bodyPct, 60);
assert.equal(record.metrics.finesPct, 12);
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

console.log("Grind-PSD core tests passed.");
