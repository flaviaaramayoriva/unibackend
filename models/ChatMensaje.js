const { DataTypes } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  const ChatMensaje = sequelize.define('ChatMensaje', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    idevento: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    idusuario: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    username: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'username',
      references: {
        model: 'usuario',
        key: 'username'
      }
    },
    role: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: 'role',
      references: {
        model: 'usuario',
        key: 'role'
      }
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    room_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'room_id'
    }
  }, {
    tableName: 'chatmensaje',  
    timestamps: true,
    underscored: true,
  });
  return ChatMensaje;
};