const brain = require('brain.js');

class ChatBotService {
  constructor() {
    this.net = null;
    this.isTrained = false;
    
    // Respuestas inteligentes basadas en palabras clave
    this.respuestas = {
      'hora': 'El horario del evento está disponible en los detalles. Revisa la información del evento para confirmar la hora exacta.',
      'lugar': 'El lugar del evento está especificado en los detalles. Puedes consultarlo en la información del evento.',
      'fecha': 'La fecha del evento está disponible en los detalles. Revisa la información del evento para confirmar.',
      'certificado': 'Sí, se entrega certificado al finalizar el evento. Debes asistir completo para recibirlo.',
      'costo': 'Este evento es gratuito para todos los participantes registrados.',
      'inscripcion': 'Para inscribirte, contacta al organizador del evento o revisa el formulario de registro.',
      'requisitos': 'Los requisitos del evento están en la descripción. Generalmente solo necesitas traer tu laptop y ganas de aprender.',
      'contacto': 'Puedes contactar al organizador directamente desde la lista de miembros del comité.',
      'programa': 'El programa del evento está disponible en los detalles. Incluye todas las actividades y horarios.',
      'material': 'El material necesario está especificado en la descripción del evento.',
      'duración': 'La duración del evento está en los detalles. Generalmente dura entre 2-4 horas.',
      'expositor': 'Los expositores están listados en la información del evento.',
      'tema': 'Los temas del evento están en la descripción. Revisa los detalles para más información.',
      'ayuda': 'Puedes preguntarme sobre: hora, lugar, fecha, certificado, costo, inscripción, requisitos, contacto, programa, material, duración, expositor o tema.',
      'hola': '¡Hola! Soy el asistente virtual del evento. ¿En qué puedo ayudarte?',
      'buenas': '¡Buenas! Estoy aquí para ayudarte con información del evento. ¿Qué necesitas saber?',
      'gracias': '¡De nada! Estoy aquí para ayudarte. ¿Tienes otra pregunta?',
      'adiós': '¡Hasta luego! Que disfrutes el evento.',
    };

    // Entrenar red neuronal simple
    this.entrenar();
  }

  entrenar() {
    const trainingData = [
      // Saludos
      { input: { hola: 1 }, output: { saludo: 1 } },
      { input: { buenas: 1 }, output: { saludo: 1 } },
      { input: { hey: 1 }, output: { saludo: 1 } },
      
      // Preguntas comunes
      { input: { hora: 1, cuando: 1 }, output: { hora: 1 } },
      { input: { lugar: 1, donde: 1 }, output: { lugar: 1 } },
      { input: { fecha: 1, dia: 1 }, output: { fecha: 1 } },
      { input: { certificado: 1, diploma: 1 }, output: { certificado: 1 } },
      { input: { costo: 1, precio: 1, pagar: 1 }, output: { costo: 1 } },
      { input: { inscripcion: 1, registrar: 1, apuntar: 1 }, output: { inscripcion: 1 } },
      { input: { requisitos: 1, necesito: 1, traer: 1 }, output: { requisitos: 1 } },
      { input: { contacto: 1, organizador: 1, quien: 1 }, output: { contacto: 1 } },
      { input: { programa: 1, agenda: 1, actividades: 1 }, output: { programa: 1 } },
      { input: { material: 1, laptop: 1, cuaderno: 1 }, output: { material: 1 } },
      { input: { duracion: 1, tiempo: 1, cuanto: 1 }, output: { duracion: 1 } },
      { input: { expositor: 1, ponente: 1, speaker: 1 }, output: { expositor: 1 } },
      { input: { tema: 1, contenido: 1, sobre: 1 }, output: { tema: 1 } },
      { input: { ayuda: 1, help: 1, que: 1 }, output: { ayuda: 1 } },
      { input: { gracias: 1, thanks: 1 }, output: { gracias: 1 } },
      { input: { adios: 1, bye: 1, chau: 1 }, output: { adios: 1 } },
    ];

    this.net = new brain.NeuralNetwork({
      hiddenLayers: [3],
      activation: 'sigmoid'
    });

    this.net.train(trainingData, {
      iterations: 500,
      errorThresh: 0.01,
      log: false
    });

    this.isTrained = true;
    console.log('✅ ChatBot IA entrenado con Brain.js');
  }

  /**
   * Genera respuesta usando Brain.js + reglas
   */
  async generarRespuesta(pregunta) {
    try {
      const preguntaLower = pregunta.toLowerCase();
      const palabras = preguntaLower.split(/\s+/);
      
      // Preparar input para la red neuronal
      const input = {};
      palabras.forEach(p => {
        const limpia = p.replace(/[.,!?;:]/g, '');
        if (limpia.length > 2) input[limpia] = 1;
      });

      // Obtener predicción de la red neuronal
      const output = this.net.run(input);
      
      // Encontrar la categoría con mayor probabilidad
      let mejorCategoria = null;
      let mejorProbabilidad = 0;
      
      for (const [categoria, probabilidad] of Object.entries(output)) {
        if (probabilidad > mejorProbabilidad && probabilidad > 0.5) {
          mejorProbabilidad = probabilidad;
          mejorCategoria = categoria;
        }
      }

      // Buscar respuesta en el diccionario
      if (mejorCategoria && this.respuestas[mejorCategoria]) {
        return {
          success: true,
          respuesta: this.respuestas[mejorCategoria],
          modelo: 'Brain.js Neural Network',
          confianza: (mejorProbabilidad * 100).toFixed(0) + '%'
        };
      }

      // Búsqueda por palabras clave como fallback
      for (const [keyword, respuesta] of Object.entries(this.respuestas)) {
        if (palabras.includes(keyword)) {
          return {
            success: true,
            respuesta: respuesta,
            modelo: 'Brain.js + Keywords',
            confianza: '80%'
          };
        }
      }

      // Respuesta por defecto
      return {
        success: true,
        respuesta: 'No tengo información específica sobre eso. Puedes preguntarme sobre: hora, lugar, fecha, certificado, costo, inscripción, requisitos, contacto, programa, material, duración, expositor o tema. O escribe /ayuda para ver todas las opciones.',
        modelo: 'Brain.js',
        confianza: '0%'
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

  /**
   * Detecta si el mensaje es para el bot
   */
  esPreguntaParaBot(mensaje) {
    const texto = mensaje.trim().toLowerCase();
    return (
      texto.startsWith('/pregunta') ||
      texto.startsWith('/ia') ||
      texto.startsWith('/bot') ||
      texto.includes('@bot') ||
      texto.startsWith('bot:')
    );
  }

  /**
   * Extrae la pregunta limpia
   */
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