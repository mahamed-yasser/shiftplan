'use strict';
// Starts a project: node server.js  (PORT, DB_FILE, HOST optional)
module.exports = async function run(build) {
  const port = Number(process.env.PORT || 3000);
  const app = build({ dbFile: process.env.DB_FILE || 'data.db' });
  await app.listen(port, process.env.HOST || '127.0.0.1');
  console.log('Running on http://127.0.0.1:' + port + '  (first visit creates the owner account; bound to loopback unless HOST is set)');
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { await app.close(); process.exit(0); });
};
