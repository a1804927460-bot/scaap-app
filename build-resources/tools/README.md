# 内置 LibreOffice / ImageMagick（只剩这两个需要手动放）

把这两个免费工具的便携版（不需要安装、解压即用的那种）放进对应的文件夹里，打包时会自动被装进安装包，用户电脑上就不需要自己再装这些工具了。

**Poppler 和 FFmpeg 不需要再放在这里了**——这两个现在改成了随 `npm install` 自动下载对应平台二进制文件的 npm 包（`pdfjs-dist` 和 `ffmpeg-static`），你只要正常跑 `npm install` 就行，不需要手动下载、不需要手动放文件夹。

如果你暂时不想处理 LibreOffice/ImageMagick 这两个，跳过也完全没问题——软件会自动检测用户电脑上有没有装，没装的话会提示"需要安装 XXX"，并提供"用系统默认应用打开"作为兜底，不会报错或卡死。只是没内置的话，每个用户需要自己装一遍。

## 1. LibreOffice → 放进 `tools/soffice/`

**用在哪**：预览 Word / PPT / Excel 文档（转换成 PDF 后，用内置的 PDF.js 显示出来）。

下载 [LibreOffice Portable](https://portableapps.com/apps/office/libreoffice_portable)（PortableApps.com 出的免安装版，专门为这种"装进别的程序里"的场景设计）。

下载后解压，把解压出来的**整个文件夹内容**放进 `build-resources/tools/soffice/`。程序会自动在这个文件夹里递归查找 `soffice.exe`，所以具体嵌套几层都没关系。

## 2. ImageMagick → 放进 `tools/convert/`

**用在哪**：预览 PSD 文件。

下载 [ImageMagick 的便携版](https://imagemagick.org/script/download.php#windows)（页面上找 "Portable" 字样的版本，不是普通安装包）。解压后放进 `build-resources/tools/convert/`。

## 之后怎么用

放好之后正常跑：
```
npm run dist:win
```
打包时会自动把这两个文件夹的内容一起塞进安装包（`package.json` 里 `build.extraResources` 已经配置好了），用户装上你打出来的 exe 后，预览 Word/PPT/Excel/PSD 就会直接生效，不需要用户自己装任何东西。

## 体积提醒

LibreOffice 便携版大概 300-600MB，加上 ImageMagick，安装包会膨胀到 400-700MB 左右。这是这套方案本身的代价（换来的是用户零配置）。如果只想内置 LibreOffice、暂时跳过 ImageMagick（PSD 用得相对少），也完全可以。
