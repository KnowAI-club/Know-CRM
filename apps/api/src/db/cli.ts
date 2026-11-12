import { migrate } from './migrate.js';
import { pool } from './pool.js';

const command = process.argv[2];
try {
  await migrate();
  if (command === 'seed') {
    const { seedDemo } = await import('./seed.js');
    await seedDemo();
  }
} finally {
  await pool.end();
}
