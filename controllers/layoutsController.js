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

    const svgCode = generarSVGLayout(prompt.trim());

    if (!svgCode || !svgCode.startsWith('<svg')) {
      return res.status(500).json({ 
        success: false, 
        message: 'No se pudo generar el layout SVG' 
      });
    }

    const fs = require('fs');
    const path = require('path');
    const layoutsDir = path.join(__dirname, '..', 'uploads', 'layouts');
    if (!fs.existsSync(layoutsDir)) fs.mkdirSync(layoutsDir, { recursive: true });

    const filename = `layout.svg`;
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const filePath = path.join(layoutsDir, `${uniqueSuffix}-${filename}`);
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>${svgCode}`;
    fs.writeFileSync(filePath, svgContent);

    const models = getModels();
    const { Layout } = models;

    const dbFileName = `${uniqueSuffix}-${filename}`;
    const urlImagen = `/uploads/${dbFileName}`;
    const nuevoLayout = await Layout.create({
      nombre: `Layout IA - ${prompt.substring(0, 30).trim()}`,
      url_imagen: dbFileName
    });

    res.status(201).json({ 
      success: true, 
      message: 'Layout generado exitosamente',
      layout: {
        id: nuevoLayout.idlayout,
        nombre: nuevoLayout.nombre,
        url_imagen: nuevoLayout.url_imagen,
        imagenUrl: `${req.protocol}://${req.get('host')}${urlImagen}`
      }
    });

  } catch (error) {
    console.error('❌ Error al generar layout:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno al generar layout' 
    });
  }
});

function generarSVGLayout(prompt) {
    const lower = prompt.toLowerCase();
    const diameter = 480;
    const centerX = 250, centerY = 200;
    const radius = 180;
    const chairWidth = 8, chairDepth = 10;
    const tableDiameter = 60;
    
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400">';
    svg += '<rect width="500" height="400" fill="#fafafa"/>';
    svg += '<g stroke="#e5e7eb" stroke-width="2">';
    
    // Detectar capacidad y forma
    const personCount = lower.includes('50') ? 50 : 
                       lower.includes('40') ? 40 : 
                       lower.includes('30') ? 30 : 
                       parseInt(prompt.match(/(\d+)/)?.[1] || 30);
    
    // Distribución circular
    const angularStep = (2 * Math.PI) / personCount;
    const innerRadius = radius - 40; // Espacio entre borde y mesas
    
    // Circulación circular (pasillo central)
    svg += '<line x1="250" y1="50" x2="250" y2="350" />';
    svg += '<line x1="50" y1="200" x2="450" y2="200" />';
    svg += '</g>';
    
    // Generar posiciones circulares para mesas y sillas
    for (let i = 0; i < personCount; i++) {
        const angle = i * angularStep - Math.PI / 2;
        const tableX = centerX + (innerRadius / 2) * Math.cos(angle);
        const tableY = centerY + (innerRadius / 2) * Math.sin(angle);
        const chairX = centerX + radius * Math.cos(angle);
        const chairY = centerY + radius * Math.sin(angle);
        
        // Mesa pequeña en posición radial
        svg += `<circle cx="${tableX}" cy="${tableY}" r="${tableDiameter/2}" fill="#1f2937"/>`;
        
        // Silla en posición circular exterior
        const chairAngle = angle + Math.PI / personCount;
        const cX = centerX + (radius - 15) * Math.cos(chairAngle);
        const cY = centerY + (radius - 15) * Math.sin(chairAngle);
        svg += `<rect x="${cX - chairWidth/2}" y="${cY - chairDepth/2}" width="${chairWidth}" height="${chairDepth}" fill="#6b7280"/>`;
    }
    
    svg += '</svg>';
    return svg;
}

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