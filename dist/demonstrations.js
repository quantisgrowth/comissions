// Demonstrations & CRM Commercial Commissions Module
// Manages commercial demos, reschedule logs, SLA cycle days, and CRM sales commissions.

let demosData = {
  demos: [],
  leads: [],
  reschedules: [],
  commissions: [],
  loaded: false
};

let demosSubTab = 'pipeline'; // 'pipeline' | 'commissions'
let demosStatusFilter = 'all';
let demosSdrFilter = 'all';
let demosCloserFilter = 'all';
let demosQuery = '';

const demoStatusLabels = {
  agendado: { label: 'Agendado', color: '#1d4ed8', bg: '#dbeafe' },
  aguardando_reagendamento: { label: 'Aguardando reagendamento', color: '#b45309', bg: '#fef3c7' },
  demo_follow_up: { label: 'Follow-up pós-demo', color: '#6d28d9', bg: '#ede9fe' },
  trial: { label: 'Em Trial', color: '#0369a1', bg: '#e0f2fe' },
  realizado: { label: 'Realizada', color: '#15803d', bg: '#dcfce7' },
  fechado: { label: 'Fechado (Ganho)', color: '#047857', bg: '#d1fae5' },
  perdido: { label: 'Perdido', color: '#b91c1c', bg: '#fee2e2' }
};

const demoPaymentStatusLabels = {
  pendente: { label: 'Pendente', color: '#b45309', bg: '#fef3c7' },
  aprovado: { label: 'Aprovado', color: '#1d4ed8', bg: '#dbeafe' },
  pago: { label: 'Pago', color: '#15803d', bg: '#dcfce7' },
  cancelado: { label: 'Cancelado', color: '#b91c1c', bg: '#fee2e2' }
};

function formatDemoDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' às ' +
           d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function formatDemoDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return iso;
  }
}

// Comunicação com a API (Edge Function com fallback direto para PostgREST)
async function callDemosApi(action, extra = {}) {
  // 1. Tenta invocar a Edge Function comissions-api
  try {
    const res = await api(action, extra);
    if (res && !res.error) return res;
    if (res && res.error && res.error !== 'Ação inválida.' && res.error !== 'Ação de demonstrações inválida.') {
      throw Error(res.error);
    }
  } catch (err) {
    if (err.message && !err.message.includes('Ação inválida.') && !err.message.includes('Ação de demonstrações inválida.')) {
      throw err;
    }
  }

  // 2. Fallback direto via Supabase REST API (PostgREST)
  const token = typeof cloudSession !== 'undefined' && cloudSession ? cloudSession.access_token : null;
  const headers = {
    apikey: CLOUD_KEY,
    'Content-Type': 'application/json',
    ...(token ? { Authorization: 'Bearer ' + token } : {})
  };
  const u = typeof user === 'function' ? user() : null;
  const tenantId = u?.tenant_id || '00000000-0000-0000-0000-000000000001';

  if (action === 'demos-list') {
    try {
      const [demosRes, leadsRes, reschedulesRes, commissionsRes] = await Promise.all([
        fetch(CLOUD_URL + '/rest/v1/cm_demonstrations?archived_at=is.null&order=current_scheduled_date.desc', { headers }).then(r => r.ok ? r.json() : []),
        fetch(CLOUD_URL + '/rest/v1/cm_leads', { headers }).then(r => r.ok ? r.json() : []),
        fetch(CLOUD_URL + '/rest/v1/cm_reschedule_logs?order=created_at.desc', { headers }).then(r => r.ok ? r.json() : []),
        fetch(CLOUD_URL + '/rest/v1/cm_sales_commissions', { headers }).then(r => r.ok ? r.json() : [])
      ]);

      return {
        demos: Array.isArray(demosRes) ? demosRes : [],
        leads: Array.isArray(leadsRes) ? leadsRes : [],
        reschedules: Array.isArray(reschedulesRes) ? reschedulesRes : [],
        commissions: Array.isArray(commissionsRes) ? commissionsRes : []
      };
    } catch {
      return { demos: [], leads: [], reschedules: [], commissions: [] };
    }
  }

  if (action === 'demo-save') throw Error('O serviço de edição está indisponível. Atualize a página e tente novamente.');

  if (action === 'demo-reschedule') {
    const { demoId, newDate, reason } = extra;
    if (!demoId || !newDate) throw Error('Dados do reagendamento incompletos.');

    const demo = (demosData.demos || []).find(d => d.id === demoId);
    const prevDate = demo?.current_scheduled_date || new Date().toISOString();
    const count = (demo?.reschedule_count || 0) + 1;

    // Registra o log
    await fetch(CLOUD_URL + '/rest/v1/cm_reschedule_logs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        demonstration_id: demoId,
        previous_date: prevDate,
        new_date: newDate,
        reason: reason ? String(reason).trim() : null,
        actor_id: u?.id || null
      })
    });

    // Atualiza a demonstração
    const res = await fetch(CLOUD_URL + '/rest/v1/cm_demonstrations?id=eq.' + encodeURIComponent(demoId), {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        current_scheduled_date: newDate,
        reschedule_count: count,
        status: 'agendado',
        is_completed: false,
        updated_at: new Date().toISOString()
      })
    });
    const data = await res.json();
    if (!res.ok) throw Error(data.message || 'Erro ao reagendar demonstração.');
    return { rescheduled: true, demo: data[0] };
  }

  if (action === 'demo-status-update') {
    const { demoId, status, isCompleted, lossReason } = extra;
    const updates = {
      status,
      updated_at: new Date().toISOString()
    };
    if (isCompleted !== undefined) updates.is_completed = !!isCompleted;

    const demo = (demosData.demos || []).find(d => d.id === demoId);
    if (status === 'realizado' || isCompleted === true) {
      updates.is_completed = true;
      if (demo && !demo.completed_date) {
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

    const res = await fetch(CLOUD_URL + '/rest/v1/cm_demonstrations?id=eq.' + encodeURIComponent(demoId), {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(updates)
    });
    const data = await res.json();
    if (!res.ok) throw Error(data.message || 'Erro ao atualizar status.');
    return { updated: true, demo: data[0] };
  }

  if (action === 'demo-close-sale') {
    const { demoId, mrr, setup, sdrCommission, closerCommission, contractId } = extra;
    const demo = (demosData.demos || []).find(d => d.id === demoId);
    const completedAt = demo?.completed_date || new Date().toISOString();
    const start = demo ? new Date(demo.first_scheduled_date).getTime() : Date.now();
    const finish = new Date(completedAt).getTime();
    const cycleDays = Math.max(0, Math.round((finish - start) / (1000 * 60 * 60 * 24)));

    await fetch(CLOUD_URL + '/rest/v1/cm_demonstrations?id=eq.' + encodeURIComponent(demoId), {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        status: 'fechado',
        is_completed: true,
        completed_date: completedAt,
        cycle_days: cycleDays,
        deal_value_mrr: Number(mrr || 0),
        deal_value_setup: Number(setup || 0),
        updated_at: new Date().toISOString()
      })
    });

    const commPayload = {
      demonstration_id: demoId,
      contract_id: contractId || null,
      deal_value_mrr: Number(mrr || 0),
      deal_value_setup: Number(setup || 0),
      closed_date: new Date().toISOString(),
      sdr_commission_amount: Number(sdrCommission || 0),
      closer_commission_amount: Number(closerCommission || 0),
      status_payment: 'pendente'
    };

    const res = await fetch(CLOUD_URL + '/rest/v1/cm_sales_commissions', {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(commPayload)
    });
    const data = await res.json();
    if (!res.ok) throw Error(data.message || 'Erro ao registrar comissão de venda.');
    return { closed: true, commission: data[0] };
  }

  if (action === 'demo-commission-status') {
    const { commissionId, statusPayment } = extra;
    const res = await fetch(CLOUD_URL + '/rest/v1/cm_sales_commissions?id=eq.' + encodeURIComponent(commissionId), {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ status_payment: statusPayment })
    });
    const data = await res.json();
    if (!res.ok) throw Error(data.message || 'Erro ao atualizar pagamento da comissão.');
    return { updated: true, commission: data[0] };
  }

  if (action === 'demo-assign') {
    const { demoId, closerId, sdrId } = extra;
    const res = await fetch(CLOUD_URL + '/rest/v1/cm_demonstrations?id=eq.' + encodeURIComponent(demoId), {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        closer_id: closerId || null,
        sdr_id: sdrId || null,
        updated_at: new Date().toISOString()
      })
    });
    const data = await res.json();
    if (!res.ok) throw Error(data.message || 'Erro ao transferir responsáveis.');
    return { updated: true, demo: data[0] };
  }

  throw Error('Ação de demonstrações não suportada.');
}

