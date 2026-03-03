// startup.ts — runs on every Railway deploy before the HTTP server starts
// Sequence: setup tables → seed demo data → start Express

import { setup } from './db/setup';
import { seed } from './db/seed';

async function main() {
    try {
        await setup();
        await seed();
    } catch (err) {
        console.error('Startup migration failed:', err);
        process.exit(1);   // Abort deploy if DB init fails
    }

    // Dynamically require server so it only starts after DB is ready
    await import('./server');
}

main();
