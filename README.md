# 拍照学粤语 - AI 驱动的粤语学习应用

一个完整的粤语学习应用，包含后端 API 和移动端应用。通过拍照上传图片，AI 自动生成双语故事，用户可以跟读练习并获得实时评分。

## 📱 项目组成

- **后端 API** ([app.js](./app.js))：Node.js + Express 服务
- **移动应用** ([frontend/](./frontend/))：React Native + Expo 应用

## ✨ 功能特性

### 后端 API
- 📷 **图片识别**: 上传图片，AI 生成地道的粤语双语故事（使用 DeepInfra Qwen2.5-VL）
- 📝 **拼音标注**: 为每个粤语字自动标注耶鲁拼音（Jyutping）
- 🎤 **语音合成**: 将粤语文字转换为自然流畅的语音（使用腾讯云 TTS）
- 🎯 **智能音色**: 根据故事内容自动选择合适的音色（男声/女声）
- 🗣️ **跟读评分**: 评估用户的粤语发音，提供详细评分和鼓励语（使用 DeepInfra Whisper）
- 🎚️ **难度自适应**: 根据用户粤语水平（初级/中级/高级）生成不同难度的故事
- 💾 **数据持久化**: 使用 PostgreSQL 存储用户数据和学习记录（Zeabur 部署）
- 📚 **书库系统**: 按日期分组查看学习记录
- 🔗 **分享功能**: 生成分享链接，30天有效期
- 🏆 **成就系统**: 6种成就追踪，自动解锁
- 📊 **用户统计**: 学习数据统计，等级系统
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
- **数据库**: PostgreSQL (Zeabur 部署) / 内存存储（本地开发）
- **文件处理**: Multer
- **HTTP 客户端**: Axios
- **AI 服务**:
  - DeepInfra: 图像识别 (Qwen2.5-VL)、语音识别 (Whisper)
  - 腾讯云 TTS: 粤语语音合成
  - OpenAI SDK: API 接口封装
- **评分算法**: Levenshtein 距离
- **容器**: Docker
- **TTS SDK**: tencentcloud-sdk-nodejs
- **PostgreSQL 客户端**: pg (node-postgres)

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
    "mandarin": "这里是桌子上放着一个红色的苹果。",
    "cantonese": "呢度喺桌子上放住一个红苹果。",
    "cantoneseWords": [
      {"char": "呢", "pinyin": "ni"},
      {"char": "度", "pinyin": "dou"},
      {"char": "喺", "pinyin": "hai"},
      {"char": "桌", "pinyin": "zoek"},
      {"char": "子", "pinyin": "zi"},
      {"char": "上", "pinyin": "soeng"},
      {"char": "放", "pinyin": "fong"},
      {"char": "住", "pinyin": "zyu"},
      {"char": "一", "pinyin": "jat"},
      {"char": "个", "pinyin": "go"},
      {"char": "红", "pinyin": "hung"},
      {"char": "苹", "pinyin": "ping"},
      {"char": "果", "pinyin": "gwo"}
    ],
    "text": "**（普通话版）**\n这里是桌子上放着一个红色的苹果。\n\n**（粤语版）**\n呢度喺桌子上放住一个红苹果。",
    "audioUrl": "data:audio/mp3;base64,...",
    "audioFormat": "mp3",
    "type": "story"
  }
}
```

**字段说明**:
- `mandarin`: 普通话版故事文本
- `cantonese`: 粤语版故事文本
- `cantoneseWords`: 粤语字数组，每个元素包含 `char`（粤语字）和 `pinyin`（耶鲁拼音）
- `text`: 旧格式文本，包含普通话和粤语版（向后兼容）
- `audioUrl`: Base64 编码的 MP3 音频 URL
- `audioFormat`: 音频格式（mp3）
- `type`: 内容类型（story）

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
    "originalText": "呢度喺街边饮奶茶",
    "userText": "呢度喺街边饮奶茶",
    "score": 92,
    "accuracy": "Excellent",
    "fluency": 95,
    "toneAccuracy": 89,
    "similarity": 98,
    "confidence": 92,
    "encouragement": {
      "title": "好犀利！(太棒了)",
      "message": "发音非常自然，继续保持。"
    }
  }
}
```

