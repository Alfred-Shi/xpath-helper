# XPath 辅助工具 (XPath Helper)

![Version](https://img.shields.io/badge/version-1.4.0-blue.svg)
![Manifest](https://img.shields.io/badge/manifest-V3-green.svg)
![License](https://img.shields.io/badge/license-MIT-orange.svg)

**XPath 辅助工具** 是一款基于 Chrome Manifest V3 开发的开发者工具，旨在帮助开发者快速获取、验证和调试网页元素的 XPath 路径。

> **最新优化版 (v1.4.0) 核心改进**：
> - 🌐 **多框架 (iframe) 精准通信**：完美解决多 frame 实例通信碰撞问题，利用 `chrome.webNavigation.getAllFrames` 检索并并发通信，支持各 iframe 内部元素的独立验证高亮、精准闪烁定位与平滑滚动。
> - ⚡ **事件监听器按需挂载**：仅在捕获模式激活时挂载 `mousemove`、`click` 等事件监听器，停用时彻底移除，彻底解决对宿主网页的常驻内存和 CPU 开销。
> - 🧠 **短小精悍的相似 XPath 算法**：重构相似元素 Pivot 公共锚点搜索策略，采用自下而上（叶子到根）的方向进行回溯计算，生成的相似 XPath 更加紧凑稳定；新增了短文本定位 (`//tag[text()="xxx"]`) 和多 Class 组合过滤定位。
> - 📦 **包体积瘦身 99%**：物理移除了 2.33MB 冗余未引用的静态资源（如 `icons/icon32.png`），使打包后的扩展包大小从 2.4MB 大幅瘦身至约 50KB。
> - 🎨 **UI 视觉升级与自适应暗黑模式**：引入 Outfit 和 Inter 高级英文字体，增加毛玻璃背景卡片与微交互动效；完美适配 `prefers-color-scheme: dark` 媒体查询，遮罩层支持暗黑模式自适应。

## ✨ 核心功能

### 1. 📁 侧边栏交互 (Side Panel)
- **非侵入式设计**：扩展固定在浏览器右侧侧边栏，不遮挡网页主体内容。
- **并行工作**：可以一边浏览网页，一边在侧边栏查看和操作 XPath，无需反复开关。

### 2. 👆 智能捕获模式
- **点击捕获**：点击页面元素，自动生成优化的 XPath。
- **Shift + 悬停**：鼠标悬停在元素上，点击即可获取 XPath 路径。
- **多选及相似元素识别**：按住 `Ctrl` (Windows) 或 `Command` (Mac) 点击多个元素，自动计算并生成能匹配这组相似元素的 XPath。
- **属性防污染**：采用标准方法读取 ID，防范表单元素属性污染。
- **可视化高亮**：
  - 🟢 绿色虚线：鼠标悬停预览
  - 🔵 蓝色实线：已选中/多选匹配元素

### 3. 🔍 实时验证模式
- **即时反馈**：在侧边栏输入 XPath，页面元素实时高亮（🟠 橙色高亮）。
- **详情列表**：侧边栏列出所有匹配元素的详细信息（标签、ID、Class、文本预览、关键属性）。
- **点击跳转**：点击匹配列表中的任意卡片，网页将平滑滚动到对应元素位置并进行黄色背景高亮闪烁。
- **语法校验**：输入无效 XPath 时，侧边栏直接提示 XPath 抛出的详细解析异常。

### 4. ⌨️ 高效快捷键
| 快捷键 (Windows) | 快捷键 (Mac) | 功能 |
|------------------|--------------|------|
| `Ctrl + Shift + X` | `Cmd + Shift + X` | **打开/关闭侧边栏** |
| `Ctrl + Shift + C` | `Cmd + Shift + C` | **开启/停止捕获模式** |
| `Ctrl` (按住) | `Command` (按住) | 在捕获模式下激活相似元素多选 |

## 📁 项目结构

```text
xpath/
├── manifest.json       # 扩展配置文件 (Manifest V3)
├── background.js       # 后台服务 (Service Worker)
├── content.js          # 注入页面的核心逻辑脚本
├── popup.html          # 侧边栏界面
├── popup.css           # 侧边栏样式
├── popup.js            # 侧边栏交互逻辑
├── styles.css          # 注入页面的高亮和动画样式
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
4. **点击** 目标元素以生成单个 XPath；或按住 `Ctrl`/`Command` 键依次点击多个相似元素以生成相似元素组 XPath。
5. XPath 将自动填入侧边栏输入框，并显示对应元素的详细属性。

### 验证 XPath
1. 在侧边栏输入框中输入 XPath 表达式（例如 `//div[@id="app"]`）。
2. 下方会自动实时高亮网页中匹配的所有元素，并在侧边栏显示匹配列表。
3. 如果 XPath 表达式有误，输入框下方会显示红色的语法报错提示。
4. 点击匹配列表中的某个元素卡片，页面会自动滚动到该元素并闪烁提醒。

## 🛠️ 开发与构建

本项目使用原生 JavaScript 开发，无需复杂的构建流程。可以使用 `python package_extension.py` 快速打包扩展为 zip 压缩包。