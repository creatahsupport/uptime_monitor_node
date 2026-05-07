const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const InternalRecipient = sequelize.define('InternalRecipient', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: { msg: 'This email is already registered' },
    validate: {
      isEmail: { msg: 'Must be a valid email address' },
      noEncoded(value) {
        if (/%[0-9A-Fa-f]{2}/.test(value)) throw new Error('Must be a valid email address');
        if (/[<>()"';]/.test(value)) throw new Error('Must be a valid email address');
      },
    },
  },
}, {
  tableName:  'internal_recipients',
  timestamps: true,
  createdAt:  'created_at',
  updatedAt:  false,
});

module.exports = InternalRecipient;
