// 1. Agregamos el servicio del bot al inicio del archivo
const chatBotService = require('../services/chatBotService');

const notificarSala = async (io, { roomId, userId, userName, role, message, timestamp }) => {
  try {
    const senderId = parseInt(userId);
    if (isNaN(senderId)) return; // Sin userId válido no notificamos

    if (String(roomId) === 'general') {
      io.to('evento_general').emit('chat_notification', {
        type: 'general',
        roomId: String(roomId),
        roomName: 'Chat General',
        userId: senderId,
        userName: userName || 'Usuario',
        role,
        message,
        timestamp: timestamp || new Date().toISOString()
      });
      return;
    }

    const destinatarios = [];
    let roomName = null;

    const { getModels } = require('../models');
    const { Comite, Evento, User } = getModels();

    if (String(roomId).startsWith('private_')) {
      const ids = String(roomId).replace('private_', '').split('_').map(Number).filter(n => !isNaN(n));
      const otroId = ids.find(n => n !== senderId);
      if (otroId == null) return;

      const otro = await User.findOne({
        where: { idusuario: otroId },
        attributes: ['nombre', 'apellidopat']
      });
      roomName = otro ? `${otro.nombre || ''} ${otro.apellidopat || ''}`.trim() || null : null;
      destinatarios.push('usuario_' + String(otroId));
    } else {
      const id = parseInt(roomId);
      if (isNaN(id)) return;

      const evento = await Evento.findOne({
        where: { idevento: id },
        attributes: ['nombreevento', 'idacademico']
      });
      roomName = evento?.nombreevento || null;

      const comite = await Comite.findAll({ where: { idevento: id }, attributes: ['idusuario'] });
      comite.forEach(c => destinatarios.push('usuario_' + String(c.idusuario)));

      if (evento && parseInt(evento.idacademico)) {
        destinatarios.push('usuario_' + String(evento.idacademico));
      }
    }

    const unicos = [...new Set(destinatarios)].filter(u => u !== 'usuario_' + String(senderId));

    const payload = {
      type: String(roomId).startsWith('private_') ? 'private' : 'evento',
      roomId: String(roomId),
      roomName,
      userId: senderId,
      userName: userName || 'Usuario',
      role,
      message,
      timestamp: timestamp || new Date().toISOString()
    };

    unicos.forEach(canal => io.to(canal).emit('chat_notification', payload));
  } catch (e) {
    console.warn('❌ [NOTIF] Error al notificar:', e.message);
  }
};

