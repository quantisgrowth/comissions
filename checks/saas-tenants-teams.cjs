// Verification of SaaS multi-tenant provisioning, teams, and dynamic product rules.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

// Mock in-memory database
const tables = {
  cm_tenants: [
    { id: 't1', slug: 'empresa-alfa', name: 'Empresa Alfa', plan: 'standard', active: true, created_at: new Date().toISOString() }
  ],
  cm_profiles: [
    { id: 'super1', name: 'SuperAdmin Master', email: 'super@platform.com', role: 'Administrador', is_superadmin: true, all_companies: true, companies: [], active: true },
    { id: 'seller1', name: 'Vendedor 1', email: 'seller@alfa.com', role: 'Vendedor', is_superadmin: false, tenant_id: 't1', all_companies: false, companies: ['one'], active: true },
    { id: 'gestor1', name: 'Gestor Alfa', email: 'gestor@alfa.com', role: 'Gestor', is_superadmin: false, tenant_id: 't1', all_companies: false, companies: ['one'], active: true }
  ],
  cm_teams: [],
  cm_team_members: [],
  cm_team_products: [],
  cm_commission_rules: [],
  cm_invites: [],
  cm_audit: []
};

function createMockDb() {
  return {
    from(tableName) {
      let list = tables[tableName] || [];
      let filters = [];
      let selectFields = '*';
      let orderBy = null;
      let lastMutation = null;
      let isDelete = false;

      const query = {
        select(fields = '*') { selectFields = fields; return query; },
        eq(col, val) { filters.push((item) => item[col] === val); return query; },
        in(col, vals) { filters.push((item) => vals.includes(item[col])); return query; },
        order(col) { orderBy = col; return query; },
        async single() {
          const res = await query.maybeSingle();
          if (!res.data) throw new Error('Not found');
          return res;
        },
        async maybeSingle() {
          if (lastMutation !== null) return { data: lastMutation, error: null };
          let rows = list.filter(item => filters.every(f => f(item)));
          return { data: rows[0] || null, error: null };
        },
        insert(data) {
          const items = Array.isArray(data) ? data : [data];
          const inserted = items.map(d => ({ id: d.id || 'id-' + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), ...d }));
          tables[tableName] = [...(tables[tableName] || []), ...inserted];
          lastMutation = Array.isArray(data) ? inserted : inserted[0];
          return query;
        },
        update(data) {
          tables[tableName] = (tables[tableName] || []).map(item => {
            if (filters.every(f => f(item))) {
              return { ...item, ...data };
            }
            return item;
          });
          const updated = tables[tableName].filter(item => filters.every(f => f(item)));
          lastMutation = updated[0] || null;
          return query;
        },
        upsert(data) {
          const existing = (tables[tableName] || []).find(item => item.team_id === data.team_id && item.profile_id === data.profile_id);
          if (existing) {
            Object.assign(existing, data);
            lastMutation = existing;
            return query;
          }
          const item = { id: 'id-' + Math.random().toString(36).slice(2), ...data };
          tables[tableName] = [...(tables[tableName] || []), item];
          lastMutation = item;
          return query;
        },
        delete() {
          isDelete = true;
          return query;
        },
        then(resolve, reject) {
          if (isDelete) {
            tables[tableName] = (tables[tableName] || []).filter(item => !filters.every(f => f(item)));
            return Promise.resolve({ error: null }).then(resolve, reject);
          }
          let rows = list.filter(item => filters.every(f => f(item)));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        }
      };
      return query;
    }
  };
}

const mockDb = createMockDb();
const ctx = {
  crypto: require('node:crypto').webcrypto,
  TextEncoder,
  structuredClone,
  Date
};
vm.createContext(ctx);

// Load admin.ts and teams.ts
const adminSrc = stripTypeScriptTypes(fs.readFileSync('backend/admin.ts', 'utf8')).replace(/export /g, '');
const teamsSrc = stripTypeScriptTypes(fs.readFileSync('backend/teams.ts', 'utf8')).replace(/export /g, '');
vm.runInContext(adminSrc, ctx);
vm.runInContext(teamsSrc, ctx);

