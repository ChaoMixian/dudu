import { doctor } from './cli';
import { startServer } from './server';
import { assets } from './web/embedded.gen';

// Single-binary entry point: `dudu` runs the server, `dudu doctor` checks desktop dependencies.
const argv = process.argv.slice(2);
if (argv[0] === 'doctor') {
  console.log(JSON.stringify(doctor(), null, 2));
} else if (argv[0]) {
  console.error(`Unknown command: ${argv[0]}`);
  process.exitCode = 1;
} else {
  startServer({ assets });
}
