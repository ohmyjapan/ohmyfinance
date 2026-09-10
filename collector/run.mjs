import { startCollector } from './index.mjs';

// PM2 imports its target through a process container, so process.argv[1] is not this file.
startCollector().catch(() => {
  console.error('OMF collector could not start. Check the setup port and Windows credential vault.');
  process.exitCode = 1;
});
