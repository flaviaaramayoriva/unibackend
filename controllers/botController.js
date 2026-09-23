const axios = require('axios');
const sharp = require('sharp');
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
  // Lee claves tanto de las propiedades de la instancia como de dataValues
  const obtener = (...claves) => {
    const buscar = (obj) => {
      if (!obj) return undefined;
      for (const c of claves) {
        if (obj[c] !== undefined && obj[c] !== null) return obj[c];
      }
      return undefined;
    };
    return buscar(evento) ?? buscar(evento?.dataValues);
  };

  // 🖼️ Pre-descargar imagen del layout (si existe) e incrustarla en el PDF
  let layoutImageBuffer = null;
  const layoutData = obtener('Layout', 'layout') || null;
  if (layoutData && layoutData.url_imagen) {
    try {
      const base = process.env.API_BASE_URL || 'https://unibackend-production-a0f8.up.railway.app';
      const urlRaw = layoutData.url_imagen;
      const urlFinal = /^https?:/i.test(urlRaw)
        ? urlRaw
        : `${base}/uploads/${urlRaw.replace(/^\/?uploads\//, '')}`;
      const resp = await axios.get(urlFinal, { responseType: 'arraybuffer', timeout: 8000 });
      let rawBuf = Buffer.from(resp.data);
      // Convertir SVG → PNG (PDFKit no renderiza SVG)
      if (String(urlRaw).toLowerCase().endsWith('.svg') || rawBuf.slice(1, 4).toString() === 'xml') {
        rawBuf = await sharp(rawBuf).png().toBuffer();
      }
      layoutImageBuffer = rawBuf;
      // Si el layout es SVG (PDFKit no lo renderiza), convertirlo a PNG ahora (en contexto async)
      const esSVG = /\.svg$/i.test(String(urlRaw)) || layoutImageBuffer.slice(1, 4).toString() === 'xml';
      if (esSVG) {
        layoutImageBuffer = await sharp(layoutImageBuffer).png().toBuffer();
      }
    } catch (e) {
      console.warn('⚠️ No se pudo descargar layout:', e.message);
      layoutImageBuffer = null;
    }
  }

  // ⚙️ Colores institucionales UNIFRANZ
  const NARANJA = '#F15A29';
  const NARANJA_OSCURO = '#D2440F';
  const AZUL = '#1c1c4b';
  const AZUL_CLARO = '#2c3e80';
  const GRIS = '#5c6b7a';
  const FONDO_SEC = '#fff3ec';
  const BORDE_CLARO = '#e8e8e8';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    let drawing = false;
    let numeroPagina = 1;
    const dibujarPie = () => {
      if (drawing) return;
      drawing = true;
      try {
        doc.save();
        doc.strokeColor('#dddddd').lineWidth(0.6).moveTo(50, 792).lineTo(545, 792).stroke();
        doc.fillColor('#999999').font('Helvetica').fontSize(8)
          .text(`Documento generado el ${new Date().toLocaleString('es-ES')} · Página ${numeroPagina} · UNIFRANZ`, 50, 793, { width: 495, align: 'center', height: 8, lineBreak: false });
        doc.y = 50;
        doc.restore();
      } finally { drawing = false; }
    };
    dibujarPie();
    doc.on('pageAdded', () => { numeroPagina++; dibujarPie(); });
    const stream = new PassThrough();
    const buffers = [];
    doc.pipe(stream);
    stream.on('data', (c) => buffers.push(c));
    stream.on('end', () => resolve(Buffer.concat(buffers)));
    stream.on('error', reject);

    // ===== HELPERS =====
    const asegurarPagina = (alto) => { if (doc.y > 780 - alto) doc.addPage(); };

    const celdaFila = (etiqueta, valor, y, alto, filaNaranja) => {
      doc.rect(50, y, 260, alto).strokeColor('#e3e3e3').lineWidth(0.6).stroke();
      doc.rect(310, y, 240, alto).strokeColor('#e3e3e3').lineWidth(0.6).stroke();
      doc.fillColor(NARANJA).font('Helvetica-Bold').fontSize(8.5)
        .text(etiqueta + ':', 56, y + 3, { width: 248, height: alto - 4, lineBreak: true });
      doc.fillColor('#222222').font('Helvetica').fontSize(9)
        .text(String(valor ?? '—'), 316, y + 3, { width: 228, height: alto - 4, lineBreak: true });
      doc.y = y + alto;
    };

    const seccionTitulo = (texto, numero) => {
      asegurarPagina(70);
      doc.moveDown(0.7);
      doc.save();
      doc.roundedRect(50, doc.y, 4, 16, 2).fill(NARANJA);
      doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(12.5)
        .text(`${numero ? numero + '. ' : ''}${texto}`, 60, doc.y);
      doc.moveDown(0.4);
      const yLinea = doc.y;
      doc.strokeColor(NARANJA).lineWidth(1.4).moveTo(50, yLinea).lineTo(550, yLinea).stroke();
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(10).fillColor('#222222');
      doc.restore();
    };

    const fechaLarga = (f) => f ? new Date(f).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
    const fechaCorta = (f) => f ? new Date(f).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : 'No especificada';
    const money = (n) => `Bs ${parseFloat(n || 0).toFixed(2)}`;
    const negrita = (t, opts) => { doc.font('Helvetica-Bold').text(t, opts); doc.font('Helvetica'); };

    // Normalizar datos (mayúsculas/minúsculas de aliases)
    const recursos = obtener('Recursos', 'recursos') || [];
    const comite = obtener('comite', 'Comite') || [];
    const tipos = obtener('tiposDeEvento', 'TiposDeEvento') || [];
    const clasif = obtener('clasificacion', 'Clasificacion') || null;
    const subcat = obtener('subcategoria') || null;
    const resArr = obtener('Resultados', 'resultados');
    const resultados = Array.isArray(resArr) ? resArr[0] : (resArr || null);
    const servicios = obtener('serviciosContratados', 'ServiciosContratados') || [];
    const presupuesto = obtener('presupuesto', 'Presupuesto') || null;
    const egresos = presupuesto?.egresos || obtener('Egresos', 'egresos') || [];
    const ingresos = presupuesto?.ingresos || obtener('Ingresos', 'ingresos') || [];

    // ===== ENCABEZADO =====
    doc.save();
    doc.rect(0, 0, 595, 110).fill(NARANJA);
    doc.roundedRect(50, 26, 8, 58, 4).fill(NARANJA);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(26).text('UNIFRANZ', 72, 32);
    doc.fillColor('#ffd9c7').font('Helvetica').fontSize(12).text('Universidad Privada Franz Tamayo', 72, 62);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(17).text('FICHA TÉCNICA DEL EVENTO', 72, 82);
    doc.restore();
    doc.moveDown(3.2);

    // Nombre del evento en destacado
    doc.fillColor(NARANJA_OSCURO).font('Helvetica-Bold').fontSize(16)
      .text((evento.nombreevento || 'Evento sin nombre').toUpperCase(), { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor(GRIS).font('Helvetica').fontSize(10)
      .text(`Evento N° ${evento.idevento || '—'}  ·  Generado el ${new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`, { align: 'center' });
    doc.moveDown(1.2);

    // ===== 1. DATOS GENERALES =====
    seccionTitulo('Datos Generales', 1);
    const org = usuario ? [usuario.nombre, usuario.apellidopat, usuario.apellidomat].filter(Boolean).join(' ').trim() : '';
    const facultad = usuario?.academico?.facultad?.nombre_facultad || '';
    const filasDatos = [
      ['Fecha', evento.fechaevento ? new Date(evento.fechaevento).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'No definida'],
      ['Hora', (evento.horaevento || 'No definida').toString().substring(0, 5)],
      ['Ubicación', evento.lugarevento || 'No definido'],
      ['Estado', (evento.estado || 'N/A').toUpperCase()],
      ['Responsable', evento.responsable_evento || 'No asignado'],
    ];
    if (org) filasDatos.push(['Organizador', org]);
    if (facultad) filasDatos.push(['Facultad', facultad]);
    filasDatos.forEach(([k, v], i) => {
      asegurarPagina(30);
      celdaFila(k, v, doc.y, 26, i % 2 === 0);
      doc.moveDown(0.25);
    });

    // Clasificación (chip)
    const txtClasif = [
      clasif?.nombreClasificacion,
      subcat?.nombresubcategoria || subcat?.nombreSubcategoria || subcat?.nombre_subcategoria || ''
    ].filter(Boolean);
    if (txtClasif.length) {
      doc.moveDown(0.3);
      filasDatos.length = 0;
      txtClasif.forEach(p => {
        asegurarPagina(20);
        doc.save();
        const ancho = doc.widthOfString(p, { font: 'Helvetica', size: 9 }) + 24;
        doc.roundedRect(50, doc.y, Math.min(ancho, 480), 18, 9).fill('#fde7db');
        doc.fillColor(NARANJA_OSCURO).font('Helvetica-Bold').fontSize(9).text(p, 62, doc.y + 5, { width: 460, height: 12, lineBreak: false });
        doc.y += 20;
        doc.restore();
      });
      doc.moveDown(0.4);
    }

    // ===== 2. TIPOS DE EVENTO =====
    if (tipos.length) {
      seccionTitulo('Tipos de Evento', 2);
      tipos.forEach(t => {
        asegurarPagina(20);
        doc.fillColor('#333333').font('Helvetica').fontSize(10).text(`• ${t.nombretipo || 'Tipo'}`, { bulletIndent: 4 });
        doc.moveDown(0.2);
      });
    }

    // ===== 3. DESCRIPCIÓN =====
    if (evento.descripcion) {
      seccionTitulo('Descripción', 3);
      doc.fillColor('#333333').font('Helvetica').fontSize(10)
        .text(evento.descripcion, { lineGap: 2 });
      doc.moveDown(0.4);
    }

    // ===== 4. RESULTADOS ESPERADOS =====
    if (resultados && (resultados.participacion_esperada || resultados.satisfaccion_esperada || resultados.otros_resultados)) {
      seccionTitulo('Resultados Esperados', 4);
      [['Participación esperada', resultados.participacion_esperada],
       ['Satisfacción esperada', resultados.satisfaccion_esperada],
       ['Otros resultados', resultados.otros_resultados]
      ].forEach(([k, v]) => {
        if (!v) return;
        asegurarPagina(30);
        celdaFila(k, v, doc.y, 26);
        doc.moveDown(0.25);
      });
    }

    // ===== 5. RECURSOS SOLICITADOS (por categoría) =====
    if (recursos.length) {
      seccionTitulo('Recursos Solicitados', 5);
      const categorias = [['tecnologico', 'Tecnológicos', '🖥️'], ['mobiliario', 'Mobiliario', '🪑'], ['vajilla', 'Vajilla', '🍽️']];
      categorias.forEach(([key, label]) => {
        const items = recursos.filter(r => (r.recurso_tipo || '').toLowerCase() === key);
        if (!items.length) return;
        asegurarPagina(30);
        doc.fillColor(NARANJA).font('Helvetica-Bold').fontSize(10).text(`${label}`);
        doc.moveDown(0.25);
        items.forEach(r => {
          asegurarPagina(20);
          doc.fillColor('#333333').font('Helvetica').fontSize(10)
            .text(`• ${r.cantidad || 1} x ${r.nombre_recurso || '—'}`);
          doc.moveDown(0.15);
        });
      });
      const otros = recursos.filter(r => !['tecnologico', 'mobiliario', 'vajilla'].includes((r.recurso_tipo || '').toLowerCase()));
      if (otros.length) {
        asegurarPagina(30);
        doc.fillColor(NARANJA).font('Helvetica-Bold').fontSize(10).text('Otros');
        doc.moveDown(0.25);
        otros.forEach(r => {
          asegurarPagina(20);
          doc.fillColor('#333333').font('Helvetica').fontSize(10)
            .text(`• ${r.cantidad || 1} x ${r.nombre_recurso || '—'}${r.recurso_tipo ? ` (${r.recurso_tipo})` : ''}`);
          doc.moveDown(0.15);
        });
      }
    }

    // ===== 6. COMITÉ DEL EVENTO =====
    if (comite.length) {
      seccionTitulo('Comité del Evento', 6);
      comite.forEach(m => {
        asegurarPagina(60);
        doc.save();
        doc.roundedRect(50, doc.y, 500, 40, 5).fill(FONDO_SEC);
        const nombre = [m.nombre, m.apellidopat, m.apellidomat].filter(Boolean).join(' ');
        doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(10)
          .text(nombre || 'Miembro', 62, doc.y + 6, { width: 476 });
        doc.fillColor(GRIS).font('Helvetica').fontSize(8.5)
          .text(`Rol: ${m.role === 'academico' ? 'Académico' : (m.role || 'N/A')}   ·   Email: ${m.email || 'N/A'}`, 62, doc.y + 20, { width: 476 });
        doc.y += 44;
        doc.restore();
        doc.moveDown(0.3);
      });
    }

    // ===== 7. ACTIVIDADES (3 fases) =====
    const secActividades = (titulo, lista, icono) => {
      if (!lista || !lista.length) return;
      asegurarPagina(60);
      seccionTitulo(titulo, 7);
      lista.forEach((a, i) => {
        asegurarPagina(60);
        doc.save();
        doc.roundedRect(50, doc.y, 500, 42, 4).fill(i % 2 === 0 ? '#fafafa' : '#ffffff');
        doc.strokeColor('#e8e8e8').lineWidth(0.7).stroke();
        doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(9.5)
          .text(`${icono} ${i + 1}. ${a.nombre || a.nombreActividad || 'Actividad'}`, 62, doc.y + 5, { width: 476 });
        doc.fillColor(GRIS).font('Helvetica').fontSize(8.5)
          .text(`Responsable: ${a.responsable || 'No especificado'}  ·  Inicio: ${fechaCorta(a.fecha_inicio || a.fechaInicio)}  ·  Fin: ${fechaCorta(a.fecha_fin || a.fechaFin)}`, 62, doc.y + 18, { width: 476 });
        doc.y += 44;
        doc.restore();
        doc.moveDown(0.3);
      });
    };
    secActividades('Actividades Previas', obtener('actividadesPrevias') || [], '🗓');
    secActividades('Actividades Durante el Evento', obtener('actividadesDurante') || [], '▶');
    secActividades('Actividades Después del Evento', obtener('actividadesPost') || [], '✔');

    // ===== 8. SERVICIOS CONTRATADOS =====
    if (servicios.length) {
      seccionTitulo('Servicios Contratados', 8);
      servicios.forEach((s, i) => {
        asegurarPagina(60);
        doc.save();
        doc.roundedRect(50, doc.y, 500, 46, 4).fill(i % 2 === 0 ? '#fafafa' : '#ffffff');
        doc.strokeColor('#e8e8e8').lineWidth(0.7).stroke();
        const nombreServ = s.nombreServicio || s.nombreservicio || s.nombre || 'Servicio';
        doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(9.5)
          .text(`🔧 ${i + 1}. ${nombreServ}`, 62, doc.y + 5, { width: 476 });
        const detalles = [];
        const car = s.caracteristica || s.caracteristicas;
        const fechaServ = s.fechaInicio || s.fecha_inicio || s.fechadeentrega;
        const obsServ = s.observaciones || s.observacion;
        if (car) detalles.push(`Características: ${car}`);
        if (fechaServ) detalles.push(`Entrega: ${fechaCorta(fechaServ)}`);
        if (obsServ) detalles.push(`Obs: ${obsServ}`);
        doc.fillColor(GRIS).font('Helvetica').fontSize(8.5)
          .text(detalles.join('  ·  ') || 'Sin detalles', 62, doc.y + 18, { width: 476 });
        doc.y += 48;
        doc.restore();
        doc.moveDown(0.3);
      });
    }

    // ===== 9. LAYOUT DEL EVENTO (con imagen) =====
    if (layoutData) {
      seccionTitulo('Layout del Evento', 9);
      if (layoutData.nombre) {
        doc.fillColor(NARANJA).font('Helvetica-Bold').fontSize(10).text(`Nombre: ${layoutData.nombre}`);
        doc.moveDown(0.5);
      }
      if (layoutImageBuffer) {
        try {
          const img = doc.image(layoutImageBuffer, 75, doc.y, { fit: [450, 300], align: 'center' });
          doc.moveDown(0.6);
        } catch (e) {
          console.warn('⚠️ No se pudo incrustar layout:', e.message);
        }
      } else {
        doc.fillColor(GRIS).font('Helvetica').fontSize(9).text('(Sin imagen de layout disponible)');
      }
    }

    // ===== 10. PRESUPUESTO (tablas) =====
    const tablaFilas = (filas, color) => {
      const colX = { d: 50, c: 300, p: 360, t: 450 };
      asegurarPagina(70);
      let y = doc.y;
      doc.fontSize(8.5).fillColor('#ffffff');
      doc.rect(50, y, 500, 16).fill(color);
      doc.text('Descripción', colX.d + 6, y + 4, { width: 240, lineBreak: false });
      doc.text('Cant.', colX.c, y + 4, { width: 55, align: 'center', lineBreak: false });
      doc.text('Precio Unit.', colX.p, y + 4, { width: 85, align: 'right', lineBreak: false });
      doc.text('Total', colX.t, y + 4, { width: 80, align: 'right', lineBreak: false });
      doc.y = y + 16;
      doc.moveDown(0.2);
      filas.forEach((f, i) => {
        asegurarPagina(20);
        const yy = doc.y;
        doc.fillColor(i % 2 === 0 ? '#f7f7f7' : '#ffffff');
        doc.rect(50, yy, 500, 16).fill();
        doc.fillColor('#333333').font('Helvetica').fontSize(8.5);
        doc.text(f.descripcion || '—', colX.d + 6, yy + 4, { width: 240, lineBreak: false });
        doc.text(String(f.cantidad || 1), colX.c, yy + 4, { width: 55, align: 'center', lineBreak: false });
        doc.text(money(f.precio_unitario), colX.p, yy + 4, { width: 85, align: 'right', lineBreak: false });
        doc.text(money(f.total), colX.t, yy + 4, { width: 80, align: 'right', lineBreak: false });
        doc.y = yy + 16;
      });
      doc.moveDown(0.3);
    };

    if (presupuesto || egresos.length || ingresos.length) {
      seccionTitulo('Presupuesto del Evento', 10);
      if (egresos.length) {
        negrita('↓ Egresos');
        doc.moveDown(0.25);
        tablaFilas(egresos, '#c0392b');
        doc.fillColor('#c0392b').font('Helvetica-Bold').fontSize(9.5)
          .text(`TOTAL EGRESOS: ${money(presupuesto?.total_egresos || egresos.reduce((s, e) => s + parseFloat(e.total || 0), 0))}`);
        doc.moveDown(0.5);
      }
      if (ingresos.length) {
        negrita('↑ Ingresos');
        doc.moveDown(0.25);
        tablaFilas(ingresos, '#1e8449');
        doc.fillColor('#1e8449').font('Helvetica-Bold').fontSize(9.5)
          .text(`TOTAL INGRESOS: ${money(presupuesto?.total_ingresos || ingresos.reduce((s, i) => s + parseFloat(i.total || 0), 0))}`);
        doc.moveDown(0.5);
      }
      const balance = presupuesto?.balance ?? 0;
      asegurarPagina(40);
      doc.save();
      doc.roundedRect(50, doc.y, 500, 28, 5).fill(balance >= 0 ? '#eafaf1' : '#fdedec');
      doc.fillColor(balance >= 0 ? '#1e8449' : '#c0392b').font('Helvetica-Bold').fontSize(11)
        .text(`BALANCE ECONÓMICO: ${money(balance)}`, 62, doc.y + 9, { width: 476 });
      doc.y += 30;
      doc.restore();
    }

    // ===== 11. FIRMAS OFICIALES =====
    doc.moveDown(1.5);
    asegurarPagina(120);
    doc.moveDown(1);
    doc.strokeColor('#999999').lineWidth(0.8);
    doc.moveTo(80, doc.y).lineTo(270, doc.y).stroke();
    doc.moveTo(330, doc.y).lineTo(520, doc.y).stroke();
    doc.moveDown(0.2);
    doc.fillColor(GRIS).font('Helvetica').fontSize(8.5);
    doc.text('Firma del Organizador', 80, doc.y, { width: 200, align: 'center' });
    doc.text('Firma de Autorización', 330, doc.y, { width: 200, align: 'center' });

    // ===== PIE DE PÁGINA con numeración =====
    const pages = doc.bufferedPageCount;
    for (let i = 0; i < pages; i++) {
      doc.switchToPage(i);
      doc.save();
      doc.strokeColor('#dddddd').lineWidth(0.6).moveTo(50, 795).lineTo(545, 795).stroke();
      doc.fillColor('#999999').font('Helvetica').fontSize(8)
        .text(`Documento generado el ${new Date().toLocaleString('es-ES')} · Página ${i + 1} de ${pages} · UNIFRANZ`, 50, 798, { align: 'center', width: 495 });
      doc.restore();
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

${pedirCrearEvento ? `📝 Si el usuario quiere CREAR un evento, escribe primero "¡Claro! Te ayudo a crear el evento ✍️" y luego pregunta SOLO los datos que faltan (nombre, fecha, hora, lugar) de forma breve y amable. No inventes datos. El lugar DEBE ser uno de estos lugares disponibles (campus o área):\n${LUGARES_PROMPT}\nNo aceptes ni sugieras otros lugares; pregunta o valida que el usuario elija uno de esos.` : ''}

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
    const r = await Promise.any(modelCandidates.map((m) => intentar(m)()));
    const modeloNombre = r?.modelo || modelCandidates[0] || 'desconocido';
    console.log(`✅ [askGemini] Modelo funcionando: ${modeloNombre}`);
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
    const modeloNombre = primer?.modelo || modelCandidates[0] || 'desconocido';
    console.log(`✅ [askGemini] Reintento funcionando: ${modeloNombre}`);
    return primer;
  } catch (err) {
    console.error(`❌ [askGemini] Reintento con ${modelCandidates[0]}:`, err.message);
    return '❌ La IA está teniendo problemas técnicas. Pero tus eventos se muestran arriba ⬆️.';
  }

  // Fallback final: usar el contexto rico que ya tenemos (sin IA)
  if (eventosContexto && eventosContexto !== "Sin eventos registrados.") {
    return `📊 **Tus eventos (modo offline - IA no disponible):**\n\n${eventosContexto}\n\n💡 La IA está temporalmente indisponible, pero aquí tienes tus datos completos.`;
  }
  
  // Si no hay contexto y el mensaje contiene "hola", saludar
  const msgLower = userMessage.toLowerCase();
  if (msgLower.startsWith('hola') || msgLower.includes(' ¡hola') || msgLower.startsWith('hola ')) {
    return '¡Hola! 👋 Soy tu asistente de eventos UNIFRANZ. Tengo acceso a tus eventos reales. Pregúntame:\n• "¿Qué eventos tengo pendientes?"\n• "Muéstrame mis eventos aprobados"\n• "Resumen de mis eventos"\n• "Eventos rechazados y motivos"\n• "Crear evento"\n• "Próximos eventos"';
  }
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

function _validarAnticipacionGuia(fechaISO) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const fecha = new Date(fechaISO); fecha.setHours(0, 0, 0, 0);
  const dias = Math.round((fecha - hoy) / 86400000);
  if (dias < 14) {
    return {
      valido: false,
      dias,
      mensaje: dias <= 0
        ? 'No puedes crear eventos en fechas pasadas o el mismo día. El evento debe crearse con al menos 2 semanas (14 días) de anticipación.'
        : `El evento debe crearse con al menos 2 semanas (14 días) de anticipación. Solo faltan ${dias} día(s) para la fecha seleccionada.`
    };
  }
  return { valido: true, dias, mensaje: '' };
}

// ── LUGARES DISPONIBLES (2 campus con sus áreas) ───────────────────────────
const LUGARES_CON_AREAS = [
  { campus: 'Campus CalaCala', areas: ['Biblioteca', 'Hall', 'Boulevard'] },
  { campus: 'Campus Central', areas: ['Auditorio', 'Jardín 1', 'Jardín 2', 'Biblioteca', 'Aula 310', 'Game Room'] },
];

const LUGARES_LISTA = (() => {
  const lista = [];
  LUGARES_CON_AREAS.forEach((c) => {
    lista.push({ valor: c.campus, etiqueta: c.campus });
    c.areas.forEach((area) => {
      const valor = `${c.campus} – ${area}`;
      lista.push({ valor, etiqueta: `${c.campus} – ${area}` });
    });
  });
  return lista;
})();

const LUGARES_PROMPT = LUGARES_LISTA.map((l, i) => `   ${i + 1}. ${l.etiqueta}`).join('\n');

function _normalizarLugarTexto(s) {
  return (s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function _parseLugarGuia(texto) {
  const tConEsp = _normalizarLugarTexto(texto);
  const t = tConEsp.replace(/\s+/g, '');
  if (!t) return null;

  const num = parseInt(t, 10);
  if (/^\d{1,2}$/.test(t) && num >= 1 && num <= LUGARES_LISTA.length) {
    return LUGARES_LISTA[num - 1].valor;
  }

  // 1) Coincidencia exacta con la etiqueta del lugar (ej: "Campus Central – Auditorio")
  const exacto = LUGARES_LISTA.find(l => _normalizarLugarTexto(l.etiqueta) === tConEsp);
  if (exacto) return exacto.valor;

  // 2) Nombre de área exacto (ej: "Biblioteca", "Aula 310", "Game Room")
  for (const c of LUGARES_CON_AREAS) {
    for (const area of c.areas) {
      if (_normalizarLugarTexto(area).replace(/\s+/g, '') === t) return `${c.campus} – ${area}`;
    }
  }

  // 3) Alias de campus (ej: "calacala", "cala cala", "campucalacala", "central", "campucentral")
  for (const c of LUGARES_CON_AREAS) {
    const cNorm = _normalizarLugarTexto(c.campus).replace(/\s+/g, '');      // campuscalacala
    const cSolo = cNorm.replace(/^campus/, '');                              // calacala / central
    // texto que combine campus + área ("campuscentraauditorio", "calacalabiblioteca")
    if (t.includes(cSolo)) {
      for (const area of c.areas) {
        if (t.includes(_normalizarLugarTexto(area).replace(/\s+/g, ''))) return `${c.campus} – ${area}`;
      }
      return c.campus;
    }
  }
  return null;
}

function _formatearLugaresInvalido(lugar) {
  return `⚠️ **"${lugar}"** no es un lugar válido. Los lugares disponibles son:\n${LUGARES_PROMPT}\n\nEscribe el **número** o el **nombre** del lugar.`;
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
    const antic = _validarAnticipacionGuia(fecha);
    if (!antic.valido) {
      return { reply: `⚠️ ${antic.mensaje}\n\n📅 Elige una fecha con al menos **2 semanas (14 días)** de anticipación (ej: con formato 2026-10-15).` };
    }
    data.fechaevento = fecha;
    sesion.step = 'lugar';
    sesionesCrearApp.set(senderKey, sesion);
    return { reply: `✅ Fecha: **${fecha}**\n\n📍 ¿En qué lugar se realizará? Los disponibles son:\n${LUGARES_PROMPT}\n\nEscribe el número (1 o 2) o el nombre del campus.` };
  }

  if (step === 'lugar') {
    const lugar = _parseLugarGuia(t);
    if (!lugar) {
      return { reply: `⚠️ Ese lugar no está disponible. Los únicos lugares son:\n${LUGARES_PROMPT}\n\nEscribe el **número** (1 o 2) o el **nombre** del campus.` };
    }
    data.lugarevento = lugar;
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
      const creado = `✅ ¡Evento creado con éxito en estado **pendiente**!\n\n📝 ${r.evento.nombreevento}\n⏰ ${r.evento.horaevento}\n📅 ${r.evento.fechaevento}\n📍 ${r.evento.lugarevento}\n🆔 ID: ${r.idevento}\n\n📲 Completa los detalles restantes (presupuesto, comité, resultados) desde la app:\n${opts.abrirFormulario || `/admin/ProyectoEvento?${params}`}`;
      return { reply: creado, abrirFormulario: opts.abrirFormulario || `/admin/ProyectoEvento?${params}` };
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
    return { reply: resumen, abrirFormulario: `/admin/ProyectoEvento?${params}` };
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
        attributes: ['idevento', 'nombreevento', 'fechaevento', 'descripcion', 'lugarevento', 'estado', 'horaevento']
      });
    }

    // ── Enviar información a Telegram (botones del asistente) ──
    const bajoMsg = (message || '').trim().toLowerCase();
    const esPedidoTelegram = /^enviar.*telegram/.test(bajoMsg) || bajoMsg === 'enviar por telegram' || /enviar (reporte|resumen|ficha).*telegram/.test(bajoMsg);
    if (esPedidoTelegram) {
      const telegramChatId = usuario?.telegram_chat_id;
      if (!usuario || !telegramChatId) {
        return res.json({ reply: '❌ No tienes Telegram vinculado.\n\nVincula tu cuenta desde el bot de Telegram enviando tu email institucional (comando /vincular) y vuelve a intentarlo.', eventId: eventId || null });
      }

      const esFicha = bajoMsg.includes('ficha');

      if (esFicha) {
        let ideventoFicha = eventId || (eventoConsultado?.idevento) || null;
        if (!ideventoFicha) {
          const ultimoBot = [...history].reverse().find(m => m.role === 'bot' && m.text);
          const matchID = ultimoBot && String(ultimoBot.text).match(/\(ID:\s*(\d+)\)/) || (ultimoBot && String(ultimoBot.text).match(/ID:\s*(\d+)/));
          ideventoFicha = matchID ? matchID[1] : null;
        }
        if (!ideventoFicha) {
          return res.json({ reply: '❌ No pude identificar el evento para enviar su ficha.\n\nPregúntale a la IA por un evento concreto y vuelve a pulsar "Enviar ficha por Telegram".', eventId: null });
        }
        const r = await enviarFichaCompletaTelegram(ideventoFicha, telegramChatId);
        if (!r.ok) {
          return res.json({ reply: `❌ ${r.mensaje}`, eventId: String(ideventoFicha) });
        }
        return res.json({
          reply: r.pdfOk
            ? `✅ Ficha completa del evento enviada a tu Telegram (incluye PDF).`
            : `⚠️ Ficha enviada a tu Telegram, pero no se pudo generar el PDF. Revisa los detalles en el chat.`,
          eventId: String(ideventoFicha)
        });
      }

      // Enviar el texto de la última respuesta del asistente
      const ultimoBot = [...history].reverse().find(m => m.role === 'bot' && m.text);
      const texto = ultimoBot ? String(ultimoBot.text).substring(0, 4000) : 'Aquí tienes la información que pediste.';
      try {
        try {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: telegramChatId,
            text: texto,
            parse_mode: 'Markdown'
          });
        } catch (e1) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: telegramChatId,
            text: texto
          });
        }
        return res.json({ reply: '✅ Información enviada a tu Telegram.', eventId: eventId || null });
      } catch (e) {
        console.error('❌ [BOT] Error enviando a Telegram:', e.message);
        return res.json({ reply: '❌ Ocurrió un error al enviar a Telegram. Verifica tu vinculación o inténtalo de nuevo.', eventId: eventId || null });
      }
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
      const lugar = _parseLugarGuia(datos.lugar || '') || (datos.lugar || '');
      const lugarValido = LUGARES_LISTA.some(l => l.valor === lugar);
      const antic = fecha ? _validarAnticipacionGuia(fecha) : { valido: true };

      if (!lugarValido) {
        respuesta = _formatearLugaresInvalido(lugar);
      } else if (!antic.valido) {
        respuesta = `⚠️ ${antic.mensaje}\n\n📅 Elige una fecha con al menos **2 semanas (14 días)** de anticipación (ej: con formato 2026-10-15).`;
      } else {
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
        abrirFormulario = `/admin/ProyectoEvento?${params}`;
      }
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
        const lugarNormalizado = _parseLugarGuia(datos.lugar || '');
        const antic = datos.fecha ? _validarAnticipacionGuia(datos.fecha) : { valido: true };
        if (datos.lugar && !LUGARES_LISTA.some(l => l.valor === datos.lugar) && datos.lugar !== lugarNormalizado) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: _formatearLugaresInvalido(datos.lugar),
            parse_mode: 'Markdown',
          });
          usarGemini = false;
        } else if (!antic.valido) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `⚠️ ${antic.mensaje}\n\n📅 Inténtalo de nuevo indicando una fecha con al menos 2 semanas (14 días) de anticipación.`,
            parse_mode: 'Markdown',
          });
          usarGemini = false;
        } else {
          const r = await crearEventoEnBD(models, usuario.idusuario, {
            nombreevento: datos.nombreevento,
            fechaevento: datos.fecha,
            horaevento: datos.hora,
            lugarevento: lugarNormalizado || datos.lugar,
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
              text: `✅ ¡Evento creado con éxito!\n\n📝 ${datos.nombreevento || 'Sin nombre'}\n⏰ ${datos.hora || 'Sin hora'}\n📅 ${datos.fecha || 'Sin fecha'}\n📍 ${datos.lugar || 'Sin lugar'}\n🆔 ID: ${r.idevento}\n\n📲 Puedes completar detalles (presupuesto, comité, resultados) desde la app:\n${'/admin/ProyectoEvento?' + params}`,
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

// Devuelve los eventos del usuario (para que el asistente pueda escoger cuál enviar a Telegram)
const getMisEventosParaSelector = async (req, res) => {
  try {
    const models = getModels();
    const { Evento, User } = models;
    const { sender } = req.params;

    if (!sender || sender === 'invitado' || sender === 'anonymous' || !Evento) {
      return res.json({ eventos: [] });
    }

    let usuario = null;
    if (sender.includes('@')) {
      usuario = await User.findOne({ where: { email: sender.toLowerCase() } });
    } else {
      const senderId = parseInt(sender, 10);
      if (!isNaN(senderId)) {
        usuario = await User.findOne({ where: { idusuario: senderId } });
      }
    }

    if (!usuario) return res.json({ eventos: [] });

    const eventos = await Evento.findAll({
      where: { idacademico: usuario.idusuario },
      attributes: ['idevento', 'nombreevento', 'fechaevento', 'horaevento', 'lugarevento', 'estado'],
      order: [['created_at', 'DESC']],
      limit: 30
    });

    res.json({
      eventos: eventos.map(e => ({
        idevento: e.idevento,
        nombreevento: e.nombreevento,
        fechaevento: e.fechaevento,
        horaevento: e.horaevento,
        lugarevento: e.lugarevento,
        estado: e.estado,
      }))
    });
  } catch (error) {
    console.error('❌ getMisEventosParaSelector error:', error);
    res.status(500).json({ error: 'Error al cargar tus eventos' });
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
// Envía la ficha completa (mensaje + PDF) de un evento a un chat de Telegram.
// Devuelve { ok, mensaje }.
const enviarFichaCompletaTelegram = async (idevento, chatId) => {
  try {
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

    if (!evento) return { ok: false, mensaje: 'Evento no encontrado' };

    const creador = evento.academicoCreador;
    if (!creador || (!creador.telegram_chat_id && !chatId)) {
      return { ok: false, mensaje: 'El creador no tiene Telegram vinculado' };
    }

    const chatObjetivo = chatId || creador.telegram_chat_id;

    // 2. Enriquecer el evento con todos los datos (mismo patrón que /ficha_pdf)
    evento.dataValues.recursos = evento.dataValues.Recursos || evento.dataValues.recursos || [];
    evento.dataValues.comite = evento.dataValues.comite || evento.dataValues.Comite || [];

    try {
      if (evento.idclasificacion) {
        const clasif = await models.sequelize.query(
          `SELECT idclasificacion, "nombre_clasificacion" AS "nombreClasificacion" FROM clasificacion_estrategica WHERE idclasificacion = ?`,
          { replacements: [evento.idclasificacion], type: models.sequelize.QueryTypes.SELECT }
        );
        evento.dataValues.clasificacion = clasif[0] || null;
      }
    } catch (e) { evento.dataValues.clasificacion = null; }

    try {
      if (evento.idsubcategoria) {
        const subcat = await models.sequelize.query(
          `SELECT idsubcategoria, "nombre_subcategoria" AS "nombresubcategoria" FROM subcategoria WHERE idsubcategoria = ?`,
          { replacements: [evento.idsubcategoria], type: models.sequelize.QueryTypes.SELECT }
        );
        evento.dataValues.subcategoria = subcat[0] || null;
      }
    } catch (e) { evento.dataValues.subcategoria = null; }

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

    try {
      const resultados = await models.sequelize.query(
        `SELECT * FROM resultado WHERE idevento = ? LIMIT 1`,
        { replacements: [idevento], type: models.sequelize.QueryTypes.SELECT }
      );
      evento.dataValues.Resultados = resultados || [];
    } catch (e) { evento.dataValues.Resultados = []; }

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

    try {
      if (models.Servicio) {
        evento.dataValues.serviciosContratados = await models.Servicio.findAll({ where: { idevento: idevento } });
      }
    } catch (e) { evento.dataValues.serviciosContratados = []; }

    try {
      if (evento.idlayout && models.Layout) {
        evento.dataValues.Layout = await models.Layout.findByPk(evento.idlayout);
      }
    } catch (e) { evento.dataValues.Layout = null; }

    try {
      if (models.Presupuesto) {
        const pres = await models.Presupuesto.findOne({ where: { idevento: idevento } });
        if (pres) {
          const idPres = pres.idpresupuesto || pres.id;
          if (models.Egreso) pres.dataValues.egresos = await models.Egreso.findAll({ where: { idpresupuesto: idPres } });
          if (models.Ingreso) pres.dataValues.ingresos = await models.Ingreso.findAll({ where: { idpresupuesto: idPres } });
          evento.dataValues.presupuesto = {
            idpresupuesto: idPres,
            total_egresos: pres.total_egresos,
            total_ingresos: pres.total_ingresos,
            balance: pres.balance,
            egresos: pres.dataValues.egresos || [],
            ingresos: pres.dataValues.ingresos || []
          };
        }
      }
    } catch (e) { evento.dataValues.presupuesto = null; }

    try {
      if (models.Comite) {
        const c = await models.Comite.findAll({
          where: { idevento: idevento },
          attributes: ['idusuario'],
          include: [{ model: User, as: 'miembroComite', attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat', 'email', 'role'] }]
        });
        evento.dataValues.comite = (c || []).map(m => m.miembroComite || m).filter(Boolean);
      }
    } catch (e) { /* comite ya cargado por asociación */ }

    try {
      if (models.EventoRecurso) {
        const er = await models.EventoRecurso.findAll({
          where: { idevento: idevento },
          include: [{ model: models.Recurso, as: 'recurso', attributes: ['idrecurso', 'nombre_recurso', 'recurso_tipo', 'descripcion'] }]
        });
        evento.dataValues.recursos = (er || []).map(x => ({
          idrecurso: x.recurso?.idrecurso,
          nombre_recurso: x.recurso?.nombre_recurso,
          recurso_tipo: x.recurso?.recurso_tipo,
          descripcion: x.recurso?.descripcion,
          cantidad: x.cantidad || 1
        })).filter(x => x.nombre_recurso);
      }
    } catch (e) { /* recursos ya cargado */ }

    try {
      const pdiRows = await models.sequelize.query(
        `SELECT "descripcion" FROM evento_pdi WHERE idevento = :idevento ORDER BY idevento_pdi ASC`,
        { replacements: { idevento }, type: models.sequelize.QueryTypes.SELECT }
      );
      evento.dataValues.ObjetivosPDI = (pdiRows || []).map(r => r.descripcion);
    } catch (e) { evento.dataValues.ObjetivosPDI = []; }

    // 3. Construir mensaje HTML enriquecido con TODAS las secciones
    const fechaEvento = new Date(evento.fechaevento).toLocaleDateString('es-ES', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    const horaEv = (evento.horaevento || '').toString().substring(0, 5) || 'No definida';
    const facultad = creador?.academico?.facultad?.nombre_facultad || 'Sin facultad';
    const org = [creador?.nombre, creador?.apellidopat, creador?.apellidomat].filter(Boolean).join(' ').trim() || 'No especificado';
    const estado = (evento.estado || 'N/A').toUpperCase();

    const secciones = [];

    secciones.push(`🎉 <b>FICHA TÉCNICA DEL EVENTO</b>\n📅 <b>${evento.nombreevento}</b>\n🆔 ID: ${evento.idevento}`);

    secciones.push(
      `━━━━━━━━━━━━━━━━━━━━\n📋 <b>DATOS GENERALES</b>\n` +
      `🗓️ Fecha: ${fechaEvento}\n` +
      `🕐 Hora: ${horaEv}\n` +
      `📍 Lugar: ${evento.lugarevento || 'No definido'}\n` +
      `🏫 Facultad: ${facultad}\n` +
      `👤 Responsable: ${evento.responsable_evento || 'No asignado'}\n` +
      `🧑‍💼 Organizador: ${org}\n` +
      `📌 Estado: <b>${estado}</b>`
    );

    const clasif = evento.dataValues.clasificacion;
    const subcat = evento.dataValues.subcategoria;
    const txtClasif = [clasif?.nombreClasificacion, subcat?.nombresubcategoria].filter(Boolean).join(' - ');
    if (txtClasif) {
      secciones.push(`━━━━━━━━━━━━━━━━━━━━\n🏷️ <b>CLASIFICACIÓN ESTRATÉGICA</b>\n${txtClasif}`);
    }

    if (evento.descripcion) {
      secciones.push(`━━━━━━━━━━━━━━━━━━━━\n📝 <b>DESCRIPCIÓN</b>\n${evento.descripcion.substring(0, 300)}${evento.descripcion.length > 300 ? '...' : ''}`);
    }

    if ((evento.dataValues.tiposDeEvento || []).length) {
      const listaTipos = evento.dataValues.tiposDeEvento.map(t => `• ${t.nombretipo}`).join('\n');
      secciones.push(`━━━━━━━━━━━━━━━━━━━━\n🎯 <b>TIPOS DE EVENTO</b>\n${listaTipos}`);
    }

    if ((evento.dataValues.ObjetivosPDI || []).length) {
      const listaPdi = evento.dataValues.ObjetivosPDI.map((p, i) => `${i + 1}. ${p}`).join('\n');
      secciones.push(`━━━━━━━━━━━━━━━━━━━━\n🎓 <b>OBJETIVOS DEL PDI</b>\n${listaPdi}`);
    }

    const resultados = evento.dataValues.Resultados?.[0];
    if (resultados && (resultados.participacion_esperada || resultados.satisfaccion_esperada || resultados.otros_resultados)) {
      let txtR = '';
      if (resultados.participacion_esperada) txtR += `👥 Participación esperada: ${resultados.participacion_esperada}\n`;
      if (resultados.satisfaccion_esperada) txtR += `😊 Satisfacción esperada: ${resultados.satisfaccion_esperada}\n`;
      if (resultados.otros_resultados) txtR += `📈 Otros: ${resultados.otros_resultados}\n`;
      if (txtR) secciones.push(`━━━━━━━━━━━━━━━━━━━━\n🎯 <b>RESULTADOS ESPERADOS</b>\n${txtR.trimEnd()}`);
    }

    if ((evento.dataValues.comite || []).length) {
      const listaComite = evento.dataValues.comite.slice(0, 8).map(m => {
        const n = [m.nombre, m.apellidopat, m.apellidomat].filter(Boolean).join(' ').trim();
        return `• ${n || 'Miembro'} (${m.role === 'academico' ? 'Académico' : (m.role || 'N/A')})`;
      }).join('\n');
      secciones.push(`━━━━━━━━━━━━━━━━━━━━\n👥 <b>COMITÉ DEL EVENTO</b>\n${listaComite}${evento.dataValues.comite.length > 8 ? `\n• y ${evento.dataValues.comite.length - 8} más...` : ''}`);
    }

    if ((evento.dataValues.recursos || []).length) {
      const listaRec = evento.dataValues.recursos.slice(0, 12).map(r => `• ${r.cantidad || 1} x ${r.nombre_recurso}${r.recurso_tipo ? ` (${r.recurso_tipo})` : ''}`).join('\n');
      secciones.push(`━━━━━━━━━━━━━━━━━━━━\n📦 <b>RECURSOS SOLICITADOS</b>\n${listaRec}${evento.dataValues.recursos.length > 12 ? `\n• y ${evento.dataValues.recursos.length - 12} más...` : ''}`);
    }

    const secAct = (titulo, lista, icono) => {
      if (!lista || !lista.length) return '';
      const items = lista.slice(0, 5).map((a, i) => {
        const ini = a.fecha_inicio || a.fechaInicio;
        const fin = a.fecha_fin || a.fechaFin;
        const fechas = ini || fin ? `  📆 ${ini ? new Date(ini).toLocaleDateString('es-ES') : '?'}${fin ? ' → ' + new Date(fin).toLocaleDateString('es-ES') : ''}` : '';
        return `${i + 1}. ${a.nombre || a.nombreActividad || 'Actividad'}\n   👤 ${a.responsable || 'No especificado'}${fechas}`;
      }).join('\n');
      return `${icono} <b>${titulo}</b>\n${items}${lista.length > 5 ? `\n… y ${lista.length - 5} más` : ''}`;
    };
    const actPrevias = secAct('ACTIVIDADES PREVIAS', evento.dataValues.actividadesPrevias, '🗓️');
    const actDurante = secAct('ACTIVIDADES DURANTE', evento.dataValues.actividadesDurante, '▶️');
    const actPost = secAct('ACTIVIDADES POST', evento.dataValues.actividadesPost, '✔️');
    if (actPrevias || actDurante || actPost) {
      secciones.push(`━━━━━━━━━━━━━━━━━━━━\n📊 <b>ACTIVIDADES</b>\n${[actPrevias, actDurante, actPost].filter(Boolean).join('\n\n')}`);
    }

    if ((evento.dataValues.serviciosContratados || []).length) {
      const listServ = evento.dataValues.serviciosContratados.slice(0, 6).map((s, i) => {
        return `${i + 1}. ${s.nombreservicio || s.nombreServicio || s.nombre || 'Servicio'}${s.fechadeentrega || s.fechaInicio ? ` — 📆 ${new Date(s.fechadeentrega || s.fechaInicio).toLocaleDateString('es-ES')}` : ''}`;
      }).join('\n');
      secciones.push(`━━━━━━━━━━━━━━━━━━━━\n🔧 <b>SERVICIOS CONTRATADOS</b>\n${listServ}${evento.dataValues.serviciosContratados.length > 6 ? `\n… y ${evento.dataValues.serviciosContratados.length - 6} más` : ''}`);
    }

    const pres = evento.dataValues.presupuesto;
    const egresos = pres?.egresos || [];
    const ingresos = pres?.ingresos || [];
    if (pres) {
      let txtPres = '';
      if (egresos.length) {
        txtPres += `🔴 <b>EGRESOS</b>\n`;
        txtPres += egresos.slice(0, 8).map(e => `• ${e.descripcion}: ${e.cantidad || 1} x Bs ${Number(e.precio_unitario).toFixed(2)} = <b>Bs ${Number(e.total).toFixed(2)}</b>`).join('\n');
        txtPres += `\n   <b>Subtotal Egresos: Bs ${Number(pres.total_egresos || 0).toFixed(2)}</b>\n`;
      }
      if (ingresos.length) {
        txtPres += `🟢 <b>INGRESOS</b>\n`;
        txtPres += ingresos.slice(0, 8).map(i => `• ${i.descripcion}: ${i.cantidad || 1} x Bs ${Number(i.precio_unitario).toFixed(2)} = <b>Bs ${Number(i.total).toFixed(2)}</b>`).join('\n');
        txtPres += `\n   <b>Subtotal Ingresos: Bs ${Number(pres.total_ingresos || 0).toFixed(2)}</b>\n`;
      }
      const bal = Number(pres.balance || 0);
      txtPres += `━━━━━\n💰 <b>BALANCE ECONÓMICO: Bs ${bal.toFixed(2)}</b>`;
      secciones.push(`━━━━━━━━━━━━━━━━━━━━\n💵 <b>PRESUPUESTO</b>\n${txtPres}`);
    }

    if (evento.dataValues.Layout) {
      secciones.push(`━━━━━━━━━━━━━━━━━━━━\n🧩 <b>LAYOUT DEL EVENTO</b>\n${evento.dataValues.Layout.nombre || `Layout ID: ${evento.dataValues.Layout.idlayout || ''}`}`);
    }

    secciones.push(`━━━━━━━━━━━━━━━━━━━━\n📄 Se adjunta la <b>Ficha Técnica completa en PDF</b> (mayor detalle).\n¡Éxito en tu evento! 🎊`);

    const mensajeCompleto = secciones.join('\n\n');

    // 4. Enviar en chunks (máx 4096 chars por mensaje en Telegram)
    const chunks = [];
    let buffer = '';
    for (const line of mensajeCompleto.split('\n')) {
      if ((buffer + line).length > 4000 && buffer) {
        chunks.push(buffer);
        buffer = '';
      }
      buffer += (buffer ? '\n' : '') + line;
    }
    if (buffer) chunks.push(buffer);

    for (const chunk of chunks) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatObjetivo,
        text: chunk,
        parse_mode: 'HTML'
      });
    }

    // 5. Generar y enviar el PDF adjunto
    let pdfOk = true;
    let pdfErrorMensaje = null;
    try {
      const pdfBuffer = await generarPDFEvento(evento, creador);
      const form = new FormData();
      form.append('chat_id', chatObjetivo);
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
      pdfOk = false;
      pdfErrorMensaje = pdfError?.message || String(pdfError);
      console.error('❌ No se pudo adjuntar PDF:', pdfError);
      const fallbackMsg = '⚠️ No se pudo generar el PDF de la ficha técnica. Error:\n<pre>' +
        (pdfError?.stack || pdfError?.message || String(pdfError)).substring(0, 1500) +
        '</pre>';
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatObjetivo,
        text: fallbackMsg,
        parse_mode: 'HTML'
      }).catch(() => {});
    }

    if (!pdfOk) {
      return { ok: true, pdfOk: false, mensaje: `Ficha enviada a Telegram, pero el PDF no se pudo generar: ${pdfErrorMensaje}` };
    }
    return { ok: true, pdfOk: true, mensaje: 'Notificación completa enviada a Telegram' };
  } catch (error) {
    console.error('❌ Error enviando resumen a Telegram:', error);
    return { ok: false, mensaje: error.message };
  }
};

const enviarNotificacionCompletaTelegram = async (req, res) => {
  try {
    const { idevento } = req.body;
    if (!idevento) return res.status(400).json({ error: 'Falta idevento' });

    const models = getModels();
    const { Evento } = models;
    const evento = await Evento.findByPk(idevento, {
      include: [{ association: 'academicoCreador' }]
    });
    if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

    const r = await enviarFichaCompletaTelegram(idevento, evento.academicoCreador?.telegram_chat_id);
    if (!r.ok) return res.status(400).json({ error: r.mensaje });
    res.json({ ok: true, message: r.mensaje });
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
  getMisEventosParaSelector,
  enviarNotificacionCompletaTelegram
};