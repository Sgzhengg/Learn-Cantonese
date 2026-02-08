require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const Levenshtein = require('levenshtein');
const OpenAI = require('openai');
const crypto = require('crypto');
const tencentcloud = require("tencentcloud-sdk-nodejs");
const { Pool } = require('pg'); // PostgreSQL client

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// ============== POSTGRESQL DATABASE CONNECTION ==============
let pool = null;

// Initialize PostgreSQL connection if DATABASE_URL is provided
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  // Test connection
  pool.connect()
    .then(() => console.log('✅ PostgreSQL connected successfully'))
    .catch(err => console.error('❌ PostgreSQL connection error:', err));
} else {
  console.log('⚠️  No DATABASE_URL provided, using in-memory storage');
}

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'image') {
      if (!file.mimetype.match(/\/(jpg|jpeg|png)$/)) {
        return cb(new Error('Only JPG and PNG images are allowed'));
      }
    } else if (file.fieldname === 'audio') {
      if (!file.mimetype.match(/\/(mp3|wav|m4a|aac)$/)) {
        return cb(new Error('Only MP3, WAV, M4A, and AAC audio files are allowed'));
      }
    }
    cb(null, true);
  },
});

// ============== TENCENT CLOUD TTS CLIENT ==============
// Initialize Tencent Cloud TTS client for Cantonese speech synthesis
const TtsClient = tencentcloud.tts.v20190823.Client;
const clientConfig = {
  credential: {
    secretId: process.env.TENCENT_SECRET_ID,
    secretKey: process.env.TENCENT_SECRET_KEY,
  },
  region: process.env.TENCENT_TTS_REGION || "ap-guangzhou",
  profile: {
    httpProfile: {
      endpoint: "tts.tencentcloudapi.com",
    },
  },
};
const ttsClient = new TtsClient(clientConfig);

// ============== USER CANTONESE LEVEL ENUM ==============
const CANTONESE_LEVELS = {
  BEGINNER: {
    id: 'beginner',
    name: '初级',
    nameEn: 'Beginner',
    description: '粤语学习初学者',
    storyLength: '2句话',
    vocabulary: '简单日常词汇',
    difficulty: 'easy'
  },
  INTERMEDIATE: {
    id: 'intermediate',
    name: '中级',
    nameEn: 'Intermediate',
    description: '有一定粤语基础',
    storyLength: '3-4句话',
    vocabulary: '日常对话词汇',
    difficulty: 'medium'
  },
  ADVANCED: {
    id: 'advanced',
    name: '高级',
    nameEn: 'Advanced',
    description: '粤语流利者',
    storyLength: '4-5句话',
    vocabulary: '丰富表达和地道口语',
    difficulty: 'hard'
  }
};

// ============== DATABASE SCHEMA & STORAGE ==============
// Fallback to in-memory storage if database is not available
const userRecords = new Map();
const shareRecords = new Map();
const userStats = new Map();
const userAchievements = new Map();
const userProfiles = new Map(); // userId -> { cantoneseLevel, preferences }

/**
 * Initialize database tables
 */
