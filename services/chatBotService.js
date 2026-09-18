async _continuarCreacion(userId, pregunta) {
    const sesion = this.sesionesCreacion.get(userId);
    const { step, data } = sesion;
    const t = pregunta.trim();

    if (/^(cancelar|cancela|cancel|detener|parar|salir)\b/i.test(t)) {
      this.sesionesCreacion.delete(userId);
      return { respuesta: '❌ Creación cancelada. No se creó ningún evento.\n\nPuedes volver a empezar con "crear evento".' };
    }

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

      case 'fecha': {
        const fechaMin = this._fechaLocal(14);
        const fechas = await this._obtenerFechasDisponibles();

        let fecha = null;
        if (/^\d{1,2}$/.test(t)) {
          const idx = parseInt(t, 10) - 1;
          fecha = fechas[idx] || null;
          if (!fecha) {
            return { respuesta: `⚠️ Elige un número entre 1 y ${fechas.length}.\n\n${this._mensajeFechasDisponibles(fechas)}` };
          }
        } else {
          fecha = this._parseFecha(t);
        }

        if (!fecha) {
          return { respuesta: `⚠️ Fecha no válida. Usa el formato YYYY-MM-DD (ej: ${fechaMin}), "hoy", "mañana" o elige un número de la lista.\n\n${this._mensajeFechasDisponibles(fechas)}` };
        }

        if (String(fecha).slice(0, 10) < fechaMin) {
          return { respuesta: `⚠️ El evento debe crearse con al menos <b>2 semanas (14 días) de anticipación</b>. La fecha más próxima permitida es ${this._fmtFechaLarga(fechaMin)}.\n\n${this._mensajeFechasDisponibles(fechas)}` };
        }

        if (!(await this._diaTieneCupo(fecha))) {
          return { respuesta: `⚠️ El día ${this._fmtFechaLarga(fecha)} ya tiene 2 eventos programados (máximo permitido). Elige otra fecha.\n\n${this._mensajeFechasDisponibles(fechas)}` };
        }

        data.fechaevento = String(fecha).slice(0, 10);
        this.sesionesCreacion.set(userId, { step: 'clasificacion', data, fecha: data.fechaevento });
        return { respuesta: `📅 <b>Fecha:</b> ${this._fmtFechaLarga(data.fechaevento)}\n\n📚 <b>Clasificación estratégica:</b>\n\n1. Academia y Científica\n2. Institucionales y Ceremoniales\n3. Culturales, Deportivos y Sociales\n4. Extension Universitaria, Vinculacion Profesional y Atraccion Estudiantil\n5. Internacionalizacion y Posicionamiento\n\nResponde con el <b>número</b> de la clasificación (1-5).` };
      }

      case 'clasificacion': {
        const t = pregunta.trim();
        if (!/^[1-5]$/.test(t)) {
          return { respuesta: `⚠️ Por favor, responde con un número del 1 al 5.\n\n1. Academia y Científica\n2. Institucionales y Ceremoniales\n3. Culturales, Deportivos y Sociales\n4. Extension Universitaria, Vinculacion Profesional y Atraccion Estudiantil\n5. Internacionalizacion y Posicionamiento` };
        }
        data.idclasificacion = parseInt(t, 10);
        this.sesionesCreacion.set(userId, { step: 'subcategoria', data });
        return { respuesta: `⚠️ Has seleccionado la clasificación <b>${data.idclasificacion}</b>.\n\nAhora elige la <b>subcategoría</b>:\n\n` + this._subcategorias(data.idclasificacion) };
      }

      case 'subcategoria': {
        const t = pregunta.trim();
        const subcategoriaMatch = t.match(/^([1-5])([a-z])$/i);
        if (!subcategoriaMatch) {
          return { respuesta: `⚠️ Código de subcategoría no válido.\n\nFormato: <b>1a</b>, <b>2b</b>, etc.\n\nEjemplo: <b>1a</b> para Congreso dentro de Academia y Científica.` };
        }
        const [, idClas, idSub] = subcategoriaMatch;
        const subcategorias = this._subcategorias(parseInt(idClas, 10));
        if (!subcategorias || !subcategorias.some(s => s.id === idSub)) {
          return { respuesta: `⚠️ La subcategoría <b>${idSub}</b> no existe para la clasificación <b>${idClas}</b>.\n\nPor favor, usa un código válido.` };
        }
        data.idsubcategoria = parseInt(idSub, 10);
        this.sesionesCreacion.set(userId, { step: 'tipo_evento', data });
        return { respuesta: `✅ Subcategoría <b>${data.idsubcategoria}</b> seleccionada.\n\nAhora elige el <b>tipo de evento</b>:\n1. Curricular\n2. Extracurricular\n3. Marketing\n4. Internacionalizacion/Marketing\n5. Marketing/Extracurricular` };
      }

      case 'tipo_evento': {
        const t = pregunta.trim();
        const tiposEvento = [
          'Curricular',
          'Extracurricular',
          'Marketing',
          'Internacionalizacion/Marketing',
          'Marketing/Extracurricular'
        ];
        if (!/^[1-5]$/.test(t)) {
          return { respuesta: `⚠️ Por favor, responde con un número del 1 al 5.\n\n1. Curricular\n2. Extracurricular\n3. Marketing\n4. Internacionalizacion/Marketing\n5. Marketing/Extracurricular` };
        }
        data.tipo_evento = tiposEvento[parseInt(t, 10) - 1];
        sesion.step = data.nombreevento ? 'hora' : 'nombre';
        this.sesionesCreacion.set(userId, sesion);
        let msg = `✅ Tipo de evento: <b>${data.tipo_evento}</b>\n\n`;
        msg += data.nombreevento
          ? `⏰ ¿A qué <b>hora</b>? (HH:MM en formato 24h, ej: 19:00 o "7:30 PM")`
          : `✏️ <b>¿Cuál es el nombre</b> del evento?`;
        return { respuesta: msg };
      }

      case 'lugar': {
        const places = ['Biblioteca', 'Hall', 'Boulevard', 'Auditorio', 'Jardín 1', 'Aula 310', 'Game Room'];
        let lugar = null;
        if (/^\d{1,2}$/.test(t)) {
          const idx = parseInt(t, 10);
          if (idx >= 1 && idx <= places.length) {
            lugar = places[idx - 1];
          }
        }
        if (lugar === null) {
          if (/^(por definir|sin definir|todavia|todavía|no se|prefiero no decirlo|\?\?*)$/i.test(t.trim())) {
            lugar = 'Por definir';
          } else {
            lugar = t.slice(0, 100).trim();
          }
        }
        data.lugarevento = lugar;
        sesion.step = 'confirmar';
        this.sesionesCreacion.set(userId, sesion);
        return {
          respuesta: `📋 RESUMEN DEL EVENTO:\n\n📝 Nombre: ${data.nombreevento}\n📅 Fecha: ${this._fmtFechaLarga(data.fechaevento)}\n⏰ Hora: ${data.horaevento}\n📍 Lugar: ${lugar}\n\n¿Confirmas la creación? Responde Sí para confirmar o No para cancelar.`
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
  }
