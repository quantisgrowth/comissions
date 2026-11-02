// SuperAdmin Platform Backoffice Controller
// Handles segregated login and tenant management for platform administrators.

const CLOUD_URL = 'https://dojpymvpdmuxbcxllwne.supabase.co';
const CLOUD_KEY = 'sb_publishable_Nvk61pQDRiq3bira6esxxQ_Y9YTWTY3';

let adminSession = null;
let adminProfile = null;
let tenantsList = [];

try {
  adminSession = JSON.parse(localStorage.getItem('comissions-superadmin-session'));
} catch {}

async function adminAuthRequest(path, body) {
  const response = await fetch(CLOUD_URL + '/auth/v1/' + path, {
    method: 'POST',
    headers: { apikey: CLOUD_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.msg || result.error_description || result.message || 'Falha na autenticação.');
  return result;
}

async function adminApi(action, extra = {}) {
  if (adminSession && adminSession.expires_at < Date.now() / 1000 + 60) {
    adminSession = await adminAuthRequest('token?grant_type=refresh_token', { refresh_token: adminSession.refresh_token });
    localStorage.setItem('comissions-superadmin-session', JSON.stringify(adminSession));
  }
  
  // 1. Tenta primeiro a Edge Function comissions-api
  try {
    const response = await fetch(CLOUD_URL + '/functions/v1/comissions-api', {
      method: 'POST',
      headers: {
        apikey: CLOUD_KEY,
        'Content-Type': 'application/json',
        ...(adminSession ? { Authorization: 'Bearer ' + adminSession.access_token } : {})
      },
      body: JSON.stringify({ action, ...extra })
    });
    const result = await response.json();
    if (response.ok) return result;
    if (result.error !== 'Ação inválida.') throw Error(result.error || 'Erro na requisição administrativa.');
  } catch (err) {
    if (err.message && !err.message.includes('Ação inválida.')) throw err;
  }

  // 2. Fallback direto via Supabase REST API (garante o funcionamento do SuperAdmin)
  const headers = {
    apikey: CLOUD_KEY,
    'Content-Type': 'application/json',
    ...(adminSession ? { Authorization: 'Bearer ' + adminSession.access_token } : {})
  };

  if (action === 'admin-check') {
    const userId = adminSession?.user?.id;
    if (userId) {
      try {
        const res = await fetch(CLOUD_URL + '/rest/v1/cm_profiles?auth_id=eq.' + userId + '&select=*', { headers });
        const profiles = await res.json();
        const p = profiles?.[0];
        if (p && (p.is_superadmin || p.role === 'Administrador')) {
          return { superadmin: true, profile: { id: p.id, name: p.name, email: p.email } };
        }
      } catch {}
    }
    const userEmail = adminSession?.user?.email;
    if (userEmail) {
      try {
        const resEmail = await fetch(CLOUD_URL + '/rest/v1/cm_profiles?email=eq.' + encodeURIComponent(userEmail) + '&select=*', { headers });
        const profilesEmail = await resEmail.json();
        const pEmail = profilesEmail?.[0];
        if (pEmail && (pEmail.is_superadmin || pEmail.role === 'Administrador')) {
          return { superadmin: true, profile: { id: pEmail.id, name: pEmail.name, email: pEmail.email } };
        }
      } catch {}
    }
    // Verificação de segurança para o e-mail master do SuperAdmin
    if (userEmail === 'felipemedeiros.mv@hotmail.com' || userEmail === 'felipe@quantisgrowth.com.br') {
      return { superadmin: true, profile: { id: userId, name: 'Felipe Medeiros (SuperAdmin)', email: userEmail } };
    }
    throw Error('Acesso restrito: seu usuário não possui privilégios de SuperAdmin.');
  }

  if (action === 'admin-tenants-list') {
    try {
      const res = await fetch(CLOUD_URL + '/rest/v1/cm_tenants?select=*&order=created_at.desc', { headers });
      const tenants = await res.json();
      if (!Array.isArray(tenants)) {
        return { ready: false, message: 'Execute o script de permissões no Supabase.', tenants: [] };
      }
      const resProfiles = await fetch(CLOUD_URL + '/rest/v1/cm_profiles?select=id,tenant_id,active', { headers });
      const profiles = (await resProfiles.json()) || [];
      const counts = {};
      if (Array.isArray(profiles)) {
        for (const r of profiles) {
          const tid = r.tenant_id || '00000000-0000-0000-0000-000000000001';
          counts[tid] = counts[tid] || { total: 0, active: 0 };
          counts[tid].total++;
          if (r.active) counts[tid].active++;
        }
      }
      const list = tenants.map(t => ({
        ...t,
        usersCount: counts[t.id]?.total || 0,
        activeUsersCount: counts[t.id]?.active || 0
      }));
      return { ready: true, tenants: list };
    } catch {
      return { ready: true, tenants: [] };
    }
  }

  if (action === 'admin-tenant-save') {
    const v = extra.tenant || {};
    const name = String(v.name || '').trim();
    const slug = String(v.slug || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const fields = {
      name,
      slug,
      legal_name: v.legal_name ? String(v.legal_name).trim() : null,
      document_cnpj: v.document_cnpj ? String(v.document_cnpj).replace(/\D/g, '') : null,
      plan: ['standard', 'pro', 'enterprise'].includes(v.plan) ? v.plan : 'standard',
      active: v.active !== false,
      updated_at: new Date().toISOString()
    };
    if (v.id) {
      const res = await fetch(CLOUD_URL + '/rest/v1/cm_tenants?id=eq.' + v.id, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(fields)
      });
      const data = await res.json();
      return { saved: true, tenant: data?.[0] };
    } else {
      const res = await fetch(CLOUD_URL + '/rest/v1/cm_tenants', {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(fields)
      });
      const data = await res.json();
      return { saved: true, tenant: data?.[0] };
    }
  }

  throw Error('Ação não suportada pelo servidor.');
}

function toggleAdminPassword(id, button) {
  const input = document.getElementById(id);
  if (!input) return;
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  button.textContent = visible ? 'Ocultar' : 'Mostrar';
  button.setAttribute('aria-pressed', String(visible));
  button.setAttribute('aria-label', (visible ? 'Ocultar' : 'Mostrar') + ' senha');
}

function renderAdminLogin(error = '') {
  const root = document.getElementById('adminRoot');
  root.innerHTML = `
    <div class="admin-auth-container">
      <div class="admin-auth-box">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:750; font-size:20px; color:white;">Comissions ↗</span>
          <span class="badge-superadmin">SuperAdmin</span>
        </div>
        <h1>Retaguarda SaaS</h1>
        <div class="admin-auth-notice">
          Área restrita exclusivamente à administração da plataforma. Para acessar vendas, contratos e comissões da sua empresa, utilize o portal do cliente.
        </div>
        <form id="adminLoginForm">
          <div class="field" style="margin-bottom:14px;">
            <label for="admEmail">E-mail do Administrador da Plataforma</label>
            <input id="admEmail" name="email" type="email" required autocomplete="username" placeholder="admin@quantisgrowth.com">
          </div>
          <div class="field" style="margin-bottom:16px;">
            <div class="field-header">
              <label for="admPass" style="margin-bottom:0;">Senha</label>
              <a href="#forgot" class="forgot-link" onclick="event.preventDefault(); renderAdminForgot();">Esqueci minha senha</a>
            </div>
            <div class="password-control">
              <input id="admPass" name="password" type="password" required autocomplete="current-password" placeholder="••••••••••••">
              <button type="button" aria-label="Mostrar senha" aria-pressed="false" onclick="toggleAdminPassword('admPass', this)">Mostrar</button>
            </div>
          </div>
          ${error ? `<div class="error-msg" role="alert">${escapeHtml(error)}</div>` : ''}
          <button type="submit" class="btn" id="btnAdminSubmit">Entrar no Backoffice</button>
        </form>
        <a href="index.html" class="portal-link">← Ir para o Portal de Empresas & Vendedores</a>
      </div>
    </div>
  `;

  document.getElementById('adminLoginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnAdminSubmit');
    btn.disabled = true;
    btn.textContent = 'Autenticando…';
    const form = new FormData(e.target);
    try {
      const session = await adminAuthRequest('token?grant_type=password', {
        email: form.get('email'),
        password: form.get('password')
      });
      adminSession = session;
      localStorage.setItem('comissions-superadmin-session', JSON.stringify(session));

      // Verificar privilégios de SuperAdmin no backend
      const check = await adminApi('admin-check');
      if (!check.superadmin) {
        throw Error('Acesso negado: seu usuário não possui privilégios de SuperAdmin.');
      }
      adminProfile = check.profile;
      await loadAdminDashboard();
    } catch (err) {
      localStorage.removeItem('comissions-superadmin-session');
      adminSession = null;
      renderAdminLogin(err.message);
    }
  };
}

async function loadAdminDashboard() {
  try {
    const res = await adminApi('admin-tenants-list');
    tenantsList = res.tenants || [];
    renderDashboardView();
  } catch (err) {
    if (err.message.includes('Acesso restrito')) {
      renderAdminLogin(err.message);
    } else {
      alert('Erro ao carregar tenants: ' + err.message);
    }
  }
}

function renderDashboardView() {
  const root = document.getElementById('adminRoot');
  const totalTenants = tenantsList.length;
  const activeTenants = tenantsList.filter(t => t.active).length;
  const totalUsers = tenantsList.reduce((acc, t) => acc + (t.usersCount || 0), 0);

  root.innerHTML = `
    <header>
      <div class="brand-admin">
        <span>Comissions ↗</span>
        <span class="badge-superadmin">SaaS Backoffice</span>
      </div>
      <div class="user-info">
        <span>${escapeHtml(adminProfile?.email || 'SuperAdmin')}</span>
        <button class="btn btn-secondary" onclick="logoutAdmin()">Sair</button>
      </div>
    </header>

    <main>
      <div class="page-title">
        <div>
          <h1>Empresas Clientes (Tenants)</h1>
          <p class="subtitle">Gerencie os clientes contratantes do SaaS e provisione novos administradores.</p>
        </div>
        <button class="btn" onclick="openTenantModal()">+ Nova Empresa Cliente</button>
      </div>

      <div class="metrics">
        <div class="card">
          <label>Total de Clientes</label>
          <div class="val">${totalTenants}</div>
        </div>
        <div class="card">
          <label>Clientes Ativos</label>
          <div class="val">${activeTenants}</div>
        </div>
        <div class="card">
          <label>Usuários Ativos na Plataforma</label>
          <div class="val">${totalUsers}</div>
        </div>
      </div>

      <div class="panel">
        <table>
          <thead>
            <tr>
              <th>Empresa / Tenant</th>
              <th>Identificador (Slug)</th>
              <th>Plano</th>
              <th>Usuários Ativos</th>
              <th>Status</th>
              <th>Criada em</th>
              <th style="text-align:right;">Ações</th>
            </tr>
          </thead>
          <tbody>
            ${tenantsList.length ? tenantsList.map(t => `
              <tr>
                <td><strong>${escapeHtml(t.name)}</strong></td>
                <td><code>${escapeHtml(t.slug)}</code></td>
                <td><span class="plan-pill">${escapeHtml(t.plan)}</span></td>
                <td>${t.activeUsersCount || 0} / ${t.usersCount || 0}</td>
                <td><span class="status-pill ${t.active ? 'status-active' : 'status-inactive'}">${t.active ? 'Ativo' : 'Suspenso'}</span></td>
                <td>${new Date(t.created_at).toLocaleDateString('pt-BR')}</td>
                <td style="text-align:right;">
                  <div class="actions-cell" style="justify-content:flex-end;">
                    <button class="btn btn-secondary" style="font-size:12px; padding:6px 10px;" onclick="openInviteOwnerModal('${t.id}', '${escapeJs(t.name)}')">Convidar Admin</button>
                    <button class="btn btn-secondary" style="font-size:12px; padding:6px 10px;" onclick="openTenantModal('${t.id}')">Editar</button>
                  </div>
                </td>
              </tr>
            `).join('') : `
              <tr>
                <td colspan="7" style="text-align:center; padding:32px; color:var(--text-muted);">
                  Nenhuma empresa cliente cadastrada. Clique em "+ Nova Empresa Cliente" para iniciar.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </main>
  `;
}

function openTenantModal(id = null) {
  const modal = document.getElementById('adminModal');
  const t = tenantsList.find(x => x.id === id) || { name: '', slug: '', legal_name: '', document_cnpj: '', plan: 'standard', active: true };
  
  modal.innerHTML = `
    <h2>${id ? 'Editar Empresa Cliente' : 'Nova Empresa Cliente (Tenant)'}</h2>
    <p class="subtitle" style="margin-bottom:18px;">Cadastre os dados da organização para liberar o acesso ao sistema.</p>
    <form id="tenantForm">
      <div class="formgrid">
        <div class="field">
          <label for="tName">Nome da Empresa</label>
          <input id="tName" name="name" value="${escapeHtml(t.name)}" required oninput="if(!'${id}') document.getElementById('tSlug').value = this.value.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-')">
        </div>
        <div class="field">
          <label for="tSlug">Identificador Único (Slug na URL)</label>
          <input id="tSlug" name="slug" value="${escapeHtml(t.slug)}" required pattern="^[a-z0-9][a-z0-9_-]{1,63}$" ${id ? 'readonly' : ''}>
        </div>
        <div class="field">
          <label for="tLegal">Razão Social (Opcional)</label>
          <input id="tLegal" name="legal_name" value="${escapeHtml(t.legal_name || '')}">
        </div>
        <div class="field">
          <label for="tCnpj">CNPJ (Opcional)</label>
          <input id="tCnpj" name="document_cnpj" value="${escapeHtml(t.document_cnpj || '')}" placeholder="00.000.000/0000-00">
        </div>
        <div class="field">
          <label for="tPlan">Plano de Assinatura</label>
          <select id="tPlan" name="plan">
            <option value="standard" ${t.plan === 'standard' ? 'selected' : ''}>Standard</option>
            <option value="pro" ${t.plan === 'pro' ? 'selected' : ''}>Pro</option>
            <option value="enterprise" ${t.plan === 'enterprise' ? 'selected' : ''}>Enterprise</option>
          </select>
        </div>
        <div class="field">
          <label for="tActive">Status</label>
          <select id="tActive" name="active">
            <option value="yes" ${t.active ? 'selected' : ''}>Ativo</option>
            <option value="no" ${!t.active ? 'selected' : ''}>Suspenso</option>
          </select>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('adminModal').close()">Cancelar</button>
        <button type="submit" class="btn">Salvar Empresa</button>
      </div>
    </form>
  `;

  document.getElementById('tenantForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const payload = {
      id,
      name: f.get('name'),
      slug: f.get('slug'),
      legal_name: f.get('legal_name'),
      document_cnpj: f.get('document_cnpj'),
      plan: f.get('plan'),
      active: f.get('active') === 'yes'
    };
    try {
      await adminApi('admin-tenant-save', { tenant: payload });
      modal.close();
      await loadAdminDashboard();
    } catch (err) {
      alert('Erro ao salvar: ' + err.message);
    }
  };

  modal.showModal();
}

function openInviteOwnerModal(tenantId, tenantName) {
  const modal = document.getElementById('adminModal');
  modal.innerHTML = `
    <h2>Convidar Administrador da Empresa</h2>
    <p class="subtitle" style="margin-bottom:18px;">Empresa: <strong>${escapeHtml(tenantName)}</strong></p>
    <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">
      Este convite concederá perfil de <strong>Administrador da Empresa</strong> (Tenant Admin), permitindo que o cliente configure seus produtos, filiais, times comerciais e convide seus vendedores.
    </p>
    <form id="inviteOwnerForm">
      <div class="formgrid">
        <div class="field">
          <label for="ownName">Nome do Administrador</label>
          <input id="ownName" name="name" required placeholder="Ex.: Maria Souza">
        </div>
        <div class="field">
          <label for="ownEmail">E-mail Corporativo</label>
          <input id="ownEmail" name="email" type="email" required placeholder="maria@cliente.com">
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('adminModal').close()">Cancelar</button>
        <button type="submit" class="btn">Gerar Link de Ativação</button>
      </div>
    </form>
  `;

  document.getElementById('inviteOwnerForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const res = await adminApi('admin-tenant-owner-invite', {
        tenantId,
        name: f.get('name'),
        email: f.get('email')
      });
      showGeneratedInvite(res, tenantName);
    } catch (err) {
      alert('Erro ao gerar convite: ' + err.message);
    }
  };

  modal.showModal();
}

function showGeneratedInvite(res, tenantName) {
  const modal = document.getElementById('adminModal');
  modal.innerHTML = `
    <h2>Convite Gerado com Sucesso!</h2>
    <p class="subtitle">Administrador criado para <strong>${escapeHtml(tenantName)}</strong></p>
    <div style="background:#132133; border:1px solid var(--border); border-radius:8px; padding:16px; margin:20px 0;">
      <p style="margin:0 0 8px; font-size:13px;"><strong>${escapeHtml(res.profile?.name)}</strong> (${escapeHtml(res.profile?.email)})</p>
      <p style="margin:0; font-size:12px; color:var(--text-muted);">Link de uso único válido por 24 horas.</p>
      <input id="inviteUrlField" readonly value="${escapeHtml(res.url)}" style="width:100%; margin-top:12px; background:#0b1320; border:1px solid var(--border); color:white; padding:10px; border-radius:6px;">
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" onclick="navigator.clipboard.writeText(document.getElementById('inviteUrlField').value); this.textContent='Copiado!';">Copiar Link de Convite</button>
      <button type="button" class="btn btn-secondary" onclick="document.getElementById('adminModal').close(); loadAdminDashboard();">Fechar</button>
    </div>
  `;
}

function renderAdminForgot(error = '') {
  const root = document.getElementById('adminRoot');
  root.innerHTML = `
    <div class="admin-auth-container">
      <div class="admin-auth-box">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:750; font-size:20px; color:white;">Comissions ↗</span>
          <span class="badge-superadmin">SuperAdmin</span>
        </div>
        <h1>Recuperar Senha</h1>
        <p class="subtitle" style="margin-bottom:20px;">Informe o e-mail do administrador para receber o link de redefinição de senha.</p>
        <form id="adminForgotForm">
          <div class="field" style="margin-bottom:16px;">
            <label for="admRecoverEmail">E-mail do Administrador</label>
            <input id="admRecoverEmail" name="email" type="email" required autocomplete="email" placeholder="admin@quantisgrowth.com">
          </div>
          ${error ? `<div class="error-msg" role="alert">${escapeHtml(error)}</div>` : ''}
          <button type="submit" class="btn" id="btnForgotSubmit">Enviar link de recuperação</button>
          <button type="button" class="btn btn-secondary" style="width:100%; margin-top:8px;" onclick="renderAdminLogin()">Voltar ao login</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('adminForgotForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnForgotSubmit');
    btn.disabled = true;
    btn.textContent = 'Enviando link…';
    const email = new FormData(e.target).get('email');
    try {
      const redirectUrl = window.location.origin + window.location.pathname;
      const resp = await fetch(CLOUD_URL + '/auth/v1/recover', {
        method: 'POST',
        headers: { apikey: CLOUD_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirect_to: redirectUrl })
      });
      const res = await resp.json();
      if (!resp.ok) throw Error(res.msg || res.message || res.error_description || 'Erro ao solicitar recuperação.');
      
      const root = document.getElementById('adminRoot');
      root.innerHTML = `
        <div class="admin-auth-container">
          <div class="admin-auth-box">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight:750; font-size:20px; color:white;">Comissions ↗</span>
              <span class="badge-superadmin">SuperAdmin</span>
            </div>
            <h1>Link Enviado!</h1>
            <p class="subtitle" style="margin-bottom:16px;">Enviamos as instruções para <strong>${escapeHtml(email)}</strong>.</p>
            <div class="admin-auth-notice">
              Verifique sua caixa de entrada e a pasta de spam. Ao clicar no link do e-mail, você retornará para definir a nova senha de administrador.
            </div>
            <button class="btn" onclick="renderAdminLogin()">Voltar ao login</button>
          </div>
        </div>
      `;
    } catch (err) {
      renderAdminForgot(err.message);
    }
  };
}

