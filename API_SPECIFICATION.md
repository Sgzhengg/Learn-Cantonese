# 拍照学粤语 - 后端 API 服务说明

## 服务信息

**服务名称**: 拍照学粤语 API
**部署平台**: Zeabur
**服务地址**: `https://learn-cantonese.preview.huawei-zeabur.cn`
**端口**: 8080
**基础 URL**: `https://learn-cantonese.preview.huawei-zeabur.cn`
**协议**: HTTPS
**数据格式**: JSON / Multipart Form-Data

---

## API 概述

### 核心功能
1. **图片识别与故事生成** - 上传图片，生成普通话+粤语双语故事（含耶鲁拼音）
2. **语音合成** - 将粤语文字转换为自然语音
3. **发音评估** - 评估用户粤语发音，提供详细评分和鼓励语
4. **用户管理** - 粤语水平设置（初级/中级/高级）
5. **学习记录** - 保存、查询、删除学习历史
6. **书库系统** - 按日期分组查看学习记录
7. **成就系统** - 6种成就追踪
8. **数据统计** - 学习数据统计和等级系统
9. **分享功能** - 生成分享链接（30天有效）

### 数据库
- **生产环境**: PostgreSQL（Zeabur 部署）
- **本地开发**: 内存存储（数据重启后丢失）

---

## API 端点详情

### 1. 健康检查

**端点**: `GET /health`

**说明**: 检查服务是否正常运行

**请求示例**:
```bash
curl https://learn-cantonese.preview.huawei-zeabur.cn/health
```

**响应示例**:
```json
{
  "success": true,
  "message": "Server is running",
  "timestamp": "2025-02-08T10:30:00.000Z"
}
```

---

### 2. 生成双语故事（核心功能）⭐

**端点**: `POST /api/generate`

**说明**: 上传图片，AI 自动识别内容，生成普通话+粤语双语故事，并标注耶鲁拼音，同时生成粤语语音

**Content-Type**: `multipart/form-data`

**请求参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| image | File | 是 | 图片文件（JPG/PNG，最大10MB） |
| userId | String | 否 | 用户ID（用于获取用户粤语水平） |

**请求示例**:
```javascript
const formData = new FormData();
formData.append('image', imageFile);
formData.append('userId', 'user_device_123'); // 可选

fetch('https://learn-cantonese.preview.huawei-zeabur.cn/api/generate', {
  method: 'POST',
  body: formData
})
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "mandarin": "这里是桌子上放着一个红色的苹果。",
    "cantonese": "呢度喺桌子上放住一个红苹果。",
    "cantoneseWords": [
      { "char": "呢", "pinyin": "ni" },
      { "char": "度", "pinyin": "dou" },
      { "char": "喺", "pinyin": "hai" },
      { "char": "桌", "pinyin": "zoek" },
      { "char": "子", "pinyin": "zi" },
      { "char": "上", "pinyin": "soeng" },
      { "char": "放", "pinyin": "fong" },
      { "char": "住", "pinyin": "zyu" },
      { "char": "一", "pinyin": "jat" },
      { "char": "个", "pinyin": "go" },
      { "char": "红", "pinyin": "hung" },
      { "char": "苹", "pinyin": "ping" },
      { "char": "果", "pinyin": "gwo" }
    ],
    "text": "**（普通话版）**\n这里是桌子上放着一个红色的苹果。\n\n**（粤语版）**\n呢度喺桌子上放住一个红苹果。",
    "userLevel": "intermediate",
    "audioUrl": "data:audio/mp3;base64,//NExAAAAANIAAAAAExBTUU...",
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
- `userLevel`: 用户当前的粤语水平
- `audioUrl`: Base64 编码的 MP3 音频 URL
- `audioFormat`: 音频格式（mp3）

**难度自适应**:
- 不传 `userId`: 默认生成初级难度（2句话）
- 传 `userId`: 根据用户设置的粤语水平生成不同难度
  - **初级**: 2句话，简单日常词汇
  - **中级**: 3句话，日常对话词汇
  - **高级**: 4-5句话，地道口语表达

---

### 3. 评估发音

**端点**: `POST /api/evaluate`

**说明**: 上传用户录音，AI 识别并评估粤语发音

**Content-Type**: `multipart/form-data`

**请求参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| audio | File | 是 | 用户录音（MP3/WAV/M4A/AAC，最大10MB） |
| originalText | String | 是 | 原始粤语文本（从 /api/generate 返回的 cantonese 字段） |

**请求示例**:
```javascript
const formData = new FormData();
formData.append('audio', audioFile);
formData.append('originalText', '呢度喺桌子上放住一个红苹果');

