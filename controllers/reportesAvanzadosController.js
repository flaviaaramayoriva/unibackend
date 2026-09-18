const { getModels } = require('../models/index.js');

// Casteo SEGURO de columna texto (formato ISO) a timestamp.
// Las columnas de fecha de la BD son character varying: esto evita que
// valores NULL/vac�os o no-parseables rompan los queries.
const safeDate = (col) =>
  `CASE WHEN NULLIF(TRIM(${col}),'') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN NULLIF(TRIM(${col}),'')::timestamp END`;

// Construye fragmentos SQL de filtro opcionales sobre la tabla `evento e`:
// � rango de fechas (desde/hasta -> fechaevento)
// � facultad del creador (facultad_id -> academico de origen)
// � tipo de evento (tipo -> evento_tipos)
// � usuario logueado: los acad�micos solo ven sus propios eventos; admin/DAF
//   pueden adem�s filtrar por un idacademico concreto (q.idacademico).
// Devuelve { where, replacements }; `where` empieza con WHERE o est� vac�o.
const filtros = async (q, user) => {
  const reemplazos = {};
  const condiciones = [];
  if (q.desde && /^\d{4}-\d{2}-\d{2}$/.test(q.desde)) {
    condiciones.push(`${safeDate('e.fechaevento')} >= :desde`);
    reemplazos.desde = q.desde;
  }
  if (q.hasta && /^\d{4}-\d{2}-\d{2}$/.test(q.hasta)) {
    condiciones.push(`${safeDate('e.fechaevento')} <= :hasta`);
    reemplazos.hasta = q.hasta;
  }
  // Alcance por creador seg�n rol
  if (user) {
    if (user.role === 'academico') {
      const { Academico } = getModels();
      const acad = await Academico.findOne({ where: { idusuario: user.idusuario }, attributes: ['idacademico'] });
      if (acad) {
        condiciones.push('e.idacademico = :idacademico');
        reemplazos.idacademico = acad.idacademico;
      } else {
        condiciones.push('1 = 0'); // perfil acad�mico inexistente: sin datos
      }
    } else {
      const ac = parseInt(q.idacademico, 10);
      if (ac) {
        condiciones.push('e.idacademico = :idacademico');
        reemplazos.idacademico = ac;
      }
    }
  }
  const fac = parseInt(q.facultad_id, 10);
  if (fac) {
    condiciones.push(
      `EXISTS (SELECT 1 FROM academico af JOIN facultad ff ON ff.facultad_id = af.facultad_id ` +
      `WHERE af.idacademico = e.idacademico AND ff.facultad_id = :facultad_id)`
    );
    reemplazos.facultad_id = fac;
  }
  const tipo = parseInt(q.tipo, 10);
  if (tipo) {
    condiciones.push(
      `EXISTS (SELECT 1 FROM evento_tipos etj WHERE etj.idevento = e.idevento AND etj.idtipoevento = :tipo)`
    );
    reemplazos.tipo = tipo;
  }
  return { where: condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '', replacements: reemplazos };
};

// Cat�logo de acad�micos para el selector de admin/DAF ("Ver reportes de...").
const getReporteAcademicos = async (req, res) => {
  try {
    const { sequelize } = getModels();
    const rows = await sequelize.query(
      `SELECT a.idacademico,
              CONCAT(COALESCE(u.nombre, 'Docente'), ' ', COALESCE(u.apellidopat, ''), ' ', COALESCE(u.apellidomat, '')) AS nombre,
              COALESCE(f.nombre_facultad, 'Sin facultad') AS facultad
       FROM academico a
       JOIN usuario u ON u.idusuario = a.idusuario
       LEFT JOIN facultad f ON f.facultad_id = a.facultad_id
       ORDER BY u.nombre ASC, u.apellidopat ASC`,
      { type: sequelize.QueryTypes.SELECT }
    );
    res.status(200).json(rows.map(r => ({
      idacademico: r.idacademico,
      nombre: r.nombre,
      facultad: r.facultad,
    })));
  } catch (err) {
    console.error('? Error getReporteAcademicos:', err.message);
    res.status(500).json({ error: 'Error al obtener acad�micos', message: err.message });
  }
};

