const brain = require('brain.js');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

class ChatAnalysisService {
  constructor() {
    this.sentimentNet = null;
    this.isTrained = false;
  }

  /**
   * Extrae features numéricas de un mensaje de texto
   * para que la red neuronal pueda procesarlo
   */
  _extractFeatures(text) {
    const lowerText = text.toLowerCase();
    
    // Palabras positivas y negativas comunes en español
    const positiveWords = [
      'excelente', 'genial', 'bueno', 'increíble', 'fantástico', 
      'maravilloso', 'perfecto', 'genial', 'encantado', 'feliz',
      'gracias', 'gracias', 'ayuda', 'útil', 'interesante',
      'aprender', 'aprendizaje', 'importante', 'vale', 'bien',
      'si', 'sí', 'claro', 'ok', 'okay', 'correcto'
    ];
    
    const negativeWords = [
      'malo', 'terrible', 'horrible', 'pésimo', 'fatal',
      'no', 'nunca', 'jamás', 'odio', 'detesto',
      'problema', 'error', 'fallo', 'falla', 'roto',
      'difícil', 'complicado', 'confuso', 'aburrido',
      'tarde', 'lento', 'esperar', 'esperando', 'cola'
    ];

    // Contar palabras
    const words = lowerText.split(/\s+/);
    const wordCount = words.length;
    
    // Contar palabras positivas y negativas
    let positiveCount = 0;
    let negativeCount = 0;
    
    words.forEach(word => {
      const cleanWord = word.replace(/[.,!?;:]/g, '');
      if (positiveWords.includes(cleanWord)) positiveCount++;
      if (negativeWords.includes(cleanWord)) negativeCount++;
    });

    // Features para la red neuronal
    return {
      wordCount: Math.min(wordCount / 20, 1), // Normalizado
      positiveRatio: positiveCount / Math.max(wordCount, 1),
      negativeRatio: negativeCount / Math.max(wordCount, 1),
      hasQuestion: lowerText.includes('?') ? 1 : 0,
      hasExclamation: lowerText.includes('!') ? 1 : 0,
      hasEmoji: /[😊😄😁😆😅🤣😍🥰😗😙😚😋😝😜🤪🤨🧐🤓😎🥳😏😒😞😔😟😕🙁☹️😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🤭🤫🤥😶😐😑😬🙄😯😦😧😮😲🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕🤑🤠😈👹👺🤡👻💀☠️👽👾🤖😺😸😹😻😼😽🙀😿😾]/.test(lowerText) ? 1 : 0,
      uppercaseRatio: (text.match(/[A-Z]/g) || []).length / Math.max(text.length, 1),
      charCount: Math.min(text.length / 200, 1)
    };
  }

