const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MonitorCheck = sequelize.define('MonitorCheck', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  url_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('up', 'down'),
    allowNull: false,
  },
  load_time_ms: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  performance_label: {
    type: DataTypes.ENUM('good', 'average', 'bad'),
    allowNull: true,
  },
  http_status_code: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  checked_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName:  'monitor_checks',
  timestamps: false,
  indexes: [
    { fields: ['url_id'] },
    { fields: ['checked_at'] },
  ],
});

module.exports = MonitorCheck;
