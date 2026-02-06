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

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

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

// ============== DEEPINFRA API (Image to Cantonese Text) ==============

/**
 * Call DeepInfra to generate Cantonese description from image
 * Uses DeepInfra's Qwen/Qwen2-VL-7B-Instruct multimodal model
 * @param {Buffer} imageBuffer - Image file buffer
 * @returns {Promise<string>} - Cantonese text description
 */
async function generateCantoneseText(imageBuffer) {
  try {
    // Initialize DeepInfra OpenAI client
    const client = new OpenAI({
      apiKey: process.env.DEEPINFRA_API_KEY,
      baseURL: 'https://api.deepinfra.com/v1/openai',
    });

    // Convert image buffer to base64
    const base64Image = imageBuffer.toString('base64');

    // Call DeepInfra's multimodal API with Qwen2.5-VL
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
              text: `你是一位擅长创作粤语学习内容的作家。请根据用户提供的图片内容，为粤语学习者创作一个简短的双语故事。

**要求：**
1. **格式**：必须按以下格式输出，分为两部分：

   **（普通话版）**
   [用标准普通话讲述图片内容，2-3句话]

   **（粤语版）**
   [用地道粤语口语讲述同样的内容，2-3句话]

2. **长度**：每个版本控制在**2-3句话**，简洁精炼，便于跟读。

3. **内容**：
   - **基于图片**：紧密围绕图片中的核心元素（人物、物体、场景）。
   - **保持一致**：两个版本讲述的是同一个场景，只是语言不同。
   - **融入文化**：可自然融入广府地区日常生活元素（如饮茶、行花街、落雨收衫等）。
   - **积极有趣**：整体基调轻松、温馨。

4. **语言风格**：
   - 普通话版：使用标准普通话书面语
   - 粤语版：使用地道粤语口语（如：呢度、嗰度、咁、唔、佢等）

5. **输出格式**：只输出上述两部分内容，无需其他解释。

**示例参考（如果图片是一杯奶茶和一本书）：**
**（普通话版）**
今天下午，小明偷偷去了楼下新开的茶餐厅，点了一杯冻奶茶。他拿着书装文艺，结果看着看着，太专注喝奶茶，不小心滴了两滴在书上。

**（粤语版）**
今日下昼，阿明偷偷走咗去楼下新开嘅茶记，叫咗杯冻奶茶。佢拎住本书扮文青，点知睇睇下书，挂住饮奶茶，滴咗两滴落本书度。

**现在，请根据我提供的图片内容开始创作：**`,
            },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.8,
    });

    // Extract the generated Cantonese text
    const cantoneseText = response.choices[0]?.message?.content?.trim();

    if (!cantoneseText) {
      throw new Error('Empty response from DeepInfra API');
    }

    return cantoneseText;

  } catch (error) {
    console.error('DeepInfra API Error:', error.message);
    if (error.response) {
      console.error('DeepInfra API Response:', error.response.data);
    }
    throw new Error(`Failed to generate Cantonese text: ${error.message}`);
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
    const translationPrompt = `你是一位擅长创作粤语学习内容的作家。我将提供一段简体中文的图片描述，请你将其改编成双语学习内容。

**要求：**
1. **格式**：必须按以下格式输出，分为两部分：

   **（普通话版）**
   [使用提供的中文描述，稍作润色，2-3句话]

   **（粤语版）**
   [用地道粤语口语翻译上述内容，2-3句话]

2. **长度**：每个版本控制在**2-3句话**，简洁精炼。
3. **粤语风格**：使用地道粤语口语（如：呢度、嗰度、咁、唔、佢等）
4. **输出格式**：只输出上述两部分内容，无需其他解释。

**中文描述：**
${chineseText}

**请改编成双语内容：**`;

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

// ============== STEPFUN TTS API (Text to Cantonese Speech) ==============

/**
 * Intelligent voice selection based on story content analysis
 * Analyzes the story type, characters, and mood to recommend appropriate voice
 * @param {string} text - Story text to analyze
 * @returns {string} - Recommended voice ID
 *
 * Available voices from step-tts-mini:
 * Male: cixingnansheng, zhengpaiqingnian, yuanqinansheng, qingniandaxuesheng,
 *       boyinnansheng, ruyananshi, shenchennanyin
 * Female: qinqienvsheng, wenrounvsheng, jilingshaonv, yuanqishaonv,
 *         ruanmengnvsheng, youyanvsheng, lengyanyujie, shuangkuaijiejie,
 *         wenjingxuejie, linjiajiejie, linjiameimei, zhixingjiejie
 */
function selectIntelligentVoice(text) {
  // Analysis keywords for story categorization
  const analysis = {
    // Refined children's story detection - removed generic "开心" and standalone particles
    // Only match specific child-related terms and particle combinations
    isChildrenStory: /小朋友|细路|细路仔|小孩|小孩仔|儿童|兒童|玩耍|玩木块|嘻嘻哈哈|童真|搭积木|搭高塔|细路仔呀|细路仔咧|小孩呀|小孩咯/.test(text),

    // Adult/adolence indicators - if these are present, it's NOT a children's story
    // Expanded with more professions, vehicles, and adult-related terms
    hasAdultIndicators: /市民|锻炼|健身|运动|工作|上班|公司|职员|成人|成年人|青年|老人|司机|老板|职员|店员|顾客|街坊|邻居|警察|医生|护士|老师|学生|开车|驾车|骑车|路人|行人|乘客|店主|商贩|员工/.test(text),

    // Warm emotional stories
    isWarmEmotional: /温暖|温馨|幸福|拥抱|亲人|家人|婆婆|公公|家人团聚|亲情|感动|温馨/.test(text),

    // Educational content
    isEducational: /学习|學習|读书|睇書|课堂|課堂|学校|學校|知识|知識|教学|教材|学习班|补习/.test(text),

    // Daily life scenes (Hong Kong style) - expanded with street, shop, vehicle scenes
    isDailyLife: /日常生活|生活|街市|茶餐厅|茶记|饮茶|吃饭|食飯|落雨|收衫|上班|放工|买菜|煮饭|厨房|厨|做饭|烹饪|煮食|家里|屋企|家|家庭|家居|餐厅|饭厅|街道|街边|街市|马路|路|店铺|铺头|商店|商场|购物|逛街|开车|驾车|骑车|坐车|乘车|交通|塞车|堵车|车流/.test(text),

    // Fitness/Sports scenes (NEW)
    isFitnessSports: /健身|锻炼|运动|跑步|打球|游泳|瑜伽|做运动|体能|训练|操场|体育馆|器材/.test(text),

    // Calm narrative - expanded with more tranquility keywords
    isCalmNarrative: /静静|靜靜|慢慢|漸漸|轻轻|輕輕|缓缓|緩緩|平静|平靜|安靜|悠闲|悠閒|放松|放鬆|宁静|寧靜|和谐|和諧|舒适|舒適|惬意|享受|安详|安詳/.test(text),

    // Energetic/active content - expanded keywords
    isEnergetic: /嘻嘻哈哈|哈哈|嘻嘻|热烈|熱烈|热闹|熱鬧|欢快|歡快|跳跃|跳躍|跑|冲|衝|活力|运动|健身|锻炼|充满活力|精神|元气|忙碌|紧张|激烈/.test(text),

    // Protagonist gender detection - expanded with profession titles
    hasMaleProtagonist: /小明|阿明|哥哥|阿哥|爸爸|公公|先生|男人|男子|男生|小伙子|男孩|男仔|师傅|厨师|父亲|爷爷|叔叔|伯伯/.test(text),
    hasFemaleProtagonist: /小美|阿美|姐姐|家姐|妹妹|細妹|妈妈|婆婆|女人|女子|女生|女仔|姑娘|女孩|阿婆|母亲|奶奶|阿姨|师姐|师妹/.test(text),
  };

  // Override: If adult indicators are present, force isChildrenStory to false
  if (analysis.hasAdultIndicators) {
    analysis.isChildrenStory = false;
  }

  console.log('Story content analysis:', analysis);

  // Decision logic for voice selection
  let selectedVoice;

  // Priority 1: Children's stories (most specific)
  if (analysis.isChildrenStory) {
    if (analysis.hasFemaleProtagonist || text.includes('妹妹') || text.includes('家姐')) {
      selectedVoice = 'linjiameimei'; // Young girl voice for children's stories
      console.log('Selected: linjiameimei (children\'s story with female characters)');
    } else if (analysis.hasMaleProtagonist || text.includes('哥哥') || text.includes('阿哥')) {
      selectedVoice = 'yuanqinansheng'; // Young boy voice
      console.log('Selected: yuanqinansheng (children\'s story with male characters)');
    } else {
      selectedVoice = 'yuanqishaonv'; // Default youthful female for general children's content
      console.log('Selected: yuanqishaonv (default children\'s story voice)');
    }
  }
  // Priority 2: Fitness/Sports scenes (NEW)
  else if (analysis.isFitnessSports) {
    if (analysis.hasFemaleProtagonist) {
      selectedVoice = 'jilingshaonv'; // Energetic female for fitness
      console.log('Selected: jilingshaonv (fitness story with female characters)');
    } else {
      selectedVoice = 'zhengpaiqingnian'; // Energetic young male for fitness
      console.log('Selected: zhengpaiqingnian (fitness story with male/neutral characters)');
    }
  }
  // Priority 3: Warm emotional stories
  else if (analysis.isWarmEmotional) {
    if (analysis.hasFemaleProtagonist) {
      selectedVoice = 'qinqienvsheng'; // Intimate and gentle female
      console.log('Selected: qinqienvsheng (warm emotional story with female protagonist)');
    } else {
      selectedVoice = 'yuanqinansheng'; // Warm male voice
      console.log('Selected: yuanqinansheng (warm emotional story with male protagonist)');
    }
  }
  // Priority 4: Educational content
  else if (analysis.isEducational) {
    if (analysis.hasFemaleProtagonist) {
      selectedVoice = 'wenjingxuejie'; // Scholarly female student
      console.log('Selected: wenjingxuejie (educational content with female voice)');
    } else {
      selectedVoice = 'boyinnansheng'; // Clear broadcast male
      console.log('Selected: boyinnansheng (educational content with male voice)');
    }
  }
  // Priority 5: Daily life stories
  else if (analysis.isDailyLife) {
    selectedVoice = 'shuangkuaijiejie'; // Cheerful sisterly for daily life
    console.log('Selected: shuangkuaijiejie (daily life story)');
  }
  // Priority 6: Energetic/active content
  else if (analysis.isEnergetic) {
    selectedVoice = 'jilingshaonv'; // Smart and lively
    console.log('Selected: jilingshaonv (energetic story)');
  }
  // Priority 7: Calm narrative
  else if (analysis.isCalmNarrative) {
    selectedVoice = 'wenrounvsheng'; // Soft and warm
    console.log('Selected: wenrounvsheng (calm narrative)');
  }
  // Default: Protagonist-based selection
  else {
    if (analysis.hasFemaleProtagonist) {
      selectedVoice = 'wenrounvsheng'; // Gentle female default
      console.log('Selected: wenrounvsheng (default female protagonist)');
    } else if (analysis.hasMaleProtagonist) {
      selectedVoice = 'cixingnansheng'; // Magnetic male default
      console.log('Selected: cixingnansheng (default male protagonist)');
    } else {
      selectedVoice = 'wenrounvsheng'; // Overall default
      console.log('Selected: wenrounvsheng (overall default)');
    }
  }

  return selectedVoice;
}

/**
 * Call StepFun API to synthesize Cantonese speech from text
 * Uses StepFun's step-tts-2 model with intelligent voice selection
 * @param {string} text - Cantonese text to synthesize
 * @param {string} [voiceOverride] - Optional voice ID to override intelligent selection
 * @returns {Promise<Buffer>} - Audio buffer (MP3 format)
 */
async function synthesizeCantoneseSpeech(text, voiceOverride) {
  try {
    // Use intelligent voice selection if no override provided
    const voiceId = voiceOverride || selectIntelligentVoice(text);

    console.log(`Synthesizing speech with voice: ${voiceId}`);

    const response = await axios.post(
      `${process.env.STEPFUN_API_ENDPOINT || 'https://api.stepfun.com/v1'}/audio/speech`,
      {
        model: process.env.STEPFUN_MODEL || 'step-tts-2',
        input: text,
        voice: voiceId,
        response_format: 'mp3',
        speed: 1.0,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.STEPFUN_API_KEY}`,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
        timeout: 60000,
      }
    );

    console.log(`Speech synthesis successful with voice: ${voiceId}`);
    // Return audio buffer
    return Buffer.from(response.data);

  } catch (error) {
    console.error('StepFun API Error:', error.message);
    if (error.response) {
      console.error('StepFun API Response:', error.response.data.toString());
    }
    throw new Error(`Failed to synthesize speech: ${error.message}`);
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
    const model = process.env.WHISPER_MODEL || 'openai/whisper-large-v3';

    // Create form data with audio file
    const FormData = require('form-data');
    const form = new FormData();

    // Append audio buffer as a file
    form.append('audio', audioBuffer, {
      filename: 'audio.mp3',
      contentType: 'audio/mp3',
    });

    // Append parameters
    form.append('model', model);
    form.append('language', 'zh'); // Chinese (will handle both Mandarin and Cantonese)
    form.append('response_format', 'verbose_json'); // Get detailed response with timestamps

    // Call DeepInfra's Whisper REST API
    const response = await axios.post(
      `https://api.deepinfra.com/v1/openai/whisper`,
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
 * @returns {Object} - Score breakdown
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
  // 70% weight on text similarity, 30% on ASR confidence
  const score = Math.round((similarity * 0.7 + confidence * 0.3) * 100);

  // Determine accuracy level
  let accuracy = 'Poor';
  if (score >= 90) accuracy = 'Excellent';
  else if (score >= 75) accuracy = 'Good';
  else if (score >= 60) accuracy = 'Fair';

  // Estimate fluency based on score
  const fluency = Math.min(100, Math.round(score * 0.9 + 10));

  return {
    score: Math.max(0, Math.min(100, score)),
    accuracy,
    fluency,
    similarity: Math.round(similarity * 100),
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
 * Generate Cantonese text and speech from uploaded image
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

    console.log('Processing image:', req.file.originalname);

    // Step 1: Generate Cantonese story from image
    let cantoneseText;
    try {
      cantoneseText = await generateCantoneseText(req.file.buffer);
      console.log('Generated story:', cantoneseText);
    } catch (primaryError) {
      console.warn('Primary generation failed, attempting fallback...', primaryError.message);
      try {
        cantoneseText = await generateCantoneseStoryWithFallback(req.file.buffer);
        console.log('Fallback generation succeeded');
      } catch (fallbackError) {
        console.error('Both primary and fallback generation failed:', fallbackError.message);
        throw new Error(`Failed to generate Cantonese story: ${primaryError.message}. Fallback also failed: ${fallbackError.message}`);
      }
    }

    // Step 2: Synthesize speech from Cantonese text
    const audioBuffer = await synthesizeCantoneseSpeech(cantoneseText);
    console.log('Synthesized audio size:', audioBuffer.length, 'bytes');

    // Step 3: Convert audio to base64 for client
    const audioBase64 = audioBuffer.toString('base64');
    const audioUrl = `data:audio/mp3;base64,${audioBase64}`;

    // Return success response
    res.json({
      success: true,
      data: {
        text: cantoneseText,
        audioUrl: audioUrl,
        audioFormat: 'mp3',
        type: 'story', // New identifier for story format
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

    // Step 2: Calculate pronunciation score
    const scoreData = calculatePronunciationScore(originalText, userText, confidence);

    // Return success response
    res.json({
      success: true,
      data: {
        originalText: originalText,
        userText: userText,
        score: scoreData.score,
        accuracy: scoreData.accuracy,
        fluency: scoreData.fluency,
        similarity: scoreData.similarity,
        confidence: Math.round(confidence * 100),
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
  console.log(`
╔════════════════════════════════════════════════════════════╗
║          🎤 拍照学粤语 API Server Started 🎤             ║
╠════════════════════════════════════════════════════════════╣
║  Server running on: http://localhost:${PORT}                  ║
║  Health check:    GET  /health                             ║
║  Generate:        POST /api/generate                       ║
║  Evaluate:        POST /api/evaluate                       ║
╚════════════════════════════════════════════════════════════╝

✅ APIs configured:
   - DeepInfra Vision (Qwen2.5-VL-32B-Instruct)
   - StepFun TTS (step-tts-2)
   - DeepInfra Whisper (whisper-large-v3)

⚠️  Make sure all required environment variables are set!
`);
});

module.exports = app;