async function initializeDatabase() {
  if (!pool) {
    console.log('⚠️  Skipping database initialization (no connection)');
    return;
  }

  const createTables = `
    -- User profiles table
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id VARCHAR(255) PRIMARY KEY,
      cantonese_level VARCHAR(50) DEFAULT 'beginner',
      preferences JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Learning records table
    CREATE TABLE IF NOT EXISTS learning_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR(255) NOT NULL,
      mandarin TEXT NOT NULL,
      cantonese TEXT NOT NULL,
      cantonese_words JSONB,
      audio_url TEXT,
      image_url TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_timestamp (user_id, timestamp DESC)
    );

    -- Share records table
    CREATE TABLE IF NOT EXISTS share_records (
      share_id VARCHAR(20) PRIMARY KEY,
      mandarin TEXT NOT NULL,
      cantonese TEXT NOT NULL,
      cantonese_words JSONB,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL
    );

    -- User statistics table
    CREATE TABLE IF NOT EXISTS user_statistics (
      user_id VARCHAR(255) PRIMARY KEY,
      total_stories INTEGER DEFAULT 0,
      practice_count INTEGER DEFAULT 0,
      best_score INTEGER DEFAULT 0,
      total_score INTEGER DEFAULT 0,
      total_study_time INTEGER DEFAULT 0,
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- User achievements table
    CREATE TABLE IF NOT EXISTS user_achievements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR(255) NOT NULL,
      achievement_id VARCHAR(50) NOT NULL,
      unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, achievement_id),
      INDEX idx_user_achievements (user_id)
    );
  `;

  try {
    await pool.query(createTables);
    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// Initialize tables on startup
initializeDatabase();

// Achievement definitions
const ACHIEVEMENTS = {
  first_story: {
    id: 'first_story',
    title: '初出茅庐',
    description: '完成第一个粤语故事',
    icon: 'star',
    condition: (stats) => stats.totalStories >= 1
  },
  ten_stories: {
    title: '勤学苦练',
    description: '学习了10个粤语故事',
    icon: 'school',
    condition: (stats) => stats.totalStories >= 10
  },
  fifty_stories: {
    id: 'fifty_stories',
    title: '粤语达人',
    description: '学习了50个粤语故事',
    icon: 'emoji_events',
    condition: (stats) => stats.totalStories >= 50
  },
  practice_master: {
    id: 'practice_master',
    title: '跟读高手',
    description: '跟读练习达到100次',
    icon: 'record_voice_over',
    condition: (stats) => stats.practiceCount >= 100
  },
  perfect_score: {
    id: 'perfect_score',
    title: '完美发音',
    description: '获得一次满分评价',
    icon: 'verified',
    condition: (stats) => stats.bestScore === 100
  },
  excellent_student: {
    id: 'excellent_student',
    title: '优秀学员',
    description: '平均分达到90分',
    icon: 'workspace_premium',
    condition: (stats) => stats.averageScore && stats.averageScore >= 90
  }
};

/**
 * Generate a unique ID
 * @returns {string} - Unique ID
 */
function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Save a learning record
 * @param {string} userId - User identifier (can be device ID, session ID, etc.)
 * @param {object} data - Record data
 * @returns {object} - Saved record with ID
 */
function saveRecord(userId, data) {
  const recordId = generateId();
  const record = {
    id: recordId,
    userId: userId,
    timestamp: new Date().toISOString(),
    ...data
  };

  // Initialize user's records array if not exists
  if (!userRecords.has(userId)) {
    userRecords.set(userId, []);
  }

  // Add record to user's history
  userRecords.get(userId).unshift(record); // Add to beginning (newest first)

  // Keep only last 100 records per user
  const records = userRecords.get(userId);
  if (records.length > 100) {
    records.pop(); // Remove oldest
  }

  console.log(`Record saved: ${recordId} for user: ${userId}`);
  return record;
}

/**
 * Get user's history records
 * @param {string} userId - User identifier
 * @param {number} limit - Maximum number of records to return
 * @returns {Array} - Array of records
 */
function getUserHistory(userId, limit = 20) {
  const records = userRecords.get(userId) || [];
  return records.slice(0, limit);
}

/**
 * Delete a specific record
 * @param {string} userId - User identifier
 * @param {string} recordId - Record ID
 * @returns {boolean} - Success status
 */
function deleteRecord(userId, recordId) {
  const records = userRecords.get(userId);
  if (!records) return false;

  const index = records.findIndex(r => r.id === recordId);
  if (index === -1) return false;

  records.splice(index, 1);
  console.log(`Record deleted: ${recordId} for user: ${userId}`);
  return true;
}

/**
 * Create a shareable record
 * @param {object} data - Data to share
 * @returns {object} - Share record with share ID
 */
function createShareRecord(data) {
  const shareId = generateId().substring(0, 8); // Shorter ID for sharing
  const shareRecord = {
    shareId: shareId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
    ...data
  };

  shareRecords.set(shareId, shareRecord);
  console.log(`Share record created: ${shareId}`);
  return shareRecord;
}

/**
 * Get share record by ID
 * @param {string} shareId - Share ID
 * @returns {object|null} - Share record or null if not found/expired
 */
function getShareRecord(shareId) {
  const record = shareRecords.get(shareId);
  if (!record) return null;

  // Check if expired
  if (new Date(record.expiresAt) < new Date()) {
    shareRecords.delete(shareId);
    return null;
  }

  return record;
}

/**
 * Get or initialize user statistics
 * @param {string} userId - User identifier
 * @returns {object} - User statistics
 */
function getUserStats(userId) {
  if (!userStats.has(userId)) {
    userStats.set(userId, {
      totalStories: 0,
      practiceCount: 0,
      bestScore: 0,
      totalScore: 0,
      totalStudyTime: 0, // in minutes
      lastUpdated: new Date().toISOString()
    });
  }
  return userStats.get(userId);
}

/**
 * Update user statistics after completing a story
 * @param {string} userId - User identifier
 * @param {object} data - Update data { score?, practiceTime?, isPractice? }
 */
function updateUserStats(userId, data = {}) {
  const stats = getUserStats(userId);

  if (data.isPractice) {
    stats.practiceCount += 1;
    if (data.score !== undefined) {
      stats.totalScore += data.score;
      stats.bestScore = Math.max(stats.bestScore, data.score);
    }
  } else {
    stats.totalStories += 1;
  }

  if (data.practiceTime) {
    stats.totalStudyTime += data.practiceTime;
  }

  stats.lastUpdated = new Date().toISOString();

  // Check for new achievements
  checkAndUnlockAchievements(userId, stats);

  return stats;
}

/**
 * Check and unlock achievements based on user stats
 * @param {string} userId - User identifier
 * @param {object} stats - User statistics
 */
function checkAndUnlockAchievements(userId, stats) {
  if (!userAchievements.has(userId)) {
    userAchievements.set(userId, []);
  }

  const unlocked = userAchievements.get(userId);
  const statsWithAverage = {
    ...stats,
    averageScore: stats.practiceCount > 0 ? Math.round(stats.totalScore / stats.practiceCount) : 0
  };

  // Check each achievement
  for (const [key, achievement] of Object.entries(ACHIEVEMENTS)) {
    if (!unlocked.find(a => a.id === achievement.id)) {
      if (achievement.condition(statsWithAverage)) {
        unlocked.push({
          ...achievement,
          unlockedAt: new Date().toISOString()
        });
        console.log(`Achievement unlocked: ${achievement.title} for user: ${userId}`);
      }
    }
  }
}

/**
 * Get user achievements
 * @param {string} userId - User identifier
 * @returns {Array} - Array of unlocked achievements
 */
function getUserAchievements(userId) {
  if (!userAchievements.has(userId)) {
    return [];
  }

  const unlocked = userAchievements.get(userId);
  const unlockedIds = new Set(unlocked.map(a => a.id));

  // Return all achievements with unlock status
  return Object.values(ACHIEVEMENTS).map(achievement => ({
    ...achievement,
    unlocked: unlockedIds.has(achievement.id),
    unlockedAt: unlocked.find(a => a.id === achievement.id)?.unlockedAt || null
  }));
}

/**
 * ============== USER PROFILE & CANTONESE LEVEL ==============
 */

/**
 * Get or create user profile
 * @param {string} userId - User identifier
 * @returns {Promise<object>} - User profile
 */
async function getUserProfile(userId) {
  if (pool) {
    // Use database
    try {
      const result = await pool.query(
        'SELECT * FROM user_profiles WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length > 0) {
        return result.rows[0];
      }

      // Create new profile
      const newProfile = await pool.query(
        `INSERT INTO user_profiles (user_id, cantonese_level, preferences)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [userId, 'beginner', '{}']
      );

      return newProfile.rows[0];
    } catch (error) {
      console.error('Database error in getUserProfile:', error);
      // Fall through to in-memory storage
    }
  }

  // Fallback to in-memory storage
  if (!userProfiles.has(userId)) {
    userProfiles.set(userId, {
      userId: userId,
      cantoneseLevel: 'beginner',
      preferences: {}
    });
  }
  return userProfiles.get(userId);
}

/**
 * Update user's Cantonese level
 * @param {string} userId - User identifier
 * @param {string} level - Cantonese level (beginner, intermediate, advanced)
 * @returns {Promise<object>} - Updated profile
 */
async function updateUserCantoneseLevel(userId, level) {
  if (!CANTONESE_LEVELS[level.toUpperCase()]) {
    throw new Error(`Invalid cantonese level: ${level}`);
  }

  if (pool) {
    try {
      const result = await pool.query(
        `UPDATE user_profiles
         SET cantonese_level = $1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2
         RETURNING *`,
        [level, userId]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Database error in updateUserCantoneseLevel:', error);
    }
  }

  // Fallback to in-memory storage
  const profile = userProfiles.get(userId) || { userId, preferences: {} };
  profile.cantoneseLevel = level;
  userProfiles.set(userId, profile);
  return profile;
}

/**
 * Get story generation prompt based on user's Cantonese level
 * @param {string} level - Cantonese level
 * @returns {object} - Prompt configuration
 */
function getLevelPromptConfig(level) {
  const configs = {
    beginner: {
      mandarinLength: '2句话',
      cantoneseLength: '2句话',
      vocabulary: '简单日常词汇，如：呢度、嗰度、我、你、食饭、饮水、瞓觉',
      examples: '这里有一杯水，呢度有个苹果',
      tone: '简单、易懂'
    },
    intermediate: {
      mandarinLength: '3句话',
      cantoneseLength: '3句话',
      vocabulary: '日常对话词汇，如：但其实、就算、Anyway、几好、唔错',
      examples: '我今日去咗街市买餸，点知好巧遇到旧同学',
      tone: '自然、流畅'
    },
    advanced: {
      mandarinLength: '4句话',
      cantoneseLength: '4-5句话',
      vocabulary: '地道口语表达，如：鬼咁、唔使客气、正一、冇问题、梗系',
      examples: '今日去茶楼饮早茶，啲虾饺烧卖真系一流，虽然人多咗但都值得等',
      tone: '地道、生活化'
    }
  };

  return configs[level] || configs.beginner;
}

// ============== DATABASE STORAGE OPERATIONS ==============

/**
 * Database-aware save record function
 * @param {string} userId - User identifier
 * @param {object} data - Record data
 * @returns {Promise<object>} - Saved record
 */
async function saveRecord(userId, data) {
  const recordId = generateId();
  const record = {
    id: recordId,
    userId: userId,
    timestamp: new Date().toISOString(),
    ...data
  };

  if (pool) {
    try {
      const result = await pool.query(
        `INSERT INTO learning_records
         (user_id, mandarin, cantonese, cantonese_words, audio_url, image_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, timestamp`,
        [userId, data.mandarin, data.cantonese,
         JSON.stringify(data.cantoneseWords || []),
         data.audioUrl, data.imageUrl]
      );
      record.id = result.rows[0].id;
      record.timestamp = result.rows[0].timestamp;
    } catch (error) {
      console.error('Database save error:', error);
      // Fall through to in-memory storage
    }
  }

  // In-memory fallback
  if (!userRecords.has(userId)) {
    userRecords.set(userId, []);
  }
  userRecords.get(userId).unshift(record);
  const records = userRecords.get(userId);
  if (records.length > 100) records.pop();

  console.log(`Record saved: ${recordId} for user: ${userId}`);
  return record;
}

/**
 * Database-aware get user history function
 * @param {string} userId - User identifier
 * @param {number} limit - Maximum records
 * @returns {Promise<Array>} - Records
 */
async function getUserHistory(userId, limit = 20) {
  if (pool) {
    try {
      const result = await pool.query(
        `SELECT id, user_id, mandarin, cantonese,
         cantonese_words as "cantoneseWords",
         audio_url as "audioUrl", image_url as "imageUrl", timestamp
         FROM learning_records
         WHERE user_id = $1
         ORDER BY timestamp DESC
         LIMIT $2`,
        [userId, limit]
      );
      return result.rows;
    } catch (error) {
      console.error('Database get history error:', error);
    }
  }

  // In-memory fallback
  const records = userRecords.get(userId) || [];
  return records.slice(0, limit);
}

/**
 * Database-aware delete record function
 * @param {string} userId - User identifier
 * @param {string} recordId - Record ID
 * @returns {Promise<boolean>} - Success
 */
async function deleteRecord(userId, recordId) {
  if (pool) {
    try {
      const result = await pool.query(
        `DELETE FROM learning_records
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [recordId, userId]
      );
      if (result.rows.length > 0) {
        console.log(`Record deleted: ${recordId} for user: ${userId}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Database delete error:', error);
    }
  }

  // In-memory fallback
  const records = userRecords.get(userId);
  if (!records) return false;
  const index = records.findIndex(r => r.id === recordId);
  if (index === -1) return false;
  records.splice(index, 1);
  console.log(`Record deleted: ${recordId} for user: ${userId}`);
  return true;
}

/**
 * Database-aware get user stats function
 * @param {string} userId - User identifier
 * @returns {Promise<object>} - User statistics
 */
async function getUserStatsDb(userId) {
  if (pool) {
    try {
      const result = await pool.query(
        'SELECT * FROM user_statistics WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length > 0) {
        return result.rows[0];
      }

      // Create new stats
      const newStats = await pool.query(
        `INSERT INTO user_statistics (user_id)
         VALUES ($1)
         RETURNING *`,
        [userId]
      );
      return newStats.rows[0];
    } catch (error) {
      console.error('Database get stats error:', error);
    }
  }

  // In-memory fallback
  return getUserStats(userId);
}

// ============== DEEPINFRA API (Image to Cantonese Text) ==============

/**
 * Call DeepInfra to generate Mandarin description from image
 * @param {Buffer} imageBuffer - Image file buffer
 * @param {string} level - User's Cantonese level (beginner, intermediate, advanced)
 * @returns {Promise<string>} - Mandarin text description
 */
async function generateMandarinText(imageBuffer, level = 'beginner') {
  try {
    const client = new OpenAI({
      apiKey: process.env.DEEPINFRA_API_KEY,
      baseURL: 'https://api.deepinfra.com/v1/openai',
    });

    const base64Image = imageBuffer.toString('base64');
    const config = getLevelPromptConfig(level);

    const response = await client.chat.completions.create({
      model: 'Qwen/Qwen2.5-VL-32B-Instruct',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
            {
              type: 'text',
              text: `请用标准普通话书面语描述这张照片的内容（${config.mandarinLength}）。

要求：
- 使用标准普通话书面语，类似新闻联播风格
- 使用标准词汇：这里、这个、他们、什么、怎么、戴着、坐着、房间、里面、墙、门、窗户
- 不要使用粤语词汇
- 语言风格：${config.tone}

只输出描述文本，不要添加其他内容。`,
            },
          ],
        },
      ],
      max_tokens: level === 'advanced' ? 400 : 250,
      temperature: 0.3,
    });

    const mandarinText = response.choices[0]?.message?.content?.trim();

    if (!mandarinText) {
      throw new Error('Empty response from DeepInfra API');
    }

    return mandarinText;

  } catch (error) {
    console.error('DeepInfra API Error (Mandarin):', error.message);
    throw new Error(`Failed to generate Mandarin text: ${error.message}`);
  }
}

/**
 * Translate Mandarin text to Cantonese with Jyutping romanization
 * @param {string} mandarinText - Mandarin text to translate
 * @param {string} level - User's Cantonese level (beginner, intermediate, advanced)
 * @returns {Promise<{cantonese: string, pinyin: string}>} - Cantonese translation with pinyin
 */
async function translateToCantoneseWithPinyin(mandarinText, level = 'beginner') {
  try {
    const client = new OpenAI({
      apiKey: process.env.DEEPINFRA_API_KEY,
      baseURL: 'https://api.deepinfra.com/v1/openai',
    });

    const config = getLevelPromptConfig(level);

    const response = await client.chat.completions.create({
      model: 'Qwen/Qwen2.5-VL-32B-Instruct',
      messages: [
        {
          role: 'user',
          content: `请将以下普通话文本翻译成地道粤语口语，并为每个粤语字标注耶鲁拼音（Jyutping）。

${mandarinText}

要求：
1. 粤语翻译长度：${config.cantoneseLength}
2. 词汇难度：${config.vocabulary}
3. 保持原意不变，只是把普通话换成地道粤语说法
4. 为每个粤语字标注耶鲁拼音，格式：字(拼音)，如：我(ngóh)、喺(hái)
5. 语言风格：${config.tone}
6. 只输出带拼音的粤语翻译，不要输出普通话原文

输出格式示例：
我(ngóh)喺(hái)街(gaai)度(dou)饮(yám)奶(naaih)茶(chàh)

请输出：`,
        },
      ],
      max_tokens: level === 'advanced' ? 500 : 350,
      temperature: 0.3,
    });

    const cantoneseWithPinyin = response.choices[0]?.message?.content?.trim();

    if (!cantoneseWithPinyin) {
      throw new Error('Empty response from DeepInfra API');
    }

    console.log('Cantonese with pinyin:', cantoneseWithPinyin);

    // Parse the response to separate cantonese text and pinyin
    const parsed = parseCantoneseWithPinyin(cantoneseWithPinyin);

    return parsed;

  } catch (error) {
    console.error('DeepInfra API Error (Cantonese):', error.message);
    throw new Error(`Failed to translate to Cantonese: ${error.message}`);
  }
}

/**
 * Parse Cantonese text with pinyin annotations
 * Extracts pure Cantonese text and creates structured data with pinyin
 * @param {string} textWithPinyin - Text in format like "我(ngóh)喺(hái)街(gaai)"
 * @returns {{cantonese: string, words: Array<{char: string, pinyin: string}>}}
 */
function parseCantoneseWithPinyin(textWithPinyin) {
  const words = [];
  let cantoneseText = '';

  // Match pattern: 字(拼音) or standalone characters
  const regex = /([^\s()]+)\(([^)]+)\)|([^\s()]+)/g;
  let match;

  while ((match = regex.exec(textWithPinyin)) !== null) {
    if (match[1] && match[2]) {
      // Matched: 字(拼音)
      words.push({ char: match[1], pinyin: match[2] });
      cantoneseText += match[1];
    } else if (match[3]) {
      // Standalone character without pinyin
      words.push({ char: match[3], pinyin: '' });
      cantoneseText += match[3];
    }
  }

  return {
    cantonese: cantoneseText,
    words: words,
    pinyin: textWithPinyin // Keep original format for reference
  };
}

/**
 * Generate both Mandarin and Cantonese text from image with pinyin
 * Uses two separate AI calls for better accuracy
 * @param {Buffer} imageBuffer - Image file buffer
 * @param {string} level - User's Cantonese level (beginner, intermediate, advanced)
 * @returns {Promise<{mandarin: string, cantonese: string, cantoneseWords: Array}>} - Structured bilingual text
 */
async function generateBilingualText(imageBuffer, level = 'beginner') {
  try {
    // Step 1: Generate Mandarin description
    console.log('Generating Mandarin text...');
    const mandarinText = await generateMandarinText(imageBuffer, level);
    console.log('Mandarin text generated:', mandarinText.substring(0, 50) + '...');

    // Step 2: Translate to Cantonese with pinyin
    console.log('Translating to Cantonese with pinyin...');
    const cantoneseData = await translateToCantoneseWithPinyin(mandarinText, level);
    console.log('Cantonese text generated:', cantoneseData.cantonese.substring(0, 50) + '...');

    // Return structured data
    return {
      mandarin: mandarinText,
      cantonese: cantoneseData.cantonese,
      cantoneseWords: cantoneseData.words,
      // Legacy format for backward compatibility
      combinedText: `**（普通话版）**\n${mandarinText}\n\n**（粤语版）**\n${cantoneseData.cantonese}`
    };

  } catch (error) {
    console.error('Bilingual text generation error:', error.message);
    throw error;
  }
}

/**
 * Fallback: Generate Chinese description then translate to Cantonese story
 * This is used when the direct Cantonese story generation fails
 * @param {Buffer} imageBuffer - Image file buffer
 * @returns {Promise<string>} - Cantonese story text
 */
async function generateCantoneseStoryWithFallback(imageBuffer) {
  try {
    console.log('Attempting fallback: Chinese → Cantonese story translation...');

    // Initialize DeepInfra OpenAI client
    const client = new OpenAI({
      apiKey: process.env.DEEPINFRA_API_KEY,
      baseURL: 'https://api.deepinfra.com/v1/openai',
    });

    // Convert image buffer to base64
    const base64Image = imageBuffer.toString('base64');

    // Step 1: Generate Chinese description first
    const chineseDescriptionPrompt = `请用简体中文描述这张图片中的场景，包括人物、动作和背景。控制在2-3句话，简洁明了。`;

    const chineseResponse = await client.chat.completions.create({
      model: 'Qwen/Qwen2.5-VL-32B-Instruct',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
            {
              type: 'text',
              text: chineseDescriptionPrompt,
            },
          ],
        },
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const chineseText = chineseResponse.choices[0]?.message?.content?.trim();

    if (!chineseText) {
      throw new Error('Failed to generate Chinese description in fallback');
    }

    console.log('Chinese description generated:', chineseText.substring(0, 50) + '...');

    // Step 2: Translate and adapt to bilingual story
    const translationPrompt =`你是一位专业的普通话和粤语双语教师。请将以下图片描述改编成双语学习材料。

【关键要求】必须严格区分标准普通话和地道粤语！

**输出格式（严格遵守）：**

**（普通话版）**
[这里是标准普通话书面语，稍作润色，2-3句话]

**（粤语版）**
[这里是地道粤语口语，2-3句话]

**语言规范：**

【普通话版】必须是：
- 标准普通话书面语，类似语文课本的语言风格
- 可以使用：这里、这个、他们、什么、怎么
- 禁止使用：呢度、嗰度、咁、唔、佢、嘅、咗、噉、㖞、冇

【粤语版】必须是：
- 地道广东话口语，使用粤语字
- 应该使用：呢度、嗰度、咁、唔、佢、嘅、咗、噉、㖞、冇
- 禁止使用：这里、这个（太书面化）

**图片描述：**
${chineseText}

**请改编成双语学习材料：**`;

    const cantoneseResponse = await client.chat.completions.create({
      model: 'Qwen/Qwen2.5-VL-32B-Instruct',
      messages: [
        {
          role: 'user',
          content: translationPrompt,
        },
      ],
      max_tokens: 500,
      temperature: 0.8,
    });

    const cantoneseStory = cantoneseResponse.choices[0]?.message?.content?.trim();

    if (!cantoneseStory) {
      throw new Error('Failed to translate to Cantonese story in fallback');
    }

    console.log('Fallback succeeded: Generated Cantonese story via translation');

    return cantoneseStory;

  } catch (error) {
    console.error('Fallback process failed:', error.message);
    throw new Error(`Fallback generation failed: ${error.message}`);
  }
}

// ============== TENCENT CLOUD TTS API (Text to Cantonese Speech) ==============

/**
 * Extract and clean Cantonese text from story
 * Removes markdown symbols and extracts only Cantonese portion
 * @param {string} text - Full story text with Mandarin and Cantonese
 * @returns {string} - Cleaned Cantonese text only
 */
function extractAndCleanCantoneseText(text) {
  // Extract only Cantonese text
  const cantoneseTextMatch = text.match(/\*\*（粤语版）\*\*\s*\n([\s\S]*)/i);
  if (!cantoneseTextMatch) {
    console.warn('Cannot find Cantonese text marker, using full text');
    return text;
  }

  let cleanCantoneseText = cantoneseTextMatch[1].trim();

  // Stop at the next major section (###) or language explanation section
  // AI sometimes adds extra explanations like "语言规范说明"
  const sections = cleanCantoneseText.split(/\n###\s*/);
  cleanCantoneseText = sections[0].trim();

  // Further clean up - stop at horizontal rules or explanatory headings
  const lines = cleanCantoneseText.split('\n');
  const cleanedLines = [];
  for (const line of lines) {
    // Stop if we hit explanatory content
    if (line.match(/^(语言规范|场景描述|说明|注意|希望|如果)/)) {
      break;
    }
    cleanedLines.push(line);
  }
  cleanCantoneseText = cleanedLines.join('\n').trim();

  // Remove all markdown formatting symbols
  cleanCantoneseText = cleanCantoneseText
    .replace(/\*\*/g, '')  // Remove bold markers
    .replace(/#{1,6}\s*/g, '')  // Remove headers (### )
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // Remove markdown links but keep text
    .replace(/\[([^\]]+)\]/g, '$1')  // Remove brackets
    .replace(/^#+\s*/gm, '')  // Remove any remaining markdown headers at line start
    .replace(/^---+$/gm, '')  // Remove horizontal rules
    .trim();

  // Limit length for TTS (Tencent Cloud has character limit)
  if (cleanCantoneseText.length > 200) {
    // Take first 2-3 sentences
    const sentences = cleanCantoneseText.split(/[。！？！\n]/);
    cleanCantoneseText = sentences.slice(0, 3).join('。').trim();
    if (!cleanCantoneseText.endsWith('。')) {
      cleanCantoneseText += '。';
    }
  }

  return cleanCantoneseText;
}

/**
 * Call Tencent Cloud TTS to synthesize Cantonese speech from text
 * Uses Tencent Cloud's Text To Voice API with Cantonese voice
 * @param {string} text - Cantonese text to synthesize
 * @returns {Promise<Buffer>} - Audio buffer (MP3 format)
 */
async function synthesizeCantoneseSpeechWithTencent(text) {
  try {
    console.log('Using Tencent Cloud TTS for Cantonese synthesis');

    // Extract and clean Cantonese text
    const cleanCantoneseText = extractAndCleanCantoneseText(text);
    console.log('Cleaned Cantonese text:', cleanCantoneseText);

    // Intelligent voice selection for Cantonese
    // Analyze story content to determine appropriate voice
    const analysis = analyzeStoryForVoiceSelection(cleanCantoneseText);

    // Select VoiceType based on analysis
    // Tencent Cloud TTS Cantonese voices:
    // - 101019: 智彤 - 粤语女声
    // - 101020: 智伟 - 粤语男声
    let selectedVoiceType = 101019; // Default: female voice

    if (analysis.hasMaleProtagonist) {
      selectedVoiceType = 101020; // Male voice for male protagonist
      console.log('Selected: 智伟 (Cantonese male voice) - story has male protagonist');
    } else if (analysis.hasFemaleProtagonist || analysis.isChildrenStory) {
      selectedVoiceType = 101019; // Female voice for female protagonist or children
      console.log('Selected: 智彤 (Cantonese female voice) - story has female protagonist or is children\'s content');
    } else {
      console.log('Selected: 智彤 (Cantonese female voice) - default');
    }

    const params = {
      Text: cleanCantoneseText,
      SessionId: Date.now().toString(),
      VoiceType: selectedVoiceType,
      PrimaryLanguage: 1,  // 1 = Chinese
      SampleRate: 16000,
      Codec: "mp3",
      Speed: 1.0,
      Volume: 5.0,
    };

    const response = await ttsClient.TextToVoice(params);
    console.log('Tencent Cloud TTS response:', response);

    if (!response.Audio) {
      throw new Error('No audio data returned from Tencent Cloud TTS');
    }

    // Tencent returns base64 encoded audio
    const audioBuffer = Buffer.from(response.Audio, 'base64');
    console.log(`Tencent Cloud TTS successful, audio size: ${audioBuffer.length} bytes`);

    return audioBuffer;

  } catch (error) {
    console.error('Tencent Cloud TTS Error:', error.message);
    throw new Error(`Failed to synthesize speech with Tencent Cloud: ${error.message}`);
  }
}

/**
 * Analyze story content for intelligent voice selection (Tencent Cloud TTS)
 * @param {string} text - Cantonese text to analyze
 * @returns {Object} - Analysis result
 */
function analyzeStoryForVoiceSelection(text) {
  return {
    isChildrenStory: /小朋友|細路|細路仔|小孩|小孩仔|儿童|兒童|玩耍|玩木块|嘻嘻哈哈|童真|搭积木|搭高塔|細路仔呀|細路仔咧|小孩呀|小孩咯/.test(text),
    hasMaleProtagonist: /小明|阿明|哥哥|阿哥|爸爸|公公|先生|男人|男子|男生|小伙子|男孩|男仔|师傅|厨师|父亲|爷爷|叔叔|伯伯|老李|阿辉|阿伯|小林/.test(text),
    hasFemaleProtagonist: /小美|阿美|姐姐|家姐|妹妹|細妹|妈妈|婆婆|女人|女子|女生|女仔|姑娘|女孩|阿婆|母亲|奶奶|阿姨|师姐|师妹/.test(text),
  };
}

/**
 * Call Tencent Cloud TTS to synthesize Cantonese speech from text
 * Uses Tencent Cloud's intelligent voice selection with VoiceType 101019 (Cantonese)
 * @param {string} text - Cantonese text to synthesize
 * @returns {Promise<Buffer>} - Audio buffer (MP3 format)
 */
async function synthesizeCantoneseSpeech(text) {
  try {
    return await synthesizeCantoneseSpeechWithTencent(text);
  } catch (error) {
    console.error('Tencent Cloud TTS Error:', error.message);
    throw new Error(`Failed to synthesize speech with Tencent Cloud: ${error.message}`);
  }
}

// ============== DEEPINFRA WHISPER API (Cantonese Speech Recognition) ==============

/**
 * Call DeepInfra Whisper to recognize Cantonese speech
 * Uses OpenAI's Whisper model via DeepInfra REST API
 * @param {Buffer} audioBuffer - Audio file buffer
 * @returns {Promise<{text: string, confidence: number}>} - Recognized text and confidence score
 */
async function recognizeCantoneseSpeech(audioBuffer) {
  try {
    // Create form data with audio file
    const FormData = require('form-data');
    const form = new FormData();

    // Append audio buffer as a file
    form.append('audio', audioBuffer, {
      filename: 'audio.mp3',
      contentType: 'audio/mp3',
    });

    // Note: Model is now specified in the URL, not as a parameter
    // form.append('language', 'zh'); // Optional: language parameter (Whisper auto-detects)
    // form.append('response_format', 'verbose_json'); // Not needed - default response includes segments

    // Call DeepInfra's Whisper REST API
    // 2025-02-07: Fixed endpoint from /v1/openai/whisper (404) to /v1/inference/openai/whisper-large-v3
    const response = await axios.post(
      `https://api.deepinfra.com/v1/inference/openai/whisper-large-v3`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${process.env.DEEPINFRA_API_KEY}`,
        },
        timeout: 60000,
      }
    );

    // Extract the recognized text
    const text = response.data.text?.trim() || '';

    if (!text) {
      throw new Error('Empty response from Whisper API');
    }

    // Calculate average confidence from segments if available
    let confidence = 0.95; // Default high confidence
    if (response.data.segments && response.data.segments.length > 0) {
      // Use average probability from segments as confidence
      const avgProbability = response.data.segments.reduce(
        (sum, seg) => sum + (seg.avg_logprob || 0),
        0
      ) / response.data.segments.length;
      // Convert logprob to confidence (rough approximation)
      confidence = Math.max(0.5, Math.min(1.0, (avgProbability + 2) / 4));
    }

    console.log(`Whisper recognized text: ${text.substring(0, 50)}...`);

    return {
      text: text,
      confidence: confidence,
    };

  } catch (error) {
    console.error('DeepInfra Whisper API Error:', error.message);
    if (error.response) {
      console.error('DeepInfra Whisper Response:', error.response.data);
    }
    throw new Error(`Failed to recognize speech: ${error.message}`);
  }
}

// ============== SCORING LOGIC ==============

/**
 * Calculate pronunciation score based on text similarity and confidence
 * @param {string} originalText - Original Cantonese text
 * @param {string} userText - User's recognized speech text
 * @param {number} confidence - ASR confidence score (0-1)
 * @returns {Object} - Score breakdown with encouragement messages
 */
function calculatePronunciationScore(originalText, userText, confidence) {
  // Normalize texts for comparison
  const normalize = (text) => text.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');

  const normalizedOriginal = normalize(originalText);
  const normalizedUser = normalize(userText);

  // Calculate Levenshtein distance
  const distance = new Levenshtein(normalizedOriginal, normalizedUser).distance;
  const maxLen = Math.max(normalizedOriginal.length, normalizedUser.length) || 1;
  const similarity = 1 - (distance / maxLen);

  // Calculate comprehensive score
  // 60% weight on text similarity, 25% on ASR confidence, 15% on tone accuracy
  const similarityScore = similarity * 100;
  const confidenceScore = confidence * 100;
  // Estimate tone accuracy based on how well they matched (simplified approach)
  const toneAccuracy = Math.min(100, Math.max(60, similarityScore * 0.9 + confidenceScore * 0.1));

  const score = Math.round(similarityScore * 0.6 + confidenceScore * 0.25 + toneAccuracy * 0.15);

  // Determine accuracy level
  let accuracy = 'Poor';
  if (score >= 90) accuracy = 'Excellent';
  else if (score >= 75) accuracy = 'Good';
  else if (score >= 60) accuracy = 'Fair';

  // Estimate fluency based on score and confidence
  const fluency = Math.min(100, Math.round((score * 0.7 + confidenceScore * 0.3) * 0.95 + 5));

  // Generate encouragement messages based on score
  let title, message;
  if (score >= 90) {
    title = '好犀利！(太棒了)';
    message = '发音非常自然，继续保持。';
  } else if (score >= 80) {
    title = '唔错喔！(很好)';
    message = '发音很标准，再接再厉！';
  } else if (score >= 70) {
    title = '过得去！(还可以)';
    message = '有些地方需要练习，加油！';
  } else if (score >= 60) {
    title = '继续努力！(再努力)';
    message = '多听多说，一定会有进步！';
  } else {
    title = '重新嚟过！(再试试)';
    message = '不要气馁，多练习几次！';
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    accuracy,
    fluency,
    toneAccuracy: Math.round(toneAccuracy),
    similarity: Math.round(similarity * 100),
    confidence: Math.round(confidence * 100),
    encouragement: {
      title,
      message,
    },
  };
}

// ============== API ENDPOINTS ==============

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ success: true, message: 'Server is running', timestamp: new Date().toISOString() });
});

