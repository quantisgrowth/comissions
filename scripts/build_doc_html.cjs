const fs = require('fs');
const path = require('path');

const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Comissions - Manual de Automações & Webhooks CRM</title>
  <style>
    @page {
      size: A4;
      margin: 16mm 14mm 18mm 14mm;
      @bottom-right {
        content: counter(page);
      }
    }
    
    *, *:before, *:after {
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.55;
      color: #1e293b;
      margin: 0;
      padding: 0;
      background: #ffffff;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #167b63;
      padding-bottom: 14px;
      margin-bottom: 24px;
    }

    .brand {
      font-size: 24pt;
      font-weight: 800;
      color: #112c35;
      letter-spacing: -0.5px;
    }

    .brand span {
      color: #167b63;
    }

    .brand-sub {
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #64748b;
      margin-top: 2px;
      font-weight: 600;
    }

    .doc-meta {
      text-align: right;
      font-size: 8.5pt;
      color: #64748b;
      line-height: 1.4;
    }

    .doc-meta strong {
      color: #112c35;
    }

    h1 {
      font-size: 18pt;
      color: #112c35;
      margin: 0 0 8px 0;
      letter-spacing: -0.5px;
    }

    .lead-text {
      font-size: 10.5pt;
      color: #475569;
      margin-bottom: 22px;
      line-height: 1.6;
    }

    h2 {
      font-size: 13pt;
      color: #112c35;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 5px;
      margin: 26px 0 12px 0;
      page-break-after: avoid;
    }

    h3 {
      font-size: 11pt;
      color: #167b63;
      margin: 18px 0 6px 0;
      page-break-after: avoid;
    }

    p, ul, ol {
      margin: 0 0 10px 0;
    }

    ul, ol {
      padding-left: 20px;
    }

    li {
      margin-bottom: 4px;
    }

    .notice {
      background: #f0fdf4;
      border-left: 4px solid #167b63;
      padding: 10px 14px;
      margin: 12px 0;
      border-radius: 0 6px 6px 0;
      font-size: 9.5pt;
      color: #166534;
      page-break-inside: avoid;
    }

    .warning {
      background: #fef2f2;
      border-left: 4px solid #dc2626;
      padding: 10px 14px;
      margin: 12px 0;
      border-radius: 0 6px 6px 0;
      font-size: 9.5pt;
      color: #991b1b;
      page-break-inside: avoid;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0 18px 0;
      font-size: 9pt;
      page-break-inside: avoid;
    }

    th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 700;
      text-align: left;
      padding: 8px 10px;
      border: 1px solid #cbd5e1;
      font-size: 8.5pt;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    td {
      padding: 7px 10px;
      border: 1px solid #e2e8f0;
      vertical-align: top;
    }

    tr:nth-child(even) td {
      background: #f8fafc;
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 8.5pt;
      background: #f1f5f9;
      color: #0f766e;
      padding: 1.5px 5px;
      border-radius: 4px;
      font-weight: 600;
    }

    pre {
      background: #0f172a;
      color: #f8fafc;
      padding: 12px 14px;
      border-radius: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 8pt;
      line-height: 1.45;
      overflow-x: auto;
      margin: 8px 0 16px 0;
      page-break-inside: avoid;
    }

    .pill {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 8pt;
      font-weight: 600;
    }

    .pill-green { background: #dcfce7; color: #15803d; }
    .pill-blue { background: #dbeafe; color: #1e40af; }
    .pill-amber { background: #fef3c7; color: #92400e; }
    .pill-purple { background: #f3e8ff; color: #6b21a8; }
    .pill-red { background: #fee2e2; color: #991b1b; }

    .card-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin: 12px 0 16px 0;
      page-break-inside: avoid;
    }

    .card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 14px;
    }

    .card label {
      font-size: 7.5pt;
      text-transform: uppercase;
      font-weight: 700;
      color: #64748b;
      letter-spacing: 0.5px;
      display: block;
      margin-bottom: 3px;
    }

    .card .val {
      font-size: 11pt;
      font-weight: 700;
      color: #0f172a;
    }

    .card .sub {
      font-size: 7.5pt;
      color: #64748b;
      margin-top: 2px;
    }

    .page-break {
      page-break-before: always;
    }

    .footer {
      margin-top: 30px;
      border-top: 1px solid #e2e8f0;
      padding-top: 10px;
      font-size: 8pt;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  </style>
</head>
<body>

  <!-- CAPA / CABEÇALHO -->
  <div class="header">
    <div>
      <div class="brand">Comissions<span>↗</span></div>
      <div class="brand-sub">Manual Técnico de Integração & Automações CRM</div>
    </div>
    <div class="doc-meta">
      <strong>Plataforma SaaS Comissions</strong><br>
      Integração CRM DataCrazy (Webhooks)<br>
      Versão 1.0 &bull; Novembro/2026
    </div>
  </div>

  <h1>Guia de Integração: Webhooks CRM & Comissões Comerciais</h1>
  <p class="lead-text">
    Este manual técnico documenta os endpoints, contratos de payload JSON, regras de negócio para cálculo de <strong>Show Rate</strong> e <strong>SLA de ciclo comercial</strong>, além da transferência automática de vendas ganhas para apuração de comissões de SDR e Closer.
  </p>

  <!-- 1. VISÃO GERAL -->
  <h2>1. Visão Geral da Arquitetura</h2>
  <p>
    O fluxo substitui o acompanhamento manual de agendamentos por uma esteira 100% automatizada e auditável:
  </p>
  <ul>
    <li><strong>CRM DataCrazy (Origem):</strong> Conforme o lead avança nas etapas (Agendado &rarr; Realizado &rarr; Fechado), o CRM dispara requisições HTTP <code>POST</code>.</li>
    <li><strong>API Comissions (Supabase Edge Function):</strong> Valida a chave de autenticação <code>X-Webhook-Secret</code>, garante a <strong>idempotência</strong> via <code>deal_id</code> (evitando registros duplicados), vincula o lead, SDR e Closer.</li>
    <li><strong>Cálculo Automático de SLAs:</strong> Mede o ciclo em dias corridos entre o primeiro agendamento e a realização da demo.</li>
    <li><strong>Apuração de Comissões:</strong> Ao atingir a fase de negócio ganho (<code>deal_won</code>), registra a comissão discriminando MRR e Setup para SDR e Closer.</li>
    <li><strong>Auditoria em Tempo Real:</strong> Cada chamada recebida é registrada na tabela <code>cm_webhook_logs</code> e fica visível na tela de Automações.</li>
  </ul>

  <!-- 2. ENDPOINTS E CREDENCIAIS -->
  <h2>2. Endpoints e Credenciais de Acesso</h2>
  <table>
    <thead>
      <tr>
        <th style="width: 28%;">Parâmetro</th>
        <th>Valor de Produção</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>URL do Webhook</strong></td>
        <td><code>https://dojpymvpdmuxbcxllwne.supabase.co/functions/v1/comissions-api</code></td>
      </tr>
      <tr>
        <td><strong>Método HTTP</strong></td>
        <td><code>POST</code></td>
      </tr>
      <tr>
        <td><strong>Content-Type</strong></td>
        <td><code>application/json; charset=utf-8</code></td>
      </tr>
      <tr>
        <td><strong>Header Obrigatório</strong></td>
        <td><code>X-Webhook-Secret: quantis_crm_secret_2026</code></td>
      </tr>
      <tr>
        <td><strong>Política de Resposta</strong></td>
        <td>HTTP 200 OK em caso de sucesso ou idempotência; HTTP 401 para chave inválida.</td>
      </tr>
    </tbody>
  </table>

  <!-- 3. MAPEAMENTO DE DADOS -->
  <h2>3. Dicionário de Campos e Mapeamento</h2>
  <div class="card-grid">
    <div class="card">
      <label>Empresas Cadastradas (company_id)</label>
      <div class="val">quantis &bull; frotlog &bull; lb</div>
      <div class="sub">Informe o identificador correspondente da empresa proprietária do lead.</div>
    </div>
    <div class="card">
      <label>Idempotência (deal_id)</label>
      <div class="val">ID Único da Oportunidade</div>
      <div class="sub">Chave primária do CRM (ex: deal-8491). Garante que reenvios não dupliquem dados.</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Campo</th>
        <th>Tipo</th>
        <th>Obrigatório</th>
        <th>Descrição / Regra de Negócio</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><code>event</code></td>
        <td>String</td>
        <td>Sim</td>
        <td>Nome do evento (ex: <code>demo_scheduled</code>, <code>deal_won</code>).</td>
      </tr>
      <tr>
        <td><code>company_id</code></td>
        <td>String</td>
        <td>Sim</td>
        <td>Identificador da empresa no Comissions (ex: <code>quantis</code>).</td>
      </tr>
      <tr>
        <td><code>data.deal_id</code></td>
        <td>String</td>
        <td>Sim</td>
        <td>ID da oportunidade no DataCrazy (usado para idempotência).</td>
      </tr>
      <tr>
        <td><code>data.company_name</code></td>
        <td>String</td>
        <td>Sim*</td>
        <td>Razão social ou nome fantasia do lead (obrigatório no 1º agendamento).</td>
      </tr>
      <tr>
        <td><code>data.contact_name</code></td>
        <td>String</td>
        <td>Não</td>
        <td>Nome do responsável ou decisor no cliente.</td>
      </tr>
      <tr>
        <td><code>data.email</code> / <code>phone</code></td>
        <td>String</td>
        <td>Sim*</td>
        <td>Ao menos um canal de contato para localizar ou criar o lead.</td>
      </tr>
      <tr>
        <td><code>data.sdr_email</code></td>
        <td>String</td>
        <td>Não</td>
        <td>E-mail do SDR para vínculo automático à oportunidade e comissão.</td>
      </tr>
      <tr>
        <td><code>data.closer_email</code></td>
        <td>String</td>
        <td>Não</td>
        <td>E-mail do Closer / Vendedor para condução da demo e comissão.</td>
      </tr>
      <tr>
        <td><code>data.scheduled_at</code></td>
        <td>ISO 8601</td>
        <td>Sim*</td>
        <td>Data e hora agendada (ex: <code>2026-11-10T14:30:00Z</code>).</td>
      </tr>
      <tr>
        <td><code>data.mrr</code> / <code>data.setup</code></td>
        <td>Numeric</td>
        <td>Não</td>
        <td>Valores da proposta em Reais (MRR = Mensalidade, Setup = Implementação).</td>
      </tr>
    </tbody>
  </table>

  <!-- QUEBRA DE PÁGINA PARA O CATÁLOGO DE EVENTOS -->
  <div class="page-break"></div>

  <!-- 4. CATÁLOGO DE EVENTOS -->
  <h2>4. Catálogo Detalhado de Eventos do CRM</h2>

  <h3>A. Evento: demo_scheduled (Novo Agendamento)</h3>
  <p>
    Disparado quando a reunião de demonstração é agendada no CRM. Cria o lead, registra a demonstração salvando a data original de agendamento (imutável) e inicia o contador de remarcações zerado (<code>R: 0</code>).
  </p>
  <pre>{
  "event": "demo_scheduled",
  "company_id": "quantis",
  "data": {
    "deal_id": "deal-8491",
    "company_name": "Aliança Locações de Máquinas",
    "contact_name": "Carlos Eduardo",
    "phone": "11987654321",
    "email": "carlos@alianca.com.br",
    "segment": "Locação de Máquinas",
    "sdr_email": "sdr@quantisgrowth.com",
    "closer_email": "closer@quantisgrowth.com",
    "scheduled_at": "2026-11-10T14:30:00Z",
    "mrr": 697.00,
    "setup": 790.00
  }
}</pre>

  <h3>B. Evento: demo_rescheduled (Remarcação de Demonstração)</h3>
  <p>
    Disparado quando o cliente solicita adiar ou reagendar a reunião. Grava um log com data anterior, nova data e motivo em <code>cm_reschedule_logs</code>, incrementa o contador (<code>R: N</code>) e atualiza a data da reunião.
  </p>
  <pre>{
  "event": "demo_rescheduled",
  "company_id": "quantis",
  "data": {
    "deal_id": "deal-8491",
    "new_date": "2026-11-14T16:00:00Z",
    "reason": "Cliente solicitou alteração por conta de viagem da diretoria"
  }
}</pre>

  <h3>C. Evento: demo_no_show (Não Comparecimento / Falta)</h3>
  <p>
    Disparado quando o lead não comparece à reunião marcada. Define <code>is_completed = false</code> e move o status para <code>aguardando_reagendamento</code>.
  </p>
  <pre>{
  "event": "demo_no_show",
  "data": {
    "deal_id": "deal-8491"
  }
}</pre>

  <h3>D. Evento: demo_completed (Demonstração Realizada)</h3>
  <p>
    Disparado após o Closer conduzir a apresentação. Marca o comparecimento como realizado (<code>is_completed = true</code>) e calcula automaticamente o ciclo em dias (SLA):
  </p>
  <div class="notice">
    <strong>Fórmula do SLA:</strong> cycle_days = differenceInDays(completed_date, first_scheduled_date)
  </div>
  <pre>{
  "event": "demo_completed",
  "data": {
    "deal_id": "deal-8491",
    "completed_at": "2026-11-10T15:30:00Z"
  }
}</pre>

  <h3>E. Evento: deal_won (Venda Fechada / Comissões Apuradas)</h3>
  <p>
    Disparado quando o contrato é assinado. Altera o status para <code>fechado</code> e gera a apuração na tabela <code>cm_sales_commissions</code> discriminando MRR, Setup e o rateio financeiro entre SDR e Closer.
  </p>
  <pre>{
  "event": "deal_won",
  "data": {
    "deal_id": "deal-8491",
    "mrr": 697.00,
    "setup": 790.00,
    "sdr_commission_amount": 50.00,
    "closer_commission_amount": 209.10
  }
}</pre>

  <h3>F. Evento: deal_lost (Oportunidade Perdida / Descarte)</h3>
  <p>
    Disparado caso a negociação não evolua. Altera o status para <code>perdido</code> e arquiva o motivo da perda.
  </p>
  <pre>{
  "event": "deal_lost",
  "data": {
    "deal_id": "deal-8491",
    "reason": "Optou por concorrente com preço inferior"
  }
}</pre>

  <!-- QUEBRA DE PÁGINA PARA GESTÃO E TROUBLESHOOTING -->
  <div class="page-break"></div>

  <!-- 5. INDICADORES COMERCIAIS -->
  <h2>5. Indicadores Comerciais Calculados</h2>
  <table>
    <thead>
      <tr>
        <th>Indicador</th>
        <th>Fórmula / Regra</th>
        <th>Objetivo Operacional</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Show Rate (%)</strong></td>
        <td><code>(Total Realizadas / Total Agendadas) &times; 100</code></td>
        <td>Mede o comparecimento real dos leads nas demonstrações agendadas pelo time de pré-vendas (SDR).</td>
      </tr>
      <tr>
        <td><strong>Média de Remarcações</strong></td>
        <td><code>Soma de reschedule_count / Total Oportunidades</code></td>
        <td>Identifica atritos na agenda e taxa de pontualidade dos leads.</td>
      </tr>
      <tr>
        <td><strong>Ciclo Médio de Demo (SLA)</strong></td>
        <td><code>Média de cycle_days nas demos realizadas</code></td>
        <td>Quantifica o tempo médio em dias corridos desde o agendamento inicial até a apresentação efetiva.</td>
      </tr>
      <tr>
        <td><strong>Pipeline Projetado</strong></td>
        <td><code>Soma de MRR + Setup em demos ativas</code></td>
        <td>Permite ao gestor antecipar a receita futura em fase de negociação e trial.</td>
      </tr>
      <tr>
        <td><strong>Comissões do Mês</strong></td>
        <td><code>Soma das comissões de SDR e Closer em vendas ganhas</code></td>
        <td>Apuração transparente e pronta para conferência financeira e pagamento.</td>
      </tr>
    </tbody>
  </table>

  <!-- 6. FERRAMENTAS E MONITORAMENTO -->
  <h2>6. Ferramentas Integradas na Plataforma Comissions</h2>
  
  <h3>Página de Automações (#Automações)</h3>
  <p>
    Disponível no menu lateral para administradores e gestores:
  </p>
  <ul>
    <li><strong>Botões de Cópia:</strong> Copie com 1 clique a URL do webhook e o token de segurança.</li>
    <li><strong>Dicionário Dinâmico:</strong> Tabela com todos os slugs de empresas e e-mails de colaboradores ativos.</li>
    <li><strong>Simulador de Disparos:</strong> Formulário para enviar requisições de teste em tempo real sem precisar acionar o CRM.</li>
    <li><strong>Logs de Execução (cm_webhook_logs):</strong> Exibe histórico de requisições, status HTTP e botão para inspecionar o payload JSON bruto recebido.</li>
  </ul>

  <h3>Módulo de Demonstrações (#Demonstrações)</h3>
  <ul>
    <li><strong>Badge R: N:</strong> Ao clicar no contador de remarcações, exibe uma linha do tempo detalhada com quem remarcou, datas anterior e nova, e o motivo.</li>
    <li><strong>Toggle de Comparecimento:</strong> Botão rápido para marcar realização da demo (<code>✓ Realizada / ✗ Não realizada</code>).</li>
    <li><strong>Painel de Comissões CRM:</strong> Sub-aba dedicada com status de pagamento (<code>Pendente &rarr; Aprovado &rarr; Pago</code>).</li>
  </ul>

  <!-- 7. TROUBLESHOOTING -->
  <h2>7. Resolução de Problemas (Troubleshooting)</h2>
  <table>
    <thead>
      <tr>
        <th>Código HTTP</th>
        <th>Causa Provável</th>
        <th>Ação Corretiva</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><span class="pill pill-green">200 OK</span></td>
        <td>Sucesso ou evento já registrado (idempotente).</td>
        <td>Nenhuma ação necessária; evento processado com integridade.</td>
      </tr>
      <tr>
        <td><span class="pill pill-red">401 Unauthorized</span></td>
        <td>Header <code>X-Webhook-Secret</code> ausente ou incorreto.</td>
        <td>Verifique se o token configurado no DataCrazy corresponde a <code>quantis_crm_secret_2026</code>.</td>
      </tr>
      <tr>
        <td><span class="pill pill-amber">400 Bad Request</span></td>
        <td>Identificador de lead ausente (sem deal_id, email ou phone).</td>
        <td>Certifique-se de mapear as tags dinâmicas do lead no CRM DataCrazy.</td>
      </tr>
      <tr>
        <td><span class="pill pill-red">500 Server Error</span></td>
        <td>Erro inesperado na base de dados.</td>
        <td>Consulte a tabela <code>cm_webhook_logs</code> na página de Automações para inspecionar a mensagem de erro.</td>
      </tr>
    </tbody>
  </table>

  <!-- RODAPÉ -->
  <div class="footer">
    <div>Comissions &bull; Documentação Técnica de Automações &bull; CRM DataCrazy</div>
    <div>Documento confidencial &bull; Uso interno</div>
  </div>

</body>
</html>
`;

fs.writeFileSync('/tmp/documentacao_automacoes.html', htmlContent);
console.log('HTML gerado com sucesso em /tmp/documentacao_automacoes.html');
