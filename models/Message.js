module.exports = (sequelize, DataTypes) => {
  const Message = sequelize.define('Message', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      field: 'idmensaje'
    },
    sender: {
      type: DataTypes.STRING,
      allowNull: false
    },
    text: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    role: {
      type: DataTypes.STRING,
      defaultValue: 'user'
    },
    idevento: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'mensajes',
    timestamps: false,
    underscored: false,
    freezeTableName: true
  });
  Message.associate = function(models) {
    Message.belongsTo(models.Evento, {
      foreignKey: 'idevento',
      as: 'eventos'
    });
  };
  return Message;
};