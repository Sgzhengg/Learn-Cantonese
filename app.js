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

// ============== BAIDU AI API (Image to Cantonese Text) ==============

/**
 * Call Baidu AI to generate Cantonese description from image
 * Uses Baidu AI Studio's OpenAI-compatible API with ernie-4.5-turbo-vl model
 * @param {Buffer} imageBuffer - Image file buffer
 * @returns {Promise<string>} - Cantonese text description
 */
async function generateCantoneseText(imageBuffer) {
  try {
    // Initialize Baidu AI OpenAI client
    const client = new OpenAI({
      apiKey: process.env.BAIDU_API_KEY,
      baseURL: 'https://aistudio.baidu.com/llm/lmapi/v3',
    });

    // Convert image buffer to base64
    const base64Image = imageBuffer.toString('base64');

    // Call Baidu's multimodal API
    const response = await client.chat.completions.create({
      model: 'ernie-4.5-turbo-vl',
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
              text: '请用生活化、地道的粤语（广东话）描述这张图片中的场景或物品。生成一句简短、自然的粤语句子，不要使用普通话表达。只返回粤语句子，不需要其他解释。',
            },
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0.7,
    });

    // Extract the generated Cantonese text
    const cantoneseText = response.choices[0]?.message?.content?.trim();

    if (!cantoneseText) {
      throw new Error('Empty response from Baidu AI');
    }

    return cantoneseText;

  } catch (error) {
    console.error('Baidu API Error:', error.message);
    if (error.response) {
      console.error('Baidu API Response:', error.response.data);
    }
    throw new Error(`Failed to generate Cantonese text: ${error.message}`);
  }
}

// ============== STEPFUN TTS API (Text to Cantonese Speech) ==============

/**
 * Call StepFun API to synthesize Cantonese speech from text
 * Uses StepFun's step-tts-2 model with Cantonese language support
 * @param {string} text - Cantonese text to synthesize
 * @returns {Promise<Buffer>} - Audio buffer (MP3 format)
 */
async function synthesizeCantoneseSpeech(text) {
  try {
    const response = await axios.post(
      `${process.env.STEPFUN_API_ENDPOINT || 'https://api.stepfun.com/v1'}/audio/speech`,
      {
        model: process.env.STEPFUN_MODEL || 'step-tts-2',
        input: text,
        voice_label: {
          language: '粤语', // Cantonese language
          gender: process.env.STEPFUN_GENDER || 'female', // male or female
        },
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

// ============== TENCENT ASR API (Cantonese Speech Recognition) ==============

/**
 * Generate Tencent Cloud TC3-HMAC-SHA256 signature
 * @param {string} method - HTTP method (POST)
 * @param {string} endpoint - API endpoint
 * @param {Object} params - Query parameters
 * @param {string} body - Request body
 * @param {string} timestamp - Request timestamp
 * @returns {string} - Authorization header
 */
function generateTencentSignature(method, endpoint, params, body, timestamp) {
  const SECRET_ID = process.env.TENCENT_SECRET_ID;
  const SECRET_KEY = process.env.TENCENT_SECRET_KEY;
  const service = 'asr';
  const version = '2019-06-14';
  const host = 'asr.cloud.tencent.com';
  const algorithm = 'TC3-HMAC-SHA256';

  // Step 1: Build canonical request string
  const httpRequestMethod = method;
  const canonicalUri = '/';
  const canonicalQueryString = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  const canonicalHeaders = `content-type:application/json\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const hashedRequestPayload = crypto.createHash('sha256').update(body).digest('hex');
  const canonicalRequest = `${httpRequestMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedRequestPayload}`;

  // Step 2: Build string to sign
  const date = new Date(timestamp * 1000).toISOString().substr(0, 10);
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;

  // Step 3: Calculate signature
  const kDate = crypto.createHmac('sha256', `TC3${SECRET_KEY}`).update(date).digest();
  const kService = crypto.createHmac('sha256', kDate).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  // Step 4: Build authorization header
  const authorization = `${algorithm} Credential=${SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return authorization;
}

/**
 * Call Tencent Cloud ASR to recognize Cantonese speech
 * Uses 16k_yue engine model for Cantonese recognition
 * @param {Buffer} audioBuffer - Audio file buffer
 * @returns {Promise<{text: string, confidence: number}>} - Recognized text and confidence score
 */
async function recognizeCantoneseSpeech(audioBuffer) {
  try {
    const SECRET_ID = process.env.TENCENT_SECRET_ID;
    const SECRET_KEY = process.env.TENCENT_SECRET_KEY;
    const APP_ID = process.env.TENCENT_APP_ID;

    if (!SECRET_ID || !SECRET_KEY || !APP_ID) {
      throw new Error('Missing Tencent Cloud credentials: TENCENT_SECRET_ID, TENCENT_SECRET_KEY, or TENCENT_APP_ID');
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const endpoint = 'asr.cloud.tencent.com';
    const base64Audio = audioBuffer.toString('base64');

    const params = {
      EngineModelType: '16k_yue', // Cantonese engine
      ChannelNum: 1,
      Data: base64Audio,
      DataLen: audioBuffer.length,
      Format: 'mp3',
      SampleRate: 16000,
      Version: '2019-06-14',
      Region: process.env.TENCENT_REGION || 'ap-guangzhou',
      Timestamp: timestamp,
      Action: 'SentenceRecognition',
      Nonce: Math.random().toString(36).substr(2),
      SecretId: SECRET_ID,
    };

    const body = JSON.stringify({
      EngineModelType: '16k_yue',
      ChannelNum: 1,
      Data: base64Audio,
      DataLen: audioBuffer.length,
      Format: 'mp3',
      SampleRate: 16000,
    });

    const signature = generateTencentSignature('POST', endpoint, {}, body, timestamp);

    const response = await axios.post(
      `https://${endpoint}/`,
      body,
      {
        headers: {
          'Authorization': signature,
          'Content-Type': 'application/json',
          'Host': endpoint,
        },
        params: {
          Action: 'SentenceRecognition',
          Version: '2019-06-14',
          Region: params.Region,
        },
        timeout: 30000,
      }
    );

    if (response.data.Response.Error) {
      throw new Error(`Tencent ASR Error: ${response.data.Response.Error.Message}`);
    }

    const result = response.data.Response.Result;
    // Convert to number and default to 0.9 if not provided
    const confidence = typeof response.data.Response.Confidence === 'number'
      ? response.data.Response.Confidence
      : 0.9;

    return {
      text: result,
      confidence: confidence,
    };

  } catch (error) {
    console.error('Tencent ASR API Error:', error.message);
    if (error.response) {
      console.error('Tencent ASR Response:', error.response.data);
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

    // Step 1: Generate Cantonese text from image
    const cantoneseText = await generateCantoneseText(req.file.buffer);
    console.log('Generated text:', cantoneseText);

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
   - Baidu AI (ernie-4.5-turbo-vl)
   - StepFun TTS (step-tts-2)
   - Tencent ASR (16k_yue)

⚠️  Make sure all required environment variables are set!
`);
});

module.exports = app;
