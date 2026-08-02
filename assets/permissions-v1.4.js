(function bootstrapGrindPsdPermissionsV17(root) {
  "use strict";

  const VERSION = "1.7.0";

  function patchPermissionsSource(source) {
    let patched = String(source || "");
    const replacements = [
      [
        '    if (isAdminAccount()) return true;\n    if (record?.user?.id === state.store.user.id) return true;',
        '    if (record?.user?.id === state.store.user.id) return true;'
      ],
      [
        '    if (current && current.user_id !== uid && !isAdminAccount()) {',
        '    if (current && current.user_id !== uid) {'
      ],
      [
        '    const ownerId = current?.user_id || uid;',
        '    const ownerId = uid;'
      ],
      [
        '          ownedByCurrentAccount: !isAdminAccount()',
        '          ownedByCurrentAccount: record.user?.id === state.store.user.id'
      ],
      [
        '      toast("普通账户只能编辑自己的本地记录。", "error");',
        '      toast("只能编辑当前登录账户本人的记录。", "error");'
      ],
      [
        '      toast("普通账户只能删除自己的本地记录。", "error");',
        '      toast("只能删除当前登录账户本人的本地记录。", "error");'
      ],
      [
        '    toast("当前修改仅写入本地；确认属于同一次测试后，可手动上传并按隐藏编码覆盖云端。", "success");',
        '    toast("编辑保存后将继续使用同一隐藏编码，并自动覆盖本人对应的云端记录。", "success");'
      ]
    ];
    replacements.forEach(([before, after]) => {
      if (!patched.includes(before)) {
        throw new Error(`Grind-PSD permissions v1.7 patch target missing: ${before.slice(0, 80)}`);
      }
      patched = patched.replace(before, after);
    });
    if (patched.includes('if (isAdminAccount()) return true;')) {
      throw new Error("Grind-PSD permissions v1.7 owner-only edit patch failed.");
    }
    return patched;
  }

  const api = Object.freeze({ version: VERSION, patchPermissionsSource });
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }

  function loadTextSync(url) {
    const request = new XMLHttpRequest();
    request.open("GET", url, false);
    request.send(null);
    if (request.status && (request.status < 200 || request.status >= 300)) {
      throw new Error(`Unable to load Grind-PSD module: ${url} (${request.status})`);
    }
    return request.responseText;
  }

  function execute(source, sourceUrl) {
    Function(`${source}\n//# sourceURL=${sourceUrl}`)();
  }

  const currentUrl = document.currentScript?.src || location.href;
  const baseUrl = new URL("./permissions-v1.4-base.js?v=1.7.0", currentUrl).href;
  const editUrl = new URL("./edit-entry-v1.7.js?v=1.7.0", currentUrl).href;
  execute(patchPermissionsSource(loadTextSync(baseUrl)), baseUrl);
  execute(loadTextSync(editUrl), editUrl);
  root.GrindPSDPermissionsLoaderV17 = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
