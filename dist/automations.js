// Automations & CRM Webhook Integrations Module
// Provides endpoint configuration, secret token management, payload documentation,
// interactive webhook simulator, and real-time execution logs.

let automationsData = {
  logs: [],
  loaded: false,
  loading: false
};

let selectedDocEvent = 'demo_scheduled';
let secretVisible = false;

const eventDocInfo = {
  demo_scheduled: {
    title: 'demo_scheduled (Novo Agendamento)',
    desc: 'Disparado no CRM quando o lead agenda a primeira demonstração comercial. Cria o lead e o registro da demonstração guardando a data original imutável.',
    example: {
      event: 'demo_scheduled',
      company_id: 'quantis',
      data: {
        deal_id: 'deal-8491',
        company_name: 'Aliança Locações de Máquinas',
        contact_name: 'Carlos Eduardo',
        phone: '11987654321',
        email: 'carlos@alianca.com.br',
        segment: 'Locação',
        sdr_email: 'sdr@example.com',
        closer_email: 'closer@example.com',
        scheduled_at: '2026-11-10T14:30:00Z',
        mrr: 697.00,
        setup: 790.00
      }
    }
  },
  demo_rescheduled: {
    title: 'demo_rescheduled (Remarcação)',
    desc: 'Disparado quando a reunião é reagendada. Salva o motivo no log de auditoria, incrementa o contador (R: N) e atualiza a data agendada atual.',
    example: {
      event: 'demo_rescheduled',
      company_id: 'quantis',
      data: {
        deal_id: 'deal-8491',
        new_date: '2026-11-14T16:00:00Z',
        reason: 'Cliente solicitou adiar por conta de viagem da diretoria'
      }
    }
  },
  demo_no_show: {
    title: 'demo_no_show (Não Comparecimento / Falta)',
    desc: 'Disparado quando o cliente não aparece na reunião marcada. Marca Show Rate como falso e altera o status para aguardando reagendamento.',
    example: {
      event: 'demo_no_show',
      company_id: 'quantis',
      data: {
        deal_id: 'deal-8491'
      }
    }
  },
  demo_completed: {
    title: 'demo_completed (Demonstração Realizada)',
    desc: 'Disparado quando a apresentação comercial é finalizada. Marca Show Rate como verdadeiro e calcula automaticamente os dias de ciclo (SLA).',
    example: {
      event: 'demo_completed',
      company_id: 'quantis',
      data: {
        deal_id: 'deal-8491',
        completed_at: '2026-11-10T15:30:00Z'
      }
    }
  },
  deal_won: {
    title: 'deal_won (Venda Fechada / Ganho)',
    desc: 'Disparado quando o contrato é assinado ou a venda é ganha. Transfere automaticamente o negócio para o painel de comissões calculando o rateio do SDR e Closer.',
    example: {
      event: 'deal_won',
      company_id: 'quantis',
      data: {
        deal_id: 'deal-8491',
        mrr: 697.00,
        setup: 790.00,
        sdr_commission_amount: 50.00,
        closer_commission_amount: 209.10
      }
    }
  },
  deal_lost: {
    title: 'deal_lost (Perdido / Descarte)',
    desc: 'Disparado quando o lead desiste ou a oportunidade é perdida. Registra o status de perda e o motivo do descarte.',
    example: {
      event: 'deal_lost',
      company_id: 'quantis',
      data: {
        deal_id: 'deal-8491',
        reason: 'Optou por solução interna própria'
      }
    }
  }
};

async function callAutomationsApi(action, extra = {}) {
  // 1. Tenta Edge Function
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

  if (action === 'webhook-logs-list') {
    try {
      const res = await fetch(CLOUD_URL + '/rest/v1/cm_webhook_logs?order=created_at.desc&limit=50', { headers });
      if (res.ok) {
        const data = await res.json();
        return { logs: Array.isArray(data) ? data : [] };
      }
    } catch {
      return { logs: [] };
    }
  }

  return { logs: [] };
}

async function fetchAutomationsLogs(force = false) {
  if (automationsData.loaded && !force) return;
  automationsData.loading = true;
  try {
    const res = await callAutomationsApi('webhook-logs-list');
    automationsData.logs = res.logs || [];
    automationsData.loaded = true;
  } catch (err) {
    console.error('Erro ao buscar logs de webhook:', err);
  } finally {
    automationsData.loading = false;
  }
}

function copyToClipboard(text, msg = 'Copiado para a área de transferência!') {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast(msg)).catch(() => prompt('Copie:', text));
  } else {
    prompt('Copie:', text);
  }
}