async function testSuite() {
  const superUser = tables.cm_profiles[0];
  const regularSeller = tables.cm_profiles[1];
  const gestor = tables.cm_profiles[2];

  const issueInvite = async (target, actor) => ({
    url: 'https://quantisgrowth.github.io/comissions/#invite=mocktoken',
    expires: new Date(Date.now() + 86400000).toISOString(),
    profile: target
  });

  // 1. Verify SuperAdmin Authorization
  const checkSuper = await ctx.handleAdmin(mockDb, superUser, { action: 'admin-check' }, issueInvite);
  assert.equal(checkSuper.superadmin, true);

  await assert.rejects(
    async () => ctx.handleAdmin(mockDb, regularSeller, { action: 'admin-check' }, issueInvite),
    /Acesso restrito/
  );

  // 2. Tenant Provisioning
  const newTenantRes = await ctx.handleAdmin(mockDb, superUser, {
    action: 'admin-tenant-save',
    tenant: {
      name: 'Cliente Beta Cosméticos',
      slug: 'beta-cosmeticos',
      legal_name: 'Beta Cosméticos Ltda',
      document_cnpj: '12.345.678/0001-90',
      plan: 'pro',
      active: true
    }
  }, issueInvite);

  assert.equal(newTenantRes.saved, true);
  assert.equal(newTenantRes.tenant.slug, 'beta-cosmeticos');
  assert.equal(newTenantRes.tenant.plan, 'pro');

  // List Tenants
  const listRes = await ctx.handleAdmin(mockDb, superUser, { action: 'admin-tenants-list' }, issueInvite);
  assert.equal(listRes.tenants.length >= 2, true);

  // 3. Provision Tenant Owner / Admin
  const ownerInvite = await ctx.handleAdmin(mockDb, superUser, {
    action: 'admin-tenant-owner-invite',
    tenantId: newTenantRes.tenant.id,
    name: 'Carlos Dono da Beta',
    email: 'carlos@beta.com'
  }, issueInvite);

  assert.ok(ownerInvite.url.includes('#invite='));
  assert.equal(ownerInvite.profile.role, 'Administrador');
  assert.equal(ownerInvite.profile.tenant_id, newTenantRes.tenant.id);

  // 4. Commercial Teams per Product
  const newTeam = await ctx.handleTeams(mockDb, gestor, {
    action: 'team-save',
    team: {
      name: 'Time Outbound Enterprise',
      company_id: 'one',
      active: true
    }
  });
  assert.equal(newTeam.saved, true);
  assert.equal(newTeam.team.name, 'Time Outbound Enterprise');

  // Add Member to Team with role closer
  const memberAdd = await ctx.handleTeams(mockDb, gestor, {
    action: 'team-member-add',
    teamId: newTeam.team.id,
    profileId: regularSeller.id,
    role: 'closer'
  });
  assert.equal(memberAdd.saved, true);
  assert.equal(memberAdd.member.commercial_role, 'closer');

  // Associate Products to Team
  const productsSet = await ctx.handleTeams(mockDb, gestor, {
    action: 'team-products-set',
    teamId: newTeam.team.id,
    productIds: ['prod-enterprise-a', 'prod-enterprise-b']
  });
  assert.equal(productsSet.updated, true);

  // Configure Dynamic Commission Rule for this Product + Team + Closer
  const ruleSave = await ctx.handleTeams(mockDb, gestor, {
    action: 'commission-rule-save',
    rule: {
      product_id: 'prod-enterprise-a',
      team_id: newTeam.team.id,
      role_target: 'closer',
      first_fee_percent: 15,
      next_fee_percent: 8,
      setup_percent: 12,
      months: 12
    }
  });
  assert.equal(ruleSave.saved, true);
  assert.equal(ruleSave.rule.first_fee_percent, 15);
  assert.equal(ruleSave.rule.next_fee_percent, 8);

  // List teams as seller
  const sellerTeams = await ctx.handleTeams(mockDb, regularSeller, { action: 'teams-list' });
  assert.equal(sellerTeams.teams.length, 1);
  assert.equal(sellerTeams.teams[0].name, 'Time Outbound Enterprise');

  console.log('Verified SuperAdmin provisioning, Tenant Owner invite, Commercial Teams, Team Products and Dynamic Commission Rules.');
}

testSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
