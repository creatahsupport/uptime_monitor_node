const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MonitoredUrl = sequelize.define('MonitoredUrl', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: { notEmpty: { msg: 'Name is required' } },
  },
  url: {
    type: DataTypes.STRING(2048),
    allowNull: false,
    validate: {
      notEmpty: { msg: 'URL is required' },
      isUrl:    { msg: 'Must be a valid URL starting with http:// or https://' },
    },
  },
  client_email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      isEmail: { msg: 'client_email must be a valid email address' },
    },
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  current_status: {
    type: DataTypes.ENUM('up', 'down', 'unknown'),
    defaultValue: 'unknown',
  },
  last_checked_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  tableName:  'monitored_urls',
  timestamps: true,
  createdAt:  'created_at',
  updatedAt:  'updated_at',
});

module.exports = MonitoredUrl;
