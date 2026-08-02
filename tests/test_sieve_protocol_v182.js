"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Protocol = require("../assets/sieve-protocol-v1.8.2.js");

assert.equal(Protocol.version, "1.8.2");
assert.equal(Protocol.SHAKE_SECONDS_PER_SIEVE, 20);
assert.equal(Protocol.SHAKE_FREQUENCY_HZ, 2);
assert.equal(Protocol.SHAKE_CYCLES_PER_SIEVE, 40);
assert.equal(Protocol.DEFAULT_TOTAL_DURATION_SEC, 100);
assert.deepEqual(Protocol.NO_TAP_MESHES, [18, 24, 35]);
assert.deepEqual(Protocol.TAP_MESHES, [60, 80]);
assert.equal(Protocol.TAP_POSITIONS, 4);
assert.equal(Protocol.TAPS_PER_POSITION, 2);
assert.equal(Protocol.TOTAL_TAPS, 8);

const coarse = Protocol.protocolForMesh("35目");
assert.equal(coarse.tapRequired, false);
assert.equal(coarse.tappingProhibited, true);
assert.equal(coarse.shakeSeconds, 20);
assert.equal(coarse.shakeCycles, 40);

const fine60 = Protocol.protocolForMesh(60);
assert.equal(fine60.tapRequired, true);
assert.equal(fine60.tapTarget, "筛框侧壁");
assert.equal(fine60.totalTaps, 8);
assert.equal(fine60.tapsPerPosition, 2);

const fine80 = Protocol.protocolForMesh("80 mesh");
assert.equal(fine80.tapRequired, true);
assert.equal(fine80.totalTaps, 8);
assert.match(Protocol.ADHESION_STATEMENT, /避免静电吸附、受潮吸附需要敲击侧面/);
assert.match(Protocol.defaultMethodText(), /18\/24\/35目禁敲/);
assert.match(Protocol.defaultMethodText(), /60\/80目/);

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets", "sieve-protocol-v1.8.2.js"), "utf8");
const loader = fs.readFileSync(path.join(root, "assets", "permissions-v1.4.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
const standard = JSON.parse(fs.readFileSync(path.join(root, "data", "standard.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));

assert.match(source, /20 秒计时/);
assert.match(source, /四个等距方位各轻敲/);
assert.match(source, /只敲筛框，不敲筛网面或筛底/);
assert.match(source, /不得通过增加不定次数或加大力度强行过筛/);
assert.match(loader, /sieve-protocol-v1\.8\.2\.js\?v=1\.8\.2/);
assert.equal(standard.standardVersion, "2.1.0");
assert.equal(standard.operationProtocol.commonHorizontalMotion.durationSecPerSieve, 20);
assert.equal(standard.operationProtocol.commonHorizontalMotion.frequencyHzApprox, 2);
assert.deepEqual(standard.operationProtocol.noTapMeshes, [18, 24, 35]);
assert.deepEqual(standard.operationProtocol.fineMeshRelease.meshes, [60, 80]);
assert.equal(standard.operationProtocol.fineMeshRelease.totalTaps, 8);
assert.match(standard.operationProtocol.fineMeshRelease.requiredStatement, /避免静电吸附、受潮吸附需要敲击侧面/);
assert.match(worker, /grind-psd-shell-v1\.8\.2/);
assert.match(worker, /sieve-protocol-v1\.8\.2\.js/);
assert.equal(manifest.version, "1.8.2");

console.log("Grind-PSD v1.8.2 controlled sieve protocol tests passed.");
