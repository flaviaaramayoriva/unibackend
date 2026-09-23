const express = require('express');
const { getModels } = require('../models/index.js');
const { createRecurso,
    getRecursos,
    getRecursoImagen,
    updateRecurso,
    deleteRecurso } = require ('../controllers/recursoController.js');
const { protect } =require('../middleware/authMiddleware.js'); 

const router = express.Router();

router.post('/', protect, createRecurso); 
router.get('/', getRecursos);
router.get('/:id/imagen', getRecursoImagen);
router.put('/:id',updateRecurso);
router.delete('/:id',deleteRecurso);

module.exports = router;