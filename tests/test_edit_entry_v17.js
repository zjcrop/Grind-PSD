"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const PermissionsLoader = require("../assets/permissions-v1.4.js");
const Entry = require("../assets/edit-entry-v1.7.js");

assert.equal(PermissionsLoader.version, "1.7.0");
assert.equal(Entry.version, "1.7.0");
assert.equal(Entry.ownsRecord({ user: { id: "owner" } }, "owner"), true);
assert.equal(Entry.ownsRecord({ user: { id: "other" } }, "owner"), false);
assert.equal(Entry.ownsRecord(null, "owner"), false);
assert.deepEqual(Entry.parseOptionalTurns(""), { valid: true, value: null });
assert.deepEqual(Entry.parseOptionalTurns("2.3456"), { valid: true, value: 2.346 });
assert.equal(Entry.parseOptionalTurns("-0.1").valid, false);
assert.equal(Entry.parseOptionalTurns("abc").valid, false);
assert.equal(Entry.nextEntryIndex(0, 3), 1);
assert.equal(Entry.nextEntryIndex(2, 3), -1);

const basePermissions = fs.readFileSync(
  path.join(__dirname, "..", "assets", "permissions-v1.4-base.js"),
  "utf8"
);
const patchedPermissions = PermissionsLoader.patchPermissionsSource(basePermissions);
assert.doesNotMatch(patchedPermissions, /if \(isAdminAccount\(\)\) return true/);
assert.match(patchedPermissions, /if \(current && current\.user_id !== uid\)/);
assert.doesNotMatch(patchedPermissions, /current\.user_id !== uid && !isAdminAccount/);
assert.match(patchedPermissions, /const ownerId = uid/);
assert.match(patchedPermissions, /ownedByCurrentAccount: record\.user\?\.id === state\.store\.user\.id/);
assert.match(patchedPermissions, /自动覆盖本人对应的云端记录/);

const entrySource = fs.readFileSync(
  path.join(__dirname, "..", "assets", "edit-entry-v1.7.js"),
  "utf8"
);
assert.match(entrySource, /dose\.insertAdjacentElement\("afterend", turns\)/);
assert.match(entrySource, /focusFinalFirst/);
assert.match(entrySource, /event\.key !== "Enter"/);
assert.match(entrySource, /data-weight/);
assert.match(entrySource, /pushAndVerifyRecord\(record\)/);
assert.match(entrySource, /saved\.updatedAt === previousUpdatedAt/);
assert.match(entrySource, /同一云端测次/);
assert.match(entrySource, /recordTableV17/);
assert.match(entrySource, /没有当前登录账户本人的可上传记录/);

const worker = fs.readFileSync(path.join(__dirname, "..", "service-worker.js"), "utf8");
assert.match(worker, /grind-psd-shell-v1\.7\.0/);
assert.match(worker, /permissions-v1\.4-base\.js/);
assert.match(worker, /edit-entry-v1\.7\.js/);

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.webmanifest"), "utf8"));
assert.equal(manifest.version, "1.7.0");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "migrations", "20260802_owner_edit_only.sql"),
  "utf8"
);
assert.match(migration, /measurements_update_owner_only/);
assert.match(migration, /using \(user_id = auth\.uid\(\)\)/);
assert.match(migration, /Only the record owner may replace this measurement/);
assert.doesNotMatch(migration, /create policy\s+measurements_update_owner_or_admin/i);
assert.doesNotMatch(migration, /create policy\s+measurement_fractions_update_owner_or_admin/i);

console.log("Grind-PSD v1.7 owner editing and final-entry tests passed.");