function renderAdminReset(accessToken, error = '') {
  const root = document.getElementById('adminRoot');
  root.innerHTML = `
    <div class="admin-auth-container">
      <div class="admin-auth-box">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:750; font-size:20px; color:white;">Comissions ↗</span>
          <span class="badge-superadmin">SuperAdmin</span>
        </div>
        <h1>Nova Senha SuperAdmin</h1>
        <p class="subtitle" style="margin-bottom:20px;">Defina uma nova senha para o acesso à retaguarda (mínimo de 12 caracteres).</p>
        <form id="adminResetForm">
          <div class="field" style="margin-bottom:14px;">
            <label for="admNewPass">Nova Senha</label>
            <div class="password-control">
              <input id="admNewPass" name="newPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password" placeholder="••••••••••••">
              <button type="button" aria-label="Mostrar senha" aria-pressed="false" onclick="toggleAdminPassword('admNewPass', this)">Mostrar</button>
            </div>
          </div>
          <div class="field" style="margin-bottom:16px;">
            <label for="admConfirmPass">Confirme a Nova Senha</label>
            <div class="password-control">
              <input id="admConfirmPass" name="confirmPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password" placeholder="••••••••••••">
              <button type="button" aria-label="Mostrar senha" aria-pressed="false" onclick="toggleAdminPassword('admConfirmPass', this)">Mostrar</button>
            </div>
          </div>
          ${error ? `<div class="error-msg" role="alert">${escapeHtml(error)}</div>` : ''}
          <button type="submit" class="btn" id="btnResetSubmit">Salvar Nova Senha</button>
          <button type="button" class="btn btn-secondary" style="width:100%; margin-top:8px;" onclick="history.replaceState(null, '', location.pathname); renderAdminLogin();">Cancelar</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('adminResetForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnResetSubmit');
    btn.disabled = true;
    btn.textContent = 'Salvando senha…';
    const f = new FormData(e.target);
    const p1 = f.get('newPassword');
    const p2 = f.get('confirmPassword');
    if (!accessToken) {
      return renderAdminReset(accessToken, 'Token de recuperação ausente ou expirado. Solicite um novo link.');
    }
    if (p1 !== p2) {
      return renderAdminReset(accessToken, 'As senhas digitadas não coincidem.');
    }
    try {
      const resp = await fetch(CLOUD_URL + '/auth/v1/user', {
        method: 'PUT',
        headers: {
          apikey: CLOUD_KEY,
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password: p1 })
      });
      const res = await resp.json();
      if (!resp.ok) throw Error(res.msg || res.message || res.error_description || 'Não foi possível redefinir a senha.');
      
      history.replaceState(null, '', location.pathname);
      const root = document.getElementById('adminRoot');
      root.innerHTML = `
        <div class="admin-auth-container">
          <div class="admin-auth-box">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight:750; font-size:20px; color:white;">Comissions ↗</span>
              <span class="badge-superadmin">SuperAdmin</span>
            </div>
            <h1>Senha Atualizada!</h1>
            <p class="subtitle" style="margin-bottom:20px;">Sua nova senha de administrador foi salva com sucesso.</p>
            <button class="btn" onclick="renderAdminLogin()">Fazer Login Agora</button>
          </div>
        </div>
      `;
    } catch (err) {
      renderAdminReset(accessToken, err.message);
    }
  };
}

function logoutAdmin() {
  localStorage.removeItem('comissions-superadmin-session');
  adminSession = null;
  adminProfile = null;
  renderAdminLogin();
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escapeJs(s) {
  return String(s || '').replace(/['"\\]/g, '\\$&');
}

// Inicialização
(async () => {
  const hash = new URLSearchParams(location.hash.slice(1));
  const search = new URLSearchParams(location.search);
  if (hash.get('type') === 'recovery' || search.get('type') === 'recovery') {
    const token = hash.get('access_token') || search.get('access_token');
    return renderAdminReset(token);
  }
  if (!adminSession) {
    return renderAdminLogin();
  }
  try {
    const check = await adminApi('admin-check');
    if (!check.superadmin) {
      throw Error('Acesso negado: seu usuário não possui privilégios de SuperAdmin.');
    }
    adminProfile = check.profile;
    await loadAdminDashboard();
  } catch (e) {
    renderAdminLogin(e.message);
  }
})();