fetch('https://learn-cantonese.preview.huawei-zeabur.cn/api/evaluate', {
  method: 'POST',
  body: formData
})
```

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

**评分等级对照**:
| 分数 | 标题 | 鼓励语 |
|------|------|--------|
| 90-100 | 好犀利！(太棒了) | 发音非常自然，继续保持。 |
| 80-89 | 唔错喔！(很好) | 发音很标准，再接再厉！ |
| 70-79 | 过得去！(还可以) | 有些地方需要练习，加油！ |
| 60-69 | 继续努力！(再努力) | 多听多说，一定会有进步！ |
| 0-59 | 重新嚟过！(再试试) | 不要气馁，多练习几次！ |

---

### 4. 保存学习记录

**端点**: `POST /api/save`

**说明**: 保存学习记录到用户历史

**Content-Type**: `application/json`

**请求参数**:
```json
{
  "userId": "user_device_id_or_session_id",
  "mandarin": "这里是桌子上放着一个红色的苹果。",
  "cantonese": "呢度喺桌子上放住一个红苹果。",
  "cantoneseWords": [
    { "char": "呢", "pinyin": "ni" },
    { "char": "度", "pinyin": "dou" }
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
    "id": "abc123...",
    "timestamp": "2025-02-08T10:30:00.000Z",
    "message": "Record saved successfully"
  }
}
```

---

### 5. 获取学习历史

**端点**: `GET /api/history`

**说明**: 获取用户的学习记录列表

**请求参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| userId | String | 是 | 用户 ID |
| limit | Number | 否 | 返回记录数量，默认20 |

**请求示例**:
```
GET https://learn-cantonese.preview.huawei-zeabur.cn/api/history?userId=user123&limit=10
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "count": 5,
    "records": [
      {
        "id": "abc123...",
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

---

### 6. 删除学习记录

**端点**: `DELETE /api/history/:id`

**说明**: 删除指定的学习记录

**请求参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | String | 是 | 记录 ID（URL参数） |
| userId | String | 是 | 用户 ID（查询参数） |

**请求示例**:
```
DELETE https://learn-cantonese.preview.huawei-zeabur.cn/api/history/abc123...?userId=user123
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "message": "Record deleted successfully"
  }
}
```

---

### 7. 获取书库（Library）

**端点**: `GET /api/library`

**说明**: 按日期分组获取用户保存的所有故事

**请求参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| userId | String | 是 | 用户 ID |

**请求示例**:
```
GET https://learn-cantonese.preview.huawei-zeabur.cn/api/library?userId=user123
```

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

---

### 8. 创建分享链接

**端点**: `POST /api/share`

**说明**: 为故事创建分享链接（30天有效）

**Content-Type**: `application/json`

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
    "shareUrl": "https://learn-cantonese.preview.huawei-zeabur.cn/share/abc12345",
    "expiresAt": "2025-03-10T10:30:00.000Z",
    "message": "Share link created successfully"
  }
}
```

---

### 9. 获取分享内容

**端点**: `GET /api/share/:id`

**说明**: 通过分享ID获取分享的故事内容

**请求参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | String | 是 | 分享 ID（URL参数） |

**请求示例**:
```
GET https://learn-cantonese.preview.huawei-zeabur.cn/api/share/abc12345
```

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

---

### 10. 获取用户资料

**端点**: `GET /api/user/profile`

**说明**: 获取用户资料，包括当前粤语水平设置

**请求参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| userId | String | 是 | 用户 ID |

**请求示例**:
```
GET https://learn-cantonese.preview.huawei-zeabur.cn/api/user/profile?userId=user123
```

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

---

### 11. 更新用户资料

**端点**: `PUT /api/user/profile`

**说明**: 更新用户资料（主要是设置粤语水平）

**Content-Type**: `application/json`

**请求参数**:
```json
{
  "userId": "user123",
  "cantoneseLevel": "advanced"
}
```

**cantoneseLevel 可选值**:
- `beginner` - 初级
- `intermediate` - 中级
- `advanced` - 高级

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

---

### 12. 获取所有粤语水平

**端点**: `GET /api/user/levels`

**说明**: 获取所有可用的粤语水平选项

**请求示例**:
```
GET https://learn-cantonese.preview.huawei-zeabur.cn/api/user/levels
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

