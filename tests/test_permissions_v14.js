"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Policy = require("../assets/record-policy-core-v1.4.js");

const now = new Date(2026, 6, 31, 20, 1, 2, 345);
const first = Policy.createRecordId({
  userId: "zj_crop",
  email: "zj_crop@163.com",
  now,
  existingIds: []
});
const second = Policy.createRecordId({
  userId: "zj_crop",
  email: "zj_crop@163.com",
  now,
  existingIds: [first]
});
assert.match(first, /^gpsd-zjzj260731[0-9a-z]{5}$/);
assert.equal(first.slice(15, 18), "000");
assert.equal(second.slice(15, 18), "001");
assert.notEqual(first, second);

const records = [
  {
    id: first,
    totalG: 10,
    weightsGrams: { coarse: 4, fine: 6 },
    bins: [
      { key: "coarse", apertureUm: 800, range: "≥ 800 μm" },
      { key: "fine", apertureUm: null, range: "< 800 μm" }
    ]
  },
  {
    id: second,
    totalG: 20,
    weightsGrams: { coarse: 5, fine: 15 },
    bins: [
      { key: "coarse", apertureUm: 500, range: "≥ 500 μm" },
      { key: "fine", apertureUm: null, range: "< 500 μm" }
    ]
  }
];
const aligned = Policy.alignPercentageDistributions(records, (record) => record.bins);
assert.equal(aligned.bins.length, 4);
assert.equal(aligned.series[0].values.reduce((sum, value) => sum + value, 0), 100);
assert.equal(aligned.series[1].values.reduce((sum, value) => sum + value, 0), 100);
assert.ok(aligned.series[0].values.includes(0));
assert.ok(aligned.series[1].values.includes(0));

assert.deepEqual(
  Policy.orderSelectedIds(["a", "b", "c", "b"], ["c", "a", "missing"]),
  ["c", "a", "b"]
);
assert.deepEqual(Policy.orderSelectedIds(["a", "b"], []), ["a", "b"]);

const policySource = fs.readFileSync(
  path.join(__dirname, "..", "assets", "record-policy-core-v1.4.js"),
  "utf8"
);
assert.match(policySource, /installComparisonOrdering/);
assert.match(policySource, /data-compare-order-id/);
assert.match(policySource, /dragstart/);
assert.match(policySource, /pointerdown/);
assert.match(policySource, /state\.selectedHistoryIds = new Set/);
assert.match(policySource, /下方 3D 图按此顺序同步重绘/);

const permissions = fs.readFileSync(path.join(__dirname, "..", "assets", "permissions-v1.4.js"), "utf8");
assert.match(permissions, /zj_crop@163\.com/);
assert.match(permissions, /Cloud\.isSignedIn = \(\) => false/);
assert.match(permissions, /云端只读核对/);
assert.match(permissions, /data-edit-local/);
assert.match(permissions, /data-delete-cloud/);
assert.match(permissions, /缺失区间按 0% 补全/);
assert.match(permissions, /replace_measurement_fractions/);

const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "migrations", "20260731_record_permissions.sql"),
  "utf8"
);
assert.match(migration, /measurements_delete_admin_only/);
assert.match(migration, /guard_grind_psd_measurement_identity/);
assert.match(migration, /admin_delete_grind_psd_record/);
assert.match(migration, /replace_measurement_fractions/);
assert.match(migration, /zj_crop@163\.com/);

console.log("Grind-PSD v1.4 permission, alignment, and comparison ordering tests passed.");
