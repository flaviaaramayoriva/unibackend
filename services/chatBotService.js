const brain = require('brain.js');
const { Pool } = require('pg');
const axios = require('axios');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;
const CACHE_TTL = 300000;

class ChatBotService {
  constructor() {
    this.net = null;
    this.isTrained = false;
    this.cache = new Map();
    this.userCache = new Map();
    this.entrenar();
  }

  entrenar() {
    const trainingData = [
      // Saludos
      { input: { hola: 1, buen: 1, hey: 1, hi: 1, ey: 1, buenas: 1 }, output: { saludo: 1 } },
      // Clásicos
      { input: { hora: 1, cuando: 1, tiempo: 1, horario: 1 }, output: { hora: 1 } },
      { input: { lugar: 1, donde: 1, ubicacion: 1, sitio: 1 }, output: { lugar: 1 } },
      { input: { fecha: 1, dia: 1, cuan: 1 }, output: { fecha: 1 } },
      { input: { certificado: 1, diploma: 1, constancia: 1 }, output: { certificado: 1 } },
      { input: { costo: 1, precio: 1, pagar: 1, gratis: 1, gratuito: 1 }, output: { costo: 1 } },
      { input: { inscripcion: 1, registrar: 1, apuntar: 1, cupo: 1 }, output: { inscripcion: 1 } },
      { input: { requisitos: 1, necesito: 1, traer: 1, llevar: 1 }, output: { requisitos: 1 } },
      { input: { contacto: 1, organizador: 1, quien: 1, responsable: 1 }, output: { contacto: 1 } },
      { input: { programa: 1, agenda: 1, actividades: 1, cronograma: 1 }, output: { programa: 1 } },
      { input: { material: 1, laptop: 1, cuaderno: 1, computadora: 1 }, output: { material: 1 } },
      { input: { duracion: 1, tiempo: 1, cuanto: 1, horas: 1 }, output: { duracion: 1 } },
      { input: { expositor: 1, ponente: 1, speaker: 1, conferencista: 1 }, output: { expositor: 1 } },
      { input: { tema: 1, contenido: 1, sobre: 1, trata: 1 }, output: { tema: 1 } },
      { input: { ayuda: 1, help: 1, que: 1, puedo: 1 }, output: { ayuda: 1 } },
      { input: { gracias: 1, thanks: 1, thank: 1 }, output: { gracias: 1 } },
      { input: { adios: 1, bye: 1, chau: 1, hasta: 1 }, output: { adios: 1 } },
      { input: { miembros: 1, comite: 1, equipo: 1, organizadores: 1 }, output: { miembros: 1 } },
      { input: { estudiantes: 1, inscritos: 1, participantes: 1, cupos: 1 }, output: { estudiantes: 1 } },
      { input: { recordatorio: 1, recordar: 1, avisar: 1, notificar: 1, alerta: 1 }, output: { recordatorio: 1 } },
      { input: { objetivos: 1, meta: 1, proposito: 1, finalidad: 1 }, output: { objetivos: 1 } },
      { input: { tipo: 1, clase: 1, categoria: 1, modalidad: 1 }, output: { tipo: 1 } },
      { input: { publico: 1, audiencia: 1, dirigido: 1, para: 1, participar: 1 }, output: { publico: 1 } },
      { input: { facultad: 1, carrera: 1, departamento: 1, escuela: 1 }, output: { facultad: 1 } },
      { input: { fase: 1, etapa: 1, estado: 1, progreso: 1 }, output: { fase: 1 } },
      // ── NUEVAS: Quick Actions ──
      { input: { resumen: 1, dia: 1, hoy: 1, recap: 1, overview: 1 }, output: { resumen_dia: 1 } },
      { input: { pendiente: 1, pendientes: 1, esperando: 1, aprobacion: 1, revisar: 1 }, output: { pendientes: 1 } },
      { input: { cercanos: 1, proximos: 1, semana: 1, proxima: 1 }, output: { eventos_cercanos: 1 } },
      // ── NUEVAS: Reports ──
      { input: { reporte: 1, report: 1, resumen evento: 1, informe: 1, estadistica: 1 }, output: { reporte_evento: 1 } },
      { input: { cerrado: 1, finalizado: 1, terminado: 1, pasado: 1, anterior: 1, completado: 1 }, output: { evento_cerrado: 1 } },
      // ── NUEVAS: Notifications ──
      { input: { telegram: 1, enviar: 1, mandar: 1, notify: 1 }, output: { enviar_telegram: 1 } },
      { input: { comparar: 1, diferencia: 1, versus: 1, vs: 1, comparacion: 1 }, output: { comparar: 1 } },
      { input: { sugerencia: 1, sugerir: 1, recomendar: 1, consejo: 1, que hago: 1, que deberia: 1 }, output: { sugerencia: 1 } },
    ];

    this.net = new brain.NeuralNetwork({ hiddenLayers: [5], activation: 'sigmoid' });
    this.net.train(trainingData, { iterations: 1000, errorThresh: 0.005, log: false });
    this.isTrained = true;
    console.log('✅ ChatBot IA entrenado v4 — Quick Actions + Reports + Telegram');
  }