**字段说明**:
- `score`: 综合评分 (0-100)
- `accuracy`: 准确度等级
- `fluency`: 流利度百分比 (0-100)
- `toneAccuracy`: 声调准确度百分比 (0-100)
- `similarity`: 文本相似度百分比 (0-100)
- `confidence`: 识别置信度百分比 (0-100)
- `encouragement`: 鼓励语
  - `title`: 粤语鼓励标题（含普通话翻译）
  - `message`: 详细鼓励内容

### 4. 保存学习记录

```
POST /api/save
Content-Type: application/json
```

**请求参数**:
```json
{
  "userId": "user_device_id_or_session_id",
  "mandarin": "这里是桌子上放着一个红色的苹果。",
  "cantonese": "呢度喺桌子上放住一个红苹果。",
  "cantoneseWords": [
    {"char": "呢", "pinyin": "ni"},
    {"char": "度", "pinyin": "dou"},
    ...
  ],
  "audioUrl": "data:audio/mp3;base64,...",
  "imageUrl": "https://..."
}
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4...",
    "timestamp": "2025-02-08T10:30:00.000Z",
    "message": "Record saved successfully"
  }
}
```

### 5. 获取学习历史

```
GET /api/history?userId=user123&limit=20
```

**请求参数**:
- `userId` (必需): 用户 ID
- `limit` (可选): 返回记录数量，默认 20

**响应示例**:
```json
{
  "success": true,
  "data": {
    "count": 5,
    "records": [
      {
        "id": "a1b2c3d4...",
        "timestamp": "2025-02-08T10:30:00.000Z",
        "mandarin": "这里是桌子上放着一个红色的苹果。",
        "cantonese": "呢度喺桌子上放住一个红苹果。",
        "cantoneseWords": [...],
        "audioUrl": "data:audio/mp3;base64,...",
        "imageUrl": "https://..."
      }
    ]
  }
}
```

### 6. 删除学习记录

```
DELETE /api/history/:id?userId=user123
```

**请求参数**:
- `id` (URL 参数): 记录 ID
- `userId` (查询参数): 用户 ID

**响应示例**:
```json
{
  "success": true,
  "data": {
    "message": "Record deleted successfully"
  }
}
```

### 7. 创建分享链接

```
POST /api/share
Content-Type: application/json
```

**请求参数**:
```json
{
  "mandarin": "这里是桌子上放着一个红色的苹果。",
  "cantonese": "呢度喺桌子上放住一个红苹果。",
  "cantoneseWords": [...],
  "imageUrl": "https://..."
}
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "shareId": "abc12345",
    "shareUrl": "http://localhost:3000/share/abc12345",
    "expiresAt": "2025-03-10T10:30:00.000Z",
    "message": "Share link created successfully"
  }
}
```

### 8. 获取分享内容

```
GET /api/share/:id
```

**请求参数**:
- `id` (URL 参数): 分享 ID

**响应示例**:
```json
{
  "success": true,
  "data": {
    "mandarin": "这里是桌子上放着一个红色的苹果。",
    "cantonese": "呢度喺桌子上放住一个红苹果。",
    "cantoneseWords": [...],
    "imageUrl": "https://...",
    "createdAt": "2025-02-08T10:30:00.000Z",
    "expiresAt": "2025-03-10T10:30:00.000Z"
  }
}
```

### 9. 获取书库（Library）

```
GET /api/library?userId=user123
```

**请求参数**:
- `userId` (必需): 用户 ID

**响应示例**:
```json
{
  "success": true,
  "data": {
    "total": 15,
    "grouped": [
      {
        "date": "2025/2/8",
        "stories": [
          {
            "id": "abc123",
            "timestamp": "2025-02-08T10:30:00.000Z",
            "mandarin": "这里是桌子上放着一个红色的苹果。",
            "cantonese": "呢度喺桌子上放住一个红苹果。",
            "cantoneseWords": [...],
            "imageUrl": "https://...",
            "hasAudio": true
          }
        ]
      }
    ],
    "recent": [...]
  }
}
```

