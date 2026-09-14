const { DataTypes } = require('sequelize');

module.exports = (sequelize,DataTypes)=>{
    const Daf=sequelize.define('Daf',{
       idDaf: { 
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      field: 'id_daf'
    },
    idusuario: { 
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true 
    },
    nivelAcceso: {
      type: DataTypes.INTEGER,
      defaultValue: 6,
      field: 'nivel_acceso'
    },
  }, {
    tableName: 'daf',
    timestamps: false 
  });
  Daf.associate = (models) => {
    Daf.belongsTo(models.User,{foreignKey:'idusuario'});


  }

  return Daf;
};

