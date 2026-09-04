// config/bot.js
const TelegramBot = require('node-telegram-bot-api');

// Usamos polling. En Railway funciona perfecto y no requiere configurar Webhooks HTTPS complejos.
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// Comandos básicos
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `¡Hola! 👋\n\nTu ID de chat es: \`${msg.chat.id}\`\n\nÚsalo en la app para vincular tu cuenta y recibir recordatorios aquí.`, { parse_mode: 'Markdown' });
});

// Escuchar mensajes para responder con la IA (opcional, si quieres que el bot responda directo)
bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return; // Ignorar comandos
  
  // Aquí podrías importar ChatBotService y responder, o manejarlo desde tu botController
  // Por ahora, solo confirmamos que el bot está vivo
  // bot.sendMessage(msg.chat.id, 'Mensaje recibido. Vincula tu cuenta en la app para usar la IA.');
});

module.exports = bot;