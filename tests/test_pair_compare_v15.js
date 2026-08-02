"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Pair = require("../assets/pair-compare-v1.5.js");

assert.equal(Pair.version, "1.5.0");
assert.deepEqual(Pair.normalizePair(["a", "b", "a", "c"]), ["a", "b"]);
assert.deepEqual(Pair.replacePairSelection(["a", "b"], 0, "c"), ["c", "b"]);
assert.deepEqual(Pair.replacePairSelection(["a", "b"], 1, "c"), ["a", "c"]);
assert.deepEqual(Pair.replacePairSelection(["a", "b"], 0, "b"), ["b", "a"]);
assert.deepEqual(Pair.replacePairSelection(["a", "b"], 1, "a"), ["b", "a"]);
assert.deepEqual(Pair.replacePairSelection(["a"], 0, "b"), ["a"]);

const source = fs.readFileSync(path.join(__dirname, "..", "assets", "pair-compare-v1.5.js"), "utf8");
assert.match(source, /canvasCmpPair2d/);
assert.match(source, /data-pair-slot/);
assert.match(source, /alignPercentageDistributions/);
assert.match(source, /state\.selectedHistoryIds = new Set/);
assert.match(source, /无需返回历史记录/);
assert.match(source, /缺失的区间按 0% 补全/);
assert.match(source, /records\.length !== 2/);

console.log("Grind-PSD v1.5 pair comparison tests passed.");