  /**
   * Entrena la red neuronal para análisis de sentimiento
   * Usa datos históricos del chat
   */
  async trainSentimentModel() {
    // Datos de entrenamiento de ejemplo (en producción, usar datos reales)
    const trainingData = [
      // Positivos
      { input: { wordCount: 0.3, positiveRatio: 0.2, negativeRatio: 0, hasQuestion: 0, hasExclamation: 1, hasEmoji: 1, uppercaseRatio: 0, charCount: 0.2 }, output: { positive: 1, neutral: 0, negative: 0 } },
      { input: { wordCount: 0.5, positiveRatio: 0.15, negativeRatio: 0, hasQuestion: 0, hasExclamation: 0, hasEmoji: 0, uppercaseRatio: 0, charCount: 0.4 }, output: { positive: 1, neutral: 0, negative: 0 } },
      { input: { wordCount: 0.2, positiveRatio: 0.1, negativeRatio: 0, hasQuestion: 0, hasExclamation: 0, hasEmoji: 1, uppercaseRatio: 0, charCount: 0.1 }, output: { positive: 0.8, neutral: 0.2, negative: 0 } },
      
      // Neutrales
      { input: { wordCount: 0.3, positiveRatio: 0.02, negativeRatio: 0.02, hasQuestion: 1, hasExclamation: 0, hasEmoji: 0, uppercaseRatio: 0, charCount: 0.3 }, output: { positive: 0, neutral: 1, negative: 0 } },
      { input: { wordCount: 0.4, positiveRatio: 0, negativeRatio: 0, hasQuestion: 0, hasExclamation: 0, hasEmoji: 0, uppercaseRatio: 0, charCount: 0.3 }, output: { positive: 0, neutral: 1, negative: 0 } },
      
      // Negativos
      { input: { wordCount: 0.3, positiveRatio: 0, negativeRatio: 0.2, hasQuestion: 0, hasExclamation: 1, hasEmoji: 0, uppercaseRatio: 0.3, charCount: 0.2 }, output: { positive: 0, neutral: 0, negative: 1 } },
      { input: { wordCount: 0.5, positiveRatio: 0, negativeRatio: 0.15, hasQuestion: 1, hasExclamation: 0, hasEmoji: 0, uppercaseRatio: 0, charCount: 0.4 }, output: { positive: 0, neutral: 0.2, negative: 0.8 } },
    ];

    this.sentimentNet = new brain.NeuralNetwork({
      hiddenLayers: [6, 4],
      activation: 'sigmoid'
    });

    console.log('🧠 Entrenando modelo de análisis de sentimiento...');
    
    this.sentimentNet.train(trainingData, {
      iterations: 2000,
      errorThresh: 0.005,
      log: false
    });

    this.isTrained = true;
    console.log('✅ Modelo de sentimiento entrenado');
  }

  /**
   * Analiza el sentimiento de un mensaje
   */
  analyzeSentiment(text) {
    if (!this.isTrained || !this.sentimentNet) {
      this.trainSentimentModel();
    }

    const features = this._extractFeatures(text);
    const result = this.sentimentNet.run(features);

    // Determinar categoría principal
    let sentiment = 'neutral';
    let confidence = 0;

    if (result.positive > result.negative && result.positive > result.neutral) {
      sentiment = 'positive';
      confidence = result.positive;
    } else if (result.negative > result.positive && result.negative > result.neutral) {
      sentiment = 'negative';
      confidence = result.negative;
    } else {
      sentiment = 'neutral';
      confidence = result.neutral;
    }

    return {
      sentiment,
      confidence: (confidence * 100).toFixed(1),
      scores: result
    };
  }

  /**
   * Obtiene mensajes del chat de un evento
   */
  async getChatMessages(eventId) {
    const query = `
      SELECT 
        c.idchat,
        c.mensaje,
        c.created_at,
        u.nombre,
        u.apellidopat
      FROM chat c
      INNER JOIN users u ON c.idusuario = u.id
      WHERE c.idevento = $1
      ORDER BY c.created_at ASC
      LIMIT 200
    `;

    try {
      const result = await pool.query(query, [eventId]);
      return result.rows;
    } catch (error) {
      console.error('Error al obtener mensajes:', error);
      return [];
    }
  }

