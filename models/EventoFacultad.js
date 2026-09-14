const { DataTypes } = require('sequelize');

module.exports = (sequelize,DataTypes) => {
    const EventoFacultad = sequelize.define('EventoFacultad',{
        idevento: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            references: { model: 'evento', key: 'idevento' }
        },
        idfacultad: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            field: 'facultad_id',
            references: { model: 'facultad', key: 'facultad_id' }
        }
    }, {
    tableName: 'evento_facultad',
    timestamps: false
    });
    return EventoFacultad;
};