let demosRealtimeTimer = null;
let lastKnownDemoIds = new Set();
let lastKnownDemoTimestamps = new Map();

function startDemosRealtimeSync() {
  if (demosRealtimeTimer) return;
  demosRealtimeTimer = setInterval(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (typeof cloudReady !== 'undefined' && !cloudReady) return;
    if (typeof page !== 'undefined' && page !== 'Demonstrações' && page !== 'Visão geral') return;

    try {
      const res = await callDemosApi('demos-list', { companyId: typeof company !== 'undefined' ? company : 'all' });
      if (!res || !Array.isArray(res.demos)) return;

      const newDemos = res.demos;
      let hasChanges = false;
      let newLeadName = '';

      if (lastKnownDemoIds.size > 0) {
        for (const d of newDemos) {
          if (!lastKnownDemoIds.has(d.id)) {
            hasChanges = true;
            const lead = (res.leads || []).find(l => l.id === d.lead_id);
            newLeadName = lead?.company_name || lead?.contact_name || 'Novo agendamento CRM';
            break;
          } else if (lastKnownDemoTimestamps.get(d.id) !== d.updated_at) {
            hasChanges = true;
          }
        }
      }

      lastKnownDemoIds = new Set(newDemos.map(d => d.id));
      lastKnownDemoTimestamps = new Map(newDemos.map(d => [d.id, d.updated_at]));

      if (hasChanges || !demosData.loaded) {
        demosData = {
          demos: res.demos || [],
          leads: res.leads || [],
          reschedules: res.reschedules || [],
          commissions: res.commissions || [],
          loaded: true
        };

        if (newLeadName && typeof toast === 'function') {
          toast(`🔔 Nova demonstração do CRM: ${newLeadName}`);
        }

        const modal = typeof document !== 'undefined' ? document.getElementById('modal') : null;
        if (!modal || !modal.open) {
          if (typeof page !== 'undefined' && page === 'Demonstrações' && typeof render === 'function') {
            render();
          }
        }
      }
    } catch (e) {
      // background poll
    }
  }, 3500);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden && typeof cloudReady !== 'undefined' && cloudReady && typeof page !== 'undefined' && page === 'Demonstrações') {
      await fetchDemos(true);
      if (typeof render === 'function') render();
    }
  });
  window.addEventListener('focus', async () => {
    if (typeof cloudReady !== 'undefined' && cloudReady && typeof page !== 'undefined' && page === 'Demonstrações') {
      await fetchDemos(true);
      if (typeof render === 'function') render();
    }
  });
}

async function fetchDemos(force = false) {
  if (demosData.loaded && !force) return;
  startDemosRealtimeSync();
  try {
    const res = await callDemosApi('demos-list', { companyId: typeof company !== 'undefined' ? company : 'all' });
    if (res) {
      demosData = {
        demos: res.demos || [],
        leads: res.leads || [],
        reschedules: res.reschedules || [],
        commissions: res.commissions || [],
        loaded: true
      };
      lastKnownDemoIds = new Set((res.demos || []).map(d => d.id));
      lastKnownDemoTimestamps = new Map((res.demos || []).map(d => [d.id, d.updated_at]));
    }
  } catch (err) {
    console.error('Erro ao carregar demonstrações:', err);
  }
}

function switchDemosSubTab(tab) {
  demosSubTab = tab;
  render();
}

// Renderizador principal da página de Demonstrações
function renderDemonstrationsModule() {
  startDemosRealtimeSync();
  if (!demosData.loaded) {
    fetchDemos(true).then(() => render());
    return title('Demonstrações comerciais', 'Ciclo de vendas de agendamento a fechamento.') +
      `<section class="panel"><p>Carregando demonstrações e comissões do CRM…</p></section>`;
  }

  const u = user();
  const isManager = canManage('Demonstrações');

  // Filtra por empresa ativa no sidebar
  let demos = demosData.demos.filter(d => {
    const hasCompanyAccess = !d.company_id || canAccess(d.company_id) || (u && u.all);
    if (!hasCompanyAccess) return false;
    if (company !== 'all' && d.company_id && d.company_id !== company) return false;
    // Se for vendedor, visualiza apenas demos onde é Closer ou SDR (a menos que seja gestor)
    if (!isManager && ['Vendedor', 'Colaborador'].includes(u.role)) {
      if (d.closer_id !== u.id && d.sdr_id !== u.id) return false;
    }
    return true;
  });

  const leadsMap = new Map(demosData.leads.map(l => [l.id, l]));
  const commissionsMap = new Map(demosData.commissions.map(c => [c.demonstration_id, c]));

  // Cálculo de Métricas no Topo
  const totalDemos = demos.length;
  const completedDemos = demos.filter(d => d.is_completed === true).length;
  const showRate = totalDemos ? Math.round((completedDemos / totalDemos) * 100) : 0;

  const totalReschedules = demos.reduce((sum, d) => sum + (d.reschedule_count || 0), 0);
  const avgReschedules = totalDemos ? (totalReschedules / totalDemos).toFixed(1) : '0.0';

  const completedWithCycle = demos.filter(d => d.cycle_days !== null && d.cycle_days !== undefined);
  const totalCycleDays = completedWithCycle.reduce((sum, d) => sum + Number(d.cycle_days || 0), 0);
  const avgCycleDays = completedWithCycle.length ? Math.round(totalCycleDays / completedWithCycle.length) : 0;

  // Pipeline Projetado (demos ativas: agendado, aguardando_reagendamento, demo_follow_up, trial)
  const activeStatuses = ['agendado', 'aguardando_reagendamento', 'demo_follow_up', 'trial'];
  const projectedPipeline = demos
    .filter(d => activeStatuses.includes(d.status))
    .reduce((sum, d) => sum + Number(d.deal_value_mrr || 0) + Number(d.deal_value_setup || 0), 0);

  // Total de Comissões geradas no escopo
  const relevantDemoIds = new Set(demos.map(d => d.id));
  const relevantCommissions = demosData.commissions.filter(c => relevantDemoIds.has(c.demonstration_id));
  const totalCommissions = relevantCommissions.reduce((sum, c) => {
    if (!isManager && ['Vendedor', 'Colaborador'].includes(u.role)) {
      const demo = demos.find(d => d.id === c.demonstration_id);
      let mine = 0;
      if (demo?.sdr_id === u.id) mine += Number(c.sdr_commission_amount || 0);
      if (demo?.closer_id === u.id) mine += Number(c.closer_commission_amount || 0);
      return sum + mine;
    }
    return sum + Number(c.sdr_commission_amount || 0) + Number(c.closer_commission_amount || 0);
  }, 0);

  // Top Metrics Cards
  const metricsCards = metric([
    ['Show Rate', `${showRate}%`, `${completedDemos} de ${totalDemos} compareceram`],
    ['Média de Remarcações', `${avgReschedules}`, `${totalReschedules} remarcações totais`],
    ['Ciclo Médio (SLA)', `${avgCycleDays} dias`, 'Do 1º agendamento ao fechamento'],
    ['Pipeline Projetado', money(projectedPipeline), 'MRR + Setup em negociação'],
    ['Comissões do Período', money(totalCommissions), 'Apuração de vendas ganhas']
  ]);

  // Sub-abas de navegação
  const subTabs = `
    <div style="display:flex;gap:10px;margin-bottom:20px;align-items:center;flex-wrap:wrap;">
      ${btn('Demonstrações & Pipeline', `switchDemosSubTab('pipeline')`, demosSubTab !== 'pipeline')}
      ${btn('Painel de Comissões CRM', `switchDemosSubTab('commissions')`, demosSubTab !== 'commissions')}
      ${isManager ? btn('⚡ Automações & Webhooks (DataCrazy) ↗', "go('Automações')", true) : ''}
      <span class="live-indicator" style="margin-left:auto;"><span class="live-pulse-dot"></span> Tempo real ativo</span>
    </div>
  `;

  if (demosSubTab === 'commissions') {
    return title('Demonstrações comerciais', 'Controle operacional de agendamentos e apuração de comissões.') +
      subTabs +
      renderDemosCommissionsTab(relevantCommissions, demos, leadsMap);
  }

  // Sub-aba Pipeline e Operacional de Demonstrações
  // Aplicação de Filtros locais
  let filteredDemos = demos.filter(d => {
    if (demosStatusFilter !== 'all' && d.status !== demosStatusFilter) return false;
    if (demosSdrFilter !== 'all' && d.sdr_id !== demosSdrFilter) return false;
    if (demosCloserFilter !== 'all' && d.closer_id !== demosCloserFilter) return false;

    if (demosQuery.trim()) {
      const q = demosQuery.trim().toLowerCase();
      const lead = leadsMap.get(d.lead_id);
      const matchCompany = (lead?.company_name || '').toLowerCase().includes(q);
      const matchContact = (lead?.contact_name || '').toLowerCase().includes(q);
      const matchPhone = (lead?.phone || '').includes(q);
      const matchEmail = (lead?.email || '').toLowerCase().includes(q);
      const matchDeal = (d.crm_deal_id || '').toLowerCase().includes(q);
      if (!matchCompany && !matchContact && !matchPhone && !matchEmail && !matchDeal) return false;
    }
    return true;
  });

  const toolbar = renderDemosToolbar();
  const tableHtml = renderDemosTable(filteredDemos, leadsMap, commissionsMap);

  return title('Demonstrações comerciais', 'Gerencie demonstrações agendadas, no-shows, remarcações e fechamento de vendas.',
    btn('+ Nova demonstração manual', 'openManualDemoModal()')
  ) +
  metricsCards +
  subTabs +
  toolbar +
  tableHtml;
}