/**
 * POST /api/generate
 * Generate Cantonese text with pinyin and speech from uploaded image
 * Supports user-specific Cantonese level for difficulty adjustment
 */
app.post('/api/generate', upload.single('image'), async (req, res) => {
  try {
    // Validate request
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided. Please upload an image with field name "image"',
      });
    }

    const { userId } = req.body;
    console.log('Processing image:', req.file.originalname);

    // Get user's Cantonese level if userId is provided
    let userLevel = 'beginner'; // Default level
    if (userId) {
      try {
        const profile = await getUserProfile(userId);
        userLevel = profile.cantonese_level || 'beginner';
        console.log(`User level: ${userLevel}`);
      } catch (error) {
        console.warn('Failed to get user profile, using default level:', error.message);
      }
    }

    // Step 1: Generate bilingual story from image (Mandarin + Cantonese with pinyin)
    // Generate based on user's Cantonese level
    let bilingualData;
    try {
      bilingualData = await generateBilingualText(req.file.buffer, userLevel);
      console.log('Generated story:', bilingualData.cantonese.substring(0, 50) + '...');
    } catch (primaryError) {
      console.warn('Primary generation failed, attempting fallback...', primaryError.message);
      try {
        // Fallback returns old format text, we need to handle it
        const fallbackText = await generateCantoneseStoryWithFallback(req.file.buffer);
        console.log('Fallback generation succeeded');

        // Parse fallback text to extract mandarin and cantonese
        const mandarinMatch = fallbackText.match(/\*\*（普通话版）\*\*\s*\n([\s\S]*?)\n\n\*\*（粤语版）\*\*/);
        const cantoneseMatch = fallbackText.match(/\*\*（粤语版）\*\*\s*\n([\s\S]*)/);

        bilingualData = {
          mandarin: mandarinMatch ? mandarinMatch[1].trim() : '',
          cantonese: cantoneseMatch ? cantoneseMatch[1].trim() : fallbackText,
          cantoneseWords: [], // Fallback doesn't include pinyin
          combinedText: fallbackText
        };
      } catch (fallbackError) {
        console.error('Both primary and fallback generation failed:', fallbackError.message);
        throw new Error(`Failed to generate Cantonese story: ${primaryError.message}. Fallback also failed: ${fallbackError.message}`);
      }
    }

    // Step 2: Synthesize speech from Cantonese text (only the Cantonese part)
    const audioBuffer = await synthesizeCantoneseSpeech(bilingualData.cantonese);
    console.log('Synthesized audio size:', audioBuffer.length, 'bytes');

    // Step 3: Convert audio to base64 for client
    const audioBase64 = audioBuffer.toString('base64');
    const audioUrl = `data:audio/mp3;base64,${audioBase64}`;

    // Return success response with new structured format
    res.json({
      success: true,
      data: {
        // New structured format
        mandarin: bilingualData.mandarin,
        cantonese: bilingualData.cantonese,
        cantoneseWords: bilingualData.cantoneseWords, // Array of {char, pinyin}
        userLevel: userLevel, // Return the user's level for reference

        // Legacy format for backward compatibility
        text: bilingualData.combinedText,

        audioUrl: audioUrl,
        audioFormat: 'mp3',
        type: 'story',
      },
    });

  } catch (error) {
    console.error('Generate endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate Cantonese content',
    });
  }
});

