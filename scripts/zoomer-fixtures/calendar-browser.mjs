import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const timeoutMs=900000;
export default {
 name:'calendar-browser',
 covers:['server/models/Payment.ts', 'server/services/calendarPaymentService.ts', 'server/api/payments/index.ts', 'server/api/payments/[id].ts', 'server/api/payments/[id]/complete.post.ts', 'server/api/migrate-payment-dates.ts', 'server/api/dashboard/stats.ts', 'stores/calendar.ts', 'pages/calendar/index.vue', 'types/calendar.ts', 'components/calendar/PaymentModal.vue', 'components/calendar/CalendarGrid.vue', 'components/calendar/DayDetailModal.vue', 'components/calendar/UpcomingPayments.vue', 'scripts/calendar-payment.test.cjs', 'scripts/calendar-store.test.cjs', 'scripts/calendar-integration.cjs', 'scripts/helpers/calendar-store.cjs', 'scripts/helpers/calendar-service.cjs', 'scripts/verify-calendar-browser.cjs'],
 run(){
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('OMF_TEST_'))delete env[key];
  env.MONGO_URI=env.NUXT_MONGO_URI='mongodb://127.0.0.1:1/omf_fixture_no_ambient_database';
  env.JWT_SECRET='isolated-fixture-placeholder-not-a-production-secret';
  for(const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','CLAUDE_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','SLACK_BOT_TOKEN'])env[key]='isolated-fixture-no-credential';
  const logs=[];
  for(const [name,args] of [['fresh Nuxt build',['node_modules/nuxt/bin/nuxt.mjs','build']],['real Chrome calendar acceptance',['scripts/verify-calendar-browser.cjs']]]){
   const child=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
   logs.push(name+': exit='+child.status+'\n'+[child.stdout,child.stderr,child.error?.message].filter(Boolean).join('\n'));
   if(child.status!==0||child.error)return {pass:false,message:logs.join('\n\n')};
  }
  return {pass:true,message:logs.join('\n\n')};
 }
};
