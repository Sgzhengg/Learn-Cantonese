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

// ============== DEEPINFRA API (Image to Cantonese Text) ==============

/**
 * Call DeepInfra to generate Mandarin description from image
 * @param {Buffer} imageBuffer - Image file buffer
 * @returns {Promise<string>} - Mandarin text description
 */
async function generateMandarinText(imageBuffer) {
  try {
    const client = new OpenAI({
      apiKey: process.env.DEEPINFRA_API_KEY,
      baseURL: 'https://api.deepinfra.com/v1/openai',
    });

    const base64Image = imageBuffer.toString('base64');

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
              text: `请用标准普通话书面语描述这张照片的内容（2-3句话）。

要求：
- 使用标准普通话书面语，类似新闻联播风格
- 使用标准词汇：这里、这个、他们、什么、怎么、戴着、坐着、房间、里面、墙、门、窗户
- 不要使用粤语词汇

只输出描述文本，不要添加其他内容。`,
            },
          ],
        },
      ],
      max_tokens: 200,
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
 * Translate Mandarin text to Cantonese
 * @param {string} mandarinText - Mandarin text to translate
 * @returns {Promise<string>} - Cantonese translation
 */
async function translateToCantonese(mandarinText) {
  try {
    const client = new OpenAI({
      apiKey: process.env.DEEPINFRA_API_KEY,
      baseURL: 'https://api.deepinfra.com/v1/openai',
    });

    const response = await client.chat.completions.create({
      model: 'Qwen/Qwen2.5-VL-32B-Instruct',
      messages: [
        {
          role: 'user',
          content: `请将以下普通话文本翻译成地道粤语口语：

${mandarinText}

要求：
- 使用地道粤语口语词汇：呢度、嗰个、佢哋、乜嘢、点解、戴住、坐喺、房间、入面、牆、門、窗
- 保持原意不变，只是把普通话换成地道粤语说法
- 只输出翻译结果，不要添加其他内容`,
        },
      ],
      max_tokens: 200,
      temperature: 0.3,
    });

    const cantoneseText = response.choices[0]?.message?.content?.trim();

    if (!cantoneseText) {
      throw new Error('Empty response from DeepInfra API');
    }

    return cantoneseText;

  } catch (error) {
    console.error('DeepInfra API Error (Cantonese):', error.message);
    throw new Error(`Failed to translate to Cantonese: ${error.message}`);
  }
}

/**
 * Generate both Mandarin and Cantonese text from image
 * Uses two separate AI calls for better accuracy
 * @param {Buffer} imageBuffer - Image file buffer
 * @returns {Promise<{mandarin: string, cantonese: string}>} - Both texts
 */
async function generateBilingualText(imageBuffer) {
  try {
    // Step 1: Generate Mandarin description
    console.log('Generating Mandarin text...');
    const mandarinText = await generateMandarinText(imageBuffer);
    console.log('Mandarin text generated:', mandarinText.substring(0, 50) + '...');

    // Step 2: Translate to Cantonese
    console.log('Translating to Cantonese...');
    const cantoneseText = await translateToCantonese(mandarinText);
    console.log('Cantonese text generated:', cantoneseText.substring(0, 50) + '...');

    // Combine in the required format
    const combinedText = `**（普通话版）**
${mandarinText}

**（粤语版）**
${cantoneseText}`;

    return combinedText;

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

    // Step 1: Generate bilingual story from image (Mandarin + Cantonese)
    let cantoneseText;
    try {
      cantoneseText = await generateBilingualText(req.file.buffer);
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

    // Step 2: Synthesize speech from Cantonese text (only the Cantonese part)
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
   - DeepInfra Vision (Qwen2.5-VL-32B-Instruct) - 图像识别
   - Tencent Cloud TTS (粤语) - 语音合成
   - DeepInfra Whisper (whisper-large-v3) - 语音识别

⚠️  Make sure all required environment variables are set!
`);
});

module.exports = app;
