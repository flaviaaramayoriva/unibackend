const { Op } = require('sequelize');
const { getModels } = require('../models/index.js');

const CLASIFICACIONES = [
  'Academia y Científica',
  'Institucionales y Ceremoniales',
  'Culturales, Deportivos y Sociales',
  'Extension Universitaria, Vinculacion Profesional y Atraccion Estudiantil',
  'Internacionalizacion y Posicionamiento'
];
const LUGARES = ['Biblioteca', 'Hall', 'Boulevard', 'Auditorio', 'Jardín 1', 'Aula 310', 'Game Room'];
const TIPOS_EVENTO = [
  'Curricular',
  'Extracurricular',
  'Marketing',
  'Internacionalizacion/Marketing',
  'Marketing/Extracurricular'
];

const chatBotService = {
  sesionesCreacion: new Map(),

  extraerPregunta(mensaje) {
    const trimmed = mensaje.trim().toLowerCase();
    if (/^(crear evento|crear|nuevo evento)\b/.test(trimmed)) {
      return 'crear evento';
    }
    if (/^(cancelar|cancela|cancel|detener|parar|salir)\b/.test(trimmed)) {
      return 'cancelar';
    }
    return trimmed;
  },

  generarRespuesta(pregunta, eventId, userId) {
    if (pregunta === 'crear evento') {
      return this._continuarCreacion(userId, pregunta);
    }
    if (pregunta === 'cancelar') {
      this.sesionesCreacion.delete(userId);
      return { respuesta: '❌ Creación cancelada. No se creó ningún evento.\n\nPuedes volver a empezar con "crear evento".' };
    }
    if (this.sesionesCreacion.has(userId)) {
      return this._continuarCreacion(userId, pregunta);
    }
    return { respuesta: 'No entendí tu pregunta. Escribe "crear evento" para empezar.' };
  },

  async _continuarCreacion(userId, pregunta) {
    const t = (pregunta || '').trim();

    if (/^(cancelar|cancela|cancel|detener|parar|salir)\b/i.test(t)) {
      this.sesionesCreacion.delete(userId);
      return { respuesta: '❌ Creación cancelada. No se creó ningún evento.\n\nPuedes volver a empezar con "crear evento".' };
    }

    let sesion = this.sesionesCreacion.get(userId);

    if (!sesion) {
      if (!userId) {
        return { respuesta: '⚠️ No se pudo iniciar la sesión. Intenta de nuevo.' };
      }
      sesion = { step: 'nombre', data: {} };
      this.sesionesCreacion.set(userId, sesion);
      return { respuesta: '✏️ ¿Cuál es el nombre del evento?\n\n(Escribe "cancelar" en cualquier momento para salir.)' };
    }

    const { step, data } = sesion;

    switch (step) {
      case 'nombre': {
        const nombre = t.slice(0, 120);
        if (nombre.length < 2) {
          return { respuesta: '⚠️ El nombre debe tener al menos 2 caracteres. ✏️ ¿Cuál es el nombre del evento?' };
        }
        data.nombreevento = nombre;
        sesion.step = 'hora';
        this.sesionesCreacion.set(userId, sesion);
        return { respuesta: `✅ Nombre: ${nombre}\n\n⏰ ¿A qué hora? (HH:MM en formato 24h, ej: 19:00 o "7:30 PM")` };
      }

      case 'hora': {
        const hora = this._parseHora(t);
        if (!hora) {
          return { respuesta: '⚠️ Hora no válida. Usa el formato 24h (ej: 19:00) o 12h (ej: 7:30 PM).' };
        }
        data.horaevento = hora;
        sesion.step = 'fecha';
        this.sesionesCreacion.set(userId, sesion);
        return { respuesta: `✅ Hora: ${hora.slice(0, 5)}\n\n📅 ¿Cuál es la fecha del evento?\n\nUsa el formato YYYY-MM-DD (ej: 2026-10-15), "hoy" o "mañana", o elige un número de la lista.\n\n${await this._mensajeFechasDisponibles(await this._obtenerFechasDisponibles())}` };
      }

      case 'fecha': {
        const fechas = await this._obtenerFechasDisponibles();
        const fechaMin = this._fechaStr(this._fechaLocal(14));

        let fecha = null;
        if (/^\d{1,2}$/.test(t)) {
          const idx = parseInt(t, 10) - 1;
          fecha = fechas[idx] || null;
          if (!fecha) {
            return { respuesta: `⚠️ Elige un número entre 1 y ${fechas.length}.\n\n${await this._mensajeFechasDisponibles(fechas)}` };
          }
        } else {
          fecha = this._parseFecha(t);
        }

        if (!fecha) {
          return { respuesta: `⚠️ Fecha no válida. Usa el formato YYYY-MM-DD (ej: ${fechaMin}), "hoy", "mañana" o elige un número de la lista.\n\n${await this._mensajeFechasDisponibles(fechas)}` };
        }

        if (fecha < fechaMin) {
          return { respuesta: `⚠️ El evento debe crearse con al menos <b>2 semanas (14 días) de anticipación</b>. La fecha más próxima permitida es ${this._fmtFechaLarga(fechaMin)}.\n\n${await this._mensajeFechasDisponibles(fechas)}` };
        }

        if (!(await this._diaTieneCupo(fecha))) {
          return { respuesta: `⚠️ El día ${this._fmtFechaLarga(fecha)} ya tiene 2 eventos programados (máximo permitido). Elige otra fecha.\n\n${await this._mensajeFechasDisponibles(fechas)}` };
        }

        data.fechaevento = fecha;
        sesion.step = 'clasificacion';
        this.sesionesCreacion.set(userId, sesion);
        return { respuesta: `📅 <b>Fecha:</b> ${this._fmtFechaLarga(fecha)}\n\n📚 <b>Clasificación estratégica:</b>\n\n${this._menuClasificaciones()}\n\nResponde con el <b>número</b> de la clasificación (1-5).` };
      }

      case 'clasificacion': {
        if (!/^[1-5]$/.test(t)) {
          return { respuesta: `⚠️ Por favor, responde con un número del 1 al 5.\n\n${this._menuClasificaciones()}` };
        }
        data.idclasificacion = parseInt(t, 10);
        sesion.step = 'subcategoria';
        this.sesionesCreacion.set(userId, sesion);
        return { respuesta: `Has seleccionado la clasificación <b>${data.idclasificacion}. ${CLASIFICACIONES[data.idclasificacion - 1]}</b>.\n\nAhora elige la <b>subcategoría</b>:\n\n${await this._subcategorias(data.idclasificacion)}` };
      }

      case 'subcategoria': {
        const match = t.match(/^([1-5])([a-z])$/i);
        if (!match) {
          return { respuesta: `⚠️ Código de subcategoría no válido.\n\nFormato: <b>1a</b>, <b>2b</b>, etc.\n\n${await this._subcategorias(data.idclasificacion)}` };
        }
        const [, idClas, letra] = match;
        const items = await this._getSubcategoriasData(parseInt(idClas, 10));
        const idx = letra.toLowerCase().charCodeAt(0) - 97;
        const item = items[idx];
        if (!items.length || !item) {
          return { respuesta: `⚠️ La subcategoría <b>${letra}</b> no existe para la clasificación <b>${idClas}</b>.\n\n${await this._subcategorias(parseInt(idClas, 10))}` };
        }
        data.idsubcategoria = item.idsubcategoria;
        sesion.step = 'tipo_evento';
        this.sesionesCreacion.set(userId, sesion);
        return { respuesta: `✅ Subcategoría: <b>${item.nombreSubcategoria}</b>\n\nAhora elige el <b>tipo de evento</b>:\n${this._menuTiposEvento()}` };
      }

      case 'tipo_evento': {
        if (!/^[1-5]$/.test(t)) {
          return { respuesta: `⚠️ Por favor, responde con un número del 1 al 5.\n\n${this._menuTiposEvento()}` };
        }
        data.tipo_evento = TIPOS_EVENTO[parseInt(t, 10) - 1];
        sesion.step = 'lugar';
        this.sesionesCreacion.set(userId, sesion);
        return { respuesta: `✅ Tipo de evento: <b>${data.tipo_evento}</b>\n\n📍 ¿En qué <b>lugar</b> se realizará?\n\n1. Biblioteca\n2. Hall\n3. Boulevard\n4. Auditorio\n5. Jardín 1\n6. Aula 310\n7. Game Room\n\nEscribe el número o el nombre del lugar (o "Por definir").` };
      }

      case 'lugar': {
        let lugar = null;
        if (/^\d{1,2}$/.test(t)) {
          const idx = parseInt(t, 10);
          if (idx >= 1 && idx <= LUGARES.length) {
            lugar = LUGARES[idx - 1];
          }
        }
        if (lugar === null) {
          if (/^(por definir|sin definir|todavia|todavía|no se|prefiero no decirlo|\?\?*)$/i.test(t.trim())) {
            lugar = 'Por definir';
          } else {
            lugar = t.slice(0, 100).trim() || 'Por definir';
          }
        }
        data.lugarevento = lugar;
        sesion.step = 'confirmar';
        this.sesionesCreacion.set(userId, sesion);
        return {
          respuesta: `📋 RESUMEN DEL EVENTO:\n\n📝 Nombre: ${data.nombreevento}\n📅 Fecha: ${this._fmtFechaLarga(data.fechaevento)}\n⏰ Hora: ${data.horaevento.slice(0, 5)}\n📍 Lugar: ${lugar}\n📚 Clasificación: ${CLASIFICACIONES[(data.idclasificacion || 1) - 1]}\n\n¿Confirmas la creación? Responde <b>Sí</b> para confirmar o <b>No</b> para cancelar.`
        };
      }

      case 'confirmar': {
        if (/^(s[ií]|confirmo|confirmar|dale|listo|adelante|acepto|crear)\b/i.test(t)) {
          const resultado = await this._crearEventoFinal(userId, data);
          this.sesionesCreacion.delete(userId);
          return { respuesta: resultado.respuesta };
        }
        this.sesionesCreacion.delete(userId);
        return { respuesta: '❌ Creación cancelada. No se creó ningún evento.\n\nPuedes volver a empezar con "crear evento".' };
      }

      default:
        this.sesionesCreacion.delete(userId);
        return { respuesta: '⚠️ Algo salió mal con la sesión. Escribe "crear evento" para empezar de nuevo.' };
    }
  },

  _menuClasificaciones() {
    return CLASIFICACIONES.map((c, i) => `${i + 1}. ${c}`).join('\n');
  },

  _menuTiposEvento() {
    return TIPOS_EVENTO.map((c, i) => `${i + 1}. ${c}`).join('\n');
  },

  _fechaLocal(dias) {
    const fecha = new Date();
    fecha.setHours(12, 0, 0, 0);
    fecha.setDate(fecha.getDate() + dias);
    return fecha;
  },

  _fechaStr(d) {
    if (typeof d === 'string') return d.slice(0, 10);
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  },

  _validarFecha(y, mo, d) {
    const dt = new Date(y, mo - 1, d);
    const ok = dt.getFullYear() === Number(y) && dt.getMonth() === mo - 1 && dt.getDate() === Number(d);
    if (!ok) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  },

  _parseHora(texto) {
    const t = (texto || '').trim();
    let m = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(t);
    if (m) {
      let h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const merid = (m[3] || '').toLowerCase();
      if (min > 59) return null;
      if (merid) {
        if (h > 12) return null;
        if (merid === 'pm' && h !== 12) h += 12;
        if (merid === 'am' && h === 12) h = 0;
      } else if (h > 23) {
        return null;
      }
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
    }
    m = /^(\d{1,2})\s*(am|pm)$/i.exec(t);
    if (m) {
      let h = parseInt(m[1], 10);
      const merid = m[2].toLowerCase();
      if (h > 12) return null;
      if (merid === 'pm' && h !== 12) h += 12;
      if (merid === 'am' && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:00:00`;
    }
    return null;
  },

  _parseFecha(texto) {
    const t = (texto || '').trim().toLowerCase();
    if (t === 'hoy' || t === 'hoy mismo') return this._fechaStr(this._fechaLocal(0));
    if (t === 'mañana' || t === 'manana') return this._fechaStr(this._fechaLocal(1));
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (m) return this._validarFecha(Number(m[1]), Number(m[2]), Number(m[3]));
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (m) return this._validarFecha(Number(m[3]), Number(m[2]), Number(m[1]));
    return null;
  },

  async _obtenerFechasDisponibles(limite = 25) {
    try {
      const { Evento } = getModels();
      const filas = await Evento.findAll({
        attributes: ['fechaevento'],
        where: {
          fechaevento: { [Op.gte]: this._fechaStr(this._fechaLocal(0)) },
          estado: { [Op.in]: ['pendiente', 'aprobado'] }
        },
        raw: true
      });
      const porDia = {};
      (filas || []).forEach(f => {
        const d = String(f.fechaevento).slice(0, 10);
        porDia[d] = (porDia[d] || 0) + 1;
      });
      const disponibles = [];
      const base = this._fechaLocal(0);
      for (let i = 0; i < 60 && disponibles.length < limite; i++) {
        const d = new Date(base);
        d.setDate(base.getDate() + i);
        const dStr = this._fechaStr(d);
        if ((porDia[dStr] || 0) < 2) disponibles.push(dStr);
      }
      return disponibles;
    } catch (err) {
      console.error('chatBotService/_obtenerFechasDisponibles error:', err.message);
      return [];
    }
  },

  async _diaTieneCupo(fecha) {
    try {
      const { Evento } = getModels();
      const dias = `${fecha} 00:00:00`;
      const diaf = `${fecha} 23:59:59`;
      const filas = await Evento.findAll({
        attributes: ['idevento'],
        where: {
          fechaevento: { [Op.gte]: dias, [Op.lte]: diaf },
          estado: { [Op.in]: ['pendiente', 'aprobado'] }
        },
        raw: true
      });
      return (filas || []).length < 2;
    } catch (err) {
      console.error('chatBotService/_diaTieneCupo error:', err.message);
      return true;
    }
  },

  async _horaConflictoMismoDia(fecha, hora) {
    try {
      const { Evento } = getModels();
      const filas = await Evento.findAll({
        attributes: ['horaevento'],
        where: {
          fechaevento: { [Op.gte]: `${fecha} 00:00:00`, [Op.lte]: `${fecha} 23:59:59` },
          estado: { [Op.in]: ['pendiente', 'aprobado'] }
        },
        raw: true
      });
      const minNueva = this._minutos(hora);
      return (filas || []).some(e => {
        const m = this._minutos(e.horaevento);
        return m !== null && minNueva !== null && Math.abs(m - minNueva) < 120;
      });
    } catch (err) {
      console.error('chatBotService/_horaConflictoMismoDia error:', err.message);
      return false;
    }
  },

  _minutos(h) {
    const c = /^(\d{1,2}):(\d{2})/.exec(String(h || ''));
    return c ? parseInt(c[1], 10) * 60 + parseInt(c[2], 10) : null;
  },

  async _mensajeFechasDisponibles(fechas) {
    if (!fechas || fechas.length === 0) {
      return 'Las fechas disponibles serán raras; puedes indicar una fecha con el formato YYYY-MM-DD.';
    }
    return fechas.slice(0, 20).map((f, i) => `${i + 1}. ${this._fmtFechaLarga(f)}`).join('\n');
  },

  _fmtFechaLarga(fecha) {
    const f = String(fecha).slice(0, 10);
    const dt = new Date(`${f}T12:00:00`);
    if (isNaN(dt.getTime())) return f;
    return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(dt);
  },

  async _getSubcategoriasData(idClasificacion) {
    try {
      const { Subcategoria } = getModels();
      const rows = await Subcategoria.findAll({
        where: { idclasificacion: idClasificacion },
        order: [['idsubcategoria', 'ASC']],
        raw: true
      });
      return rows || [];
    } catch (err) {
      console.error('chatBotService/_getSubcategoriasData error:', err.message);
      return [];
    }
  },

  async _subcategorias(idClasificacion) {
    const items = await this._getSubcategoriasData(idClasificacion);
    if (!items.length) return '(sin subcategorías cargadas para esta clasificación)';
    return items.map((s, i) => `${idClasificacion}${String.fromCharCode(97 + i)}) ${s.nombreSubcategoria}`).join('\n');
  },

  async _crearEventoFinal(userId, data) {
    try {
      if (!data.nombreevento || !data.fechaevento || !data.horaevento) {
        return { respuesta: '⚠️ Faltan datos básicos. Escribe "crear evento" para empezar de nuevo.' };
      }
      if (await this._horaConflictoMismoDia(data.fechaevento, data.horaevento)) {
        return { respuesta: `⚠️ Ya existe un evento pendiente o aprobado el día ${this._fmtFechaLarga(data.fechaevento)} a esa hora (rango de 2 horas). Elige otra fecha u hora.` };
      }

      const { Evento, Fase } = getModels();

      const nuevoEvento = await Evento.create({
        nombreevento: data.nombreevento,
        lugarevento: data.lugarevento || 'Por definir',
        fechaevento: data.fechaevento,
        horaevento: data.horaevento,
        idacademico: userId,
        idclasificacion: data.idclasificacion || null,
        idsubcategoria: data.idsubcategoria || null,
        estado: 'pendiente',
        evento_externo: false
      });

      try {
        const fase = await Fase.findOne({ where: { nrofase: 1 }, attributes: ['idfase'] });
        if (fase) {
          nuevoEvento.idfase = fase.idfase;
          await nuevoEvento.save();
        }
      } catch (e) {
        console.warn('chatBotService/_crearEventoFinal: no se pudo asignar fase:', e.message);
      }

      return {
        respuesta: `✅ ¡Evento creado correctamente!\n\n📝 ${nuevoEvento.nombreevento}\n📅 ${this._fmtFechaLarga(data.fechaevento)}\n⏰ ${data.horaevento.slice(0, 5)}\n📍 ${nuevoEvento.lugarevento}\n\nEstado: <b>pendiente</b> de aprobación.`
      };
    } catch (err) {
      console.error('chatBotService/_crearEventoFinal error:', err.message);
      return { respuesta: '⚠️ No se pudo crear el evento. Intenta de nuevo más tarde.' };
    }
  }
};

module.exports = chatBotService;