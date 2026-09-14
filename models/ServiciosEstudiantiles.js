module.exports = (sequelize,DataTypes)=>{
    const Servicios=sequelize.define('ServiciosEstudiantiles',{
      idServiciosEstudiantiles: { 
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      field: 'id_servicios_estudiantiles'
    },
    idusuario: { // Clave foránea que referencia a la tabla 'usuarios'
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true // Un usuario solo puede ser un tipo de administrador
    },
    nivelAcceso: {
      type: DataTypes.INTEGER,
      defaultValue: 10,
      field: 'nivel_acceso'
    },
    // Otros campos específicos de Administrador
  }, {
    tableName: '_serviciosestudiantiles',
    timestamps: false // Opcional: si no quieres timestamps en esta tabla
  });

  return Servicios;
};