/**
 * POST /api/evaluate
 * Evaluate user's Cantonese pronunciation
 */
app.post('/api/evaluate', upload.single('audio'), async (req, res) => {
  try {
    // Validate request
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No audio file provided. Please upload an audio file with field name "audio"',
      });
    }

    const originalText = req.body.originalText;
    if (!originalText) {
      return res.status(400).json({
        success: false,
        error: 'Missing originalText in request body',
      });
    }

    console.log('Evaluating audio:', req.file.originalname);
    console.log('Original text:', originalText);

    // Step 1: Recognize user's speech
    const { text: userText, confidence } = await recognizeCantoneseSpeech(req.file.buffer);
    console.log('Recognized text:', userText, 'Confidence:', confidence);

    // Step 2: Calculate pronunciation score with encouragement
    const scoreData = calculatePronunciationScore(originalText, userText, confidence);

    // Return success response with enhanced data
    res.json({
      success: true,
      data: {
        originalText: originalText,
        userText: userText,
        score: scoreData.score,
        accuracy: scoreData.accuracy,
        fluency: scoreData.fluency,
        toneAccuracy: scoreData.toneAccuracy,
        similarity: scoreData.similarity,
        confidence: scoreData.confidence,
        encouragement: scoreData.encouragement,
      },
    });

  } catch (error) {
    console.error('Evaluate endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to evaluate pronunciation',
    });
  }
});

