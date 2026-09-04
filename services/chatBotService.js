const brain = require('brain.js');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

class ChatBotService {
  constructor() {
    this.net = null;
    this.isTrained = false;
    this.eventoCache = null;
    this.cacheTime = null;
    
    this.entrenar();
  }

  entrenar() {
    const trainingData = [
      { input: { hola: 1, buen: 1, hey: 1 }, output: { saludo: 1 } },
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
    ];

    this.net = new brain.NeuralNetwork({ hiddenLayers: [5], activation: 'sigmoid' });
    this.net.train(trainingData, { iterations: 1000, errorThresh: 0.005, log: false });
    this.isTrained = true;
    console.log('✅ ChatBot IA entrenado con Brain.js - Versión Mejorada');
  }

  async getEventoInfo(eventoId) {
    // Usar caché por 5 minutos para no saturar la BD
    if (this.eventoCache && this.cacheTime && (Date.now() - this.cacheTime < 300000)) {
      return this.eventoCache;
    }

    try {
      const result = await pool.query(`
        SELECT 
          e.nombreevento,
          e.fechaevento,
          e.horaevento,
          e.lugarevento,
          e.descripcion,
          e.duracion,
          e.costo,
          e.cupo_maximo,
          e.estado,
          u.nombre as organizador_nombre,
          u.apellidopat as organizador_apellido,
          (SELECT COUNT(*) FROM estudiantes_inscritos ei WHERE ei.idevento = e.idevento) as total_inscritos,
          (SELECT COUNT(*) FROM comite c WHERE c.idevento = e.idevento) as total_comite
        FROM evento e
        LEFT JOIN users u ON e.idacademico = u.id
        WHERE e.idevento = $1
      `, [eventoId]);

      this.eventoCache = result.rows[0] || null;
      this.cacheTime = Date.now();
      return this.eventoCache;
    } catch (error) {
      console.error(' Error al obtener info del evento:', error);
      return null;
    }
  }

