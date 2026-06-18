# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 语言规则（最高优先级）

- **必须使用中文进行所有回复、思考和交流**
- 所有代码注释使用中文
- 所有文档和说明使用中文
- 除非用户明确要求使用其他语言，否则一律使用中文

## 项目概述

个人减肥追踪应用，由用户（昕露，17 岁，175cm，目标 75.8kg→65kg）日常使用。包含体重记录、饮食记录、运动计划、AI 识别分析等功能。

## 启动方式

```bash
# 一键启动（推荐）
双击 weight-tracker/start.bat

# 手动启动
cd weight-tracker
node proxy-server.js
# 然后浏览器打开 http://localhost:3000
```

启动脚本会自动杀掉端口 3000 上的旧进程、启动代理服务器、打开浏览器。服务器无心跳 60 秒后自动退出。

## 架构

### 仓库结构

- `weight-tracker/` — 减肥追踪 Web 应用

### weight-tracker 核心文件

- **index.html** — 单文件应用（HTML + CSS + JS 全内联，约 2800 行）。所有页面、样式、逻辑都在这一个文件里
- **proxy-server.js** — Node.js 代理服务器，解决浏览器 CORS 跨域问题，内嵌 MiMO API Key，提供静态文件服务、SSE 实时同步、数据存储
- **start.bat** — Windows 一键启动脚本，`cd /d "%~dp0"` 确保从任何位置双击都能工作
- **.env** — MiMO API Key + WebDAV 凭据配置（`MIMO_API_KEY`、`WEBDAV_SERVER`、`WEBDAV_USER`、`WEBDAV_PASS`、`WEBDAV_DIR`），已被 .gitignore 排除
- **app-data.json** — 服务器端数据存储（JSON），支持多设备同步

### index.html 内部结构

```
<script> 从第 942 行开始
├── 常量定义（MEAL_LABELS, EXERCISE_TYPES 等）
├── DEFAULT_SETTINGS / DEFAULT_DATA — 数据模型默认值
├── appData — 主数据对象（从 localStorage 加载）
├── loadData() / saveData() — 本地持久化 + 服务器同步
├── render*() — 各页面渲染函数（Dashboard/Diet/Exercise/Report/Settings）
├── Chart.js 图表（体重趋势、热量柱状图、营养素堆叠图）
├── AI 功能（图片识别、文本分析、流式对话计划生成器）
├── 自定义弹窗系统（myAlert/myConfirm，替代浏览器原生弹窗）
└── SSE 实时同步（多设备数据推送）
```

### 数据模型（appData）

```javascript
{
  settings: { name, height, startWeight, targetWeight, targetDate, calorieTarget, bmr, aiProvider, aiModel },
  weights: [{ date, weight, bmi, bodyfat, leanMass, fatMass, waterVol, waterPct, boneMineral, proteinMass, muscleMass, ... }],
  diets: [{ date, mealType, food, calories, protein, carbs, fat, note }],
  exercises: [{ date, type, duration, calories, desc }],
  checklist: { [日期]: { exercise: bool } }
}
```

