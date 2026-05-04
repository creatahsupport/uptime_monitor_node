const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  'freedb_Lp7i0o4v',      // DB_NAME
  'u_eY6pOT',             // DB_USER
  'g2BVHzf7l6Uo',         // DB_PASSWORD
  {
    host: 'sql.freedb.tech',
    port: 3306,
    dialect: 'mysql',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      }
    },
    timezone: '+00:00',
    logging: false, // set to console.log to see queries
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  }
);

async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log('✅ MySQL connected via Sequelize');
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = { sequelize, testConnection };
