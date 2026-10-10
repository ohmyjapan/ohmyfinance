import { startCollector } from './index.mjs';

// PM2 imports its target through a process container, so process.argv[1] is not this file.
// `node run.mjs --open-setup` is the explicit launch (shortcut) that opens the local setup page once the collector is
// ready; when this directory's collector already listens, it opens that running instance's page instead of starting a
// second one. Background starts (PM2, auto-start) carry no flag and never open a window.
startCollector({ openSetup: process.argv.includes('--open-setup') }).catch(() => {
  console.error('OMF collector could not start. Check the setup port and Windows credential vault.');
  process.exitCode = 1;
});
