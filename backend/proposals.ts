import './proposal-model.js';
const Model=(globalThis as any).ProposalModel;
const DEFAULT_TENANT='00000000-0000-0000-0000-000000000001';
export function proposalAccess(p:any,companies:any[],company:string){const tenant=p.tenant_id||DEFAULT_TENANT;const manager=['Administrador','Gestor'].includes(p.role);if(!p.active||!(p.role==='Administrador'||(p.modules||(manager?['Propostas']:[])).includes('Propostas')))throw Error('Solicite ao administrador acesso ao módulo Propostas.');if(!companies.some(c=>c.id===company&&(c.tenant_id||DEFAULT_TENANT)===tenant)||!p.all_companies&&!(p.companies||[]).includes(company))throw Error('Empresa não autorizada.');return {tenant,manager};}
export async function handleProposals(db:any,p:any,input:any,companies:any[]){
 const {tenant,manager}=proposalAccess(p,companies,input.company),scope=(table:string)=>db.from(table).select('*').eq('tenant_id',tenant).eq('company',input.company);
 if(input.action==='list'){let q=scope('cm_proposals').order('updated_at',{ascending:false}).limit(200);if(!manager)q=q.eq('created_by',p.id);const [catalog,proposals]=await Promise.all([scope('cm_proposal_catalog').order('updated_at'),q]);if(catalog.error||proposals.error)throw catalog.error||proposals.error;return {catalog:catalog.data,proposals:proposals.data};}
 const catalogAction=input.action==='catalog-save';if(catalogAction&&!manager)throw Error('Somente gestores podem editar a tabela comercial.');
 if(!catalogAction&&!['save','duplicate'].includes(input.action))throw Error('Ação inválida.');
 const table=catalogAction?'cm_proposal_catalog':'cm_proposals';let previous:any=null;
 if(input.id){const r=await scope(table).eq('id',input.id).maybeSingle();if(r.error)throw r.error;previous=r.data;if(!previous||!manager&&previous.created_by!==p.id)throw Error('Registro não encontrado ou sem permissão.');}
 const kind=catalogAction?input.kind:null;if(catalogAction&&!['plan','module','brand'].includes(kind))throw Error('Tipo inválido.');if(previous&&catalogAction&&kind!==previous.kind)throw Error('O tipo do registro deve ser preservado.');
 const data=catalogAction?(kind==='brand'?Model.brand(input.data):Model.item({...input.data,kind})):Model.proposal(input.action==='duplicate'?{...previous?.data,status:'draft'}:input.data);
 if(!catalogAction&&data.brand.name.length<2)throw Error('Configure a identidade da empresa.');
 if(input.action==='duplicate'&&!previous)throw Error('Proposta não encontrada.');
 if(previous&&input.action!=='duplicate'){
  if(input.version!==previous.version)throw Error('Outra pessoa alterou este registro. Atualize antes de salvar.');
  const r=await db.from(table).update({data,version:previous.version+1,updated_at:new Date().toISOString()}).eq('id',previous.id).eq('tenant_id',tenant).eq('company',input.company).eq('version',previous.version).select().maybeSingle();if(r.error)throw r.error;if(!r.data)throw Error('Conflito de edição. Atualize antes de salvar.');return {record:r.data};
 }
 const r=await db.from(table).insert({tenant_id:tenant,company:input.company,created_by:p.id,data,...(catalogAction?{kind}:{})}).select().single();if(r.error)throw r.error;return {record:r.data};
}
