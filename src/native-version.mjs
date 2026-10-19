// Native service compatibility is independent of JavaScript/guidance patch releases.
export const NATIVE_API_VERSION = '1.3.0';
// UI/packaging builds can change without forcing a running compatible engine to restart.
export const NATIVE_BUILD_VERSION = '1.4.1';

const ownAXMethods=new Set(['get_app_state','click','set_value','perform_secondary_action','select_text','manage_window','type_text','press_key','paste']);
export function ownAXUpgradeRequired(method,params,build) {
  if(!ownAXMethods.has(method)||!['opensky','dev.opensky.computeruse'].includes(String(params.app??'').trim().toLowerCase()))return false;
  if(!/^\d+\.\d+\.\d+$/.test(build??''))return true;
  const actual=build.split('.').map(Number),required=[1,3,7];
  for(let i=0;i<3;i++){if(actual[i]!==required[i])return actual[i]<required[i];}
  return false;
}
