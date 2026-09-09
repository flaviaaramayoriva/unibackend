const  jwt = require('jsonwebtoken');
const  {getModels} = require('../models/index.js');
const  asyncHandler =require('express-async-handler');
const { raw } = require('express');
require('dotenv').config();


const authMiddleware = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token de acceso requerido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

const protect = async (req, res, next) => {
  let token;

  try {
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'Token de autorización requerido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const models = getModels();
    const User = models.User;

    // 🔐 Seguridad: excluir el hash de la contraseña de la respuesta / datos del usuario
    const user = await User.findByPk(decoded.idusuario, {
      raw: true,
      attributes: { exclude: ['contrasenia'] }
    });
    
    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    // 🔥 CORRECCIÓN: Usar la misma validación que en loginUser
    const estaHabilitado = user.habilitado === 'true' || 
                           user.habilitado === '1' || 
                           user.habilitado === true ||
                           user.habilitado === 1;

    if (!estaHabilitado) {
      return res.status(401).json({ error: 'Usuario deshabilitado' });
    }

    req.user = user; 
    next();
    
  } catch (error) {
    console.error('Error en protect:', error.message);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token inválido' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado' });
    }
    return res.status(401).json({ error: 'Error de autenticación' });
  }
};
const protect1 = asyncHandler(async (req, res, next) => {
  let token;

  try {
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'Token de autorización requerido', code: 'NO_TOKEN' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const models = getModels();
    const User = models.User;

    // 🔐 Seguridad: excluir el hash de la contraseña de la respuesta / datos del usuario
    const user = await User.findByPk(decoded.idusuario, {
      raw: true,
      attributes: { exclude: ['contrasenia'] }
    });

    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado', code: 'USER_NOT_FOUND' });
    }

    // 🔥 CORRECCIÓN: Usar la misma validación que en loginUser
    const estaHabilitado = user.habilitado === 'true' || 
                           user.habilitado === '1' || 
                           user.habilitado === true ||
                           user.habilitado === 1;

    if (!estaHabilitado) {
      return res.status(401).json({ error: 'Usuario deshabilitado', code: 'USER_DISABLED' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token inválido', code: 'INVALID_TOKEN' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Error de autenticación', code: 'AUTH_ERROR' });
  }
});
const authorize = (roles = []) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({ message: 'Acceso denegado. Rol no definido.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: `Acceso denegado. Rol '${req.user.role}' no autorizado.` });
    }
    next();
  };
};
module.exports = {
  authMiddleware,
  protect,
  protect1,
  authorize
};