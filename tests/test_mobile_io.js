"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../assets/psd-core.js");

class TestFile {
  constructor(parts, name, options = {}) {
    this.parts = parts;
    this.name = name;
    this.type = options.type || "";
    this.lastModified = options.lastModified || 0;
  }
}

const sharedFiles = [];
const toastElement = { textContent: "", className: "" };
const documentStub = {
  addEventListener() {},
  getElementById(id) {
    return id === "toast" ? toastElement : null;
  }
};
const context = vm.createContext({
  AbortController,
  Blob,
  File: TestFile,
  GrindPSDCore: Core,
  URL,
  clearTimeout() {},
  console,
  crypto: crypto.webcrypto,
  document: documentStub,
  navigator: {
    userAgent: "Mozilla/5.0 (Linux; Android 15; Mobile)",
    canShare({ files }) {
      return files?.length === 1;
    },
    async share({ files }) {
      sharedFiles.push(...files);
    }
  },
  setTimeout() {
    return 1;
  }
});
context.window = context;
context.window.GrindPSDCore = Core;
context.window.GrindPSDCloud = null;
context.window.addEventListener = () => {};
context.window.isSecureContext = true;
context.window.matchMedia = () => ({ matches: false });

const appPath = path.join(__dirname, "..", "assets", "app-v7.js");
vm.runInContext(fs.readFileSync(appPath, "utf8"), context, { filename: appPath });

const customProfile = Core.createSieveProfile([
  { mesh: 20, apertureUm: 850 },
  { mesh: 50, apertureUm: 300 },
  { mesh: 80, apertureUm: 180 }
]);
const customRecord = Core.createRecord({
  user: { id: "mobile-user", name: "手机用户" },
  grinder: {
    brand: "Test",
    model: "M1",
    setting: "12",
    settingTurns: 1.25,
    color: "#d98e32"
  },
  sample: {
    doseG: 10,
    bean: "测试豆",
    method: "手动水平往复筛分",
    durationSec: 60,
    sieveDevice: "测试筛",
    replicate: 1
  },
  sieveProfile: customProfile,
  weightsGrams: Object.fromEntries(
    customProfile.bins.map((bin, index) => [bin.key, [1, 5, 3, 1][index]])
  ),
  notes: "=SUM(A1:A2)"
});
context.testRecords = [customRecord];

(async () => {
  const csvResult = await vm.runInContext(
    'exportRecordsCsv(testRecords, "grind-psd-local")',
    context
  );
  assert.equal(csvResult, true);
  assert.equal(sharedFiles.length, 1);
  assert.match(sharedFiles[0].name, /^grind-psd-local-\d{4}-\d{2}-\d{2}\.csv$/);
  const csvBlob = sharedFiles[0].parts[0];
  const csvBytes = new Uint8Array(await csvBlob.arrayBuffer());
  assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = await csvBlob.text();
  assert.ok(csv.startsWith("record_id,"));
  customProfile.bins.forEach((bin) => assert.ok(csv.includes(bin.key)));
  assert.ok(csv.includes("sieve_profile_id"));
  assert.ok(csv.includes("'=SUM(A1:A2)"));

  vm.runInContext(`
    state.store = {
      user: { id: "mobile-user", name: "手机用户" },
      catalog: {},
      records: testRecords
    };
  `, context);
  const jsonResult = await vm.runInContext("exportAllJson()", context);
  assert.equal(jsonResult, true);
  assert.equal(sharedFiles.length, 2);
  assert.match(sharedFiles[1].name, /^grind-psd-local-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = JSON.parse(await sharedFiles[1].parts[0].text());
  assert.equal(backup.records.length, 1);
  assert.equal(backup.records[0].id, customRecord.id);

  const fallbackUuid = vm.runInContext(`
    (() => {
      const original = globalThis.crypto;
      globalThis.crypto = { getRandomValues: original.getRandomValues.bind(original) };
      const value = createUuidV4();
      globalThis.crypto = original;
      return value;
    })()
  `, context);
  assert.match(
    fallbackUuid,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );

  console.log("Grind-PSD mobile export and UUID tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
