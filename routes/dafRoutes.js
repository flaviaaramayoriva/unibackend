// routes/daf.js (Node.js/Express)
const express = require('express');
const {
  reportes,
  getSolicitudes,
  aprobarSolicitud,
  rechazarSolicitud
} = require('../controllers/dafController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect, authorize(['admin', 'daf']));

router.get('/reportes', reportes);
router.get('/solicitudes', getSolicitudes);
router.put('/solicitudes/:idevento/aprobar', aprobarSolicitud);
router.put('/solicitudes/:idevento/rechazar', rechazarSolicitud);

module.exports = router;