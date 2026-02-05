# 拍照学粤语 API 服务

一个基于 AI 的粤语学习后端 API 服务，允许用户上传图片生成粤语描述和语音，并支持跟读评分功能。

## 功能特性

- 📷 **图片识别**: 上传图片，AI 生成地道的粤语描述
- 🎤 **语音合成**: 将粤语文字转换为自然流畅的语音
- 🗣️ **跟读评分**: 评估用户的粤语发音，提供详细评分
- 🚀 **容器化部署**: 支持 Docker 和 Zeabur 平台一键部署

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

## 本地开发

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
   TENCENT_SECRET_ID=your_tencent_secret_id_here
   TENCENT_SECRET_KEY=your_tencent_secret_key_here
   TENCENT_APP_ID=your_tencent_app_id_here
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

- `DEEPINFRA_API_KEY`
- `STEPFUN_API_KEY`
- `TENCENT_SECRET_ID`
- `TENCENT_SECRET_KEY`
- `TENCENT_APP_ID`
- `PORT=8080`
- `NODE_ENV=production`

## API 密钥获取

### DeepInfra

1. 访问 [DeepInfra](https://deepinfra.com/)
2. 注册/登录账号
3. 进入 API Keys 页面获取 API Key
4. 模型使用 `Qwen/Qwen2.5-VL-32B-Instruct`（支持视觉和文本理解）

### 阶跃星辰 (StepFun)

1. 访问 [阶跃星辰平台](https://platform.stepfun.com/)
2. 注册/登录账号
3. 申请 API 访问权限
4. 获取 API Key（支持 step-tts-2 粤语语音合成）

### 腾讯云

1. 访问 [腾讯云](https://cloud.tencent.com/)
2. 注册/登录账号
3. 开通 "语音识别" 服务
4. 获取 Secret ID、Secret Key 和 App ID
5. 确保使用 `16k_yue` 引擎模型（粤语识别）

## 项目结构

```
Learn-Cantonese/
├── app.js              # 主应用文件
├── package.json        # 依赖配置
├── Dockerfile          # Docker 构建文件
├── .dockerignore       # Docker 忽略文件
├── .env.example        # 环境变量示例
└── README.md           # 项目文档
```

## 注意事项

### API 实现状态

✅ **真实 API 集成**: 当前代码已集成真实的第三方 API 调用:

1. **DeepInfra**: 使用 `Qwen/Qwen2.5-VL-32B-Instruct` 多模态模型进行图像理解和粤语文本生成
2. **阶跃星辰 TTS**: 使用 `step-tts-2` 模型支持粤语语音合成
3. **腾讯云 ASR**: 使用 `16k_yue` 引擎模型支持粤语语音识别（TC3-HMAC-SHA256 签名）

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