  async safeQuery(label, sql, params = []) {
    try {
      const res = await pool.query(sql, params);
      return res.rows;
    } catch (err) {
      console.warn(`⚠️ [BOT] Query "${label}" falló:`, err.message);
      return [];
    }
  }

  // ─── Info del evento ──────────────────────────────────────────────────────
  async getEventoInfo(eventoId) {
    const id = parseInt(eventoId, 10);
    if (isNaN(id) || id <= 0) return null;

    const cached = this.cache.get(String(id));
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) return cached.data;

    const rows = await this.safeQuery('evento_main', `
      SELECT e.idevento, e.nombreevento, e.fechaevento, e.horaevento,
             e.lugarevento, e.descripcion, e.estado, e.evento_externo,
             u.nombre AS organizador_nombre, u.apellidopat AS organizador_apellido,
             u.email AS organizador_email
      FROM evento e
      LEFT JOIN usuario u ON e.idacademico = u.idusuario
      WHERE e.idevento = $1
    `, [id]);

    const ev = rows[0];
    if (!ev) return null;

    ev.total_inscritos = 0;
    ev.total_comite = 0;
    ev.comite_miembros = [];
    ev.tipos = [];
    ev.objetivos = [];
    ev.segmentos = [];
    ev.facultades = [];
    ev.fase_actual = null;

    const inscritos = await this.safeQuery('inscritos', `SELECT COUNT(*)::int AS total FROM evento_inscripciones WHERE idevento = $1`, [id]);
    ev.total_inscritos = inscritos[0]?.total || 0;

    const comiteCount = await this.safeQuery('comite_count', `SELECT COUNT(*)::int AS total FROM comite WHERE idevento = $1`, [id]);
    ev.total_comite = comiteCount[0]?.total || 0;

    const comiteRows = await this.safeQuery('comite', `
      SELECT c.idusuario, u.nombre, u.apellidopat, u.apellidomat, u.role AS rol_sistema
      FROM comite c LEFT JOIN usuario u ON c.idusuario = u.idusuario
      WHERE c.idevento = $1 ORDER BY c.idcomite
    `, [id]);
    ev.comite_miembros = comiteRows.map(m => ({
      id: m.idusuario,
      nombre: `${m.nombre || ''} ${m.apellidopat || ''} ${m.apellidomat || ''}`.trim(),
      rol: m.rol_sistema || 'miembro',
    }));

    const tipos = await this.safeQuery('tipos', `
      SELECT te.nombretipo FROM evento_tipos et
      JOIN tipos_de_evento te ON et.idtipoevento = te.idtipoevento
      WHERE et.idevento = $1
    `, [id]);
    ev.tipos = tipos.map(r => r.nombretipo);

    const objs = await this.safeQuery('objs', `
      SELECT o.texto_personalizado FROM evento_objetivos eo
      JOIN objetivos o ON eo.idobjetivo = o.idobjetivo WHERE eo.idevento = $1
    `, [id]);
    ev.objetivos = objs.map(r => r.texto_personalizado).filter(Boolean);

    const segs = await this.safeQuery('segs', `
      SELECT s.nombre_segmento FROM evento_segmento es
      JOIN segmento s ON es.idsegmento = s.idsegmento WHERE es.idevento = $1
    `, [id]);
    ev.segmentos = segs.map(r => r.nombre_segmento);

    const facs = await this.safeQuery('facs', `
      SELECT f.nombre_facultad FROM "EventoFacultads" ef
      JOIN facultad f ON ef.idfacultad = f.facultad_id WHERE ef.idevento = $1
    `, [id]);
    if (facs.length === 0) {
      const facs2 = await this.safeQuery('facs2', `
        SELECT f.nombre_facultad FROM "EventoFacultad" ef
        JOIN facultad f ON ef.idfacultad = f.facultad_id WHERE ef.idevento = $1
      `, [id]);
      ev.facultades = facs2.map(r => r.nombre_facultad);
    } else {
      ev.facultades = facs.map(r => r.nombre_facultad);
    }

    const fase = await this.safeQuery('fase', `SELECT nrofase FROM fase WHERE idevento = $1 ORDER BY nrofase DESC LIMIT 1`, [id]);
    ev.fase_actual = fase[0]?.nrofase || null;

