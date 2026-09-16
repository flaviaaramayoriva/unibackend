const express =require('express');
const router = express.Router();
const { estadisticas } = require('../controllers/reportesController.js');
const {
  getReporteInscripciones,
  getReporteOperacionales,
  getReporteEconomicos,
  getReporteRecursos,
  getReporteTipos,
  getReporteGestion,
  getReporteAcademicos,
  getReporteMensual,
} = require('../controllers/reportesAvanzadosController.js');
const { protect } = require('../middleware/authMiddleware.js');

router.get('/reporte/estadisticas', protect, estadisticas);
router.get('/', protect, getReporteRecursos);
router.get('/academicos', protect, getReporteAcademicos);
router.get('/mensual', protect, getReporteMensual);
router.get('/inscripciones', protect, getReporteInscripciones);
router.get('/operacionales', protect, getReporteOperacionales);
router.get('/economicos', protect, getReporteEconomicos);
router.get('/gestion', protect, getReporteGestion);
router.get('/recursos', protect, getReporteRecursos);
router.get('/tipos', protect, getReporteTipos);

module.exports = router;