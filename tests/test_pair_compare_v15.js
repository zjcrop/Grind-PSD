"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Flat = require("../assets/pair-compare-v1.5.js");

assert.equal(Flat.version, "1.6.0");
assert.equal(Flat.MIN_FLAT_RECORDS, 2);
assert.equal(Flat.MAX_FLAT_RECORDS, 4);
assert.deepEqual(Flat.normalizeFlatSelection(["a", "b", "a", "c", "d", "e"]), ["a", "b", "c", "d"]);
assert.deepEqual(Flat.replaceFlatSelection(["a", "b", "c"], 0, "d"), ["d", "b", "c"]);
assert.deepEqual(Flat.replaceFlatSelection(["a", "b", "c"], 0, "b"), ["b", "a", "c"]);
assert.deepEqual(Flat.replaceFlatSelection(["a", "b", "c", "d"], 3, "a"), ["d", "b", "c", "a"]);
assert.deepEqual(Flat.moveFlatSelection(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
assert.deepEqual(Flat.moveFlatSelection(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
assert.deepEqual(Flat.appendFlatSelection(["a", "b", "c"], "d"), ["a", "b", "c", "d"]);
assert.deepEqual(Flat.appendFlatSelection(["a", "b", "c", "d"], "e"), ["a", "b", "c", "d"]);
assert.deepEqual(Flat.removeFlatSelection(["a", "b", "c"], 1), ["a", "c"]);
assert.deepEqual(Flat.removeFlatSelection(["a", "b"], 1), ["a", "b"]);

const source = fs.readFileSync(path.join(__dirname, "..", "assets", "pair-compare-v1.5.js"), "utf8");
assert.match(source, /MAX_FLAT_RECORDS = 4/);
assert.match(source, /平面柱状与曲线对比/);
assert.match(source, /data-flat-slot/);
assert.match(source, /data-flat-move/);
assert.match(source, /data-flat-add/);
assert.match(source, /data-flat-remove/);
assert.match(source, /alignPercentageDistributions/);
assert.match(source, /state\.selectedHistoryIds = new Set/);
assert.match(source, /ctx\.lineTo\(point\.x, point\.y\)/);
assert.match(source, /ctx\.arc\(point\.x, point\.y/);
assert.match(source, /柱体与折线颜色均对应/);
assert.match(source, /records\.length > MAX_FLAT_RECORDS/);

const loader = fs.readFileSync(path.join(__dirname, "..", "assets", "record-policy-core-v1.4.js"), "utf8");
assert.match(loader, /pair-compare-v1\.5\.js\?v=1\.6\.0/);

const worker = fs.readFileSync(path.join(__dirname, "..", "service-worker.js"), "utf8");
assert.match(worker, /grind-psd-shell-v1\.8\.2/);
assert.match(worker, /grind-psd-data-v1\.8\.2/);

console.log("Grind-PSD v1.6 flat bar-and-curve comparison tests passed under v1.8.2 shell.");