/**
 * POST /api/save
 * Save a learning record to user's history
 */
app.post('/api/save', async (req, res) => {
  try {
    const { userId, mandarin, cantonese, cantoneseWords, audioUrl, imageUrl } = req.body;

    // Validate required fields
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId in request body',
      });
    }

    if (!mandarin || !cantonese) {
      return res.status(400).json({
        success: false,
        error: 'Missing mandarin or cantonese text in request body',
      });
    }

    // Save record
    const record = saveRecord(userId, {
      mandarin,
      cantonese,
      cantoneseWords: cantoneseWords || [],
      audioUrl,
      imageUrl,
    });

    res.json({
      success: true,
      data: {
        id: record.id,
        timestamp: record.timestamp,
        message: 'Record saved successfully',
      },
    });

  } catch (error) {
    console.error('Save endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to save record',
    });
  }
});

/**
 * GET /api/history
 * Get user's learning history
 */
app.get('/api/history', (req, res) => {
  try {
    const { userId, limit } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId parameter',
      });
    }

    const records = getUserHistory(userId, limit ? parseInt(limit) : 20);

    res.json({
      success: true,
      data: {
        count: records.length,
        records: records,
      },
    });

  } catch (error) {
    console.error('History endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch history',
    });
  }
});

/**
 * DELETE /api/history/:id
 * Delete a specific record from user's history
 */
