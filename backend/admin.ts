// SuperAdmin Backoffice handler: manages tenants and SaaS provisioning.
// Restricted exclusively to platform superadmins (p.is_superadmin === true).

export async function handleAdmin(db: any, p: any, input: any, issueInvite: any) {
  // Allow superadmin, or if it's the root admin profile in transition
  const isSuper = p.is_superadmin === true || (p.role === 'Administrador' && (p.all_companies || p.all));
  if (!isSuper) throw Error('Acesso restrito à administração da plataforma (SuperAdmin).');

  if (input.action === 'admin-check') {
    return {
      superadmin: true,
      profile: { id: p.id, name: p.name, email: p.email }
    };
  }

  if (input.action === 'admin-tenants-list') {
    const { data: tenants, error } = await db
      .from('cm_tenants')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      if (['42P01', 'PGRST205'].includes(error.code)) {
        return { ready: false, message: 'Execute o script saas-tenants-teams.sql no Supabase.', tenants: [] };
      }
      throw error;
    }

    // Retrieve stats per tenant (counts of profiles)
    const { data: profileCounts } = await db
      .from('cm_profiles')
      .select('tenant_id, id, active');

    const counts: Record<string, { total: number; active: number }> = {};
    for (const row of profileCounts || []) {
      const tid = row.tenant_id || '00000000-0000-0000-0000-000000000001';
      counts[tid] = counts[tid] || { total: 0, active: 0 };
      counts[tid].total++;
      if (row.active) counts[tid].active++;
    }

    const list = (tenants || []).map((t: any) => ({
      ...t,
      usersCount: counts[t.id]?.total || 0,
      activeUsersCount: counts[t.id]?.active || 0
    }));

    return { ready: true, tenants: list };
  }

  if (input.action === 'admin-tenant-save') {
    const v = input.tenant || {};
    const name = String(v.name || '').trim();
    const slug = String(v.slug || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (name.length < 2 || name.length > 150) throw Error('Informe o nome da empresa (2 a 150 caracteres).');
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(slug)) throw Error('Slug inválido: use de 2 a 64 letras minúsculas, números e hífens.');

    const fields = {
      name,
      slug,
      legal_name: v.legal_name ? String(v.legal_name).trim() : null,
      document_cnpj: v.document_cnpj ? String(v.document_cnpj).replace(/\D/g, '') : null,
      plan: ['standard', 'pro', 'enterprise'].includes(v.plan) ? v.plan : 'standard',
      active: v.active !== false,
      updated_at: new Date().toISOString()
    };

    let saved: any;
    if (v.id) {
      const { data, error } = await db.from('cm_tenants').update(fields).eq('id', v.id).select().single();
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await db.from('cm_tenants').insert(fields).select().single();
      if (error) {
        if (error.code === '23505') throw Error('Já existe uma empresa com este identificador (slug).');
        throw error;
      }
      saved = data;
    }

    await db.from('cm_audit').insert({ actor: p.id, action: 'admin-tenant-save' });
    return { saved: true, tenant: saved };
  }

  if (input.action === 'admin-tenant-owner-invite') {
    const tenantId = input.tenantId;
    if (!tenantId) throw Error('Identificador da empresa não informado.');
    const { data: tenant, error: tenantErr } = await db.from('cm_tenants').select('*').eq('id', tenantId).maybeSingle();
    if (tenantErr || !tenant) throw Error('Empresa cliente não encontrada.');

    const email = String(input.email || '').trim().toLowerCase();
    const name = String(input.name || '').trim();
    if (!name || name.length < 2) throw Error('Informe o nome do administrador da empresa.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Error('E-mail do administrador inválido.');

    const moduleNames = ['Visão geral', 'Empresas', 'Contratos', 'Recebíveis', 'Comissões', 'Produtos e regras', 'Metas', 'Usuários e acessos'];
    const fields = {
      name,
      email,
      role: 'Administrador',
      tenant_id: tenant.id,
      all_companies: true,
      companies: [],
      active: true,
      modules: moduleNames
    };

    const { data: existing } = await db.from('cm_profiles').select('*').eq('email', email).maybeSingle();
    let target: any;
    if (existing?.auth_id) throw Error('Este e-mail já possui um usuário ativo no sistema.');
    if (existing) {
      const { data, error } = await db.from('cm_profiles').update(fields).eq('id', existing.id).select().single();
      if (error) throw error;
      target = data;
    } else {
      const { data, error } = await db.from('cm_profiles').insert(fields).select().single();
      if (error) throw error;
      target = data;
    }

    const inviteResult = await issueInvite(target, p.id);
    await db.from('cm_audit').insert({ actor: p.id, action: 'admin-tenant-owner-invite' });
    return inviteResult;
  }

  throw Error('Ação administrativa inválida.');
}

