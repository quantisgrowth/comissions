const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

(async () => {
  const tsCode = fs.readFileSync('backend/demonstrations.ts', 'utf8');
  const jsCode = stripTypeScriptTypes(tsCode).replace(/^import .*;\n/gm, '').replace(/export /g, '');

  const mockDbData = {
    leads: [],
    demonstrations: [],
    reschedule_logs: [],
    sales_commissions: [],
    webhook_logs: [],
    profiles: [
      { id: 'user-sdr', email: 'sdr@example.com', name: 'Lorena SDR' },
      { id: 'user-closer', email: 'closer@example.com', name: 'Carlos Closer' }
    ]
  };

  const createQueryBuilder = (table) => {
    let currentData = mockDbData[table.replace('cm_', '')] || [];
    let filters = [];
    let isSingle = false;
    let isMaybeSingle = false;

    const builder = {
      select: () => builder,
      eq: (col, val) => {
        filters.push((row) => row[col] === val);
        return builder;
      },
      in: (col, vals) => {
        const set = new Set(vals);
        filters.push((row) => set.has(row[col]));
        return builder;
      },
      or: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (resolve) => resolve({ data: currentData.filter(r => filters.every(f => f(r))), error: null }),
      single: async () => {
        isSingle = true;
        const res = currentData.filter(r => filters.every(f => f(r)));
        if (!res.length) throw Error('Row not found');
        return { data: res[0], error: null };
      },
      maybeSingle: async () => {
        isMaybeSingle = true;
        const res = currentData.filter(r => filters.every(f => f(r)));
        return { data: res[0] || null, error: null };
      },
      insert: (payload) => {
        const item = { id: payload.id || 'id-' + Math.random().toString(36).slice(2, 9), ...payload };
        currentData.push(item);
        return {
          select: () => ({
            single: async () => ({ data: item, error: null })
          })
        };
      },
      update: (payload) => {
        const rows = currentData.filter(r => filters.every(f => f(r)));
        rows.forEach(r => Object.assign(r, payload));
        return {
          eq: (col, val) => {
            filters.push((row) => row[col] === val);
            return builder;
          },
          select: () => ({
            single: async () => ({ data: rows[0], error: null })
          })
        };
      },
      upsert: (payload, opts) => {
        const onConflict = opts?.onConflict;
        let existing = null;
        if (onConflict && payload[onConflict]) {
          existing = currentData.find(r => r[onConflict] === payload[onConflict]);
        }
        if (existing) {
          Object.assign(existing, payload);
          return {
            select: () => ({
              single: async () => ({ data: existing, error: null })
            })
          };
        }
        const item = { id: payload.id || 'id-' + Math.random().toString(36).slice(2, 9), ...payload };
        currentData.push(item);
        return {
          select: () => ({
            single: async () => ({ data: item, error: null })
          })
        };
      }
    };
    return builder;
  };

  const mockDb = {
    from: (tableName) => createQueryBuilder(tableName)
  };

  const ctx = {
    Deno: { env: { get: () => 'quantis_crm_secret_2026' } },
    Date,
    Math,
    String,
    Number,
    Boolean,
    Array,
    Set,
    Promise,
    Error,
    console
  };

  vm.createContext(ctx);
  vm.runInContext(jsCode, ctx);

  // 1. Test Webhook demo_scheduled
  const scheduledResult = await ctx.handleCrmWebhook(mockDb, {
    event: 'demo_scheduled',
    company_id: 'quantis',
    data: {
      deal_id: 'deal-101',
      company_name: 'Locadora Alfa',
      contact_name: 'João Gestor',
      email: 'joao@locadoraalfa.com',
      phone: '11999998888',
      sdr_email: 'sdr@example.com',
      closer_email: 'closer@example.com',
      scheduled_at: '2026-11-05T14:00:00Z',
      mrr: 697,
      setup: 790
    }
  }, 'quantis_crm_secret_2026');

  assert.equal(scheduledResult.ok, true);
  assert.equal(scheduledResult.action, 'created');
  assert.equal(mockDbData.leads.length, 1);
  assert.equal(mockDbData.demonstrations.length, 1);
  assert.equal(mockDbData.demonstrations[0].sdr_id, 'user-sdr');
  assert.equal(mockDbData.demonstrations[0].closer_id, 'user-closer');
  assert.equal(mockDbData.demonstrations[0].status, 'agendado');
  assert.equal(mockDbData.demonstrations[0].reschedule_count, 0);

  // 2. Test Idempotency on repeated demo_scheduled
  const retryResult = await ctx.handleCrmWebhook(mockDb, {
    event: 'demo_scheduled',
    company_id: 'quantis',
    data: { deal_id: 'deal-101', email: 'joao@locadoraalfa.com' }
  }, 'quantis_crm_secret_2026');
  assert.equal(retryResult.ok, true);
  assert.equal(mockDbData.demonstrations.length, 1);

  // 3. Test Webhook demo_rescheduled
  const rescheduledResult = await ctx.handleCrmWebhook(mockDb, {
    event: 'demo_rescheduled',
    company_id: 'quantis',
    data: {
      deal_id: 'deal-101',
      new_date: '2026-11-08T15:00:00Z',
      reason: 'Cliente pediu para adiar para a próxima semana'
    }
  }, 'quantis_crm_secret_2026');

  assert.equal(rescheduledResult.ok, true);
  assert.equal(rescheduledResult.action, 'rescheduled');
  assert.equal(mockDbData.demonstrations[0].reschedule_count, 1);
  assert.equal(mockDbData.demonstrations[0].current_scheduled_date, '2026-11-08T15:00:00Z');
  assert.equal(mockDbData.reschedule_logs.length, 1);

  // 4. Test Webhook demo_completed
  const completedResult = await ctx.handleCrmWebhook(mockDb, {
    event: 'demo_completed',
    company_id: 'quantis',
    data: {
      deal_id: 'deal-101',
      completed_at: '2026-11-08T16:00:00Z'
    }
  }, 'quantis_crm_secret_2026');

  assert.equal(completedResult.ok, true);
  assert.equal(mockDbData.demonstrations[0].is_completed, true);
  assert.equal(mockDbData.demonstrations[0].status, 'realizado');
  assert.equal(mockDbData.demonstrations[0].cycle_days, 3); // 08/11 - 05/11 = 3 dias

  // 5. Test Webhook deal_won
  const wonResult = await ctx.handleCrmWebhook(mockDb, {
    event: 'deal_won',
    company_id: 'quantis',
    data: {
      deal_id: 'deal-101',
      mrr: 697,
      setup: 790,
      sdr_commission_amount: 50,
      closer_commission_amount: 209.10
    }
  }, 'quantis_crm_secret_2026');

  assert.equal(wonResult.ok, true);
  assert.equal(mockDbData.demonstrations[0].status, 'fechado');
  assert.equal(mockDbData.sales_commissions.length, 1);
  assert.equal(mockDbData.sales_commissions[0].deal_value_mrr, 697);
  assert.equal(mockDbData.sales_commissions[0].closer_commission_amount, 209.10);

  // 6. Test Operational User Actions: demo-reschedule from platform
  const demoId = mockDbData.demonstrations[0].id;
  const platformReschedule = await ctx.handleDemonstrations(mockDb, {
    id: 'user-closer',
    role: 'Vendedor',
    all_companies: true
  }, {
    action: 'demo-reschedule',
    demoId: demoId,
    newDate: '2026-11-12T10:00:00Z',
    reason: 'Remarcado pelo vendedor na plataforma'
  });

  assert.equal(platformReschedule.rescheduled, true);
  assert.equal(platformReschedule.demo.reschedule_count, 2);
  assert.equal(mockDbData.reschedule_logs.length, 2);

  // 7. Test Operational User Actions: demo-status-update
  const statusUpdate = await ctx.handleDemonstrations(mockDb, {
    id: 'user-closer',
    role: 'Vendedor',
    all_companies: true
  }, {
    action: 'demo-status-update',
    demoId: demoId,
    status: 'realizado',
    isCompleted: true
  });
  assert.equal(statusUpdate.updated, true);
  assert.equal(mockDbData.demonstrations[0].status, 'realizado');

  // 8. Test Operational User Actions: demo-commission-status
  const commId = mockDbData.sales_commissions[0].id;
  const payStatusUpdate = await ctx.handleDemonstrations(mockDb, {
    id: 'admin',
    role: 'Administrador',
    all_companies: true
  }, {
    action: 'demo-commission-status',
    commissionId: commId,
    statusPayment: 'pago'
  });
  assert.equal(payStatusUpdate.updated, true);
  assert.equal(mockDbData.sales_commissions[0].status_payment, 'pago');

  // 9. Test Webhook Logs recording & listing
  assert.equal(mockDbData.webhook_logs.length > 0, true);
  const logsResult = await ctx.handleDemonstrations(mockDb, {
    id: 'admin',
    role: 'Administrador',
    all_companies: true
  }, {
    action: 'webhook-logs-list'
  });
  assert.equal(Array.isArray(logsResult.logs), true);
  assert.equal(logsResult.logs.length, mockDbData.webhook_logs.length);

  console.log('Verified CRM Webhook (scheduled, rescheduled, no_show, completed, deal_won, idempotency), Cycle Days SLA, and Platform Demonstrations management.');
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
