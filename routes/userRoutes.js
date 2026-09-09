const {Router} =require('express');
const { protect, authorize, authMiddleware } = require('../middleware/authMiddleware.js');
const express = require('express');
const {
  getAllUsers,
  getUserById,
  createUser,
  //updateUserRole,
  deleteUserByAdmin,
  linkTelegramAccount,
  unlinkTelegram,
  getCarrera,
  getComite,
  getComiteUser,
  getUserById1,
  getId,
  updateUser,
  updateUserDaf,
  getUserByEmail,
  getUsersDaf,
  getFacultades,
  getUserMe
  
} = require('../controllers/userController.js');
const router = express.Router();

// ── Rutas públicas (sin autenticación) ──
router.get('/carreras', getCarrera); 
router.get('/facultades', getFacultades);
// Vincular Telegram se hace desde el bot tras iniciar sesión (público por diseño)
router.post('/link-telegram', linkTelegramAccount);

// ── Rutas protegidas (requieren token) ──
router.use(protect);

router.get('/me', getUserMe);
router.put('/unlink-telegram', unlinkTelegram);

router.get('/comite', authorize(['admin', 'academico']), getComite);
router.get('/email/:email', authorize(['admin']), getUserByEmail);
router.get('/daf', authorize(['admin']), getUsersDaf);

router.get('/', authorize(['admin', 'academico']), getAllUsers);
router.post('/', authorize(['admin']), createUser);

router.get('/:id', authorize(['admin','daf']), getUserById);
router.put('/:id', protect, updateUserDaf);
router.delete('/:id', authorize(['admin']), deleteUserByAdmin);

module.exports = router;
