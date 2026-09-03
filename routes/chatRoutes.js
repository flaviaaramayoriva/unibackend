const express = require('express');
const router = express.Router();
const {analyzeChat} = require('../controllers/chatAnalysisController.js');

// Ruta para análisis de chat con IA
router.get('/event/:eventId/analysis', analyzeChat);

module.exports = router;