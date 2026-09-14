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

    // Solo se compara la parte de fecha (10 primeros caracteres) porque la columna
    // fechaevento es VARCHAR y puede guardar '2026-09-14' o '2026-09-14 00:00:00.000 +00:00'.
    // Comparamos con la fecha de hoy en formato ISO (YYYY-MM-DD, UTC) para que un evento
    // del mismo día NO se marque como vencido.
    const hoyISO = new Date().toISOString().slice(0, 10);
    console.log('📅 Fecha de hoy (ISO):', hoyISO);

    const condicionVencier = sequelize.where(
      sequelize.fn('LEFT', sequelize.col('fechaevento'), 10),
      Op.lt,
      hoyISO
    );

    // Buscar eventos
    const eventosPorVencer = await Evento.findAll({
      where: {
        [Op.and]: [
          condicionVencier,
          { estado: { [Op.in]: ['aprobado', 'activo'] } }
        ]
      }
    });

    console.log(`📋 Encontrados ${eventosPorVencer.length} eventos por vencer`);
    eventosPorVencer.forEach(e => {
      console.log(`   - ID:${e.idevento} | ${e.nombreevento} | Fecha:${e.fechaevento} | Estado:${e.estado}`);
    });

    if (eventosPorVencer.length === 0) {
      console.log('✅ No hay eventos para actualizar');
      return;
    }

    // Actualizar
    console.log('🔄 Ejecutando UPDATE...');
    const [cantidad] = await Evento.update(
  { estado: 'vencido' },  
  { where:  {
      [Op.and]: [
        condicionVencier,
        { estado: { [Op.in]: ['aprobado', 'activo'] } }
      ]
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

    const haceDosSemanasISO = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [cantidad] = await Evento.destroy({
      where: {
        [Op.and]: [
          sequelize.where(sequelize.fn('LEFT', sequelize.col('fechaevento'), 10), Op.lt, haceDosSemanasISO),
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
  
  cron.schedule('0 0 * * *', () => {
    console.log('🔄 Ejecutando cron: marcarEventosVencidos');
    marcarEventosVencidos();
  });
//domingo
  cron.schedule('0 3 * * 0', () => {
    console.log('🔄 Ejecutando cron: limpiarEventosMuyAntiguos');
    limpiarEventosMuyAntiguos();
  });

  console.log('✅ Cron jobs configurados:');
  console.log('   - Marcar vencidos: Todos los días a 00:00');
  console.log('   - Limpiar antiguos: Domingos a 03:00');
};

module.exports = { iniciarCronJobs };