### API 端点（proxy-server.js，端口 3000）

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/recognize` | POST | MiMO 图片识别（体重/食物） |
| `/api/analyze` | POST | MiMO 文本分析（营养计算、报告生成） |
| `/api/chat/stream` | POST | MiMO 流式对话（SSE，AI 计划生成器） |
| `/api/events` | GET | SSE 长连接（多设备数据实时同步） |
| `/api/data` | GET/POST | 服务器端数据读写 |
| `/api/health` | GET | 健康检查 |
| `/api/info` | GET | 服务器信息（端口、局域网 IP） |

### 关键技术栈

- **前端**：纯 HTML/CSS/JS（无框架），Chart.js 图表
- **后端**：Node.js 原生 http 模块（无 Express）
- **AI**：小米 MiMO V2.5 API（`api.xiaomimimo.com`），支持视觉识别和流式对话
- **存储**：localStorage（前端）+ app-data.json（服务器端）
- **同步**：SSE 实时推送 + 轮询兜底

## 重要约定

- **单文件架构**：index.html 包含所有前端代码，修改时注意行号会偏移
- **自定义弹窗**：所有用户提示使用 `myAlert()` / `myConfirm()`，不使用浏览器原生 `alert()` / `confirm()`
- **弹窗确认**：`myConfirm()` 支持空格键确认，提升操作效率
- **数据保存**：每次修改 appData 后必须调用 `saveData()`，它会同时写入 localStorage 和同步到服务器
- **图表管理**：使用 `destroyChart()` 销毁旧图表再重建，避免 Chart.js 内存泄漏
- **中文注释**：所有新增代码的注释必须使用中文
- **禁止手写压缩代码**：严禁在 index.html 中手写压缩/混淆的 JS 代码（如 QR 生成器、加密算法等）。这类代码一旦有语法错误会导致整个 `<script>` 块崩溃，页面完全不可用。必须使用 CDN 引入经过验证的库，或在 proxy-server.js 中实现后通过 API 调用
- **JS 语法预检**：新增任何 JS 代码后，必须先用 `node -e "new Function(...)"` 验证语法，确认无误后再提交
- **日期必须用本地时间**：严禁使用 `toISOString().slice(0,10)` 获取日期，它返回 UTC 时间，中国时区（UTC+8）在早上 8 点前会返回前一天。必须使用 `getTodayStr()` 或 `formatDateLocal(d)` 获取本地日期
- **新增数据必须持久化+同步**：任何新增的用户数据（对话历史、设置、记录等）必须同时写入 `appData` → `saveData()`（localStorage + SSE 同步）。漏掉会导致刷新丢失、多端不同步
- **所有数据必须动态获取**：禁止硬编码日期、体重、数值等数据。所有数据必须从 `appData` 实时读取。settings 中的字段（昵称、性别、身高、目标等）必须通过 `appData.settings.*` 读取，不能写死在 HTML 中
- **对话消息顺序**：聊天界面中，用户消息必须先添加到 DOM，AI 回复（typing 指示器）必须追加在用户消息之后。隐藏的系统 prompt 不得渲染到对话框中

## 任务清单规则（unfinished-bug.md）

`unfinished-bug.md` 是本项目的核心任务中心，所有任务的生命周期都在此文档中追踪。

- **执行前查阅**：每次开始新任务前，必须先读取 `unfinished-bug.md`，确认任务状态和上下文
- **完成即记录**：每完成一个任务（无论大小），必须立即写入 `unfinished-bug.md` 的「已完成」部分，包含编号、问题描述和备注
- **新问题即记录**：用户提出的每一个新问题、新需求、新 bug，无论是否立即处理，都必须写入对应优先级部分
- **修改即检查**：每次代码修改、每次提交后，都要检查 `unfinished-bug.md` 是否需要更新状态
- **编号规则**：A=功能需求，B=高优先级重构/bug，C=中优先级改进，D=低优先级/体验优化。无编号的用 `—` 表示

## 日志系统规则（appData.appLogs）

`appData.appLogs` 记录所有用户操作和系统事件，支持多端同步，最多保留 200 条。

- **排障优先查日志**：当用户报告问题时，必须先查阅 `appData.appLogs`，根据日志时间和错误信息定位原因，不要凭猜测诊断
- **查阅方式**：在浏览器控制台执行 `JSON.parse(localStorage.getItem('weight-tracker-data')).appLogs.slice(-20)` 或通过 `addLog` / `getRecentLogs()` 函数
- **日志类型**：`save`（保存操作）、`delete`（删除操作）、`recognize`（图片识别）、`analyze`（文本分析）、`report`（AI报告）、`chat`（Max教练）、`error`（错误）、`sync`（数据同步）
- **全操作覆盖**：所有用户可触发的操作（保存/删除/识别/分析/设置/同步）都必须有对应的 `addLog()` 调用
