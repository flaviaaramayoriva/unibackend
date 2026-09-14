const { DataTypes } = require('sequelize');

module.exports = (sequelize,DataTypes)=>{
    const comunicacion=sequelize.define('Comunicacion',{
       idComunicacion: { 
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      field: 'id_comunicacion'
    },
    idusuario: { // Clave foránea que referencia a la tabla 'usuarios'
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true // Un usuario solo puede ser un tipo de administrador
    },
    nivelAcceso: {
      type: DataTypes.INTEGER,
      defaultValue: 7,
      field: 'nivel_acceso'
    },
    // Otros campos específicos de Administrador
  }, {
    tableName: 'comunicacion',
    timestamps: false // Opcional: si no quieres timestamps en esta tabla
  });

  return comunicacion;
};
