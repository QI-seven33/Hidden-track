# 客户端壳源码

此目录保留历史 Android 与 Windows 壳实现，供阅读和后续配置自己的服务器。原默认服务地址已经下线；公开仓库不附带可直接连接当前服务的安装包。

- Android：Java + 系统 WebView，横屏显示，持久 Cookie，应用后台暂停音频。
- Windows：C#/.NET Framework + WebView2，x64。
- iOS：尚无正式客户端。

两端联网加载 H5，不包含完整 Node 后端。历史代码中的默认地址和版本号保留原状，后续发布客户端前需更新为自己控制且实际可用的服务，并重新验收登录与回跳。

`scripts/build-native.ps1` 是原构建脚本，需要自行准备 Android SDK/JDK、WebView2 SDK 与签名文件。正式私钥、密码和 SDK 二进制不提交到仓库；本轮没有重打客户端。

当前本地运行方式见 [开发说明](../docs/DEVELOPMENT.md)，Vercel 后续计划见 [部署说明](../docs/DEPLOYMENT.md)。
