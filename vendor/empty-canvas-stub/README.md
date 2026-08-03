# 这是什么 / 为什么需要它

`pdfjs-dist`（我们用来在软件里直接显示 PDF 的库）从某个版本起，在它自己的 `package.json` 里把 `canvas` 这个包列成了**必须安装**的依赖。

`canvas` 这个包不像 `sharp`、`ffmpeg-static` 那样有现成的、装好就能用的预编译文件——它需要在用户电脑上**用 C++ 编译器现场编译**。绝大多数 Windows 电脑没有装这类编译工具链，所以一跑 `npm install`，装到 `canvas` 这一步就会直接失败退出，导致整个安装中断（这正是你截图里 `canvas@2.11.2 install ... code: 1` 报错的原因）。

但好消息是：**我们的代码根本不需要这个 `canvas` 包**。它是给"没有真实浏览器环境、要在纯 Node.js 服务器上画 PDF"这种场景准备的。我们的软件是 Electron 应用，PDF 渲染发生在真实的应用窗口里（有真正的浏览器 DOM canvas 可以用），完全用不上这个需要编译的 Node 版 canvas。

所以这个 `vendor/empty-canvas-stub/` 文件夹，就是一个完全空的、什么都不做的占位包。`package.json` 里的 `overrides` 字段会告诉 npm："凡是有人想装 `canvas`，都给我换成这个空文件夹里的东西"，这样 npm 压根不会去尝试那个会失败的编译步骤，`npm install` 就能顺利跑完。

## 双重保险

光靠 `overrides` 不够稳——`electron-builder` 打包时有自己的依赖扫描逻辑，在某些情况下会找不到 `node_modules/canvas` 这个目录（即使 `npm install` 本身已经顺利跑完了），导致打包阶段报 `ENOENT` 错误。所以又加了一道保险：`scripts/ensure-canvas-stub.js`，配置成 `npm install` 跑完后自动执行的 `postinstall` 脚本，会主动检查并确保 `node_modules/canvas` 以正确的空占位包形式真实存在于磁盘上，不依赖 `overrides` 本身有没有按预期工作。

## 不要删除这个文件夹

如果删掉这个文件夹，或者从 `package.json` 里把对应的 `overrides` 配置删掉，`npm install` 会在大多数 Windows 电脑上重新报这个错误。

## 如果以后升级了 pdfjs-dist 的版本

升级前最好先确认新版本是不是仍然需要 `canvas`。可以打开新版本的 `node_modules/pdfjs-dist/package.json`，看 `dependencies` 字段里还有没有 `canvas`。如果新版本不再需要它了，这个占位包和 `package.json` 里的 `overrides` 配置就都可以删掉了。
