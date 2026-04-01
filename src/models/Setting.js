const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Setting = sequelize.define('setting', {
  key: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  value: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  timestamps: true,
  underscored: true,
});

module.exports = Setting;
