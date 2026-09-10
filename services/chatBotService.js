const brain = require('brain.js');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CACHE_TTL = 300000; // 5 minutos

class ChatBotService {
  constructor() {
    this.net = null;
    this.isTrained = false;
    this.cache = new Map(); // Map<eventoId, { data, timestamp }>

    this.entrenar();
  }

  entrenar() {
    const trainingData = [
      { input: { hola: 1, buen: 1, hey: 1, hi: 1, ey: 1, buenas: 1 }, output: { saludo: 1 } },
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
    ];

    this.net = new brain.NeuralNetwork({ hiddenLayers: [5], activation: 'sigmoid' });
    this.net.train(trainingData, { iterations: 1000, errorThresh: 0.005, log: false });
    this.isTrained = true;
    console.log('✅ ChatBot IA entrenado con Brain.js - v2 con contexto ampliado');
  }

  // ─── Obtener información completa del evento ──────────────────────────────
  async getEventoInfo(eventoId) {
    const cached = this.cache.get(String(eventoId));
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      return cached.data;
    }

    try {
      // 1. Datos principales del evento + organizador + inscritos + comité
      const mainRes = await pool.query(`
        SELECT
          e.idevento,
          e.nombreevento,
          e.fechaevento,
          e.horaevento,
          e.lugarevento,
          e.descripcion,
          e.estado,
          e.evento_externo,
          u.nombre  AS organizador_nombre,
          u.apellidopat AS organizador_apellido,
          u.email AS organizador_email,
          (SELECT COUNT(*) FROM evento_inscripciones ei WHERE ei.idevento = e.idevento) AS total_inscritos,
          (SELECT COUNT(*) FROM comite c WHERE c.idevento = e.idevento) AS total_comite
        FROM evento e
        LEFT JOIN usuario u ON e.idacademico = u.idusuario
        WHERE e.idevento = $1
      `, [eventoId]);

      const evento = mainRes.rows[0];
      if (!evento) return null;

      // 2. Miembros del comité con nombres y roles
      const comiteRes = await pool.query(`
        SELECT
          c.idcomite,
          c.idusuario,
          u.nombre,
          u.apellidopat,
          u.apellidomat,
          u.role AS rol_sistema
        FROM comite c
        LEFT JOIN usuario u ON c.idusuario = u.idusuario
        WHERE c.idevento = $1
        ORDER BY c.idcomite
      `, [eventoId]);

      evento.comite_miembros = comiteRes.rows.map(m => ({
        id: m.idusuario,
        nombre: `${m.nombre || ''} ${m.apellidopat || ''} ${m.apellidomat || ''}`.trim(),
        rol: m.rol_sistema || 'miembro',
      }));

      // 3. Tipos de evento
      const tiposRes = await pool.query(`
        SELECT te.nombretipo
        FROM evento_tipos et
        JOIN tipos_de_evento te ON et.idtipoevento = te.idtipoevento
        WHERE et.idevento = $1
      `, [eventoId]);

      evento.tipos = tiposRes.rows.map(r => r.nombretipo);

      // 4. Objetivos del evento
      const objRes = await pool.query(`
        SELECT o.texto_personalizado
        FROM evento_objetivos eo
        JOIN objetivos o ON eo.idobjetivo = o.idobjetivo
        WHERE eo.idevento = $1
      `, [eventoId]);

      evento.objetivos = objRes.rows
        .map(r => r.texto_personalizado)
        .filter(Boolean);

      // 5. Segmento / público objetivo
      const segRes = await pool.query(`
        SELECT s.nombre_segmento
        FROM evento_segmento es
        JOIN segmento s ON es.idsegmento = s.idsegmento
        WHERE es.idevento = $1
      `, [eventoId]);

      evento.segmentos = segRes.rows.map(r => r.nombre_segmento);

      // 6. Facultad
      const facRes = await pool.query(`
        SELECT f.nombre_facultad
        FROM "EventoFacultad" ef
        JOIN facultad f ON ef.idfacultad = f.facultad_id
        WHERE ef.idevento = $1
      `, [eventoId]);

      evento.facultades = facRes.rows.map(r => r.nombre_facultad);

      // 7. Fase actual
      const faseRes = await pool.query(`
        SELECT nrofase FROM fase WHERE idevento = $1 ORDER BY nrofase DESC LIMIT 1
      `, [eventoId]);

      evento.fase_actual = faseRes.rows[0]?.nrofase || null;

      // Guardar en caché
      this.cache.set(String(eventoId), { data: evento, timestamp: Date.now() });
      return evento;
    } catch (error) {
      console.error('❌ Error al obtener info del evento:', error.message);
      return null;
    }
  }

  // ─── Generar respuesta ────────────────────────────────────────────────────
  async generarRespuesta(pregunta, eventoId = null) {
    try {
      const preguntaLower = pregunta.toLowerCase();
      const palabras = preguntaLower.split(/\s+/);

      const eventoInfo = eventoId ? await this.getEventoInfo(eventoId) : null;

      // Input para la red neuronal
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

      const respuesta = this._generarPorCategoria(mejorCategoria, eventoInfo, palabras);

      return {
        success: true,
        respuesta,
        modelo: 'Brain.js Neural Network + Database v2',
        confianza: (mejorProbabilidad * 100).toFixed(0) + '%',
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

  // ─── Respuestas por categoría ─────────────────────────────────────────────
  _generarPorCategoria(categoria, ev, palabras) {
    const fmtFecha = (f) => {
      if (!f) return 'Por confirmar';
      try {
        return new Date(f).toLocaleDateString('es-ES', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        });
      } catch { return String(f); }
    };

    switch (categoria) {
      // ── HORA ──
      case 'hora':
        if (ev) {
          return `📅 Información del Horario:\n\n` +
            `⏰ Hora: ${ev.horaevento || 'Por confirmar'}\n` +
            `📆 Fecha: ${fmtFecha(ev.fechaevento)}\n` +
            (ev.lugarevento ? `📍 Lugar: ${ev.lugarevento}\n` : '') +
            `\nTe recomiendo llegar 15 minutos antes.`;
        }
        return 'El horario del evento está disponible en los detalles. Revisa la información del evento para confirmar la hora exacta.';

      // ── LUGAR ──
      case 'lugar':
        if (ev) {
          return `📍 Ubicación del Evento:\n\n` +
            `🏛️ Lugar: ${ev.lugarevento || 'Por confirmar'}\n` +
            `📝 Evento: ${ev.nombreevento || 'Evento'}\n` +
            (ev.facultades?.length ? `🏫 Facultad: ${ev.facultades.join(', ')}\n` : '') +
            `\nSi tienes dudas sobre cómo llegar, contacta al organizador.`;
        }
        return 'El lugar del evento está especificado en los detalles. Puedes consultarlo en la información del evento.';

      // ── FECHA ──
      case 'fecha':
        if (ev) {
          return `📅 Fecha del Evento:\n\n` +
            `🗓️ Día: ${fmtFecha(ev.fechaevento)}\n` +
            `⏰ Hora: ${ev.horaevento || 'Por confirmar'}\n` +
            (ev.estado ? `📊 Estado: ${ev.estado}\n` : '') +
            `\n¡No faltes!`;
        }
        return 'La fecha del evento está disponible en los detalles.';

      // ── CERTIFICADO ──
      case 'certificado':
        return `📜 Información sobre Certificados:\n\n` +
          `✅ Sí se entrega certificado al finalizar el evento\n` +
          `📋 Requisitos: Asistencia completa (mínimo 90%)\n` +
          `⏰ Entrega: Al finalizar el evento o dentro de 5 días hábiles\n\n` +
          `El certificado incluye horas de capacitación y es válido para tu expediente.`;

      // ── COSTO ──
      case 'costo':
        if (ev) {
          return `💰 Información del Evento:\n\n` +
            `📝 Evento: ${ev.nombreevento || 'Evento'}\n` +
            `✅ Este evento es gratuito para todos los participantes registrados\n` +
            (ev.total_inscritos ? `👥 Actualmente hay ${ev.total_inscritos} persona(s) inscrita(s)\n` : '') +
            `\nSolo necesitas registrarte con anticipación.`;
        }
        return 'Este evento es gratuito para todos los participantes registrados.';

      // ── INSCRIPCIÓN ──
      case 'inscripcion':
        if (ev) {
          const inscritos = ev.total_inscritos || 0;
          return `📝 Inscripciones:\n\n` +
            `👥 Inscritos: ${inscritos} persona(s)\n` +
            `📊 Estado: ${ev.estado || 'Activo'}\n` +
            (ev.evento_externo ? `🌐 Evento abierto al público externo\n` : '') +
            `\nPara inscribirte, usa el botón de inscripción en la plataforma.`;
        }
        return 'Para inscribirte, contacta al organizador del evento o revisa el formulario de registro disponible en la plataforma.';

      // ── REQUISITOS ──
      case 'requisitos':
        if (ev?.segmentos?.length) {
          return `📋 Requisitos y Público Objetivo:\n\n` +
            `🎯 Dirigido a: ${ev.segmentos.join(', ')}\n` +
            `✅ Obligatorio: Estar registrado en el evento\n` +
            (ev.descripcion ? `\n📝 Descripción: ${ev.descripcion.substring(0, 200)}${ev.descripcion.length > 200 ? '...' : ''}\n` : '') +
            `\nPuedes preguntar por horarios, lugar u otros detalles.`;
        }
        return `📋 Requisitos para Participar:\n\n` +
          `✅ Obligatorios:\n• Estar registrado en el evento\n• Traer laptop con batería cargada\n• Tener conocimientos básicos del tema\n\n` +
          `📚 Recomendados:\n• Cuaderno para apuntes\n• USB para guardar material\n• Ganas de aprender`;

      // ── CONTACTO ──
      case 'contacto':
        if (ev) {
          let resp = `📞 Contacto del Evento:\n\n`;
          resp += `👤 Organizador: ${ev.organizador_nombre || ''} ${ev.organizador_apellido || ''}\n`;
          if (ev.organizador_email) resp += `📧 Email: ${ev.organizador_email}\n`;
          if (ev.comite_miembros?.length) {
            resp += `\n👥 Comité (${ev.comite_miembros.length} miembros):\n`;
            ev.comite_miembros.slice(0, 5).forEach(m => {
              resp += `  • ${m.nombre} (${m.rol})\n`;
            });
            if (ev.comite_miembros.length > 5) resp += `  ... y ${ev.comite_miembros.length - 5} más\n`;
          }
          resp += `\n💬 Usa este chat para dudas rápidas.`;
          return resp;
        }
        return `📞 Contacto y Soporte:\n\n👤 Organizador: Consulta la lista de miembros del comité\n💬 Chat: Usa este chat para dudas rápidas\n\nEstamos aquí para ayudarte.`;

      // ── MIEMBROS ──
      case 'miembros':
        if (ev) {
          let resp = `👥 Equipo Organizador:\n\n`;
          resp += `👤 Organizador: ${ev.organizador_nombre || 'Académico'} ${ev.organizador_apellido || ''}\n`;
          if (ev.comite_miembros?.length) {
            resp += `\n👥 Miembros del comité (${ev.comite_miembros.length}):\n`;
            ev.comite_miembros.forEach(m => {
              resp += `  • ${m.nombre} — ${m.rol}\n`;
            });
          } else {
            resp += `\n👥 Miembros del comité: ${ev.total_comite || 0} personas\n`;
          }
          resp += `\nPuedes escribir "contacto" para más datos.`;
          return resp;
        }
        return 'Puedes contactar al organizador directamente desde la lista de miembros del comité.';

      // ── ESTUDIANTES ──
      case 'estudiantes':
        if (ev) {
          const inscritos = ev.total_inscritos || 0;
          return `📊 Estadísticas de Participación:\n\n` +
            `👥 Total inscritos: ${inscritos} persona(s)\n` +
            `📝 Estado del evento: ${ev.estado || 'Activo'}\n` +
            (ev.comite_miembros?.length ? `👥 Comité organizador: ${ev.comite_miembros.length} miembros\n` : '') +
            `\n¡Cada vez somos más!`;
        }
        return 'Hay varios estudiantes inscritos en el evento. Revisa las estadísticas en el panel.';

      // ── PROGRAMA ──
      case 'programa':
        if (ev) {
          let resp = `📋 Programa del Evento:\n\n`;
          resp += `📝 ${ev.nombreevento || 'Evento'}\n`;
          resp += `📅 ${fmtFecha(ev.fechaevento)}\n`;
          resp += `⏰ ${ev.horaevento || 'Horario por confirmar'}\n`;
          resp += `📍 ${ev.lugarevento || 'Lugar por confirmar'}\n`;
          if (ev.descripcion) {
            resp += `\n📖 Descripción:\n${ev.descripcion.substring(0, 300)}${ev.descripcion.length > 300 ? '...' : ''}\n`;
          }
          resp += `\nEl programa puede sufrir modificaciones menores.`;
          return resp;
        }
        return `📋 Programa del Evento:\n\n⏰ 08:00 - 08:30 - Registro y bienvenida\n📅 08:30 - 10:00 - Primera sesión\n⏰ 10:00 - 10:30 - Pausa activa\n📅 10:30 - 12:00 - Segunda sesión\n⏰ 12:00 - 12:30 - Conclusiones y entrega de certificados\n\nNota: El programa puede sufrir modificaciones menores.`;

      // ── MATERIAL ──
      case 'material':
        return `📚 Material Necesario:\n\n` +
          `✅ Obligatorio:\n• Laptop con batería cargada\n• Conexión a internet (si es virtual/híbrido)\n\n` +
          `📚 Recomendado:\n• Cuaderno y lapicero\n• USB para guardar archivos\n• Audífonos (si es virtual)\n\n` +
          `El material de apoyo se proporcionará durante el evento.`;

      // ── EXPOSITOR ──
      case 'expositor':
        if (ev) {
          let resp = `🎓 Expositores del Evento:\n\n`;
          resp += `👤 Organizador: ${ev.organizador_nombre || 'Académico'} ${ev.organizador_apellido || ''}\n`;
          if (ev.comite_miembros?.length) {
            resp += `\n👥 Comité participante:\n`;
            ev.comite_miembros.forEach(m => {
              resp += `  • ${m.nombre}\n`;
            });
          }
          resp += `\nProfesionales con amplia experiencia en el tema.`;
          return resp;
        }
        return 'Los expositores están listados en la información del evento. Son profesionales con amplia experiencia.';

      // ── TEMA ──
      case 'tema':
        if (ev) {
          let resp = `📚 Sobre el Evento:\n\n`;
          resp += `🎯 Nombre: ${ev.nombreevento || 'Evento'}\n`;
          if (ev.tipos?.length) resp += `🏷️ Tipo: ${ev.tipos.join(', ')}\n`;
          if (ev.descripcion) resp += `\n📝 Descripción:\n${ev.descripcion.substring(0, 400)}${ev.descripcion.length > 400 ? '...' : ''}\n`;
          if (ev.objetivos?.length) {
            resp += `\n🎯 Objetivos:\n`;
            ev.objetivos.forEach(o => { resp += `  • ${o}\n`; });
          }
          return resp;
        }
        return 'Los temas del evento están en la descripción. Revisa los detalles para más información.';

      // ── DURACIÓN ──
      case 'duracion':
        if (ev) {
          return `⏱️ Duración del Evento:\n\n` +
            `📅 Fecha: ${fmtFecha(ev.fechaevento)}\n` +
            `⏰ Hora: ${ev.horaevento || 'Por confirmar'}\n` +
            `📍 Lugar: ${ev.lugarevento || 'Por confirmar'}\n\n` +
            `Te recomendamos llegar 15 minutos antes.`;
        }
        return 'La duración del evento está en los detalles. Generalmente dura entre 2-4 horas.';

      // ── SALUDO ──
      case 'saludo': {
        let resp = `¡Hola! 👋\n\nSoy tu asistente virtual del evento`;
        if (ev) resp += ` "${ev.nombreevento || ''}"`;
        resp += `. Estoy aquí para ayudarte con:\n\n` +
          `• 🕐 Horarios y fechas\n• 📍 Ubicación\n• 📜 Certificados\n` +
          `• 💰 Costos e inscripciones\n• 👥 Miembros del comité\n• 📊 Estadísticas\n`;
        if (ev?.objetivos?.length) resp += `• 🎯 Objetivos del evento\n`;
        if (ev?.tipos?.length) resp += `• 🏷️ Tipo de evento\n`;
        resp += `\n¿En qué puedo ayudarte hoy?`;
        return resp;
      }

      // ── GRACIAS ──
      case 'gracias':
        return `¡De nada! 😊\n\nEstoy aquí para ayudarte. Si tienes más preguntas, no dudes en preguntar.\n\n¡Que tengas un excelente día!`;

      // ── ADIÓS ──
      case 'adios':
        return `¡Hasta luego! 👋\n\nEspero verte en el evento. ¡Que tengas un excelente día!`;

      // ── AYUDA ──
      case 'ayuda': {
        let resp = `💡 Puedo ayudarte con:\n\n` +
          `• 🕐 Horarios - "¿A qué hora es?"\n` +
          `• 📍 Ubicación - "¿Dónde es?"\n` +
          `• 📅 Fechas - "¿Cuándo es?"\n` +
          `• 📜 Certificados - "¿Dan certificado?"\n` +
          `• 💰 Costos - "¿Cuánto cuesta?"\n` +
          `• 📝 Inscripciones - "¿Cómo me inscribo?"\n` +
          `• 👥 Miembros - "¿Quiénes organizan?"\n` +
          `• 📊 Estadísticas - "¿Cuántos inscritos?"\n`;
        if (ev?.objetivos?.length) resp += `• 🎯 Objetivos - "¿Cuáles son los objetivos?"\n`;
        if (ev?.tipos?.length) resp += `• 🏷️ Tipo - "¿Qué tipo de evento es?"\n`;
        if (ev?.segmentos?.length) resp += `• 🎯 Público - "¿A quién va dirigido?"\n`;
        resp += `\n¡Solo pregúntame!`;
        return resp;
      }

      // ── RECORDATORIO ──
      case 'recordatorio':
        return `⏰ Sistema de Recordatorios\n\n` +
          `Puedo ayudarte a crear recordatorios de varias formas:\n\n` +
          `📱 Desde el chat:\nEscribe: "recuérdame [fecha] [tarea]"\n` +
          `Ejemplo: "recuérdame mañana revisar el evento"\n\n` +
          `📲 Por Telegram:\n1. Vincula tu cuenta\n2. Recibirás alertas automáticas\n\n` +
          `🔔 Recordatorios automáticos:\n• 3 días antes del evento\n• El día del evento\n\n` +
          `¿Quieres crear un recordatorio ahora?`;

      // ── OBJETIVOS (nuevo) ──
      case 'objetivos':
        if (ev?.objetivos?.length) {
          let resp = `🎯 Objetivos del Evento:\n\n`;
          ev.objetivos.forEach((o, i) => { resp += `${i + 1}. ${o}\n`; });
          if (ev.descripcion) resp += `\n📝 ${ev.descripcion.substring(0, 200)}${ev.descripcion.length > 200 ? '...' : ''}`;
          return resp;
        }
        if (ev) return `🎯 El evento "${ev.nombreevento || ''}" aún no tiene objetivos registrados.\n\nPuedes preguntar por otros detalles como horarios, ubicación o inscripciones.`;
        return 'No tengo información sobre los objetivos de este evento.';

      // ── TIPO (nuevo) ──
      case 'tipo':
        if (ev) {
          let resp = `🏷️ Tipo de Evento:\n\n`;
          resp += `📝 Evento: ${ev.nombreevento || 'Sin nombre'}\n`;
          if (ev.tipos?.length) resp += `🏷️ Tipo(s): ${ev.tipos.join(', ')}\n`;
          if (ev.facultades?.length) resp += `🏫 Facultad: ${ev.facultades.join(', ')}\n`;
          if (ev.estado) resp += `📊 Estado: ${ev.estado}\n`;
          if (ev.evento_externo) resp += `🌐 Evento externo (abierto al público)\n`;
          return resp;
        }
        return 'No tengo información sobre el tipo de evento.';

      // ── PÚBLICO / AUDIENCIA (nuevo) ──
      case 'publico':
        if (ev?.segmentos?.length) {
          let resp = `🎯 Público Objetivo:\n\n`;
          resp += `👥 Dirigido a: ${ev.segmentos.join(', ')}\n`;
          if (ev.facultades?.length) resp += `🏫 Facultad(es): ${ev.facultades.join(', ')}\n`;
          if (ev.descripcion) resp += `\n📝 ${ev.descripcion.substring(0, 200)}${ev.descripcion.length > 200 ? '...' : ''}`;
          return resp;
        }
        if (ev) return `🎯 El evento "${ev.nombreevento || ''}" no tiene segmento específico definido.\n\nPuedes preguntar por otros detalles.`;
        return 'No tengo información sobre el público objetivo de este evento.';

      // ── FACULTAD (nuevo) ──
      case 'facultad':
        if (ev) {
          let resp = `🏫 Facultad del Evento:\n\n`;
          resp += `📝 Evento: ${ev.nombreevento || 'Sin nombre'}\n`;
          if (ev.facultades?.length) resp += `🏫 Facultad(es): ${ev.facultades.join(', ')}\n`;
          else resp += `🏫 Facultad: No especificada\n`;
          if (ev.organizador_nombre) resp += `👤 Organizador: ${ev.organizador_nombre} ${ev.organizador_apellido || ''}\n`;
          return resp;
        }
        return 'No tengo información sobre la facultad de este evento.';

      // ── FASE (nuevo) ──
      case 'fase':
        if (ev) {
          return `📊 Fase del Evento:\n\n` +
            `📝 Evento: ${ev.nombreevento || 'Sin nombre'}\n` +
            `📊 Estado: ${ev.estado || 'No definido'}\n` +
            (ev.fase_actual ? `🔢 Fase actual: ${ev.fase_actual}\n` : '') +
            `\nPuedes preguntar por horarios, ubicación u otros detalles.`;
        }
        return 'No tengo información sobre la fase de este evento.';

      // ── DEFAULT ──
      default:
        if (palabras.some(p => ['hola', 'hi', 'hey', 'buenas', 'ey', 'que tal', 'holi'].includes(p))) {
          return `¡Hola! 👋 Soy tu asistente virtual${ev ? ` del evento "${ev.nombreevento || ''}"` : ''}. Pregúntame sobre horarios, ubicación, certificados, costos o inscripciones.`;
        }
        if (palabras.some(p => ['hora', 'horario', 'tiempo'].includes(p))) {
          return ev
            ? `⏰ El evento es a las ${ev.horaevento || 'por confirmar'} del día ${fmtFecha(ev.fechaevento)}.`
            : 'El horario está disponible en los detalles del evento.';
        }
        if (palabras.some(p => ['lugar', 'donde', 'ubicacion'].includes(p))) {
          return ev
            ? `📍 El evento se realiza en: ${ev.lugarevento || 'por confirmar'}.`
            : 'El lugar está especificado en los detalles.';
        }
        if (palabras.some(p => ['certificado', 'diploma'].includes(p))) {
          return '✅ Sí se entrega certificado con 90% de asistencia.';
        }
        return `No tengo información específica sobre eso. 😅\n\n` +
          `Puedes preguntarme sobre:\n• Horarios y fechas\n• Ubicación\n• Certificados\n• Costos\n• Inscripciones\n• Miembros del comité\n• Objetivos\n• Tipo de evento\n\n` +
          `O escribe "ayuda" para ver todas las opciones.`;
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