app.delete('/api/history/:id', (req, res) => {
  try {
    const { userId } = req.query;
    const { id } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId parameter',
      });
    }

    const success = deleteRecord(userId, id);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Record not found or does not belong to user',
      });
    }

    res.json({
      success: true,
      data: {
        message: 'Record deleted successfully',
      },
    });

  } catch (error) {
    console.error('Delete history endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete record',
    });
  }
});

/**
 * POST /api/share
 * Create a shareable link for a story
 */
app.post('/api/share', async (req, res) => {
  try {
    const { mandarin, cantonese, cantoneseWords, imageUrl } = req.body;

    // Validate required fields
    if (!mandarin || !cantonese) {
      return res.status(400).json({
        success: false,
        error: 'Missing mandarin or cantonese text in request body',
      });
    }

    // Create share record
    const shareRecord = createShareRecord({
      mandarin,
      cantonese,
      cantoneseWords: cantoneseWords || [],
      imageUrl,
    });

    // Generate share URL (assuming the app is hosted at the same domain)
    const shareUrl = `${req.protocol}://${req.get('host')}/share/${shareRecord.shareId}`;

    res.json({
      success: true,
      data: {
        shareId: shareRecord.shareId,
        shareUrl: shareUrl,
        expiresAt: shareRecord.expiresAt,
        message: 'Share link created successfully',
      },
    });

  } catch (error) {
    console.error('Share endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create share link',
    });
  }
});