module.exports = (io) => {
  const eventUsers = new Map();
  const privateRooms = new Map(); // Track private room members

  io.on('connection', (socket) => {
    console.log('🔌 Usuario conectado:', socket.id);

    socket.on('connect', () => {
      socket.emit('personal_channel', { channel: 'usuario_' + String(socket.data?.userId || '') });
    });

    socket.on('register_user', ({ userId }) => {
      const canal = 'usuario_' + String(userId);
      socket.join(canal);
      socket.data = { ...socket.data, userId };
      console.log(`🎯 [NOTIF] ${userId || '?'} registrado en canal ${canal}`);
    });

    socket.on('join_private', async ({ roomId, userId, userName }) => {
      console.log('🔒 [PRIVADO] Unirse a sala:', { roomId, userId, userName });
      
      socket.join(roomId);
      socket.data = { ...socket.data, roomId, isPrivate: true, userId, userName };

      if (!privateRooms.has(roomId)) {
        privateRooms.set(roomId, new Set());
      }
      privateRooms.get(roomId).add(String(userId));

      try {
        const { getModels } = require('../models');
        const { ChatMensaje } = getModels();

        const historial = await ChatMensaje.findAll({
          where: { idevento: 0, room_id: roomId },
          order: [['createdAt', 'ASC']],
          limit: 100
        });

        socket.emit('history', historial.map(m => ({
          userId: m.idusuario,
          userName: m.username,
          role: m.role,
          message: m.message,
          timestamp: m.created_at || m.createdAt
        })));
        
        console.log(`✅ [PRIVADO] ${userName} unido a ${roomId}, historial: ${historial.length}`);
      } catch (e) {
        console.error('❌ [PRIVADO] Error cargando historial:', e.message);
        socket.emit('history', []);
      }
    });

    socket.on('send_private', async ({ roomId, userId, userName, role, message }) => {
      console.log('📩 [PRIVADO] Enviando mensaje:', { roomId, userId, userName, message });
      
      try {
        const { getModels } = require('../models');
        const { ChatMensaje } = getModels();
        
        await ChatMensaje.create({
          idevento: 0,
          idusuario: parseInt(userId),
          username: userName || null,
          role,
          message,
          room_id: roomId,
        });

        io.to(roomId).emit('private_message', {
          userId: parseInt(userId),
          userName: userName || 'Usuario',
          role,
          message,
          timestamp: new Date().toISOString()
        });

        notificarSala(io, { roomId, userId, userName, role, message });
        console.log(`✅ [PRIVADO] Mensaje emitido a sala ${roomId}`);
      } catch (e) {
        console.error('❌ [PRIVADO] Error:', e.message);
        socket.emit('error', { message: 'Error: ' + e.message });
      }
    });

    socket.on('leave_private', ({ roomId }) => {
      console.log('🚪 [PRIVADO] Usuario sale:', roomId);
      socket.leave(roomId);
      
      if (privateRooms.has(roomId)) {
        privateRooms.get(roomId).delete(String(socket.data?.userId));
        if (privateRooms.get(roomId).size === 0) {
          privateRooms.delete(roomId);
        }
      }
    });

    socket.on('join_event', async ({ eventoId, userId, role, userName }) => {
      const room = `evento_${eventoId}`;
      console.log('👥 [EVENTO] Usuario se une:', { eventoId, userId, userName, room });

      try {
        const { getModels } = require('../models');
        const { ChatMensaje, Comite, Evento } = getModels();

        if (eventoId !== 'general') {
          const [esMiembroComite, evento] = await Promise.all([
            Comite.findOne({ where: { idevento: parseInt(eventoId), idusuario: parseInt(userId) } }),
            Evento.findOne({ where: { idevento: parseInt(eventoId) } })
          ]);

          const esCreador = evento && parseInt(evento.idacademico) === parseInt(userId);

          if (!esMiembroComite && !esCreador) {
            console.warn('⚠️ [EVENTO] Usuario sin acceso:', { userId, eventoId });
            socket.emit('error', { message: 'No tienes acceso a este chat' });
            return;
          }
        }

        socket.join(room);
        socket.data = { userId, role, eventoId, userName };

        if (!eventUsers.has(eventoId)) {
          eventUsers.set(eventoId, new Map());
        }
        eventUsers.get(eventoId).set(String(userId), {
          userId: String(userId),
          userName,
          role,
          socketId: socket.id
        });

        const userList = Array.from(eventUsers.get(eventoId).values());
        io.to(room).emit('user_list', userList);

        const whereHistorial = eventoId === 'general'
          ? { idevento: 0, room_id: 'general' }
          : { idevento: parseInt(eventoId) };

        const historial = await ChatMensaje.findAll({
          where: whereHistorial,
          order: [['createdAt', 'ASC']],
          limit: 50
        });

        socket.emit('history', historial.map(m => ({
          userId: m.idusuario,
          userName: m.username,
          role: m.role,
          message: m.message,
          timestamp: m.created_at || m.createdAt
        })));

        socket.to(room).emit('user_joined', { userId, userName, role });
        console.log(`✅ [EVENTO] ${userName} (${role}) → sala ${room}`);

      } catch (e) {
        console.warn('⚠️ [EVENTO] Error en join_event:', e.message);
        socket.emit('history', []);
      }
    });

       socket.on('send_message', async ({ eventoId, userId, role, userName, message }) => {
      const room = `evento_${eventoId}`;
      console.log('📩 [EVENTO] Mensaje:', { eventoId, userId, userName, message });
      
      const textoLower = message.toLowerCase().trim();
      
      // ==========================================
      // 1. PRIORIDAD: DETECTAR RECORDATORIOS
      // ==========================================
      if (textoLower.includes('recuérdame') || textoLower.includes('avísame')) {
        console.log('⏰ [RECORDATORIO] Detectado:', message);
        
        // Aquí puedes emitir un evento al frontend para que abra el modal de recordatorios,
        // o llamar directamente a tu función de crear recordatorio si la tienes a mano.
        io.to(room).emit('receive_message', {
          userId: 0,
          userName: '🤖 Asistente IA',
          role: 'bot',
          message: '⏳ Para programar un recordatorio, por favor usa la sección de "Recordatorios" en la app o escribe: "Vincular mi Telegram [tu_chat_id]" para recibir alertas.',
          esBot: true,
          timestamp: new Date().toISOString()
        });

        notificarSala(io, {
          roomId: eventoId,
          userId: 0,
          userName: 'Asistente IA',
          role: 'bot',
          message: '⏳ Para programar un recordatorio, por favor usa la sección de "Recordatorios" en la app o escribe: "Vincular mi Telegram [tu_chat_id]" para recibir alertas.',
          timestamp: new Date().toISOString()
        });
        
        // Opcional: Si tienes la función a mano, la llamas aquí:
        // await crearRecordatorio(userId, message, eventoId);
      }

      // ==========================================
      // 2. DETECCIÓN DE PREGUNTAS PARA LA IA
      // ==========================================
      const esPregunta = 
        textoLower.includes('¿') || textoLower.includes('?') ||
        textoLower.startsWith('/pregunta') || textoLower.startsWith('/bot') ||
        textoLower.startsWith('/ia') || textoLower.includes('@bot') ||
        textoLower.includes('hora') || textoLower.includes('cuando') ||
        textoLower.includes('donde') || textoLower.includes('lugar') ||
        textoLower.includes('fecha') || textoLower.includes('certificado') ||
        textoLower.includes('requisitos') || textoLower.includes('costo') ||
        textoLower.includes('recordatorio') || textoLower.includes('inscripc');

      if (esPregunta) {
        console.log('🤖 [BOT] Procesando pregunta para IA...');
        
        try {
          const pregunta = chatBotService.extraerPregunta(message);
          
          io.to(room).emit('bot_typing', { eventoId });

          // ✨ AJUSTE DE ORO: Pasamos el eventoId para que la IA tenga contexto real de la BD
          const respuesta = await chatBotService.generarRespuesta(pregunta, eventoId);
          
          console.log('✅ [BOT] Respuesta generada con confianza:', respuesta.confianza);

          io.to(room).emit('receive_message', {
            userId: 0,
            userName: '🤖 Asistente IA',
            role: 'bot',
            message: respuesta.respuesta,
            esBot: true,
            timestamp: new Date().toISOString()
          });

          notificarSala(io, {
            roomId: eventoId,
            userId: 0,
            userName: 'Asistente IA',
            role: 'bot',
            message: respuesta.respuesta,
            timestamp: new Date().toISOString()
          });

          const { getModels } = require('../models');
          const { ChatMensaje } = getModels();
          
          ChatMensaje.create({
            idevento: eventoId === 'general' ? 0 : parseInt(eventoId),
            idusuario: 0,
            username: 'Asistente IA',
            role: 'bot',
            message: respuesta.respuesta,
            ...(eventoId === 'general' ? { room_id: 'general' } : {})
          }).catch(err => console.error('❌ [BOT] Error al guardar en BD:', err));

        } catch (error) {
          console.error('❌ [BOT] Error crítico:', error);
        }
      }

      // ==========================================
      // 3. GUARDAR Y EMITIR EL MENSAJE DEL USUARIO (Tu código original intacto)
      // ==========================================
      try {
        const { getModels } = require('../models');
        const { ChatMensaje } = getModels();
        
        await ChatMensaje.create({
          idevento: eventoId === 'general' ? 0 : parseInt(eventoId),
          idusuario: parseInt(userId),
          username: userName || null,
          role,
          message,
          ...(eventoId === 'general' ? { room_id: 'general' } : {})
        });

        io.to(room).emit('receive_message', {
          userId: parseInt(userId),
          userName: userName || 'Usuario',
          role,
          message,
          esBot: false,
          timestamp: new Date().toISOString()
        });

        notificarSala(io, { roomId: eventoId, userId, userName, role, message });
        console.log(`✅ [EVENTO] Mensaje emitido a: ${room}`);
      } catch (e) {
        console.error('❌ [EVENTO] Error:', e.message);
        socket.emit('error', { message: e.message });
      }
    });

    socket.on('leave_event', ({ eventoId }) => {
      console.log('🚪 [EVENTO] Usuario sale:', eventoId);
      socket.leave(`evento_${eventoId}`);
    });

    socket.on('disconnect', () => {
      console.log('❌ Usuario desconectado:', socket.id);

      const { userId, eventoId, userName, role, roomId, isPrivate } = socket.data || {};

      if (isPrivate && roomId && userId) {
        if (privateRooms.has(roomId)) {
          privateRooms.get(roomId).delete(String(userId));
          if (privateRooms.get(roomId).size === 0) {
            privateRooms.delete(roomId);
          }
        }
      }

      if (eventoId && userId && eventUsers.has(eventoId)) {
        const userMap = eventUsers.get(eventoId);
        const user = userMap.get(String(userId));
        userMap.delete(String(userId));

        const room = `evento_${eventoId}`;

        if (userMap.size === 0) {
          eventUsers.delete(eventoId);
        } else {
          const userList = Array.from(userMap.values());
          io.to(room).emit('user_list', userList);
        }

        socket.to(room).emit('user_left', {
          userId,
          userName: user?.userName || userName,
          role: user?.role || role
        });

        console.log(`👋 ${userName || 'Usuario'} salió de ${room}`);
      }
    });
  });

  console.log('✅ [SOCKET] Chat socket inicializado correctamente');
};