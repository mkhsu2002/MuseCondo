import type {Database} from './db.ts';
import {assistedAdmissionReady} from './assisted-admission-schema.ts';
export interface AdmissionStatus {status:'accepting'|'paused'|'unavailable';applyURL:string}
/** Read the deployed admission controls; missing schema/control never means accepting. */
export async function readAdmissionStatus(db:Database,origin:string):Promise<AdmissionStatus>{
 const applyURL=origin+'/reception';
 try{
  if(!await assistedAdmissionReady(db))return {status:'unavailable',applyURL};
  const control=await db.prepare('SELECT enabled FROM manager_admission_control WHERE id=1').first<{enabled:number}>();
  return {status:control?.enabled===1?'accepting':control?.enabled===0?'paused':'unavailable',applyURL};
 }catch{return {status:'unavailable',applyURL};}
}
export function admissionRejection(admission:AdmissionStatus){
 return {error:admission.status==='paused'?'admission_paused':'admission_unavailable',admission,applyURL:admission.applyURL,formalCaseCreated:false,nextAction:admission.status==='paused'?'New applications are paused. Keep any existing case ID and key to return to your case.':'Reception is temporarily unavailable. Keep your application and try again later.'};
}
