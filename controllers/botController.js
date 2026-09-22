const axios = require('axios');
const { getModels } = require('../models/index.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Op } = require('sequelize');
const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const FormData = require('form-data');
const chatBotService = require('../services/chatBotService');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Google migró de keys "standard" (AIza...) a "auth keys" (AQ.*). Ambas funcionan con la API Gemini.
const hasGeminiKey = !!GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌❌❌ GEMINI_API_KEY NO CONFIGURADA EN VARIABLES DE ENTORNO ❌❌❌');
} else {
  console.log('✅ GEMINI_API_KEY cargada:', GEMINI_API_KEY.substring(0, 10) + '...');
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || 'dummy-key');
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;

const getEventosAprobadosForBot = async (usuarioId, userRole) => {
  const models = getModels();
  const { Evento, User, Fase, Academico } = models;
  
  try {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let eventos;

    if (userRole === 'admin' || userRole === 'daf') {
      eventos = await Evento.findAll({
        where: { estado: 'aprobado' },
        attributes: { include: ['idfase'] },
        include: [{
          model: User,
          as: 'academicoCreador',
          attributes: ['nombre', 'apellidopat', 'apellidomat']
        }],
        order: [['created_at', 'DESC']]
      });
    } else {
      // Para académico: eventos propios + eventos de su facultad + eventos donde es comité
      const eventosEnComite = await models.sequelize.query(
        'SELECT idevento FROM comite WHERE idusuario = ?',
        { replacements: [usuarioId], type: models.sequelize.QueryTypes.SELECT }
      );
      const idsEventosComite = eventosEnComite.map(r => r.idevento);

      const academicoActual = await Academico.findOne({
        where: { idusuario: usuarioId },
        attributes: ['facultad_id']
      });

      let idsCreadores = [];
      if (academicoActual?.facultad_id) {
        const creadoresMismaFacultad = await Academico.findAll({
          where: { facultad_id: academicoActual.facultad_id },
          attributes: ['idusuario']
        });
        idsCreadores = creadoresMismaFacultad.map(a => a.idusuario);
      }

      const condiciones = [];
      if (idsCreadores.length > 0) {
        condiciones.push({ idacademico: { [Op.in]: idsCreadores } });
      }
      if (idsEventosComite.length > 0) {
        condiciones.push({ idevento: { [Op.in]: idsEventosComite } });
      }

      if (condiciones.length === 0) {
        return { activos: [], vencidos: [], total: 0 };
      }

      eventos = await Evento.findAll({
        where: {
          estado: 'aprobado',
          [Op.or]: condiciones
        },
        include: [{
          model: User,
          as: 'academicoCreador',
          attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat']
        }],
        order: [['created_at', 'DESC']]
      });
    }

    const activos = [];
    const vencidos = [];

    eventos.forEach(evento => {
      const fechaEvento = new Date(evento.fechaevento);
      fechaEvento.setHours(0, 0, 0, 0);
      
      const eventData = evento.get({ plain: true });
      eventData.esVencido = fechaEvento < hoy;

      if (fechaEvento >= hoy) {
        activos.push(eventData);
      } else {
        vencidos.push(eventData);
      }
    });

    return { activos, vencidos, total: eventos.length };
  } catch (error) {
    console.error('❌ Error en getEventosAprobadosForBot:', error);
    return { activos: [], vencidos: [], total: 0 };
  }
};

const getEventosNoAprobadosForBot = async (usuarioId, userRole) => {
  const models = getModels();
  const { Evento, User, Academico, Facultad } = models;

  try {
    const fechaLimite = new Date();
    fechaLimite.setMonth(fechaLimite.getMonth() - 1);

    let eventos;

    if (userRole === 'admin' || userRole === 'daf') {
      eventos = await Evento.findAll({
        where: {
          estado: 'pendiente',
          created_at: { [Op.gte]: fechaLimite }
        },
        distinct: true,
        attributes: { include: ['idfase'] },
        include: [{
          model: User,
          as: 'academicoCreador',
          attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat'],
          include: [{
            model: Academico,
            as: 'academico',
            attributes: ['facultad_id'],
            include: [{
              model: Facultad,
              as: 'facultad',
              attributes: ['nombre_facultad']
            }]
          }]
        }],
        order: [['created_at', 'DESC']]
      });
    } else {
      const academicoLogueado = await Academico.findOne({
        where: { idusuario: usuarioId },
        attributes: ['facultad_id']
      });
      if (!academicoLogueado) return [];

      eventos = await Evento.findAll({
        where: {
          estado: 'pendiente',
          created_at: { [Op.gte]: fechaLimite }
        },
        subQuery: false,
        include: [{
          model: User,
          as: 'academicoCreador',
          attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat'],
          required: true,
          include: [{
            model: Academico,
            as: 'academico',
            attributes: ['facultad_id'],
            where: { facultad_id: academicoLogueado.facultad_id },
            required: true,
            include: [{
              model: Facultad,
              as: 'facultad',
              attributes: ['nombre_facultad']
            }]
          }]
        }],
        order: [['created_at', 'DESC']]
      });
    }

    return eventos.map(event => event.get({ plain: true }));
  } catch (error) {
    console.error('❌ Error en getEventosNoAprobadosForBot:', error);
    return [];
  }
};

const getEventosRechazadosForBot = async (usuarioId, userRole) => {
  const models = getModels();
  const { Evento, User, Academico, Facultad } = models;

  try {
    let eventos;

    if (userRole === 'admin' || userRole === 'daf') {
      eventos = await Evento.findAll({
        where: { estado: 'rechazado' },
        distinct: true,
        attributes: { include: ['idfase', 'razon_rechazo', 'fecha_rechazo'] },
        include: [{
          model: User,
          as: 'academicoCreador',
          attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat', 'email'],
          include: [{
            model: Academico,
            as: 'academico',
            attributes: ['facultad_id'],
            include: [{
              model: Facultad,
              as: 'facultad',
              attributes: ['nombre_facultad']
            }]
          }]
        }],
        order: [['fecha_rechazo', 'DESC']]
      });
    } else {
      eventos = await Evento.findAll({
        where: {
          estado: 'rechazado',
          idacademico: usuarioId
        },
        distinct: true,
        attributes: { include: ['idfase', 'razon_rechazo', 'fecha_rechazo'] },
        include: [{
          model: User,
          as: 'academicoCreador',
          attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat']
        }],
        order: [['fecha_rechazo', 'DESC']]
      });
    }

    return eventos.map(event => event.get({ plain: true }));
  } catch (error) {
    console.error('❌ Error en getEventosRechazadosForBot:', error);
    return [];
  }
};


const formatearEventoAprobado = (evento, index) => {
  const fecha = new Date(evento.fechaevento).toLocaleDateString('es-ES');
  const creador = evento.academicoCreador;
  const organizador = creador 
    ? `${creador.nombre || ''} ${creador.apellidopat || ''}`.trim() 
    : 'Sin organizador';
  
  return `<b>${index + 1}. ${evento.nombreevento || 'Sin título'}</b>
   🗓️ Fecha: ${fecha}
   🕐 Hora: ${evento.horaevento || 'N/A'}
   📍 Lugar: ${evento.lugarevento || 'Sin ubicación'}
   👤 Organizador: ${organizador}
   ✅ Estado: Aprobado`;
};

const formatearEventoPendiente = (evento, index) => {
  const fecha = new Date(evento.fechaevento).toLocaleDateString('es-ES');
  const creador = evento.academicoCreador;
  const organizador = creador 
    ? `${creador.nombre || ''} ${creador.apellidopat || ''}`.trim() 
    : 'Sin organizador';
  const facultad = creador?.academico?.facultad?.nombre_facultad || 'Sin facultad';
  
  return `<b>${index + 1}. ${evento.nombreevento || 'Sin título'}</b>
   🗓️ Fecha: ${fecha}
   🕐 Hora: ${evento.horaevento || 'N/A'}
   📍 Lugar: ${evento.lugarevento || 'Sin ubicación'}
   👤 Organizador: ${organizador}
   🏫 Facultad: ${facultad}
   ⏳ Estado: Pendiente de aprobación`;
};

const formatearEventoRechazado = (evento, index) => {
  const fecha = new Date(evento.fechaevento).toLocaleDateString('es-ES');
  const fechaRechazo = evento.fecha_rechazo 
    ? new Date(evento.fecha_rechazo).toLocaleDateString('es-ES') 
    : 'N/A';
  const creador = evento.academicoCreador;
  const organizador = creador 
    ? `${creador.nombre || ''} ${creador.apellidopat || ''}`.trim() 
    : 'Sin organizador';
  
  let mensaje = `<b>${index + 1}. ${evento.nombreevento || 'Sin título'}</b>
   🗓️ Fecha: ${fecha}
   📍 Lugar: ${evento.lugarevento || 'Sin ubicación'}
   👤 Organizador: ${organizador}
   ❌ Estado: Rechazado
   📅 Fecha de rechazo: ${fechaRechazo}`;
  
  if (evento.razon_rechazo) {
    mensaje += `\n   💬 Motivo: ${evento.razon_rechazo}`;
  }
  
  return mensaje;
};

