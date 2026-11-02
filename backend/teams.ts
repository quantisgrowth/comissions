// Commercial Teams and Dynamic Rules handler.
// Allows each company to have multiple products, and each product to have dedicated commercial teams and rules.

export async function handleTeams(db: any, p: any, input: any) {
  const tenantId = p.tenant_id || '00000000-0000-0000-0000-000000000001';
  const isManager = ['Administrador', 'Gestor'].includes(p.role);

  if (input.action === 'teams-list') {
    // Gestores e Admins listam times do tenant; Vendedores listam apenas os times em que participam
    let teamsQuery = db.from('cm_teams').select('*').eq('tenant_id', tenantId);
    if (!isManager) {
      const { data: myMemberships } = await db
        .from('cm_team_members')
        .select('team_id')
        .eq('profile_id', p.id)
        .eq('active', true);
      const teamIds = (myMemberships || []).map((m: any) => m.team_id);
      if (!teamIds.length) return { teams: [], members: [], teamProducts: [], rules: [] };
      teamsQuery = teamsQuery.in('id', teamIds);
    }

    const [teamsRes, membersRes, productsRes, rulesRes] = await Promise.all([
      teamsQuery.order('name'),
      db.from('cm_team_members').select('*').eq('tenant_id', tenantId).eq('active', true),
      db.from('cm_team_products').select('*').eq('tenant_id', tenantId),
      db.from('cm_commission_rules').select('*').eq('tenant_id', tenantId)
    ]);

    if (teamsRes.error) {
      if (['42P01', 'PGRST205'].includes(teamsRes.error.code)) {
        return { teams: [], members: [], teamProducts: [], rules: [], legacy: true };
      }
      throw teamsRes.error;
    }

    return {
      teams: teamsRes.data || [],
      members: membersRes.data || [],
      teamProducts: productsRes.data || [],
      rules: rulesRes.data || []
    };
  }

  // Ações de modificação exigem Administrador ou Gestor
  if (!isManager) throw Error('Sem permissão para gerenciar times comerciais.');

  if (input.action === 'team-save') {
    const t = input.team || {};
    const name = String(t.name || '').trim();
    const companyId = String(t.company_id || '').trim();
    if (name.length < 2 || name.length > 100) throw Error('Nome do time deve ter entre 2 e 100 caracteres.');
    if (!companyId) throw Error('Selecione a empresa vinculada ao time.');

    // Verificar se o usuário tem acesso à empresa informada
    if (!p.all_companies && !p.companies.includes(companyId)) {
      throw Error('Você não tem acesso a esta empresa.');
    }

    const fields = {
      tenant_id: tenantId,
      company_id: companyId,
      name,
      active: t.active !== false
    };

    let result: any;
    if (t.id) {
      const { data, error } = await db.from('cm_teams').update(fields).eq('id', t.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await db.from('cm_teams').insert(fields).select().single();
      if (error) throw error;
      result = data;
    }

    await db.from('cm_audit').insert({ actor: p.id, action: 'team-save' });
    return { saved: true, team: result };
  }

  if (input.action === 'team-member-add') {
    const { teamId, profileId, role } = input;
    if (!teamId || !profileId) throw Error('Dados do membro inválidos.');
    const validRoles = ['closer', 'sdr', 'leader', 'bdr', 'account_manager'];
    const memberRole = validRoles.includes(role) ? role : 'closer';

    // Validar se o perfil pertence ao mesmo tenant
    const { data: memberProfile } = await db.from('cm_profiles').select('id, tenant_id').eq('id', profileId).maybeSingle();
    if (!memberProfile || (memberProfile.tenant_id && memberProfile.tenant_id !== tenantId)) {
      throw Error('Perfil não encontrado no tenant.');
    }

    const { data, error } = await db.from('cm_team_members').upsert({
      tenant_id: tenantId,
      team_id: teamId,
      profile_id: profileId,
      commercial_role: memberRole,
      active: true
    }, { onConflict: 'team_id, profile_id' }).select().single();

    if (error) throw error;
    await db.from('cm_audit').insert({ actor: p.id, action: 'team-member-add' });
    return { saved: true, member: data };
  }

  if (input.action === 'team-member-remove') {
    const { teamId, profileId } = input;
    const { error } = await db
      .from('cm_team_members')
      .update({ active: false })
      .eq('tenant_id', tenantId)
      .eq('team_id', teamId)
      .eq('profile_id', profileId);
    if (error) throw error;
    await db.from('cm_audit').insert({ actor: p.id, action: 'team-member-remove' });
    return { removed: true };
  }

  if (input.action === 'team-products-set') {
    const { teamId, productIds } = input;
    if (!teamId || !Array.isArray(productIds)) throw Error('Dados de produtos do time inválidos.');

    // Remove produtos antigos do time
    await db.from('cm_team_products').delete().eq('tenant_id', tenantId).eq('team_id', teamId);

    // Insere novos vínculos
    if (productIds.length > 0) {
      const inserts = productIds.map((pid: string) => ({
        tenant_id: tenantId,
        team_id: teamId,
        product_id: pid
      }));
      const { error } = await db.from('cm_team_products').insert(inserts);
      if (error) throw error;
    }

    await db.from('cm_audit').insert({ actor: p.id, action: 'team-products-set' });
    return { updated: true };
  }

  if (input.action === 'commission-rule-save') {
    const r = input.rule || {};
    if (!r.product_id) throw Error('Produto não informado.');
    const validRoles = ['closer', 'sdr', 'leader', 'bdr', 'account_manager', 'dev', 'partner'];
    const roleTarget = validRoles.includes(r.role_target) ? r.role_target : 'closer';

    const fields = {
      tenant_id: tenantId,
      product_id: r.product_id,
      team_id: r.team_id || null,
      role_target: roleTarget,
      first_fee_percent: Number(r.first_fee_percent || 0),
      next_fee_percent: Number(r.next_fee_percent || 0),
      setup_percent: Number(r.setup_percent || 0),
      months: Number(r.months || 6)
    };

    if (fields.first_fee_percent < 0 || fields.first_fee_percent > 100 ||
        fields.next_fee_percent < 0 || fields.next_fee_percent > 100 ||
        fields.setup_percent < 0 || fields.setup_percent > 100) {
      throw Error('Percentuais devem estar entre 0% e 100%.');
    }

    let saved: any;
    if (r.id) {
      const { data, error } = await db.from('cm_commission_rules').update(fields).eq('id', r.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await db.from('cm_commission_rules').insert(fields).select().single();
      if (error) throw error;
      saved = data;
    }

    await db.from('cm_audit').insert({ actor: p.id, action: 'commission-rule-save' });
    return { saved: true, rule: saved };
  }

  throw Error('Ação de times inválida.');
}