### 13. 获取用户统计

**端点**: `GET /api/user/stats`

**说明**: 获取用户学习统计数据

**请求参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| userId | String | 是 | 用户 ID |

**请求示例**:
```
GET https://learn-cantonese.preview.huawei-zeabur.cn/api/user/stats?userId=user123
```

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

---

### 14. 更新用户统计

**端点**: `POST /api/user/stats`

**说明**: 完成学习后更新用户统计（自动解锁成就）

**Content-Type**: `application/json`

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
      "totalStudyTime": 125
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

---

### 15. 获取成就列表

**端点**: `GET /api/achievements`

**说明**: 获取用户的所有成就和解锁状态

**请求参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| userId | String | 是 | 用户 ID |

**请求示例**:
```
GET https://learn-cantonese.preview.huawei-zeabur.cn/api/achievements?userId=user123
```

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
| ID | 标题 | 图标 | 解锁条件 |
|----|------|------|----------|
| first_story | 初出茅庐 | star | totalStories >= 1 |
| ten_stories | 勤学苦练 | school | totalStories >= 10 |
| fifty_stories | 粤语达人 | emoji_events | totalStories >= 50 |
| practice_master | 跟读高手 | record_voice_over | practiceCount >= 100 |
| perfect_score | 完美发音 | verified | bestScore === 100 |
| excellent_student | 优秀学员 | workspace_premium | averageScore >= 90 |

---

## 错误响应格式

所有 API 在发生错误时都会返回统一格式的错误响应：

```json
{
  "success": false,
  "error": "错误描述信息"
}
```

**常见错误码**:
- `400` - 请求参数错误（缺少必需参数、文件类型错误等）
- `404` - 资源未找到（记录不存在、分享链接过期等）
- `500` - 服务器内部错误

---

## 用户ID说明

**用途**：标识不同用户，存储用户数据和学习记录

**建议的用户ID来源**：
- 设备唯一标识符（如 Device.deviceId in Expo）
- 用户会话ID
- 匿名用户ID（首次启动时生成并存储在本地）

**示例**：
```javascript
import { Device } from 'expo-device';

// 使用设备ID
const getUserId = () => {
  return Device.deviceId || 'anonymous-' + Date.now();
};

// 或生成并存储本地ID
const getUserId = async () => {
  let userId = await AsyncStorage.getItem('userId');
  if (!userId) {
    userId = 'user-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    await AsyncStorage.setItem('userId', userId);
  }
  return userId;
};
```

---

## 前端集成示例

### 完整的学习流程