async function generarPDFEvento(evento, usuario) {
  // 🖼️ Pre-descargar imagen del layout (si existe) para incrustarla en el PDF
  let layoutImageBuffer = null;
  const layoutData = evento.Layout || evento.layout || null;
  if (layoutData && layoutData.url_imagen) {
    try {
      const base = process.env.API_BASE_URL || 'https://unibackend-production-a0f8.up.railway.app';
      const resp = await axios.get(`${base}/uploads/${layoutData.url_imagen}`, { responseType: 'arraybuffer', timeout: 8000 });
      layoutImageBuffer = Buffer.from(resp.data);
    } catch (e) { layoutImageBuffer = null; }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = new PassThrough();
    const buffers = [];
    doc.pipe(stream);
    stream.on('data', (c) => buffers.push(c));
    stream.on('end', () => resolve(Buffer.concat(buffers)));
    stream.on('error', reject);

    // ===== HELPERS =====
    const asegurarPagina = (alto) => { if (doc.y > 780 - alto) doc.addPage(); };
    const fechaCorta = (f) => f ? new Date(f).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : 'No especificada';
    const tituloSeccion = (t) => {
      asegurarPagina(90);
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#2980b9').text(t, { underline: true });
      doc.moveDown(0.4);
      doc.font('Helvetica').fontSize(10).fillColor('#000000');
    };
    const negrita = (t, opts) => { doc.font('Helvetica-Bold').text(t, opts); doc.font('Helvetica'); };

    // Normalizar datos (mayúsculas/minúsculas de aliases)
    const recursos = evento.Recursos || evento.recursos || [];
    const comite = evento.comite || evento.Comite || [];
    const tipos = evento.tiposDeEvento || evento.TiposDeEvento || [];
    const clasif = evento.clasificacion || evento.Clasificacion || null;
    const subcat = evento.subcategoria || null;
    const resultados = Array.isArray(evento.Resultados) ? evento.Resultados[0] : (evento.Resultados || evento.resultados || null);
    const servicios = evento.serviciosContratados || evento.ServiciosContratados || [];
    const presupuesto = evento.presupuesto || evento.Presupuesto || null;
    const egresos = presupuesto?.egresos || evento.Egresos || evento.egresos || [];
    const ingresos = presupuesto?.ingresos || evento.Ingresos || evento.ingresos || [];

    // ===== ENCABEZADO =====
    doc.fontSize(24).fillColor('#E95A0C').text('UNIFRANZ', { align: 'center' });
    doc.fontSize(11).fillColor('#333333').text('Ficha Técnica del Evento', { align: 'center' });
    doc.moveDown(0.5);
    doc.strokeColor('#E95A0C').moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(1);
    doc.fontSize(16).fillColor('#1e293b').text((evento.nombreevento || 'Sin nombre').toUpperCase(), { align: 'center' });
    doc.moveDown(1);

    // ===== 1. DATOS GENERALES =====
    tituloSeccion('Datos Generales');
    doc.text(`Fecha: ${evento.fechaevento ? new Date(evento.fechaevento).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }) : 'No definida'}`);
    doc.text(`Hora: ${(evento.horaevento || 'No definida').toString().substring(0, 5)}`);
    doc.text(`Ubicación: ${evento.lugarevento || 'No definido'}`);
    doc.text(`Estado: ${(evento.estado || 'N/A').toUpperCase()}`);
    doc.text(`Responsable: ${evento.responsable_evento || 'No asignado'}`);
    if (usuario) {
      const org = [usuario.nombre, usuario.apellidopat, usuario.apellidomat].filter(Boolean).join(' ').trim();
      if (org) doc.text(`Organizador: ${org}`);
      if (usuario.academico?.facultad?.nombre_facultad) doc.text(`Facultad: ${usuario.academico.facultad.nombre_facultad}`);
    }
    doc.moveDown(0.8);

    // ===== 2. CLASIFICACIÓN ESTRATÉGICA =====
    if (clasif || subcat) {
      tituloSeccion('Clasificación Estratégica');
      const txt = [
        clasif?.nombreClasificacion || clasif?.nombreClasificacion || '',
        subcat?.nombresubcategoria || subcat?.nombreSubcategoria || subcat?.nombre_subcategoria || ''
      ].filter(Boolean).join(' - ');
      doc.text(`• ${txt || 'Sin clasificación'}`);
      doc.moveDown(0.8);
    }

    // ===== 3. TIPOS DE EVENTO =====
    if (tipos.length) {
      tituloSeccion('Tipos de Evento');
      tipos.forEach(t => doc.text(`• ${t.nombretipo || 'Tipo'}`));
      doc.moveDown(0.8);
    }

    // ===== 4. RESULTADOS ESPERADOS =====
    if (resultados && (resultados.participacion_esperada || resultados.satisfaccion_esperada || resultados.otros_resultados)) {
      tituloSeccion('Resultados Esperados');
      if (resultados.participacion_esperada) doc.text(`Participación: ${resultados.participacion_esperada}`);
      if (resultados.satisfaccion_esperada) doc.text(`Satisfacción: ${resultados.satisfaccion_esperada}`);
      if (resultados.otros_resultados) doc.text(`Otros: ${resultados.otros_resultados}`);
      doc.moveDown(0.8);
    }

    // ===== 5. RECURSOS SOLICITADOS (por categoría) =====
    if (recursos.length) {
      tituloSeccion('Recursos Solicitados');
      [['tecnologico', 'Tecnológicos'], ['mobiliario', 'Mobiliario'], ['vajilla', 'Vajilla']].forEach(([key, label]) => {
        const items = recursos.filter(r => (r.recurso_tipo || '').toLowerCase() === key);
        if (!items.length) return;
        doc.fillColor('#E95A0C'); negrita(label); doc.fillColor('#000000');
        items.forEach(r => doc.text(`• ${r.cantidad || 1} x ${r.nombre_recurso}`));
        doc.moveDown(0.3);
      });
      const otros = recursos.filter(r => !['tecnologico', 'mobiliario', 'vajilla'].includes((r.recurso_tipo || '').toLowerCase()));
      if (otros.length) {
        doc.fillColor('#E95A0C'); negrita('Otros'); doc.fillColor('#000000');
        otros.forEach(r => doc.text(`• ${r.cantidad || 1} x ${r.nombre_recurso} (${r.recurso_tipo})`));
      }
      doc.moveDown(0.8);
    }

    // ===== 6. COMITÉ DEL EVENTO =====
    if (comite.length) {
      tituloSeccion('Comité del Evento');
      comite.forEach(m => {
        asegurarPagina(40);
        const nombre = [m.nombre, m.apellidopat, m.apellidomat].filter(Boolean).join(' ');
        negrita(nombre || 'Miembro');
        doc.text(`Rol: ${m.role === 'academico' ? 'Académico' : (m.role || 'N/A')}`);
        doc.text(`Email: ${m.email || 'N/A'}`);
        doc.moveDown(0.4);
      });
      doc.moveDown(0.5);
    }

    // ===== 7. ACTIVIDADES (3 fases) =====
    const secActividades = (titulo, lista) => {
      if (!lista || !lista.length) return;
      tituloSeccion(titulo);
      lista.forEach((a, i) => {
        asegurarPagina(60);
        negrita(`${i + 1}. ${a.nombre || a.nombreActividad || 'Actividad'}`);
        doc.text(`   Responsable: ${a.responsable || 'No especificado'}`);
        doc.text(`   Inicio: ${fechaCorta(a.fecha_inicio || a.fechaInicio)} — Fin: ${fechaCorta(a.fecha_fin || a.fechaFin)}`);
        doc.moveDown(0.4);
      });
      doc.moveDown(0.5);
    };
    secActividades('Actividades Previas', evento.actividadesPrevias);
    secActividades('Actividades Durante el Evento', evento.actividadesDurante);
    secActividades('Actividades Después del Evento', evento.actividadesPost);

    // ===== 8. SERVICIOS CONTRATADOS =====
    if (servicios.length) {
      tituloSeccion('Servicios Contratados');
      servicios.forEach((s, i) => {
        asegurarPagina(60);
        negrita(`${i + 1}. ${s.nombreServicio || s.nombre || 'Servicio'}`);
        if (s.caracteristica) doc.text(`   Características: ${s.caracteristica}`);
        doc.text(`   Fecha Entrega: ${fechaCorta(s.fechaInicio || s.fecha_inicio)}`);
        if (s.observaciones) doc.text(`   Obs: ${s.observaciones}`);
        doc.moveDown(0.4);
      });
      doc.moveDown(0.5);
    }

    // ===== 9. LAYOUT DEL EVENTO (con imagen) =====
    if (layoutData) {
      tituloSeccion('Layout del Evento');
      if (layoutData.nombre) doc.text(`Nombre: ${layoutData.nombre}`);
      if (layoutImageBuffer) {
        try {
          asegurarPagina(250);
          doc.image(layoutImageBuffer, 100, doc.y, { width: 400 });
          doc.moveDown(1);
        } catch (e) { /* sin imagen */ }
      }
      doc.moveDown(0.8);
    }

    // ===== 10. PRESUPUESTO (tablas) =====
    const tablaFilas = (filas) => {
      asegurarPagina(60);
      let y = doc.y;
      doc.fontSize(9).fillColor('#666666');
      doc.text('Descripción', 50, y, { width: 220, lineBreak: false });
      doc.text('Cant.', 280, y, { width: 50, align: 'right', lineBreak: false });
      doc.text('Precio', 340, y, { width: 80, align: 'right', lineBreak: false });
      doc.text('Total', 430, y, { width: 90, align: 'right', lineBreak: false });
      doc.y = y + 14;
      doc.strokeColor('#cccccc').moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.3);
      filas.forEach(f => {
        asegurarPagina(20);
        const yy = doc.y;
        doc.fontSize(9).fillColor('#000000');
        doc.text(f.descripcion || '—', 50, yy, { width: 220, lineBreak: false });
        doc.text(String(f.cantidad || 1), 280, yy, { width: 50, align: 'right', lineBreak: false });
        doc.text(`Bs ${parseFloat(f.precio_unitario || 0).toFixed(2)}`, 340, yy, { width: 80, align: 'right', lineBreak: false });
        doc.text(`Bs ${parseFloat(f.total || 0).toFixed(2)}`, 430, yy, { width: 90, align: 'right', lineBreak: false });
        doc.y = yy + 14;
      });
      doc.fontSize(10);
      doc.moveDown(0.4);
    };

    if (presupuesto || egresos.length || ingresos.length) {
      tituloSeccion('Presupuesto del Evento');
      if (egresos.length) {
        doc.fillColor('#e74c3c'); negrita('↓ Egresos'); doc.fillColor('#000000');
        tablaFilas(egresos);
        negrita(`TOTAL EGRESOS: Bs ${(presupuesto?.total_egresos || egresos.reduce((s, e) => s + parseFloat(e.total || 0), 0)).toFixed(2)}`);
        doc.moveDown(0.4);
      }
      if (ingresos.length) {
        doc.fillColor('#27ae60'); negrita('↑ Ingresos'); doc.fillColor('#000000');
        tablaFilas(ingresos);
        negrita(`TOTAL INGRESOS: Bs ${(presupuesto?.total_ingresos || ingresos.reduce((s, i) => s + parseFloat(i.total || 0), 0)).toFixed(2)}`);
        doc.moveDown(0.4);
      }
      const balance = presupuesto?.balance ?? 0;
      doc.fillColor(balance >= 0 ? '#27ae60' : '#e74c3c');
      negrita(`BALANCE ECONÓMICO: Bs ${balance.toFixed(2)}`);
      doc.fillColor('#000000');
      doc.moveDown(1);
    }

    // ===== 11. FIRMAS OFICIALES =====
   
    // ===== PIE DE PÁGINA =====
    const pages = doc.bufferedPageCount;
    for (let i = 0; i < pages; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#999999')
        .text(`Documento generado el ${new Date().toLocaleString('es-ES')} - FLA6346`, 50, 780, { align: 'center', width: 500 });
    }

    doc.end();
  });
}

function responderPorKeywords(mensaje, eventosContexto) {
  const msg = mensaje.toLowerCase().trim();
  
  // Solo saludos básicos y ayuda - TODO lo demás va a Gemini con contexto rico
  if (/^(hola|buenas|buenos|buenas tardes|buenos dias|hey|hi)\b/.test(msg)) {
    return '¡Hola! 👋 Soy tu asistente de eventos UNIFRANZ. Tengo acceso a tus eventos reales. Pregúntame:\n• "¿Qué eventos tengo pendientes?"\n• "Muéstrame mis eventos aprobados"\n• "Resumen de mis eventos"\n• "Eventos rechazados y motivos"\n• "Crear evento"\n• "Próximos eventos"';
  }
  
  if (/\b(ayuda|comandos|qué puedes|que puedes)\b/.test(msg)) {
    return '📋 **Puedo ayudarte con:**\n• Ver tus eventos pendientes, aprobados, rechazados (con detalles reales)\n• Resumen completo con fechas, lugares, motivos\n• Crear eventos paso a paso\n• Sugerencias según tu situación\n• Reportes de eventos específicos\n\nEscribe en lenguaje natural, ej: "¿Qué tengo para la próxima semana?"';
  }

  // NO interceptar más - dejar que Gemini use el contexto rico
  return null;
}

