// controllers/dafController.js
const { getModels } = require('../models/index.js');
const { sendNotification } = require('./notificationController.js');
// Helper para calcular fechas según período
const getDateRange = (periodo) => {
  const now = new Date();
  let start = new Date();
  
  switch (periodo) {
    case 'semana':
      start.setDate(now.getDate() - 7);
      break;
    case 'trimestre':
      start.setMonth(now.getMonth() - 3);
      break;
    case 'mes':
    default:
      start.setMonth(now.getMonth() - 1);
      break;
  }
  
  return { start, end: now };
};

const reportes = async (req, res) => {
   try {
    const { periodo = 'mes' } = req.query;
    const { start, end } = getDateRange(periodo);
    const { sequelize } = getModels();

    console.log('📊 Reporte DAF - Período:', periodo);

    // 1️⃣ Conteos por estado (solo fase 2)
    const [totalResult, aprobadasResult, rechazadasResult, pendientesResult] = await Promise.all([
      sequelize.query(
        `SELECT COUNT(*) as count FROM evento WHERE fechaevento BETWEEN $1 AND $2 AND idfase = 2`,
        { bind: [start, end], type: sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT COUNT(*) as count FROM evento WHERE fechaevento BETWEEN $1 AND $2 AND idfase = 2 AND estado = 'aprobado'`,
        { bind: [start, end], type: sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT COUNT(*) as count FROM evento WHERE fechaevento BETWEEN $1 AND $2 AND idfase = 2 AND estado = 'rechazado'`,
        { bind: [start, end], type: sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT COUNT(*) as count FROM evento WHERE fechaevento BETWEEN $1 AND $2 AND idfase = 2 AND estado = 'pendiente'`,
        { bind: [start, end], type: sequelize.QueryTypes.SELECT }
      ),
    ]);

    const totalSolicitudes = parseInt(totalResult[0]?.count) || 0;
    const aprobadas = parseInt(aprobadasResult[0]?.count) || 0;
    const rechazadas = parseInt(rechazadasResult[0]?.count) || 0;
    const pendientes = parseInt(pendientesResult[0]?.count) || 0;

    // 2️⃣ Recursos más usados
    const recursosMasUsados = await sequelize.query(`
      SELECT 
        r.nombre_recurso as nombre,
        COUNT(re.idrecurso) as usos
      FROM recurso r
      INNER JOIN evento_recurso re ON re.idrecurso = r.idrecurso
      INNER JOIN evento e ON e.idevento = re.idevento
      WHERE e.fechaevento BETWEEN $1 AND $2
        AND e.idfase = 2
      GROUP BY r.idrecurso, r.nombre_recurso
      ORDER BY usos DESC
      LIMIT 5
    `, { 
      bind: [start, end], 
      type: sequelize.QueryTypes.SELECT 
    });

    // 3️⃣ Eventos recientes
    const eventoRecientes = await sequelize.query(`
      SELECT 
        e.idevento as id,
        e.nombreevento as "nombreEvento",
        e.estado,
        e.fechaevento,
        COUNT(er.idrecurso) as "totalRecursos",
        COALESCE(a.nombre || ' ' || a.apellidopat, 'Desconocido') as solicitante
      FROM evento e
      LEFT JOIN evento_recurso er ON er.idevento = e.idevento
      LEFT JOIN academico a ON a.idacademico = e.idacademico
      WHERE e.idfase = 2 
        AND e.fechaevento BETWEEN $1 AND $2
      GROUP BY e.idevento, a.nombre, a.apellidopat
      ORDER BY e.fechaevento DESC
      LIMIT 5
    `, { 
      bind: [start, end], 
      type: sequelize.QueryTypes.SELECT 
    });

    // ✅ Respuesta
    res.json({
      totalSolicitudes,
      aprobadas,
      rechazadas,
      pendientes,
      recursosMasUsados: recursosMasUsados.map(r => ({
        nombre: r.nombre,
        usos: parseInt(r.usos)
      })),
      eventoRecientes: eventoRecientes.map(ev => ({
        id: ev.id,
        nombreEvento: ev.nombreEvento,
        solicitante: ev.solicitante || 'Desconocido',
        fecha: ev.fechaevento ? new Date(ev.fechaevento).toLocaleDateString('es-ES') : 'N/A',
        estado: ev.estado?.charAt(0).toUpperCase() + ev.estado?.slice(1) || 'Pendiente',
        totalRecursos: parseInt(ev.totalRecursos) || 0
      }))
    });

  } catch (error) {
    console.error('❌ Error en /reportes:', error);
    res.status(500).json({ 
      error: 'Error al obtener reportes',
      details: error.message 
    });
  }
};

const columnExists = async (sequelize, table, column) => {
  const [row] = await sequelize.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' AND column_name = '${column}' LIMIT 1`,
    { type: sequelize.QueryTypes.SELECT }
  );
  return !!row;
};

const getSolicitudes = async (req, res) => {
  try {
    const models = getModels();
    const { sequelize } = models;

    const eventos = await sequelize.query(`
      SELECT
        e.idevento,
        e.nombreevento,
        e.fechaevento,
        e.horaevento,
        e.lugarevento,
        e.descripcion,
        e.estado,
        COALESCE(e.comentarios_admin, e.razon_rechazo) AS observaciones,
        a.nombre AS "academicoNombre",
        a.apellidopat AS "academicoApellido"
      FROM evento e
      LEFT JOIN academico a ON a.idacademico = e.idacademico
      WHERE e.idfase = 2
      ORDER BY e.fechaevento DESC
    `, { type: sequelize.QueryTypes.SELECT });

    if (eventos.length === 0) {
      return res.json([]);
    }

    const hasCantidadCol = await columnExists(sequelize, 'evento_recurso', 'cantidad');
    const cantidadSelect = hasCantidadCol
      ? 'er.cantidad AS "cantidadAprobada"'
      : 'NULL AS "cantidadAprobada"';

    const placeholders = eventos.map((_, i) => `$${i + 1}`).join(', ');
    const recursosPorEvento = await sequelize.query(`
      SELECT
        er.idevento,
        r.idrecurso,
        r.nombre_recurso,
        r.recurso_tipo,
        r.cantidad AS "cantidadSolicitada",
        ${cantidadSelect}
      FROM evento_recurso er
      INNER JOIN recurso r ON r.idrecurso = er.idrecurso
      WHERE er.idevento IN (${placeholders})
    `, { bind: eventos.map(e => e.idevento), type: sequelize.QueryTypes.SELECT });

    const recursosMap = {};
    recursosPorEvento.forEach(rec => {
      (recursosMap[rec.idevento] = recursosMap[rec.idevento] || []).push({
        idrecurso: rec.idrecurso,
        nombre_recurso: rec.nombre_recurso,
        recurso_tipo: rec.recurso_tipo,
        cantidadSolicitada: parseInt(rec.cantidadSolicitada, 10) || 0,
        cantidadAprobada: rec.cantidadAprobada !== null && rec.cantidadAprobada !== undefined
          ? parseInt(rec.cantidadAprobada, 10)
          : null,
      });
    });

    res.json(eventos.map(ev => ({
      idevento: ev.idevento,
      nombreevento: ev.nombreevento,
      fechaevento: ev.fechaevento,
      horaevento: ev.horaevento,
      lugar: ev.lugarevento,
      descripcion: ev.descripcion,
      estadoDAF: ev.estado || 'pendiente',
      observacionesDAF: ev.observaciones,
      academicoCreador: {
        nombre: ev.academicoNombre,
        apellidopat: ev.academicoApellido,
      },
      recursosEvento: recursosMap[ev.idevento] || [],
    })));
  } catch (error) {
    console.error('❌ Error en /daf/solicitudes:', error);
    res.status(500).json({ error: 'Error al obtener solicitudes', details: error.message });
  }
};

const aprobarSolicitud = async (req, res) => {
  try {
    const { idevento } = req.params;
    const { recursos = [], observaciones } = req.body;
    const models = getModels();
    const { sequelize, Evento } = models;

    const evento = await Evento.findByPk(idevento);
    if (!evento) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    await evento.update({
      estado: 'aprobado',
      fecha_aprobacion: new Date(),
      admin_aprobador: req.user?.username || req.user?.email || 'DAF',
      comentarios_admin: observaciones || null,
    });

    const hasCantidadCol = await columnExists(sequelize, 'evento_recurso', 'cantidad');
    if (hasCantidadCol && recursos.length > 0) {
      for (const rec of recursos) {
        await sequelize.query(
          `UPDATE evento_recurso SET cantidad = ? WHERE idevento = ? AND idrecurso = ?`,
          { replacements: [parseInt(rec.cantidadAprobada, 10) || 0, idevento, rec.idrecurso] }
        );
      }
    }

    if (evento.idacademico) {
      try {
        await sendNotification({
          idusuario: evento.idacademico,
          titulo: '✅ Recursos Aprobados',
          mensaje: `La solicitud de recursos de "${evento.nombreevento}" fue aprobada por DAF.`,
          tipo: 'evento_aprobado',
        });
      } catch (notifError) {
        console.warn('⚠️ No se pudo notificar la aprobación:', notifError.message);
      }
    }

    res.json({ message: 'Solicitud aprobada correctamente', idevento });
  } catch (error) {
    console.error('❌ Error al aprobar solicitud:', error);
    res.status(500).json({ error: 'Error al aprobar la solicitud', details: error.message });
  }
};

const rechazarSolicitud = async (req, res) => {
  try {
    const { idevento } = req.params;
    const { recursos = [], observaciones } = req.body;
    const models = getModels();
    const { sequelize, Evento } = models;

    const evento = await Evento.findByPk(idevento);
    if (!evento) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    const motivo = observaciones || 'Sin motivo especificado';

    await evento.update({
      estado: 'rechazado',
      fecha_rechazo: new Date(),
      razon_rechazo: motivo,
      admin_aprobador: req.user?.username || req.user?.email || 'DAF',
      comentarios_admin: motivo,
    });

    const hasCantidadCol = await columnExists(sequelize, 'evento_recurso', 'cantidad');
    if (hasCantidadCol && recursos.length > 0) {
      for (const rec of recursos) {
        await sequelize.query(
          `UPDATE evento_recurso SET cantidad = 0 WHERE idevento = ? AND idrecurso = ?`,
          { replacements: [idevento, rec.idrecurso] }
        );
      }
    }

    if (evento.idacademico) {
      try {
        await sendNotification({
          idusuario: evento.idacademico,
          titulo: '❌ Recursos Rechazados',
          mensaje: `La solicitud de recursos de "${evento.nombreevento}" fue rechazada. Motivo: ${motivo}`,
          tipo: 'evento_rechazado',
        });
      } catch (notifError) {
        console.warn('⚠️ No se pudo notificar el rechazo:', notifError.message);
      }
    }

    res.json({ message: 'Solicitud rechazada correctamente', idevento, estado: 'rechazado' });
  } catch (error) {
    console.error('❌ Error al rechazar solicitud:', error);
    res.status(500).json({ error: 'Error al rechazar la solicitud', details: error.message });
  }
};

module.exports = { reportes, getSolicitudes, aprobarSolicitud, rechazarSolicitud };