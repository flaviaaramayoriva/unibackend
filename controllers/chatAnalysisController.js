const asyncHandler = require('express-async-handler');
const chatAnalysisService = require('../services/chatAnalysisService');

const analyzeChat = asyncHandler(async (req, res) => {
  const { eventId } = req.params;

  if (!eventId) {
    return res.status(400).json({ error: 'Se requiere el ID del evento' });
  }

  const analysis = await chatAnalysisService.analyzeEventChat(eventId);

  res.json({
    success: true,
    data: analysis
  });
});

module.exports = { analyzeChat };