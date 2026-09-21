# 🏃 昕露的减重计划

个人减肥追踪应用，用于记录和管理每日的体重、饮食、运动数据，并借助 AI 自动识别与分析。支持局域网多设备访问和实时数据同步。

## ✨ 功能特性

### 📊 首页仪表盘
- 实时查看当前体重、目标进度（SVG 环形进度条）
- 今日计划概览、热量目标与营养素统计
- 体重趋势图、热量柱状图、营养素堆叠图（Chart.js 可视化）

### ⚖️ 体重记录
- 手动记录体重、BMI、体脂率、水分、肌肉量等多项指标
- **AI 识图**：上传小米运动健康截图，自动识别各项身体数据

### 🍽️ 饮食记录
- 按早 / 午 / 晚 / 加餐四餐记录
- 支持手动输入，或上传食物图片由 AI 识别营养信息
- 自动计算每日热量与三大营养素（蛋白质 / 碳水 / 脂肪）摄入

### 🏋️ 运动计划
- 每日晨间训练计划与每周运动安排
- 运动打卡记录、运动计划导入 / 导出
- **AI 运动计划生成器**：对话式定制专属周计划

### 📊 报告中心
- 当日报告 / 本周报告 / 完成情况报告
- 报告内容由 AI 分析生成

### 💬 Max 健身指导
- 流式对话的 AI 健身教练，基于全量历史数据给出个性化建议

### ⚙️ 设置
- 个人信息、热量目标、起始日期等配置
- **局域网访问**：自动生成二维码，同一 WiFi 下手机扫码即可访问
- 数据导出 / 导入（JSON 备份）

## 🛠 技术栈

| 层 | 技术 |
|----|------|
| 前端 | 纯 HTML / CSS / JavaScript（无框架），Chart.js 图表 |
| 后端 | Node.js 原生 `http` 模块（无 Express） |
| AI | 小米 MiMO V2.5 API（`api.xiaomimimo.com`），支持视觉识别与流式对话 |
| 存储 | 浏览器 localStorage + 服务器端 `app-data.json` |
| 同步 | SSE 实时推送 + 轮询兜底 |

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/)（当前开发环境为 v24.x）

### 一键启动（推荐）

双击 `weight-tracker/start.bat`，脚本会自动完成：
1. 检查 Node.js 环境
2. 释放端口 3000 上的旧进程
3. 启动代理服务器
4. 自动打开浏览器访问 `http://localhost:3000`

> 启动后请勿关闭弹出的命令行窗口。

### 手动启动

```bash
cd weight-tracker
node proxy-server.js
```

启动成功后终端会显示本地地址和局域网地址。

## ⚙️ 配置说明

复制 `weight-tracker/.env.example` 为 `weight-tracker/.env`，填入你的 API Key：

```ini
MIMO_API_KEY=sk-your-api-key-here
```

`.env` 已被 `.gitignore` 排除，不会提交到仓库。

## 📁 项目结构

```
first-cc/
├── weight-tracker/
│   ├── index.html          # 主程序（HTML + CSS + JS 全内联）
│   ├── proxy-server.js     # 代理服务器（CORS + AI 调用 + 数据存储 + SSE 同步）
│   ├── start.bat           # 一键启动脚本
│   ├── .env                # API Key 配置（需自行创建，已被 gitignore）
│   ├── .env.example        # 配置文件模板
│   ├── app-data.json       # 服务器端数据存储（运行时自动生成）
│   └── README.md           # 旧版使用说明
├── CLAUDE.md               # Claude Code 项目约定
├── unfinished-bug.md       # 任务清单 / 待修复问题追踪
└── README.md               # 本文件
```

## 🔌 API 端点（端口 3000）

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/ping` | GET | 心跳（防止服务器空闲自动退出） |
| `/api/info` | GET | 服务器信息（端口、局域网 IP） |
| `/api/recognize` | POST | MiMO 图片识别（体重 / 食物） |
| `/api/recognize/stream` | POST | 流式图片识别（SSE，实时进度） |
| `/api/analyze` | POST | MiMO 文本分析（营养计算、报告生成） |
| `/api/chat/stream` | POST | MiMO 流式对话（Max 教练 / 计划生成器） |
| `/api/data` | GET / POST / DELETE | 服务器端数据读写、清除 |
| `/api/events` | GET | SSE 长连接（多设备数据实时同步） |

## 💾 数据存储与同步

- **前端**：数据保存在浏览器 `localStorage`，关闭浏览器不丢失
- **服务器**：同步到 `weight-tracker/app-data.json`
- **多设备**：通过 SSE 实时推送，同一局域网下多个设备数据自动保持一致
- **备份**：可在「设置」页导出 JSON 文件，或手动备份 `app-data.json`

> ⚠️ 清除浏览器缓存会导致本地数据丢失，建议定期使用「导出数据」功能备份。

## 📝 其他说明

- 服务器无心跳 60 秒后会自动退出（浏览器关闭即停止）
- 所有用户操作都会写入 `appData.appLogs` 日志，最多保留 200 条，便于排查问题
- 项目开发约定详见 [CLAUDE.md](./CLAUDE.md)，待办事项见 [unfinished-bug.md](./unfinished-bug.md)
