# 文本批量调整（Photoshop CEP 版）

一个 **Photoshop CEP 扩展**：按字符属性（字体、字号、颜色、粗斜、可见性等）批量筛选并修改文档中的文本图层。CEP 面板是**非模态**的，面板打开时仍可正常操作 Photoshop。

## 一键安装

双击 **`安装插件.bat`**。安装程序会自动：

1. **索引本机环境**：列出检测到的 Photoshop 版本与所有 CEP 扩展目录；
2. **解决签名问题**：写入 `PlayerDebugMode=1`（`HKCU\Software\Adobe\CSXS.5`~`CSXS.25`，管理员运行时同时写 `HKLM`）；
3. **安装插件**：在 `%APPDATA%\Adobe\CEP\extensions\plugin-cep` 创建指向 `plugin-cep\` 的目录联接（源码改动即时生效）；
4. **加固调试标记**：在扩展目录放置 `.debug` 文件，强制以调试模式加载。

安装后**完全退出并重启 Photoshop**，菜单 `窗口 > 扩展(旧版) > 文本批量调整`。

> 卸载：双击 `卸载插件.bat`。

命令行（可选）：

```
powershell -ExecutionPolicy Bypass -File tools\install-cep.ps1
powershell -ExecutionPolicy Bypass -File tools\install-cep.ps1 -AllUsers     # 所有用户（需管理员）
powershell -ExecutionPolicy Bypass -File tools\install-cep.ps1 -Copy         # 复制代替联接
powershell -ExecutionPolicy Bypass -File tools\install-cep.ps1 -Uninstall
powershell -ExecutionPolicy Bypass -File tools\install-cep.ps1 -Uninstall -RemoveDebugMode
```

## 目录结构

```
PSPlugin-TextAdjust/
├─ 安装插件.bat               一键安装
├─ 卸载插件.bat               一键卸载
├─ plugin-cep/                插件本体（安装到 CEP 扩展目录）
│  ├─ CSXS/manifest.xml       扩展清单
│  ├─ index.html              面板界面
│  ├─ css/styles.css          样式
│  ├─ js/main.js              界面逻辑 + 与 Photoshop 通信
│  └─ jsx/host.jsx            宿主脚本（TA_scan / TA_getFonts / TA_apply / TA_selectLayers）
├─ tools/install-cep.ps1      安装/卸载逻辑
├─ 使用说明.md                详细使用文档
└─ README.md
```

`main.js` 通过 `window.__adobe_cep__.evalScript` 调用 `host.jsx`，数据以 JSON 字符串传递。

## 主要功能

- 实时筛选：关键字、字体字形（“字体系列 - 字体样式”逐行显示，含/排除）、颜色（匹配/排除 + 容差）、字号范围、粗体、斜体、可见性；字体列表支持拖选并标识缺失字体。
- 图层列表：整行点击或拖选、行高滑杆（过窄时自动隐藏正文预览）、一键 `全选 / 反选 / 清空`。
- **选中**：把列表中的选中项同步多选到 Photoshop 图层面板。
- 批量修改：字体系列 + 样式、字号（固定/按比例）、颜色、粗斜、下划线、删除线、大小写、基线、字距、行距、缩放、消除锯齿、自动字距等。
- 调试输出：记录每次操作的过程与错误。

## 说明

- 中文文本请选择含中文字形的字体，否则 Photoshop 会静默替换字体；批量应用时会临时设置 `displayDialogs = NO` 抑制弹窗。
- `.debug` 标记由安装程序生成并已被 `.gitignore` 忽略。
- CEP 属较旧技术，Adobe 已不再演进，但至今仍被 Photoshop 支持。

## 详细文档

见 [使用说明.md](使用说明.md)。
