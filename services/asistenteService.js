const chatBotService = require('./chatBotService');

const asistente = async (req, res) => {
  try {
    const { message, userId, userName, userRole } = req.body;
    const { eventId } = req.params;

    if (!message) {
      return res.status(400).json({ error: 'Se requiere un mensaje' });
    }

    console.log('🤖 [API] Pregunta:', message, '| eventId:', eventId, '| userId:', userId);

    const pregunta = chatBotService.extraerPregunta(message);
    const respuesta = await chatBotService.generarRespuesta(pregunta, eventId, userId);

    console.log('✅ [API] Respuesta:', respuesta.respuesta?.substring(0, 80) + '...');

    res.json({
      success: true,
      respuesta: respuesta.respuesta,
      modelo: respuesta.modelo,
      categoria: respuesta.categoria,
    });

  } catch (error) {
    console.error('❌ Error en endpoint del asistente:', error);
    res.status(500).json({ error: 'Error al procesar la pregunta' });
  }
};

module.exports = { asistente };
