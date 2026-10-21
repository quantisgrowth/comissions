// Invite attempts are persisted and claimed with compare-and-swap, never in browser storage.
export async function acceptInvite(db:any,input:any){
  const reply=(error:string,remaining?:number,locked=false,status=400)=>({status,body:{error,...(remaining===undefined?{}:{attemptsRemaining:remaining}),locked}});
  if(!/^[a-f0-9]{64}$/.test(input.token||''))return reply('Convite inválido. Solicite um novo link ao administrador.',0,true);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.token)))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const {data:prior,error:readError}=await db.from('cm_invites').select('*').eq('token_hash',hash).maybeSingle();
  if(readError)throw readError;
  if(!prior||prior.status==='accepted'||prior.status==='revoked'||prior.expires_at<=new Date().toISOString()||prior.attempts>=3)return reply('Convite inválido, expirado, utilizado ou bloqueado. Solicite um novo link ao administrador.',0,true);
  if(prior.status!=='pending')return reply('Há uma ativação em andamento. Aguarde e tente novamente.',undefined,false,409);
  const attempt=prior.attempts+1;
  const {data:invite,error:claimError}=await db.from('cm_invites').update({status:'processing',attempts:attempt}).eq('token_hash',hash).eq('status','pending').eq('attempts',prior.attempts).gt('expires_at',new Date().toISOString()).select().maybeSingle();
  if(claimError)throw claimError;
  if(!invite)return reply('A ativação está sendo processada. Aguarde e tente novamente.',undefined,false,409);
  const finish=async(count:boolean)=>{const {error}=await db.from('cm_invites').update({status:count&&attempt>=3?'revoked':'pending',attempts:count?attempt:attempt-1}).eq('token_hash',hash).eq('status','processing').eq('attempts',attempt);if(error)throw error;};
  const invalid=async(message:string)=>{await finish(true);const remaining=3-attempt;return reply(remaining?message+' Você tem mais '+remaining+' tentativa(s).':'Limite de 3 tentativas atingido. Solicite um novo convite ao administrador.',remaining,!remaining);};
  if(typeof input.password!=='string'||input.password.length<12||input.password.length>128)return invalid('A senha deve ter entre 12 e 128 caracteres.');
  // Older published invitation forms did not send the confirmation field.
  if(input.confirmPassword!==undefined&&input.password!==input.confirmPassword)return invalid('As senhas não coincidem.');
  let person:any;
  try{const result=await db.from('cm_profiles').select('*').eq('id',invite.profile_id).single();if(result.error)throw result.error;person=result.data;}catch(e){await finish(false);throw e;}
  if(!person||!person.active||person.auth_id){await db.from('cm_invites').update({status:'revoked'}).eq('token_hash',hash);return reply('Convite indisponível. Solicite ajuda ao administrador.',0,true);}
  let created:any,createError:any;
  try{const result=await db.auth.admin.createUser({email:person.email,password:input.password,email_confirm:true});created=result.data;createError=result.error;}catch(e){await finish(false);throw e;}
  if(createError||!created?.user){if(createError?.status>=400&&createError?.status<500&&['weak_password','validation_failed'].includes(createError.code))return invalid('A senha não atende aos requisitos. Escolha uma senha mais forte.');await finish(false);return reply('Não foi possível criar o acesso. Tente novamente ou solicite ajuda ao administrador.',undefined,false,503);}
  const {data:linked,error:profileError}=await db.from('cm_profiles').update({auth_id:created.user.id}).eq('id',person.id).is('auth_id',null).select('id').maybeSingle();
  if(profileError||!linked){await db.auth.admin.deleteUser(created.user.id);await finish(false);return reply('Não foi possível concluir a ativação. Tente novamente.',undefined,false,503);}
  const {error:completeError}=await db.from('cm_invites').update({status:'accepted',used_at:new Date().toISOString()}).eq('token_hash',hash).eq('status','processing');
  if(completeError)throw completeError;
  return {status:200,body:{email:person.email}};
}
