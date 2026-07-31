"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SESSION_KEY = "grindPsdSupabaseSessionV1";
const storage = new Map([[
  SESSION_KEY,
  JSON.stringify({
    access_token: "expired-access-token",
    refresh_token: "valid-refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "cloud-user-id" }
  })
]]);
const calls = [];
let failNextProfileRequest = false;

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body === null ? "" : JSON.stringify(body);
    }
  };
}

async function fetchStub(url, options = {}) {
  calls.push({ url, options });
  if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
    return response(200, {
      access_token: "fresh-access-token",
      refresh_token: "fresh-refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "cloud-user-id" }
    });
  }
  if (url.includes("/rest/v1/profiles")) {
    if (options.headers?.Authorization === "Bearer expired-access-token") {
      return response(401, { message: "JWT expired" });
    }
    if (failNextProfileRequest) {
      failNextProfileRequest = false;
      return response(503, { message: "temporary upstream failure" });
    }
    return response(200, [{
      user_id: "cloud-user-id",
      handle: "mobile-user",
      display_name: "手机用户"
    }]);
  }
  throw new Error(`Unexpected request: ${url}`);
}

const context = vm.createContext({
  AbortController,
  URL,
  URLSearchParams,
  clearTimeout,
  console,
  fetch: fetchStub,
  history: { replaceState() {} },
  localStorage: {
    getItem(key) {
      return storage.get(key) || null;
    },
    removeItem(key) {
      storage.delete(key);
    },
    setItem(key, value) {
      storage.set(key, String(value));
    }
  },
  location: {
    hash: "",
    href: "https://zjcrop.github.io/Grind-PSD/",
    pathname: "/Grind-PSD/",
    search: ""
  },
  setTimeout(callback, milliseconds, ...args) {
    return setTimeout(callback, milliseconds >= 400 && milliseconds <= 500 ? 0 : milliseconds, ...args);
  }
});
context.window = context;
context.window.location = context.location;

const cloudPath = path.join(__dirname, "..", "assets", "supabase-sync-v7.2.2.js");
vm.runInContext(fs.readFileSync(cloudPath, "utf8"), context, { filename: cloudPath });

(async () => {
  const Cloud = context.window.GrindPSDCloud;
  await Cloud.init();
  const profile = await Cloud.profile();
  assert.equal(profile.handle, "mobile-user");
  assert.equal(calls.length, 3);

  const firstGet = calls[0];
  const refresh = calls[1];
  const retriedGet = calls[2];
  assert.equal(firstGet.options.headers.Authorization, "Bearer expired-access-token");
  assert.equal(firstGet.options.headers["Content-Type"], undefined);
  assert.equal(refresh.options.headers["Content-Type"], "application/json");
  assert.equal(retriedGet.options.headers.Authorization, "Bearer fresh-access-token");
  assert.equal(retriedGet.options.headers["Content-Type"], undefined);

  const persisted = JSON.parse(storage.get(SESSION_KEY));
  assert.equal(persisted.access_token, "fresh-access-token");
  assert.equal(Cloud.isSignedIn(), true);

  failNextProfileRequest = true;
  const retriedProfile = await Cloud.profile();
  assert.equal(retriedProfile.handle, "mobile-user");
  assert.equal(calls.length, 5);
  assert.match(calls[3].url, /\/rest\/v1\/profiles/);
  assert.match(calls[4].url, /\/rest\/v1\/profiles/);

  console.log("Grind-PSD Supabase refresh tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
