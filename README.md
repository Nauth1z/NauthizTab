# Nauthiz Tab

当前版本：**1.1.0**。版本变更见 [更新日志](CHANGELOG.md)。

Nauthiz Tab 是一个面向 Microsoft Edge / Chromium 的 Manifest V3 新标签页扩展。它用一个单屏、自包含的新标签页替换浏览器默认页面，只提供本地壁纸、固定搜索提供商、最多 24 个快捷方式和一个设置面板。

## 技术栈

- Microsoft Edge / Chromium Manifest V3
- React 19 + TypeScript
- Vite 7
- dnd-kit（快捷方式拖拽）
- `chrome.storage.local`（版本化设置与快捷方式元数据）
- IndexedDB（处理后的自定义图标 Blob）
- Origin Private File System / OPFS（当前壁纸文件）
- Vitest（核心逻辑与清单测试）
- 模块化本地 CSS（不使用远程样式或脚本）

## 功能

- 通过 `chrome_url_overrides.newtab` 接管 Edge 新标签页。
- 五个固定搜索提供商：Bing、Google、百度、DuckDuckGo、搜狗；默认 Bing，选择会持久化。
- 10 列 × 7 行单页逻辑网格，最多仍为 24 个快捷方式；支持空槽、拖到空槽和两个快捷方式交换位置。
- 搜索框作为占用 6 × 1 格的小部件参与桌面布局；输入框为空且提供商菜单关闭时，可长按输入框拖动并挤开冲突图标。
- 最多 24 个快捷方式；支持自动 favicon 和 128×128 WebP 自定义图标。
- 右键菜单支持修改名称、修改域名、修改图标、刷新图标和删除，删除不会重排其他槽位。
- 多个新标签页实时同步设置，使用 Web Locks 协调写入，按快捷方式 ID 更新，避免旧页面覆盖新数据。
- 支持 JPG/JPEG、PNG、WebP 静态壁纸（最大 30 MB）和 MP4、WebM 视频壁纸（最大 200 MB）。
- 壁纸流式写入 OPFS，导入与清理使用同一跨页面锁；先写入并校验新文件，再切换元数据。提交后的清理失败会在下次启动时重试。
- 视频自动播放、静音、循环、`playsInline`，页面隐藏时暂停，恢复可见时尝试继续播放。
- 无 content script、后台 Service Worker、远程脚本、远程壁纸源或额外数据上传。

## 项目架构

```text
.
├─ public/
│  └─ manifest.json              # Manifest V3 清单与新标签页覆盖声明
├─ src/
│  ├─ components/
│  │  ├─ SettingsPanel.tsx       # 壁纸与快捷方式设置
│  │  ├─ ShortcutDialogs.tsx     # 名称、域名、图标和删除弹窗
│  │  └─ ShortcutIcon.tsx        # 图标加载、手动重试和首字母回退
│  ├─ hooks/                    # 设置同步、搜索拖动、壁纸和键盘焦点管理
│  ├─ lib/
│  │  ├─ search.ts               # 固定搜索 URL 构建与查询编码
│  │  └─ shortcuts.ts            # URL 安全校验、空槽查找、移动/交换逻辑
│  ├─ storage/
│  │  ├─ appStorage.ts           # 版本化 chrome.storage.local 读写与迁移入口
│  │  ├─ iconStore.ts            # 图标裁剪、WebP 编码与 IndexedDB 生命周期
│  │  ├─ locks.ts                # 跨页面存储互斥锁
│  │  └─ wallpaperStore.ts       # OPFS 流式导入、恢复、替换与清理
│  ├─ App.tsx                    # 新标签页 UI 和交互编排
│  ├─ constants.ts               # 固定提供商、容量与格式白名单
│  ├─ styles.css                 # 单屏响应式视觉样式
│  └─ types.ts                   # 版本化数据结构
├─ index.html
├─ package.json
├─ tsconfig.json
└─ vite.config.ts
```