// Renderizador principal da tela de Automações
function renderAutomationsModule() {
  if (!automationsData.loaded && !automationsData.loading) {
    fetchAutomationsLogs(true).then(() => render());
  }

  const webhookUrl = CLOUD_URL + '/functions/v1/comissions-api';
  const webhookSecret = 'quantis_crm_secret_2026';

  const logs = automationsData.logs || [];
  const successCount = logs.filter(l => l.status_code >= 200 && l.status_code < 300).length;
  const successRate = logs.length ? Math.round((successCount / logs.length) * 100) : 100;

  const topMetrics = metric([
    ['Status da Integração', '● Conectado', 'Endpoint pronto para receber eventos'],
    ['Eventos Recebidos', logs.length, 'Disparos registrados no histórico'],
    ['Taxa de Sucesso', `${successRate}%`, `${successCount} requisições processadas com sucesso`],
    ['Segurança', 'X-Webhook-Secret', 'Proteção com chave e idempotência']
  ]);

  // Seção 1: Credenciais e Endpoints
  const credentialsCard = `
    <section class="panel" style="margin-bottom:22px;">
      <div class="panelhead">
        <div>
          <h2>Configuração do Webhook no CRM DataCrazy</h2>
          <p>Utilize os dados abaixo na tela de automações/workflows do CRM para enviar os eventos ao Comissions.</p>
        </div>
        <div>
          ${btn('⚡ Testar disparo agora', 'openWebhookSimulatorModal()')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1.8fr 1.2fr;gap:20px;margin-top:16px;">
        <div style="background:#f9fafb;border:1px solid #e5e7eb;padding:16px;border-radius:8px;">
          <label style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px;">URL de Destino (Endpoint)</label>
          <div style="display:flex;gap:8px;">
            <input type="text" readonly value="${esc(webhookUrl)}" style="flex:1;background:white;font-family:monospace;font-size:12px;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;">
            <button type="button" class="btn secondary" onclick="copyToClipboard('${esc(webhookUrl)}', 'URL do Webhook copiada!')" style="padding:8px 14px;font-size:12px;white-space:nowrap;">
              Copiar URL
            </button>
          </div>
          <p class="small" style="margin-top:8px;">Método: <strong>POST</strong> &bull; Formato: <strong>application/json</strong></p>
        </div>

        <div style="background:#f9fafb;border:1px solid #e5e7eb;padding:16px;border-radius:8px;">
          <label style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px;">Header de Segurança (X-Webhook-Secret)</label>
          <div style="display:flex;gap:8px;">
            <input id="secretInput" type="${secretVisible ? 'text' : 'password'}" readonly value="${esc(webhookSecret)}" style="flex:1;background:white;font-family:monospace;font-size:12px;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;">
            <button type="button" class="btn secondary" onclick="secretVisible=!secretVisible;render();" style="padding:8px 10px;font-size:11px;">
              ${secretVisible ? 'Ocultar' : 'Mostrar'}
            </button>
            <button type="button" class="btn secondary" onclick="copyToClipboard('${esc(webhookSecret)}', 'Chave secreta copiada!')" style="padding:8px 14px;font-size:12px;white-space:nowrap;">
              Copiar
            </button>
          </div>
          <p class="small" style="margin-top:8px;">Chave obrigatória para validação da requisição.</p>
        </div>
      </div>
    </section>
  `;

  // Seção 2: Tabela de Mapeamento (Empresas & Usuários)
  const companiesList = allowed().map(c => `
    <tr>
      <td style="font-weight:600;">${esc(c.name)}</td>
      <td><code style="background:#e8f4ed;color:#167b63;padding:2px 6px;border-radius:4px;font-weight:600;">${esc(c.id)}</code></td>
      <td style="text-align:right;">
        <button type="button" class="btn secondary" onclick="copyToClipboard('${esc(c.id)}', 'ID da empresa copiado!')" style="padding:4px 8px;font-size:11px;">Copiar</button>
      </td>
    </tr>
  `).join('');

  const sellersList = state.users.filter(u => u.active).map(u => `
    <tr>
      <td style="font-weight:600;">${esc(u.name)}</td>
      <td><span class="pill">${esc(u.role)}</span></td>
      <td><code>${esc(u.email || 'Sem e-mail')}</code></td>
      <td style="text-align:right;">
        ${u.email ? `<button type="button" class="btn secondary" onclick="copyToClipboard('${esc(u.email)}', 'E-mail copiado!')" style="padding:4px 8px;font-size:11px;">Copiar</button>` : '—'}
      </td>
    </tr>
  `).join('');

  const mappingCard = `
    <div style="display:grid;grid-template-columns:1fr 1.3fr;gap:22px;margin-bottom:22px;">
      <section class="panel">
        <h2>Identificadores de Empresas (company_id)</h2>
        <p>Utilize este código no campo <code>company_id</code> do payload do CRM.</p>
        <table style="margin-top:12px;">
          <thead>
            <tr><th>Empresa</th><th>ID (Slug)</th><th></th></tr>
          </thead>
          <tbody>
            ${companiesList}
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h2>E-mails de Vendedores & SDRs</h2>
        <p>Informe o e-mail em <code>sdr_email</code> e <code>closer_email</code> para vínculo automático.</p>
        <table style="margin-top:12px;">
          <thead>
            <tr><th>Nome</th><th>Perfil</th><th>E-mail cadastrado</th><th></th></tr>
          </thead>
          <tbody>
            ${sellersList}
          </tbody>
        </table>
      </section>
    </div>
  `;

  // Seção 3: Documentação Interativa de Eventos
  const docButtons = Object.keys(eventDocInfo).map(evtKey => {
    const isSelected = selectedDocEvent === evtKey;
    return `
      <button type="button" class="btn ${isSelected ? '' : 'secondary'}" onclick="selectedDocEvent='${evtKey}';render();" style="padding:7px 12px;font-size:12px;white-space:nowrap;">
        ${evtKey}
      </button>
    `;
  }).join('');

  const currentDoc = eventDocInfo[selectedDocEvent] || eventDocInfo.demo_scheduled;
  const currentExampleJson = JSON.stringify(currentDoc.example, null, 2);

  const docCard = `
    <section class="panel" style="margin-bottom:22px;">
      <div class="panelhead">
        <div>
          <h2>Eventos Suportados & Payloads Exemplo</h2>
          <p>Clique em cada evento para conferir como estruturar os dados no CRM DataCrazy.</p>
        </div>
        <button type="button" class="btn secondary" onclick="copyToClipboard(document.getElementById('docPayloadArea').value, 'JSON exemplo copiado!')">
          Copiar JSON
        </button>
      </div>

      <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:12px;border-bottom:1px solid var(--line);margin-bottom:16px;">
        ${docButtons}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:20px;">
        <div>
          <h3 style="margin-top:0;font-size:16px;color:var(--green);">${esc(currentDoc.title)}</h3>
          <p style="line-height:1.6;font-size:13px;color:var(--navy);">${esc(currentDoc.desc)}</p>
          <div class="notice" style="margin-top:16px;">
            Dica: Se a oportunidade mudar de data no CRM, use <code>demo_rescheduled</code> informando o mesmo <code>deal_id</code>. O Comissions manterá o histórico e atualizará a data sem duplicar!
          </div>
          <div style="margin-top:16px;">
            <button type="button" class="btn" onclick="openWebhookSimulatorModal('${selectedDocEvent}')" style="font-size:12px;">
              ⚡ Simular envio deste evento
            </button>
          </div>
        </div>

        <div>
          <label style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:6px;">Payload JSON (DataCrazy / Webhook)</label>
          <textarea id="docPayloadArea" readonly rows="12" style="width:100%;font-family:monospace;font-size:12px;padding:12px;background:#1e293b;color:#f8fafc;border:0;border-radius:8px;line-height:1.5;">${esc(currentExampleJson)}</textarea>
        </div>
      </div>
    </section>
  `;

  // Seção 4: Histórico de Logs do Webhook
  const logsTableRows = logs.map(l => {
    const isSuccess = l.status_code >= 200 && l.status_code < 300;
    const badgeColor = isSuccess ? '#15803d' : '#b91c1c';
    const badgeBg = isSuccess ? '#dcfce7' : '#fee2e2';

    return [
      formatDemoDateTime(l.created_at),
      `<code style="font-weight:600;color:var(--green);">${esc(l.event)}</code>`,
      esc(l.deal_id || '—'),
      esc(companyName(l.company_id) || l.company_id || '—'),
      `<span style="padding:3px 7px;border-radius:5px;font-weight:600;font-size:11px;color:${badgeColor};background:${badgeBg};">${l.status_code} ${esc(l.status_text)}</span>`,
      `<button type="button" class="btn secondary" onclick="openLogDetailsModal('${esc(l.id)}')" style="padding:4px 8px;font-size:11px;">Inspecionar JSON</button>`
    ];
  });

  const logsCard = `
    <section class="panel">
      <div class="panelhead">
        <div>
          <h2>Logs de Execuções e Webhooks Recebidos</h2>
          <p>Registro completo em tempo real das requisições enviadas ao Comissions.</p>
        </div>
        <div>
          ${btn('🔄 Atualizar logs', 'fetchAutomationsLogs(true).then(()=>render())', true)}
        </div>
      </div>

      ${table(['Data e Hora', 'Evento', 'Deal ID', 'Empresa', 'Status HTTP', 'Ação'], logsTableRows)}
    </section>
  `;

  return title('Automações e Integrações', 'Conexão via Webhook com CRM DataCrazy, credenciais de API e histórico de disparos em tempo real.') +
    topMetrics +
    credentialsCard +
    mappingCard +
    docCard +
    logsCard;
}

