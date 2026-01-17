# XPath 辅助工具 (XPath Helper)

![Version](https://img.shields.io/badge/version-1.3.0-blue.svg)
![Manifest](https://img.shields.io/badge/manifest-V3-green.svg)
![License](https://img.shields.io/badge/license-MIT-orange.svg)

**XPath 辅助工具** 是一款基于 Chrome Manifest V3 开发的开发者工具，旨在帮助开发者快速获取、验证和调试网页元素的 XPath 路径。

> **v1.3.0 更新亮点**：全新采用 **Chrome Side Panel (侧边栏)** 设计，不再遮挡网页内容，支持 Shift+悬停 快速捕获！

## ✨ 核心功能

### 1. � 侧边栏交互 (Side Panel)
- **非侵入式设计**：扩展固定在浏览器右侧侧边栏，不再是以往的弹窗覆盖。
- **并行工作**：可以一边浏览网页，一边在侧边栏查看和操作 XPath，无需反复开关。

### 2. 👆 智能捕获模式
- **点击捕获**：点击页面元素，自动生成优化的 XPath。
- **Shift + 悬停**：鼠标悬停在元素上，点击即可获取Xpath路径。
- **可视化高亮**：
  - 🟢 绿色虚线：鼠标悬停预览
  - 🔵 蓝色实线：已选中元素

### 3. 🔍 实时验证模式
- **即时反馈**：在侧边栏输入 XPath，页面元素实时高亮。
- **详情列表**：侧边栏会列出所有匹配元素的详细信息（标签、ID、Class、文本预览）。
- **属性查看**：直观展示元素的关键属性，辅助精准定位。

### 4. ⌨️ 高效快捷键
| 快捷键 (Windows) | 快捷键 (Mac) | 功能 |
|------------------|--------------|------|
| `Ctrl + Shift + X` | `Cmd + Shift + X` | **打开/关闭侧边栏** |
| `Ctrl + Shift + C` | `Cmd + Shift + C` | **开启/停止捕获模式** |
| `Ctrl` (按住) | `Ctrl` (按住) | 在验证模式下暂停实时高亮 |

## 📁 项目结构

```text
xpath/
├── manifest.json       # 扩展配置文件 (Manifest V3)
├── background.js       # 后台服务 (Service Worker)
├── content.js          # 注入页面的核心逻辑脚本
├── popup.html          # 侧边栏界面 (原 Popup)
├── popup.css           # 侧边栏样式
├── popup.js            # 侧边栏交互逻辑
├── icons/              # 图标资源
└── package_extension.py # Python 打包脚本
```

## 🚀 安装指南

由于本工具尚未上架 Chrome 应用商店，请使用 **开发者模式** 安装：

1. 下载本项目源码或 `git clone` 到本地。
2. 打开 Chrome 浏览器，访问 `chrome://extensions/`。
3. 在右上角开启 **"开发者模式" (Developer mode)**。
4. 点击左上角的 **"加载已解压的扩展程序" (Load unpacked)**。
5. 选择本项目文件夹。
6. 安装完成！推荐将扩展固定在浏览器工具栏。

## 📖 使用说明

### 捕获 XPath
1. 按 `Ctrl + Shift + X` 打开侧边栏。
2. 点击侧边栏的 **"启动捕获"** 按钮，或按 `Ctrl + Shift + C`。
3. 鼠标悬停在页面元素上（显示绿色框）。
4. **点击** 目标元素，或按住 **Shift** 键悬停。
5. XPath 将自动填入侧边栏输入框，并显示该元素的详细属性。

### 验证 XPath
1. 在侧边栏输入框中输入 XPath 表达式（例如 `//div[@id="app"]`）。
2. 下方会自动显示匹配结果数量。
3. 点击 **"匹配元素列表"** 查看所有匹配项的详情。
4. 页面上的匹配项会显示橙色高亮。

## 🛠️ 开发与构建

本项目使用原生 JavaScript 开发，无需复杂的构建流程。