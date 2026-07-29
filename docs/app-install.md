# Grind-PSD App 安装说明

Grind-PSD 是静态网页应用，当前 app 化方式采用 PWA。PWA 不需要单独安装包签名，也不会把 GitHub 写入令牌暴露在客户端；社区数据上传仍通过 GitHub Issue 和 Actions 校验入库。

## 安卓 / Chrome

1. 打开 `https://zjcrop.github.io/Grind-PSD/`。
2. 点击浏览器菜单。
3. 选择“添加到主屏幕”或“安装应用”。
4. 安装后可像普通 app 一样从桌面图标打开。

## iPhone / iPad

1. 使用 Safari 打开 `https://zjcrop.github.io/Grind-PSD/`。
2. 点击分享按钮。
3. 选择“添加到主屏幕”。

## 离线能力

首次成功打开网页后，基础页面、样式、脚本、标准 JSON 和当前社区数据库会被缓存。本地记录保存在设备浏览器的 `localStorage` 中；更换浏览器或清除浏览器数据会导致本地记录丢失，因此重要记录应导出 JSON 备份或提交到社区数据库。

## 当前限制

纯静态 PWA 不能直接安全写入 GitHub 仓库。若需要原生 Android APK、iOS IPA 或带账号体系的后端同步，需要新增后端服务、OAuth 登录和发布签名流程。
