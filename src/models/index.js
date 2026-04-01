const { sequelize } = require('../config/database');
const MonitoredUrl      = require('./MonitoredUrl');
const MonitorCheck      = require('./MonitorCheck');
const Incident          = require('./Incident');
const Setting           = require('./Setting');
const InternalRecipient = require('./InternalRecipient');
const User              = require('./User');

// ── Associations ──────────────────────────────────────────────────────────────
MonitoredUrl.hasMany(MonitorCheck,  { foreignKey: 'url_id', as: 'checks',    onDelete: 'CASCADE' });
MonitorCheck.belongsTo(MonitoredUrl, { foreignKey: 'url_id', as: 'monitoredUrl' });

MonitoredUrl.hasMany(Incident, { foreignKey: 'url_id', as: 'incidents', onDelete: 'CASCADE' });
Incident.belongsTo(MonitoredUrl,     { foreignKey: 'url_id', as: 'monitoredUrl' });

// ── Sync (create tables if they don't exist) ──────────────────────────────────
async function syncDb() {
  // alter: true updates columns if model changed, without dropping data
  await sequelize.sync({ alter: true });
  console.log('✅ All tables synced');

  // Seed default admin user if none exists
  const bcrypt = require('bcryptjs');
  const userCount = await User.count();
  if (userCount === 0) {
    const defaultPassword = 'admin'; // Or admin123
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);
    await User.create({
      username: 'admin',
      password: hashedPassword
    });
    console.log(`✅ Default admin user 'admin' created.`);
  }
}

module.exports = {
  sequelize,
  syncDb,
  Setting,
  MonitoredUrl,
  MonitorCheck,
  Incident,
  InternalRecipient,
  User,
};
