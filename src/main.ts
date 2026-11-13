import { doctor } from './cli';
import { main as botdMain } from './botd/main';
import { startServer } from './server';
import { assets } from './web/embedded.gen';

// Single-binary entry point. `dudu` runs the server; `dudu botd` keeps the
// standalone loopback desktop daemon available for debugging and scripting.
const argv = process.argv.slice(2);
if (argv[0] === 'botd') {
  process.exitCode = await botdMain(argv.slice(1));
} else if (argv[0] === 'doctor') {
  console.log(JSON.stringify(doctor(), null, 2));
} else {
  startServer({ assets });
}