  /**
   * Extrae temas principales (word frequency)
   */
  extractTopTopics(messages, limit = 5) {
    const stopWords = new Set([
      'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
      'de', 'del', 'al', 'en', 'con', 'por', 'para', 'sin',
      'que', 'y', 'o', 'pero', 'si', 'no', 'me', 'te', 'se',
      'mi', 'tu', 'su', 'es', 'son', 'esta', 'este', 'como'
    ]);

    const wordCount = {};

    messages.forEach(msg => {
      const words = msg.mensaje.toLowerCase()
        .replace(/[.,!?;:()"]/g, '')
        .split(/\s+/);

      words.forEach(word => {
        if (word.length > 3 && !stopWords.has(word)) {
          wordCount[word] = (wordCount[word] || 0) + 1;
        }
      });
    });

    // Ordenar y tomar los más frecuentes
    return Object.entries(wordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([word, count]) => ({ word, count }));
  }

  /**
   * Análisis completo del chat de un evento
   */
  async analyzeEventChat(eventId) {
    const messages = await this.getChatMessages(eventId);

    if (messages.length === 0) {
      return {
        total_mensajes: 0,
        sentimiento: null,
        engagement: null,
        temas_principales: [],
        alertas: [],
        prediccion_asistencia: null
      };
    }

    // Analizar sentimiento de cada mensaje
    const sentimentAnalysis = messages.map(msg => ({
      ...msg,
      analisis: this.analyzeSentiment(msg.mensaje)
    }));

    // Calcular métricas
    const totalMensajes = messages.length;
    const uniqueUsers = new Set(messages.map(m => m.idchat)).size;
    
    const positiveCount = sentimentAnalysis.filter(m => m.analisis.sentiment === 'positive').length;
    const negativeCount = sentimentAnalysis.filter(m => m.analisis.sentiment === 'negative').length;
    const neutralCount = sentimentAnalysis.filter(m => m.analisis.sentiment === 'neutral').length;

    const sentimentScore = {
      positive: ((positiveCount / totalMensajes) * 100).toFixed(1),
      negative: ((negativeCount / totalMensajes) * 100).toFixed(1),
      neutral: ((neutralCount / totalMensajes) * 100).toFixed(1)
    };

    // Determinar sentimiento general
    let generalSentiment = 'neutral';
    if (parseFloat(sentimentScore.positive) > 60) generalSentiment = 'positive';
    else if (parseFloat(sentimentScore.negative) > 40) generalSentiment = 'negative';

    // Calcular engagement
    const messagesPerDay = totalMensajes / Math.max(1, this._getDaysSpan(messages));
    let engagementLevel = 'bajo';
    let engagementScore = 0;

    if (messagesPerDay > 10) {
      engagementLevel = 'muy_alto';
      engagementScore = 95;
    } else if (messagesPerDay > 5) {
      engagementLevel = 'alto';
      engagementScore = 75;
    } else if (messagesPerDay > 2) {
      engagementLevel = 'medio';
      engagementScore = 50;
    } else {
      engagementLevel = 'bajo';
      engagementScore = 25;
    }

    // Extraer temas principales
    const topics = this.extractTopTopics(messages, 5);

    // Detectar alertas (mensajes negativos recientes)
    const alerts = sentimentAnalysis
      .filter(m => m.analisis.sentiment === 'negative' && parseFloat(m.analisis.confidence) > 70)
      .slice(-3)
      .map(m => ({
        mensaje: m.mensaje,
        usuario: `${m.nombre} ${m.apellidopat}`,
        fecha: m.created_at
      }));

    // Predecir asistencia basada en engagement
    // (esto es un cálculo simple, en producción usarías un modelo más complejo)
    const predictedAttendance = Math.round(
      (engagementScore / 100) * (uniqueUsers * 3) + (uniqueUsers * 2)
    );

    return {
      total_mensajes: totalMensajes,
      usuarios_participantes: uniqueUsers,
      sentimiento: {
        general: generalSentiment,
        score: sentimentScore,
        emoji: generalSentiment === 'positive' ? '😊' : generalSentiment === 'negative' ? '😟' : '😐'
      },
      engagement: {
        nivel: engagementLevel,
        score: engagementScore,
        mensajes_por_dia: messagesPerDay.toFixed(1),
        emoji: engagementLevel === 'muy_alto' || engagementLevel === 'alto' ? '🔥' : engagementLevel === 'medio' ? '💬' : '📱'
      },
      temas_principales: topics,
      alertas: alerts,
      prediccion_asistencia: {
        estimada: predictedAttendance,
        confianza: engagementLevel === 'muy_alto' || engagementLevel === 'alto' ? 'alta' : 'media'
      },
      periodo_analisis: this._getDaysSpan(messages)
    };
  }

  _getDaysSpan(messages) {
    if (messages.length === 0) return 1;
    const dates = messages.map(m => new Date(m.created_at));
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    const diffTime = Math.abs(maxDate - minDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(diffDays, 1);
  }
}

module.exports = new ChatAnalysisService();