  async generarRespuesta(pregunta, eventoId = null) {
    try {
      const preguntaLower = pregunta.toLowerCase();
      const palabras = preguntaLower.split(/\s+/);
      
      // Obtener información del evento si tenemos el ID
      const eventoInfo = eventoId ? await this.getEventoInfo(eventoId) : null;

      // Preparar input para la red neuronal
      const input = {};
      palabras.forEach(p => {
        const limpia = p.replace(/[.,!?;:]/g, '');
        if (limpia.length > 2) input[limpia] = 1;
      });

      const output = this.net.run(input);
      
      // Encontrar la categoría con mayor probabilidad
      let mejorCategoria = null;
      let mejorProbabilidad = 0;
      
      for (const [categoria, probabilidad] of Object.entries(output)) {
        if (probabilidad > mejorProbabilidad && probabilidad > 0.3) {
          mejorProbabilidad = probabilidad;
          mejorCategoria = categoria;
        }
      }

      // Generar respuesta contextual basada en la categoría y datos reales
      let respuesta = '';
      
      switch (mejorCategoria) {
        case 'hora':
          if (eventoInfo) {
            respuesta = `📅 **Información del Horario:**\n\n` +
                       `⏰ *Hora:* ${eventoInfo.horaevento || 'Por confirmar'}\n` +
                       `📆 *Fecha:* ${eventoInfo.fechaevento ? new Date(eventoInfo.fechaevento).toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Por confirmar'}\n` +
                       `⏱️ *Duración estimada:* ${eventoInfo.duracion || '2-3 horas'}\n\n` +
                       `Te recomiendo llegar 15 minutos antes.`;
          } else {
            respuesta = 'El horario del evento está disponible en los detalles. Revisa la información del evento para confirmar la hora exacta.';
          }
          break;

        case 'lugar':
          if (eventoInfo) {
            respuesta = `📍 **Ubicación del Evento:**\n\n` +
                       `🏛️ *Lugar:* ${eventoInfo.lugarevento || 'Por confirmar'}\n` +
                       `📝 *Evento:* ${eventoInfo.nombreevento || 'Evento'}\n\n` +
                       `Si tienes dudas sobre cómo llegar, contacta al organizador.`;
          } else {
            respuesta = 'El lugar del evento está especificado en los detalles. Puedes consultarlo en la información del evento.';
          }
          break;

        case 'fecha':
          if (eventoInfo) {
            const fecha = eventoInfo.fechaevento ? new Date(eventoInfo.fechaevento) : null;
            respuesta = ` **Fecha del Evento:**\n\n` +
                       `🗓️ *Día:* ${fecha ? fecha.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Por confirmar'}\n` +
                       `⏰ *Hora:* ${eventoInfo.horaevento || 'Por confirmar'}\n\n` +
                       `¡No faltes!`;
          } else {
            respuesta = 'La fecha del evento está disponible en los detalles.';
          }
          break;

        case 'certificado':
          respuesta = `📜 **Información sobre Certificados:**\n\n` +
                     `✅ *Sí se entrega certificado* al finalizar el evento\n` +
                     `📋 *Requisitos:* Asistencia completa (mínimo 90%)\n` +
                     `⏰ *Entrega:* Al finalizar el evento o dentro de 5 días hábiles\n\n` +
                     `El certificado incluye horas de capacitación y es válido para tu expediente.`;
          break;

        case 'costo':
          if (eventoInfo) {
            const costo = eventoInfo.costo || 0;
            if (costo == 0 || costo === '0' || costo === 'gratis' || costo === 'gratuito') {
              respuesta = `💰 **Costo del Evento:**\n\n` +
                         `🎉 *¡GRATIS!* Este evento es completamente gratuito\n` +
                         `✅ *Incluye:* Material, certificado y refrigerio (si aplica)\n\n` +
                         `Solo necesitas registrarte con anticipación.`;
            } else {
              respuesta = ` **Inversión del Evento:**\n\n` +
                         `💵 *Costo:* Bs. ${costo}\n` +
                         `📝 *Incluye:* Material, certificado y refrigerio\n\n` +
                         `Puedes realizar el pago el día del evento o con anticipación.`;
            }
          } else {
            respuesta = 'Este evento es gratuito para todos los participantes registrados.';
          }
          break;

        case 'inscripcion':
          if (eventoInfo) {
            const inscritos = eventoInfo.total_inscritos || 0;
            const cupoMax = eventoInfo.cupo_maximo || 50;
            const disponibles = cupoMax - inscritos;
            
            respuesta = `📝 **Inscripciones:**\n\n` +
                       `👥 *Inscritos:* ${inscritos} de ${cupoMax} cupos\n` +
                       `${disponibles > 0 ? `✅ *Cupos disponibles:* ${disponibles}\n` : `️ *Cupo lleno*\n`}\n` +
                       ` *Cómo inscribirse:* Contacta al organizador o usa el formulario de registro\n\n` +
                       `¡Inscríbete antes de que se agoten los cupos!`;
          } else {
            respuesta = 'Para inscribirte, contacta al organizador del evento o revisa el formulario de registro disponible en la plataforma.';
          }
          break;

        case 'requisitos':
          respuesta = `📋 **Requisitos para Participar:**\n\n` +
                     `✅ *Obligatorios:*\n` +
                     `• Estar registrado en el evento\n` +
                     `• Traer laptop con batería cargada\n` +
                     `• Tener conocimientos básicos del tema\n\n` +
                     ` *Recomendados:*\n` +
                     `• Cuaderno para apuntes\n` +
                     `• USB para guardar material\n` +
                     `• Ganas de aprender`;
          break;

        case 'miembros':
          if (eventoInfo) {
            respuesta = `👥 **Equipo Organizador:**\n\n` +
                       `👤 *Organizador:* ${eventoInfo.organizador_nombre || 'Académico'} ${eventoInfo.organizador_apellido || ''}\n` +
                       `👥 *Miembros del comité:* ${eventoInfo.total_comite || 0} personas\n\n` +
                       `Puedes ver la lista completa en la pestaña "Miembros".`;
          } else {
            respuesta = 'Puedes contactar al organizador directamente desde la lista de miembros del comité.';
          }
          break;

        case 'estudiantes':
          if (eventoInfo) {
            const inscritos = eventoInfo.total_inscritos || 0;
            respuesta = `📊 **Estadísticas de Participación:**\n\n` +
                       `👥 *Total inscritos:* ${inscritos} estudiantes\n` +
                       ` *Cupo máximo:* ${eventoInfo.cupo_maximo || 50}\n` +
                       `📈 *Ocupación:* ${eventoInfo.cupo_maximo ? Math.round((inscritos / eventoInfo.cupo_maximo) * 100) : 0}%\n\n` +
                       `¡Cada vez somos más!`;
          } else {
            respuesta = 'Hay varios estudiantes inscritos en el evento. Revisa las estadísticas en el panel.';
          }
          break;

        case 'programa':
          respuesta = ` **Programa del Evento:**\n\n` +
                     `⏰ *08:00 - 08:30* - Registro y bienvenida\n` +
                     ` *08:30 - 10:00* - Primera sesión\n` +
                     `⏰ *10:00 - 10:30* - Pausa activa\n` +
                     ` *10:30 - 12:00* - Segunda sesión\n` +
                     `⏰ *12:00 - 12:30* - Conclusiones y entrega de certificados\n\n` +
                     `*Nota:* El programa puede sufrir modificaciones menores.`;
          break;

        case 'material':
          respuesta = ` **Material Necesario:**\n\n` +
                     `✅ *Obligatorio:*\n` +
                     `• Laptop con batería cargada\n` +
                     `• Conexión a internet (si es virtual/híbrido)\n\n` +
                     `📚 *Recomendado:*\n` +
                     `• Cuaderno y lapicero\n` +
                     `• USB para guardar archivos\n` +
                     `• Audífonos (si es virtual)\n\n` +
                     `El material de apoyo se proporcionará durante el evento.`;
          break;

        case 'expositor':
          if (eventoInfo) {
            respuesta = `🎓 **Expositores del Evento:**\n\n` +
                       `👤 *Organizador:* ${eventoInfo.organizador_nombre || 'Académico'} ${eventoInfo.organizador_apellido || ''}\n\n` +
                       `Profesionales con amplia experiencia en el tema.\n` +
                       `Más información disponible en los detalles del evento.`;
          } else {
            respuesta = 'Los expositores están listados en la información del evento. Son profesionales con amplia experiencia.';
          }
          break;

        case 'tema':
          if (eventoInfo) {
            respuesta = `📚 **Sobre el Evento:**\n\n` +
                       `🎯 *Nombre:* ${eventoInfo.nombreevento || 'Evento'}\n` +
                       `📝 *Descripción:* ${eventoInfo.descripcion || 'Consulta los detalles del evento para más información'}\n\n` +
                       `Es un evento diseñado para mejorar tus conocimientos y habilidades.`;
          } else {
            respuesta = 'Los temas del evento están en la descripción. Revisa los detalles para más información.';
          }
          break;

        case 'duracion':
          if (eventoInfo) {
            respuesta = `⏱️ **Duración del Evento:**\n\n` +
                       `🕐 *Duración:* ${eventoInfo.duracion || '2-3 horas'}\n` +
                       ` *Fecha:* ${eventoInfo.fechaevento ? new Date(eventoInfo.fechaevento).toLocaleDateString('es-ES') : 'Por confirmar'}\n` +
                       `⏰ *Hora:* ${eventoInfo.horaevento || 'Por confirmar'}\n\n` +
                       `Te recomendamos llegar 15 minutos antes.`;
          } else {
            respuesta = 'La duración del evento está en los detalles. Generalmente dura entre 2-4 horas.';
          }
          break;

        case 'contacto':
          respuesta = ` **Contacto y Soporte:**\n\n` +
                     ` *Organizador:* Consulta la lista de miembros del comité\n` +
                     `📧 *Email:* Revisa los detalles del evento\n` +
                     `💬 *Chat:* Usa este chat para dudas rápidas\n\n` +
                     `Estamos aquí para ayudarte.`;
          break;

        case 'saludo':
          respuesta = `¡Hola! 👋\n\n` +
                     `Soy tu asistente virtual del evento. Estoy aquí para ayudarte con:\n\n` +
                     `• 🕐 Horarios y fechas\n` +
                     `• 📍 Ubicación\n` +
                     `•  Certificados\n` +
                     `•  Costos e inscripciones\n` +
                     `• 👥 Miembros del comité\n` +
                     `• 📊 Estadísticas\n\n` +
                     `¿En qué puedo ayudarte hoy?`;
          break;

        case 'gracias':
          respuesta = `¡De nada! 😊\n\n` +
                     `Estoy aquí para ayudarte. Si tienes más preguntas, no dudes en preguntar.\n\n` +
                     `¡Que tengas un excelente día!`;
          break;

        case 'adios':
          respuesta = `¡Hasta luego! 👋\n\n` +
                     `Espero verte en el evento. ¡Que tengas un excelente día!`;
          break;

        case 'ayuda':
          respuesta = `💡 **Puedo ayudarte con:**\n\n` +
                     `• 🕐 *Horarios* - "¿A qué hora es?"\n` +
                     `• 📍 *Ubicación* - "¿Dónde es?"\n` +
                     `• 📅 *Fechas* - "¿Cuándo es?"\n` +
                     `• 📜 *Certificados* - "¿Dan certificado?"\n` +
                     `• 💰 *Costos* - "¿Cuánto cuesta?"\n` +
                     `• 📝 *Inscripciones* - "¿Cómo me inscribo?"\n` +
                     `• 👥 *Miembros* - "¿Quiénes organizan?"\n` +
                     `• 📊 *Estadísticas* - "¿Cuántos inscritos?"\n\n` +
                     `¡Solo pregúntame!`;
          break;

        default:
          // Búsqueda por palabras clave como fallback
          if (palabras.some(p => ['hora', 'horario', 'tiempo'].includes(p))) {
            respuesta = eventoInfo 
              ? `⏰ El evento es a las ${eventoInfo.horaevento || 'por confirmar'} del día ${eventoInfo.fechaevento ? new Date(eventoInfo.fechaevento).toLocaleDateString('es-ES') : 'por confirmar'}.`
              : 'El horario está disponible en los detalles del evento.';
          } else if (palabras.some(p => ['lugar', 'donde', 'ubicacion'].includes(p))) {
            respuesta = eventoInfo
              ? `📍 El evento se realiza en: ${eventoInfo.lugarevento || 'por confirmar'}.`
              : 'El lugar está especificado en los detalles.';
          } else if (palabras.some(p => ['certificado', 'diploma'].includes(p))) {
            respuesta = '✅ Sí se entrega certificado con 90% de asistencia.';
          } else {
            respuesta = `No tengo información específica sobre eso. 😅\n\n` +
                       `Puedes preguntarme sobre:\n` +
                       `• Horarios y fechas\n` +
                       `• Ubicación\n` +
                       `• Certificados\n` +
                       `• Costos\n` +
                       `• Inscripciones\n` +
                       `• Miembros del comité\n\n` +
                       `O escribe "/ayuda" para ver todas las opciones.`;
          }
      }

      return {
        success: true,
        respuesta: respuesta,
        modelo: 'Brain.js Neural Network + Database',
        confianza: (mejorProbabilidad * 100).toFixed(0) + '%'
      };
    } catch (error) {
      console.error('❌ Error en ChatBot:', error);
      return {
        success: false,
        respuesta: 'Lo siento, tuve un problema. Intenta de nuevo.',
        modelo: 'Brain.js',
        error: error.message
      };
    }
  }

  esPreguntaParaBot(mensaje) {
    const texto = mensaje.trim().toLowerCase();
    return (
      texto.includes('¿') ||
      texto.includes('?') ||
      texto.startsWith('/pregunta') ||
      texto.startsWith('/bot') ||
      texto.startsWith('/ia') ||
      texto.includes('@bot') ||
      texto.includes('hora') ||
      texto.includes('cuando') ||
      texto.includes('donde') ||
      texto.includes('lugar') ||
      texto.includes('fecha') ||
      texto.includes('certificado') ||
      texto.includes('requisitos') ||
      texto.includes('costo') ||
      texto.includes('inscripcion')
    );
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