### 10. 获取成就列表

```
GET /api/achievements?userId=user123
```

**请求参数**:
- `userId` (必需): 用户 ID

**响应示例**:
```json
{
  "success": true,
  "data": {
    "total": 6,
    "unlocked": 2,
    "progress": 33,
    "achievements": [
      {
        "id": "first_story",
        "title": "初出茅庐",
        "description": "完成第一个粤语故事",
        "icon": "star",
        "unlocked": true,
        "unlockedAt": "2025-02-08T10:30:00.000Z"
      },
      {
        "id": "ten_stories",
        "title": "勤学苦练",
        "description": "学习了10个粤语故事",
        "icon": "school",
        "unlocked": false,
        "unlockedAt": null
      }
    ],
    "nextAchievements": [...]
  }
}
```

**成就列表**:
| ID | 标题 | 描述 | 解锁条件 |
|----|------|------|----------|
| first_story | 初出茅庐 | 完成第一个粤语故事 | totalStories >= 1 |
| ten_stories | 勤学苦练 | 学习了10个粤语故事 | totalStories >= 10 |
| fifty_stories | 粤语达人 | 学习了50个粤语故事 | totalStories >= 50 |
| practice_master | 跟读高手 | 跟读练习达到100次 | practiceCount >= 100 |
| perfect_score | 完美发音 | 获得一次满分评价 | bestScore === 100 |
| excellent_student | 优秀学员 | 平均分达到90分 | averageScore >= 90 |

### 11. 获取用户统计

```
GET /api/user/stats?userId=user123
```

**请求参数**:
- `userId` (必需): 用户 ID

**响应示例**:
```json
{
  "success": true,
  "data": {
    "totalStories": 15,
    "practiceCount": 42,
    "bestScore": 95,
    "averageScore": 82,
    "totalStudyTime": 120,
    "achievementsUnlocked": 2,
    "thisWeekCount": 5,
    "todayCount": 2,
    "level": 2,
    "currentLevelProgress": 5,
    "nextLevelStories": 20
  }
}
```

### 12. 更新用户统计

```
POST /api/user/stats
Content-Type: application/json
```

**请求参数**:
```json
{
  "userId": "user123",
  "score": 92,
  "practiceTime": 5,
  "isPractice": true
}
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "stats": {
      "totalStories": 15,
      "practiceCount": 43,
      "bestScore": 95,
      "totalScore": 3526,
      "totalStudyTime": 125,
      "lastUpdated": "2025-02-08T10:30:00.000Z"
    },
    "newAchievements": [
      {
        "id": "practice_master",
        "title": "跟读高手",
        "description": "跟读练习达到100次",
        "icon": "record_voice_over",
        "unlockedAt": "2025-02-08T10:30:00.000Z"
      }
    ],
    "message": "🎉 恭喜解锁 1 个新成就！"
  }
}
```

### 13. 获取用户资料

```
GET /api/user/profile?userId=user123
```

**请求参数**:
- `userId` (必需): 用户 ID

**响应示例**:
```json
{
  "success": true,
  "data": {
    "userId": "user123",
    "cantoneseLevel": "intermediate",
    "preferences": {},
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-02-08T15:20:00.000Z"
  }
}
```

### 14. 更新用户资料

```
PUT /api/user/profile
Content-Type: application/json
```

**请求参数**:
```json
{
  "userId": "user123",
  "cantoneseLevel": "advanced"
}
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "userId": "user123",
    "cantoneseLevel": "advanced",
    "preferences": {},
    "message": "粤语水平已更新为：高级"
  }
}
```

**粤语水平选项**:
| 水平 | ID | 故事长度 | 词汇难度 |
|------|----|---------|---------|
| 初级 | beginner | 2句话 | 简单日常词汇 |
| 中级 | intermediate | 3句话 | 日常对话词汇 |
| 高级 | advanced | 4-5句话 | 地道口语表达 |

### 15. 获取所有粤语水平

```
GET /api/user/levels
```

