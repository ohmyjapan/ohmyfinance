// cloud-probe/idle.mjs — the container's entry point (plan omf-railway-amex-probe-20261007 S5). It only keeps the
// container alive for the driver's foreground SSH session (which selects the omf user), and exits after
// 90 minutes: the service's own lifetime (restartPolicyType NEVER), not a watcher of anything.
const LIFETIME_MS = 90 * 60 * 1000;
console.log(`omf-amex-probe idle: run the probe through the Ryzen 7 driver; this container exits after ${LIFETIME_MS / 60000} minutes`);
const timer = setTimeout(() => { console.log('omf-amex-probe idle: lifetime reached'); process.exit(0); }, LIFETIME_MS);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { clearTimeout(timer); process.exit(0); });