async function askGemini(userMessage, senderInfo = 'Invitado', eventosContexto = "", history = [], options = {}) {
  console.log('🔍 [askGemini] Mensaje:', userMessage);
  
  const pedirCrearEvento = !!(options && options.pedirCrearEvento);
  const respuestaRapida = responderPorKeywords(userMessage, eventosContexto);
  if (respuestaRapida) {
    console.log('✅ [askGemini] Respuesta por keywords:', respuestaRapida.substring(0, 80));
    return respuestaRapida;
  }
  console.log('⚠️ [askGemini] Sin match en keywords, intentando Gemini...');

  const SYSTEM_PROMPT = `Eres el asistente virtual de gestión de eventos de la UNIFRANZ.
📌 REGLAS ESTRICTAS:
- Responde SOLO con la información del CONTEXTO proporcionado abajo.
- El contexto contiene TUS eventos reales con: ID, nombre, fecha, hora, lugar, descripción, motivo de rechazo.
- Si el usuario pide "pendientes", "aprobados", "rechazados" → LISTA los eventos de esa sección del contexto.
- Si pide "resumen" → USA los datos del contexto (cuentas + detalles).
- Si pide "próximos" → FILTRA eventos aprobados por fecha cercana.
- Si pregunta por evento específico → BUSCA en el contexto por nombre/ID.
- Si pide "reporte" → MUESTRA un reporte completo con: cuenta total de eventos por estado, lista de eventos aprobados, pendientes y rechazados con sus detalles, y frase de despedida amable.
- NUNCA inventes datos. Si no está en el contexto, di: "No tengo esa información en tus eventos actuales".

📋 FORMATO OBLIGATORIO DE CADA EVENTO (no omitas campos que existan en el contexto):
- NO uses encabezados tipo ### o #; usa texto plano con emojis.
• **Nombre del evento** (ID: N)
  - 📅 Fecha: día/mes/año
  - ⏰ Hora: (si existe)
  - 📍 Lugar: (si existe)
  - 📝 Descripción: (si existe)
  - 💬 Motivo: (solo en rechazados)
- Agrupa con encabezados según estado: ✅ **Aprobados** / ⏳ **Pendientes** / ❌ **Rechazados**.
- Empieza con una frase corta y amable, termina con una pregunta de ayuda.
- Responde SIEMPRE en español.

${pedirCrearEvento ? `📝 Si el usuario quiere CREAR un evento, escribe primero "¡Claro! Te ayudo a crear el evento ✍️" y luego pregunta SOLO los datos que faltan (nombre, fecha, hora, lugar) de forma breve y amable. No inventes datos.` : ''}

📊 CONTEXTO DEL SISTEMA (TUS EVENTOS REALES):
${eventosContexto || "Sin eventos registrados."}`;

  const contents = [];
  
  for (const msg of history.slice(-6)) {
    contents.push({
      role: msg.role === 'bot' ? 'model' : 'user',
      parts: [{ text: msg.parts?.[0]?.text || msg.text || '' }]
    });
  }
  
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });

  // Saltar Gemini si no hay key configurada
  if (!hasGeminiKey) {
    console.log('⏭️ [askGemini] Sin GEMINI_API_KEY configurada, usando fallback rico');
    return `📊 **Tus eventos (IA desactivada):**\n\n${eventosContexto || "Sin eventos registrados."}\n\n💡 Para activar IA: configura GEMINI_API_KEY en .env`;
  }

  // Tool para que Gemini estructure los datos cuando el usuario quiere crear un evento
  const TOOLS_CREAR = [{
    functionDeclarations: [{
      name: 'crear_evento',
      description: 'Devuelve los datos estructurados del evento que el usuario quiere crear (nombre, fecha, hora, lugar y descripción si las proporciona). Usar SOLO cuando el usuario pida crear/registrar/programar un evento y haya dado al menos el nombre.',
      parameters: {
        type: 'OBJECT',
        properties: {
          nombreevento: { type: 'string', description: 'Nombre del evento' },
          fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD si la indica' },
          hora: { type: 'string', description: 'Hora en formato HH:MM de 24 h si la indica' },
          lugar: { type: 'string', description: 'Lugar si lo indica' },
          descripcion: { type: 'string', description: 'Descripción breve si la indica' }
        },
        required: ['nombreevento']
      }
    }]
  }];

  // Los modelos más estables/confiables primero
  // Actualizados según recomendaciones de Google por deprecaciones y alta demanda
  const modelCandidates = [
    'gemini-3.1-pro-preview',
    'gemini-3.6-flash',
    'gemini-flash-latest',
  ];

  const TIMEOUT_MS = 30000;

  const construir = (modelName) => genAI.getGenerativeModel(
    {
      model: modelName,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { temperature: pedirCrearEvento ? 0.2 : 0.4 },
    },
    { timeout: TIMEOUT_MS }
  );

  const preparaContents = () => pedirCrearEvento
    ? [{ role: 'user', parts: [{ text: userMessage }] }]
    : contents;

  const ejecutar = async (modelName) => {
    const model = construir(modelName);
    const result = await model.generateContent({ contents: preparaContents(), ...(pedirCrearEvento ? { tools: TOOLS_CREAR } : {}) });
    const fns = result.response.functionCalls && result.response.functionCalls();
    if (fns && fns.length) {
      const fn = fns.find(f => f.name === 'crear_evento') || fns[0];
      return { tipo: 'crear_evento', datos: fn.args || {}, modelo: modelName };
    }
    return { tipo: 'texto', texto: result.response.text(), modelo: modelName };
  };

  // Intentos en paralelo: responde el primer modelo que lo logre.
  // Si un modelo falla o tarda, no bloquea a los demás (antes se probaban en
  // serie y cualquier 503 encadenaba hasta >1 min de espera).
  const intentar = (m) => {
    let attempts = 0;
    const maxAttempts = 3;
    
    return async () => {
      while (attempts < maxAttempts) {
        attempts++;
        try {
          return await ejecutar(m);
        } catch (e) {
          if (attempts >= maxAttempts) throw e;
          await new Promise(res => setTimeout(res, 1000 * attempts));
        }
      }
    };
  };

  try {
    const r = await Promise.any(modelCandidates.map(intentar));
    console.log(`✅ [askGemini] Modelo funcionando: ${r.modelo}`);
    return r; // { tipo: 'texto', texto } o { tipo: 'crear_evento', datos }
  } catch (err) {
    const detalles = (err && err.errors || []).map(e => (e && e.message) || '?').join(' | ');
    console.error('❌ [askGemini] Todos los modelos fallaron:', detalles || (err && err.message));
  }

  // Reintento único al modelo principal tras una breve espera (los 503/429
  // de Google son transitorios por alta demanda).
  await new Promise(res => setTimeout(res, 800));
  try {
    const primer = await ejecutar(modelCandidates[0]);
    console.log(`✅ [askGemini] Reintento funcionando: ${primer.modelo}`);
    return primer;
  } catch (err) {
    console.error(`❌ [askGemini] Reintento con ${modelCandidates[0]}:`, err.message);
    return '❌ La IA está teniendo problemas técnicos. Pero tus eventos se muestran arriba ⬆️.';
  }

  // Fallback final: usar el contexto rico que ya tenemos (sin IA)
  if (eventosContexto && eventosContexto !== "Sin eventos registrados.") {
    return `📊 **Tus eventos (modo offline - IA no disponible):**\n\n${eventosContexto}\n\n💡 La IA está temporalmente indisponible, pero aquí tienes tus datos completos.`;
  }
  
  const msgLower = userMessage.toLowerCase();
  if (msgLower.includes('hola') || msgLower.includes('buenas')) return '¡Hola! ¿En qué te ayudo? Prueba: "pendientes", "resumen", "crear evento".';
  if (msgLower.includes('gracias')) return '¡De nada! 😊 ¿Algo más en lo que ayude?';
  return 'No pude conectar con la IA. Pero tus eventos se cargan arriba ⬆️ si estás vinculado.';
}

function getMessage() {
  try { return getModels()?.Message || null; } catch { return null; }
}

// Convierte la salida de askGemini (string u objeto) a texto plano para
// canales que solo usan texto (Telegram).
const textoDeRespuesta = (r) => {
  if (r && typeof r === 'object') return r.texto || 'No pude conectar con la IA. Inténtalo de nuevo.';
  return r || '';
};

// ============================================================
// ASISTENTE GUIADO PARA CREAR EVENTOS (chat de la app y Telegram)
// Guía datos básicos y luego remite al formulario /admin/craq,
// o crea el evento directamente en BD (opts.crearDirecto).
// ============================================================
const sesionesCrearApp = new Map();

