// Creating a draft appends a validated sale to the current state. Unlike editing
// a record, it does not require the browser's global snapshot to be current.
export async function createSellerDraft(db:any,p:any,sale:any,initial:any,build:any){
 if(!['Vendedor','Colaborador'].includes(p.role)||!(p.modules||['Visão geral','Contratos','Comissões']).includes('Contratos'))throw Error('Sem permissão para lançar vendas.');
 let stored=initial;
 for(let attempt=0;attempt<3;attempt++){
  if(sale?.requestId&&stored.data.contracts.some((c:any)=>c.portalRequestId===sale.requestId&&c.seller===p.id))return {version:stored.version,duplicate:true,state:stored.data};
  const next=build(stored.data,p,sale);
  const result=await db.from('cm_state').update({data:next,version:stored.version+1,updated_at:new Date().toISOString()}).eq('id',1).eq('version',stored.version).select('version').maybeSingle();
  if(result.error)throw result.error;
  if(result.data){await db.from('cm_audit').insert({actor:p.id,action:'seller-sale'});return {version:result.data.version,state:next};}
  const fresh=await db.from('cm_state').select('*').eq('id',1).single();
  if(fresh.error)throw fresh.error;
  stored=fresh.data;
 }
 throw Error('Há alterações simultâneas. Seus campos foram mantidos; tente salvar o rascunho novamente.');
}
