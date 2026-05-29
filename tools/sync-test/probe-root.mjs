import mysql from 'mysql2/promise';
const TEST_DB = process.env.SYNC_TEST_DB || 'projectsflow_synctest';
const appUser = process.env.DB_USER;
const candidates = [
  { user: 'root', password: '' },
  { user: 'root', password: 'root' },
  { user: 'root', password: process.env.DB_PASSWORD },
];
let ok = false;
for (const cred of candidates) {
  try {
    const c = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 3306),
      user: cred.user,
      password: cred.password,
      multipleStatements: true,
    });
    console.log(`ROOT OK with password=${cred.password ? '(set)' : '(empty)'}`);
    await c.query(`CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await c.query(`GRANT ALL PRIVILEGES ON \`${TEST_DB}\`.* TO '${appUser}'@'localhost'`);
    await c.query(`GRANT ALL PRIVILEGES ON \`${TEST_DB}\`.* TO '${appUser}'@'127.0.0.1'`);
    await c.query(`GRANT ALL PRIVILEGES ON \`${TEST_DB}\`.* TO '${appUser}'@'%'`);
    await c.query('FLUSH PRIVILEGES');
    console.log(`granted ALL on ${TEST_DB}.* to ${appUser}`);
    await c.end();
    ok = true;
    break;
  } catch (e) {
    console.log(`  try ${cred.user}/${cred.password ? 'set' : 'empty'}: ${e.code || e.message}`);
  }
}
process.exitCode = ok ? 0 : 2;
