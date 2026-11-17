import { Migrator } from '../src/lib/migrator.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'up';
  const migrator = new Migrator();

  try {
    switch (command) {
      case 'up': {
        console.log('Running pending database migrations...');
        const res = await migrator.up();
        if (res.applied.length > 0) {
          console.log(`Successfully applied ${res.applied.length} migration(s).`);
        }
        break;
      }
      case 'down': {
        const steps = parseInt(args[1] || '1', 10);
        console.log(`Rolling back ${steps} migration(s)...`);
        const res = await migrator.down(steps);
        console.log(`Successfully rolled back ${res.rolledBack.length} migration(s).`);
        break;
      }
      case 'status': {
        await migrator.status();
        break;
      }
      case 'create': {
        const name = args[1];
        if (!name) {
          console.error('Error: Please provide a migration name. Example: npx tsx scripts/migrate.ts create add_audit_logs');
          process.exit(1);
        }
        migrator.createMigration(name);
        break;
      }
      default:
        console.log('Usage: npx tsx scripts/migrate.ts [up|down|status|create <name>]');
        break;
    }
  } finally {
    await migrator.close();
  }
}

main().catch((err) => {
  console.error('[Migration Fatal Error]', err);
  process.exit(1);
});
