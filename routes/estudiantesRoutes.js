const express = require('express');
const router = express.Router();

const { 
  getEstudiantes,
  getAllEstudiantes,
  getEstudianteById,
  updateEstudiante,
  deleteEstudiante,
  getEventosPorFacultadEstudiante,
  estudiantesInscritosEnEvento,
  getEstudiantesInscritosEvento,
  actualizarDatosInscripcion,
  misInscripciones,
  registrarEventoEstudiante
} = require('../controllers/estudiantesController.js');

const { protect, protect1 } = require('../middleware/authMiddleware.js');

console.log('✅ [DEBUG] estudiantesRoutes.js se está cargando en el servidor...');

// 1. Rutas ESPECÍFICAS primero (sin parámetros dinámicos)
router.get('/facultad/:idfacultad', protect1, getEventosPorFacultadEstudiante);
router.get('/estudiantes-inscritos-facultad', protect, estudiantesInscritosEnEvento);
router.get('/estudiantes-inscritos-evento/:id', protect, getEstudiantesInscritosEvento);

// ✅ RUTA QUE ESTÁ FALLANDO (con log de depuración)
router.put('/mis-datos-inscripcion', protect, (req, res, next) => {
  console.log('🔥 [DEBUG] ¡La ruta PUT /mis-datos-inscripcion fue llamada!');
  next();
}, actualizarDatosInscripcion);

router.get('/mis-inscripciones', protect, misInscripciones);
router.get('/', protect, getAllEstudiantes);

// 2. Rutas DINÁMICAS al final (con :id)
router.get('/:idusuario', protect1, getEstudiantes);
router.get('/:id', protect, getEstudianteById);
router.put('/:id', protect, updateEstudiante);
router.delete('/:id', protect, deleteEstudiante);

// ✅ Descomentada para que el registro funcione
router.post('/:id/registrar', protect, registrarEventoEstudiante);

console.log('✅ [DEBUG] estudiantesRoutes.js cargado exitosamente');

module.exports = router;