存储职责彼此分离：`chrome.storage.local` 只保存 JSON 元数据，IndexedDB 只保存自定义图标 Blob，OPFS 只保存当前壁纸文件。UI 不直接拼装存储键。当前数据结构为 `schemaVersion: 2`，使用递增的 `revision` 忽略过期更新，并从版本 1 自动迁移。遇到不兼容的数据版本时保留原数据并阻止写入。图标写入和删除均等待 IndexedDB 事务提交后才报告成功。

## 开发与验证

要求 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run typecheck
npm test
npm run build
```

运行 `npm run test:browser` 可在临时独立配置中加载扩展，验证真实浏览器的多标签页同步、图标上传、OPFS 壁纸导入和数据版本保护。脚本使用 Chrome DevTools Protocol，无额外测试依赖；默认检测 Windows 上的 Chrome / Edge，其他安装位置可通过 `NAUTHIZ_BROWSER` 指定。测试结束会关闭浏览器并清理临时配置。

开发预览可运行 `npm run dev`。普通网页预览环境没有扩展专属的 `chrome.storage`、`favicon` 权限及完整 OPFS 隔离语义，因此功能验收应以加载 `dist` 扩展后的 Edge 新标签页为准。

## 版本管理

采用 `MAJOR.MINOR.PATCH` 语义化版本：不兼容变更递增主版本，兼容的新功能递增次版本，兼容的缺陷修复递增修订版本。每次更新须同步 `package.json`、`package-lock.json` 的项目版本（顶层及根包）、`public/manifest.json`、本说明中的当前版本和 `CHANGELOG.md`，并重新构建以更新 `dist/manifest.json`。构建产物不纳入 Git。

应用版本与本地数据的 `schemaVersion` 独立管理；应用版本升级不要求修改数据结构版本。

## 在 Microsoft Edge 中运行

1. 执行 `npm run build`，生成项目根目录下的 `dist` 文件夹。
2. 在 Edge 地址栏打开 `edge://extensions`。
3. 打开页面左侧的“开发人员模式”。
4. 点击“加载解压缩的扩展”。
5. 选择本项目的 `dist` 文件夹，而不是项目根目录。
6. 打开一个新标签页进行使用和浏览器内验收。

修改源代码后需要重新运行 `npm run build`，再在扩展管理页点击该扩展的“重新加载”。若多个扩展同时接管新标签页，Edge 可能只启用其中一个，请暂时停用冲突扩展。

## 使用方法

- 在搜索框输入关键词后按 Enter，或点击右侧放大镜；输入法确认候选词时不会触发搜索。点击左侧下箭头可切换搜索提供商。
- 搜索框为空且搜索提供商菜单关闭时，长按输入区域约 0.36 秒即可拖动；落到图标区域时，冲突图标会自动让位。
- 点击右上角齿轮打开设置。可导入或删除当前壁纸，也可添加快捷方式。
- 添加快捷方式时，裸域名会自动补全为 `https://`；支持 `example.com:8080`、`localhost:3000` 和 IPv6 端口地址，只允许 HTTP 和 HTTPS。
- 拖动快捷方式到空槽可移动，拖到另一个图标上可交换位置。
- 在快捷方式上点击右键可以修改名称、修改域名、修改图标、刷新图标或删除。修改图标可上传新文件或切回自动获取；修改域名支持裸域名或完整 URL。
- 自动图标使用 Chrome 本地 favicon 接口，浏览器没有对应图标记录时可能显示默认图标。可先访问站点再右键刷新图标，也可上传自定义图标。
- 菜单支持方向键、Home / End；弹窗与设置面板限制 Tab 焦点，关闭后恢复到触发按钮。
- 点击设置面板外部、菜单外部或按 Escape 可关闭相应浮层。

## 权限与隐私

清单仅申请 `storage`、`favicon` 和 `unlimitedStorage`。扩展不会上传壁纸、图标、快捷方式或搜索记录，不主动下载壁纸或其他远程资源。只有用户执行搜索、点击快捷方式，或浏览器通过 `_favicon` 地址解析用户配置站点图标时，才可能访问对应站点。