function _minutosDelDia(hora) {
  if (!hora) return null;
  const m = String(hora).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function _parseFechaEvento(texto) {
  const t = String(texto || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return null;
}

// Crea un evento básico en estado "pendiente" replicando las reglas de
// proyectoController (límite 2 eventos/día y no chocar en rango de 2 h).
async function crearEventoEnBD(models, usuarioId, datos) {
  const nombre = String(datos.nombreevento || '').trim();
  const fecha = _parseFechaEvento(datos.fechaevento);
  if (!nombre || !fecha) {
    return { ok: false, mensaje: 'Faltan el nombre y la fecha del evento (usar formato YYYY-MM-DD o DD/MM/YYYY).' };
  }

  const { Evento } = models;
  const fechaISO = fecha.slice(0, 10);
  const horaevento = datos.horaevento ? String(datos.horaevento) : null;

  try {
    const eventosDelDia = await models.sequelize.query(
      `SELECT idevento, horaevento FROM evento
       WHERE CAST(fechaevento AS DATE) = CAST(:fecha AS DATE)
         AND estado IN ('pendiente', 'aprobado')
       ORDER BY horaevento ASC`,
      { replacements: { fecha: fechaISO }, type: models.sequelize.QueryTypes.SELECT }
    );

    if (eventosDelDia.length >= 2) {
      return { ok: false, mensaje: `El día ${fechaISO} ya tiene 2 eventos programados (máximo permitido por día). Prueba con otra fecha.` };
    }

    const minNueva = _minutosDelDia(horaevento);
    const conflicto = eventosDelDia.find(e => {
      const minEx = _minutosDelDia(e.horaevento);
      return minNueva !== null && minEx !== null && Math.abs(minNueva - minEx) < 120;
    });
    if (conflicto) {
      return { ok: false, mensaje: 'Ya existe un evento pendiente o aprobado el mismo día a la misma hora (rango de 2 horas). Prueba con otra hora.' };
    }

    const nuevoEvento = await Evento.create({
      nombreevento: nombre.slice(0, 255),
      lugarevento: (datos.lugarevento || 'Por definir').toString().slice(0, 255),
      fechaevento: new Date(fecha + 'T12:00:00'),
      horaevento: horaevento,
      descripcion: datos.descripcion || null,
      idacademico: usuarioId,
      evento_externo: false,
      estado: 'pendiente',
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Asignar fase inicial (nrofase 1), igual que el formulario normal
    const Fase = models.Fase;
    if (Fase) {
      const faseMaestra = await Fase.findOne({ where: { nrofase: 1 }, attributes: ['idfase'] });
      if (faseMaestra) {
        nuevoEvento.idfase = faseMaestra.idfase;
        await nuevoEvento.save();
      }
    }

    return { ok: true, idevento: nuevoEvento.idevento, evento: nuevoEvento };
  } catch (e) {
    console.error('❌ Error al crear evento vía Telegram/I.A:', e.message);
    return { ok: false, mensaje: 'Ocurrió un error interno al guardar el evento. Inténtalo de nuevo o créalo desde la app.' };
  }
}

function _parseHoraGuia(texto) {
  const t = texto.trim().toLowerCase();
  const m24 = t.match(/^(\d{1,2})[:.](\d{2})$/);
  if (m24) {
    const h = parseInt(m24[1], 10), min = parseInt(m24[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    return null;
  }
  const m12 = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = m12[2] ? parseInt(m12[2], 10) : 0;
    const ap = m12[3];
    if (h < 1 || h > 12 || min > 59) return null;
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  return null;
}

function _parseFechaGuia(texto) {
  const t = texto.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return null;
}

function detectarIntencionCrear(t) {
  const s = (t || '').trim();
  const bajo = s.toLowerCase();
  if (!/(crear|registrar|programar|agendar|nuevo evento|nueva actividad)\b/.test(bajo)) return false;

  // Comando simple ("crear evento", "crear", "nuevo evento") → lo atiende el
  // flujo guiado paso a paso, no Gemini.
  const resto = s.replace(/^(crear evento|registrar evento|programar evento|agendar evento|nuevo evento|crear un|registrar un|programar un|agendar un|crear|registrar|programar|agendar)\b/i, '').trim();
  if (!resto) return false;
  const limpio = resto.replace(/^(un|una|el|la|evento|actividad)\b/i, '').trim();
  return limpio.length > 2;
}

async function procesarCrearGuiado(senderKey, message, opts = {}) {
  const t = (message || '').trim();
  const bajo = t.toLowerCase();
  const COMANDOS_INICIO = ['crear evento', 'nuevo evento', 'crear', 'registrar evento', 'programar evento', 'agendar evento', 'registrar', 'programar', 'agendar', 'crear un evento', 'nuevo evento'];
  const intentInicio = COMANDOS_INICIO.includes(bajo);

  if (intentInicio) {
    sesionesCrearApp.set(senderKey, { step: 'nombre', data: {} });
    return { reply: '¡Claro! Vamos a crear tu evento. ✏️ ¿Cuál es el **nombre** del evento?\n\nℹ️ Puedes cancelar en cualquier momento con el botón **✖️ Cancelar**.' };
  }

  if (/^(cancelar|cancela|cancel|salir|detener|parar)\b/i.test(t)) {
    const activa = sesionesCrearApp.has(senderKey);
    sesionesCrearApp.delete(senderKey);
    if (!activa) {
      return { reply: 'ℹ️ No tienes una creación de evento en curso.\n\nEscribe **"crear evento"** o usa el botón ➕ para empezar.' };
    }
    return { reply: '❌ Creación cancelada. Escribe "crear evento" cuando quieras intentar de nuevo.' };
  }

  const sesion = sesionesCrearApp.get(senderKey);
  if (!sesion) return null;

  const { step, data } = sesion;

  if (step === 'nombre') {
    if (t.length < 2) return { reply: '⚠️ El nombre debe tener al menos 2 caracteres. ✏️ ¿Cuál es el nombre del evento?' };
    data.nombreevento = t.slice(0, 120);
    sesion.step = 'hora';
    sesionesCrearApp.set(senderKey, sesion);
    return { reply: `✅ Nombre: **${data.nombreevento}**\n\n⏰ ¿A qué **hora** se realizará? (ej: 19:00, 15:30 o 7:30 PM)` };
  }

  if (step === 'hora') {
    const hora = _parseHoraGuia(t);
    if (!hora) return { reply: '⚠️ Hora no válida. Usa formato 24h (ej: **19:00**) o 12h (ej: **7:30 PM**).' };
    data.horaevento = hora;
    sesion.step = 'fecha';
    sesionesCrearApp.set(senderKey, sesion);
    return { reply: `✅ Hora: **${hora}**\n\n📅 ¿Qué **día** se realizará? (ej: 2026-10-15 o 15/10/2026)` };
  }

  if (step === 'fecha') {
    const fecha = _parseFechaGuia(t);
    if (!fecha) return { reply: '⚠️ Fecha no válida. Usa el formato **YYYY-MM-DD** (ej: 2026-10-15) o **DD/MM/AAAA**.' };
    data.fechaevento = fecha;
    sesion.step = 'lugar';
    sesionesCrearApp.set(senderKey, sesion);
    return { reply: `✅ Fecha: **${fecha}**\n\n📍 ¿Dónde se realizará? (ej: Auditorio, Aula 310, Biblioteca...)` };
  }

  if (step === 'lugar') {
    data.lugarevento = t.slice(0, 100);
    sesionesCrearApp.delete(senderKey);

    if (opts.crearDirecto && opts.models && opts.usuarioId) {
      const r = await crearEventoEnBD(opts.models, opts.usuarioId, data);
      sesionesCrearApp.delete(senderKey);
      if (!r.ok) {
        const msg = `\n\n❌ ${r.mensaje}\n\nPuedes intentarlo con el comando /crear o "crear evento".`;
        const summary = `✅ **¡Listo!** Estos son los datos de tu evento:\n\n` +
          `📝 Nombre: **${data.nombreevento}**\n` +
          `⏰ Hora: **${data.horaevento}**\n` +
          `📅 Fecha: **${data.fechaevento}**\n` +
          `📍 Lugar: **${data.lugarevento}**\n${msg}`;
        return { reply: summary };
      }
      const params = [
        `nombreevento=${encodeURIComponent(data.nombreevento)}`,
        `selectedDate=${encodeURIComponent(data.fechaevento)}`,
        `selectedHour=${encodeURIComponent(data.horaevento.split(':')[0])}`,
        `lugarevento=${encodeURIComponent(data.lugarevento)}`
      ].join('&');
      const creado = `✅ ¡Evento creado con éxito en estado **pendiente**!\n\n📝 ${r.evento.nombreevento}\n⏰ ${r.evento.horaevento}\n📅 ${r.evento.fechaevento}\n📍 ${r.evento.lugarevento}\n🆔 ID: ${r.idevento}\n\n📲 Completa los detalles restantes (presupuesto, comité, resultados) desde la app:\n${opts.abrirFormulario || `/admin/croq?${params}`}`;
      return { reply: creado, abrirFormulario: opts.abrirFormulario || `/admin/croq?${params}` };
    }

    const params = [
      `nombreevento=${encodeURIComponent(data.nombreevento)}`,
      `selectedDate=${encodeURIComponent(data.fechaevento)}`,
      `selectedHour=${encodeURIComponent(data.horaevento.split(':')[0])}`,
      `lugarevento=${encodeURIComponent(data.lugarevento)}`
    ].join('&');
    const resumen = `✅ **¡Listo!** Estos son los datos de tu evento:\n\n` +
      `📝 Nombre: **${data.nombreevento}**\n` +
      `⏰ Hora: **${data.horaevento}**\n` +
      `📅 Fecha: **${data.fechaevento}**\n` +
      `📍 Lugar: **${data.lugarevento}**\n\n` +
      `Te llevaré al formulario para completar los detalles restantes.`;
    return { reply: resumen, abrirFormulario: `/admin/craq?${params}` };
  }

  return null;
}


const appChat = async (req, res) => {
  try {
    const models = getModels();
    const { Evento, Message, User } = models;
    const { message, sender = 'invitado', eventId, history = [] } = req.body;

    if (!message?.trim()) return res.status(400).json({ error: 'Mensaje vacío' });

    const pedirCrearEvento = detectarIntencionCrear(message);

    // ── Asistente guiado para crear evento ──
    const senderKey = String(sender || 'invitado');
    const guia = await procesarCrearGuiado(senderKey, message, opts = {});
    if (guia) {
      return res.json({ reply: guia.reply, eventId: eventId || null, abrirFormulario: guia.abrirFormulario || null });
    }

    let eventosContexto = "";
    let stats = { aprobados: 0, pendientes: 0, rechazados: 0 };
    let usuario = null;

    // Si sender es email, buscar usuario por email; si es ID numérico, buscar por idusuario
    if (sender !== 'invitado' && sender !== 'anonymous') {
      if (sender.includes('@')) {
        usuario = await User.findOne({ where: { email: sender.toLowerCase() } });
      } else {
        const senderId = parseInt(sender, 10);
        if (!isNaN(senderId)) {
          usuario = await User.findOne({ where: { idusuario: senderId } });
        }
      }
    }

    let eventoConsultado = null;

    // 1. Si viene eventId, obtener el evento consultado
    if (Evento && eventId) {
      eventoConsultado = await Evento.findByPk(eventId, {
        attributes: ['nombreevento', 'fechaevento', 'descripcion', 'lugarevento', 'estado', 'horaevento']
      });
    }

    // 2. Construir contexto en 2 partes: evento + eventos del usuario
    if (eventoConsultado) {
      eventosContexto = `🔎 **EVENTO CONSULTADO:**\n• Nombre: ${eventoConsultado.nombreevento}\n• Fecha: ${eventoConsultado.fechaevento}\n• Hora: ${eventoConsultado.horaevento || 'N/A'}\n• Lugar: ${eventoConsultado.lugarevento}\n• Estado: ${eventoConsultado.estado}\n• Descripción: ${eventoConsultado.descripcion || 'Sin descripción'}\n\n`;
    }

    // 3. Si hay usuario, añadir TODOS sus eventos
    if (Evento && usuario) {
      const [eventosPendientes, eventosAprobados, eventosRechazados] = await Promise.all([
        Evento.findAll({
          where: { estado: 'pendiente', idacademico: usuario.idusuario },
          attributes: ['idevento', 'nombreevento', 'fechaevento', 'horaevento', 'lugarevento', 'descripcion', 'created_at'],
          order: [['created_at', 'DESC']],
          limit: 10
        }),
        Evento.findAll({
          where: { estado: 'aprobado', idacademico: usuario.idusuario },
          attributes: ['idevento', 'nombreevento', 'fechaevento', 'horaevento', 'lugarevento', 'descripcion', 'created_at'],
          order: [['fechaevento', 'ASC']],
          limit: 10
        }),
        Evento.findAll({
          where: { estado: 'rechazado', idacademico: usuario.idusuario },
          attributes: ['idevento', 'nombreevento', 'fechaevento', 'horaevento', 'razon_rechazo', 'fecha_rechazo'],
          order: [['fecha_rechazo', 'DESC']],
          limit: 5
        })
      ]);

      stats = { 
        pendientes: eventosPendientes.length, 
        aprobados: eventosAprobados.length, 
        rechazados: eventosRechazados.length 
      };

      if (eventosPendientes.length > 0) {
        eventosContexto += `📋 **TUS EVENTOS PENDIENTES (${eventosPendientes.length}):**\n`;
        eventosPendientes.forEach((e, i) => {
          eventosContexto += `${i+1}. **${e.nombreevento}** (ID: ${e.idevento})\n`;
          eventosContexto += `   📅 ${new Date(e.fechaevento).toLocaleDateString('es-ES')} ⏰ ${e.horaevento || 'Sin hora'} 📍 ${e.lugarevento || 'Sin lugar'}\n`;
          if (e.descripcion) eventosContexto += `   📝 ${e.descripcion.substring(0, 150)}\n`;
          eventosContexto += `\n`;
        });
      }

      if (eventosAprobados.length > 0) {
        eventosContexto += `✅ **TUS EVENTOS APROBADOS (${eventosAprobados.length}):**\n`;
        eventosAprobados.forEach((e, i) => {
          eventosContexto += `${i+1}. **${e.nombreevento}** (ID: ${e.idevento})\n`;
          eventosContexto += `   📅 ${new Date(e.fechaevento).toLocaleDateString('es-ES')} ⏰ ${e.horaevento || 'Sin hora'} 📍 ${e.lugarevento || 'Sin lugar'}\n`;
          eventosContexto += `\n`;
        });
      }

      if (eventosRechazados.length > 0) {
        eventosContexto += `❌ **TUS EVENTOS RECHAZADOS (${eventosRechazados.length}):**\n`;
        eventosRechazados.forEach((e, i) => {
          eventosContexto += `${i+1}. **${e.nombreevento}** (ID: ${e.idevento})\n`;
          eventosContexto += `   📅 ${new Date(e.fechaevento).toLocaleDateString('es-ES')} ⏰ ${e.horaevento || 'Sin hora'}\n`;
          if (e.razon_rechazo) eventosContexto += `   💬 Motivo: ${e.razon_rechazo}\n`;
          eventosContexto += `\n`;
        });
      }

      eventosContexto += `📊 **RESUMEN DE TUS EVENTOS:** ✅ ${stats.aprobados} aprobados | ⏳ ${stats.pendientes} pendientes | ❌ ${stats.rechazados} rechazados\n`;
      eventosContexto += `👤 **Usuario:** ${usuario.nombre} ${usuario.apellidopat || ''} (${usuario.email})\n`;
      eventosContexto += `🎭 **Rol:** ${usuario.role || 'usuario'}`;
    }
    else if (Evento) {
      // Fallback global (sin usuario identificado)
      const [aprobados, pendientes, rechazados] = await Promise.all([
        Evento.count({ where: { estado: 'aprobado' } }),
        Evento.count({ where: { estado: 'pendiente' } }),
        Evento.count({ where: { estado: 'rechazado' } })
      ]);
      stats = { aprobados, pendientes, rechazados };

      const lista = await Evento.findAll({ 
        where: { estado: 'aprobado' }, 
        limit: 4, 
        attributes: ['nombreevento', 'fechaevento', 'horaevento', 'lugarevento', 'estado'] 
      });
      if (lista.length > 0) {
        eventosContexto = `Eventos aprobados:\n` + lista.map(e => 
          `- **${e.nombreevento}** 📅 ${new Date(e.fechaevento).toLocaleDateString('es-ES')} ⏰ ${e.horaevento || 'Sin hora'} 📍 ${e.lugarevento || 'Sin lugar'} [${e.estado}]`
        ).join('\n');
      }
      eventosContexto += `\n\n📊 ESTADÍSTICAS:\n✅ Aprobados: ${aprobados}\n⏳ Pendientes: ${pendientes}\n❌ Rechazados: ${rechazados}`;
    }

    let respuesta = await askGemini(message, sender, eventosContexto, history, { pedirCrearEvento });
    let abrirFormulario = null;

    // Gemini utilizó la tool "crear_evento": estructuramos la confirmación
    // y llevamos al usuario al formulario /admin/craq ya precargado.
    if (respuesta && typeof respuesta === 'object' && respuesta.tipo === 'crear_evento') {
      const datos = respuesta.datos || {};
      const nombre = datos.nombreevento || '';
      const fecha = datos.fecha || '';
      const hora = (datos.hora || '').split(':')[0];
      const lugar = datos.lugar || '';

      const params = [
        `nombreevento=${encodeURIComponent(nombre)}`,
        `selectedDate=${encodeURIComponent(fecha)}`,
        `selectedHour=${encodeURIComponent(hora)}`,
        `lugarevento=${encodeURIComponent(lugar)}`
      ].join('&');

      respuesta = `✅ **¡Perfecto! Te ayudo a crear tu evento.**\n\n` +
        `📝 Nombre: **${nombre}**\n` +
        (fecha ? `📅 Fecha: **${fecha}**\n` : '') +
        (datos.hora ? `⏰ Hora: **${datos.hora}**\n` : '') +
        (lugar ? `📍 Lugar: **${lugar}**\n` : '') +
        (datos.descripcion ? `📝 Descripción: **${datos.descripcion}**\n` : '') +
        `\n✍️ Completa los detalles restantes en el formulario y confirma tu evento.`;
      abrirFormulario = `/admin/craq?${params}`;
    } else if (respuesta && typeof respuesta === 'object' && respuesta.tipo === 'texto') {
      respuesta = respuesta.texto;
    }

    // Asegurar que respuesta sea siempre un string para Message.create
    if (respuesta && typeof respuesta !== 'string') {
      if (typeof respuesta === 'object' && respuesta.texto) {
        respuesta = respuesta.texto;
      } else {
        respuesta = String(respuesta);
      }
    }

    if (Message && sender !== 'invitado' && sender !== 'anonymous') {
      await Promise.all([
        Message.create({ 
          sender, 
          text: message, 
          role: 'user', 
          idevento: eventId || null, 
          timestamp: new Date() 
        }),
        Message.create({ 
          sender, 
          text: respuesta, 
          role: 'bot', 
          idevento: eventId || null, 
          timestamp: new Date() 
        })
      ]);
    }

    res.json({ reply: respuesta, eventId, abrirFormulario });
  } catch (error) {
    console.error('❌ Error en appChat:', error);
    res.status(500).json({ error: 'Error interno al procesar la solicitud.' });
  }
};

const getMessages = async (req, res) => {
  try {
    const { platform, externalId } = req.params;
    res.json({ platform, externalId, messages: [] });
  } catch { res.status(500).json({ error: 'Error al obtener mensajes' }); }
};

const botStatus = (req, res) => {
  res.json({ status: 'online', platform: 'gemini', timestamp: new Date().toISOString() });
};

const telegramWebhook = async (req, res) => {
  const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (WEBHOOK_SECRET) {
    const telegramSecretHeader = req.headers['x-telegram-bot-api-secret-token'];
    if (telegramSecretHeader !== WEBHOOK_SECRET) {
      console.warn('⚠️ Acceso denegado: Petición al webhook sin el secreto correcto.');
      return res.status(403).send('Forbidden');
    }
  }

  console.log('📩 [TELEGRAM] Webhook recibido');
  
  const { message, callback_query } = req.body;
  
  // 🛡️ Variables seguras para todo el código
  let chatId = null;
  let text = '';
  let isCallback = false;
  let callbackQueryId = null;

  // Caso 1: Mensaje normal de texto
  if (message && message.chat && message.text) {
    chatId = message.chat.id;
    text = message.text.trim();
  } 
  // Caso 2: Click en botón inline (callback_query)
  else if (callback_query && callback_query.message && callback_query.data) {
    chatId = callback_query.message.chat.id;
    text = callback_query.data;
    isCallback = true;
    callbackQueryId = callback_query.id;
  } 
  // Caso 3: Cualquier otra actualización de Telegram
  else {
    console.log('ℹ️ Update ignorado (no es mensaje ni botón)');
    return res.sendStatus(200);
  }

  try {
   
        if (isCallback && text.startsWith('pdf_')) {
      const idevento = text.replace('pdf_', '');
      const models = getModels();
      const { User, Evento, Academico, Facultad } = models;

      const usuario = await User.findOne({ 
        where: { telegram_chat_id: chatId.toString() } 
      });

      if (!usuario) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '❌ Tu cuenta no está vinculada.'
        });
        return res.status(200).send('OK');
      }

      // 1️⃣ Traer evento SIN clasificacion ni subcategoria (esas fallan en Sequelize)
      let evento = null;
      try {
        evento = await Evento.findOne({
          where: { idevento: idevento, idacademico: usuario.idusuario },
          include: [
            { association: 'academicoCreador' },
            { association: 'comite' },
            { association: 'Recursos' },
            { association: 'Resultados' },
            { association: 'Objetivos' },
            { association: 'tiposDeEvento' },
            { association: 'Layout' },
            { association: 'creador' }
          ]
        });
      } catch (e) {
        console.warn('⚠️ Include falló, reintentando sin asociaciones:', e.message);
        evento = await Evento.findOne({
          where: { idevento: idevento, idacademico: usuario.idusuario }
        });
      }

      if (!evento) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '❌ Evento no encontrado o no tienes permisos.'
        });
        return res.status(200).send('OK');
      }

      // 2️⃣ Normalizar nombres
      evento.dataValues.recursos = evento.dataValues.Recursos || evento.dataValues.recursos || [];
      evento.dataValues.comite = evento.dataValues.comite || evento.dataValues.Comite || [];

      // 3️⃣ CLASIFICACIÓN ESTRATÉGICA (SQL directo - columna real: "nombreClasificacion")
      try {
        if (evento.idclasificacion) {
          const [clasif] = await models.sequelize.query(
            `SELECT idclasificacion, "nombre_clasificacion" AS "nombreClasificacion" FROM clasificacion_estrategica WHERE idclasificacion = ?`,
            { replacements: [evento.idclasificacion], type: models.sequelize.QueryTypes.SELECT }
          );
          evento.dataValues.clasificacion = clasif || null;
        }
      } catch (e) { evento.dataValues.clasificacion = null; }

      // 4️⃣ SUBCATEGORÍA (SQL directo - columna real: nombresubcategoria TODO EN MINÚSCULAS)
      try {
        if (evento.idsubcategoria) {
          const [subcat] = await models.sequelize.query(
            `SELECT idsubcategoria, "nombre_subcategoria" AS "nombresubcategoria" FROM subcategoria WHERE idsubcategoria = ?`,
            { replacements: [evento.idsubcategoria], type: models.sequelize.QueryTypes.SELECT }
          );
          evento.dataValues.subcategoria = subcat || null;
        }
      } catch (e) { evento.dataValues.subcategoria = null; }

      // 5️⃣ Tipos de Evento
      try {
        const tipos = await models.sequelize.query(
          `SELECT t.idtipoevento, t.nombretipo 
           FROM evento_tipos et 
           JOIN tipos_de_evento t ON et.idtipoevento = t.idtipoevento 
           WHERE et.idevento = ?`,
          { replacements: [idevento], type: models.sequelize.QueryTypes.SELECT }
        );
        evento.dataValues.tiposDeEvento = tipos || [];
      } catch (e) { evento.dataValues.tiposDeEvento = []; }

      // 6️⃣ Resultados Esperados
      try {
        const [resultados] = await models.sequelize.query(
          `SELECT * FROM resultado WHERE idevento = ? LIMIT 1`,
          { replacements: [idevento], type: models.sequelize.QueryTypes.SELECT }
        );
        evento.dataValues.Resultados = resultados ? [resultados] : [];
      } catch (e) { evento.dataValues.Resultados = []; }

      // 7️⃣ Actividades (3 fases)
      try {
        if (models.Actividad) {
          const acts = await models.Actividad.findAll({ where: { idevento: idevento } });
          const tipo = (a) => String(a.tipo || a.tipoactividad || a.fase || '').toLowerCase();
          evento.dataValues.actividadesPrevias = acts.filter(a => tipo(a).includes('prev'));
          evento.dataValues.actividadesDurante = acts.filter(a => tipo(a).includes('dur'));
          evento.dataValues.actividadesPost = acts.filter(a => tipo(a).includes('post') || tipo(a).includes('desp'));
          if (!evento.dataValues.actividadesPrevias.length && !evento.dataValues.actividadesDurante.length && !evento.dataValues.actividadesPost.length) {
            evento.dataValues.actividadesPrevias = acts;
          }
        }
      } catch (e) { evento.dataValues.actividadesPrevias = []; }

      // 8️⃣ Servicios Contratados
      try {
        if (models.Servicio) {
          evento.dataValues.serviciosContratados = await models.Servicio.findAll({ where: { idevento: idevento } });
        }
      } catch (e) { evento.dataValues.serviciosContratados = []; }

      // 9️⃣ Layout
      try {
        if (evento.idlayout && models.Layout) {
          const layout = await models.Layout.findByPk(evento.idlayout);
          evento.dataValues.Layout = layout;
        }
      } catch (e) { evento.dataValues.Layout = null; }

      // 🔟 Presupuesto + Egresos + Ingresos
      try {
        if (models.Presupuesto) {
          const pres = await models.Presupuesto.findOne({ where: { idevento: idevento } });
          if (pres) {
            const idPres = pres.idpresupuesto || pres.id;
            if (models.Egreso) pres.dataValues.egresos = await models.Egreso.findAll({ where: { idpresupuesto: idPres } });
            if (models.Ingreso) pres.dataValues.ingresos = await models.Ingreso.findAll({ where: { idpresupuesto: idPres } });
            evento.dataValues.presupuesto = pres;
          }
        }
      } catch (e) { evento.dataValues.presupuesto = null; }

      // 📤 Generar y enviar el PDF
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `⏳ Generando PDF de: <b>${evento.nombreevento}</b>...`,
        parse_mode: 'HTML'
      });

      try {
        const usuarioConFacultad = await User.findOne({
          where: { idusuario: usuario.idusuario },
          include: [{ model: Academico, as: 'academico', include: [{ model: Facultad, as: 'facultad' }] }]
        });

        const pdfBuffer = await generarPDFEvento(evento, usuarioConFacultad);

        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('document', pdfBuffer, {
          filename: `Ficha_${evento.nombreevento.replace(/\s+/g, '_').substring(0, 30)}.pdf`,
          contentType: 'application/pdf'
        });
        form.append('caption', `📄 <b>Ficha Técnica:</b> ${evento.nombreevento}`);

        await axios.post(`${TELEGRAM_API}/sendDocument`, form, {
          headers: form.getHeaders(),
          maxBodyLength: Infinity,
          maxContentLength: Infinity
        });

        await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
          callback_query_id: callbackQueryId,
          text: '✅ PDF enviado'
        });

      } catch (error) {
        console.error('❌ Error generando/enviando PDF:', error.message);
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '⚠️ Ocurrió un error al generar el documento PDF.'
        });
      }

      return res.status(200).send('OK');
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const esEmail = emailRegex.test(text);

    if (esEmail) {
      const models = getModels();
      const { User } = models;

      const usuario = await User.findOne({ 
        where: { email: text.toLowerCase() } 
      });

      if (!usuario) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `❌ Email no encontrado: ${text}\n\nVerifica que sea tu email institucional registrado.`,
        });
        return res.status(200).send('OK');
      }

      if (usuario.telegram_chat_id && usuario.telegram_chat_id !== chatId.toString()) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '⚠️ Este email ya está vinculado con otra cuenta de Telegram.',
        });
        return res.status(200).send('OK');
      }

      await User.update(
        { 
          telegram_chat_id: chatId.toString(),
          telegram_username: message.from.username || message.from.first_name
        },
        { where: { email: text.toLowerCase() } }
      );

      const successMessage = 
