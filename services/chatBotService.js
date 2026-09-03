// src/services/chatBotService.js
const brain = require('brain.js');

class ChatBotService {
  constructor() {
    this.net = null;
    this.isTrained = false;
    
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
      'duracion': 'La duración del evento está en los detalles. Generalmente dura entre 2-4 horas.',
      'expositor': 'Los expositores están listados en la información del evento.',
      'tema': 'Los temas del evento están en la descripción. Revisa los detalles para más información.',
      'ayuda': 'Puedes preguntarme sobre: hora, lugar, fecha, certificado, costo, inscripción, requisitos, contacto, programa, material, duración, expositor o tema.',
      'hola': '¡Hola! Soy el asistente virtual del evento. ¿En qué puedo ayudarte?',
      'buenas': '¡Buenas! Estoy aquí para ayudarte con información del evento. ¿Qué necesitas saber?',
      'gracias': '¡De nada! Estoy aquí para ayudarte. ¿Tienes otra pregunta?',
      'adios': '¡Hasta luego! Que disfrutes el evento.',
    };

    this.entrenar();
  }

  entrenar() {
    const trainingData = [
      { input: { hola: 1 }, output: { saludo: 1 } },
      { input: { buenas: 1 }, output: { saludo: 1 } },
      { input: { hora: 1, cuando: 1 }, output: { hora: 1 } },
      { input: { lugar: 1, donde: 1 }, output: { lugar: 1 } },
      { input: { fecha: 1, dia: 1 }, output: { fecha: 1 } },
      { input: { certificado: 1, diploma: 1 }, output: { certificado: 1 } },
      { input: { costo: 1, precio: 1, pagar: 1 }, output: { costo: 1 } },
      { input: { inscripcion: 1, registrar: 1 }, output: { inscripcion: 1 } },
      { input: { requisitos: 1, necesito: 1, traer: 1 }, output: { requisitos: 1 } },
      { input: { contacto: 1, organizador: 1 }, output: { contacto: 1 } },
      { input: { programa: 1, agenda: 1 }, output: { programa: 1 } },
      { input: { material: 1, laptop: 1 }, output: { material: 1 } },
      { input: { duracion: 1, tiempo: 1 }, output: { duracion: 1 } },
      { input: { expositor: 1, ponente: 1 }, output: { expositor: 1 } },
      { input: { tema: 1, contenido: 1 }, output: { tema: 1 } },
      { input: { ayuda: 1, help: 1, que: 1 }, output: { ayuda: 1 } },
      { input: { gracias: 1, thanks: 1 }, output: { gracias: 1 } },
      { input: { adios: 1, bye: 1, chau: 1 }, output: { adios: 1 } },
    ];

    this.net = new brain.NeuralNetwork({ hiddenLayers: [3], activation: 'sigmoid' });
    this.net.train(trainingData, { iterations: 500, errorThresh: 0.01, log: false });
    this.isTrained = true;
    console.log('✅ ChatBot IA entrenado con Brain.js');
  }

  async generarRespuesta(pregunta) {
    try {
      const preguntaLower = pregunta.toLowerCase();
      const palabras = preguntaLower.split(/\s+/);
      
      const input = {};
      palabras.forEach(p => {
        const limpia = p.replace(/[.,!?;:]/g, '');
        if (limpia.length > 2) input[limpia] = 1;
      });

      const output = this.net.run(input);
      let mejorCategoria = null;
      let mejorProbabilidad = 0;
      
      for (const [categoria, probabilidad] of Object.entries(output)) {
        if (probabilidad > mejorProbabilidad && probabilidad > 0.3) { // Umbral más bajo para ser más sensible
          mejorProbabilidad = probabilidad;
          mejorCategoria = categoria;
        }
      }

      if (mejorCategoria && this.respuestas[mejorCategoria]) {
        return { success: true, respuesta: this.respuestas[mejorCategoria], modelo: 'Brain.js Neural Network' };
      }

      for (const [keyword, respuesta] of Object.entries(this.respuestas)) {
        if (palabras.includes(keyword)) {
          return { success: true, respuesta: respuesta, modelo: 'Brain.js + Keywords' };
        }
      }

      return {
        success: true,
        respuesta: 'No tengo información específica sobre eso. Puedes preguntarme sobre: hora, lugar, fecha, certificado, costo, inscripción, requisitos, contacto o programa.',
        modelo: 'Brain.js'
      };
    } catch (error) {
      console.error('❌ Error en ChatBot:', error);
      return { success: false, respuesta: 'Lo siento, tuve un problema. Intenta de nuevo.', modelo: 'Brain.js' };
    }
  }

  esPreguntaParaBot(mensaje) {
    // Esta función ya no es estrictamente necesaria porque la detección está en el socket, 
    // pero la dejamos por compatibilidad.
    return true; 
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