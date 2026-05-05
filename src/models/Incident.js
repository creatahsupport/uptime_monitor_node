const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Incident = sequelize.define('Incident', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  url_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  started_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  resolved_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  duration_minutes: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  notified_client: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  notified_internal: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  tableName:  'incidents',
  timestamps: false,
  indexes: [
    { fields: ['url_id'] },
    { fields: ['started_at'] },
    { fields: ['resolved_at'] },
  ],
});

module.exports = Incident;
