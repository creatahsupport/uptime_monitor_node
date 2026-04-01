const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function initDb() {
  // Connect without specifying database first
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  const schema = fs.readFileSync(
    path.join(__dirname, 'schema.sql'),
    'utf8'
  );

  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const stmt of statements) {
    await conn.execute(stmt);
  }

  console.log('✅ Database initialised');
  await conn.end();
}

initDb().catch(err => {
  console.error('❌ DB init failed:', err.message);
  process.exit(1);
});