// Barra de Filtros Operacionais
function renderDemosToolbar() {
  const usersList = state.users.filter(u => u.active);
  const sdrOptions = usersList.map(u => `<option value="${esc(u.id)}" ${demosSdrFilter === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  const closerOptions = usersList.map(u => `<option value="${esc(u.id)}" ${demosCloserFilter === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('');

  return `
    <section class="panel" style="margin-bottom:18px;padding:16px 20px;">
      <div style="display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr auto;gap:12px;align-items:end;">
        <div class="field" style="margin:0;">
          <label style="font-size:11px;color:var(--muted);margin-bottom:4px;display:block;">Buscar lead, empresa ou contato</label>
          <input type="search" placeholder="Empresa, contato, e-mail, telefone..." value="${esc(demosQuery)}" oninput="demosQuery=this.value;render();" style="width:100%;height:38px;">
        </div>
        <div class="field" style="margin:0;">
          <label style="font-size:11px;color:var(--muted);margin-bottom:4px;display:block;">Status da demonstração</label>
          <select onchange="demosStatusFilter=this.value;render();" style="width:100%;height:38px;">
            <option value="all" ${demosStatusFilter === 'all' ? 'selected' : ''}>Todos os status</option>
            ${Object.entries(demoStatusLabels).map(([val, info]) => `<option value="${val}" ${demosStatusFilter === val ? 'selected' : ''}>${info.label}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="margin:0;">
          <label style="font-size:11px;color:var(--muted);margin-bottom:4px;display:block;">SDR (Pré-vendas)</label>
          <select onchange="demosSdrFilter=this.value;render();" style="width:100%;height:38px;">
            <option value="all" ${demosSdrFilter === 'all' ? 'selected' : ''}>Todos os SDRs</option>
            ${sdrOptions}
          </select>
        </div>
        <div class="field" style="margin:0;">
          <label style="font-size:11px;color:var(--muted);margin-bottom:4px;display:block;">Closer (Vendedor)</label>
          <select onchange="demosCloserFilter=this.value;render();" style="width:100%;height:38px;">
            <option value="all" ${demosCloserFilter === 'all' ? 'selected' : ''}>Todos os Closers</option>
            ${closerOptions}
          </select>
        </div>
        <div>
          ${btn('Limpar filtros', 'demosQuery="";demosStatusFilter="all";demosSdrFilter="all";demosCloserFilter="all";render();', true)}
        </div>
      </div>
    </section>
  `;
}

// Tabela Operacional de Demonstrações
function renderDemosTable(demos, leadsMap, commissionsMap) {
  if (!demos.length) {
    return `<section class="panel empty">
      <h2>Nenhuma demonstração encontrada</h2>
      <p>Ajuste os filtros ou cadastre um novo agendamento manual.</p>
    </section>`;
  }

  const rows = demos.map(d => {
    const lead = leadsMap.get(d.lead_id) || {};
    const sdr = state.users.find(u => u.id === d.sdr_id);
    const closer = state.users.find(u => u.id === d.closer_id);
    const statusCfg = demoStatusLabels[d.status] || { label: d.status, color: '#374151', bg: '#f3f4f6' };

    // Badge de remarcações com contador clicável
    const resCount = d.reschedule_count || 0;
    const rescheduleBadge = `
      <button type="button" class="btn secondary" onclick="openRescheduleHistoryModal('${esc(d.id)}')"
        style="padding:3px 8px;font-size:11px;font-weight:600;border-radius:12px;background:${resCount > 0 ? '#fef3c7' : '#f3f4f6'};color:${resCount > 0 ? '#b45309' : '#6b7280'};border:1px solid ${resCount > 0 ? '#fde68a' : '#e5e7eb'};cursor:pointer;"
        title="Clique para ver o histórico de remarcações">
        R: ${resCount} ℹ
      </button>
    `;

    // Toggle rápido de comparecimento (Show Rate)
    const isCompleted = d.is_completed === true;
    const showRateToggle = `
      <button type="button" class="btn" onclick="toggleDemoCompleted('${esc(d.id)}', ${isCompleted})"
        style="padding:4px 9px;font-size:11px;border-radius:6px;background:${isCompleted ? '#dcfce7' : '#f3f4f6'};color:${isCompleted ? '#15803d' : '#6b7280'};border:1px solid ${isCompleted ? '#86efac' : '#d1d5db'};font-weight:600;"
        title="Alternar comparecimento à demonstração">
        ${isCompleted ? '✓ Realizada' : '✗ Não realizada'}
      </button>
    `;

    // Status com badge e menu rápido de transição
    const statusPill = `
      <span style="display:inline-block;padding:4px 8px;border-radius:5px;font-size:11px;font-weight:600;color:${statusCfg.color};background:${statusCfg.bg};">
        ${statusCfg.label}
      </span>
    `;

    // Proposta negociada
    const proposalHtml = `
      <div style="font-size:12px;font-weight:600;">MRR: ${money(d.deal_value_mrr || 0)}</div>
      <div class="small">Setup: ${money(d.deal_value_setup || 0)}</div>
    `;

    // Datas: Original vs Atual vs Realização
    const scheduledFormatted = d.current_scheduled_date ? formatDemoDateTime(d.current_scheduled_date) : 'A definir';
    const origFormatted = formatDemoDateTime(d.first_scheduled_date);
    const completedFormatted = d.completed_date ? formatDemoDateTime(d.completed_date) : null;
    const isFinished = isCompleted || ['realizado', 'fechado'].includes(d.status);

    let datesHtml = '';
    if (isFinished) {
      datesHtml = `
        <div style="font-size:12px;"><span style="color:var(--muted);font-size:10px;text-transform:uppercase;display:block;">Agendamento</span><strong>${scheduledFormatted}</strong></div>
        <div style="font-size:12px;margin-top:3px;color:#15803d;"><span style="color:#15803d;font-size:10px;text-transform:uppercase;display:block;">✓ Realizada em</span><strong>${completedFormatted || scheduledFormatted}</strong></div>
        ${d.cycle_days !== null && d.cycle_days !== undefined ? `<div class="small" style="color:#047857;font-weight:600;margin-top:2px;">Ciclo: ${d.cycle_days} dia(s)</div>` : ''}
      `;
    } else {
      datesHtml = `
        <div style="font-size:12px;"><span style="color:var(--muted);font-size:10px;text-transform:uppercase;display:block;">Data & Horário</span><strong style="color:var(--navy);font-size:13px;">📅 ${scheduledFormatted}</strong></div>
        ${resCount > 0 ? `<div class="small" style="color:var(--muted);margin-top:3px;">1º agendamento: ${origFormatted}</div>` : ''}
      `;
    }

    // Contato
    const rawPhone = String(lead.phone || '').trim();
    const cleanPhone = rawPhone.replace(/\D/g, '');
    const waLink = cleanPhone ? (cleanPhone.startsWith('55') ? `https://wa.me/${cleanPhone}` : `https://wa.me/55${cleanPhone}`) : null;
    const contactHtml = `
      <div style="font-weight:600;">${esc(lead.contact_name || 'Sem nome')}</div>
      ${rawPhone ? `<div class="small">${waLink ? `<a href="${waLink}" target="_blank" rel="noopener" style="color:#15803d;font-weight:600;text-decoration:none;" title="Conversar no WhatsApp">💬 ${esc(rawPhone)}</a>` : esc(rawPhone)}</div>` : ''}
      ${lead.email ? `<div class="small"><a href="mailto:${esc(lead.email)}" style="color:var(--green);">${esc(lead.email)}</a></div>` : ''}
    `;

    // Lead / Empresa
    const leadHtml = `
      <div>
        <a href="#" onclick="openLead360Modal('${esc(d.id)}');return false;" style="color:var(--navy);font-weight:700;font-size:13px;text-decoration:none;" title="Clique para abrir detalhes da oportunidade">
          ${esc(lead.company_name || 'Lead sem nome')} <span style="color:var(--green);font-size:11px;">↗</span>
        </a>
      </div>
      <div class="small">${esc(companyName(d.company_id))} · ${esc(lead.segment || 'Geral')}</div>
      ${d.crm_deal_id ? `<div class="small" style="color:#6b7280;">CRM #${esc(d.crm_deal_id)}</div>` : ''}
    `;

    // Responsáveis (SDR e Closer)
    const respHtml = `
      <div class="small"><strong>Closer:</strong> ${esc(closer?.name || 'Não atribuído')}</div>
      <div class="small"><strong>SDR:</strong> ${esc(sdr?.name || 'Não atribuído')}</div>
    `;

    // Ações com Ícones elegantes e tooltips
    const actionButtons = `
      <div style="display:flex;gap:5px;align-items:center;">
        <button type="button" class="btn secondary" onclick="openLead360Modal('${esc(d.id)}')" style="padding:6px 9px;font-size:13px;border-radius:6px;" title="Ver detalhes completos da oportunidade (Ficha 360°)">
          👁️
        </button>
        <button type="button" class="btn secondary" onclick="openRescheduleModal('${esc(d.id)}')" style="padding:6px 9px;font-size:13px;border-radius:6px;" title="Reagendar Demonstração">
          🗓️
        </button>
        ${d.status !== 'fechado' ? `
          <button type="button" class="btn" onclick="openCloseSaleModal('${esc(d.id)}')" style="background:#16a34a;color:white;padding:6px 9px;font-size:13px;border-radius:6px;" title="Fechar Venda (Ganho) 👍">
            👍
          </button>
        ` : ''}
        ${d.status !== 'perdido' && d.status !== 'fechado' ? `
          <button type="button" class="btn secondary" onclick="openLossModal('${esc(d.id)}')" style="color:#dc2626;background:#fef2f2;border-color:#fca5a5;padding:6px 9px;font-size:13px;border-radius:6px;" title="Marcar como Perdido 👎">
            👎
          </button>
        ` : ''}
        <button type="button" class="btn secondary" onclick="openManualDemoModal('${esc(d.id)}')" style="padding:6px 9px;font-size:13px;border-radius:6px;" title="Editar Dados Manuais">
          ✏️
        </button>
        ${canManage() && !d.is_completed && ['agendado','aguardando_reagendamento'].includes(d.status) ? productAction('delete','Excluir agendamento',`openArchiveDemo('${actionId(d.id)}')`) : ''}
      </div>
    `;

    return [
      leadHtml,
      contactHtml,
      datesHtml + `<div class="small">Entrada: ${formatDemoDateTime(d.created_at)}</div>`,
      rescheduleBadge,
      respHtml,
      showRateToggle,
      statusPill,
      proposalHtml,
      actionButtons
    ];
  });

  return `
    <section class="panel" style="overflow-x:auto;">
      ${table([
        'Lead / Empresa',
        'Contato',
        'Reunião e ciclo',
        'Remarcações',
        'Responsáveis',
        'Show Rate',
        'Status',
        'Proposta',
        'Ações'
      ], rows)}
    </section>
  `;
}

// Sub-aba: Painel de Comissões Comerciais CRM
function renderDemosCommissionsTab(commissions, demos, leadsMap) {
  const isManager = canManage('Demonstrações');
  const u = user();

  const totalSdr = commissions.reduce((sum, c) => sum + Number(c.sdr_commission_amount || 0), 0);
  const totalCloser = commissions.reduce((sum, c) => sum + Number(c.closer_commission_amount || 0), 0);
  const totalBoth = totalSdr + totalCloser;

  const totalPaid = commissions.filter(c => c.status_payment === 'pago')
    .reduce((sum, c) => sum + Number(c.sdr_commission_amount || 0) + Number(c.closer_commission_amount || 0), 0);

  const totalPending = commissions.filter(c => c.status_payment === 'pendente')
    .reduce((sum, c) => sum + Number(c.sdr_commission_amount || 0) + Number(c.closer_commission_amount || 0), 0);

  const summary = metric([
    ['Total de Comissões', money(totalBoth), `${commissions.length} vendas fechadas`],
    ['Comissões Closer', money(totalCloser), 'Vendedores fechadores'],
    ['Comissões SDR', money(totalSdr), 'Pré-vendas e agendamento'],
    ['Pendente', money(totalPending), 'Aguardando aprovação'],
    ['Pago', money(totalPaid), 'Baixa realizada']
  ]);

  if (!commissions.length) {
    return summary + `<section class="panel empty">
      <h2>Nenhuma comissão comercial fechada no período</h2>
      <p>As comissões são apuradas automaticamente quando uma demonstração é marcada como Fechada (Venda ganha).</p>
    </section>`;
  }

  const rows = commissions.map(c => {
    const demo = demos.find(d => d.id === c.demonstration_id) || {};
    const lead = leadsMap.get(demo.lead_id) || {};
    const sdr = state.users.find(u => u.id === demo.sdr_id);
    const closer = state.users.find(u => u.id === demo.closer_id);
    const payCfg = demoPaymentStatusLabels[c.status_payment] || { label: c.status_payment, color: '#374151', bg: '#f3f4f6' };

    const statusBadge = `
      <span style="display:inline-block;padding:4px 8px;border-radius:5px;font-size:11px;font-weight:600;color:${payCfg.color};background:${payCfg.bg};">
        ${payCfg.label}
      </span>
    `;

    // Ações de pagamento para gestor
    let actionsHtml = '—';
    if (isManager) {
      if (c.status_payment === 'pendente') {
        actionsHtml = `
          <button type="button" class="btn" onclick="changeDemoPaymentStatus('${esc(c.id)}', 'aprovado')" style="padding:4px 8px;font-size:11px;background:#1d4ed8;">
            Aprovar
          </button>
        `;
      } else if (c.status_payment === 'aprovado') {
        actionsHtml = `
          <button type="button" class="btn" onclick="changeDemoPaymentStatus('${esc(c.id)}', 'pago')" style="padding:4px 8px;font-size:11px;background:#15803d;">
            Marcar Pago
          </button>
        `;
      } else if (c.status_payment === 'pago') {
        actionsHtml = `
          <button type="button" class="btn secondary" onclick="changeDemoPaymentStatus('${esc(c.id)}', 'pendente')" style="padding:4px 8px;font-size:11px;">
            Desfazer
          </button>
        `;
      }
    }

    return [
      `<strong>${esc(lead.company_name || 'Lead sem nome')}</strong><div class="small">${esc(companyName(demo.company_id))}</div>`,
      formatDemoDate(c.closed_date),
      `<div>MRR: ${money(c.deal_value_mrr)}</div><div class="small">Setup: ${money(c.deal_value_setup)}</div>`,
      `<strong>${money(c.sdr_commission_amount)}</strong><div class="small">${esc(sdr?.name || 'SDR não atribuído')}</div>`,
      `<strong>${money(c.closer_commission_amount)}</strong><div class="small">${esc(closer?.name || 'Closer não atribuído')}</div>`,
      `<strong>${money(Number(c.sdr_commission_amount || 0) + Number(c.closer_commission_amount || 0))}</strong>`,
      statusBadge,
      actionsHtml
    ];
  });

  return summary + `
    <section class="panel" style="overflow-x:auto;">
      ${table([
        'Empresa / Lead',
        'Data Fechamento',
        'Valores do Negócio',
        'Comissão SDR',
        'Comissão Closer',
        'Total Comissão',
        'Status Pagamento',
        'Ações'
      ], rows)}
    </section>
  `;
}

// Alternar comparecimento (Show Rate)
async function toggleDemoCompleted(demoId, currentVal) {
  try {
    const newVal = !currentVal;
    await callDemosApi('demo-status-update', {
      demoId,
      status: newVal ? 'realizado' : 'agendado',
      isCompleted: newVal
    });
    toast(newVal ? 'Demonstração marcada como realizada!' : 'Demonstração marcada como pendente.');
    await fetchDemos(true);
    render();
  } catch (err) {
    toast(err.message);
  }
}

// Alterar Status de Pagamento da Comissão
async function changeDemoPaymentStatus(commissionId, statusPayment) {
  try {
    await callDemosApi('demo-commission-status', { commissionId, statusPayment });
    toast(`Status alterado para ${demoPaymentStatusLabels[statusPayment]?.label || statusPayment}.`);
    await fetchDemos(true);
    render();
  } catch (err) {
    toast(err.message);
  }
}

// Modal: Nova Demonstração / Edição Manual
function openManualDemoModal(demoId = null) {
  const isNew = !demoId;
  const demo = isNew ? null : (demosData.demos.find(d => d.id === demoId) || null);
  const lead = demo ? (demosData.leads.find(l => l.id === demo.lead_id) || {}) : {};

  const companies = allowed();
  if (!companies.length) return toast('Nenhuma empresa autorizada.');
  const initialCompany = demo?.company_id || (company === 'all' ? companies[0].id : company);

  const usersList = state.users.filter(u => u.active);
  const curUser = user();

  const toInputDate = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toISOString().slice(0, 16);
    } catch {
      return '';
    }
  };

  const defaultDate = (demo ? (demo.current_scheduled_date ? toInputDate(demo.current_scheduled_date) : '') : toInputDate(new Date(Date.now() + 24 * 3600 * 1000).toISOString()));

  show(`
    <h2>${isNew ? 'Novo agendamento de demonstração' : 'Editar demonstração'}</h2>
    <p>Cadastre os dados do lead, responsáveis e data do agendamento comercial.</p>
    <form id="demoForm">
      <div class="formgrid" style="margin-top:16px;">
        ${select('demoCompany', 'Empresa', companies.map(c => [c.id, c.name]), initialCompany)}
        ${field('demoCompanyName', 'Nome da Empresa / Razão Social', lead.company_name || '', 'text', 'required placeholder="Ex: Alfa Locações"')}
        ${field('demoContactName', 'Nome do Contato', lead.contact_name || '', 'text', 'placeholder="Ex: João Silva"')}
        ${field('demoPhone', 'Telefone / WhatsApp', lead.phone || '', 'tel', 'placeholder="(11) 99999-9999"')}
        ${field('demoEmail', 'E-mail do Lead', lead.email || '', 'email', 'placeholder="contato@empresa.com"')}
        ${field('demoSegment', 'Segmento de Atuação', lead.segment || '', 'text', 'placeholder="Ex: Locação, Terraplanagem, Munck"')}
        ${select('demoSdr', 'SDR (Pré-vendas)', [['', 'Nenhum / Não atribuído'], ...usersList.map(u => [u.id, u.name])], demo?.sdr_id || '')}
        ${select('demoCloser', 'Closer (Vendedor)', usersList.map(u => [u.id, u.name]), demo?.closer_id || curUser?.id)}
        ${field('demoDate', 'Data e Hora do Agendamento', defaultDate, 'datetime-local', 'required')}
        ${select('demoStatus', 'Status', Object.entries(demoStatusLabels).map(([k, v]) => [k, v.label]), demo?.status || 'agendado')}
        ${field('demoMrr', 'Proposta Mensalidade (MRR R$)', demo?.deal_value_mrr ?? 0, 'number', 'min="0" step=".01"')}
        ${field('demoSetup', 'Proposta Implementação / Setup (R$)', demo?.deal_value_setup ?? 0, 'number', 'min="0" step=".01"')}
      </div>
      <div class="field" style="margin-top:14px;">
        <label>Observações / Contexto da Oportunidade</label>
        <textarea name="demoNotes" rows="2" style="width:100%;padding:8px;border:1px solid #dbe3dc;border-radius:6px;">${esc(demo?.notes || '')}</textarea>
      </div>
      ${actions()}
    </form>
  `, async (formData) => {
    try {
      const companyId = formData.get('demoCompany');
      const companyName = formData.get('demoCompanyName')?.trim();
      const contactName = formData.get('demoContactName')?.trim();
      const phone = formData.get('demoPhone')?.trim();
      const email = formData.get('demoEmail')?.trim();
      const segment = formData.get('demoSegment')?.trim();
      const sdrId = formData.get('demoSdr') || null;
      const closerId = formData.get('demoCloser') || null;
      const scheduledAt = formData.get('demoDate');
      const status = formData.get('demoStatus');
      const mrr = Number(formData.get('demoMrr') || 0);
      const setup = Number(formData.get('demoSetup') || 0);
      const notes = formData.get('demoNotes')?.trim();

      if (!companyName) throw Error('Informe o nome da empresa.');
      if (!scheduledAt) throw Error('Selecione a data do agendamento.');

      const scheduledIso = new Date(scheduledAt).toISOString();

      const saved = await callDemosApi('demo-save', {
        demo: {
          id: demo?.id || null,
          company_id: companyId,
          lead_id: demo?.lead_id || null,
          company_name: companyName,
          contact_name: contactName,
          phone,
          email,
          segment,
          sdr_id: sdrId,
          closer_id: closerId,
          status,
          current_scheduled_date: scheduledIso,
          deal_value_mrr: mrr,
          deal_value_setup: setup,
          notes
        }
      });

      if (!saved?.saved || !saved.demo?.id || !saved.lead?.id) throw Error('O servidor não confirmou todos os dados. Atualize e tente novamente.');
      demosData.demos = [...demosData.demos.filter(d => d.id !== saved.demo.id), saved.demo];
      demosData.leads = [...demosData.leads.filter(l => l.id !== saved.lead.id), saved.lead];
      document.getElementById('modal').close();
      toast('Demonstração salva com sucesso!');
      await fetchDemos(true);
      render();
    } catch (err) {
      toast(err.message);
    }
  });
}

// Modal: Reagendamento de Demonstração
function openRescheduleModal(demoId) {
  const demo = demosData.demos.find(d => d.id === demoId);
  if (!demo) return toast('Demonstração não encontrada.');
  const lead = demosData.leads.find(l => l.id === demo.lead_id) || {};

  show(`
    <h2>Reagendar demonstração</h2>
    <p><strong>${esc(lead.company_name || 'Lead')}</strong> · ${esc(lead.contact_name || '')}</p>
    <div class="notice">
      Data atual agendada: <strong>${formatDemoDateTime(demo.current_scheduled_date)}</strong><br>
      Esta demonstração já foi remarcada <strong>${demo.reschedule_count || 0}</strong> vez(es).
    </div>
    <form id="rescheduleForm">
      <div class="field" style="margin:16px 0;">
        <label>Nova data e horário da demonstração</label>
        <input type="datetime-local" name="newDate" required style="width:100%;padding:10px;">
      </div>
      <div class="field" style="margin:16px 0;">
        <label>Motivo da remarcação</label>
        <textarea name="reason" rows="3" required placeholder="Ex: Cliente solicitou alteração devido a reunião urgente da diretoria..." style="width:100%;padding:10px;border:1px solid #dbe3dc;border-radius:6px;"></textarea>
      </div>
      ${actions()}
    </form>
  `, async (formData) => {
    try {
      const newDateVal = formData.get('newDate');
      const reasonVal = formData.get('reason')?.trim();

      if (!newDateVal) throw Error('Selecione a nova data e horário.');
      if (!reasonVal) throw Error('Descreva o motivo da remarcação.');

      const newDateIso = new Date(newDateVal).toISOString();

      await callDemosApi('demo-reschedule', {
        demoId,
        newDate: newDateIso,
        reason: reasonVal
      });

      document.getElementById('modal').close();
      toast('Demonstração reagendada e histórico gravado!');
      await fetchDemos(true);
      render();
    } catch (err) {
      toast(err.message);
    }
  });
}

// Modal: Histórico de Remarcações
function openRescheduleHistoryModal(demoId) {
  const demo = demosData.demos.find(d => d.id === demoId);
  if (!demo) return toast('Demonstração não encontrada.');
  const lead = demosData.leads.find(l => l.id === demo.lead_id) || {};

  const logs = demosData.reschedules.filter(r => r.demonstration_id === demoId);

  const content = logs.length ? `
    <div style="display:flex;flex-direction:column;gap:12px;margin:20px 0;max-height:60vh;overflow-y:auto;">
      ${logs.map((log, idx) => {
        const actor = state.users.find(u => u.id === log.actor_id);
        return `
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-weight:600;font-size:12px;color:#b45309;">Remarcação #${logs.length - idx}</span>
              <span class="small">${formatDemoDateTime(log.created_at)}</span>
            </div>
            <div style="font-size:12px;margin-bottom:4px;">
              De: <strong>${formatDemoDateTime(log.previous_date)}</strong> ➔ Para: <strong>${formatDemoDateTime(log.new_date)}</strong>
            </div>
            <div style="font-size:12px;color:#374151;margin-top:6px;background:white;padding:8px;border-radius:6px;border:1px solid #edf0ed;">
              <em>"${esc(log.reason || 'Sem motivo registrado')}"</em>
            </div>
            ${actor ? `<div class="small" style="margin-top:6px;color:var(--muted);">Registrado por: ${esc(actor.name)}</div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  ` : `<div class="notice">Nenhuma remarcação registrada para esta oportunidade. A data permanece a original (${formatDemoDateTime(demo.first_scheduled_date)}).</div>`;

  show(`
    <h2>Histórico de remarcações</h2>
    <p><strong>${esc(lead.company_name || 'Lead')}</strong> · ${esc(lead.contact_name || '')}</p>
    ${content}
    <div class="actions">
      <button type="button" class="btn" onclick="document.getElementById('modal').close()">Fechar</button>
    </div>
  `, () => {});
}

// Modal: Ficha 360° da Oportunidade e do Lead
function openLead360Modal(demoId) {
  const demo = demosData.demos.find(d => d.id === demoId);
  if (!demo) return toast('Demonstração não encontrada.');
  const lead = demosData.leads.find(l => l.id === demo.lead_id) || {};
  const sdr = state.users.find(u => u.id === demo.sdr_id);
  const closer = state.users.find(u => u.id === demo.closer_id);
  const statusCfg = demoStatusLabels[demo.status] || { label: demo.status, color: '#374151', bg: '#f3f4f6' };

  const rawPhone = String(lead.phone || '').trim();
  const cleanPhone = rawPhone.replace(/\D/g, '');
  const waLink = cleanPhone ? (cleanPhone.startsWith('55') ? `https://wa.me/${cleanPhone}` : `https://wa.me/55${cleanPhone}`) : null;

  const usersList = state.users.filter(u => u.active);
  const sdrOptions = usersList.map(u => `<option value="${esc(u.id)}" ${demo.sdr_id === u.id ? 'selected' : ''}>${esc(u.name)} (${esc(u.role)})</option>`).join('');
  const closerOptions = usersList.map(u => `<option value="${esc(u.id)}" ${demo.closer_id === u.id ? 'selected' : ''}>${esc(u.name)} (${esc(u.role)})</option>`).join('');

  // Histórico de remarcações desta demo
  const reschedules = (demosData.reschedules || []).filter(r => r.demonstration_id === demoId);

  const resHtml = reschedules.length ? `
    <div style="display:flex;flex-direction:column;gap:8px;max-height:180px;overflow-y:auto;margin-top:8px;">
      ${reschedules.map((r, idx) => `
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;font-size:12px;">
          <div style="display:flex;justify-content:space-between;color:#b45309;font-weight:600;margin-bottom:3px;">
            <span>Remarcação #${reschedules.length - idx}</span>
            <span class="small">${formatDemoDateTime(r.created_at)}</span>
          </div>
          <div>De: <strong>${formatDemoDateTime(r.previous_date)}</strong> ➔ Para: <strong>${formatDemoDateTime(r.new_date)}</strong></div>
          ${r.reason ? `<div style="margin-top:4px;color:#4b5563;"><em>"${esc(r.reason)}"</em></div>` : ''}
        </div>
      `).join('')}
    </div>
  ` : `<p class="small" style="color:var(--muted);margin-top:4px;">Nenhuma remarcação registrada. Data permanece a original.</p>`;

  const commission = demosData.commissions.find(c => c.demonstration_id === demoId);

  show(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;gap:12px;">
      <div>
        <span class="eyebrow">${esc(companyName(demo.company_id))}</span>
        <h2 style="font-size:22px;margin:3px 0 6px;">${esc(lead.company_name || 'Lead sem nome')}</h2>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span style="display:inline-block;padding:3px 8px;border-radius:5px;font-size:11px;font-weight:600;color:${statusCfg.color};background:${statusCfg.bg};">${statusCfg.label}</span>
          <span style="font-size:11px;color:var(--muted);">${demo.is_completed ? '✓ Comparecimento confirmado' : '✗ Aguardando comparecimento'}</span>
          ${demo.crm_deal_id ? `<span style="font-size:11px;color:#6b7280;background:#f3f4f6;padding:2px 6px;border-radius:4px;">Deal CRM #${esc(demo.crm_deal_id)}</span>` : ''}
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0;">
      <!-- Bloco 1: Contato e Lead -->
      <section style="background:#fcfdfc;border:1px solid #e2e8e3;border-radius:8px;padding:16px;">
        <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:0 0 10px;">Contato do Lead</h3>
        <p style="margin:4px 0;font-size:14px;font-weight:600;">👤 ${esc(lead.contact_name || 'Não informado')}</p>
        <p style="margin:4px 0;font-size:12px;color:var(--muted);">Segmento: <strong>${esc(lead.segment || 'Geral')}</strong></p>
        <div style="margin:10px 0 6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          ${waLink ? `<a href="${waLink}" target="_blank" rel="noopener" class="btn" style="background:#15803d;padding:6px 12px;font-size:12px;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">💬 WhatsApp ↗</a>` : ''}
          ${rawPhone ? `<a href="tel:${esc(cleanPhone)}" class="btn secondary" style="padding:6px 12px;font-size:12px;text-decoration:none;">📞 ${esc(rawPhone)}</a>` : ''}
        </div>
        ${lead.email ? `<p style="margin:8px 0 0;font-size:12px;">✉️ <a href="mailto:${esc(lead.email)}" style="color:var(--green);">${esc(lead.email)}</a></p>` : ''}
      </section>

      <!-- Bloco 2: Equipe e Transferência -->
      <section style="background:#fcfdfc;border:1px solid #e2e8e3;border-radius:8px;padding:16px;">
        <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:0 0 10px;">Equipe Responsável</h3>
        <form id="assignTeamForm" onsubmit="saveLeadAssignment(event, '${esc(demo.id)}')">
          <div class="field" style="margin-bottom:10px;">
            <label style="font-size:11px;">Closer (Vendedor Responsável)</label>
            <select id="f_assignCloser" style="width:100%;font-size:12px;padding:6px;">
              <option value="">Não atribuído</option>
              ${closerOptions}
            </select>
          </div>
          <div class="field" style="margin-bottom:12px;">
            <label style="font-size:11px;">SDR (Pré-vendas)</label>
            <select id="f_assignSdr" style="width:100%;font-size:12px;padding:6px;">
              <option value="">Não atribuído</option>
              ${sdrOptions}
            </select>
          </div>
          <button type="submit" class="btn secondary" style="padding:6px 12px;font-size:11px;width:100%;">
            Salvar atribuição de equipe
          </button>
        </form>
      </section>
    </div>

    <!-- Bloco 3: Agendamentos e Histórico -->
    <section style="background:#fcfdfc;border:1px solid #e2e8e3;border-radius:8px;padding:16px;margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:0;">Ciclo de Agendamento</h3>
        <span class="small" style="font-weight:600;">Remarcações: ${demo.reschedule_count || 0}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:12px;margin:12px 0;">
        <div style="background:white;border:1px solid #e5e7eb;padding:10px;border-radius:6px;">
          <div class="small" style="color:var(--muted);">1º Agendamento</div>
          <div style="font-weight:600;font-size:12px;">${formatDemoDateTime(demo.first_scheduled_date)}</div>
        </div>
        <div style="background:white;border:1px solid #e5e7eb;padding:10px;border-radius:6px;">
          <div class="small" style="color:var(--muted);">Data Agendada Atual</div>
          <div style="font-weight:600;font-size:12px;color:var(--navy);">${formatDemoDateTime(demo.current_scheduled_date)}</div>
        </div>
        <div style="background:white;border:1px solid #e5e7eb;padding:10px;border-radius:6px;">
          <div class="small" style="color:var(--muted);">Data Realizada (SLA)</div>
          <div style="font-weight:600;font-size:12px;color:${demo.completed_date ? '#15803d' : 'var(--muted)'};">
            ${demo.completed_date ? `${formatDemoDateTime(demo.completed_date)} (${demo.cycle_days || 0}d)` : 'Ainda não realizada'}
          </div>
        </div>
      </div>
      <details style="font-size:12px;margin-top:8px;">
        <summary style="cursor:pointer;color:var(--green);font-weight:600;">Ver histórico detalhado de remarcações (${reschedules.length})</summary>
        ${resHtml}
      </details>
    </section>

    <!-- Bloco 4: Valores e Proposta -->
    <section style="background:#fcfdfc;border:1px solid #e2e8e3;border-radius:8px;padding:16px;margin-bottom:16px;">
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:0 0 10px;">Valores & Proposta</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div style="background:white;border:1px solid #e5e7eb;padding:10px;border-radius:6px;">
          <div class="small" style="color:var(--muted);">Mensalidade / MRR</div>
          <div style="font-weight:700;font-size:16px;">${money(demo.deal_value_mrr || 0)}</div>
        </div>
        <div style="background:white;border:1px solid #e5e7eb;padding:10px;border-radius:6px;">
          <div class="small" style="color:var(--muted);">Implementação / Setup</div>
          <div style="font-weight:700;font-size:16px;">${money(demo.deal_value_setup || 0)}</div>
        </div>
      </div>
      ${commission ? `
        <div class="notice" style="margin:12px 0 0;">
          <strong>Venda Fechada & Comissão Apurada:</strong><br>
          Closer: ${money(commission.closer_commission_amount || 0)} · SDR: ${money(commission.sdr_commission_amount || 0)} · Status pagamento: <strong>${commission.status_payment || 'pendente'}</strong>
        </div>
      ` : ''}
    </section>

    <!-- Rodapé de Ações Rápidas -->
    <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:16px;margin-top:16px;flex-wrap:wrap;gap:8px;">
      <div style="display:flex;gap:8px;align-items:center;">
        <button type="button" class="btn secondary" onclick="document.getElementById('modal').close();openRescheduleModal('${esc(demo.id)}')">
          🗓️ Reagendar
        </button>
        ${demo.status !== 'fechado' ? `
          <button type="button" class="btn" onclick="document.getElementById('modal').close();openCloseSaleModal('${esc(demo.id)}')" style="background:#16a34a;">
            👍 Fechar Venda (Ganho)
          </button>
        ` : ''}
        ${demo.status !== 'perdido' && demo.status !== 'fechado' ? `
          <button type="button" class="btn secondary" onclick="document.getElementById('modal').close();openLossModal('${esc(demo.id)}')" style="color:#dc2626;border-color:#fca5a5;">
            👎 Perdido
          </button>
        ` : ''}
      </div>
      <button type="button" class="btn secondary" onclick="document.getElementById('modal').close()">
        Fechar
      </button>
    </div>
  `);
}

async function saveLeadAssignment(e, demoId) {
  e.preventDefault();
  const closerId = document.getElementById('f_assignCloser').value || null;
  const sdrId = document.getElementById('f_assignSdr').value || null;

  try {
    await callDemosApi('demo-assign', { demoId, closerId, sdrId });
    toast('Equipe comercial da oportunidade atualizada com sucesso!');
    await fetchDemos(true);
    openLead360Modal(demoId);
  } catch (err) {
    toast(err.message);
  }
}

// Recalcular comissões com base nas regras do time e produto selecionado
function recalculateCloseSaleCommissions(demoId) {
  const demo = demosData.demos.find(d => d.id === demoId);
  const prodId = document.getElementById('f_closeProduct')?.value;
  const prod = state.products.find(p => p.id === prodId);
  const mrr = Number(document.getElementById('f_closeMrr')?.value || 0);
  const setup = Number(document.getElementById('f_closeSetup')?.value || 0);

  let closerFirstPct = 30;
  let closerSetupPct = 20;
  let sdrPct = 10;
  let ruleSource = 'Regra comercial padrão';

  if (prod) {
    // 1. Tenta buscar regra no time comercial
    const teamRuleCloser = (teamsData?.rules || []).find(r => r.product_id === prod.id && r.role_target === 'closer');
    const teamRuleSdr = (teamsData?.rules || []).find(r => r.product_id === prod.id && r.role_target === 'sdr');

    if (teamRuleCloser) {
      closerFirstPct = Number(teamRuleCloser.first_fee_percent || 0);
      closerSetupPct = Number(teamRuleCloser.setup_percent || 0);
      ruleSource = 'Regras da Equipe Comercial';
    } else if (prod.rules) {
      closerFirstPct = Number(prod.rules.first || 0);
      closerSetupPct = Number(prod.rules.setup || 0);
      ruleSource = 'Regras do Catálogo do Produto';
    }

    if (teamRuleSdr) {
      sdrPct = Number(teamRuleSdr.first_fee_percent || 0);
    }
  }

  const sdrComm = Math.round(mrr * (sdrPct / 100) * 100) / 100;
  const closerComm = Math.round(((mrr * (closerFirstPct / 100)) + (setup * (closerSetupPct / 100))) * 100) / 100;

  const sdrEl = document.getElementById('f_closeSdrCommission');
  const closerEl = document.getElementById('f_closeCloserCommission');
  const hintEl = document.getElementById('closeCommissionHint');

  if (sdrEl && !sdrEl.dataset.userEdited) sdrEl.value = sdrComm;
  if (closerEl && !closerEl.dataset.userEdited) closerEl.value = closerComm;
  if (hintEl) {
    hintEl.innerHTML = `💡 <em>${ruleSource}:</em> Closer (${closerFirstPct}% 1º fee + ${closerSetupPct}% setup) = <strong>${money(closerComm)}</strong> | SDR (${sdrPct}%) = <strong>${money(sdrComm)}</strong>`;
  }
}

// Modal: Fechar Venda (Ganho 👍) com Cálculo de Regras & Geração de Contrato 1-Click
function openCloseSaleModal(demoId) {
  const demo = demosData.demos.find(d => d.id === demoId);
  if (!demo) return toast('Demonstração não encontrada.');
  const lead = demosData.leads.find(l => l.id === demo.lead_id) || {};
  const sdr = state.users.find(u => u.id === demo.sdr_id);
  const closer = state.users.find(u => u.id === demo.closer_id);

  // Produtos ativos disponíveis para a empresa
  const availableProducts = state.products.filter(p => !p.archived && (company === 'all' || p.company === demo.company_id || canAccess(p.company)));
  const defaultProduct = availableProducts.find(p => p.id === demo.product_id) || availableProducts[0];

  const mrrVal = Number(demo.deal_value_mrr || defaultProduct?.baseMonthly || 0);
  const setupVal = Number(demo.deal_value_setup || defaultProduct?.baseSetup || 0);

  // Garante que teamsData esteja carregado
  if (typeof fetchTeams === 'function' && (!teamsData || !teamsData.loaded)) {
    fetchTeams();
  }

  const productOptions = availableProducts.map(p => `
    <option value="${esc(p.id)}" ${defaultProduct?.id === p.id ? 'selected' : ''}>
      ${esc(p.name)} · ${esc(companyName(p.company))} (Base: ${money(p.baseMonthly || 0)})
    </option>
  `).join('');

  show(`
    <h2>Fechar venda (Negócio Ganho 👍)</h2>
    <p>Confirme as condições comerciais, apure as comissões e gere o contrato oficial da venda.</p>
    
    <div class="notice">
      Empresa: <strong>${esc(lead.company_name || 'Lead')}</strong> (${esc(companyName(demo.company_id))})<br>
      Contato: <strong>${esc(lead.contact_name || 'Não informado')}</strong> · 
      Closer: <strong>${esc(closer ? closer.name : 'Não atribuído')}</strong> · 
      SDR: <strong>${esc(sdr ? sdr.name : 'Não atribuído')}</strong>
    </div>

    <form id="closeSaleForm">
      <div class="field" style="margin-top:14px;">
        <label style="font-weight:600;font-size:12px;">Produto Contratado</label>
        <select id="f_closeProduct" name="closeProduct" onchange="recalculateCloseSaleCommissions('${esc(demoId)}')" style="width:100%;padding:10px;font-weight:600;">
          ${productOptions || '<option value="">Nenhum produto cadastrado</option>'}
        </select>
      </div>

      <div class="formgrid" style="margin-top:14px;">
        ${field('closeMrr', 'Valor Mensalidade / MRR (R$)', mrrVal, 'number', `required min="0" step=".01" oninput="recalculateCloseSaleCommissions('${esc(demoId)}')"`)}
        ${field('closeSetup', 'Valor Implementação / Setup (R$)', setupVal, 'number', `required min="0" step=".01" oninput="recalculateCloseSaleCommissions('${esc(demoId)}')"`)}
      </div>

      <div class="formgrid" style="margin-top:10px;">
        ${field('closeCloserCommission', `Comissão Closer (${closer ? closer.name : 'Vendedor'}) (R$)`, 0, 'number', `min="0" step=".01" onchange="this.dataset.userEdited=true"`)}
        ${field('closeSdrCommission', `Comissão SDR (${sdr ? sdr.name : 'Pré-vendas'}) (R$)`, 0, 'number', `min="0" step=".01" onchange="this.dataset.userEdited=true"`)}
      </div>
      <div id="closeCommissionHint" style="font-size:11px;color:#15803d;margin-top:4px;padding:6px 10px;background:#f0fdf4;border-radius:6px;border:1px solid #bbf7d0;"></div>

      <!-- Seção 1-Click: Criar Contrato Oficial no Comissions -->
      <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:14px;margin:18px 0 8px;">
        <label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;color:var(--navy);cursor:pointer;">
          <input type="checkbox" id="f_createContract" name="createContract" checked onchange="document.getElementById('contractOptionsSection').style.display=this.checked?'block':'none'">
          ☑ Gerar Contrato Oficial no módulo Contratos e lançar parcelas no Financeiro
        </label>
        <div id="contractOptionsSection" style="margin-top:12px;padding-top:12px;border-top:1px solid #e2e8f0;">
          <div class="formgrid">
            <div class="field">
              <label style="font-size:11px;">Dia de Vencimento da Mensalidade</label>
              <select id="f_billingDay" name="billingDay" style="width:100%;padding:8px;">
                <option value="5">Todo dia 05</option>
                <option value="10" selected>Todo dia 10</option>
                <option value="15">Todo dia 15</option>
                <option value="20">Todo dia 20</option>
                <option value="25">Todo dia 25</option>
              </select>
            </div>
            <div class="field">
              <label style="font-size:11px;">Parcelamento da Implementação / Setup</label>
              <select id="f_setupParts" name="setupParts" style="width:100%;padding:8px;">
                <option value="1">À vista (1x)</option>
                <option value="2">2 parcelas mensais</option>
                <option value="3">3 parcelas mensais</option>
                <option value="4">4 parcelas mensais</option>
                <option value="6">6 parcelas mensais</option>
              </select>
            </div>
            <div class="field">
              <label style="font-size:11px;">Forma de Pagamento</label>
              <select id="f_paymentMethod" name="paymentMethod" style="width:100%;padding:8px;">
                <option value="Boleto bancário">Boleto bancário</option>
                <option value="Pix">Pix</option>
                <option value="Cartão de crédito">Cartão de crédito</option>
                <option value="Transferência bancária">Transferência bancária</option>
              </select>
            </div>
            <div class="field">
              <label style="font-size:11px;">Data de Início do Contrato</label>
              <input type="date" id="f_contractStart" name="contractStart" value="${localToday()}" style="width:100%;padding:8px;">
            </div>
          </div>
          <div class="field" style="margin-top:10px;">
            <label style="font-size:11px;">Link da Reunião / Proposta Assinada (opcional)</label>
            <input type="url" id="f_proposalUrl" name="proposalUrl" placeholder="https://meet.google.com/... ou link do drive" style="width:100%;padding:8px;">
          </div>
        </div>
      </div>

      <p class="small" style="margin-top:12px;">Ao confirmar, a demonstração será marcada como <strong>Fechada</strong>, comparecimento confirmado, a comissão entra no painel e o contrato oficial é criado.</p>
      ${actions()}
    </form>
  `, async (formData) => {
    try {
      const mrr = Number(formData.get('closeMrr') || 0);
      const setup = Number(formData.get('closeSetup') || 0);
      const sdrCommission = Number(formData.get('closeSdrCommission') || 0);
      const closerCommission = Number(formData.get('closeCloserCommission') || 0);

      let createdContractId = null;

      // 1-Click: Geração do Contrato Oficial no Comissions
      if (formData.get('createContract')) {
        const prodId = formData.get('closeProduct');
        const prod = state.products.find(p => p.id === prodId) || availableProducts[0];
        const billingDay = Number(formData.get('billingDay') || 10);
        const setupParts = Number(formData.get('setupParts') || 1);
        const startDate = formData.get('contractStart') || localToday();
        const year = startDate.slice(0, 4);

        // Gera código CTR-YYYY-NNNN
        const usedCodes = new Set((state.contracts || []).map(c => c.code));
        let seq = 1;
        while (usedCodes.has(`CTR-${year}-${String(seq).padStart(4, '0')}`)) seq++;
        const code = `CTR-${year}-${String(seq).padStart(4, '0')}`;

        const contractId = Date.now() * 1000 + (state.contracts || []).length;
        const saleId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'sale-' + Date.now();

        const firstDue = `${year}-${startDate.slice(5, 7)}-${String(billingDay).padStart(2, '0')}`;
        const finalFirstDue = firstDue < startDate ? termsMonth(firstDue, 1) : firstDue;
        const nextFeeDue = termsMonth(finalFirstDue, 1);

        const newContract = {
          id: contractId,
          code,
          saleId,
          company: demo.company_id,
          client: lead.company_name || 'Cliente Fechado',
          product: prod ? prod.id : 'product-default',
          plan: prod ? prod.name : 'Plano Comercial',
          monthly: mrr,
          setup: setup,
          seller: demo.closer_id || currentUser,
          dev: '',
          partner: '',
          start: startDate,
          firstDue: finalFirstDue,
          nextFeeDue: nextFeeDue,
          billingDay: billingDay,
          status: 'Ativo',
          reviewStatus: 'approved',
          billingMode: 'ongoing',
          billingMonths: null,
          cycles: 12,
          setupParts: setupParts,
          fee: 1,
          paid: false,
          started: true,
          accepted: true,
          schedule: true,
          version: prod?.version || 1,
          rules: prod?.rules ? { ...prod.rules } : { first: 30, next: 10, setup: 20, devFirst: 0, devSetup: 0, partner: 0, months: 6 }
        };

        state.contracts.push(newContract);

        // Gera as faturas recorrentes
        for (let j = 0; j < 12; j++) {
          state.invoices.push({
            id: typeof uid === 'function' ? uid('inv') : 'inv-' + Math.random().toString(36).slice(2, 9),
            company: demo.company_id,
            contractId: contractId,
            kind: 'fee',
            fee: j + 1,
            amount: mrr,
            due: feeDueDate(newContract, j + 1),
            paidAt: null
          });
        }

        // Gera as faturas de setup se houver
        if (setup > 0) {
          const totalCents = Math.round(setup * 100);
          const partCents = Math.floor(totalCents / setupParts);
          for (let j = 0; j < setupParts; j++) {
            state.invoices.push({
              id: typeof uid === 'function' ? uid('inv') : 'inv-' + Math.random().toString(36).slice(2, 9),
              company: demo.company_id,
              contractId: contractId,
              kind: 'setup',
              part: j + 1,
              fee: 0,
              amount: (partCents + (j === setupParts - 1 ? totalCents - partCents * setupParts : 0)) / 100,
              due: termsMonth(finalFirstDue, j),
              paidAt: null
            });
          }
        }

        createdContractId = contractId;
        await save();
      }

      await callDemosApi('demo-close-sale', {
        demoId,
        mrr,
        setup,
        sdrCommission,
        closerCommission,
        contractId: createdContractId
      });

      document.getElementById('modal').close();
      toast(createdContractId ? '🎉 Venda fechada! Contrato oficial gerado e faturas lançadas no Financeiro.' : 'Venda fechada com sucesso! Comissão registrada.');
      await fetchDemos(true);
      render();
    } catch (err) {
      toast(err.message);
    }
  });

  // Executa o cálculo inicial das comissões
  setTimeout(() => recalculateCloseSaleCommissions(demoId), 60);
}

// Modal: Registrar Perda (Deal Lost)
function openLossModal(demoId) {
  const demo = demosData.demos.find(d => d.id === demoId);
  if (!demo) return toast('Demonstração não encontrada.');
  const lead = demosData.leads.find(l => l.id === demo.lead_id) || {};

  show(`
    <h2>Marcar oportunidade como perdida</h2>
    <p><strong>${esc(lead.company_name || 'Lead')}</strong> · ${esc(lead.contact_name || '')}</p>
    <form id="lossForm">
      <div class="field" style="margin:16px 0;">
        <label>Motivo da perda / descarte</label>
        <select name="lossReasonCategory" style="width:100%;padding:10px;margin-bottom:10px;">
          <option value="Sem budget / Preço alto">Sem budget / Preço alto</option>
          <option value="Optou por concorrente">Optou por concorrente</option>
          <option value="Não tem fit com o produto">Não tem fit com o produto</option>
          <option value="Projeto adiado / Timing incorreto">Projeto adiado / Timing incorreto</option>
          <option value="No-show recorrente / Sem contato">No-show recorrente / Sem contato</option>
          <option value="Outro">Outro motivo</option>
        </select>
        <textarea name="lossNotes" rows="3" placeholder="Detalhes adicionais sobre o descarte..." style="width:100%;padding:10px;border:1px solid #dbe3dc;border-radius:6px;"></textarea>
      </div>
      ${actions()}
    </form>
  `, async (formData) => {
    try {
      const category = formData.get('lossReasonCategory');
      const notes = formData.get('lossNotes')?.trim();
      const lossReason = notes ? `${category}: ${notes}` : category;

      await callDemosApi('demo-status-update', {
        demoId,
        status: 'perdido',
        isCompleted: false,
        lossReason
      });

      document.getElementById('modal').close();
      toast('Oportunidade marcada como perdida.');
      await fetchDemos(true);
      render();
    } catch (err) {
      toast(err.message);
    }
  });
}


function openArchiveDemo(id) {
  const demo = demosData.demos.find(d => d.id === id);
  if (!demo || !canManage()) return;
  const lead = demosData.leads.find(l => l.id === demo.lead_id);
  show(`<h2>Excluir agendamento</h2><p>Remover o agendamento de <strong>${esc(lead?.company_name || 'Lead')}</strong> da lista? O cadastro do lead e o histórico serão preservados.</p><form>${actions().replace('Salvar','Excluir agendamento')}</form>`, async () => {
    await callDemosApi('demo-archive', {demoId:id});
    document.getElementById('modal').close();
    await fetchDemos(true);
    render();
    toast('Agendamento excluído.');
  });
}
