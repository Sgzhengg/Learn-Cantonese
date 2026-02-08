# 拍照学粤语 - AI 驱动的粤语学习应用

一个完整的粤语学习应用，包含后端 API 和移动端应用。通过拍照上传图片，AI 自动生成双语故事，用户可以跟读练习并获得实时评分。

## 📱 项目组成

- **后端 API** ([app.js](./app.js))：Node.js + Express 服务
- **移动应用** ([frontend/](./frontend/))：React Native + Expo 应用

## ✨ 功能特性

### 后端 API
- 📷 **图片识别**: 上传图片，AI 生成地道的粤语双语故事（使用 DeepInfra Qwen2.5-VL）
- 🎤 **语音合成**: 将粤语文字转换为自然流畅的语音（使用 StepFun step-tts-2）
- 🎯 **智能音色**: 根据故事内容自动选择合适的音色（19种音色）
- 🗣️ **跟读评分**: 评估用户的粤语发音，提供详细评分（使用 DeepInfra Whisper）
- 🚀 **容器化部署**: 支持 Docker 和 Zeabur 平台一键部署

### 移动应用
- 📷 **拍照上传**: 支持相机拍照和相册选择
- 📖 **双语故事**: 普通话版 + 粤语版对照显示
- 🎵 **音频播放**: 听地道的粤语发音，支持进度控制
- 🎙️ **跟读录音**: 录制你的发音，系统实时评分
- 📊 **详细反馈**: 多维度分析（相似度、流利度、置信度）
- 📚 **历史记录**: 随时回顾学习历程

## 🎨 界面设计

### 设计原则
- ✅ **清爽**: 留白充足，不堆砌内容
- ✅ **舒服**: 柔和配色，圆角设计，护眼易读
- ✅ **易用**: 线性流程，大按钮，操作直观

### 配色方案
- 主色：#4ECDC4（柔和的蓝绿色）
- 辅助色：#FF6B6B（温暖的橙色）
- 背景色：#F7F9FC（米白色）

## 技术栈

- **框架**: Node.js + Express
- **文件处理**: Multer
- **HTTP 客户端**: Axios
- **评分算法**: Levenshtein 距离
- **容器**: Docker

## API 端点

### 1. 健康检查

```
GET /health
```

**响应示例**:
```json
{
  "success": true,
  "message": "Server is running",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

### 2. 生成粤语内容

```
POST /api/generate
Content-Type: multipart/form-data
```

**请求参数**:
- `image`: 图片文件 (JPG/PNG, 最大 10MB)

**响应示例**:
```json
{
  "success": true,
  "data": {
    "text": "呢度有个好靓嘅红苹果，睇上去好新鲜。",
    "audioUrl": "data:audio/mp3;base64,...",
    "audioFormat": "mp3"
  }
}
```

### 3. 评估发音

```
POST /api/evaluate
Content-Type: multipart/form-data
```

**请求参数**:
- `audio`: 音频文件 (MP3/WAV/M4A/AAC, 最大 10MB)
- `originalText`: 原始粤语文本 (form field)

**响应示例**:
```json
{
  "success": true,
  "data": {
    "originalText": "呢度有个好靓嘅红苹果",
    "userText": "呢度有个好靓嘅红苹果",
    "score": 95,
    "accuracy": "Excellent",
    "fluency": 95,
    "similarity": 98,
    "confidence": 92
  }
}
```

## 🚀 快速开始

### 5分钟体验"拍照学粤语"移动应用

1. **启动后端服务**
   ```bash
   cd e:\Learn-Cantonese
   npm install
   node app.js
   ```

2. **启动移动应用**
   ```bash
   cd e:\Learn-Cantonese\frontend
   npm install
   npm start
   ```

3. **在手机上预览**
   - 下载 Expo Go app（应用商店）
   - 扫描终端显示的 QR 码
   - 开始使用！

详细步骤见 [移动应用快速启动指南](./frontend/QUICKSTART.md)

---

## 📖 详细文档

### 后端 API
- API 端点说明（见下方）
- [Dockerfile](./Dockerfile) 容器化部署
- [.env.example](./.env.example) 环境变量配置

### 移动应用
- [frontend/README.md](./frontend/README.md) - 项目概览
- [frontend/QUICKSTART.md](./frontend/QUICKSTART.md) - 快速启动
- [frontend/PROJECT_SUMMARY.md](./frontend/PROJECT_SUMMARY.md) - 开发总结

## 🔧 本地开发（后端）

### 前置要求

- Node.js >= 18.0.0
- npm 或 yarn

### 安装步骤

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd Learn-Cantonese
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **配置环境变量**

   复制 `.env.example` 文件并重命名为 `.env`:
   ```bash
   cp .env.example .env
   ```

   编辑 `.env` 文件，填入你的 API 密钥:
   ```env
   DEEPINFRA_API_KEY=your_deepinfra_api_key_here
   STEPFUN_API_KEY=your_stepfun_api_key_here
   ```

4. **启动服务**

   开发模式（支持热重载）:
   ```bash
   npm run dev
   ```

   生产模式:
   ```bash
   npm start
   ```

5. **测试服务**

   健康检查:
   ```bash
   curl http://localhost:3000/health
   ```

   测试生成端点:
   ```bash
   curl -X POST http://localhost:3000/api/generate \
     -F "image=@test.jpg"
   ```

   > **注意**: 本地开发默认使用 3000 端口。Zeabur 部署会自动使用 8080 端口。

## 部署到 Zeabur

### 方法一: 通过 GitHub 连接（推荐）

1. 将代码推送到 GitHub 仓库
2. 在 [Zeabur](https://zeabur.com) 创建新项目
3. 选择 "Deploy from GitHub"
4. 选择你的仓库
5. Zeabur 会自动检测 Dockerfile 并构建

### 方法二: 通过 CLI 部署

```bash
# 安装 Zeabur CLI
npm install -g zeabur

