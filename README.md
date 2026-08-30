# Nauthiz Tab

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
- 右键菜单只提供修改名称和删除，删除不会重排其他槽位。
- 支持 JPG/JPEG、PNG、WebP 静态壁纸（最大 30 MB）和 MP4、WebM 视频壁纸（最大 200 MB）。
- 壁纸流式写入 OPFS，先写入并校验新文件，再切换元数据并清理旧文件；不保留历史列表。
- 视频自动播放、静音、循环、`playsInline`，页面隐藏时暂停，恢复可见时尝试继续播放。
- 无 content script、后台 Service Worker、远程脚本、远程壁纸源或额外数据上传。

## 项目架构

```text
.
├─ public/
│  └─ manifest.json              # Manifest V3 清单与新标签页覆盖声明
├─ src/
│  ├─ components/
│  │  └─ ShortcutIcon.tsx        # favicon / IndexedDB 图标加载和首字母回退
│  ├─ lib/
│  │  ├─ search.ts               # 固定搜索 URL 构建与查询编码
│  │  └─ shortcuts.ts            # URL 安全校验、空槽查找、移动/交换逻辑
│  ├─ storage/
│  │  ├─ appStorage.ts           # 版本化 chrome.storage.local 读写与迁移入口
│  │  ├─ iconStore.ts            # 图标裁剪、WebP 编码与 IndexedDB 生命周期
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

存储职责彼此分离：`chrome.storage.local` 只保存 JSON 元数据，IndexedDB 只保存自定义图标 Blob，OPFS 只保存当前壁纸文件。UI 不直接拼装存储键。当前数据结构为 `schemaVersion: 2`，会从版本 1 自动迁移快捷方式槽位并初始化搜索框位置；未来迁移统一从 `migrateAppData` 进入。

## 开发与验证

要求 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run typecheck
npm test
npm run build
```

开发预览可运行 `npm run dev`。普通网页预览环境没有扩展专属的 `chrome.storage`、`favicon` 权限及完整 OPFS 隔离语义，因此功能验收应以加载 `dist` 扩展后的 Edge 新标签页为准。

## 在 Microsoft Edge 中运行

1. 执行 `npm run build`，生成项目根目录下的 `dist` 文件夹。
2. 在 Edge 地址栏打开 `edge://extensions`。
3. 打开页面左侧的“开发人员模式”。
4. 点击“加载解压缩的扩展”。
5. 选择本项目的 `dist` 文件夹，而不是项目根目录。
6. 打开一个新标签页进行使用和浏览器内验收。

修改源代码后需要重新运行 `npm run build`，再在扩展管理页点击该扩展的“重新加载”。若多个扩展同时接管新标签页，Edge 可能只启用其中一个，请暂时停用冲突扩展。

## 使用方法

- 在搜索框输入关键词后按 Enter，或点击右侧放大镜；点击左侧下箭头可切换搜索提供商。
- 搜索框为空且搜索提供商菜单关闭时，长按输入区域约 0.36 秒即可拖动；落到图标区域时，冲突图标会自动让位。
- 点击右上角齿轮打开设置。可导入或删除当前壁纸，也可添加快捷方式。
- 添加快捷方式时，裸域名会自动补全为 `https://`；只允许 HTTP 和 HTTPS。
- 拖动快捷方式到空槽可移动，拖到另一个图标上可交换位置。
- 在快捷方式上点击右键可以修改名称或删除。
- 点击设置面板外部、菜单外部或按 Escape 可关闭相应浮层。

## 权限与隐私

清单仅申请 `storage`、`favicon` 和 `unlimitedStorage`。扩展不会上传壁纸、图标、快捷方式或搜索记录，不主动下载壁纸或其他远程资源。只有用户执行搜索、点击快捷方式，或浏览器通过 `_favicon` 地址解析用户配置站点图标时，才可能访问对应站点。
