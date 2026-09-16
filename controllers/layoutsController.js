const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getModels } = require('../models/index.js');
const asyncHandler = require('express-async-handler');
const fs = require('fs');
const path = require('path');

const crearLayout = asyncHandler(async (req, res) => {
  try {
    const { nombre } = req.body;
    const imagen = req.file;

    if (!nombre?.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: 'El nombre del layout es requerido' 
      });
    }

    if (!imagen) {
      return res.status(400).json({ 
        success: false, 
        message: 'La imagen del layout es requerida' 
      });
    }

    const models = getModels();
    const { Layout } = models;

    const nuevoLayout = await Layout.create({
      nombre: nombre.trim(),
      url_imagen: `layouts/${imagen.filename}` // guarda: "layouts/imagen-123.jpg"
    });

    res.status(201).json({ 
      success: true, 
      message: 'Layout creado exitosamente',
      layout: {
        id: nuevoLayout.idlayout,
        nombre: nuevoLayout.nombre,
        url_imagen: nuevoLayout.url_imagen,
        imagenUrl: `${req.protocol}://${req.get('host')}/uploads/${nuevoLayout.url_imagen}`
      }
    });

  } catch (error) {
    console.error('Error al crear layout:', error);
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        success: false, 
        message: 'El archivo es demasiado grande (máximo 10MB)' 
      });
    }

    if (error.message?.includes('Solo se permiten imágenes')) {
      return res.status(400).json({ 
        success: false, 
        message: 'Solo se permiten archivos de imagen (jpg, png, gif, webp)' 
      });
    }

    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor al crear el layout' 
    });
  }
});

const obtenerLayouts = asyncHandler(async (req, res) => {
  const models = getModels();
  const { Layout } = models;

  const layouts = await Layout.findAll({
    attributes: ['idlayout', 'nombre', 'url_imagen'],
    order: [['created_at', 'DESC']]
  });

  const layoutsConUrlCompleta = layouts.map(layout => {
    // url_imagen ya es "layouts/imagen-123.jpg", no necesita limpieza
    const imagenUrl = `${req.protocol}://${req.get('host')}/uploads/${layout.url_imagen}`;

    return {
      idlayout: layout.idlayout,
      nombre: layout.nombre,
      url_imagen: layout.url_imagen,
      imagenUrl: imagenUrl
    };
  });

  res.json(layoutsConUrlCompleta);
});

const generarLayoutIA = asyncHandler(async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt?.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: 'El prompt es requerido' 
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('❌ GEMINI_API_KEY no definida');
      return res.status(500).json({ 
        success: false, 
        message: 'Error de configuración: clave de IA no disponible' 
      });
    }

    // Usar la API directamente con fetch (funciona con claves AQ... y AIzaSy...)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Genera un código SVG de un plano de layout para un evento universitario. El layout debe ser un plano simple con áreas para mesas y circulación. Incluye una descripción textual breve. Prompt: "${prompt}". Responde SOLO con el código SVG válido y nada más, sin explicaciones ni texto adicional.`
          }]
        }]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Error API Gemini:', response.status, errorText);
      return res.status(500).json({ 
        success: false, 
        message: 'Error al comunicarse con la IA. Revisa la consola del servidor.' 
      });
    }

    const data = await response.json();
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      console.error('❌ Respuesta inesperada de Gemini:', data);
      return res.status(500).json({ 
        success: false, 
        message: 'Respuesta inesperada de la IA' 
      });
    }

    const svgCode = data.candidates[0].content.parts[0].text.trim();

    if (!svgCode.startsWith('<svg')) {
      console.error('❌ No se generó SVG válido:', svgCode.substring(0, 200));
      return res.status(500).json({ 
        success: false, 
        message: 'No se generó un SVG válido' 
      });
    }

    const models = getModels();
    const { Layout } = models;

    const nuevoLayout = await Layout.create({
      nombre: `Layout IA - ${prompt.substring(0, 30).trim()}`,
      url_imagen: `data:image/svg+xml;base64,${Buffer.from(svgCode).toString('base64')}`
    });

    res.status(201).json({ 
      success: true, 
      message: 'Layout generado con IA exitosamente',
      layout: {
        id: nuevoLayout.idlayout,
        nombre: nuevoLayout.nombre,
        url_imagen: nuevoLayout.url_imagen,
        imagenUrl: `${req.protocol}://${req.get('host')}/uploads/${nuevoLayout.url_imagen}`
      }
    });

  } catch (error) {
    console.error('❌ Error al generar layout con IA:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno al generar layout con IA' 
    });
  }
});

const eliminarLayout = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const models = getModels();
    const { Layout } = models;

    const layout = await Layout.findByPk(id);

    if (!layout) {
      return res.status(404).json({ success: false, message: 'Layout no encontrado' });
    }

    const filePath = path.join(__dirname, '..', 'uploads', layout.url_imagen);
    fs.unlink(filePath, (err) => {
      if (err) console.warn('⚠️ No se pudo borrar el archivo físico:', err.message);
    });

    await layout.destroy();

    res.json({ success: true, message: 'Layout eliminado correctamente' });
  } catch (error) {
    console.error('❌ Error al eliminar layout:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor al eliminar el layout' });
  }
});
module.exports = {
  crearLayout,
  obtenerLayouts,
  eliminarLayout,
  generarLayoutIA
};