# 登录
zeabur login

# 部署
zeabur deploy
```

### 配置环境变量

在 Zeabur 控制台中添加以下环境变量:

- `DEEPINFRA_API_KEY`（用于图片识别和语音识别）
- `STEPFUN_API_KEY`（用于语音合成）
- `PORT=8080`
- `NODE_ENV=production`

## API 密钥获取

### DeepInfra

1. 访问 [DeepInfra](https://deepinfra.com/)
2. 注册/登录账号
3. 进入 API Keys 页面获取 API Key
4. 一个 API Key 可同时用于：
   - 图片识别：`Qwen/Qwen2.5-VL-32B-Instruct` 模型
   - 语音识别：`openai/whisper-large-v3` 模型

### 阶跃星辰 (StepFun)

1. 访问 [阶跃星辰平台](https://platform.stepfun.com/)
2. 注册/登录账号
3. 申请 API 访问权限
4. 获取 API Key（支持 step-tts-2 粤语语音合成）

## 📂 项目结构

```
Learn-Cantonese/
├── app.js                    # 后端主应用文件
├── package.json              # 后端依赖配置
├── Dockerfile                # Docker 构建文件
├── .env.example              # 环境变量示例
│
├── frontend/                 # 移动应用（React Native + Expo）
│   ├── app/                  # Expo Router 页面路由
│   │   ├── index.tsx         # 首页（拍照上传）
│   │   ├── learning/         # 学习页面
│   │   ├── recording/        # 录音页面
│   │   └── score/            # 评分页面
│   ├── src/
│   │   ├── components/       # 通用组件
│   │   │   ├── Button.tsx
│   │   │   └── Card.tsx
│   │   ├── screens/          # 页面组件
│   │   │   ├── HomeScreen.tsx
│   │   │   ├── LearningScreen.tsx
│   │   │   ├── RecordingScreen.tsx
│   │   │   └── ScoreScreen.tsx
│   │   ├── services/         # 服务层
│   │   │   ├── api.ts        # API 服务
│   │   │   └── store.ts      # Zustand 状态管理
│   │   ├── constants/        # 配置常量
│   │   │   ├── colors.ts     # 颜色配置
│   │   │   └── dimensions.ts # 尺寸配置
│   │   └── types/            # TypeScript 类型定义
│   ├── README.md             # 移动应用文档
│   ├── QUICKSTART.md         # 快速启动指南
│   ├── PROJECT_SUMMARY.md    # 项目总结
│   └── package.json          # 前端依赖配置
│
└── README.md                 # 项目总览（本文件）
```

## 注意事项

### API 实现状态

✅ **真实 API 集成**: 当前代码已集成真实的第三方 API 调用:

1. **DeepInfra Vision**: 使用 `Qwen/Qwen2.5-VL-32B-Instruct` 多模态模型进行图像理解和粤语文本生成
2. **阶跃星辰 TTS**: 使用 `step-tts-2` 模型支持粤语语音合成
3. **DeepInfra Whisper**: 使用 OpenAI `whisper-large-v3` 模型支持中文语音识别（包括粤语）

### 安全建议

- ⚠️ 不要将 `.env` 文件提交到版本控制
- ⚠️ 使用 HTTPS 在生产环境中传输数据
- ⚠️ 实施请求速率限制以防止滥用
- ⚠️ 验证所有上传文件的类型和大小
- ⚠️ 定期更新依赖包以修复安全漏洞

### 性能优化

- 使用 Redis 缓存常见的图片识别结果
- 实施 CDN 分发语音文件
- 使用进程管理器（如 PM2）提高服务稳定性
- 配置负载均衡以应对高并发

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 联系方式

如有问题，请通过 GitHub Issues 联系。