// --- Inscripciones -------------------------------------------------------------
const getReporteInscripciones = async (req, res) => {
  try {
    const { sequelize } = getModels();
    const { where, replacements } = await filtros(req.query, req.user);

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
      `SELECT TO_CHAR(COALESCE(
         ${safeDate('ei.fecha_inscripcion')},
         ${safeDate('e.fechaevento')}
       ), 'YYYY-MM') AS mes,
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
    console.error('? Error getReporteInscripciones:', err.message);
    res.status(500).json({ error: 'Error al generar reporte de inscripciones', message: err.message });
  }
};

// --- Operacionales (tiempos, funnel, estados) ----------------------------------
const getReporteOperacionales = async (req, res) => {
  try {
    const { sequelize } = getModels();
    const { where, replacements } = await filtros(req.query, req.user);

    const tiempoAprobacionPorMes = await sequelize.query(
      `SELECT TO_CHAR(x.fa, 'YYYY-MM') AS mes,
              ROUND(AVG(EXTRACT(EPOCH FROM (x.fa - x.ca)) / 3600))::int AS horas
       FROM (
         SELECT ${safeDate('e.fecha_aprobacion')} AS fa,
                ${safeDate('e.created_at')}       AS ca
         FROM evento e
         ${where}
       ) x
       WHERE x.fa IS NOT NULL AND x.ca IS NOT NULL
       GROUP BY 1
       ORDER BY 1 ASC`, { replacements: replacements || undefined, type: sequelize.QueryTypes.SELECT }
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

    const condNoAp = `e.estado IN ('cancelado', 'vencido', 'rechazado')`;
    const noAprobados = await sequelize.query(
      `SELECT COALESCE(e.estado, 'sin_estado') AS estado, COUNT(*)::int AS total
       FROM evento e
       ${where ? `${where} AND ${condNoAp}` : `WHERE ${condNoAp}`}
       GROUP BY 1
       ORDER BY total DESC`, { replacements: replacements || undefined, type: sequelize.QueryTypes.SELECT }
    );

    res.status(200).json({
      tiempoAprobacionPorMes,
      porEstado,
      porFase,
      noAprobados,
    });
  } catch (err) {
    console.error('? Error getReporteOperacionales:', err.message);
    res.status(500).json({ error: 'Error al generar reporte operacional', message: err.message });
  }
};

// --- Econ�micos (presupuesto vs real) ------------------------------------------
const getReporteEconomicos = async (req, res) => {
  try {
    const { sequelize } = getModels();
    const { where, replacements } = await filtros(req.query, req.user);

    // Presupuesto planificado es global (no depende de fechas del evento)
    const [pres] = await sequelize.query(
      `SELECT COALESCE(SUM(total_egresos), 0) AS egresos,
              COALESCE(SUM(total_ingresos), 0) AS ingresos
       FROM presupuesto`,
      { type: sequelize.QueryTypes.SELECT }
    );

    // Ejecuci�n real filtrada por fechas del evento
    const [real] = await sequelize.query(
      `SELECT COALESCE(SUM(ie.total_egresos_real), 0)  AS egresos,
              COALESCE(SUM(ie.total_ingresos_real), 0) AS ingresos,
              COALESCE(SUM(ie.balance_real), 0)        AS balance
       FROM informe_evento ie
       JOIN evento e ON e.idevento = ie.idevento
       ${where}`,
      { replacements, type: sequelize.QueryTypes.SELECT }
    );

    const resumenNumerico = {
      pres_egresos: parseFloat(pres?.egresos || 0),
      pres_ingresos: parseFloat(pres?.ingresos || 0),
      real_egresos: parseFloat(real?.egresos || 0),
      real_ingresos: parseFloat(real?.ingresos || 0),
      balance_real: parseFloat(real?.balance || 0),
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
       ${where}
       GROUP BY f.nombre_facultad
       ORDER BY egresos_promedio DESC`, { replacements, type: sequelize.QueryTypes.SELECT }
    );

    const porMes = await sequelize.query(
      `SELECT TO_CHAR(${safeDate('e.fechaevento')}, 'YYYY-MM') AS mes,
              ROUND(SUM(ie.balance_real))::int AS balance,
              ROUND(SUM(ie.total_egresos_real))::int AS egresos,
              ROUND(SUM(ie.total_ingresos_real))::int AS ingresos,
              COUNT(*)::int AS informes
       FROM informe_evento ie
       JOIN evento e ON e.idevento = ie.idevento
       ${where ? where : 'WHERE e.fechaevento IS NOT NULL'}
       GROUP BY 1
       ORDER BY 1 ASC`, { replacements, type: sequelize.QueryTypes.SELECT }
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
       ${where}
       ORDER BY e.fechaevento DESC
       LIMIT 20`, { replacements, type: sequelize.QueryTypes.SELECT }
    );

    res.status(200).json({
      resumen: resumenNumerico,
      porFacultad,
      porMes,
      porEvento,
    });
  } catch (err) {
    console.error('? Error getReporteEconomicos:', err.message);
    res.status(500).json({ error: 'Error al generar reporte econ�mico', message: err.message });
  }
};

// --- Recursos (m�s usados + conteo de solicitudes) -----------------------------
const getReporteRecursos = async (req, res) => {
  try {
    const { sequelize } = getModels();
    const periodo = String(req.query.periodo || 'mes');

    let ini = 'CURRENT_DATE - INTERVAL \'1 month\'';
    if (periodo === 'semana') ini = 'CURRENT_DATE - INTERVAL \'7 days\'';
    if (periodo === 'trimestre') ini = 'CURRENT_DATE - INTERVAL \'3 months\'';

    // Si llegan fechas expl�citas (desde/hasta), se usan en lugar de la ventana fija
    const { where, replacements } = await filtros(req.query, req.user);
    const condiciones = where ? where.replace(/^WHERE\s+/, '') : '';
    const condFecha = condiciones || `${safeDate('e.fechaevento')} >= ${ini}`;

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
       WHERE ${condFecha}`,
      { replacements: replacements || undefined, type: sequelize.QueryTypes.SELECT }
    );

    const recursosMasUsados = await sequelize.query(
      `SELECT r.nombre_recurso AS nombre, COUNT(er.idrecurso)::int AS usos
       FROM evento_recurso er
       JOIN recurso r ON r.idrecurso = er.idrecurso
       JOIN evento e ON e.idevento = er.idevento
       WHERE ${condFecha}
       GROUP BY r.nombre_recurso
       ORDER BY usos DESC
       LIMIT 10`, { replacements: replacements || undefined, type: sequelize.QueryTypes.SELECT }
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
       WHERE ${condFecha}
       GROUP BY e.idevento, e.nombreevento, e.lugarevento, e.fechaevento, u.nombre, u.apellidopat, e.estado
       ORDER BY e.fechaevento DESC
       LIMIT 8`, { replacements: replacements || undefined, type: sequelize.QueryTypes.SELECT }
    );

    const topInscripciones = await sequelize.query(
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

    const porFacultadInscripciones = await sequelize.query(
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

    const porMesInscripciones = await sequelize.query(
      `SELECT TO_CHAR(COALESCE(
         ${safeDate('ei.fecha_inscripcion')},
         ${safeDate('e.fechaevento')}
       ), 'YYYY-MM') AS mes,
               COUNT(*)::int AS inscritos
       FROM evento_inscripciones ei
       JOIN evento e ON e.idevento = ei.idevento
       ${where}
       GROUP BY 1
       ORDER BY 1 ASC`, { replacements, type: sequelize.QueryTypes.SELECT }
    );

    const porTipoEvento = await sequelize.query(
      `SELECT te.idtipoevento, COALESCE(te.nombretipo, 'Sin tipo') AS tipo,
              COUNT(et.idtipoevento)::int AS total
       FROM evento_tipos et
       JOIN tipos_de_evento te ON te.idtipoevento = et.idtipoevento
       JOIN evento e ON e.idevento = et.idevento
       ${where}
       GROUP BY te.idtipoevento, te.nombretipo
       ORDER BY total DESC
       LIMIT 12`, { replacements, type: sequelize.QueryTypes.SELECT }
    );

    const tiempoAprobacion = await sequelize.query(
      `SELECT TO_CHAR(x.fa, 'YYYY-MM') AS mes,
              ROUND(AVG(EXTRACT(EPOCH FROM (x.fa - x.ca)) / 3600))::int AS horas
       FROM (
         SELECT ${safeDate('e.fecha_aprobacion')} AS fa,
                ${safeDate('e.created_at')}       AS ca
         FROM evento e
         ${where}
       ) x
       WHERE x.fa IS NOT NULL AND x.ca IS NOT NULL
       GROUP BY 1
       ORDER BY 1 ASC`, { replacements: replacements || undefined, type: sequelize.QueryTypes.SELECT }
    );

    const porEstado = await sequelize.query(
      `SELECT COALESCE(e.estado, 'sin_estado') AS estado, COUNT(*)::int AS total
       FROM evento e
       ${where}
       GROUP BY 1
       ORDER BY total DESC`, { replacements: replacements || undefined, type: sequelize.QueryTypes.SELECT }
    );

    const porFase = await sequelize.query(
      `SELECT COALESCE(e.idfase, 0)::int AS idfase, COUNT(*)::int AS total
       FROM evento e
       ${where}
       GROUP BY 1
       ORDER BY 1 ASC`, { replacements: replacements || undefined, type: sequelize.QueryTypes.SELECT }
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
      topInscripciones,
      porFacultadInscripciones,
      porMesInscripciones,
      porTipoEvento,
      tiempoAprobacion,
      porEstado,
      porFase,
    });
  } catch (err) {
    console.error('? Error getReporteRecursos:', err.message);
    res.status(500).json({ error: 'Error al generar reporte de recursos', message: err.message });
  }
};

// --- Distribuci�n por tipo de evento -------------------------------------------
const getReporteTipos = async (req, res) => {
  try {
    const { sequelize } = getModels();
    const { where, replacements } = await filtros(req.query, req.user);

    const porTipo = await sequelize.query(
      `SELECT te.idtipoevento, COALESCE(te.nombretipo, 'Sin tipo') AS tipo,
              COUNT(et.idtipoevento)::int AS total
       FROM evento_tipos et
       JOIN tipos_de_evento te ON te.idtipoevento = et.idtipoevento
       JOIN evento e ON e.idevento = et.idevento
       ${where}
       GROUP BY te.idtipoevento, te.nombretipo
       ORDER BY total DESC
       LIMIT 12`, { replacements, type: sequelize.QueryTypes.SELECT }
    );

res.status(200).json({ porTipo });
  } catch (err) {
    console.error('? Error getReporteTipos:', err.message);
    res.status(500).json({ error: 'Error al generar distribuci�n por tipo', message: err.message });
  }
};

// ─── Mensual (tendencia) con alcance y filtros del área de reportes ────────────
const getReporteMensual = async (req, res) => {
  try {
    const { sequelize } = getModels();
    const { where, replacements } = await filtros(req.query, req.user);
    const condFecha = `${safeDate('e.fechaevento')} IS NOT NULL`;
    const result = await sequelize.query(
      `SELECT
         TO_CHAR(${safeDate('e.fechaevento')}, 'YYYY-MM') AS mes,
         COUNT(*) FILTER (WHERE e.estado = 'aprobado')::int AS aprobado,
         COUNT(*) FILTER (WHERE e.estado = 'pendiente')::int AS pendiente,
         COUNT(*) FILTER (WHERE e.estado = 'rechazado')::int AS rechazado,
         COUNT(*)::int AS total
       FROM evento e
       ${where ? `${where} AND ${condFecha}` : `WHERE ${condFecha}`}
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT 24`,
      { replacements: replacements || undefined, type: sequelize.QueryTypes.SELECT }
    );
    const reportes = result.map(row => ({
      mes: row.mes,
      totalEvents: parseInt(row.total),
      aprobado: row.aprobado,
      pendiente: row.pendiente,
      rechazado: row.rechazado,
      tasaAprobacion: row.total > 0 ? parseFloat(((row.aprobado / row.total) * 100).toFixed(1)) : 0,
    }));
    res.status(200).json(reportes);
  } catch (err) {
    console.error('? Error getReporteMensual:', err.message);
    res.status(500).json({ error: 'Error al obtener datos mensuales', message: err.message });
  }
};

// ─── Gestión (KPIs de calidad: tiempos, asistencia, presupuesto, solicitantes) ─
const getReporteGestion = async (req, res) => {
  try {
    const { sequelize } = getModels();
    const { where, replacements } = await filtros(req.query, req.user);
    const rr = replacements || undefined;

    // 1. Totales y tiempo promedio de aprobaci�n (d�as)
    const [agg] = await sequelize.query(`
      SELECT
        COUNT(*)::int AS totalEventos,
        COUNT(*) FILTER (WHERE e.estado = 'aprobado')::int AS aprobados,
        COUNT(*) FILTER (WHERE e.estado = 'pendiente')::int AS pendientes,
        COUNT(*) FILTER (WHERE e.estado = 'rechazado')::int AS rechazados,
        ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (
          ${safeDate('e.fecha_aprobacion')} - ${safeDate('e.created_at')}
        )) / 86400), 1)) AS diasPromedioAprobacion
      FROM evento e
      ${where}`, { replacements: rr, type: sequelize.QueryTypes.SELECT }
    );

    // 2. Asistencia total (segmento objetivo alcanzado en informes)
    const [asis] = await sequelize.query(`
      SELECT COALESCE(SUM(
        COALESCE(ie.segmento_alcanzado_estudiantes, 0) +
        COALESCE(ie.segmento_alcanzado_docentes, 0) +
        COALESCE(ie.segmento_alcanzado_publico_externo, 0) +
        COALESCE(ie.segmento_alcanzado_influencers, 0) +
        COALESCE(ie.segmento_alcanzado_otro_cantidad, 0)
      ), 0)::int AS asistentes
      FROM evento e
      LEFT JOIN informe_evento ie ON ie.idevento = e.idevento
      ${where}`, { replacements: rr, type: sequelize.QueryTypes.SELECT }
    );

    // 3. Inscritos totales
    const [insc] = await sequelize.query(`
      SELECT COUNT(*)::int AS inscritos
      FROM evento_inscripciones ei
      JOIN evento e ON e.idevento = ei.idevento
      ${where}`, { replacements: rr, type: sequelize.QueryTypes.SELECT }
    );

    // 4. Ejecuci�n presupuestaria (presupuesto planificado vs real)
    const [eje] = await sequelize.query(`
      SELECT COALESCE(SUM(p.total_egresos), 0)  AS pres_egresos,
             COALESCE(SUM(p.total_ingresos), 0) AS pres_ingresos,
             COALESCE(SUM(ie.total_egresos_real), 0)  AS real_egresos,
             COALESCE(SUM(ie.total_ingresos_real), 0) AS real_ingresos,
             COALESCE(SUM(ie.balance_real), 0)        AS balance_real
      FROM evento e
      LEFT JOIN presupuesto p ON p.idevento = e.idevento
      LEFT JOIN informe_evento ie ON ie.idevento = e.idevento
      ${where}`, { replacements: rr, type: sequelize.QueryTypes.SELECT }
    );

    // 5. Aceptaci�n por facultad
    const aceptacionPorFacultad = await sequelize.query(`
      SELECT COALESCE(f.nombre_facultad, 'Sin facultad') AS facultad,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE e.estado = 'aprobado')::int AS aprobados
      FROM evento e
      LEFT JOIN academico a ON a.idacademico = e.idacademico
      LEFT JOIN facultad f ON f.facultad_id = a.facultad_id
      ${where}
      GROUP BY f.nombre_facultad
      ORDER BY aprobados DESC
      LIMIT 10`, { replacements: rr, type: sequelize.QueryTypes.SELECT }
    );

    // 6. Top solicitantes (por eventos aprobados)
    const topSolicitantes = await sequelize.query(`
      SELECT CONCAT(COALESCE(u.nombre, 'Docente'), ' ', COALESCE(u.apellidopat, '')) AS nombre,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE e.estado = 'aprobado')::int AS aprobados
      FROM evento e
      JOIN academico a ON a.idacademico = e.idacademico
      JOIN usuario u ON u.idusuario = a.idusuario
      ${where}
      GROUP BY u.nombre, u.apellidopat
      ORDER BY aprobados DESC, total DESC
      LIMIT 8`, { replacements: rr, type: sequelize.QueryTypes.SELECT }
    );

    // 7. Asistencia por evento (para columnas de la tabla)
    const asistenciaPorEvento = await sequelize.query(`
      SELECT e.idevento,
             (SELECT COUNT(*)::int FROM evento_inscripciones ei WHERE ei.idevento = e.idevento) AS inscritos,
             (COALESCE(ie.segmento_alcanzado_estudiantes, 0) +
              COALESCE(ie.segmento_alcanzado_docentes, 0) +
              COALESCE(ie.segmento_alcanzado_publico_externo, 0) +
              COALESCE(ie.segmento_alcanzado_influencers, 0) +
              COALESCE(ie.segmento_alcanzado_otro_cantidad, 0)) AS asistentes
      FROM evento e
      LEFT JOIN informe_evento ie ON ie.idevento = e.idevento
      ${where}
      ORDER BY e.fechaevento DESC`, { replacements: rr, type: sequelize.QueryTypes.SELECT }
    );

    // 8. Ejecuci�n presupuestaria por evento (para columnas de la tabla)
    const ejecucionPorEvento = await sequelize.query(`
      SELECT e.idevento,
             COALESCE(p.total_egresos, 0)  AS pres_egresos,
             COALESCE(p.total_ingresos, 0) AS pres_ingresos,
             COALESCE(ie.total_egresos_real, 0)  AS real_egresos,
             COALESCE(ie.total_ingresos_real, 0) AS real_ingresos
      FROM evento e
      LEFT JOIN presupuesto p ON p.idevento = e.idevento
      LEFT JOIN informe_evento ie ON ie.idevento = e.idevento
      ${where}
      ORDER BY e.fechaevento DESC`, { replacements: rr, type: sequelize.QueryTypes.SELECT }
    );

    const totalEventos = parseInt(agg?.totalEventos || 0);
    const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : null);
    const pct1 = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

    res.status(200).json({
      totalEventos,
      aprobados: parseInt(agg?.aprobados || 0),
      pendientes: parseInt(agg?.pendientes || 0),
      rechazados: parseInt(agg?.rechazados || 0),
      diasPromedioAprobacion: agg?.diasPromedioAprobacion !== null && agg?.diasPromedioAprobacion !== undefined
        ? Number(agg.diasPromedioAprobacion) : null,
      asistentes: parseInt(asis?.asistentes || 0),
      inscritos: parseInt(insc?.inscritos || 0),
      tasaAsistencia: pct1(parseInt(asis?.asistentes || 0), parseInt(insc?.inscritos || 0)),
      ejecucionPresupuestaria: {
        pres_egresos: parseFloat(eje?.pres_egresos || 0),
        pres_ingresos: parseFloat(eje?.pres_ingresos || 0),
        real_egresos: parseFloat(eje?.real_egresos || 0),
        real_ingresos: parseFloat(eje?.real_ingresos || 0),
        balance_real: parseFloat(eje?.balance_real || 0),
        porcentaje: pct(parseFloat(eje?.real_egresos || 0), parseFloat(eje?.pres_egresos || 0)),
      },
      aceptacionPorFacultad: aceptacionPorFacultad.map(r => ({
        facultad: r.facultad,
        total: parseInt(r.total),
        aprobados: parseInt(r.aprobados),
        tasa: pct(parseInt(r.aprobados), parseInt(r.total)),
      })),
      topSolicitantes: topSolicitantes.map(r => ({
        nombre: r.nombre,
        total: parseInt(r.total),
        aprobados: parseInt(r.aprobados),
      })),
      asistenciaPorEvento: asistenciaPorEvento.map(r => ({
        idevento: r.idevento,
        inscritos: parseInt(r.inscritos || 0),
        asistentes: parseInt(r.asistentes || 0),
        tasa: pct1(parseInt(r.asistentes || 0), parseInt(r.inscritos || 0)),
      })),
      ejecucionPorEvento: ejecucionPorEvento.map(r => ({
        idevento: r.idevento,
        pres_egresos: parseFloat(r.pres_egresos || 0),
        pres_ingresos: parseFloat(r.pres_ingresos || 0),
        real_egresos: parseFloat(r.real_egresos || 0),
        real_ingresos: parseFloat(r.real_ingresos || 0),
        porcentaje: pct(parseFloat(r.real_egresos || 0), parseFloat(r.pres_egresos || 0)),
      })),
    });
  } catch (err) {
    console.error('? Error getReporteGestion:', err.message);
    res.status(500).json({ error: 'Error al generar reporte de gesti�n', message: err.message });
  }
};

module.exports = {
  getReporteInscripciones,
  getReporteOperacionales,
  getReporteEconomicos,
  getReporteRecursos,
  getReporteTipos,
  getReporteGestion,
  getReporteAcademicos,
  getReporteMensual,
};