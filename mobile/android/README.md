# Grind-PSD Android 1.0

这是 Grind-PSD 正式网页的 Android WebView 容器，包名为
`com.zjcrop.grindpsd`，最低 Android 7.0（API 24）。

GitHub Actions 生成的 `app-debug.apk` 使用 Android 调试证书签名，可直接侧载测试；
正式发布与稳定覆盖升级必须改用固定的私有发布证书，并通过 GitHub Secrets 注入。