/**
 * GET /api/share/:id
 * Get shared story by share ID
 */
app.get('/api/share/:id', (req, res) => {
  try {
    const { id } = req.params;

    const shareRecord = getShareRecord(id);

    if (!shareRecord) {
      return res.status(404).json({
        success: false,
        error: 'Share link not found or has expired',
      });
    }

    res.json({
      success: true,
      data: {
        mandarin: shareRecord.mandarin,
        cantonese: shareRecord.cantonese,
        cantoneseWords: shareRecord.cantoneseWords,
        imageUrl: shareRecord.imageUrl,
        createdAt: shareRecord.createdAt,
        expiresAt: shareRecord.expiresAt,
      },
    });

  } catch (error) {
    console.error('Get share endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch shared story',
    });
  }
});

/**
 * GET /api/library
 * Get user's story library (saved stories)
 */
app.get('/api/library', (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId parameter',
      });
    }

    const records = getUserHistory(userId, 50); // Get up to 50 stories

    // Group by date for better UI display
    const grouped = {};
    records.forEach(record => {
      const date = new Date(record.timestamp).toLocaleDateString('zh-CN');
      if (!grouped[date]) {
        grouped[date] = [];
      }
      grouped[date].push(record);
    });

    res.json({
      success: true,
      data: {
        total: records.length,
        grouped: Object.entries(grouped).map(([date, stories]) => ({
          date,
          stories: stories.map(s => ({
            id: s.id,
            timestamp: s.timestamp,
            mandarin: s.mandarin,
            cantonese: s.cantonese,
            cantoneseWords: s.cantoneseWords,
            imageUrl: s.imageUrl,
            hasAudio: !!s.audioUrl
          }))
        })),
        recent: records.slice(0, 10).map(s => ({
          id: s.id,
          timestamp: s.timestamp,
          mandarin: s.mandarin,
          cantonese: s.cantonese,
          cantoneseWords: s.cantoneseWords,
          imageUrl: s.imageUrl
        }))
      },
    });

  } catch (error) {
    console.error('Library endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch library',
    });
  }
});

/**
 * GET /api/achievements
 * Get user's achievements
 */
app.get('/api/achievements', (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId parameter',
      });
    }

    const achievements = getUserAchievements(userId);
    const stats = getUserStats(userId);

    const unlockedCount = achievements.filter(a => a.unlocked).length;
    const totalCount = achievements.length;

    res.json({
      success: true,
      data: {
        total: totalCount,
        unlocked: unlockedCount,
        progress: Math.round((unlockedCount / totalCount) * 100),
        achievements: achievements,
        nextAchievements: achievements.filter(a => !a.unlocked).slice(0, 3)
      },
    });

  } catch (error) {
    console.error('Achievements endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch achievements',
    });
  }
});

/**
 * GET /api/user/profile
 * Get user profile including Cantonese level
 */
app.get('/api/user/profile', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId parameter',
      });
    }

    const profile = await getUserProfile(userId);

    res.json({
      success: true,
      data: {
        userId: profile.user_id || profile.userId,
        cantoneseLevel: profile.cantonese_level || profile.cantoneseLevel,
        preferences: profile.preferences,
        createdAt: profile.created_at || profile.createdAt,
        updatedAt: profile.updated_at || profile.updatedAt,
      },
    });

  } catch (error) {
    console.error('Get user profile endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch user profile',
    });
  }
});