// Modal: Inspecionar Detalhes do Log
function openLogDetailsModal(logId) {
  const log = (automationsData.logs || []).find(l => l.id === logId);
  if (!log) return toast('Log não encontrado.');

  const payloadStr = JSON.stringify(log.payload, null, 2);
  const responseStr = JSON.stringify(log.response, null, 2);

  show(`
    <h2>Detalhes da Requisição do Webhook</h2>
    <p>Evento: <strong>${esc(log.event)}</strong> &bull; Deal: <strong>${esc(log.deal_id || '—')}</strong> &bull; Recebido em: ${formatDemoDateTime(log.created_at)}</p>
    
    <div style="margin:16px 0;">
      <label style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:6px;">Payload Recebido (JSON)</label>
      <textarea readonly rows="8" style="width:100%;font-family:monospace;font-size:12px;padding:12px;background:#1e293b;color:#f8fafc;border:0;border-radius:8px;line-height:1.4;">${esc(payloadStr)}</textarea>
    </div>

    <div style="margin:16px 0;">
      <label style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:6px;">Resposta Enviada (HTTP ${log.status_code})</label>
      <textarea readonly rows="5" style="width:100%;font-family:monospace;font-size:12px;padding:12px;background:#f3f4f6;color:#1f2937;border:1px solid #d1d5db;border-radius:8px;line-height:1.4;">${esc(responseStr)}</textarea>
    </div>

    ${log.error_message ? `<div class="notice" style="border-color:#fca5a5;background:#fef2f2;color:#991b1b;">Erro: ${esc(log.error_message)}</div>` : ''}

    <div class="actions">
      <button type="button" class="btn" onclick="document.getElementById('modal').close()">Fechar</button>
    </div>
  `, () => {});
}

