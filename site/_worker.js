import { handleFollowup } from './follow-up/service.mjs';
export default { fetch(request, env) { return handleFollowup(request, env); } };
