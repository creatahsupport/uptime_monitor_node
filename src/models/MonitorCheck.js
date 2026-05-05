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
  html_load_ms: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  css_load_ms: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  js_load_ms: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  image_load_ms: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  full_load_ms: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  lcp_ms: {
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
  error_type: {
    type: DataTypes.ENUM(
      'dns_error',
      'connection_refused',
      'connection_reset',
      'timeout',
      'ssl_expired',
      'ssl_invalid',
      'server_error',
      'client_error',
      'http_error',
      'network_error',
      'http_blocked',
      'server_down',
      'tcp_error',
      'content_loading_error',
      'browser_metrics_unavailable',
      'browser_error'
    ),
    allowNull: true,
  },
  check_type: {
    type: DataTypes.ENUM('uptime', 'load_time'),
    allowNull: false,
    defaultValue: 'uptime',
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
