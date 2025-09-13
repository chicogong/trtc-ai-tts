require('dotenv').config();

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const tencentcloud = require("tencentcloud-sdk-nodejs-trtc");
const TLSSigAPIv2 = require('tls-sig-api-v2');

const TrtcClient = tencentcloud.trtc.v20190722.Client;

// Agent configuration
const agentConfig = {
  // Tencent Cloud API client configuration
  apiConfig: {
    secretId: process.env.TENCENT_SECRET_ID,
    secretKey: process.env.TENCENT_SECRET_KEY,
    region: process.env.TENCENT_REGION || "ap-beijing",
    endpoint: process.env.TENCENT_ENDPOINT || "trtc.tencentcloudapi.com"
  },

  // TRTC configuration
  trtcConfig: {
    sdkAppId: parseInt(process.env.TRTC_SDK_APP_ID),
    secretKey: process.env.TRTC_SECRET_KEY,
    expireTime: 10 * 60 * 60  // 10 hours expiration time
  },

  // Agent card information
  AgentCard: {
    name: "智慧小助手",
    description: "我是你的AI助手，可以回答日常问题、聊天解闷、提供百科知识。随时随地为你提供帮助！",
    capabilities: ["日常问答", "知识百科", "生活建议", "轻松聊天", "实时互动"],
    voiceType: "温柔女声",
    personality: "友好、知识丰富、温暖、有耐心"
  },

  // Agent configuration
  AgentConfig: {
    WelcomeMessage: "你好，我是你的智慧小助手，有什么我可以帮你的吗？",
    InterruptMode: 2,
    TurnDetectionMode: 3,
    InterruptSpeechDuration: 200,
    WelcomeMessagePriority: 1
  },

  // Speech recognition configuration
  STTConfig: {
    Language: "zh",
    VadSilenceTime: 600,
    HotWordList: "小助手|11,解闷|11",
    VadLevel: 2
  },

  // LLM configuration
  LLMConfig: {
    LLMType: "openai",
    Model: process.env.LLM_MODEL,
    APIUrl: process.env.LLM_API_URL,
    APIKey: process.env.LLM_API_KEY,
    History: 5,
    Timeout: 3,
    Streaming: true,
    SystemPrompt: `
      # 基础人设
      - 名称：智慧小助手
      - 性格：友好、温暖、知识渊博
      - 风格：亲切自然，语气温和，耐心解答

      # 能力范围
      - 日常问答：回答用户的日常生活问题
      - 百科知识：提供各领域的知识和信息
      - 生活建议：给出实用的生活小窍门和建议
      - 陪伴聊天：陪伴用户轻松聊天，解答疑惑

      # 聊天规则
      1. 回答方式
      - 回答要简明扼要，不过于冗长
      - 语气亲切友好，如同朋友般交流
      - 专业知识要通俗易懂，避免晦涩难懂的术语

      2. 互动方式
      - 耐心倾听用户问题
      - 在不确定的情况下，坦诚告知并尝试提供相关信息
      - 适当表达关心，但保持适度的专业性
    `
  },

  // Text-to-speech configuration
  TTSConfig: {
    TTSType: process.env.TTS_TYPE || "new",
    APIKey: process.env.TTS_API_KEY,
    APIUrl: process.env.TTS_API_URL,
    SampleRate: parseInt(process.env.TTS_SAMPLE_RATE) || 24000,
    VoiceId: process.env.TTS_VOICE_ID
  }
};

const app = express();
app.use(morgan(':method :url :status :res[content-length] - :response-time ms'));
app.use(express.json());
app.use(cors());

// Serve conversation.html
app.use(express.static(__dirname, { 
  maxAge: '1m', 
  etag: true
}));

/**
 * Create a new TRTC client instance
 */
function createClient() {
  return new TrtcClient({
    credential: {
      secretId: agentConfig.apiConfig.secretId,
      secretKey: agentConfig.apiConfig.secretKey,
    },
    region: agentConfig.apiConfig.region,
    profile: {
      httpProfile: {
        endpoint: agentConfig.apiConfig.endpoint,
      },
    },
  });
}

/**
 * Start an AI conversation
 * POST /conversations
 */
app.post('/conversations', (req, res) => {
  try {
    const { userInfo } = req.body || {};
    
    if (!userInfo || !userInfo.sdkAppId || !userInfo.roomId || !userInfo.robotId || 
        !userInfo.robotSig || !userInfo.userId) {
      return res.status(400).json({ 
        error: 'Missing required fields in userInfo',
        required: ['sdkAppId', 'roomId', 'robotId', 'robotSig', 'userId']
      });
    }
    
    const client = createClient();

    // Get voice selection from request or use default
    const voiceId = userInfo.voiceId || agentConfig.TTSConfig.VoiceId;
    const ttsConfig = {
      ...agentConfig.TTSConfig,
      VoiceId: voiceId
    };

    const params = {
      "SdkAppId": userInfo.sdkAppId,
      "RoomId": userInfo.roomId.toString(),
      "AgentConfig": {
        "UserId": userInfo.robotId,
        "UserSig": userInfo.robotSig,
        "TargetUserId": userInfo.userId,
        ...agentConfig.AgentConfig
      },
      "STTConfig": agentConfig.STTConfig,
      "LLMConfig": JSON.stringify(agentConfig.LLMConfig),
      "TTSConfig": JSON.stringify(ttsConfig)
    };

    client.StartAIConversation(params)
      .then(data => res.json(data))
      .catch(err => {
        console.error('Failed to start AI conversation', err);
        return res.status(500).json({ error: err.message });
      });
  } catch (error) {
    console.error('Error in startConversation', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Stop an AI conversation
 * DELETE /conversations
 */
app.delete('/conversations', (req, res) => {
  try {
    const { TaskId } = req.body;
    
    if (!TaskId) {
      return res.status(400).json({ error: 'Missing required TaskId field' });
    }
    
    const client = createClient();
    client.StopAIConversation({ TaskId })
      .then(data => res.json(data))
      .catch(err => {
        console.error('Failed to stop AI conversation', err);
        return res.status(500).json({ error: err.message });
      });
  } catch (error) {
    console.error('Error in stopConversation', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Generate user credentials
 * POST /credentials
 */
app.post('/credentials', (req, res) => {
  try {
    const { sdkAppId, secretKey, expireTime } = agentConfig.trtcConfig;
    const randomNum = Math.floor(100000 + Math.random() * 900000).toString();
    const userId = `user_${randomNum}`;
    const robotId = `ai_${randomNum}`;
    const roomId = parseInt(randomNum);
    
    const api = new TLSSigAPIv2.Api(sdkAppId, secretKey);
    const userSig = api.genSig(userId, expireTime);
    const robotSig = api.genSig(robotId, expireTime);
    
    const credentials = { sdkAppId, userSig, robotSig, userId, robotId, roomId };
    
    res.json(credentials);
  } catch (error) {
    console.error('Failed to generate user information', error);
    return res.status(500).json({ error: error.message });
  }
});


const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`Server running at http://${HOST}:${PORT}/`));