// Modal: Simulador / Testador de Webhook
function openWebhookSimulatorModal(defaultEvent = 'demo_scheduled') {
  const example = eventDocInfo[defaultEvent]?.example || eventDocInfo.demo_scheduled.example;
  const initialPayload = JSON.stringify(example, null, 2);

  show(`
    <h2>Simulador de Disparo de Webhook</h2>
    <p>Envie uma requisição simulada diretamente para a API do Comissions sem precisar acionar o CRM.</p>
    
    <form id="simulatorForm">
      <div class="field" style="margin-bottom:12px;">
        <label>Carregar modelo de evento</label>
        <select id="simEventSelector" onchange="document.getElementById('simPayloadArea').value=JSON.stringify(eventDocInfo[this.value].example,null,2);" style="width:100%;padding:8px;">
          ${Object.keys(eventDocInfo).map(k => `<option value="${k}" ${k === defaultEvent ? 'selected' : ''}>${k}</option>`).join('')}
        </select>
      </div>

      <div class="field">
        <label>Payload JSON do Webhook</label>
        <textarea id="simPayloadArea" name="payloadJson" rows="12" required style="width:100%;font-family:monospace;font-size:12px;padding:10px;background:#1e293b;color:#f8fafc;border:0;border-radius:8px;">${esc(initialPayload)}</textarea>
      </div>

      <div id="simulatorFeedback" style="min-height:24px;margin-top:10px;font-size:12px;"></div>

      <div class="actions">
        <button type="button" class="btn secondary" onclick="document.getElementById('modal').close()">Cancelar</button>
        <button type="submit" class="btn" id="simSubmitBtn">🚀 Disparar Webhook</button>
      </div>
    </form>
  `, async (formData) => {
    const feedback = document.getElementById('simulatorFeedback');
    const submitBtn = document.getElementById('simSubmitBtn');
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Enviando...';
      feedback.textContent = 'Processando webhook...';
      feedback.style.color = 'var(--muted)';

      const rawJson = formData.get('payloadJson');
      let parsed;
      try {
        parsed = JSON.parse(rawJson);
      } catch (err) {
        throw Error('JSON inválido: ' + err.message);
      }

      // Envia via api('crm-webhook')
      const res = await api('crm-webhook', {
        payload: parsed,
        secret: 'quantis_crm_secret_2026'
      });

      if (res && res.error) throw Error(res.error);

      feedback.textContent = '✓ Sucesso! Webhook processado: ' + JSON.stringify(res);
      feedback.style.color = '#15803d';

      toast('Webhook de teste processado com sucesso!');
      await Promise.all([
        fetchAutomationsLogs(true),
        typeof fetchDemos === 'function' ? fetchDemos(true) : Promise.resolve()
      ]);

      setTimeout(() => {
        document.getElementById('modal').close();
        render();
      }, 1200);
    } catch (err) {
      feedback.textContent = '✗ Falha: ' + err.message;
      feedback.style.color = '#b91c1c';
      submitBtn.disabled = false;
      submitBtn.textContent = '🚀 Tentar novamente';
    }
  });
}
