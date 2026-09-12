const { getModels } = require('../models/index.js');

// Construye fragmento SQL de filtro por fechas (opcional) usando fechaevento
const filtroFecha = (q) => {
  const reemplazos = {};
  const condiciones = [];
  if (q.desde && /^\d{4}-\d{2}-\d{2}$/.test(q.desde)) {
    condiciones.push('e.fechaevento::date >= :desde');
    reemplazos.desde = q.desde;
  }
  if (q.hasta && /^\d{4}-\d{2}-\d{2}$/.test(q.hasta)) {
    condiciones.push('e.fechaevento::date <= :hasta');
    reemplazos.hasta = q.hasta;
  }
  return { where: condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '', replacements: reemplazos };
};

// ─── Inscripciones ─────────────────────────────────────────────────────────────
const getReporteInscripciones = async (req, res) => {
  try {
    const { sequelize } = getModels();
    const { where, replacements } = filtroFecha(req.query);

    const [totalRow] = await sequelize.query(
      `SELECT COUNT(*)::int AS total
       FROM evento_inscripciones ei
       JOIN evento e ON e.idevento = ei.idevento
       ${where}`, { replacements, type: sequelize.QueryTypes.SELECT }
    );

    const topEventos = await sequelize.query(
      `SELECT e.idevento, e.nombreevento, COALESCE(f.nombre_facultad, 'Sin facultad') AS facultad,
              COUNT(ei.idestudiante)::int AS inscritos
       FROM evento_inscripciones ei
       JOIN evento e ON e.idevento = ei.idevento
       LEFT JOIN academico a ON a.idacademico = e.idacademico
       LEFT JOIN facultad f ON f.facultad_id = a.facultad_id
       ${where}
       GROUP BY e.idevento, e.nombreevento, f.nombre_facultad
       ORDER BY inscritos DESC
       LIMIT 10`, { replacements, type: sequelize.QueryTypes.SELECT }
    );

    const porFacultad = await sequelize.query(
      `SELECT COALESCE(f.nombre_facultad, 'Sin facultad') AS facultad,
              COUNT(ei.idestudiante)::int AS inscritos
       FROM evento_inscripciones ei
       JOIN evento e ON e.idevento = ei.idevento
       LEFT JOIN academico a ON a.idacademico = e.idacademico
       LEFT JOIN facultad f ON f.facultad_id = a.facultad_id
       ${where}
       GROUP BY f.nombre_facultad
       ORDER BY inscritos DESC`, { replacements, type: sequelize.QueryTypes.SELECT }
    );

    const porMes = await sequelize.query(
      `SELECT TO_CHAR(COALESCE(ei.fecha_inscripcion, e.fechaevento)::date, 'YYYY-MM') AS mes,
              COUNT(*)::int AS inscritos
       FROM evento_inscripciones ei
       JOIN evento e ON e.idevento = ei.idevento
       ${where}
       GROUP BY 1
       ORDER BY 1 ASC`, { replacements, type: sequelize.QueryTypes.SELECT }
    );

    res.status(200).json({
      total: parseInt(totalRow?.total || 0),
      topEventos,
      porFacultad,
      porMes,
    });
  } catch (err) {
    console.error('❌ Error getReporteInscripciones:', err.message);
    res.status(500).json({ error: 'Error al generar reporte de inscripciones', message: err.message });
  }
};

// ─── Operacionales (tiempos, funnel, estados) ──────────────────────────────────
const getReporteOperacionales = async (req, res) => {
  try {
    const { sequelize } = getModels();
    const { where, replacements } = filtroFecha(req.query);

    const tiempoAprobacionPorMes = await sequelize.query(
      `SELECT TO_CHAR(e.fecha_aprobacion::date, 'YYYY-MM') AS mes,
              ROUND(AVG(EXTRACT(EPOCH FROM (e.fecha_aprobacion - e.created_at)) / 3600))::int AS horas
       FROM evento e
       WHERE e.fecha_aprobacion IS NOT NULL
         AND e.created_at IS NOT NULL
       GROUP BY 1
       ORDER BY 1 ASC`, { type: sequelize.QueryTypes.SELECT }
    );

    const porEstado = await sequelize.query(
      `SELECT COALESCE(e.estado, 'sin_estado') AS estado, COUNT(*)::int AS total
       FROM evento e
       ${where}
       GROUP BY 1
       ORDER BY total DESC`, { replacements, type: sequelize.QueryTypes.SELECT }
    );

    const porFase = await sequelize.query(
      `SELECT COALESCE(e.idfase, 0)::int AS idfase, COUNT(*)::int AS total
       FROM evento e
       ${where}
       GROUP BY 1
       ORDER BY 1 ASC`, { replacements, type: sequelize.QueryTypes.SELECT }
    );

    const noAprobados = await sequelize.query(
      `SELECT COALESCE(e.estado, 'sin_estado') AS estado, COUNT(*)::int AS total
       FROM evento e
       WHERE e.estado IN ('cancelado', 'vencido', 'rechazado')
       GROUP BY 1
       ORDER BY total DESC`, { type: sequelize.QueryTypes.SELECT }
    );

    res.status(200).json({
      tiempoAprobacionPorMes,
      porEstado,
      porFase,
      noAprobados,
    });
  } catch (err) {
    console.error('❌ Error getReporteOperacionales:', err.message);
    res.status(500).json({ error: 'Error al generar reporte operacional', message: err.message });
  }
};

