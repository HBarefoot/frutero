const db = require('../database');

db.init();
console.log('[seed] database initialized and seeded at', require('../config').DB_PATH);
process.exit(0);