`✅ <b>¡Cuenta vinculada exitosamente!</b>

Hola <b>${usuario.nombre} ${usuario.apellidopat || ''}</b>, ahora recibirás notificaciones sobre:

• ✅ Aprobación de eventos
• ❌ Rechazo de eventos (con motivo)
• ⏰ Recordatorios 3 días antes de tu evento

¡Mantente informado! 🎉`;

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: successMessage,
        parse_mode: 'HTML'
      });

      return res.status(200).send('OK');
    }

    // ============================================
    // 📋 COMANDOS
    // ============================================
    // Normalizar comando: minúsculas y sin @botusername (Telegram a veces lo anexa)
    const comando = text.toLowerCase().trim().replace(/^(\/\w+)@\w+/g, '$1');

    if (comando === '/start') {
      const welcomeMessage = 
`🤖 <b>¡Bienvenido al Bot de Eventos UNIFRANZ!</b>

Para vincular tu cuenta y recibir notificaciones, envía tu email institucional:

Ejemplo: <code>juan.perez@unifranz.edu.bo</code>

<b>Comandos disponibles:</b>
• /mis_eventos - Eventos aprobados (detallado)
• /pendientes - Eventos pendientes (detallado)
• /rechazados - Eventos rechazados (con motivos)
• /comite - Eventos donde eres comité
• /resumen - Resumen completo con estadísticas
• /ficha_pdf - Descargar ficha en PDF
• /crear - Crear un nuevo evento (asistido)
• /estado - Verificar vinculación
• /desvincular - Desvincular cuenta de Telegram
• /ayuda - Mostrar ayuda

<b>🤖 Asistente IA:</b>
También puedes escribirme en lenguaje natural:
• "Crear evento"
• "Resumen del día"
• "Qué tengo pendiente"
• "Reporte del evento X"
• "Enviar reporte por Telegram"`;

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: welcomeMessage,
        parse_mode: 'HTML'
      });

      return res.status(200).send('OK');
    }

    if (comando === '/estado') {
      const models = getModels();
      const { User } = models;

      const usuario = await User.findOne({ 
        where: { telegram_chat_id: chatId.toString() } 
      });

      if (!usuario) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '❌ Tu cuenta no está vinculada.\n\nEnvía tu email institucional para vincularla.',
        });
      } else {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ Tu cuenta está vinculada como:\n\n👤 <b>${usuario.nombre} ${usuario.apellidopat || ''}</b>\n📧 ${usuario.email}\n👑 Rol: ${usuario.role || 'usuario'}\n\nRecibirás notificaciones automáticas.`,
          parse_mode: 'HTML'
        });
      }

      return res.status(200).send('OK');
    }

    if (comando === '/mis_eventos') {
      const models = getModels();
      const { User } = models;

      const usuario = await User.findOne({ 
        where: { telegram_chat_id: chatId.toString() } 
      });

      if (!usuario) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '❌ Tu cuenta no está vinculada.\n\nEnvía tu email institucional para vincularla.',
        });
        return res.status(200).send('OK');
      }

      const { activos, vencidos, total } = await getEventosAprobadosForBot(
        usuario.idusuario, 
        usuario.role
      );

      if (total === 0) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '✅ No tienes eventos aprobados.',
        });
        return res.status(200).send('OK');
      }

      let mensajeEventos = `✅ <b>Eventos Aprobados (${total})</b>\n\n`;
      
      if (activos.length > 0) {
        mensajeEventos += `<b>📅 Próximos eventos (${activos.length}):</b>\n\n`;
        activos.slice(0, 5).forEach((evento, index) => {
          mensajeEventos += formatearEventoAprobado(evento, index) + '\n\n';
        });
      }
      
      if (vencidos.length > 0) {
        mensajeEventos += `\n<b>📜 Eventos pasados (${vencidos.length}):</b>\n\n`;
        vencidos.slice(0, 3).forEach((evento, index) => {
          mensajeEventos += formatearEventoAprobado(evento, index) + '\n\n';
        });
      }

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: mensajeEventos,
        parse_mode: 'HTML'
      });

      return res.status(200).send('OK');
    }

    if (comando === '/pendientes') {
      const models = getModels();
      const { User } = models;

      const usuario = await User.findOne({ 
        where: { telegram_chat_id: chatId.toString() } 
      });

      if (!usuario) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '❌ Tu cuenta no está vinculada.\n\nEnvía tu email institucional para vincularla.',
        });
        return res.status(200).send('OK');
      }

      const eventosPendientes = await getEventosNoAprobadosForBot(
        usuario.idusuario, 
        usuario.role
      );

      if (eventosPendientes.length === 0) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '✅ No tienes eventos pendientes de aprobación.',
        });
        return res.status(200).send('OK');
      }

      let mensajeEventos = `⏳ <b>Eventos Pendientes (${eventosPendientes.length})</b>\n\n`;
      eventosPendientes.slice(0, 5).forEach((evento, index) => {
        mensajeEventos += formatearEventoPendiente(evento, index) + '\n\n';
      });

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: mensajeEventos,
        parse_mode: 'HTML'
      });

      return res.status(200).send('OK');
    }

    if (comando === '/rechazados') {
      const models = getModels();
      const { User } = models;

      const usuario = await User.findOne({ 
        where: { telegram_chat_id: chatId.toString() } 
      });

      if (!usuario) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '❌ Tu cuenta no está vinculada.\n\nEnvía tu email institucional para vincularla.',
        });
        return res.status(200).send('OK');
      }

      const eventosRechazados = await getEventosRechazadosForBot(
        usuario.idusuario, 
        usuario.role
      );

      if (eventosRechazados.length === 0) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '✅ No tienes eventos rechazados.',
        });
        return res.status(200).send('OK');
      }

      let mensajeEventos = `❌ <b>Eventos Rechazados (${eventosRechazados.length})</b>\n\n`;
      eventosRechazados.slice(0, 5).forEach((evento, index) => {
        mensajeEventos += formatearEventoRechazado(evento, index) + '\n\n';
      });

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: mensajeEventos,
        parse_mode: 'HTML'
      });

      return res.status(200).send('OK');
    }

    if (comando === '/comite') {
      const models = getModels();
      const { User } = models;

      const usuario = await User.findOne({ 
        where: { telegram_chat_id: chatId.toString() } 
      });

      if (!usuario) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '❌ Tu cuenta no está vinculada.\n\nEnvía tu email institucional para vincularla.',
        });
        return res.status(200).send('OK');
      }

      const comites = await models.sequelize.query(
        `SELECT e.idevento, e.nombreevento, e.fechaevento, e.lugarevento, e.estado,
                u.nombre, u.apellidopat
         FROM comite c
         JOIN evento e ON c.idevento = e.idevento
         LEFT JOIN usuario u ON e.idacademico = u.idusuario
         WHERE c.idusuario = ?
         ORDER BY e.fechaevento ASC`,
        { 
          replacements: [usuario.idusuario],
          type: models.sequelize.QueryTypes.SELECT
        }
      );

      if (!comites || comites.length === 0) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '👥 No eres parte de ningún comité actualmente.',
        });
        return res.status(200).send('OK');
      }

      let mensajeEventos = `👥 <b>Eventos donde eres Comité (${comites.length})</b>\n\n`;
      comites.slice(0, 5).forEach((evento, index) => {
        const fecha = new Date(evento.fechaevento).toLocaleDateString('es-ES');
        const estadoEmoji = {
          'aprobado': '✅',
          'pendiente': '⏳',
          'rechazado': '❌',
          'cancelado': '🚫'
        }[evento.estado] || '📝';
        
        mensajeEventos += `<b>${index + 1}. ${evento.nombreevento}</b>\n`;
        mensajeEventos += `   🗓️ Fecha: ${fecha}\n`;
        mensajeEventos += `   📍 Lugar: ${evento.lugarevento || 'No definido'}\n`;
        mensajeEventos += `   ${estadoEmoji} Estado: ${evento.estado}\n\n`;
      });

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: mensajeEventos,
        parse_mode: 'HTML'
      });

      return res.status(200).send('OK');
    }

    if (comando === '/resumen') {
      const models = getModels();
      const { User } = models;

      const usuario = await User.findOne({ 
        where: { telegram_chat_id: chatId.toString() } 
      });

      if (!usuario) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '❌ Tu cuenta no está vinculada.',
        });
        return res.status(200).send('OK');
      }

      const { activos, vencidos, total: totalAprobados } = await getEventosAprobadosForBot(
        usuario.idusuario, 
        usuario.role
      );
      const eventosPendientes = await getEventosNoAprobadosForBot(usuario.idusuario, usuario.role);
      const eventosRechazados = await getEventosRechazadosForBot(usuario.idusuario, usuario.role);

      const comites = await models.sequelize.query(
        'SELECT COUNT(*) as total FROM comite WHERE idusuario = ?',
        { 
          replacements: [usuario.idusuario],
          type: models.sequelize.QueryTypes.SELECT
        }
      );
      const totalComites = comites[0]?.total || 0;

      const mensajeResumen = 
`📊 <b>Resumen de tu actividad</b>

👤 <b>${usuario.nombre} ${usuario.apellidopat || ''}</b>
📧 ${usuario.email}
👑 Rol: ${usuario.role || 'usuario'}

✅ <b>Eventos Aprobados: ${totalAprobados}</b>
   📅 Activos: ${activos.length}
   📜 Pasados: ${vencidos.length}

⏳ <b>Eventos Pendientes: ${eventosPendientes.length}</b>

❌ <b>Eventos Rechazados: ${eventosRechazados.length}</b>

👥 <b>Como Comité: ${totalComites} eventos</b>

Usa /mis_eventos, /pendientes, /rechazados o /comite para ver detalles.`;

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: mensajeResumen,
        parse_mode: 'HTML'
      });

      return res.status(200).send('OK');
    }

    if (comando === '/ayuda') {
      const helpMessage = 
`📚 <b>Comandos disponibles:</b>

<b>Vinculación:</b>
• /start - Bienvenida
• /estado - Verificar vinculación
• /desvincular - Desvincular cuenta de Telegram
• Enviar email - Vincular cuenta

<b>Eventos:</b>
• /mis_eventos - Eventos aprobados (detallado)
• /pendientes - Eventos pendientes (detallado)
• /rechazados - Eventos rechazados (con motivos)
• /comite - Eventos donde eres comité
• /resumen - Resumen completo con estadísticas
• /ficha_pdf - Descargar ficha en PDF
• /crear - Crear un nuevo evento (asistido)

<b>🤖 Asistente IA (escribe libremente):</b>
• "Resumen del día" — Tu resumen rápido
• "Qué tengo pendiente" — Eventos esperando
• "Eventos cercanos" — Próximos 7 días
• "Sugerencias" — Qué deberías hacer
• "Reporte del evento X" — Reporte completo
• "Eventos cerrados" — Historial
• "Enviar reporte por Telegram"

<b>Otros:</b>
• /ayuda - Mostrar esta ayuda`;

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: helpMessage,
        parse_mode: 'HTML'
      });

      return res.status(200).send('OK');
    }

    // 📄 SELECCIONAR EVENTO PARA PDF (con botones)
    if (comando === '/ficha_pdf') {
      const models = getModels();
      const { User, Evento } = models;

      const usuario = await User.findOne({ 
        where: { telegram_chat_id: chatId.toString() } 
      });

      if (!usuario) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '❌ Tu cuenta no está vinculada.\n\nEnvía tu email institucional para vincularla.',
        });
        return res.status(200).send('OK');
      }

      // Buscamos los últimos 5 eventos del usuario
      const eventosRecientes = await Evento.findAll({
        where: { idacademico: usuario.idusuario },
        order: [['created_at', 'DESC']],
        limit: 5
      });

      if (eventosRecientes.length === 0) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '📭 No tienes eventos registrados para generar una ficha.'
        });
        return res.status(200).send('OK');
      }

      // Creamos los botones de selección
      const botones = eventosRecientes.map((evento) => {
        const fecha = new Date(evento.fechaevento).toLocaleDateString('es-ES');
        const nombreCorto = evento.nombreevento.length > 25 ? 
          evento.nombreevento.substring(0, 25) + '...' : 
          evento.nombreevento;
        
        return [{
          text: `${nombreCorto} (${fecha})`,
          callback_data: `pdf_${evento.idevento}`
        }];
      });

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: '📄 <b>Selecciona el evento para descargar en PDF:</b>',
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: botones
        }
      });

      return res.status(200).send('OK');
    }

    if (comando === '/desvincular') {
      const models = getModels();
      const { User } = models;

      console.log(`🔓 [TELEGRAM] Comando /desvincular recibido de chat_id: ${chatId}`);

      const usuario = await User.findOne({ 
        where: { telegram_chat_id: chatId.toString() } 
      });

      if (!usuario) {
        console.log(`⚠️ No se encontró usuario vinculado con chat_id: ${chatId}`);
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '❌ Tu cuenta de Telegram no está vinculada a ningún usuario.\n\nEnvía tu email institucional para vincularla.',
        });
        return res.status(200).send('OK');
      }

      console.log(`🔓 Desvinculando usuario: ${usuario.email} (ID: ${usuario.idusuario})`);

      await User.update(
        { 
          telegram_chat_id: null, 
          telegram_username: null 
        },
        { 
          where: { idusuario: usuario.idusuario } 
        }
      );

      console.log(`✅ Usuario ${usuario.email} desvinculado correctamente de Telegram`);

      const successMessage = 
`✅ <b>¡Cuenta desvinculada correctamente!</b>

Tu cuenta de Telegram ya no está vinculada a:
👤 <b>${usuario.nombre} ${usuario.apellidopat || ''}</b>
📧 ${usuario.email}

❌ Ya no recibirás notificaciones automáticas.

Si quieres volver a vincular tu cuenta, envía tu email institucional.`;

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: successMessage,
        parse_mode: 'HTML'
      });

      return res.status(200).send('OK');
    }

    if (comando === '/crear') {
      const models = getModels();
      const { User } = models;

      const usuario = await User.findOne({ 
        where: { telegram_chat_id: chatId.toString() } 
      });

      if (!usuario) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '❌ Tu cuenta no está vinculada.\n\nEnvía tu email institucional para vincularla.',
        });
        return res.status(200).send('OK');
      }

      const guia = await procesarCrearGuiado('tg:' + chatId, 'crear evento', { crearDirecto: true, models, usuarioId: usuario.idusuario });
      const out = guia.reply + (guia.abrirFormulario ? `\n\n📲 Completa los detalles desde la app:\n${guia.abrirFormulario}` : '');
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: out,
        parse_mode: 'Markdown',
      });

      return res.status(200).send('OK');
    }

    // ── Conversación IA (texto libre no reconocido) ──
    const models = getModels();
    const { User, Evento } = models;
    const usuario = await User.findOne({ where: { telegram_chat_id: chatId.toString() } });

    let eventosContexto = "";
    if (Evento && usuario) {
      // Obtener eventos PENDIENTES con detalles completos
      const eventosPendientes = await Evento.findAll({
        where: { estado: 'pendiente', idacademico: usuario.idusuario },
        attributes: ['idevento', 'nombreevento', 'fechaevento', 'horaevento', 'lugarevento', 'descripcion', 'created_at'],
        order: [['created_at', 'DESC']],
        limit: 10
      });

      // Obtener eventos APROBADOS con detalles completos
      const eventosAprobados = await Evento.findAll({
        where: { estado: 'aprobado', idacademico: usuario.idusuario },
        attributes: ['idevento', 'nombreevento', 'fechaevento', 'horaevento', 'lugarevento', 'descripcion', 'created_at'],
        order: [['fechaevento', 'ASC']],
        limit: 10
      });

      // Obtener eventos RECHAZADOS con motivos
      const eventosRechazados = await Evento.findAll({
        where: { estado: 'rechazado', idacademico: usuario.idusuario },
        attributes: ['idevento', 'nombreevento', 'fechaevento', 'razon_rechazo', 'fecha_rechazo'],
        order: [['fecha_rechazo', 'DESC']],
        limit: 5
      });

      const stats = {
        pendientes: eventosPendientes.length,
        aprobados: eventosAprobados.length,
        rechazados: eventosRechazados.length
      };

      // Construir contexto detallado para la IA
      if (eventosPendientes.length > 0) {
        eventosContexto += `📋 **EVENTOS PENDIENTES (${eventosPendientes.length}):**\n`;
        eventosPendientes.forEach((e, i) => {
          eventosContexto += `${i+1}. **${e.nombreevento}** (ID: ${e.idevento})\n`;
          eventosContexto += `   📅 ${new Date(e.fechaevento).toLocaleDateString('es-ES')} ⏰ ${e.horaevento || 'Sin hora'} 📍 ${e.lugarevento || 'Sin lugar'}\n`;
          if (e.descripcion) eventosContexto += `   📝 ${e.descripcion.substring(0, 150)}\n`;
          eventosContexto += `\n`;
        });
      }

      if (eventosAprobados.length > 0) {
        eventosContexto += `✅ **EVENTOS APROBADOS (${eventosAprobados.length}):**\n`;
        eventosAprobados.forEach((e, i) => {
          eventosContexto += `${i+1}. **${e.nombreevento}** (ID: ${e.idevento})\n`;
          eventosContexto += `   📅 ${new Date(e.fechaevento).toLocaleDateString('es-ES')} ⏰ ${e.horaevento || 'Sin hora'} 📍 ${e.lugarevento || 'Sin lugar'}\n`;
          eventosContexto += `\n`;
        });
      }

      if (eventosRechazados.length > 0) {
        eventosContexto += `❌ **EVENTOS RECHAZADOS (${eventosRechazados.length}):**\n`;
        eventosRechazados.forEach((e, i) => {
          eventosContexto += `${i+1}. **${e.nombreevento}** (ID: ${e.idevento})\n`;
          eventosContexto += `   📅 ${new Date(e.fechaevento).toLocaleDateString('es-ES')}\n`;
          if (e.razon_rechazo) eventosContexto += `   💬 Motivo: ${e.razon_rechazo}\n`;
          eventosContexto += `\n`;
        });
      }

      eventosContexto += `📊 **RESUMEN:** ✅ ${stats.aprobados} | ⏳ ${stats.pendientes} | ❌ ${stats.rechazados}\n`;
eventosContexto += `👤 **Usuario:** ${usuario.nombre} ${usuario.apellidopat || ''} (${usuario.email})\n`;
      eventosContexto += `🎭 **Rol:** ${usuario.role || 'usuario'}`;
    }

    // ── Intención de crear evento por Telegram ──
    let usarGemini = true;

    if (detectarIntencionCrear(text) ||
        ['crear evento','nuevo evento','crear','registrar evento','programar evento','agendar evento','registrar','programar','agendar','crear un evento'].includes(text.toLowerCase().trim())) {
      const pedirCrear = true;
      const replyRaw = await askGemini(text, usuario?.nombre || 'Usuario', eventosContexto, [], { pedirCrearEvento: pedirCrear });
      if (replyRaw && typeof replyRaw === 'object' && replyRaw.tipo === 'crear_evento') {
        const datos = replyRaw.datos || {};
        const r = await crearEventoEnBD(models, usuario.idusuario, {
          nombreevento: datos.nombreevento,
          fechaevento: datos.fecha,
          horaevento: datos.hora,
          lugarevento: datos.lugar,
          descripcion: datos.descripcion
        });
        if (r.ok) {
          const params = [
            `nombreevento=${encodeURIComponent(datos.nombreevento || '')}`,
            `selectedDate=${encodeURIComponent(datos.fecha || '')}`,
            `selectedHour=${encodeURIComponent((datos.hora || '').split(':')[0])}`,
            `lugarevento=${encodeURIComponent(datos.lugar || '')}`
          ].join('&');
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `✅ ¡Evento creado con éxito!\n\n📝 ${datos.nombreevento || 'Sin nombre'}\n⏰ ${datos.hora || 'Sin hora'}\n📅 ${datos.fecha || 'Sin fecha'}\n📍 ${datos.lugar || 'Sin lugar'}\n🆔 ID: ${r.idevento}\n\n📲 Puedes completar detalles (presupuesto, comité, resultados) desde la app:\n${'/admin/croq?' + params}`,
            parse_mode: 'Markdown',
          });
        } else {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `❌ No pude crear el evento: ${r.mensaje}\n\nInténtalo de nuevo con "crear evento".`,
            parse_mode: 'Markdown',
          });
        }
        usarGemini = false;
      }
    }

    if (usarGemini) {
      const reply = textoDeRespuesta(await askGemini(text, usuario?.nombre || 'Usuario', eventosContexto, []));
      const finalReply = reply.length > 4000 ? reply.substring(0, 4000) + '...' : reply;

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: finalReply,
        parse_mode: 'HTML',
      });
    }
  } catch (error) {
    console.error('❌ [TELEGRAM] Error:', error.message);
    console.error('❌ Response data:', error.response?.data);
    
    if (chatId) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `❌ Ocurrió un error. Intenta nuevamente.`,
      }).catch(e => console.error('Error enviando mensaje de error:', e.message));
    }
  }
  
  res.status(200).send('OK');
};

const whatsappWebhook = async (req, res) => {
  res.status(200).json({ received: true });
};

const getChatHistory = async (req, res) => {
  try {
    const Message = getMessage();
    const { email } = req.params;
    if (!email || email === 'invitado' || !Message) return res.json({ messages: [] });
    
    const messages = await Message.findAll({
      where: { sender: email },
      order: [['timestamp', 'ASC']],
      limit: 50,
      attributes: ['id', 'text', 'role', 'timestamp'],
    });
    
    res.json({
      messages: messages.map(m => ({
        id: m.id?.toString(),
        text: m.text,
        sender: m.role === 'user' ? 'user' : 'bot',
        timestamp: m.timestamp,
      })),
    });
  } catch (error) {
    console.error('❌ getChatHistory error:', error);
    res.status(500).json({ error: 'Error al cargar el historial' });
  }
};


const enviarNotificacionTelegram = async (evento, tipo) => {
  console.log(`🔔 [TELEGRAM] Intentando enviar notificación: ${tipo} para evento ID: ${evento.idevento || evento.id}`);
  
  try {
    const models = getModels();
    const { Evento, User, Academico, Facultad } = models;

    // 1. Obtener evento completo
    const eventoCompleto = await Evento.findByPk(evento.idevento || evento.id, {
      include: [
        {
          model: User,
          as: 'academicoCreador',
          attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat', 'email', 'telegram_chat_id', 'role'],
          include: [{
            model: Academico,
            as: 'academico',
            attributes: ['facultad_id'],
            include: [{
              model: Facultad,
              as: 'facultad',
              attributes: ['nombre_facultad']
            }]
          }]
        }
      ]
    });

    if (!eventoCompleto) {
      console.log('⚠️ [TELEGRAM] Evento no encontrado en la BD.');
      return;
    }

    const idAcademico = eventoCompleto.idacademico || eventoCompleto.academicoCreador?.idusuario;
    console.log(`🔍 [TELEGRAM] ID Académico encontrado: ${idAcademico}`);
    
    if (!idAcademico) {
      console.log('⚠️ [TELEGRAM] No se encontró idacademico en el evento.');
      return;
    }

    const usuarioCreador = eventoCompleto.academicoCreador || await User.findByPk(idAcademico);

    if (!usuarioCreador) {
      console.log(`⚠️ [TELEGRAM] Usuario creador no encontrado para ID: ${idAcademico}`);
      return;
    }

    if (!usuarioCreador.telegram_chat_id) {
      console.log(`⚠️ [TELEGRAM] El usuario ${usuarioCreador.email} NO tiene telegram_chat_id vinculado.`);
      return;
    }

    console.log(`✅ [TELEGRAM] Usuario válido. Enviando a chat_id: ${usuarioCreador.telegram_chat_id}`);

    const chatId = usuarioCreador.telegram_chat_id;
    const fechaEvento = new Date(evento.fechaevento || eventoCompleto.fechaevento).toLocaleDateString('es-ES');
    const facultadNombre = usuarioCreador.academico?.facultad?.nombre_facultad || 'Sin facultad';
    
    let mensaje = '';
    
    if (tipo === 'aprobado') {
      mensaje = `✅ <b>¡EVENTO APROBADO!</b>\n\n📅 <b>${evento.nombreevento || eventoCompleto.nombreevento}</b>\n\n🗓️ Fecha: ${fechaEvento}\n📍 Lugar: ${evento.lugarevento || eventoCompleto.lugarevento}\n👤 Responsable: ${evento.responsable_evento || `${usuarioCreador.nombre} ${usuarioCreador.apellidopat || ''}`.trim()}\n🏫 Facultad: ${facultadNombre}\n\n¡Tu evento ha sido aprobado exitosamente! 🎉`;
    } else if (tipo === 'rechazado') {
      mensaje = `❌ <b>EVENTO RECHAZADO</b>\n\n📅 <b>${evento.nombreevento || eventoCompleto.nombreevento}</b>\n\n🗓️ Fecha: ${fechaEvento}\n📍 Lugar: ${evento.lugarevento || eventoCompleto.lugarevento}\n\n💬 <b>Motivo:</b>\n${evento.razon_rechazo || 'Sin motivo especificado'}\n\nRevisa los motivos y realiza las correcciones necesarias.`;
    } else if (tipo === 'nuevo') {
      mensaje = `🆕 <b>NUEVO EVENTO REGISTRADO</b>\n\n📅 <b>${evento.nombreevento || eventoCompleto.nombreevento}</b>\n\n⏳ Estado: Pendiente de aprobación`;
    }

    // Enviar a Telegram
    const response = await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: mensaje,
      parse_mode: 'HTML'
    });

    console.log(`✅ [TELEGRAM] Notificación enviada exitosamente. Status: ${response.status}`);
  } catch (error) {
    console.error('❌ [TELEGRAM] Error CRÍTICO al enviar notificación:', error.message);
    if (error.response) {
      console.error('❌ [TELEGRAM] Respuesta de la API:', error.response.data);
    }
  }
};
const enviarNotificacionCompletaTelegram = async (req, res) => {
  try {
    const { idevento } = req.body;
    if (!idevento) return res.status(400).json({ error: 'Falta idevento' });

    const models = getModels();
    const { Evento, User, Academico, Facultad } = models;

    // 1. Obtener el evento con TODA la información (igual que tu app móvil)
    const evento = await Evento.findByPk(idevento, {
      include: [
        {
          model: User,
          as: 'academicoCreador',
          attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat', 'email', 'telegram_chat_id', 'role'],
          include: [{
            model: Academico,
            as: 'academico',
            include: [{ model: Facultad, as: 'facultad', attributes: ['nombre_facultad'] }]
          }]
        }
      ]
    });

    if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

    const creador = evento.academicoCreador;
    if (!creador || !creador.telegram_chat_id) {
      return res.status(400).json({ error: 'El creador no tiene Telegram vinculado' });
    }

    const chatId = creador.telegram_chat_id;
    const fechaEvento = new Date(evento.fechaevento).toLocaleDateString('es-ES', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

    // 2. Construir mensaje enriquecido con TODOS los datos
    const facultad = creador.academico?.facultad?.nombre_facultad || 'Sin facultad';
    
    let mensaje = `🎉 <b>¡EVENTO APROBADO!</b>\n\n`;
    mensaje += `📅 <b>${evento.nombreevento}</b>\n\n`;
    mensaje += `━━━━━━━━━━━━━━━━━━━━\n`;
    mensaje += `📋 <b>DATOS GENERALES</b>\n`;
    mensaje += `🗓️ Fecha: ${fechaEvento}\n`;
    mensaje += `🕐 Hora: ${evento.horaevento || 'No definida'}\n`;
    mensaje += `📍 Lugar: ${evento.lugarevento || 'No definido'}\n`;
    mensaje += `🏫 Facultad: ${facultad}\n`;
    mensaje += `👤 Responsable: ${evento.responsable_evento || 'No asignado'}\n\n`;

    // Descripción (si existe)
    if (evento.descripcion) {
      mensaje += `━━━━━━━━━━━━━━━━━━━━\n`;
      mensaje += `📝 <b>DESCRIPCIÓN</b>\n`;
      mensaje += `${evento.descripcion.substring(0, 200)}${evento.descripcion.length > 200 ? '...' : ''}\n\n`;
    }

    // Información de actividades (si tiene)
    mensaje += `━━━━━━━━━━━━━━━━━━━━\n`;
    mensaje += `📊 <b>ESTADÍSTICAS</b>\n`;
    mensaje += `✅ Estado: <b>APROBADO</b>\n`;
    mensaje += `📄 Se adjunta ficha técnica completa en PDF con:\n`;
    mensaje += `   • Actividades detalladas\n`;
    mensaje += `   • Presupuesto completo\n`;
    mensaje += `   • Comité del evento\n`;
    mensaje += `   • Recursos solicitados\n`;
    mensaje += `   • Servicios contratados\n\n`;
    mensaje += `¡Éxito en tu evento! 🎊`;

    // 3. Enviar el mensaje de texto con toda la info
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: mensaje,
      parse_mode: 'HTML'
    });

    // 4. Generar y enviar el PDF adjunto
    try {
      const pdfBuffer = await generarPDFEvento(evento, creador);
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('document', pdfBuffer, {
        filename: `Evento_${evento.nombreevento.replace(/\s+/g, '_').substring(0, 30)}.pdf`,
        contentType: 'application/pdf'
      });
      form.append('caption', '📄 <b>Ficha Técnica Completa</b>\nDescarga el PDF con todos los detalles.');

      await axios.post(`${TELEGRAM_API}/sendDocument`, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });
    } catch (pdfError) {
      console.warn('⚠️ No se pudo adjuntar PDF:', pdfError.message);
    }

    res.json({ ok: true, message: 'Notificación completa enviada a Telegram' });
  } catch (error) {
    console.error('❌ Error enviando resumen a Telegram:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getMessages,
  telegramWebhook,
  whatsappWebhook,
  botStatus,
  enviarNotificacionTelegram,
  appChat,
  getChatHistory,
  enviarNotificacionCompletaTelegram
};