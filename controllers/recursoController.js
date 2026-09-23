const asyncHandler = require('express-async-handler');
const { getModels } = require('../models/index.js');

// ── GENERADOR DE IMAGEN REFERENCIAL (SVG) PARA RECURSOS ─────────────────────
function escapeXmlRecurso(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generarImagenRecursoSVG(recurso = {}) {
  const nombre = String(recurso.nombre_recurso || recurso.nombre || '').toLowerCase();
  const tipo = String(recurso.recurso_tipo || '').toLowerCase();
  const cantidad = Math.max(1, parseInt(recurso.cantidad) || 1);
  const label = String(recurso.nombre_recurso || recurso.nombre || 'Recurso');

  let body = '';

  // ── Pantallas / proyectores / TV ────────────────────────────────────
  if (/pantalla|proyector|proyec|televisor|tv\b|plasma|lcd|led|monitor|screеn/.test(nombre)) {
    body = `
      <rect x="30" y="40" width="440" height="260" rx="12" fill="#1e293b"/>
      <rect x="50" y="60" width="400" height="220" rx="6" fill="#0ea5e9"/>
      <rect x="50" y="60" width="400" height="220" rx="6" fill="url(#screenShine)"/>
      <rect x="170" y="300" width="160" height="18" rx="4" fill="#475569"/>
      <rect x="220" y="318" width="60" height="60" rx="6" fill="#334155"/>
      <text x="250" y="150" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#e0f2fe">▶</text>
      <text x="250" y="360" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#475569">${escapeXmlRecurso(label)} ×${cantidad}</text>
    `;
  }
  // ── Sonido / parlantes / amplificadores ──────────────────────────────
  else if (/sonido|parlante|bafle|altavoz|amplif|caja acustica|caja acústica|subwoofer|tweed|micrófono|microfono|mic\b/.test(nombre)) {
    const n = Math.min(cantidad, 2);
    for (let i = 0; i < n; i++) {
      const x = i === 0 ? 120 : 320;
      body += `
        <rect x="${x}" y="80" width="120" height="240" rx="14" fill="#312e81"/>
        <rect x="${x + 10}" y="95" width="100" height="210" rx="10" fill="#4338ca"/>
        <circle cx="${x + 60}" cy="165" r="42" fill="#1e1b4b"/>
        <circle cx="${x + 60}" cy="165" r="30" fill="#312e81"/>
        <circle cx="${x + 60}" cy="165" r="18" fill="#4338ca"/>
        <circle cx="${x + 60}" cy="235" r="22" fill="#1e1b4b"/>
      `;
    }
    body += `<text x="250" y="370" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#475569">${escapeXmlRecurso(label)} ×${cantidad}</text>`;
  }
  // ── Sillas / butacas / pupitres ──────────────────────────────────────
  else if (/silla|butaca|asiento|pupitre|banco|sillon|sillón/.test(nombre)) {
    const n = Math.min(cantidad, 4);
    const cols = Math.ceil(Math.sqrt(n));
    const cell = 180;
    for (let i = 0; i < n; i++) {
      const cx = 90 + (i % cols) * cell;
      const cy = 170 + Math.floor(i / cols) * cell;
      body += `
        <rect x="${cx - 25}" y="${cy - 40}" width="50" height="45" rx="12" fill="#c2410c"/>
        <rect x="${cx - 30}" y="${cy + 4}" width="14" height="70" rx="4" fill="#9a3412"/>
        <rect x="${cx + 16}" y="${cy + 4}" width="14" height="70" rx="4" fill="#9a3412"/>
        <rect x="${cx - 40}" y="${cy + 26}" width="80" height="12" rx="6" fill="#9a3412"/>
      `;
    }
    body += `<text x="250" y="380" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#475569">${escapeXmlRecurso(label)} ×${cantidad}</text>`;
  }
  // ── Mesas / tablas / banquete ────────────────────────────────────────
  else if (/mesa|tabla|banquete|comedor/.test(nombre)) {
    const n = Math.min(cantidad, 2);
    for (let i = 0; i < n; i++) {
      const cy = 180 + i * 40;
      body += `
        <circle cx="250" cy="${cy}" r="110" fill="#f8fafc" stroke="#94a3b8" stroke-width="3"/>
        <circle cx="250" cy="${cy}" r="70" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="2"/>
        <rect x="240" y="${cy + 108}" width="20" height="80" rx="4" fill="#94a3b8"/>
      `;
    }
    body += `<text x="250" y="60" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#475569">${escapeXmlRecurso(label)} ×${cantidad}</text>`;
  }
  // ── Vajilla / platos / vasos / cubiertos ─────────────────────────────
  else if (/vajilla|plato|vaso|copa|taza|cubierto|servilleta|mantel/.test(nombre)) {
    const n = Math.min(cantidad, 5);
    for (let i = 0; i < n; i++) {
      const x = 80 + i * 85;
      const cy = 200 - ((i % 3) * 30);
      body += `
        <circle cx="${x}" cy="${cy}" r="34" fill="#ffffff" stroke="#f59e0b" stroke-width="3"/>
        <circle cx="${x}" cy="${cy}" r="18" fill="#fef3c7"/>
        <path d="M ${x + 18} ${cy - 40} l 18 -34 l 18 34 z" fill="#93c5fd" stroke="#60a5fa"/>
      `;
    }
    body += `<text x="250" y="360" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#475569">${escapeXmlRecurso(label)} ×${cantidad}</text>`;
  }
  // ── Otros recursos (genérico) ────────────────────────────────────────
  else {
    body = `
      <rect x="90" y="70" width="320" height="220" rx="16" fill="#f1f5f9" stroke="#94a3b8" stroke-width="3"/>
      <rect x="140" y="120" width="220" height="150" rx="10" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="2"/>
      <text x="250" y="200" text-anchor="middle" font-family="sans-serif" font-size="52" fill="#64748b">▦</text>
      <text x="250" y="330" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#334155" font-weight="bold">${escapeXmlRecurso(label)}</text>
      <text x="250" y="352" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#64748b">Cantidad: ${cantidad}</text>
    `;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400" viewBox="0 0 500 400">
  <defs>
    <linearGradient id="screenShine" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="500" height="400" fill="#ffffff"/>
  ${tipo === 'tecnologico' ? '<text x="250" y="28" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#c2410c" font-weight="bold">RECURSO TECNOLÓGICO</text>' : ''}
  ${body}
</svg>`;
  return svg;
}

const IMAGEN_RECURSO_HEADERS = {
  'Content-Type': 'image/svg+xml',
  'Cache-Control': 'public, max-age=86400',
};

const getRecursoImagen = asyncHandler(async (req, res) => {
  const models = getModels();
  const { Recurso } = models;
  const recurso = await Recurso.findByPk(req.params.id, {
    attributes: ['idrecurso', 'nombre_recurso', 'recurso_tipo', 'cantidad'],
  });
  const svg = generarImagenRecursoSVG(recurso ? recurso.toJSON() : { nombre_recurso: 'Recurso' });
  res.set(IMAGEN_RECURSO_HEADERS);
  res.send(svg);
});

const createRecurso = asyncHandler(async (req, res) => {
  console.log('📦 Body recibido:', req.body);
  const models = getModels();
  const { Recurso } = models;

  // ✅ Destructurar incluyendo 'cantidad'
  const { nombre_recurso, recurso_tipo, descripcion, habilitado, cantidad } = req.body;

  if (!nombre_recurso || !recurso_tipo) {
    res.status(400);
    throw new Error('Los campos "nombre_recurso" y "recurso_tipo" son obligatorios.');
  }

  // ✅ Validar cantidad si se envía
  if (cantidad !== undefined && (isNaN(cantidad) || cantidad < 0)) {
    res.status(400);
    throw new Error('La cantidad debe ser un número válido mayor o igual a 0.');
  }

  const nuevoRecurso = await Recurso.create({
    nombre_recurso,
    recurso_tipo,
    descripcion: descripcion || null,
    habilitado: habilitado !== undefined ? (habilitado === true || habilitado === 1 ? 1 : 0) : 1,
    cantidad: cantidad !== undefined ? parseInt(cantidad) : 1, // ✅ Valor por defecto
  });

  res.status(201).json({
    message: 'Recurso creado exitosamente',
    recurso: {
      idrecurso: nuevoRecurso.idrecurso,
      nombre_recurso: nuevoRecurso.nombre_recurso,
      recurso_tipo: nuevoRecurso.recurso_tipo,
      descripcion: nuevoRecurso.descripcion,
      habilitado: nuevoRecurso.habilitado,
      cantidad: nuevoRecurso.cantidad, // ✅ Incluir en respuesta
    },
  });
});

const getRecursos = asyncHandler(async (req, res) => {
  console.log('🔵 GET /recursos - Petición recibida');
  console.log('🔵 Headers:', req.headers.authorization);
  console.log('🔵 Query:', req.query);
  
  const models = getModels();
  const { Recurso } = models;
  
  try {
    const recursos = await Recurso.findAll({
      attributes: ['idrecurso', 'nombre_recurso', 'recurso_tipo', 'descripcion', 'habilitado', 'cantidad'],
      order: [['nombre_recurso', 'ASC']],
    });

    console.log('✅ Recursos encontrados:', recursos.length);
    
    const formatted = recursos.map(r => ({
      idrecurso: r.idrecurso,
      nombre_recurso: r.nombre_recurso,
      recurso_tipo: r.recurso_tipo,
      descripcion: r.descripcion,
      habilitado: r.habilitado,
      cantidad: r.cantidad || 0,
      imagenUrl: `/recursos/${r.idrecurso}/imagen`,
    }));

    res.json(formatted);
  } catch (error) {
    console.error('❌ Error en getRecursos:', error);
    throw error;
  }
});

// ─── ACTUALIZAR RECURSO ──────────────────────────────────────────────────────
const updateRecurso = asyncHandler(async (req, res) => {
  const models = getModels();
  const { Recurso } = models;
  const { id } = req.params;

  const recurso = await Recurso.findByPk(id);
  if (!recurso) {
    res.status(404);
    throw new Error('Recurso no encontrado.');
  }

  const { nombre_recurso, recurso_tipo, descripcion, habilitado, cantidad } = req.body;

  await recurso.update({
    nombre_recurso: nombre_recurso ?? recurso.nombre_recurso,
    recurso_tipo: recurso_tipo ?? recurso.recurso_tipo,
    descripcion: descripcion !== undefined ? descripcion : recurso.descripcion,
    habilitado: habilitado !== undefined ? (habilitado === true || habilitado === 1 ? 1 : 0) : recurso.habilitado,
    cantidad: cantidad !== undefined ? parseInt(cantidad) : recurso.cantidad, // ✅ Actualizar cantidad
  });

  res.json({
    message: 'Recurso actualizado exitosamente',
    recurso: {
      idrecurso: recurso.idrecurso,
      nombre_recurso: recurso.nombre_recurso,
      recurso_tipo: recurso.recurso_tipo,
      descripcion: recurso.descripcion,
      habilitado: recurso.habilitado,
      cantidad: recurso.cantidad, // ✅ Incluir en respuesta
    },
  });
});

// ─── DESHABILITAR RECURSO (Soft Delete) ─────────────────────────────────────
const deleteRecurso = asyncHandler(async (req, res) => {
  const models = getModels();
  const { Recurso } = models;
  const { id } = req.params;

  const recurso = await Recurso.findByPk(id);
  if (!recurso) {
    res.status(404);
    throw new Error('Recurso no encontrado.');
  }

  await recurso.update({ habilitado: 0 });
  res.json({ message: 'Recurso deshabilitado exitosamente' });
});

module.exports = {
  createRecurso,
  getRecursos,
  getRecursoImagen,
  generarImagenRecursoSVG,
  updateRecurso,
  deleteRecurso,
};