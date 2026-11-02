// Demonstrations & CRM Webhook Controller
// Manages commercial demos, reschedule logs, and sales commissions from CRM DataCrazy.

export async function handleDemonstrations(db: any, p: any, input: any) {
  const tenantId = p.tenant_id || '00000000-0000-0000-0000-000000000001';
  const isManager = ['Administrador', 'Gestor'].includes(p.role);

  // 1. Listagem de demonstrações para o usuário autenticado
  if (input.action === 'demos-list') {
    let query = db.from('cm_demonstrations').select('*').eq('tenant_id', tenantId);

    if (input.companyId && input.companyId !== 'all') {
      query = query.eq('company_id', input.companyId);
    } else if (!p.all_companies) {
      query = query.in('company_id', p.companies);
    }

    // Vendedores consultam demos onde são Closer ou SDR, a menos que sejam gestores
    if (!isManager && ['Vendedor', 'Colaborador'].includes(p.role)) {
      query = query.or(`sdr_id.eq.${p.id},closer_id.eq.${p.id}`);
    }

    const { data: demos, error: demoErr } = await query.order('current_scheduled_date', { ascending: false });
    if (demoErr) throw demoErr;

    const demoIds = (demos || []).map((d: any) => d.id);
    const leadIds = [...new Set((demos || []).map((d: any) => d.lead_id).filter(Boolean))];

    const [leadsRes, reschedulesRes, commissionsRes] = await Promise.all([
      leadIds.length ? db.from('cm_leads').select('*').in('id', leadIds) : Promise.resolve({ data: [] }),
      demoIds.length ? db.from('cm_reschedule_logs').select('*').in('demonstration_id', demoIds).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
      demoIds.length ? db.from('cm_sales_commissions').select('*').in('demonstration_id', demoIds) : Promise.resolve({ data: [] })
    ]);

    return {
      demos: demos || [],
      leads: leadsRes.data || [],
      reschedules: reschedulesRes.data || [],
      commissions: commissionsRes.data || []
    };
  }

  // 2. Criação ou edição manual de demonstração
  if (input.action === 'demo-save') {
    const d = input.demo || {};
    const companyId = String(d.company_id || '').trim();
    if (!companyId) throw Error('Selecione a empresa vinculada à demonstração.');
    if (!p.all_companies && !p.companies.includes(companyId)) throw Error('Você não tem acesso a esta empresa.');

    // Localiza ou cria o lead
    let leadId = d.lead_id;
    if (!leadId) {
      const companyName = String(d.company_name || '').trim();
      if (!companyName) throw Error('Informe o nome da empresa/lead.');
      const { data: newLead, error: leadErr } = await db.from('cm_leads').insert({
        tenant_id: tenantId,
        company_id: companyId,
        company_name: companyName,
        contact_name: d.contact_name ? String(d.contact_name).trim() : null,
        phone: d.phone ? String(d.phone).trim() : null,
        email: d.email ? String(d.email).trim().toLowerCase() : null,
        segment: d.segment ? String(d.segment).trim() : null
      }).select().single();
      if (leadErr) throw leadErr;
      leadId = newLead.id;
    }

    const scheduledDate = d.current_scheduled_date || d.first_scheduled_date || new Date().toISOString();
    const fields = {
      tenant_id: tenantId,
      company_id: companyId,
      lead_id: leadId,
      sdr_id: d.sdr_id || null,
      closer_id: d.closer_id || p.id,
      product_id: d.product_id || null,
      status: d.status || 'agendado',
      is_completed: d.is_completed === true,
      current_scheduled_date: scheduledDate,
      deal_value_mrr: Number(d.deal_value_mrr || 0),
      deal_value_setup: Number(d.deal_value_setup || 0),
      notes: d.notes || null,
      updated_at: new Date().toISOString()
    };

    let result: any;
    if (d.id) {
      const { data, error } = await db.from('cm_demonstrations').update(fields).eq('id', d.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await db.from('cm_demonstrations').insert({
        ...fields,
        first_scheduled_date: scheduledDate,
        reschedule_count: 0
      }).select().single();
      if (error) throw error;
      result = data;
    }

    await db.from('cm_audit').insert({ actor: p.id, action: 'demo-save' });
    return { saved: true, demo: result };
  }

  // 3. Reagendamento operacional com registro de histórico
  if (input.action === 'demo-reschedule') {
    const { demoId, newDate, reason } = input;
    if (!demoId || !newDate) throw Error('Dados do reagendamento incompletos.');

    const { data: demo, error: fetchErr } = await db.from('cm_demonstrations').select('*').eq('id', demoId).eq('tenant_id', tenantId).single();
    if (fetchErr || !demo) throw Error('Demonstração não encontrada.');

    // Grava log do reagendamento
    await db.from('cm_reschedule_logs').insert({
      demonstration_id: demoId,
      previous_date: demo.current_scheduled_date,
      new_date: newDate,
      reason: reason ? String(reason).trim() : null,
      actor_id: p.id
    });

    // Atualiza a demonstração
    const { data: updated, error: updErr } = await db.from('cm_demonstrations').update({
      current_scheduled_date: newDate,
      reschedule_count: (demo.reschedule_count || 0) + 1,
      status: 'agendado',
      is_completed: false,
      updated_at: new Date().toISOString()
    }).eq('id', demoId).select().single();

    if (updErr) throw updErr;
    await db.from('cm_audit').insert({ actor: p.id, action: 'demo-reschedule' });
    return { rescheduled: true, demo: updated };
  }

  // 4. Atualização de Status / Comparecimento (Show Rate)
  if (input.action === 'demo-status-update') {
    const { demoId, status, isCompleted, lossReason } = input;
    if (!demoId || !status) throw Error('Dados de status incompletos.');

    const { data: demo, error: fetchErr } = await db.from('cm_demonstrations').select('*').eq('id', demoId).eq('tenant_id', tenantId).single();
    if (fetchErr || !demo) throw Error('Demonstração não encontrada.');

    const updates: any = {
      status,
      updated_at: new Date().toISOString()
    };

    if (isCompleted !== undefined) {
      updates.is_completed = !!isCompleted;
      if (updates.is_completed && !demo.completed_date) {
        const completedAt = new Date().toISOString();
        updates.completed_date = completedAt;
        const start = new Date(demo.first_scheduled_date).getTime();
        const finish = new Date(completedAt).getTime();
        updates.cycle_days = Math.max(0, Math.round((finish - start) / (1000 * 60 * 60 * 24)));
      }
    }

    if (status === 'perdido' && lossReason) {
      updates.loss_reason = String(lossReason).trim();
    }

    const { data: updated, error: updErr } = await db.from('cm_demonstrations').update(updates).eq('id', demoId).select().single();
    if (updErr) throw updErr;

    await db.from('cm_audit').insert({ actor: p.id, action: 'demo-status-update' });
    return { updated: true, demo: updated };
  }

  // 5. Fechamento de Venda com Registro de Comissões
  if (input.action === 'demo-close-sale') {
    const { demoId, mrr, setup, sdrCommission, closerCommission, contractId } = input;
    if (!demoId) throw Error('Identificador da demonstração inválido.');

    const { data: demo, error: fetchErr } = await db.from('cm_demonstrations').select('*').eq('id', demoId).eq('tenant_id', tenantId).single();
    if (fetchErr || !demo) throw Error('Demonstração não encontrada.');

    // Atualiza a demonstração como fechada e realizada
    const completedAt = demo.completed_date || new Date().toISOString();
    const start = new Date(demo.first_scheduled_date).getTime();
    const finish = new Date(completedAt).getTime();
    const cycleDays = Math.max(0, Math.round((finish - start) / (1000 * 60 * 60 * 24)));

    await db.from('cm_demonstrations').update({
      status: 'fechado',
      is_completed: true,
      completed_date: completedAt,
      cycle_days: cycleDays,
      deal_value_mrr: Number(mrr || 0),
      deal_value_setup: Number(setup || 0),
      updated_at: new Date().toISOString()
    }).eq('id', demoId);

    // Registra ou atualiza a comissão da venda
    const commissionPayload = {
      demonstration_id: demoId,
      contract_id: contractId || null,
      deal_value_mrr: Number(mrr || 0),
      deal_value_setup: Number(setup || 0),
      closed_date: new Date().toISOString(),
      sdr_commission_amount: Number(sdrCommission || 0),
      closer_commission_amount: Number(closerCommission || 0),
      status_payment: 'pendente'
    };

    const { data: commission, error: commErr } = await db.from('cm_sales_commissions').upsert(commissionPayload, {
      onConflict: 'demonstration_id'
    }).select().single();
    if (commErr) throw commErr;

    await db.from('cm_audit').insert({ actor: p.id, action: 'demo-close-sale' });
    return { closed: true, commission };
  }

  // 6. Alteração do status de pagamento da comissão (pendente -> aprovado -> pago -> cancelado)
  if (input.action === 'demo-commission-status') {
    if (!isManager) throw Error('Apenas gestores ou administradores podem alterar o status do pagamento.');
    const { commissionId, statusPayment } = input;
    if (!commissionId || !['pendente', 'aprovado', 'pago', 'cancelado'].includes(statusPayment)) {
      throw Error('Status de pagamento inválido.');
    }
    const { data: updated, error: updErr } = await db.from('cm_sales_commissions').update({
      status_payment: statusPayment
    }).eq('id', commissionId).select().single();
    if (updErr) throw updErr;

    await db.from('cm_audit').insert({ actor: p.id, action: 'demo-commission-status' });
    return { updated: true, commission: updated };
  }

  // 7. Listagem de logs de webhook para a página de Automações
  if (input.action === 'webhook-logs-list') {
    if (!isManager) throw Error('Apenas administradores e gestores podem visualizar os logs de automação.');
    const { data: logs, error: logsErr } = await db.from('cm_webhook_logs').select('*').order('created_at', { ascending: false }).limit(input.limit || 50);
    if (logsErr) throw logsErr;
    return { logs: logs || [] };
  }

  throw Error('Ação de demonstrações inválida.');
}

// 8. Processador do Webhook CRM DataCrazy
export async function handleCrmWebhook(db: any, payload: any, secretHeader: string | null) {
  const EXPECTED_SECRET = Deno.env.get('CRM_WEBHOOK_SECRET') || 'quantis_crm_secret_2026';

  const event = String(payload?.event || payload?.action || '').trim();
  const data = payload?.data || payload || {};
  const companyId = String(payload?.company_id || data?.company_id || 'quantis').trim();
  const tenantId = String(payload?.tenant_id || data?.tenant_id || '00000000-0000-0000-0000-000000000001').trim();
  const crmDealId = String(data?.deal_id || data?.id || data?.crm_deal_id || '').trim();

  const recordLog = async (res: any) => {
    try {
      await db.from('cm_webhook_logs').insert({
        tenant_id: tenantId,
        company_id: companyId,
        event: event || 'unknown',
        deal_id: crmDealId || null,
        status_code: res.status || (res.ok ? 200 : 400),
        status_text: res.ok ? 'success' : 'error',
        payload: payload,
        response: res,
        error_message: res.error || null,
        created_at: new Date().toISOString()
      });
    } catch (e) {
      console.error('Erro ao gravar cm_webhook_logs:', e);
    }
    return res;
  };

  if (secretHeader && secretHeader !== EXPECTED_SECRET) {
    return await recordLog({ ok: false, error: 'Chave de webhook inválida.', status: 401 });
  }

  if (!crmDealId && !data.phone && !data.email) {
    return await recordLog({ ok: false, error: 'Identificador do lead/deal ausente no payload.', status: 400 });
  }

  // 1. Localiza ou cria o lead
  let lead: any = null;
  if (data.email) {
    const { data: found } = await db.from('cm_leads').select('*').eq('email', data.email.toLowerCase()).maybeSingle();
    lead = found;
  }
  if (!lead && data.phone) {
    const { data: found } = await db.from('cm_leads').select('*').eq('phone', data.phone).maybeSingle();
    lead = found;
  }

  if (!lead) {
    const { data: newLead, error: leadErr } = await db.from('cm_leads').insert({
      tenant_id: tenantId,
      company_id: companyId,
      company_name: data.company_name || data.title || 'Lead CRM ' + (data.contact_name || ''),
      contact_name: data.contact_name || data.name || null,
      phone: data.phone || null,
      email: data.email ? String(data.email).toLowerCase() : null,
      segment: data.segment || null
    }).select().single();
    if (leadErr) return await recordLog({ ok: false, error: leadErr.message, status: 500 });
    lead = newLead;
  }

  // 2. Busca SDR e Closer em cm_profiles por email caso venham no payload
  let sdrId: string | null = null;
  let closerId: string | null = null;

  if (data.sdr_email) {
    const { data: sdrProfile } = await db.from('cm_profiles').select('id').eq('email', data.sdr_email.toLowerCase()).maybeSingle();
    if (sdrProfile) sdrId = sdrProfile.id;
  }
  if (data.closer_email) {
    const { data: closerProfile } = await db.from('cm_profiles').select('id').eq('email', data.closer_email.toLowerCase()).maybeSingle();
    if (closerProfile) closerId = closerProfile.id;
  }

  // 3. Localiza demonstração existente pelo crm_deal_id (idempotência)
  let existingDemo: any = null;
  if (crmDealId) {
    const { data: found } = await db.from('cm_demonstrations').select('*').eq('crm_deal_id', crmDealId).maybeSingle();
    existingDemo = found;
  }

  const scheduledDate = data.scheduled_at || data.current_scheduled_date || new Date().toISOString();

  // 4. Trata os eventos do DataCrazy
  if (event === 'demo_scheduled') {
    if (existingDemo) {
      return await recordLog({ ok: true, message: 'Demonstração já cadastrada (idempotente).', demoId: existingDemo.id });
    }

    const { data: demo, error: demoErr } = await db.from('cm_demonstrations').insert({
      tenant_id: tenantId,
      company_id: companyId,
      crm_deal_id: crmDealId || null,
      lead_id: lead.id,
      sdr_id: sdrId,
      closer_id: closerId,
      status: 'agendado',
      is_completed: false,
      first_scheduled_date: scheduledDate,
      current_scheduled_date: scheduledDate,
      reschedule_count: 0,
      deal_value_mrr: Number(data.mrr || data.deal_value_mrr || 0),
      deal_value_setup: Number(data.setup || data.deal_value_setup || 0)
    }).select().single();

    if (demoErr) return await recordLog({ ok: false, error: demoErr.message, status: 500 });
    return await recordLog({ ok: true, action: 'created', demoId: demo.id });
  }

  // Se não existir demonstração para os eventos seguintes, inicializa a base primeiro
  if (!existingDemo) {
    const { data: demo, error: demoErr } = await db.from('cm_demonstrations').insert({
      tenant_id: tenantId,
      company_id: companyId,
      crm_deal_id: crmDealId || null,
      lead_id: lead.id,
      sdr_id: sdrId,
      closer_id: closerId,
      status: 'agendado',
      is_completed: false,
      first_scheduled_date: scheduledDate,
      current_scheduled_date: scheduledDate,
      reschedule_count: 0,
      deal_value_mrr: Number(data.mrr || data.deal_value_mrr || 0),
      deal_value_setup: Number(data.setup || data.deal_value_setup || 0)
    }).select().single();
    if (demoErr) return await recordLog({ ok: false, error: demoErr.message, status: 500 });
    existingDemo = demo;
  }

  if (event === 'demo_rescheduled') {
    const newDate = data.new_date || data.scheduled_at || new Date().toISOString();
    await db.from('cm_reschedule_logs').insert({
      demonstration_id: existingDemo.id,
      previous_date: existingDemo.current_scheduled_date,
      new_date: newDate,
      reason: data.reason || 'Remarcação via CRM DataCrazy'
    });

    await db.from('cm_demonstrations').update({
      current_scheduled_date: newDate,
      reschedule_count: (existingDemo.reschedule_count || 0) + 1,
      status: 'agendado',
      is_completed: false,
      updated_at: new Date().toISOString()
    }).eq('id', existingDemo.id);

    return await recordLog({ ok: true, action: 'rescheduled', demoId: existingDemo.id });
  }

  if (event === 'demo_no_show') {
    await db.from('cm_demonstrations').update({
      status: 'aguardando_reagendamento',
      is_completed: false,
      updated_at: new Date().toISOString()
    }).eq('id', existingDemo.id);
    return await recordLog({ ok: true, action: 'no_show', demoId: existingDemo.id });
  }

  if (event === 'demo_completed') {
    const completedAt = data.completed_at || new Date().toISOString();
    const start = new Date(existingDemo.first_scheduled_date).getTime();
    const finish = new Date(completedAt).getTime();
    const cycleDays = Math.max(0, Math.round((finish - start) / (1000 * 60 * 60 * 24)));

    await db.from('cm_demonstrations').update({
      status: 'realizado',
      is_completed: true,
      completed_date: completedAt,
      cycle_days: cycleDays,
      updated_at: new Date().toISOString()
    }).eq('id', existingDemo.id);
    return await recordLog({ ok: true, action: 'completed', demoId: existingDemo.id });
  }

  if (event === 'deal_won') {
    const mrr = Number(data.mrr || data.deal_value_mrr || existingDemo.deal_value_mrr || 0);
    const setup = Number(data.setup || data.deal_value_setup || existingDemo.deal_value_setup || 0);
    const completedAt = existingDemo.completed_date || new Date().toISOString();
    const start = new Date(existingDemo.first_scheduled_date).getTime();
    const finish = new Date(completedAt).getTime();
    const cycleDays = Math.max(0, Math.round((finish - start) / (1000 * 60 * 60 * 24)));

    await db.from('cm_demonstrations').update({
      status: 'fechado',
      is_completed: true,
      completed_date: completedAt,
      cycle_days: cycleDays,
      deal_value_mrr: mrr,
      deal_value_setup: setup,
      updated_at: new Date().toISOString()
    }).eq('id', existingDemo.id);

    await db.from('cm_sales_commissions').upsert({
      demonstration_id: existingDemo.id,
      deal_value_mrr: mrr,
      deal_value_setup: setup,
      closed_date: new Date().toISOString(),
      sdr_commission_amount: Number(data.sdr_commission_amount || 0),
      closer_commission_amount: Number(data.closer_commission_amount || 0),
      status_payment: 'pendente'
    }, { onConflict: 'demonstration_id' });

    return await recordLog({ ok: true, action: 'won', demoId: existingDemo.id });
  }

  if (event === 'deal_lost') {
    await db.from('cm_demonstrations').update({
      status: 'perdido',
      loss_reason: data.reason || 'Perdido no CRM DataCrazy',
      updated_at: new Date().toISOString()
    }).eq('id', existingDemo.id);
    return await recordLog({ ok: true, action: 'lost', demoId: existingDemo.id });
  }

  return await recordLog({ ok: true, message: 'Evento recebido sem ação necessária.' });
}