```javascript
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Button, Image, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';

const API_BASE = 'https://learn-cantonese.preview.huawei-zeabur.cn';

export default function LearnCantoneseApp() {
  const [loading, setLoading] = useState(false);
  const [story, setStory] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const userId = 'user-device-123'; // 实际应用中应从设备获取

  // 1. 拍照生成故事
  const handlePickImage = async () => {
    try {
      setLoading(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 1,
      });

      if (!result.canceled) {
        const formData = new FormData();
        formData.append('image', {
          uri: result.assets[0].uri,
          type: 'image/jpeg',
          name: 'photo.jpg',
        } as any);
        formData.append('userId', userId);

        const response = await fetch(`${API_BASE}/api/generate`, {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();
        if (data.success) {
          setStory(data.data);
        }
      }
    } catch (error) {
      console.error('Error:', error);
      alert('生成失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  // 2. 播放音频
  const playAudio = async () => {
    if (story?.audioUrl) {
      const soundObject = new Audio.Sound();
      await soundObject.loadAsync({ uri: story.audioUrl });
      await soundObject.playAsync();
    }
  };

  // 3. 跟读评分
  const handleEvaluate = async (audioUri) => {
    try {
      setLoading(true);
      const formData = new FormData();
      formData.append('audio', {
        uri: audioUri,
        type: 'audio/mp3',
        name: 'recording.mp3',
      } as any);
      formData.append('originalText', story.cantonese);

      const response = await fetch(`${API_BASE}/api/evaluate`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        setEvaluation(data.data);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('评分失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />

      {/* 拍照按钮 */}
      <Button title="拍照学习" onPress={handlePickImage} disabled={loading} />

      {loading && <ActivityIndicator size="large" />}

      {/* 显示故事 */}
      {story && (
        <View style={styles.storyContainer}>
          <Text style={styles.mandarin}>{story.mandarin}</Text>
          <View style={styles.cantoneseContainer}>
            {story.cantoneseWords.map((word, index) => (
              <View key={index} style={styles.wordContainer}>
                <Text style={styles.pinyin}>{word.pinyin}</Text>
                <Text style={styles.cantonese}>{word.char}</Text>
              </View>
            ))}
          </View>
          <Button title="播放粤语发音" onPress={playAudio} />
          <Button title="跟读评分" onPress={() => {/* 开始录音 */}} />
        </View>
      )}

      {/* 显示评分结果 */}
      {evaluation && (
        <View style={styles.evaluationContainer}>
          <Text style={styles.score}>{evaluation.score}分</Text>
          <Text style={styles.title}>{evaluation.encouragement.title}</Text>
          <Text style={styles.message}>{evaluation.encouragement.message}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
  },
  storyContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
  },
  mandarin: {
    fontSize: 18,
    marginBottom: 15,
    color: '#333',
  },
  cantoneseContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginVertical: 10,
  },
  wordContainer: {
    alignItems: 'center',
    marginRight: 10,
    marginBottom: 5,
  },
  pinyin: {
    fontSize: 12,
    color: '#FF6B6B',
  },
  cantonese: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#181111',
  },
  evaluationContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#fff9f0',
    borderRadius: 10,
    alignItems: 'center',
  },
  score: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#ec1713',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 10,
  },
  message: {
    fontSize: 16,
    color: '#666',
    marginTop: 5,
  },
});
```

---

## 注意事项

1. **CORS**: 已启用跨域支持，可从任何域名调用
2. **文件大小限制**: 图片和音频文件最大 10MB
3. **音频格式**: 音频文件必须是 MP3、WAV、M4A 或 AAC 格式
4. **图片格式**: 图片文件必须是 JPG 或 PNG 格式
5. **userId**: 建议使用设备唯一标识，确保用户数据持久化
6. **音频URL**: 返回的音频是 base64 编码的 data URL，可直接在 HTML audio 标签或 React Native 中使用

---

## 测试工具

### 使用 curl 测试

```bash
# 健康检查
curl https://learn-cantonese.preview.huawei-zeabur.cn/health

# 生成故事
curl -X POST https://learn-cantonese.preview.huawei-zeabur.cn/api/generate \
  -F "image=@test.jpg" \
  -F "userId=test123"

# 获取用户统计
curl "https://learn-cantonese.preview.huawei-zeabur.cn/api/user/stats?userId=test123"
```

### 使用 Postman 测试

导入以下环境变量：
- `API_BASE`: `https://learn-cantonese.preview.huawei-zeabur.cn`

然后测试各个端点。

---

## 更新日志

**v1.0.0** (2025-02-08)
- ✅ PostgreSQL 数据库集成
- ✅ 粤语水平系统（初级/中级/高级）
- ✅ 自适应难度生成
- ✅ 耶鲁拼音自动标注
- ✅ 语音合成与发音评估
- ✅ 学习记录与成就系统
- ✅ 分享功能

---

## 技术支持

如有问题，请通过以下方式联系：
- GitHub Issues: https://github.com/Sgzhengg/Learn-Cantonese/issues
- 查看完整文档: https://github.com/Sgzhengg/Learn-Cantonese
