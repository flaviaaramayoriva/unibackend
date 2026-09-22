const cron = require('node-cron');
const { getModels } = require('../models/index');
const { Op } = require('sequelize');
const predictionService = require('../services/predictionService');

cron.schedule('0 8 * * *', async () => {
  console.log('🤖 Ejecutando análisis predictivo de asistencia...');
  try {
    const analisis = await predictionService.generarAnalisisCompleto();
    console.log(`✅ Análisis completado para ${analisis.length} eventos`);
    
    // Aquí puedes enviar notificaciones por Telegram o Socket
    // si algún evento tiene baja predicción de asistencia
    analisis.forEach(evento => {
      if (evento.tasa_asistencia_esperada !== 'N/A') {
        const tasa = parseFloat(evento.tasa_asistencia_esperada);
        if (tasa < 50) {
          console.log(`⚠️ Alerta: Evento "${evento.titulo}" tiene baja asistencia esperada (${evento.tasa_asistencia_esperada})`);
          // Aquí llamarías a tu servicio de notificaciones
        }
      }
    });
  } catch (error) {
    console.error('❌ Error en cron de predicciones:', error);
  }
});

const marcarEventosVencidos = async () => {
  console.log('🔄 [CRON] Iniciando revisión...');
  
  try {
    const { Evento } = getModels();
    const sequelize = getModels().sequelize;

    // Horario local de la app (La Paz, UTC-4, sin horario de verano). Las fechas/horas
    // de los eventos se guardan en hora local, por eso se compara contra la hora local.
    // La columna fechaevento es VARCHAR y puede guardar '2026-09-14' o
    // '2026-09-14 00:00:00.000 +00:00'; por eso se compara solo la parte de fecha.
    const ahoraLocal = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const hoyLocal = ahoraLocal.toISOString().slice(0, 10);   // YYYY-MM-DD
    const horaLocal = ahoraLocal.toISOString().slice(11, 16); // HH:mm

    // 🕓 PERIODO DE GRACIA: el evento solo se marca 'vencido' cuando pasaron
    // 3 días desde la fecha del evento, para permitir elaborar el informe.
    const haceTresDias = new Date(ahoraLocal.getTime() - 3 * 24 * 60 * 60 * 1000);
    const fechaTope = haceTresDias.toISOString().slice(0, 10); // YYYY-MM-DD
    console.log('📅 Hoy (local UTC-4):', hoyLocal, horaLocal, '| Vence desde fecha <', fechaTope);

    // Candidatos: aprobados/activos cuya fecha ya pasó (o pasó hace hasta 3 días)
    const candidatos = await Evento.findAll({
      where: {
        [Op.and]: [
          sequelize.where(sequelize.fn('LEFT', sequelize.col('fechaevento'), 10), Op.lte, hoyLocal),
          { estado: { [Op.in]: ['aprobado', 'activo'] } }
        ]
      }
    });

    const porVencer = [];
    candidatos.forEach(e => {
      const fechaEv = String(e.fechaevento || '').slice(0, 10);
      if (fechaEv < fechaTope) {
        porVencer.push(e);
      } else if (fechaEv === fechaTope) {
        // El evento terminó hace exactamente 3 días: vence solo si su hora ya pasó
        const horaEv = String(e.horaevento || '').slice(0, 5);
        const esHoraValida = /^\d{2}:\d{2}$/.test(horaEv);
        if (esHoraValida && horaEv < horaLocal) porVencer.push(e);
      }
    });

    console.log(`📋 Candidatos: ${candidatos.length} | A vencer: ${porVencer.length}`);
    porVencer.forEach(e => {
      console.log(`   - ID:${e.idevento} | ${e.nombreevento} | Fecha:${e.fechaevento} | Hora:${e.horaevento} | Estado:${e.estado}`);
    });

    if (porVencer.length === 0) {
      console.log('✅ No hay eventos para actualizar');
      return;
    }

    // Actualizar
    console.log('🔄 Ejecutando UPDATE...');
    const idsPorVencer = porVencer.map(e => e.idevento);
    const [cantidad] = await Evento.update(
      { estado: 'vencido' },
      { where: {
          idevento: { [Op.in]: idsPorVencer },
          estado: { [Op.in]: ['aprobado', 'activo'] }
      }}
    );

    console.log(`✅ UPDATE completado. Filas afectadas: ${cantidad}`);

    // Verificar que se guardó
    const verificacion = await Evento.count({
      where: { estado: 'vencido' }
    });
    console.log(`🔍 Total eventos 'vencido' en BD: ${verificacion}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
};

const limpiarEventosMuyAntiguos = async () => {
  try {
    const { Evento } = getModels();
    const sequelize = getModels().sequelize;

    const haceDosSemanasLocal = new Date(Date.now() - 4 * 60 * 60 * 1000 - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [cantidad] = await Evento.destroy({
      where: {
        [Op.and]: [
          sequelize.where(sequelize.fn('LEFT', sequelize.col('fechaevento'), 10), Op.lt, haceDosSemanasLocal),
          { estado: 'vencido' }
        ]
      }
    });

    console.log(`🗑️ Cron: ${cantidad} eventos antiguos eliminados`);
  } catch (error) {
    console.error('❌ Error limpiando eventos antiguos:', error.message);
  }
};

const iniciarCronJobs = async () => {
  console.log('🕐 Iniciando cron jobs...');
  
  await marcarEventosVencidos();
  
  cron.schedule('*/30 * * * *', () => {
    // Cada 30 min para detectar el vencimiento por HORA de eventos del día
    console.log('🔄 Ejecutando cron: marcarEventosVencidos');
    marcarEventosVencidos();
  });
//domingo
  cron.schedule('0 3 * * 0', () => {
    console.log('🔄 Ejecutando cron: limpiarEventosMuyAntiguos');
    limpiarEventosMuyAntiguos();
  });

  console.log('✅ Cron jobs configurados:');
  console.log('   - Marcar vencidos (fecha u hora pasada): cada 30 minutos');
  console.log('   - Limpiar antiguos: Domingos a 03:00');
};

module.exports = { iniciarCronJobs };