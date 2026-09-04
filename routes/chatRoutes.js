const express = require('express');
const router = express.Router();
const {analyzeChat} = require('../controllers/chatAnalysisController.js');
const {asistente} = require('../services/asistenteService.js');
// Ruta para análisis de chat con IA
router.get('/event/:eventId/analysis', analyzeChat);
router.post('/event/:eventId/bot', asistente);

module.exports = router;