// ─── Económicos (presupuesto vs real) ──────────────────────────────────────────
const getReporteEconomicos = async (req, res) => {
  try {
    const { sequelize } = getModels();

    const [resumen] = await sequelize.query(
      `SELECT
        (SELECT COALESCE(SUM(total_egresos), 0)    FROM presupuesto)    AS pres_egresos,
        (SELECT COALESCE(SUM(total_ingresos), 0)   FROM presupuesto)    AS pres_ingresos,
        (SELECT COALESCE(SUM(total_egresos_real), 0)  FROM informe_evento) AS real_egresos,
        (SELECT COALESCE(SUM(total_ingresos_real), 0) FROM informe_evento) AS real_ingresos,
        (SELECT COALESCE(SUM(balance_real), 0)     FROM informe_evento) AS balance_real`,
      { type: sequelize.QueryTypes.SELECT }
    );

    const resumenNumerico = {
      pres_egresos: parseFloat(resumen.pres_egresos || 0),
      pres_ingresos: parseFloat(resumen.pres_ingresos || 0),
      real_egresos: parseFloat(resumen.real_egresos || 0),
      real_ingresos: parseFloat(resumen.real_ingresos || 0),
      balance_real: parseFloat(resumen.balance_real || 0),
    };

    const porFacultad = await sequelize.query(
      `SELECT COALESCE(f.nombre_facultad, 'Sin facultad') AS facultad,
              ROUND(AVG(ie.total_egresos_real))::int AS egresos_promedio,
              ROUND(AVG(ie.total_ingresos_real))::int AS ingresos_promedio,
              ROUND(AVG(ie.balance_real))::int AS balance_promedio
       FROM informe_evento ie
       JOIN evento e ON e.idevento = ie.idevento
       LEFT JOIN academico a ON a.idacademico = e.idacademico
       LEFT JOIN facultad f ON f.facultad_id = a.facultad_id
       GROUP BY f.nombre_facultad
       ORDER BY egresos_promedio DESC`, { type: sequelize.QueryTypes.SELECT }
    );

    const porMes = await sequelize.query(
      `SELECT TO_CHAR(e.fechaevento::date, 'YYYY-MM') AS mes,
              ROUND(SUM(ie.balance_real))::int AS balance,
              ROUND(SUM(ie.total_egresos_real))::int AS egresos,
              ROUND(SUM(ie.total_ingresos_real))::int AS ingresos,
              COUNT(*)::int AS informes
       FROM informe_evento ie
       JOIN evento e ON e.idevento = ie.idevento
       WHERE e.fechaevento IS NOT NULL
       GROUP BY 1
       ORDER BY 1 ASC`, { type: sequelize.QueryTypes.SELECT }
    );

    const porEvento = await sequelize.query(
      `SELECT e.idevento, e.nombreevento, e.fechaevento,
              COALESCE(p.total_egresos, 0)  AS pres_egresos,
              COALESCE(p.total_ingresos, 0) AS pres_ingresos,
              COALESCE(ie.total_egresos_real, 0)  AS real_egresos,
              COALESCE(ie.total_ingresos_real, 0) AS real_ingresos,
              COALESCE(ie.balance_real, 0) AS balance_real
       FROM evento e
       LEFT JOIN presupuesto p ON p.idevento = e.idevento
       LEFT JOIN informe_evento ie ON ie.idevento = e.idevento
       ORDER BY e.fechaevento DESC
       LIMIT 20`, { type: sequelize.QueryTypes.SELECT }
    );

    res.status(200).json({
      resumen: resumenNumerico,
      porFacultad,
      porMes,
      porEvento,
    });
  } catch (err) {
    console.error('❌ Error getReporteEconomicos:', err.message);
    res.status(500).json({ error: 'Error al generar reporte económico', message: err.message });
  }
};

