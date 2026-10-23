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
// Explicit-credential mode selects a clean native child environment, so no competing ambient credential, provider selector, model
// endpoint, custom header, proxy/TLS/runtime injection or arbitrary key can outrank or reroute the configured token: the operating
// system keys the allowlisted callers copy (read from process.env exactly as they read them), the callers' explicit switches (the
// nonessential-traffic switch and the research job paths), the profile directory only when the config names one, and the token.
// For the four allowlisted callers this is the environment they already build; the review worker's ambient inheritance is replaced
// only in this mode. Trusted managed CLI policy still applies (docs/native-cli-auth.md).
const OS_KEYS=['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','LOCALAPPDATA','APPDATA','PROGRAMDATA','ComSpec'];
const EXPLICIT_KEYS=['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC','OMF_RESEARCH_DATA_DIR','OMF_RESEARCH_JOB_FILE'];
function explicitChildEnv(env,config){
 const clean={};
 for(const key of OS_KEYS)if(process.env[key])clean[key]=process.env[key];
 for(const key of EXPLICIT_KEYS)if(typeof env[key]==='string')clean[key]=env[key];
 if(config.claudeConfigDirectory&&typeof env.CLAUDE_CONFIG_DIR==='string')clean.CLAUDE_CONFIG_DIR=env.CLAUDE_CONFIG_DIR;
 return clean;
}
// Absent credential: the caller's environment object is returned untouched (each caller's existing default, including the review
// worker's ambient inheritance). Configured: the same private object (never process.env) is reduced in place to the clean selection
// above plus the credential, and returned.
export function applyNativeCliAuth(env,config){
 const token=nativeCliToken(config);
 if(token===null)return env;
 if(!env||typeof env!=='object'||env===process.env)throw Error('Native CLI credential needs the child environment');
 const clean=explicitChildEnv(env,config);
 for(const key of Object.keys(env))delete env[key];
 Object.assign(env,clean);
 env[NATIVE_CLI_AUTH_KEY]=token;
 return env;
}
// The MCP server entry's own env: an explicit blank credential whenever one is configured (even an invalid one), so the tools child
// cannot inherit it from the native CLI; unchanged when none is configured.
export const nativeMcpEnv=(env,config)=>config?.[NATIVE_CLI_TOKEN_FIELD]===undefined?env:{...env,[NATIVE_CLI_AUTH_KEY]:''};