/**
 * PUT /api/user/profile
 * Update user profile (Cantonese level and preferences)
 */
app.put('/api/user/profile', async (req, res) => {
  try {
    const { userId, cantoneseLevel, preferences } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId in request body',
      });
    }

    if (cantoneseLevel && !CANTONESE_LEVELS[cantoneseLevel.toUpperCase()]) {
      return res.status(400).json({
        success: false,
        error: `Invalid cantoneseLevel. Must be one of: ${Object.keys(CANTONESE_LEVELS).join(', ')}`,
      });
    }

    // Update Cantonese level if provided
    let updatedProfile;
    if (cantoneseLevel) {
      updatedProfile = await updateUserCantoneseLevel(userId, cantoneseLevel);
    }

    res.json({
      success: true,
      data: {
        userId: updatedProfile.user_id || updatedProfile.userId,
        cantoneseLevel: updatedProfile.cantonese_level || updatedProfile.cantoneseLevel,
        preferences: updatedProfile.preferences,
        message: `粤语水平已更新为：${CANTONESE_LEVELS[cantoneseLevel.toUpperCase()].name}`,
      },
    });

  } catch (error) {
    console.error('Update user profile endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update user profile',
    });
  }
});

/**
 * GET /api/user/levels
 * Get all available Cantonese levels
 */
app.get('/api/user/levels', (req, res) => {
  try {
    const levels = Object.values(CANTONESE_LEVELS).map(level => ({
      id: level.id,
      name: level.name,
      nameEn: level.nameEn,
      description: level.description,
      storyLength: level.storyLength,
      vocabulary: level.vocabulary,
      difficulty: level.difficulty,
    }));

    res.json({
      success: true,
      data: levels,
    });

  } catch (error) {
    console.error('Get levels endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch levels',
    });
  }
});

/**
 * GET /api/user/stats
 * Get user's learning statistics
 */
app.get('/api/user/stats', (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId parameter',
      });
    }

    const stats = getUserStats(userId);
    const achievements = getUserAchievements(userId);
    const records = getUserHistory(userId, 100);

    // Calculate additional statistics
    const averageScore = stats.practiceCount > 0
      ? Math.round(stats.totalScore / stats.practiceCount)
      : 0;

    const thisWeek = records.filter(r => {
      const recordDate = new Date(r.timestamp);
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return recordDate >= weekAgo;
    }).length;

    const today = records.filter(r => {
      const recordDate = new Date(r.timestamp);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      return recordDate >= todayStart;
    }).length;

    res.json({
      success: true,
      data: {
        totalStories: stats.totalStories,
        practiceCount: stats.practiceCount,
        bestScore: stats.bestScore,
        averageScore: averageScore,
        totalStudyTime: stats.totalStudyTime,
        achievementsUnlocked: achievements.filter(a => a.unlocked).length,
        thisWeekCount: thisWeek,
        todayCount: today,
        level: Math.floor(stats.totalStories / 10) + 1, // Simple leveling system
        currentLevelProgress: stats.totalStories % 10,
        nextLevelStories: ((Math.floor(stats.totalStories / 10) + 1) * 10),
      },
    });

  } catch (error) {
    console.error('User stats endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch user stats',
    });
  }
});

/**
 * POST /api/user/stats
 * Update user statistics (call after completing a story or practice)
 */
app.post('/api/user/stats', async (req, res) => {
  try {
    const { userId, score, practiceTime, isPractice } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId in request body',
      });
    }

    const updatedStats = updateUserStats(userId, {
      score,
      practiceTime: practiceTime || 1, // default 1 minute
      isPractice: isPractice || false
    });

    // Get updated achievements
    const achievements = getUserAchievements(userId);
    const newAchievements = achievements.filter(a =>
      a.unlocked && new Date(a.unlockedAt) > new Date(updatedStats.lastUpdated)
    );

    res.json({
      success: true,
      data: {
        stats: updatedStats,
        newAchievements: newAchievements,
        message: newAchievements.length > 0
          ? `🎉 恭喜解锁 ${newAchievements.length} 个新成就！`
          : 'Statistics updated successfully'
      },
    });

  } catch (error) {
    console.error('Update user stats endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update user stats',
    });
  }
});

/**
 * Error handling middleware
 */
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File size exceeds the 10MB limit',
      });
    }
  }

  if (error.message.includes('Only') || error.message.includes('allowed')) {
    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }

  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

// ============== START SERVER ==============
app.listen(PORT, () => {
  const storageType = pool ? 'PostgreSQL Database' : 'In-Memory Storage';

  console.log(`
╔════════════════════════════════════════════════════════════╗
║          🎤 拍照学粤语 API Server Started 🎤             ║
╠════════════════════════════════════════════════════════════╣
║  Server running on: http://localhost:${PORT}                  ║
║                                                         ║
║  Core APIs:                                             ║
║  Health check:    GET  /health                             ║
║  Generate:        POST /api/generate (支持用户水平调整)   ║
║  Evaluate:        POST /api/evaluate                       ║
║                                                         ║
║  Save & Library:                                         ║
║  Save:            POST /api/save                           ║
║  History:         GET  /api/history                        ║
║  Library:         GET  /api/library                        ║
║  Delete:          DELETE /api/history/:id                  ║
║                                                         ║
║  Share & Social:                                         ║
║  Share:           POST /api/share                          ║
║  Get Share:       GET  /api/share/:id                      ║
║                                                         ║
║  User & Gamification:                                    ║
║  Profile:         GET  /api/user/profile                   ║
║  Update Profile:  PUT  /api/user/profile                  ║
║  Get Levels:     GET  /api/user/levels                    ║
║  User Stats:      GET  /api/user/stats                     ║
║  Update Stats:    POST /api/user/stats                    ║
║  Achievements:    GET  /api/achievements                   ║
╚════════════════════════════════════════════════════════════╝

✅ APIs configured:
   - DeepInfra Vision (Qwen2.5-VL-32B-Instruct) - 图像识别与文本生成
   - DeepInfra API (Cantonese Translation + Jyutping) - 粤语翻译与拼音
   - Tencent Cloud TTS (粤语) - 语音合成
   - DeepInfra Whisper (whisper-large-v3) - 语音识别
   - ${storageType} - 存储系统
   - Achievement System (6 成就) - 成就系统

🆕 Features:
   - Automatic Jyutping romanization for Cantonese text
   - Structured bilingual output with pinyin annotations
   - Intelligent voice selection (Male/Female)
   - Enhanced scoring with tone accuracy & encouragement
   - User statistics & leveling system
   - Achievement tracking & unlocking
   - Adaptive difficulty based on user's Cantonese level (初级/中级/高级)

⚠️  Make sure all required environment variables are set!
${!pool ? '⚠️  No DATABASE_URL found - using in-memory storage (data will be lost on restart)\n' : ''}`);
});

module.exports = app;