**响应示例**:
```json
{
  "success": true,
  "data": [
    {
      "id": "beginner",
      "name": "初级",
      "nameEn": "Beginner",
      "description": "粤语学习初学者",
      "storyLength": "2句话",
      "vocabulary": "简单日常词汇",
      "difficulty": "easy"
    },
    {
      "id": "intermediate",
      "name": "中级",
      "nameEn": "Intermediate",
      "description": "有一定粤语基础",
      "storyLength": "3句话",
      "vocabulary": "日常对话词汇",
      "difficulty": "medium"
    },
    {
      "id": "advanced",
      "name": "高级",
      "nameEn": "Advanced",
      "description": "粤语流利者",
      "storyLength": "4-5句话",
      "vocabulary": "丰富表达和地道口语",
      "difficulty": "hard"
    }
  ]
}
```

---

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
   TENCENT_SECRET_ID=your_tencent_secret_id_here
   TENCENT_SECRET_KEY=your_tencent_secret_key_here
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

**必需环境变量**:
- `DEEPINFRA_API_KEY`（用于图片识别、语音识别和粤语翻译）
- `TENCENT_SECRET_ID`（腾讯云 Secret ID，用于语音合成）
- `TENCENT_SECRET_KEY`（腾讯云 Secret Key，用于语音合成）
- `DATABASE_URL`（PostgreSQL 数据库连接 URL）
- `PORT=8080`
- `NODE_ENV=production`

**添加 PostgreSQL 数据库**:
1. 在 Zeabur 项目中点击"Add Service"
2. 选择"PostgreSQL"
3. 创建数据库后，在环境变量中会自动添加 `DATABASE_URL`
4. 无需手动配置，系统会自动连接数据库

## API 密钥获取

### DeepInfra

1. 访问 [DeepInfra](https://deepinfra.com/)
2. 注册/登录账号
3. 进入 API Keys 页面获取 API Key
4. 一个 API Key 可同时用于：
   - 图片识别：`Qwen/Qwen2.5-VL-32B-Instruct` 模型
   - 语音识别：`openai/whisper-large-v3` 模型

### 腾讯云 (Tencent Cloud)

1. 访问 [腾讯云 TTS 产品页](https://cloud.tencent.com/product/tts)
2. 注册/登录腾讯云账号
3. 在 [API 密钥管理](https://console.cloud.tencent.com/cam/capi)获取 `SecretId` 和 `SecretKey`
4. 支持粤语语音合成（音色：101019 智彤-女声，101020 智伟-男声）

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

1. **DeepInfra Vision**: 使用 `Qwen/Qwen2.5-VL-32B-Instruct` 多模态模型进行图像理解和普通话文本生成
2. **DeepInfra Translation**: 使用 `Qwen/Qwen2.5-VL-32B-Instruct` 进行普通话到粤语的翻译，并自动添加耶鲁拼音
3. **腾讯云 TTS**: 使用腾讯云语音合成服务支持粤语语音合成（支持男声/女声智能选择）
4. **DeepInfra Whisper**: 使用 OpenAI `whisper-large-v3` 模型支持中文语音识别（包括粤语）

### 安全建议

- ⚠️ 不要将 `.env` 文件提交到版本控制
- ⚠️ 使用 HTTPS 在生产环境中传输数据
- ⚠️ 实施请求速率限制以防止滥用
- ⚠️ 验证所有上传文件的类型和大小
- ⚠️ 定期更新依赖包以修复安全漏洞

### 存储系统说明

✅ **PostgreSQL 数据库集成**: 项目已集成 PostgreSQL 数据库支持。

**部署环境（Zeabur）**:
- 自动使用 Zeabur PostgreSQL addon 进行数据持久化
- 数据包括：用户资料、学习记录、分享链接、用户统计、成就数据
- 数据库表会自动初始化，无需手动创建

**本地开发**:
- 如果未配置 `DATABASE_URL`，自动降级到内存存储
- 内存存储的数据在服务重启后会丢失
- 建议本地开发时也配置 PostgreSQL 以获得完整功能

**数据库表结构**:
- `user_profiles` - 用户资料（粤语水平设置）
- `learning_records` - 学习记录
- `share_records` - 分享记录
- `user_statistics` - 用户统计数据
- `user_achievements` - 成就数据

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
