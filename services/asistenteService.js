// src/services/asistenteService.js
const chatBotService = require('./chatBotService');

const asistente = async (req, res) => {
  try {
    const { message, userId, userName } = req.body;
    const { eventId } = req.params; // ✅ FIX: el eventId viene en la URL, no en el body

    if (!message) {
      return res.status(400).json({ error: 'Se requiere un mensaje' });
    }

    console.log('🤖 [API] Pregunta recibida:', message, '| eventId:', eventId);

    // Extraer la pregunta limpia (quita /bot, /pregunta, etc.)
    const pregunta = chatBotService.extraerPregunta(message);

    // Generar respuesta con Brain.js, ahora sí con el contexto del evento
    const respuesta = await chatBotService.generarRespuesta(pregunta, eventId);

    console.log('✅ [API] Respuesta generada:', respuesta.respuesta);

    res.json({
      success: true,
      respuesta: respuesta.respuesta,
      modelo: respuesta.modelo
    });

  } catch (error) {
    console.error('❌ Error en endpoint del asistente:', error);
    res.status(500).json({ error: 'Error al procesar la pregunta' });
  }
};

module.exports = { asistente };