// ─── Recursos (más usados + conteo de solicitudes) ─────────────────────────────
const getReporteRecursos = async (req, res) => {
  try {
    const { sequelize } = getModels();
    const periodo = String(req.query.periodo || 'mes');

    let ini = 'CURRENT_DATE - INTERVAL \'1 month\'';
    if (periodo === 'semana') ini = 'CURRENT_DATE - INTERVAL \'7 days\'';
    if (periodo === 'trimestre') ini = 'CURRENT_DATE - INTERVAL \'3 months\'';

    const [counts] = await sequelize.query(
      `SELECT
        COUNT(*)::int AS totalSolicitudes,
        COUNT(*) FILTER (WHERE e.estado = 'aprobado')::int  AS aprobadas,
        COUNT(*) FILTER (WHERE e.estado = 'rechazado')::int AS rechazadas,
        COUNT(*) FILTER (WHERE e.estado = 'cancelado')::int AS canceladas,
        COUNT(*) FILTER (WHERE e.estado = 'vencido')::int   AS vencidas,
        COUNT(*) FILTER (WHERE COALESCE(e.estado,'') NOT IN ('aprobado','rechazado','cancelado','vencido'))::int AS pendientes
       FROM evento_recurso er
       JOIN evento e ON e.idevento = er.idevento
       WHERE e.fechaevento >= ${ini}`,
      { type: sequelize.QueryTypes.SELECT }
    );

    const recursosMasUsados = await sequelize.query(
      `SELECT r.nombre_recurso AS nombre, COUNT(er.idrecurso)::int AS usos
       FROM evento_recurso er
       JOIN recurso r ON r.idrecurso = er.idrecurso
       JOIN evento e ON e.idevento = er.idevento
       WHERE e.fechaevento >= ${ini}
       GROUP BY r.nombre_recurso
       ORDER BY usos DESC
       LIMIT 10`, { type: sequelize.QueryTypes.SELECT }
    );

    const eventoRecientes = await sequelize.query(
      `SELECT e.idevento AS id, e.nombreevento AS "nombreEvento",
              e.lugarevento,
              e.fechaevento,
              TO_CHAR(e.fechaevento::date, 'DD/MM/YYYY') AS fecha,
              CONCAT(COALESCE(u.nombre, 'Docente'), ' ', COALESCE(u.apellidopat, '')) AS solicitante,
              COUNT(er.idrecurso)::int AS "totalRecursos",
              INITCAP(COALESCE(e.estado, 'pendiente')) AS estado
       FROM evento e
       LEFT JOIN evento_recurso er ON er.idevento = e.idevento
       LEFT JOIN academico a ON a.idacademico = e.idacademico
       LEFT JOIN usuario u ON u.idusuario = a.idusuario
       WHERE e.fechaevento >= ${ini}
       GROUP BY e.idevento, e.nombreevento, e.lugarevento, e.fechaevento, u.nombre, u.apellidopat, e.estado
       ORDER BY e.fechaevento DESC
       LIMIT 8`, { type: sequelize.QueryTypes.SELECT }
    );

    res.status(200).json({
      totalSolicitudes: counts.totalSolicitudes || 0,
      aprobadas: counts.aprobadas || 0,
      rechazadas: counts.rechazadas || 0,
      canceladas: counts.canceladas || 0,
      vencidas: counts.vencidas || 0,
      pendientes: counts.pendientes || 0,
      recursosMasUsados,
      eventoRecientes,
    });
  } catch (err) {
    console.error('❌ Error getReporteRecursos:', err.message);
    res.status(500).json({ error: 'Error al generar reporte de recursos', message: err.message });
  }
};

// ─── Distribución por tipo de evento ───────────────────────────────────────────
const getReporteTipos = async (req, res) => {
  try {
    const { sequelize } = getModels();
    const { where, replacements } = filtroFecha(req.query);

    const porTipo = await sequelize.query(
      `SELECT COALESCE(te.nombretipoevento, 'Sin tipo') AS tipo,
              COUNT(et.idtipoevento)::int AS total
       FROM evento_tipos et
       JOIN tipo_evento te ON te.idtipoevento = et.idtipoevento
       JOIN evento e ON e.idevento = et.idevento
       ${where}
       GROUP BY te.nombretipoevento
       ORDER BY total DESC
       LIMIT 12`, { replacements, type: sequelize.QueryTypes.SELECT }
    );

    res.status(200).json({ porTipo });
  } catch (err) {
    console.error('❌ Error getReporteTipos:', err.message);
    res.status(500).json({ error: 'Error al generar distribución por tipo', message: err.message });
  }
};

module.exports = {
  getReporteInscripciones,
  getReporteOperacionales,
  getReporteEconomicos,
  getReporteRecursos,
  getReporteTipos,
};