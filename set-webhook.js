require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const API_BASE_URL = process.env.API_BASE_URL || 'https://unibackend-production-a0f8.up.railway.app';

if (!TELEGRAM_TOKEN) {
  console.error('❌ Falta TELEGRAM_TOKEN en .env');
  process.exit(1);
}

const WEBHOOK_URL = `${API_BASE_URL}/bot/telegram/webhook`;

async function setWebhook() {
  const bot = new TelegramBot(TELEGRAM_TOKEN, { webhook: true, polling: false });
  
  try {
    // Delete existing webhook
    await bot.deleteWebHook({ drop_pending_updates: true });
    console.log('🧹 Webhook anterior eliminado');
    
    // Set new webhook
    const result = await bot.setWebHook(WEBHOOK_URL);
    console.log('✅ Webhook configurado:', result);
    console.log(`🔗 URL: ${WEBHOOK_URL}`);
    
    // Verify
    const info = await bot.getWebHookInfo();
    console.log('📋 Webhook Info:', JSON.stringify(info, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

setWebhook();