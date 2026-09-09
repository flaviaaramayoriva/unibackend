const express = require('express');
const router = express.Router();
const {asistente} = require('../services/asistenteService.js');
// Ruta para el asistente IA del chat
router.post('/event/:eventId/bot', asistente);

module.exports = router;