    this.cache.set(String(id), { data: ev, timestamp: Date.now() });
    return ev;
  }

  // ─── Info del usuario (para Quick Actions) ────────────────────────────────
  async getUserInfo(userId) {
    const id = parseInt(userId, 10);
    if (isNaN(id) || id <= 0) return null;

    const cached = this.userCache.get(String(id));
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) return cached.data;

    const rows = await this.safeQuery('user_main', `
      SELECT idusuario, nombre, apellidopat, apellidomat, email, role, telegram_chat_id
      FROM usuario WHERE idusuario = $1
    `, [id]);

    const user = rows[0];
    if (!user) return null;

    user.tiene_telegram = Boolean(user.telegram_chat_id);

    this.userCache.set(String(id), { data: user, timestamp: Date.now() });
    return user;
  }

  // ─── Quick Actions queries ────────────────────────────────────────────────
  async getResumenDia(userId) {
    const id = parseInt(userId, 10);
    if (isNaN(id) || id <= 0) return null;

    const hoy = new Date().toISOString().split('T')[0];

    const misEventos = await this.safeQuery('resumen_hoy', `
      SELECT e.idevento, e.nombreevento, e.fechaevento, e.horaevento, e.lugarevento, e.estado
      FROM comite c
      JOIN evento e ON c.idevento = e.idevento
      WHERE c.idusuario = $1
      ORDER BY e.fechaevento ASC
    `, [id]);

    const pendientes = await this.safeQuery('resumen_pend', `
      SELECT e.idevento, e.nombreevento, e.fechaevento, e.estado
      FROM comite c
      JOIN evento e ON c.idevento = e.idevento
      WHERE c.idusuario = $1 AND e.estado = 'pendiente'
    `, [id]);

    const aprobados = await this.safeQuery('resumen_aprob', `
      SELECT e.idevento, e.nombreevento, e.fechaevento, e.estado
      FROM comite c
      JOIN evento e ON c.idevento = e.idevento
      WHERE c.idusuario = $1 AND e.estado = 'aprobado'
      AND e.fechaevento >= $2
      ORDER BY e.fechaevento ASC
    `, [id, hoy]);

    const completados = await this.safeQuery('resumen_comp', `
      SELECT e.idevento, e.nombreevento, e.fechaevento, e.estado
      FROM comite c
      JOIN evento e ON c.idevento = e.idevento
      WHERE c.idusuario = $1 AND e.estado = 'completado'
      ORDER BY e.fechaevento DESC LIMIT 3
    `, [id]);

    return {
      totalEventos: misEventos.length,
      pendientes: pendientes.length,
      proximos: aprobados.length,
      completados: completados.length,
      listaPendientes: pendientes,
      listaProximos: aprobados,
      listaCompletados: completados,
    };
  }

  async getPendientes(userId) {
    const id = parseInt(userId, 10);
    if (isNaN(id) || id <= 0) return [];

    return await this.safeQuery('pendientes', `
      SELECT e.idevento, e.nombreevento, e.fechaevento, e.estado
      FROM comite c
      JOIN evento e ON c.idevento = e.idevento
      WHERE c.idusuario = $1 AND e.estado = 'pendiente'
      ORDER BY e.fechaevento ASC
    `, [id]);
  }

  async getEventosCercanos(userId) {
    const id = parseInt(userId, 10);
    if (isNaN(id) || id <= 0) return [];

    const en7dias = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    const hoy = new Date().toISOString().split('T')[0];

    return await this.safeQuery('cercanos', `
      SELECT e.idevento, e.nombreevento, e.fechaevento, e.horaevento, e.lugarevento, e.estado
      FROM comite c
      JOIN evento e ON c.idevento = e.idevento
      WHERE c.idusuario = $1
        AND e.estado = 'aprobado'
        AND e.fechaevento BETWEEN $2 AND $3
      ORDER BY e.fechaevento ASC
    `, [id, hoy, en7dias]);
  }

  // ─── Report queries ───────────────────────────────────────────────────────
  async getReporteEvento(eventoId) {
    const ev = await this.getEventoInfo(eventoId);
    if (!ev) return null;

    const resultado = await this.safeQuery('resultado', `
      SELECT satisfaccion_esperada, satisfaccion_real, participacion_esperada,
             participacion_real, otros_resultados, lecciones_aprendidas, analisis_desviaciones
      FROM resultado WHERE idevento = $1 LIMIT 1
    `, [eventoId]);

    ev.resultado = resultado[0] || null;

    const fases = await this.safeQuery('fases', `
      SELECT nrofase FROM fase WHERE idevento = $1 ORDER BY nrofase
    `, [eventoId]);
    ev.total_fases = fases.length;

    return ev;
  }

  async getEventosCerrados(userId) {
    const id = parseInt(userId, 10);
    if (isNaN(id) || id <= 0) return [];

    return await this.safeQuery('cerrados', `
      SELECT e.idevento, e.nombreevento, e.fechaevento, e.estado
      FROM comite c
      JOIN evento e ON c.idevento = e.idevento
      WHERE c.idusuario = $1 AND e.estado IN ('vencido', 'completado')
      ORDER BY e.fechaevento DESC LIMIT 5
    `, [id]);
  }

  // ─── Sugerencias ──────────────────────────────────────────────────────────
  async getSugerencias(userId) {
    const resumen = await this.getResumenDia(userId);
    if (!resumen) return null;

    const sugerencias = [];

    if (resumen.pendientes > 0) {
      sugerencias.push(`📌 Tienes ${resumen.pendientes} evento(s) pendiente(s) de revisión. Te recomiendo revisarlos pronto.`);
    }
    if (resumen.proximos > 0) {
      sugerencias.push(`📅 Tienes ${resumen.proximos} evento(s) próximo(s). Asegúrate de tener todo preparado.`);
    }
    if (resumen.proximos > 0 && resumen.pendientes === 0) {
      sugerencias.push(`✅ No tienes pendientes. ¡Buen trabajo! Puedes enfocarte en los eventos próximos.`);
    }
    if (resumen.totalEventos === 0) {
      sugerencias.push(`🆕 No participas en ningún evento aún. ¿Te gustaría crear uno nuevo?`);
    }
    if (resumen.completados > 0) {
      sugerencias.push(`🏆 Ya completaste ${resumen.completados} evento(s). ¡Excelente rendimiento!`);
    }

    return sugerencias.length > 0 ? sugerencias : ['✅ Todo está en orden. ¿Hay algo más en lo que pueda ayudarte?'];
  }

  // ─── Enviar a Telegram ────────────────────────────────────────────────────
  async enviarTelegram(chatId, mensaje) {
    try {
      const res = await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: mensaje,
        parse_mode: 'HTML',
      }, { timeout: 10000 });
      return res.data.ok === true;
    } catch (err) {
      console.error('❌ [BOT] Error enviando a Telegram:', err.message);
      return false;
    }
  }

  async enviarReporteTelegram(chatId, eventoId) {
    const reporte = await this.getReporteEvento(eventoId);
    if (!reporte) return false;

    const fmtFecha = (f) => {
      if (!f) return 'Por confirmar';
      try { return new Date(f).toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }
      catch { return String(f); }
    };

    let msg = `📊 <b>REPORTE DEL EVENTO</b>\n\n`;
    msg += `📝 <b>${reporte.nombreevento || 'Sin nombre'}</b>\n`;
    msg += `📅 ${fmtFecha(reporte.fechaevento)}\n`;
    msg += `⏰ ${reporte.horaevento || 'Por confirmar'}\n`;
    msg += `📍 ${reporte.lugarevento || 'Por confirmar'}\n`;
    msg += `📊 Estado: ${reporte.estado || 'N/A'}\n`;
    msg += `🔢 Fases: ${reporte.total_fases || 0}\n\n`;

    if (reporte.tipos?.length) msg += `🏷️ Tipo: ${reporte.tipos.join(', ')}\n`;
    if (reporte.facultades?.length) msg += `🏫 Facultad: ${reporte.facultades.join(', ')}\n`;
    if (reporte.comite_miembros?.length) msg += `👥 Comité: ${reporte.comite_miembros.length} miembros\n`;
    msg += `👥 Inscritos: ${reporte.total_inscritos || 0}\n\n`;

    if (reporte.descripcion) {
      msg += `📖 <b>Descripción:</b>\n${reporte.descripcion.substring(0, 300)}${reporte.descripcion.length > 300 ? '...' : ''}\n\n`;
    }

    if (reporte.objetivos?.length) {
      msg += `🎯 <b>Objetivos:</b>\n`;
      reporte.objetivos.forEach((o, i) => { msg += `  ${i + 1}. ${o}\n`; });
      msg += '\n';
    }

    if (reporte.resultado) {
      const r = reporte.resultado;
      msg += `📈 <b>Resultados:</b>\n`;
      if (r.participacion_esperada) msg += `  Participación esperada: ${r.participacion_esperada}\n`;
      if (r.participacion_real) msg += `  Participación real: ${r.participacion_real}\n`;
      if (r.satisfaccion_esperada) msg += `  Satisfacción esperada: ${r.satisfaccion_esperada}\n`;
      if (r.satisfaccion_real) msg += `  Satisfacción real: ${r.satisfaccion_real}\n`;
      if (r.lecciones_aprendidas) msg += `  📝 Lecciones: ${r.lecciones_aprendidas.substring(0, 200)}\n`;
      msg += '\n';
    }

    if (reporte.comite_miembros?.length) {
      msg += `👥 <b>Comité:</b>\n`;
      reporte.comite_miembros.forEach(m => { msg += `  • ${m.nombre} (${m.rol})\n`; });
    }

    return this.enviarTelegram(chatId, msg);
  }

  async enviarResumenTelegram(chatId, userId) {
    const resumen = await this.getResumenDia(userId);
    if (!resumen) return false;

    let msg = `📋 <b>RESUMEN DEL DÍA</b>\n\n`;
    msg += `📊 Total eventos: ${resumen.totalEventos}\n`;
    msg += `⏳ Pendientes: ${resumen.pendientes}\n`;
    msg += `📅 Próximos: ${resumen.proximos}\n`;
    msg += `✅ Completados: ${resumen.completados}\n\n`;

    if (resumen.listaPendientes?.length) {
      msg += `⏳ <b>Pendientes:</b>\n`;
      resumen.listaPendientes.forEach(e => {
        msg += `  • ${e.nombreevento || 'Sin nombre'}\n`;
      });
      msg += '\n';
    }

    if (resumen.listaProximos?.length) {
      msg += `📅 <b>Próximos:</b>\n`;
      resumen.listaProximos.forEach(e => {
        const fecha = e.fechaevento ? new Date(e.fechaevento).toLocaleDateString('es-ES') : 'Por definir';
        msg += `  • ${e.nombreevento || 'Sin nombre'} — ${fecha}\n`;
      });
    }

    return this.enviarTelegram(chatId, msg);
  }

  // ─── Main: generar respuesta ──────────────────────────────────────────────
  async generarRespuesta(pregunta, eventoId = null, userId = null) {
    try {
      const preguntaLower = pregunta.toLowerCase();
      const palabras = preguntaLower.split(/\s+/);

      const eventoInfo = (eventoId && eventoId !== 'null' && eventoId !== 'undefined')
        ? await this.getEventoInfo(eventoId) : null;

      const userInfo = (userId && userId !== 'null' && userId !== 'undefined')
        ? await this.getUserInfo(userId) : null;

      const input = {};
      palabras.forEach(p => {
        const limpia = p.replace(/[.,!?;:]/g, '');
        if (limpia.length >= 2) input[limpia] = 1;
      });

      const output = this.net.run(input);

      let mejorCategoria = null;
      let mejorProbabilidad = 0;
      for (const [categoria, probabilidad] of Object.entries(output)) {
        if (probabilidad > mejorProbabilidad && probabilidad > 0.3) {
          mejorProbabilidad = probabilidad;
          mejorCategoria = categoria;
        }
      }

      const respuesta = await this._generarPorCategoria(mejorCategoria, eventoInfo, userInfo, palabras, userId);

      return {
        success: true,
        respuesta,
        modelo: 'Brain.js Neural Network + DB v4',
        confianza: (mejorProbabilidad * 100).toFixed(0) + '%',
        categoria: mejorCategoria || 'default',
      };
    } catch (error) {
      console.error('❌ Error en ChatBot:', error);
      return {
        success: false,
        respuesta: 'Lo siento, tuve un problema al procesar tu pregunta. Intenta de nuevo.',
        modelo: 'Brain.js',
        error: error.message,
      };
    }
  }

  // ─── Respuestas ───────────────────────────────────────────────────────────
  async _generarPorCategoria(categoria, ev, user, palabras, userId) {
    const fmtFecha = (f) => {
      if (!f) return 'Por confirmar';
      try { return new Date(f).toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }
      catch { return String(f); }
    };

    switch (categoria) {

      // ════════════════════════════════════════════════════════════════════════
      // QUICK ACTIONS
      // ════════════════════════════════════════════════════════════════════════
      case 'resumen_dia': {
        if (!userId || userId === 'null') return 'Necesito estar logueado para darte un resumen. Inicia sesión y vuelve a preguntar.';
        const resumen = await this.getResumenDia(userId);
        if (!resumen) return 'No pude obtener tu resumen. Verifica que tengas eventos asignados.';

        let resp = `📋 Resumen del Día:\n\n`;
        resp += `📊 Total eventos: ${resumen.totalEventos}\n`;
        resp += `⏳ Pendientes: ${resumen.pendientes}\n`;
        resp += `📅 Próximos: ${resumen.proximos}\n`;
        resp += `✅ Completados: ${resumen.completados}\n\n`;

        if (resumen.listaPendientes?.length) {
          resp += `⏳ Pendientes:\n`;
          resumen.listaPendientes.forEach(e => { resp += `  • ${e.nombreevento || 'Sin nombre'}\n`; });
          resp += '\n';
        }
        if (resumen.listaProximos?.length) {
          resp += `📅 Próximos:\n`;
          resumen.listaProximos.forEach(e => {
            const fecha = e.fechaevento ? new Date(e.fechaevento).toLocaleDateString('es-ES') : 'Por definir';
            resp += `  • ${e.nombreevento || 'Sin nombre'} — ${fecha}\n`;
          });
          resp += '\n';
        }
        resp += `Escribe "pendientes" para ver los detalles o "sugerencias" para acciones recomendadas.`;
        return resp;
      }

      case 'pendientes': {
        if (!userId || userId === 'null') return 'Necesito estar logueado para ver tus pendientes.';
        const pendientes = await this.getPendientes(userId);
        if (pendientes.length === 0) return '✅ No tienes eventos pendientes. ¡Todo al día!';

        let resp = `⏳ Eventos Pendientes (${pendientes.length}):\n\n`;
        pendientes.forEach((e, i) => {
          resp += `${i + 1}. ${e.nombreevento || 'Sin nombre'}\n`;
          resp += `   📅 ${fmtFecha(e.fechaevento)}\n\n`;
        });
        resp += `¿Necesitas más detalles sobre alguno?`;
        return resp;
      }

      case 'eventos_cercanos': {
        if (!userId || userId === 'null') return 'Necesito estar logueado para ver eventos cercanos.';
        const cercanos = await this.getEventosCercanos(userId);
        if (cercanos.length === 0) return '📅 No tienes eventos en los próximos 7 días.';

        let resp = `📅 Eventos Próximos (7 días):\n\n`;
        cercanos.forEach((e, i) => {
          resp += `${i + 1}. ${e.nombreevento || 'Sin nombre'}\n`;
          resp += `   📅 ${fmtFecha(e.fechaevento)}\n`;
          resp += `   📍 ${e.lugarevento || 'Por confirmar'}\n\n`;
        });
        return resp;
      }

      // ════════════════════════════════════════════════════════════════════════
      // REPORTS
      // ════════════════════════════════════════════════════════════════════════
      case 'reporte_evento': {
        const eventoId = ev?.idevento || palabras.find(p => /^\d+$/.test(p));
        if (!eventoId) return '¿De qué evento quieres el reporte? Di el nombre o ID del evento.';

        const reporte = await this.getReporteEvento(eventoId);
        if (!reporte) return 'No encontré ese evento. Verifica el nombre o ID.';

        let resp = `📊 REPORTE: ${reporte.nombreevento || 'Sin nombre'}\n\n`;
        resp += `📅 Fecha: ${fmtFecha(reporte.fechaevento)}\n`;
        resp += `⏰ Hora: ${reporte.horaevento || 'Por confirmar'}\n`;
        resp += `📍 Lugar: ${reporte.lugarevento || 'Por confirmar'}\n`;
        resp += `📊 Estado: ${reporte.estado || 'N/A'}\n`;
        resp += `🔢 Fases: ${reporte.total_fases || 0}\n`;
        resp += `👥 Inscritos: ${reporte.total_inscritos || 0}\n`;
        if (reporte.tipos?.length) resp += `🏷️ Tipo: ${reporte.tipos.join(', ')}\n`;
        if (reporte.facultades?.length) resp += `🏫 Facultad: ${reporte.facultades.join(', ')}\n`;
        if (reporte.comite_miembros?.length) resp += `👥 Comité: ${reporte.comite_miembros.length} miembros\n`;
        resp += '\n';

        if (reporte.descripcion) {
          resp += `📖 Descripción:\n${reporte.descripcion.substring(0, 300)}${reporte.descripcion.length > 300 ? '...' : ''}\n\n`;
        }
        if (reporte.objetivos?.length) {
          resp += `🎯 Objetivos:\n`;
          reporte.objetivos.forEach((o, i) => { resp += `  ${i + 1}. ${o}\n`; });
          resp += '\n';
        }
        if (reporte.resultado) {
          const r = reporte.resultado;
          resp += `📈 Resultados:\n`;
          if (r.participacion_esperada) resp += `  Esperada: ${r.participacion_esperada}\n`;
          if (r.participacion_real) resp += `  Real: ${r.participacion_real}\n`;
          if (r.satisfaccion_real) resp += `  Satisfacción: ${r.satisfaccion_real}\n`;
          if (r.lecciones_aprendidas) resp += `  📝 Lecciones: ${r.lecciones_aprendidas.substring(0, 200)}\n`;
        }

        resp += `\n¿Quieres enviar este reporte por Telegram? Escribe "enviar reporte por telegram".`;
        return resp;
      }

      case 'evento_cerrado': {
        if (!userId || userId === 'null') return 'Necesito estar logueado para ver eventos cerrados.';
        const cerrados = await this.getEventosCerrados(userId);
        if (cerrados.length === 0) return 'No tienes eventos cerrados o completados recientemente.';

        let resp = `📋 Eventos Cerrados/Completados:\n\n`;
        cerrados.forEach((e, i) => {
          resp += `${i + 1}. ${e.nombreevento || 'Sin nombre'}\n`;
          resp += `   📅 ${fmtFecha(e.fechaevento)} — ${e.estado}\n\n`;
        });
        resp += `Escribe "reporte" seguido del nombre o ID para ver el reporte detallado.`;
        return resp;
      }

      // ════════════════════════════════════════════════════════════════════════
      // TELEGRAM
      // ════════════════════════════════════════════════════════════════════════
      case 'enviar_telegram': {
        if (!user?.tiene_telegram) {
          return `📱 No tienes Telegram vinculado.\n\nPara vincular:\n1. Abre @EventUniBot en Telegram\n2. Envía tu email institucional\n3. Listo, podrás recibir notificaciones.`;
        }
        if (ev?.idevento) {
          const ok = await this.enviarReporteTelegram(user.telegram_chat_id, ev.idevento);
          return ok
            ? `✅ Reporte enviado a tu Telegram (@${user.telegram_username || 'usuario'}).`
            : '❌ No pude enviar el reporte. Verifica tu Telegram vinculado.';
        }
        const ok = await this.enviarResumenTelegram(user.telegram_chat_id, userId);
        return ok
          ? `✅ Resumen enviado a tu Telegram.`
          : '❌ No pude enviar el resumen. Verifica tu Telegram vinculado.';
      }

      // ════════════════════════════════════════════════════════════════════════
      // SUGERENCIAS
      // ════════════════════════════════════════════════════════════════════════
      case 'sugerencia': {
        if (!userId || userId === 'null') return 'Necesito estar logueado para darte sugerencias.';
        const sugerencias = await this.getSugerencias(userId);
        if (!sugerencias) return 'No pude analizar tu situación. Intenta de nuevo.';

        let resp = `💡 Sugerencias para ti:\n\n`;
        sugerencias.forEach(s => { resp += `${s}\n\n`; });
        return resp;
      }

      // ════════════════════════════════════════════════════════════════════════
      // CLÁSICOS (con contexto de evento)
      // ════════════════════════════════════════════════════════════════════════
      case 'hora':
        if (ev) return `📅 Horario:\n⏰ Hora: ${ev.horaevento || 'Por confirmar'}\n📆 Fecha: ${fmtFecha(ev.fechaevento)}\n${ev.lugarevento ? `📍 Lugar: ${ev.lugarevento}\n` : ''}\nLlega 15 min antes.`;
        return 'El horario está en los detalles del evento.';

      case 'lugar':
        if (ev) return `📍 Lugar:\n🏛️ ${ev.lugarevento || 'Por confirmar'}\n📝 ${ev.nombreevento || 'Evento'}\n${ev.facultades?.length ? `🏫 ${ev.facultades.join(', ')}\n` : ''}`;
        return 'El lugar está en los detalles del evento.';

      case 'fecha':
        if (ev) return `📅 Fecha:\n🗓️ ${fmtFecha(ev.fechaevento)}\n⏰ ${ev.horaevento || 'Por confirmar'}\n${ev.estado ? `📊 Estado: ${ev.estado}\n` : ''}`;
        return 'La fecha está en los detalles.';

      case 'certificado':
        return '📜 Sí se entrega certificado con 90% de asistencia. Se entrega al finalizar o en 5 días hábiles.';

      case 'costo':
        if (ev) return `💰 Evento: ${ev.nombreevento || 'Evento'}\n✅ Gratuito\n${ev.total_inscritos ? `👥 ${ev.total_inscritos} inscritos\n` : ''}`;
        return 'Este evento es gratuito.';

      case 'inscripcion':
        if (ev) return `📝 Inscritos: ${ev.total_inscritos || 0}\n📊 Estado: ${ev.estado || 'Activo'}\n${ev.evento_externo ? `🌐 Público externo\n` : ''}`;
        return 'Inscríbete en la plataforma.';

      case 'requisitos':
        if (ev?.segmentos?.length) return `📋 Dirigido a: ${ev.segmentos.join(', ')}\n✅ Obligatorio: Estar registrado\n${ev.descripcion ? `\n📝 ${ev.descripcion.substring(0, 200)}...` : ''}`;
        return '✅ Obligatorio: Estar registrado, laptop, conocimientos básicos.';

      case 'contacto':
        if (ev) {
          let r = `📞 Contacto:\n👤 ${ev.organizador_nombre || ''} ${ev.organizador_apellido || ''}\n`;
          if (ev.organizador_email) r += `📧 ${ev.organizador_email}\n`;
          if (ev.comite_miembros?.length) {
            r += `\n👥 Comité (${ev.comite_miembros.length}):\n`;
            ev.comite_miembros.slice(0, 5).forEach(m => { r += `  • ${m.nombre}\n`; });
          }
          return r;
        }
        return 'Contacta al organizador desde la lista de comité.';

      case 'miembros':
        if (ev) {
          let r = `👥 Comité:\n👤 Organizador: ${ev.organizador_nombre || ''} ${ev.organizador_apellido || ''}\n`;
          if (ev.comite_miembros?.length) {
            ev.comite_miembros.forEach(m => { r += `  • ${m.nombre} — ${m.rol}\n`; });
          }
          return r;
        }
        return 'Consulta la lista de miembros del comité.';

      case 'estudiantes':
        if (ev) return `📊 Inscritos: ${ev.total_inscritos || 0}\n📝 Estado: ${ev.estado || 'Activo'}\n${ev.comite_miembros?.length ? `👥 Comité: ${ev.comite_miembros.length}\n` : ''}`;
        return 'Revisa las estadísticas en el panel.';

      case 'programa':
        if (ev) {
          let r = `📋 ${ev.nombreevento || 'Evento'}\n📅 ${fmtFecha(ev.fechaevento)}\n⏰ ${ev.horaevento || 'Por confirmar'}\n📍 ${ev.lugarevento || 'Por confirmar'}\n`;
          if (ev.descripcion) r += `\n📖 ${ev.descripcion.substring(0, 300)}...\n`;
          return r;
        }
        return 'Programa: 08:00-12:30. Ver detalles del evento.';

      case 'material':
        return '📚 Laptop con batería, internet, cuaderno, USB, audífonos (si es virtual).';

      case 'expositor':
        if (ev) {
          let r = `🎓 Expositores:\n👤 ${ev.organizador_nombre || ''} ${ev.organizador_apellido || ''}\n`;
          if (ev.comite_miembros?.length) ev.comite_miembros.forEach(m => { r += `  • ${m.nombre}\n`; });
          return r;
        }
        return 'Expositores en la información del evento.';

      case 'tema':
        if (ev) {
          let r = `📚 ${ev.nombreevento || 'Evento'}\n`;
          if (ev.tipos?.length) r += `🏷️ ${ev.tipos.join(', ')}\n`;
          if (ev.descripcion) r += `\n📝 ${ev.descripcion.substring(0, 400)}...\n`;
          if (ev.objetivos?.length) { r += `\n🎯 Objetivos:\n`; ev.objetivos.forEach(o => { r += `  • ${o}\n`; }); }
          return r;
        }
        return 'Revisa los detalles del evento.';

      case 'duracion':
        if (ev) return `⏱️ 📅 ${fmtFecha(ev.fechaevento)}\n⏰ ${ev.horaevento || 'Por confirmar'}\n📍 ${ev.lugarevento || 'Por confirmar'}`;
        return 'Duración en los detalles. Generalmente 2-4 horas.';

      case 'objetivos':
        if (ev?.objetivos?.length) {
          let r = `🎯 Objetivos:\n`;
          ev.objetivos.forEach((o, i) => { r += `${i + 1}. ${o}\n`; });
          return r;
        }
        if (ev) return `🎯 "${ev.nombreevento || ''}" sin objetivos registrados.`;
        return 'Sin info de objetivos.';

      case 'tipo':
        if (ev) {
          let r = `🏷️ ${ev.nombreevento || 'Sin nombre'}\n`;
          if (ev.tipos?.length) r += `🏷️ ${ev.tipos.join(', ')}\n`;
          if (ev.facultades?.length) r += `🏫 ${ev.facultades.join(', ')}\n`;
          if (ev.estado) r += `📊 ${ev.estado}\n`;
          return r;
        }
        return 'Sin info de tipo.';

      case 'publico':
        if (ev?.segmentos?.length) return `🎯 Dirigido a: ${ev.segmentos.join(', ')}\n${ev.facultades?.length ? `🏫 ${ev.facultades.join(', ')}\n` : ''}`;
        if (ev) return `🎯 "${ev.nombreevento || ''}" sin segmento definido.`;
        return 'Sin info de público.';

      case 'facultad':
        if (ev) return `🏫 ${ev.nombreevento || 'Sin nombre'}\n${ev.facultades?.length ? `Facultad: ${ev.facultades.join(', ')}` : 'Facultad: No especificada'}`;
        return 'Sin info de facultad.';

      case 'fase':
        if (ev) return `📊 ${ev.nombreevento || 'Sin nombre'}\nEstado: ${ev.estado || 'N/A'}\n${ev.fase_actual ? `Fase: ${ev.fase_actual}` : ''}`;
        return 'Sin info de fase.';

      // ════════════════════════════════════════════════════════════════════════
      // CLÁSICOS (sin evento)
      // ════════════════════════════════════════════════════════════════════════
      case 'saludo': {
        let r = `¡Hola! 👋 Soy tu asistente virtual`;
        if (ev) r += ` del evento "${ev.nombreevento || ''}"`;
        r += `. Puedo ayudarte con:\n\n`;
        r += `📋 Quick Actions:\n  • "Resumen del día"\n  • "Qué tengo pendiente"\n  • "Eventos cercanos"\n  • "Sugerencias"\n\n`;
        r += `📊 Reports:\n  • "Reporte del evento"\n  • "Eventos cerrados"\n\n`;
        r += `📱 Telegram:\n  • "Enviar resumen por Telegram"\n  • "Enviar reporte por Telegram"\n\n`;
        r += `🔍 Clásicos:\n  • Horarios, ubicación, certificados, costos, inscripciones\n\n`;
        r += `¿En qué puedo ayudarte?`;
        return r;
      }

      case 'gracias':
        return '¡De nada! 😊 Estoy aquí para ayudarte.';

      case 'adios':
        return '¡Hasta luego! 👋 Espero verte en el evento.';

      case 'ayuda': {
        let r = `💡 TODO lo que puedo hacer:\n\n`;
        r += `📋 QUICK ACTIONS:\n  • "Resumen del día" — Tu resumen rápido\n`;
        r += `  • "Qué tengo pendiente" — Eventos esperando\n`;
        r += `  • "Eventos cercanos" — Próximos 7 días\n`;
        r += `  • "Sugerencias" — Qué deberías hacer\n\n`;
        r += `📊 REPORTS:\n  • "Reporte del evento X" — Reporte completo\n`;
        r += `  • "Eventos cerrados" — Historial\n\n`;
        r += `📱 TELEGRAM:\n  • "Enviar resumen por Telegram"\n`;
        r += `  • "Enviar reporte por Telegram"\n\n`;
        r += `🔍 CLÁSICOS:\n  • Horarios, ubicación, certificados, costos\n`;
        r += `  • Inscripciones, comité, objetivos, tipo\n\n`;
        if (user?.tiene_telegram) r += `✅ Telegram vinculado: @${user.telegram_username || 'usuario'}\n`;
        else r += `⚠️ Telegram no vinculado. Abre @EventUniBot y envía tu email.\n`;
        return r;
      }

      case 'recordatorio':
        return '⏰ Recordatorios:\n• Recuérdame [fecha] [tarea]\n• O vincula Telegram para alertas automáticas.';

      // ════════════════════════════════════════════════════════════════════════
      // DEFAULT
      // ════════════════════════════════════════════════════════════════════════
      default:
        if (palabras.some(p => ['hola', 'hi', 'hey', 'buenas', 'ey'].includes(p))) {
          return `¡Hola! 👋 Pregúntame sobre horarios, resumen del día, reportes o envía algo por Telegram.`;
        }
        return `No tengo información específica sobre eso. 😅\n\n` +
          `Escribe "ayuda" para ver todo lo que puedo hacer.`;
    }
  }

  extraerPregunta(mensaje) {
    return mensaje
      .replace(/^\/pregunta\s*/i, '')
      .replace(/^\/ia\s*/i, '')
      .replace(/^\/bot\s*/i, '')
      .replace(/@bot\s*/i, '')
      .replace(/^bot:\s*/i, '')
      .trim();
  }
}

module.exports = new ChatBotService();
