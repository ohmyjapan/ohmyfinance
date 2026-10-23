// Optional native CLI credential delivery (docs/native-cli-auth.md). A worker's trusted local Vault may hold nativeOAuthToken, a
// long-lived native CLI setup-token that is distinct from the worker's OMF server bearer (token). Only the native CLI child gets it,
// as CLAUDE_CODE_OAUTH_TOKEN in that child's own environment object: process.env is never changed and the MCP tools children get an
// explicit blank value. Absent means each caller's existing environment and default native login, unchanged. A present value that
// is not one line of visible ASCII is refused before any child starts: never another account, never a silent fallback. Jobs, inputs
// and arguments never carry it; callers pass only their trusted local config here.
export const NATIVE_CLI_AUTH_KEY='CLAUDE_CODE_OAUTH_TOKEN';
export const NATIVE_CLI_TOKEN_FIELD='nativeOAuthToken';
const shape=/^[\x21-\x7e]{20,4096}$/;
export const validNativeCliToken=value=>typeof value==='string'&&shape.test(value);
export function nativeCliToken(config){
 if(config?.[NATIVE_CLI_TOKEN_FIELD]===undefined)return null;
 if(!validNativeCliToken(config[NATIVE_CLI_TOKEN_FIELD]))throw Error('Native CLI credential configuration is invalid');
 return config[NATIVE_CLI_TOKEN_FIELD];
}
// Sets the configured credential on the caller's private child environment (never process.env); returns that same object.
export function applyNativeCliAuth(env,config){
 const token=nativeCliToken(config);
 if(token===null)return env;
 if(!env||typeof env!=='object'||env===process.env)throw Error('Native CLI credential needs the child environment');
 env[NATIVE_CLI_AUTH_KEY]=token;
 return env;
}
// The MCP server entry's own env: an explicit blank credential whenever one is configured (even an invalid one), so the tools child
// cannot inherit it from the native CLI; unchanged when none is configured.
export const nativeMcpEnv=(env,config)=>config?.[NATIVE_CLI_TOKEN_FIELD]===undefined?env:{...env,[NATIVE_CLI_AUTH_KEY]:''};
