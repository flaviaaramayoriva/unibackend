// src/controllers/predictionController.js
const asyncHandler = require('express-async-handler');
const predictionService = require('../services/predictionService');

/**
 * POST /api/predictions/predecir
 * Recibe datos del frontend y devuelve la predicción de la IA
 */
const predecir = asyncHandler(async (req, res) => {
  try {
    // 1. Extraemos los datos que envía el frontend (React Native)
    const { tipo, facultad, fecha } = req.body;
    
    // 2. Validación básica
    if (!tipo || !facultad || !fecha) {
      return res.status(400).json({ 
        error: 'Faltan datos del evento. Se requiere: tipo, facultad y fecha.' 
      });
    }

    // 3. MAPEO: Adaptamos los nombres de variables del frontend 
    // al formato exacto que espera el predictionService (la IA)
    const datosParaIA = {
      fechaevento: fecha,             // El servicio busca 'fechaevento'
      idclasificacion: parseInt(tipo), // El servicio busca 'idclasificacion'
      idacademico: parseInt(facultad), // El servicio busca 'idacademico'
      idsubcategoria: 1,              // Valor por defecto (puedes hacerlo dinámico si tu frontend lo envía)
      evento_externo: false           // Valor por defecto
    };

    // 4. Llamamos al servicio de IA con los datos mapeados
    const resultado = await predictionService.predecirAsistencia(datosParaIA);

    // 5. Respondemos al frontend
    res.json({
      success: true,
      data: resultado
    });

  } catch (error) {
    console.error('❌ Error en predicción:', error);
    res.status(500).json({ 
      error: 'Error al generar predicción',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/predictions/analysis
 * Genera análisis completo para el dashboard del administrador
 */
const analisisCompleto = asyncHandler(async (req, res) => {
  try {
    const analisis = await predictionService.generarAnalisisCompleto();
    
    res.json({
      success: true,
      data: analisis,
      total_eventos: analisis.length
    });
  } catch (error) {
    console.error('❌ Error en análisis:', error);
    res.status(500).json({ error: 'Error al generar análisis' });
  }
});

module.exports = {
  predecir,
  analisisCompleto
};