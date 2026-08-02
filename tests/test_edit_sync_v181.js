"use strict";

const assert = require("node:assert/strict");
const api = require("../assets/edit-sync-v1.8.1.js");

assert.equal(api.version, "1.8.1");

const base = {
  id: "rec-1",
  standardId: "grind-psd-sieve-v2",
  user: { id: "u1", name: "本地名称" },
  grinder: {
    brand: "Brand",
    model: "Model",
    setting: "10",
    settingTurns: 1.5,
    settingOrder: 10,
    color: "#ABCDEF"
  },
  sample: {
    doseG: 20,
    bean: "sample",
    roastLevel: "浅烘",
    method: "水平筛分",
    durationSec: 60,
    sieveDevice: "五筛六分段",
    replicate: 1
  },
  weightsGrams: { bin_b: 2, bin_a: 1 },
  sieveProfile: {
    bins: [{ key: "bin_a", mesh: 18, apertureUm: 1000, range: ">=1000", label: "粗粉" }]
  },
  notes: "note",
  createdAt: "2026-08-02T00:00:00Z",
  updatedAt: "2026-08-02T01:00:00Z"
};

const remoteSame = JSON.parse(JSON.stringify(base));
remoteSame.updatedAt = "2026-08-02T05:00:00Z";
remoteSame.user.name = "服务器展示名";
remoteSame.grinder.color = "#abcdef";

assert.equal(api.recordContentSignature(base), api.recordContentSignature(remoteSame));

const changed = JSON.parse(JSON.stringify(base));
changed.id = "rec-2";
changed.weightsGrams.bin_a = 1.01;
const remoteChangedBaseline = JSON.parse(JSON.stringify(changed));
remoteChangedBaseline.weightsGrams.bin_a = 1;

const partition = api.partitionUnchangedRecords(
  [base, changed],
  [remoteSame, remoteChangedBaseline]
);
assert.deepEqual(partition.skipped.map((record) => record.id), ["rec-1"]);
assert.deepEqual(partition.upload.map((record) => record.id), ["rec-2"]);
assert.equal(api.ownsRecord(base, "u1"), true);
assert.equal(api.ownsRecord(base, "u2"), false);

console.log("Grind-PSD v1.8.1 edit and upload deduplication tests passed.");