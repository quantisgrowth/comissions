// Commercial Teams and Product Commission Rules Controller
// Manages commercial teams, member roles, authorized products, and custom commission rules.

let teamsData = { teams: [], members: [], teamProducts: [], rules: [], loaded: false };
let productsActiveTab = 'catalog'; // 'catalog' | 'teams'

const commercialRoleLabels = {
  closer: 'Vendedor (Closer)',
  sdr: 'SDR (Pré-vendas)',
  leader: 'Líder / Coordenador',
  bdr: 'BDR (Outbound)',
  account_manager: 'Gerente de Contas'
};

async function callTeamsApi(action, extra = {}) {
  // 1. Tenta a Edge Function comissions-api
  try {
    const res = await api(action, extra);
    if (res && !res.error) return res;
    if (res && res.error && res.error !== 'Ação inválida.') throw Error(res.error);
  } catch (err) {
    if (err.message && !err.message.includes('Ação inválida.')) throw err;
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

  if (action === 'teams-list') {
    try {
      const [teamsRes, membersRes, productsRes, rulesRes] = await Promise.all([
        fetch(CLOUD_URL + '/rest/v1/cm_teams?order=name.asc', { headers }).then(r => r.ok ? r.json() : []),
        fetch(CLOUD_URL + '/rest/v1/cm_team_members?active=eq.true', { headers }).then(r => r.ok ? r.json() : []),
        fetch(CLOUD_URL + '/rest/v1/cm_team_products', { headers }).then(r => r.ok ? r.json() : []),
        fetch(CLOUD_URL + '/rest/v1/cm_commission_rules', { headers }).then(r => r.ok ? r.json() : [])
      ]);
      return {
        teams: Array.isArray(teamsRes) ? teamsRes : [],
        members: Array.isArray(membersRes) ? membersRes : [],
        teamProducts: Array.isArray(productsRes) ? productsRes : [],
        rules: Array.isArray(rulesRes) ? rulesRes : []
      };
    } catch {
      return { teams: [], members: [], teamProducts: [], rules: [] };
    }
  }

  if (action === 'team-save') {
    const t = extra.team || {};
    const name = String(t.name || '').trim();
    const companyId = String(t.company_id || '').trim();
    if (name.length < 2 || name.length > 100) throw Error('Nome do time deve ter entre 2 e 100 caracteres.');
    if (!companyId) throw Error('Selecione a empresa vinculada ao time.');

    const body = {
      tenant_id: tenantId,
      company_id: companyId,
      name,
      active: t.active !== false
    };

    if (t.id) {
      const res = await fetch(CLOUD_URL + '/rest/v1/cm_teams?id=eq.' + encodeURIComponent(t.id), {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.message || data.hint || 'Erro ao atualizar time comercial.');
      return { saved: true, team: data[0] };
    } else {
      const res = await fetch(CLOUD_URL + '/rest/v1/cm_teams', {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.message || data.hint || 'Erro ao criar time comercial no Supabase.');
      return { saved: true, team: data[0] };
    }
  }

  if (action === 'team-member-add') {
    const { teamId, profileId, role } = extra;
    const body = {
      tenant_id: tenantId,
      team_id: teamId,
      profile_id: profileId,
      commercial_role: role || 'closer',
      active: true
    };
    const res = await fetch(CLOUD_URL + '/rest/v1/cm_team_members', {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw Error(data.message || 'Erro ao adicionar membro ao time.');
    return { saved: true, member: data[0] };
  }

  if (action === 'team-member-remove') {
    const { teamId, profileId } = extra;
    const res = await fetch(CLOUD_URL + '/rest/v1/cm_team_members?team_id=eq.' + encodeURIComponent(teamId) + '&profile_id=eq.' + encodeURIComponent(profileId), {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ active: false })
    });
    if (!res.ok) {
      const data = await res.json();
      throw Error(data.message || 'Erro ao remover membro do time.');
    }
    return { removed: true };
  }

  if (action === 'team-products-set') {
    const { teamId, productIds } = extra;
    await fetch(CLOUD_URL + '/rest/v1/cm_team_products?team_id=eq.' + encodeURIComponent(teamId), {
      method: 'DELETE',
      headers
    });
    if (productIds && productIds.length > 0) {
      const items = productIds.map(pid => ({
        tenant_id: tenantId,
        team_id: teamId,
        product_id: pid
      }));
      const res = await fetch(CLOUD_URL + '/rest/v1/cm_team_products', {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(items)
      });
      if (!res.ok) {
        const data = await res.json();
        throw Error(data.message || 'Erro ao vincular produtos ao time.');
      }
    }
    return { updated: true };
  }

  if (action === 'commission-rule-save') {
    const r = extra.rule || {};
    const body = {
      tenant_id: tenantId,
      product_id: r.product_id,
      team_id: r.team_id || null,
      role_target: r.role_target || 'closer',
      first_fee_percent: Number(r.first_fee_percent || 0),
      next_fee_percent: Number(r.next_fee_percent || 0),
      setup_percent: Number(r.setup_percent || 0),
      months: Number(r.months || 6)
    };
    if (r.id) {
      const res = await fetch(CLOUD_URL + '/rest/v1/cm_commission_rules?id=eq.' + encodeURIComponent(r.id), {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.message || 'Erro ao salvar regra de comissão.');
      return { saved: true, rule: data[0] };
    } else {
      const res = await fetch(CLOUD_URL + '/rest/v1/cm_commission_rules', {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.message || 'Erro ao salvar regra de comissão.');
      return { saved: true, rule: data[0] };
    }
  }

  if (action === 'commission-rule-delete') {
    const { ruleId } = extra;
    const res = await fetch(CLOUD_URL + '/rest/v1/cm_commission_rules?id=eq.' + encodeURIComponent(ruleId), {
      method: 'DELETE',
      headers
    });
    if (!res.ok) {
      const data = await res.json();
      throw Error(data.message || 'Erro ao remover regra de comissão.');
    }
    return { removed: true };
  }

  throw Error('Ação inválida.');
}

async function fetchTeams(force = false) {
  if (teamsData.loaded && !force) return teamsData;
  try {
    const res = await callTeamsApi('teams-list');
    teamsData = {
      teams: res.teams || [],
      members: res.members || [],
      teamProducts: res.teamProducts || [],
      rules: res.rules || [],
      loaded: true
    };
  } catch (err) {
    console.warn('Times comerciais não puderam ser carregados:', err.message);
    teamsData = { teams: [], members: [], teamProducts: [], rules: [], loaded: false };
  }
  return teamsData;
}

function switchProductsTab(tab) {
  productsActiveTab = tab;
  render();
}

function getSellerTeams(companyId, sellerId) {
  const myTeamIds = new Set(
    teamsData.members
      .filter(m => m.profile_id === sellerId && m.active)
      .map(m => m.team_id)
  );
  return teamsData.teams.filter(t => 
    t.active && 
    myTeamIds.has(t.id) && 
    (companyId === 'all' || t.company_id === companyId)
  );
}

function getSellerAuthorizedProducts(companyId, sellerId) {
  const allCompanyProducts = state.products.filter(p => !p.archived && (companyId === 'all' || p.company === companyId));
  if (canManage()) return allCompanyProducts;

  const sellerTeams = getSellerTeams(companyId, sellerId);
  if (!sellerTeams.length) return allCompanyProducts; // Sem time definido: vê todos os da empresa

  const teamIds = new Set(sellerTeams.map(t => t.id));
  const assignedProductIds = new Set(
    teamsData.teamProducts
      .filter(tp => teamIds.has(tp.team_id))
      .map(tp => tp.product_id)
  );

  // Se os times têm produtos atribuídos, restringe a eles
  if (assignedProductIds.size > 0) {
    return allCompanyProducts.filter(p => assignedProductIds.has(p.id));
  }
  return allCompanyProducts;
}

function getCustomProductRule(productId, sellerId, companyId) {
  const sellerTeams = getSellerTeams(companyId, sellerId);
  if (!sellerTeams.length) return null;

  const teamIds = new Set(sellerTeams.map(t => t.id));
  const myMemberships = teamsData.members.filter(m => m.profile_id === sellerId && m.active && teamIds.has(m.team_id));

  for (const mem of myMemberships) {
    const match = teamsData.rules.find(r => 
      r.product_id === productId && 
      r.team_id === mem.team_id && 
      (r.role_target === mem.commercial_role || r.role_target === 'closer')
    );
    if (match) {
      return {
        first: Number(match.first_fee_percent || 0),
        next: Number(match.next_fee_percent || 0),
        setup: Number(match.setup_percent || 0),
        months: Number(match.months || 6),
        devFirst: 0,
        devSetup: 0,
        partner: 0
      };
    }
  }
  return null;
}

function renderTeamsTab() {
  const filteredTeams = teamsData.teams.filter(t => t.active && (company === 'all' || t.company_id === company));
  
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin: 18px 0 24px;">
      <div>
        <h2>Times Comerciais por Empresa e Produto</h2>
        <p class="small">Cada time comercial pode ter vendedores específicos, catálogo restrito de produtos e regras de comissão exclusivas.</p>
      </div>
      ${btn('+ Novo time comercial', 'openTeamModal()')}
    </div>

    ${!filteredTeams.length ? empty('Nenhum time comercial cadastrado', 'Crie equipes comerciais para restringir produtos e personalizar percentuais de comissão.') : ''}

    <div style="display:grid; gap:20px;">
      ${filteredTeams.map(t => renderTeamCard(t)).join('')}
    </div>
  `;
}

function renderTeamCard(team) {
  const teamMembers = teamsData.members.filter(m => m.team_id === team.id && m.active);
  const teamProductIds = new Set(teamsData.teamProducts.filter(tp => tp.team_id === team.id).map(tp => tp.product_id));
  const assignedProducts = state.products.filter(p => teamProductIds.has(p.id) && !p.archived);
  const teamRules = teamsData.rules.filter(r => r.team_id === team.id);

  return `
    <section class="panel" style="border-left: 4px solid var(--green);">
      <div class="panelhead">
        <div>
          <span class="pill">${esc(companyName(team.company_id))}</span>
          <h2 style="margin:6px 0 2px 0;">${esc(team.name)}</h2>
          <span class="small">${teamMembers.length} membro(s) · ${assignedProducts.length} produto(s) autorizados</span>
        </div>
        <div class="catalog-actions">
          ${btn('Editar time', `openTeamModal('${team.id}')`, true)}
        </div>
      </div>

      <!-- Membros do Time -->
      <div style="margin: 16px 0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong>Membros do Time</strong>
          ${btn('+ Adicionar membro', `openTeamMemberModal('${team.id}')`, true)}
        </div>
        ${!teamMembers.length ? '<p class="small">Nenhum membro vinculado a este time comercial.</p>' : `
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            ${teamMembers.map(m => `
              <div style="background:#eef4f0; border:1px solid var(--line); border-radius:6px; padding:6px 12px; font-size:12px; display:flex; align-items:center; gap:8px;">
                <span><strong>${esc(userName(m.profile_id))}</strong> (${esc(commercialRoleLabels[m.commercial_role] || m.commercial_role)})</span>
                <button type="button" style="border:0; background:none; cursor:pointer; color:var(--muted); font-size:14px;" title="Remover membro" onclick="removeTeamMember('${team.id}', '${m.profile_id}')">×</button>
              </div>
            `).join('')}
          </div>
        `}
      </div>

      <!-- Produtos Autorizados -->
      <div style="margin: 16px 0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong>Produtos que este time pode vender</strong>
          ${btn('⚙ Vincular produtos', `openTeamProductsModal('${team.id}', '${team.company_id}')`, true)}
        </div>
        ${!assignedProducts.length ? '<p class="small">Todos os produtos da empresa liberados (nenhuma restrição).</p>' : `
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            ${assignedProducts.map(p => `
              <span class="pill" style="background:#e8f4ed; color:#247653;">
                ${esc(p.name)} · ${esc(p.type)} (${money(p.baseMonthly || 0)})
              </span>
            `).join('')}
          </div>
        `}
      </div>

      <!-- Regras Específicas de Comissão -->
      <div style="margin: 16px 0;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px; gap:16px;">
          <div>
            <strong>Regras de Comissão dos Produtos neste Time</strong>
            <p class="small" style="margin:3px 0 0 0;">As regras cadastradas em cada produto são herdadas automaticamente. Você pode personalizar percentuais exclusivos para este time comercial quando necessário.</p>
          </div>
          ${(assignedProducts.length || state.products.some(p => p.company === team.company_id && !p.archived)) ? btn('+ Personalizar regra', `openTeamRuleModal('${team.id}', '${team.company_id}')`, true) : ''}
        </div>
        
        <table style="margin-top:8px;">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Origem da Regra</th>
              <th>Papel</th>
              <th>1º Fee</th>
              <th>Próximos Fees</th>
              <th>Implementação</th>
              <th>Duração</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${(assignedProducts.length ? assignedProducts : state.products.filter(p => p.company === team.company_id && !p.archived)).map(p => {
              const customRule = teamRules.find(r => r.product_id === p.id);
              const isCustom = !!customRule;
              const r = isCustom ? customRule : {
                first_fee_percent: p.rules?.first ?? 0,
                next_fee_percent: p.rules?.next ?? 0,
                setup_percent: p.rules?.setup ?? 0,
                months: p.rules?.months ?? 6,
                role_target: 'closer'
              };
              return `
                <tr>
                  <td><strong>${esc(p.name)}</strong><div class="small">${esc(p.type)} · ${money(p.baseMonthly || 0)}</div></td>
                  <td>
                    ${isCustom 
                      ? `<span class="pill" style="background:#e0f2fe; color:#0369a1; font-weight:600;">Exclusiva do time</span>` 
                      : `<span class="pill" style="background:#f3f4f6; color:#4b5563;">Padrão do produto</span>`}
                  </td>
                  <td>${esc(commercialRoleLabels[r.role_target] || r.role_target || 'Vendedor (Closer)')}</td>
                  <td><strong>${r.first_fee_percent}%</strong></td>
                  <td>${r.next_fee_percent}%</td>
                  <td>${r.setup_percent}%</td>
                  <td>${r.months} meses</td>
                  <td>
                    <div class="catalog-actions">
                      ${isCustom 
                        ? `${btn('Editar', `openTeamRuleModal('${team.id}', '${team.company_id}', '${customRule.id}')`, true)}
                           ${btn('Restaurar padrão', `removeTeamRule('${customRule.id}')`, true)}`
                        : btn('Personalizar', `openTeamRuleModal('${team.id}', '${team.company_id}', null, '${p.id}')`, true)
                      }
                    </div>
                  </td>
                </tr>
              `;
            }).join('') || '<tr><td colspan="8" class="small">Nenhum produto cadastrado nesta empresa.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function openTeamModal(id = null) {
  const t = teamsData.teams.find(x => x.id === id) || { name: '', company_id: company === 'all' ? allowed()[0]?.id : company, active: true };
  show(`
    <h2>${id ? 'Editar Time Comercial' : 'Novo Time Comercial'}</h2>
    <p class="small">Times agrupam vendedores para direcionar produtos e regras de comissão.</p>
    <form>
      <div class="formgrid">
        ${field('name', 'Nome do Time', t.name, 'text', 'required placeholder="Ex.: Time Outbound Enterprise"')}
        ${select('company_id', 'Empresa', allowed().map(c => [c.id, c.name]), t.company_id)}
      </div>
      ${actions()}
    </form>
  `, async f => {
    const payload = {
      id,
      name: f.get('name'),
      company_id: f.get('company_id'),
      active: true
    };
    await callTeamsApi('team-save', { team: payload });
    await fetchTeams(true);
    document.getElementById('modal').close();
    render();
    toast('Time comercial salvo com sucesso.');
  });
}

function openTeamMemberModal(teamId) {
  const team = teamsData.teams.find(t => t.id === teamId);
  const existingMemberIds = new Set(teamsData.members.filter(m => m.team_id === teamId && m.active).map(m => m.profile_id));
  const availableUsers = state.users.filter(u => u.active && !existingMemberIds.has(u.id) && (u.all || u.companies.includes(team.company_id)));

  if (!availableUsers.length) {
    return toast('Não há usuários ativos disponíveis nesta empresa para adicionar ao time.');
  }

  show(`
    <h2>Adicionar Membro ao Time</h2>
    <p class="small">Time: <strong>${esc(team?.name)}</strong></p>
    <form>
      <div class="formgrid">
        ${select('profileId', 'Colaborador / Vendedor', availableUsers.map(u => [u.id, u.name + ' (' + u.role + ')']), availableUsers[0]?.id)}
        ${select('role', 'Papel no Time Comercial', Object.entries(commercialRoleLabels).map(([k, v]) => [k, v]), 'closer')}
      </div>
      ${actions()}
    </form>
  `, async f => {
    await callTeamsApi('team-member-add', {
      teamId,
      profileId: f.get('profileId'),
      role: f.get('role')
    });
    await fetchTeams(true);
    document.getElementById('modal').close();
    render();
    toast('Membro adicionado ao time comercial.');
  });
}

async function removeTeamMember(teamId, profileId) {
  try {
    await callTeamsApi('team-member-remove', { teamId, profileId });
    await fetchTeams(true);
    render();
    toast('Membro removido do time comercial.');
  } catch (err) {
    toast(err.message || 'Erro ao remover membro.');
  }
}

function openTeamProductsModal(teamId, companyId) {
  const team = teamsData.teams.find(t => t.id === teamId);
  const companyProducts = state.products.filter(p => p.company === companyId && !p.archived);
  const currentAssigned = new Set(teamsData.teamProducts.filter(tp => tp.team_id === teamId).map(tp => tp.product_id));

  show(`
    <h2>Produtos Autorizados para o Time</h2>
    <p class="small">Time: <strong>${esc(team?.name)}</strong>. Marque os produtos que este time pode comercializar.</p>
    <form>
      <div class="checks" style="max-height:300px; overflow:auto; margin:16px 0;">
        ${companyProducts.map(p => `
          <label style="width:100%; display:flex; align-items:center; gap:8px;">
            <input type="checkbox" name="productIds" value="${esc(p.id)}" ${currentAssigned.has(p.id) ? 'checked' : ''}>
            <span><strong>${esc(p.name)}</strong> · ${esc(p.type)} (${money(p.baseMonthly || 0)})</span>
          </label>
        `).join('')}
      </div>
      <p class="small">Se nenhum produto for marcado, o time poderá vender todos os produtos da empresa.</p>
      ${actions()}
    </form>
  `, async f => {
    const selectedIds = f.getAll('productIds');
    await callTeamsApi('team-products-set', { teamId, productIds: selectedIds });
    await fetchTeams(true);
    document.getElementById('modal').close();
    render();
    toast('Catálogo do time comercial atualizado.');
  });
}

function openTeamRuleModal(teamId, companyId, ruleId = null, targetProductId = null) {
  const team = teamsData.teams.find(t => t.id === teamId);
  const teamProductIds = new Set(teamsData.teamProducts.filter(tp => tp.team_id === teamId).map(tp => tp.product_id));
  const availableProducts = state.products.filter(p => (!teamProductIds.size || teamProductIds.has(p.id)) && p.company === companyId && !p.archived);
  
  const existingRule = teamsData.rules.find(r => r.id === ruleId);
  const defaultProdId = existingRule?.product_id || targetProductId || availableProducts[0]?.id || '';
  const prod = product(defaultProdId);
  const prodRules = prod?.rules || zeroRules;

  const currentRule = existingRule || {
    product_id: defaultProdId,
    role_target: 'closer',
    first_fee_percent: prodRules.first ?? 0,
    next_fee_percent: prodRules.next ?? 0,
    setup_percent: prodRules.setup ?? 0,
    months: prodRules.months ?? 6
  };

  show(`
    <h2>${ruleId ? 'Editar Regra Exclusiva do Time' : 'Personalizar Regra de Comissão do Time'}</h2>
    <p class="small">Time: <strong>${esc(team?.name)}</strong>. Os campos vêm pré-preenchidos com a regra do produto selecionado.</p>
    <form>
      <div class="formgrid">
        ${select('product_id', 'Produto', availableProducts.map(p => [p.id, p.name]), currentRule.product_id)}
        ${select('role_target', 'Cargo Comercial Alvo', Object.entries(commercialRoleLabels).map(([k, v]) => [k, v]), currentRule.role_target)}
        ${field('first_fee_percent', '1º Fee (%)', currentRule.first_fee_percent, 'number', 'min="0" max="100" step="0.1" required')}
        ${field('next_fee_percent', 'Próximos Fees (%)', currentRule.next_fee_percent, 'number', 'min="0" max="100" step="0.1" required')}
        ${field('setup_percent', 'Implementação (%)', currentRule.setup_percent, 'number', 'min="0" max="100" step="0.1" required')}
        ${field('months', 'Meses Comissionáveis', currentRule.months, 'number', 'min="1" max="120" step="1" required')}
      </div>
      <p class="small" id="ruleProductDefaultNotice" style="margin-top:12px; color:var(--muted);">
        Regra padrão no cadastro do produto: 1º Fee ${prodRules.first ?? 0}%, Próximos ${prodRules.next ?? 0}%, Implementação ${prodRules.setup ?? 0}%, Duração ${prodRules.months ?? 6} meses.
      </p>
      ${actions()}
    </form>
  `, async f => {
    const payload = {
      id: ruleId,
      team_id: teamId,
      product_id: f.get('product_id'),
      role_target: f.get('role_target'),
      first_fee_percent: Number(f.get('first_fee_percent')),
      next_fee_percent: Number(f.get('next_fee_percent')),
      setup_percent: Number(f.get('setup_percent')),
      months: Number(f.get('months'))
    };
    await callTeamsApi('commission-rule-save', { rule: payload });
    await fetchTeams(true);
    document.getElementById('modal').close();
    render();
    toast('Regra exclusiva do time salva com sucesso.');
  });

  const prodSelect = document.getElementById('f_product_id');
  if (prodSelect) {
    prodSelect.onchange = (e) => {
      const p = product(e.target.value);
      if (!p || !p.rules) return;
      const f1 = document.getElementById('f_first_fee_percent');
      const fn = document.getElementById('f_next_fee_percent');
      const fs = document.getElementById('f_setup_percent');
      const fm = document.getElementById('f_months');
      const notice = document.getElementById('ruleProductDefaultNotice');
      if (f1) f1.value = p.rules.first ?? 0;
      if (fn) fn.value = p.rules.next ?? 0;
      if (fs) fs.value = p.rules.setup ?? 0;
      if (fm) fm.value = p.rules.months ?? 6;
      if (notice) notice.textContent = `Regra padrão no cadastro do produto: 1º Fee ${p.rules.first ?? 0}%, Próximos ${p.rules.next ?? 0}%, Implementação ${p.rules.setup ?? 0}%, Duração ${p.rules.months ?? 6} meses.`;
    };
  }
}

async function removeTeamRule(ruleId) {
  try {
    await callTeamsApi('commission-rule-delete', { ruleId });
    await fetchTeams(true);
    render();
    toast('Regra personalizada removida. O time voltou a herdar o padrão do produto.');
  } catch (err) {
    toast(err.message || 'Erro ao remover regra.');
  }
}

