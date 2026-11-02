// backend/invite-accept.ts
async function acceptInvite(db2, input) {
  const reply = (error, remaining, locked = false, status = 400) => ({ status, body: { error, ...remaining === void 0 ? {} : { attemptsRemaining: remaining }, locked } });
  if (!/^[a-f0-9]{64}$/.test(input.token || "")) return reply("Convite inv\xE1lido. Solicite um novo link ao administrador.", 0, true);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.token)))).map((b) => b.toString(16).padStart(2, "0")).join("");
  const { data: prior, error: readError } = await db2.from("cm_invites").select("*").eq("token_hash", hash).maybeSingle();
  if (readError) throw readError;
  if (!prior || prior.status === "accepted" || prior.status === "revoked" || prior.expires_at <= (/* @__PURE__ */ new Date()).toISOString() || prior.attempts >= 3) return reply("Convite inv\xE1lido, expirado, utilizado ou bloqueado. Solicite um novo link ao administrador.", 0, true);
  if (prior.status !== "pending") return reply("H\xE1 uma ativa\xE7\xE3o em andamento. Aguarde e tente novamente.", void 0, false, 409);
  const attempt = prior.attempts + 1;
  const { data: invite, error: claimError } = await db2.from("cm_invites").update({ status: "processing", attempts: attempt }).eq("token_hash", hash).eq("status", "pending").eq("attempts", prior.attempts).gt("expires_at", (/* @__PURE__ */ new Date()).toISOString()).select().maybeSingle();
  if (claimError) throw claimError;
  if (!invite) return reply("A ativa\xE7\xE3o est\xE1 sendo processada. Aguarde e tente novamente.", void 0, false, 409);
  const finish = async (count) => {
    const { error } = await db2.from("cm_invites").update({ status: count && attempt >= 3 ? "revoked" : "pending", attempts: count ? attempt : attempt - 1 }).eq("token_hash", hash).eq("status", "processing").eq("attempts", attempt);
    if (error) throw error;
  };
  const invalid = async (message) => {
    await finish(true);
    const remaining = 3 - attempt;
    return reply(remaining ? message + " Voc\xEA tem mais " + remaining + " tentativa(s)." : "Limite de 3 tentativas atingido. Solicite um novo convite ao administrador.", remaining, !remaining);
  };
  if (typeof input.password !== "string" || input.password.length < 12 || input.password.length > 128) return invalid("A senha deve ter entre 12 e 128 caracteres.");
  if (input.confirmPassword !== void 0 && input.password !== input.confirmPassword) return invalid("As senhas n\xE3o coincidem.");
  let person;
  try {
    const result = await db2.from("cm_profiles").select("*").eq("id", invite.profile_id).single();
    if (result.error) throw result.error;
    person = result.data;
  } catch (e) {
    await finish(false);
    throw e;
  }
  if (!person || !person.active || person.auth_id) {
    await db2.from("cm_invites").update({ status: "revoked" }).eq("token_hash", hash);
    return reply("Convite indispon\xEDvel. Solicite ajuda ao administrador.", 0, true);
  }
  let created, createError;
  try {
    const result = await db2.auth.admin.createUser({ email: person.email, password: input.password, email_confirm: true });
    created = result.data;
    createError = result.error;
  } catch (e) {
    await finish(false);
    throw e;
  }
  if (createError || !created?.user) {
    if (createError?.status >= 400 && createError?.status < 500 && ["weak_password", "validation_failed"].includes(createError.code)) return invalid("A senha n\xE3o atende aos requisitos. Escolha uma senha mais forte.");
    await finish(false);
    return reply("N\xE3o foi poss\xEDvel criar o acesso. Tente novamente ou solicite ajuda ao administrador.", void 0, false, 503);
  }
  const { data: linked, error: profileError } = await db2.from("cm_profiles").update({ auth_id: created.user.id }).eq("id", person.id).is("auth_id", null).select("id").maybeSingle();
  if (profileError || !linked) {
    await db2.auth.admin.deleteUser(created.user.id);
    await finish(false);
    return reply("N\xE3o foi poss\xEDvel concluir a ativa\xE7\xE3o. Tente novamente.", void 0, false, 503);
  }
  const { error: completeError } = await db2.from("cm_invites").update({ status: "accepted", used_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("token_hash", hash).eq("status", "processing");
  if (completeError) throw completeError;
  return { status: 200, body: { email: person.email } };
}

// backend/commission-schedule.js
function commissionIsoDate(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && (/* @__PURE__ */ new Date(v + "T00:00:00Z")).toISOString().slice(0, 10) === v;
}
function commissionNextMonth(received) {
  if (!commissionIsoDate(received)) return null;
  const [y, m] = received.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}
function commissionScheduledDate(company, received, individual) {
  const month = commissionNextMonth(received);
  if (!month) return null;
  if (commissionIsoDate(individual) && individual.startsWith(month + "-")) return individual;
  const override = company?.commissionPayDates?.[received.slice(0, 7)];
  if (commissionIsoDate(override) && override.startsWith(month + "-")) return override;
  const day = company?.commissionPayDay;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const [y, m] = month.split("-").map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return month + "-" + String(Math.min(day, last)).padStart(2, "0");
}
function validateCommissionCalendar(company) {
  const day = company.commissionPayDay;
  if (day !== void 0 && day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) throw Error("Informe um dia padr\xE3o entre 1 e 31.");
  const dates = company.commissionPayDates;
  if (dates !== void 0 && (!dates || typeof dates !== "object" || Array.isArray(dates) || Object.keys(dates).length > 1200)) throw Error("Calend\xE1rio inv\xE1lido.");
  for (const [month, date] of Object.entries(dates || {})) if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !commissionIsoDate(date) || !date.startsWith(commissionNextMonth(month + "-01") + "-")) throw Error("A data de pagamento deve ficar no m\xEAs seguinte ao recebimento.");
  return company;
}

// backend/contract-terms.js
function termsDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && (/* @__PURE__ */ new Date(value + "T00:00:00Z")).toISOString().slice(0, 10) === value;
}
function termsMonth(date, n, day) {
  if (!termsDate(date)) throw Error("Data inv\xE1lida.");
  const [y, m, d] = date.split("-").map(Number), v = new Date(Date.UTC(y, m - 1 + n, 1)), last = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth() + 1, 0)).getUTCDate();
  v.setUTCDate(Math.min(day || d, last));
  return v.toISOString().slice(0, 10);
}
function termsDays(date, n) {
  if (!termsDate(date)) throw Error("Data inv\xE1lida.");
  const v = /* @__PURE__ */ new Date(date + "T00:00:00Z");
  v.setUTCDate(v.getUTCDate() + n);
  return v.toISOString().slice(0, 10);
}
function contractPolicy(value = {}) {
  const p = { noticeDays: 30, loyaltyMonths: 0, waivedSetupLoyaltyMonths: 12, penaltyPercent: null, ...value };
  if (p.noticeDays !== 30 || ![p.loyaltyMonths, p.waivedSetupLoyaltyMonths].every((n) => Number.isInteger(n) && n >= 0 && n <= 120) || p.penaltyPercent !== null && (typeof p.penaltyPercent !== "number" || !Number.isFinite(p.penaltyPercent) || p.penaltyPercent < 0 || p.penaltyPercent > 100)) throw Error("Revise a fidelidade e o percentual da multa.");
  return p;
}
function feeDueDate(c, fee) {
  const first = c.firstDue || c.start;
  if (fee === 1) return first;
  const next = c.nextFeeDue || termsMonth(first, 1);
  return termsMonth(next, fee - 2, c.billingDay || Number((c.nextFeeDue ? next : first).slice(-2)));
}
function contractSnapshot(product, waived = false) {
  const policy = contractPolicy(product.contractPolicy);
  return { contractPolicy: policy, setupWaived: !!waived, loyaltyMonths: waived ? policy.waivedSetupLoyaltyMonths : policy.loyaltyMonths };
}
function cancellationQuote(c, invoices, noticeDate, endDate) {
  if (!termsDate(noticeDate) || noticeDate < c.start) throw Error("O aviso deve ser igual ou posterior \xE0 ativa\xE7\xE3o.");
  const minimumEnd = termsDays(noticeDate, 30), effectiveEnd = endDate || minimumEnd;
  if (!termsDate(effectiveEnd) || effectiveEnd < minimumEnd) throw Error("O encerramento deve respeitar 30 dias de aviso pr\xE9vio.");
  if (effectiveEnd > termsMonth(noticeDate, 24)) throw Error("Use uma data de encerramento dentro dos pr\xF3ximos 24 meses.");
  const policy = contractPolicy(c.contractPolicy), loyalty = c.loyaltyMonths ?? 0, loyaltyEnd = termsMonth(c.start, loyalty), round = (n) => Math.round((n + Number.EPSILON) * 100) / 100, days = (a, b) => (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5, existing = invoices.filter((i) => i.contractId === c.id), lines = [];
  let feeBalance = 0, setupBalance = 0, remainingFees = 0, penaltyBase = 0;
  for (let fee = 1; fee <= 1800; fee++) {
    if (c.billingMode === "once" && fee > 1 || c.billingMode === "fixed" && fee > (c.billingMonths || 1)) break;
    const due = feeDueDate(c, fee), next = feeDueDate(c, fee + 1), cycleStart = fee === 1 ? c.start : due;
    if (due >= effectiveEnd && due >= loyaltyEnd) break;
    const invoice = existing.find((i) => i.kind === "fee" && i.fee === fee), amount2 = invoice?.amount ?? c.monthly;
    if (invoice?.archived) continue;
    if (due < effectiveEnd && !invoice?.paidAt) {
      const fraction = c.billingMode === "once" ? 1 : Math.min(1, Math.max(0, days(cycleStart, effectiveEnd) / Math.max(1, days(cycleStart, next)))), value = round(amount2 * fraction);
      if (value > 0) {
        feeBalance += value;
        lines.push({ kind: "fee", fee, due, amount: value, proportional: fraction < 1 });
      }
    }
    if (loyalty > 0 && due >= effectiveEnd && due < loyaltyEnd && !invoice?.paidAt) {
      remainingFees++;
      penaltyBase += amount2;
    }
  }
  if (!c.setupWaived) for (const i of existing.filter((i2) => i2.kind === "setup" && !i2.archived && !i2.paidAt && i2.due <= effectiveEnd)) {
    setupBalance += i.amount;
    lines.push({ kind: "setup", part: i.part, due: i.due, amount: i.amount });
  }
  const penalty = remainingFees > 0 ? policy.penaltyPercent === null ? null : round(penaltyBase * policy.penaltyPercent / 100) : 0;
  return { noticeDate, minimumEnd, effectiveEnd, loyaltyEnd: loyalty ? loyaltyEnd : null, remainingFees, penaltyBase: round(penaltyBase), penaltyPercent: policy.penaltyPercent, feeBalance: round(feeBalance), setupBalance: round(setupBalance), penalty, total: penalty === null ? null : round(feeBalance + setupBalance + penalty), lines };
}

// backend/draft-save.ts
async function createSellerDraft(db2, p, sale, initial, build) {
  if (!["Vendedor", "Colaborador"].includes(p.role) || !(p.modules || ["Vis\xE3o geral", "Contratos", "Comiss\xF5es"]).includes("Contratos")) throw Error("Sem permiss\xE3o para lan\xE7ar vendas.");
  let stored = initial;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (sale?.requestId && stored.data.contracts.some((c) => c.portalRequestId === sale.requestId && c.seller === p.id)) return { version: stored.version, duplicate: true, state: stored.data };
    const next = build(stored.data, p, sale);
    const result = await db2.from("cm_state").update({ data: next, version: stored.version + 1, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", 1).eq("version", stored.version).select("version").maybeSingle();
    if (result.error) throw result.error;
    if (result.data) {
      await db2.from("cm_audit").insert({ actor: p.id, action: "seller-sale" });
      return { version: result.data.version, state: next };
    }
    const fresh = await db2.from("cm_state").select("*").eq("id", 1).single();
    if (fresh.error) throw fresh.error;
    stored = fresh.data;
  }
  throw Error("H\xE1 altera\xE7\xF5es simult\xE2neas. Seus campos foram mantidos; tente salvar o rascunho novamente.");
}

// backend/domain.ts
var today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(/* @__PURE__ */ new Date());
var cents = (n) => Math.round((n + Number.EPSILON) * 100);
var moneyRound = (n) => cents(n) / 100;
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
var safeIdentifier = (v, numeric = false) => numeric ? typeof v === "number" && Number.isSafeInteger(v) && v > 0 : typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v) && !["__proto__", "prototype", "constructor"].includes(v);
var isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && (/* @__PURE__ */ new Date(v + "T00:00:00Z")).toISOString().slice(0, 10) === v;
var fail = (message) => {
  throw Error(message);
};
var amount = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e8 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-5;
var text = (v, max = 200) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
function normalizedRules(r) {
  return { first: 0, next: 0, setup: 0, devFirst: 0, devSetup: 0, partner: 0, months: 6, ...r };
}
function validateRules(value) {
  const r = normalizedRules(value);
  for (const k of ["first", "next", "setup", "devFirst", "devSetup", "partner"]) if (typeof r[k] !== "number" || !Number.isFinite(r[k]) || r[k] < 0 || r[k] > 100) fail("Percentuais inv\xE1lidos.");
  if (!Number.isInteger(r.months) || r.months < 1 || r.months > 120 || r.first + r.devFirst + r.partner > 100 || r.next + r.partner > 100 || r.setup + r.devSetup > 100) fail("A distribui\xE7\xE3o da comiss\xE3o ultrapassa o limite permitido.");
  return r;
}
function validateIdentifiers(s) {
  for (const key of ["companies", "products", "contracts", "invoices", "goals", "extraCommissions"]) {
    if (!Array.isArray(s[key])) fail("Cadastro incompleto: " + key);
    const ids = /* @__PURE__ */ new Set();
    for (const v of s[key]) {
      if (!v || !safeIdentifier(v.id, key === "contracts") || ids.has(String(v.id))) fail("Identificador inv\xE1lido ou duplicado em " + key + ".");
      ids.add(String(v.id));
      if (key !== "companies" && !safeIdentifier(v.company)) fail("Empresa inv\xE1lida.");
    }
  }
  for (const p of s.products) if (!["Recorrente", "Avulsa"].includes(p.type) && p.type !== void 0) fail("Natureza de produto inv\xE1lida.");
}
function legacySetupSplit(s, i) {
  return ["dev-start", "dev-accept"].some((k) => s.commissionPayments?.[i.id + "-" + k] || s.commissionEdits?.[i.id + "-" + k] || (s.commissionHistory || []).some((h) => h.id === i.id + "-" + k));
}
function financialRows(s) {
  const rows = [];
  for (const i of s.invoices || []) {
    const c = (s.contracts || []).find((c2) => c2.id === i.contractId);
    if (!c) continue;
    const r = normalizedRules(c.rules);
    const line = (person, key, value, condition, label, rate) => {
      const id = i.id + "-" + key, paidAt = s.commissionPayments?.[id] || null, payment = s.commissionPaymentDetails?.[id] || {}, edit = s.commissionEdits?.[id] || {};
      if (!person || value <= 0) return;
      if ((i.archived || c.archived || edit.archived || c.reviewStatus && c.reviewStatus !== "approved") && !paidAt) return;
      rows.push({ id, person, role: key, contract: c, invoice: i, label, rate, amount: paidAt && payment.amountPaid !== void 0 ? payment.amountPaid : edit.amount ?? moneyRound(value), paidAt, payer: paidAt ? payment.payer || edit.payer || "" : c.commissionPayer !== void 0 ? c.commissionPayer : edit.payer || "", released: !!i.paidAt && condition && (c.status === "Ativo" || c.status === "Cancelado" && c.cancellation && i.paidAt && i.paidAt <= c.cancellation.effectiveEnd && i.due < c.cancellation.effectiveEnd) && !i.archived && !c.archived && (!c.reviewStatus || c.reviewStatus === "approved") });
    };
    if (i.kind === "fee") {
      const rate = i.fee === 1 ? r.first : i.fee <= r.months ? r.next : 0;
      line(c.seller, "seller", i.amount * rate / 100, true, "Fee " + i.fee + " \xB7 venda", rate);
      if (i.fee === 1) line(c.dev, "dev", i.amount * r.devFirst / 100, true, "Primeiro fee \xB7 desenvolvimento", r.devFirst);
      if (i.fee <= r.months) line(c.partner, "partner", i.amount * r.partner / 100, true, "Fee \xB7 parceiro", r.partner);
    } else if (i.kind === "setup") {
      line(c.seller, "seller", i.amount * r.setup / 100, true, "Implementa\xE7\xE3o \xB7 venda", r.setup);
      const pool = i.amount * r.devSetup / 100;
      if (legacySetupSplit(s, i)) {
        const half = moneyRound(pool / 2);
        line(c.dev, "dev-start", half, true, "Implementa\xE7\xE3o \xB7 in\xEDcio", r.devSetup / 2);
        line(c.dev, "dev-accept", moneyRound(pool) - half, true, "Implementa\xE7\xE3o \xB7 aceite", r.devSetup / 2);
      } else line(c.dev, "dev-setup", pool, true, "Implementa\xE7\xE3o \xB7 desenvolvimento", r.devSetup);
    }
  }
  for (const e of s.extraCommissions || []) {
    const c = s.contracts.find((c2) => c2.id === e.contractId), i = s.invoices.find((i2) => i2.id === e.invoiceId), paidAt = s.commissionPayments?.[e.id] || null, edit = s.commissionEdits?.[e.id] || {}, detail = s.commissionPaymentDetails?.[e.id] || {};
    if (!c || !i || i.contractId !== c.id) continue;
    if ((c.archived || i.archived || e.cancelled || edit.archived || c.reviewStatus && c.reviewStatus !== "approved") && !paidAt) continue;
    const condition = e.stage === "accepted" ? c.accepted : e.stage === "started" ? c.started : true;
    rows.push({ id: e.id, person: e.person, role: "extra", contract: c, invoice: i, label: "Extraordin\xE1ria", rate: null, amount: paidAt && detail.amountPaid !== void 0 ? detail.amountPaid : edit.amount ?? e.amount, paidAt, payer: paidAt ? detail.payer || edit.payer || "" : c.commissionPayer !== void 0 ? c.commissionPayer : edit.payer || "", released: !!i.paidAt && condition && (c.status === "Ativo" || c.status === "Cancelado" && c.cancellation && i.paidAt <= c.cancellation.effectiveEnd && i.due < c.cancellation.effectiveEnd) && !c.archived && !i.archived && (!c.reviewStatus || c.reviewStatus === "approved") });
  }
  return rows;
}
function memberOf(person, company) {
  return !!person && (person.all_companies || person.companies?.includes(company));
}
function validateParticipants(c, profiles, previous = null) {
  for (const key of ["seller", "dev", "partner"]) {
    const id = c[key] || "";
    if (id && !safeIdentifier(id)) fail("Participante inv\xE1lido.");
    if (id && (!previous || id !== previous[key])) {
      const person = profiles.find((v) => v.id === id);
      if (!person || !person.active || !memberOf(person, c.company)) fail("O participante precisa estar ativo e vinculado \xE0 empresa.");
    }
  }
}
function protectPaid(old, next) {
  const paid = financialRows(old).filter((x) => x.paidAt);
  for (const row of paid) {
    const c = next.contracts.find((c2) => c2.id === row.contract.id), i = next.invoices.find((i2) => i2.id === row.invoice.id);
    if (!c || !i) fail("N\xE3o \xE9 poss\xEDvel remover registros com pagamentos.");
    for (const key of ["company", "product", "monthly", "setup", "seller", "dev", "partner", "start", "rules", "version"]) if (!same(c[key], row.contract[key])) fail("Desfa\xE7a os pagamentos vinculados antes de alterar os valores, a pol\xEDtica ou os participantes do contrato.");
    for (const key of ["company", "contractId", "kind", "fee", "part", "amount", "due"]) if (!same(i[key], row.invoice[key])) fail("Uma cobran\xE7a com comiss\xE3o paga n\xE3o pode ser alterada.");
    if (i.paidAt !== row.invoice.paidAt) fail("Desfa\xE7a o pagamento da comiss\xE3o antes do recebimento.");
    const oldEdit = old.commissionEdits?.[row.id] || {}, newEdit = next.commissionEdits?.[row.id] || {};
    if (!same(oldEdit.amount, newEdit.amount) || newEdit.archived) fail("Desfa\xE7a o pagamento antes de ajustar ou excluir a comiss\xE3o.");
  }
}
function validateTransition(old, next, p, profiles = []) {
  validateIdentifiers(next);
  const access = (company) => memberOf(p, company), has = (m) => p.role === "Administrador" || (p.modules || ["Vis\xE3o geral", "Empresas", "Contratos", "Receb\xEDveis", "Comiss\xF5es", "Produtos e regras", "Metas"]).includes(m);
  const prior = (key, id) => (old[key] || []).find((v) => v.id === id);
  for (const key of ["products", "contracts", "invoices", "extraCommissions"]) for (const v of old[key] || []) if (!next[key].some((n) => n.id === v.id)) fail("Use arquivamento para preservar o hist\xF3rico.");
  for (const v of next.companies) validateCommissionCalendar(v);
  for (const v of next.companies) if (!text(v.name, 160) && !same(v, prior("companies", v.id))) fail("Nome de empresa inv\xE1lido.");
  for (const v of next.products) {
    const prev = prior("products", v.id);
    if (same(v, prev)) continue;
    if (!text(v.name) || !["Recorrente", "Avulsa"].includes(v.type) || !Number.isInteger(v.version) || v.version < 1) fail("Produto inv\xE1lido.");
    validateRules(v.rules);
    for (const k of ["baseMonthly", "baseSetup"]) if (v[k] != null && !amount(v[k])) fail("Pre\xE7o base inv\xE1lido.");
    if (prev && prev.type !== v.type && old.contracts.some((c) => c.product === v.id)) fail("Produto com contratos n\xE3o pode mudar de natureza.");
  }
  for (const product of next.products) {
    if (!same(product, prior("products", product.id))) {
      billingPolicy(product);
      contractPolicy(product.contractPolicy);
    }
  }
  const slots = /* @__PURE__ */ new Set();
  for (const i of next.invoices) {
    const prev = prior("invoices", i.id);
    if (prev) {
      for (const key of ["company", "contractId", "kind", "fee", "part"]) if (!same(i[key], prev[key])) fail("O v\xEDnculo e a parcela de uma cobran\xE7a existente n\xE3o podem ser alterados.");
    }
    if (!i.archived) {
      const slot = JSON.stringify([i.contractId, i.kind, i.kind === "setup" ? i.part : i.fee]);
      if (slots.has(slot)) fail("J\xE1 existe uma cobran\xE7a ativa para esta parcela do contrato.");
      slots.add(slot);
    }
    if (i.kind === "fee" && i.fee === 1 && !i.archived && !same(i.due, prev?.due)) {
      const c = next.contracts.find((c2) => c2.id === i.contractId), before = prior("contracts", i.contractId);
      if (c && before && c.firstDue !== i.due) {
        c.nextFeeDue ??= old.invoices.find((row) => row.contractId === c.id && row.kind === "fee" && row.fee === 2 && !row.archived)?.due || termsMonth(before.firstDue || before.start, 1);
        c.billingDay ??= Number((c.nextFeeDue === termsMonth(before.firstDue || before.start, 1) ? before.firstDue || before.start : c.nextFeeDue).slice(-2));
        c.firstDue = i.due;
      }
    }
  }
  for (const c of next.contracts) {
    const prev = prior("contracts", c.id);
    if (same(c, prev)) continue;
    if (!text(c.client) || !text(c.plan || next.products.find((v) => v.id === c.product)?.name) || !amount(c.monthly) || !amount(c.setup) || !isDate(c.start) || !["Ativo", "Cancelado", "Pendente"].includes(c.status) || c.firstDue && !isDate(c.firstDue)) fail("Revise valores, datas e dados do contrato.");
    if (c.firstDue && c.firstDue < c.start) fail("A ativa\xE7\xE3o n\xE3o pode ser posterior ao primeiro vencimento.");
    validateRules(c.rules);
    validateParticipants(c, profiles, prev);
    for (const key of ["started", "accepted", "archived"]) if (c[key] !== void 0 && typeof c[key] !== "boolean") fail("Etapa ou arquivamento inv\xE1lido.");
    if (!same(c.commissionPayer, prev?.commissionPayer)) {
      if (!has("Comiss\xF5es")) fail("Atribuir o pagador exige acesso a Comiss\xF5es.");
      if (c.commissionPayer && !profiles.some((u) => u.id === c.commissionPayer && u.active && ["Administrador", "Gestor"].includes(u.role) && (u.role === "Administrador" || (u.modules || ["Comiss\xF5es"]).includes("Comiss\xF5es")) && memberOf(u, c.company))) fail("Respons\xE1vel pelas comiss\xF5es inv\xE1lido.");
    }
    if (prev && (!same(prev.billingMode, c.billingMode) || !same(prev.billingMonths, c.billingMonths))) fail("A dura\xE7\xE3o da cobran\xE7a contratada deve ser preservada.");
    if (!prev) {
      const b = billingPolicy(next.products.find((v) => v.id === c.product));
      if (c.billingMode !== b.mode || (c.billingMonths || null) !== (b.mode === "fixed" ? b.months : null)) fail("A cobran\xE7a deve seguir o cadastro do produto.");
    }
    if (!prev && !c.seller) fail("Informe o vendedor respons\xE1vel.");
    if (c.reviewStatus && !["draft", "submitted", "returned", "approved"].includes(c.reviewStatus)) fail("Situa\xE7\xE3o de revis\xE3o inv\xE1lida.");
    if (c.accepted && !c.started) fail("Registre o in\xEDcio antes do aceite.");
    if (prev && !same(c.rules, prev.rules) && !has("Comiss\xF5es")) fail("Alterar a pol\xEDtica contratada exige acesso a Comiss\xF5es.");
    if (prev && !same(c.reviewStatus, prev.reviewStatus) || prev && !same(c.reviewHistory, prev.reviewHistory) || prev && !same(c.portalRequestId, prev.portalRequestId)) fail("Use a a\xE7\xE3o de revis\xE3o da venda.");
    if (c.reviewStatus && c.reviewStatus !== "approved" && c.status === "Ativo") fail("Valide a venda antes de ativar o contrato.");
    if (prev && prev.company !== c.company) fail("A empresa do contrato n\xE3o pode ser alterada.");
    if (prev && !same(c.firstDue, prev.firstDue)) {
      if (!has("Receb\xEDveis")) fail("Alterar o primeiro vencimento exige acesso a Receb\xEDveis.");
      const first = next.invoices.find((i) => i.contractId === c.id && i.kind === "fee" && i.fee === 1 && !i.archived);
      if (!first || c.firstDue !== first.due || c.firstDue < c.start) fail("O primeiro vencimento deve corresponder \xE0 cobran\xE7a e ser posterior \xE0 ativa\xE7\xE3o.");
    }
  }
  for (const c of next.contracts) {
    const prev = prior("contracts", c.id);
    if (same(c, prev)) continue;
    contractPolicy(c.contractPolicy);
    if (c.loyaltyMonths !== void 0 && (!Number.isInteger(c.loyaltyMonths) || c.loyaltyMonths < 0 || c.loyaltyMonths > 120) || c.setupWaived !== void 0 && typeof c.setupWaived !== "boolean") fail("Condi\xE7\xE3o de fidelidade inv\xE1lida.");
    if (c.billingDay !== void 0 && (!Number.isInteger(c.billingDay) || c.billingDay < 1 || c.billingDay > 31) || c.nextFeeDue && (!isDate(c.nextFeeDue) || c.nextFeeDue <= (c.firstDue || c.start) || Number(c.nextFeeDue.slice(-2)) !== Math.min(c.billingDay || 31, new Date(Number(c.nextFeeDue.slice(0, 4)), Number(c.nextFeeDue.slice(5, 7)), 0).getDate()))) fail("Revise o dia de cobran\xE7a e o pr\xF3ximo vencimento.");
    if (prev && (!same(c.nextFeeDue, prev.nextFeeDue) || !same(c.billingDay, prev.billingDay)) && !has("Receb\xEDveis")) fail("Alterar o calend\xE1rio exige acesso a Receb\xEDveis.");
    if (prev?.setupWaived !== c.setupWaived && c.setupWaived && next.invoices.some((i) => i.contractId === c.id && i.kind === "setup" && (!i.archived || i.paidAt))) fail("A dispensa deve preservar o hist\xF3rico e retirar as implementa\xE7\xF5es ainda n\xE3o recebidas.");
    if (prev && !same(c.contractPolicy, prev.contractPolicy) && !has("Contratos")) fail("Sem permiss\xE3o para alterar condi\xE7\xF5es.");
    if (!same(c.cancellation, prev?.cancellation) && c.cancellation) {
      const request = c.cancellation;
      if (!isDate(request.noticeDate) || request.noticeDate > today()) fail("Data do aviso inv\xE1lida.");
      const quote = cancellationQuote(c, next.invoices, request.noticeDate, request.effectiveEnd);
      c.cancellation = { ...quote, by: p.id, at: (/* @__PURE__ */ new Date()).toISOString() };
    }
    if (prev?.status === "Ativo" && c.status === "Cancelado" && (!c.cancellation || c.cancellation.effectiveEnd > today() || c.cancellation.total === null)) fail("Registre o aviso de 30 dias e configure a multa antes de encerrar.");
  }
  for (const i of next.invoices) {
    const prev = prior("invoices", i.id), c = next.contracts.find((c2) => c2.id === i.contractId);
    if (same(i, prev) && same(c?.start, prior("contracts", i.contractId)?.start)) continue;
    if (!c || !amount(i.amount) || !isDate(i.due) || !["fee", "setup"].includes(i.kind) || i.kind === "fee" && (!Number.isInteger(i.fee) || i.fee < 1) || i.kind === "setup" && (!Number.isInteger(i.part) || i.part < 1)) fail("Cobran\xE7a inv\xE1lida.");
    if (c.setupWaived && i.kind === "setup" && (!i.archived || i.paidAt)) fail("Implementa\xE7\xE3o dispensada n\xE3o pode gerar cobran\xE7a ou recebimento.");
    if (i.paidAt && (!isDate(i.paidAt) || i.paidAt > today() || i.paidAt < c.start)) fail("Data de recebimento inv\xE1lida.");
    if (i.paidAt && c.reviewStatus && c.reviewStatus !== "approved") fail("Valide a venda antes de receber.");
    if (prev?.paidAt && (i.amount !== prev.amount || i.contractId !== prev.contractId || i.kind !== prev.kind || i.fee !== prev.fee || i.part !== prev.part || i.archived !== prev.archived)) fail("Desfa\xE7a o recebimento antes de editar a cobran\xE7a.");
  }
  for (const e of next.extraCommissions) {
    if (same(e, prior("extraCommissions", e.id))) continue;
    const c = next.contracts.find((c2) => c2.id === e.contractId);
    if (!c || !safeIdentifier(e.person) || ![c.seller, c.dev, c.partner].includes(e.person) || !amount(e.amount) || e.amount <= 0 || !text(e.reason, 500) || e.reason.trim().length < 5 || !["received", "started", "accepted"].includes(e.stage)) fail("Comiss\xE3o extraordin\xE1ria inv\xE1lida.");
  }
  for (const g of next.goals) {
    if (same(g, prior("goals", g.id))) continue;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(g.period)) fail("Per\xEDodo de meta inv\xE1lido.");
    for (const k of ["clients", "actualClients", "revenue", "actualRevenue", "mrr", "actualMrr"]) if (g[k] != null && (!amount(g[k]) || k.toLowerCase().includes("clients") && !Number.isInteger(g[k]))) fail("Valor de meta inv\xE1lido.");
  }
  for (const i of next.invoices) for (const suffix of ["dev-start", "dev-accept"]) if (next.commissionPayments?.[i.id + "-" + suffix] && !old.commissionPayments?.[i.id + "-" + suffix] && !legacySetupSplit(old, i)) fail("O c\xE1lculo da implementa\xE7\xE3o foi atualizado. Recarregue antes de pagar.");
  protectPaid(old, next);
  const rows = financialRows(next), oldRows = financialRows(old);
  const changes = [];
  const batchGroups = /* @__PURE__ */ new Map();
  for (const [id, detail] of Object.entries(next.commissionPaymentDetails || {})) {
    if (old.commissionPayments?.[id] || !next.commissionPayments?.[id] || !detail.batchRequest) continue;
    if (!safeIdentifier(detail.batchRequest)) fail("Identificador do lote inv\xE1lido.");
    const group = batchGroups.get(detail.batchRequest) || [];
    group.push({ id, date: next.commissionPayments[id] });
    batchGroups.set(detail.batchRequest, group);
  }
  const batches = /* @__PURE__ */ new Map();
  for (const [request, group] of batchGroups) {
    if (group.length < 2 || group.length > 100 || group.some((item) => item.date !== group[0].date)) fail("O lote deve ter de 2 a 100 comiss\xF5es com a mesma data.");
    batches.set(request, crypto.randomUUID());
  }
  for (const [id, edit] of Object.entries(next.commissionEdits || {})) {
    const prev = old.commissionEdits?.[id];
    if (same(edit, prev)) continue;
    const row = rows.find((r) => r.id === id) || oldRows.find((r) => r.id === id);
    if (!row || !access(row.contract.company)) fail("Comiss\xE3o inv\xE1lida.");
    if (edit.amount !== void 0 && !amount(edit.amount) || edit.plannedDate && !isDate(edit.plannedDate)) fail("Ajuste de comiss\xE3o inv\xE1lido.");
    if (edit.amount !== void 0 && !same(edit.amount, prev?.amount) && (!text(edit.reason, 500) || edit.reason.trim().length < 5)) fail("Informe o motivo do ajuste.");
    if (edit.payer && !profiles.some((v) => v.id === edit.payer && v.active && ["Administrador", "Gestor"].includes(v.role) && (v.role === "Administrador" || (v.modules || ["Comiss\xF5es"]).includes("Comiss\xF5es")) && memberOf(v, row.contract.company))) fail("Respons\xE1vel pelo pagamento inv\xE1lido.");
    if (edit.plannedDate && edit.plannedDate !== prev?.plannedDate && row.invoice.paidAt && !edit.plannedDate.startsWith(commissionNextMonth(row.invoice.paidAt) + "-")) fail("A previs\xE3o deve ficar no m\xEAs seguinte ao recebimento do cliente.");
    changes.push({ id, action: "edit", before: prev || null, by: p.id, at: (/* @__PURE__ */ new Date()).toISOString() });
  }
  for (const [id, date] of Object.entries(next.commissionPayments || {})) {
    const prev = old.commissionPayments?.[id], oldDetail = old.commissionPaymentDetails?.[id] || {}, detail = next.commissionPaymentDetails?.[id] || {}, row = rows.find((r) => r.id === id), oldRow = oldRows.find((r) => r.id === id);
    if (!row) {
      if (prev === date) continue;
      fail("Evento de comiss\xE3o inv\xE1lido.");
    }
    if (prev && oldDetail.batchId && prev !== date) fail("Para corrigir a data de uma baixa em lote, desfa\xE7a a baixa e registre novamente.");
    const paymentChanged = prev !== date || detail.payer !== oldDetail.payer || detail.method !== oldDetail.method;
    if (paymentChanged) {
      const responsible = prev ? oldDetail.payer || oldRow?.payer : row.contract.commissionPayer !== void 0 ? row.contract.commissionPayer : next.commissionEdits?.[id]?.payer || "";
      if (responsible && responsible !== p.id || detail.payer !== p.id) fail("Somente o respons\xE1vel designado pode confirmar o pagamento.");
      if (!["Pix", "Transfer\xEAncia banc\xE1ria", "TED", "Boleto", "Dinheiro", "Outro"].includes(detail.method)) fail("Informe o meio de pagamento.");
    }
    if (!isDate(date) || date > today() || !row.invoice.paidAt || date < row.invoice.paidAt) fail("Data do pagamento inv\xE1lida.");
    if (!prev && (!row.released || row.amount <= 0)) fail("Esta comiss\xE3o ainda n\xE3o pode ser paga.");
    const scheduledDate = prev ? Object.prototype.hasOwnProperty.call(oldDetail, "scheduledDate") ? oldDetail.scheduledDate : null : commissionScheduledDate(next.companies.find((c) => c.id === row.contract.company), row.invoice.paidAt, next.commissionEdits?.[id]?.plannedDate);
    if (!prev && !scheduledDate) fail("Configure a data de pagamento das comiss\xF5es desta empresa.");
    if ((!prev || prev !== date) && scheduledDate && date < scheduledDate) fail("O pagamento n\xE3o pode ocorrer antes da data programada do m\xEAs seguinte.");
    if ((!prev || detail.payer !== oldDetail.payer) && !profiles.some((v) => v.id === detail.payer && v.active && ["Administrador", "Gestor"].includes(v.role) && (v.role === "Administrador" || (v.modules || ["Comiss\xF5es"]).includes("Comiss\xF5es")) && memberOf(v, row.contract.company))) fail("Selecione um respons\xE1vel autorizado para o pagamento.");
    const batchId = prev ? oldDetail.batchId || null : detail.batchRequest ? batches.get(detail.batchRequest) : null;
    next.commissionPaymentDetails[id] = { ...detail, batchId, scheduledDate, competence: prev ? oldDetail.competence || row.invoice.paidAt.slice(0, 7) : row.invoice.paidAt.slice(0, 7), amountPaid: prev ? oldDetail.amountPaid ?? oldRow?.amount ?? row.amount : row.amount, beneficiary: row.person, contractId: row.contract.id, invoiceId: row.invoice.id, rate: row.rate, ruleVersion: row.contract.version, recordedBy: oldDetail.recordedBy || p.id, recordedAt: oldDetail.recordedAt || (/* @__PURE__ */ new Date()).toISOString() };
    delete next.commissionPaymentDetails[id].batchRequest;
    if (prev !== date || detail.payer !== oldDetail.payer || detail.method !== oldDetail.method) changes.push({ id, action: prev ? "edit-payment" : batchId ? "batch-payment" : "payment", batchId, before: prev ? { date: prev, amount: oldDetail.amountPaid ?? oldRow?.amount } : null, by: p.id, at: (/* @__PURE__ */ new Date()).toISOString() });
  }
  for (const [id, date] of Object.entries(old.commissionPayments || {})) if (!next.commissionPayments?.[id]) {
    if (!has("Comiss\xF5es")) fail("Sem permiss\xE3o para desfazer pagamentos.");
    const responsible = old.commissionPaymentDetails?.[id]?.payer || oldRows.find((r) => r.id === id)?.payer;
    if (responsible && responsible !== p.id) fail("Somente o respons\xE1vel pode desfazer o pagamento.");
    changes.push({ id, action: "undo-payment", before: { date, amount: old.commissionPaymentDetails?.[id]?.amountPaid ?? oldRows.find((r) => r.id === id)?.amount }, by: p.id, at: (/* @__PURE__ */ new Date()).toISOString() });
  }
  next.commissionHistory = [...old.commissionHistory || [], ...changes];
  recordEntityHistory(old, next, p);
  return next;
}
function billingPolicy(product) {
  if (product.type === "Avulsa") return { mode: "once", months: 1 };
  const mode = product.billingMode || "ongoing";
  if (!["ongoing", "fixed"].includes(mode)) throw Error("Dura\xE7\xE3o de cobran\xE7a inv\xE1lida.");
  const months = mode === "fixed" ? product.billingMonths : 12;
  if (!Number.isInteger(months) || months < 1 || months > 120) throw Error("Informe entre 1 e 120 mensalidades no produto.");
  return { mode, months };
}
function extendRecurring(data) {
  const next = structuredClone(data), horizon = today().slice(0, 7);
  let changed = false;
  for (const c of next.contracts) {
    if (c.billingMode !== "ongoing" || c.archived || c.status !== "Ativo" || c.reviewStatus && c.reviewStatus !== "approved") continue;
    const first = c.firstDue || c.start;
    if (!isDate(first)) continue;
    const start = /* @__PURE__ */ new Date(first + "T12:00:00Z"), now = /* @__PURE__ */ new Date(horizon + "-01T12:00:00Z"), months = Math.max(12, (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + now.getUTCMonth() - start.getUTCMonth() + 12);
    for (let n = 0; n < months; n++) {
      if (next.invoices.some((i) => i.contractId === c.id && i.kind === "fee" && i.fee === n + 1)) continue;
      const due = feeDueDate(c, n + 1);
      if (c.cancellation && due >= c.cancellation.effectiveEnd) continue;
      next.invoices.push({ id: crypto.randomUUID(), company: c.company, contractId: c.id, kind: "fee", fee: n + 1, amount: c.monthly, due, paidAt: null });
      changed = true;
    }
  }
  return changed ? recordEntityHistory(data, next, { id: "system" }) : null;
}
function recordEntityHistory(old, next, p) {
  for (const key of ["products", "contracts", "invoices"]) for (const value of next[key]) {
    const prev = (old[key] || []).find((v) => v.id === value.id);
    if (same(value, prev)) continue;
    const changed = Object.keys(value).filter((k) => !["history", "reviewHistory"].includes(k) && !same(value[k], prev?.[k]));
    value.history = [...prev?.history || [], ...changed.length ? [{ action: !prev ? "create" : value.archived && !prev.archived ? "archive" : prev.archived && !value.archived ? "restore" : "edit", by: p.id, at: (/* @__PURE__ */ new Date()).toISOString(), fields: changed, before: prev ? Object.fromEntries(changed.map((k) => [k, prev[k] ?? null])) : null, after: Object.fromEntries(changed.map((k) => [k, value[k] ?? null])) }] : []];
  }
  return next;
}

// backend/portal.ts
function saleContext(data, p, id) {
  if (!safeIdentifier(id, true)) throw Error("Contrato inv\xE1lido.");
  if (p.role !== "Administrador" && !(p.modules || []).includes("Contratos")) throw Error("Acesso ao m\xF3dulo Contratos necess\xE1rio.");
  const c = data.contracts.find((c2) => c2.id === id);
  if (!c || !memberOf(p, c.company)) throw Error("Venda n\xE3o autorizada.");
  const manager = ["Administrador", "Gestor"].includes(p.role);
  if (!manager && ![c.seller, c.dev, c.partner].includes(p.id)) throw Error("Venda n\xE3o autorizada.");
  const saleId = c.saleId || "legacy-" + c.id, items = data.contracts.filter((x) => (x.saleId || "legacy-" + x.id) === saleId && x.company === c.company);
  return { contract: c, items, saleId, manager, canEdit: !c.archived && manager || !c.archived && ["Vendedor", "Colaborador"].includes(p.role) && items.every((x) => x.seller === p.id) && ["draft", "returned"].includes(c.reviewStatus) };
}
function reviewSale(data, p, id, action, body, profiles) {
  const context = saleContext(data, p, id), { contract: c, items, manager } = context;
  if (c.archived) throw Error("Restaure o contrato antes de continuar.");
  const note = String(body.message || "").trim();
  if (note.length > 2e3) throw Error("Mensagem muito longa.");
  if (action === "comment" && !note) throw Error("Escreva uma mensagem.");
  if (action === "submit" && (!["Vendedor", "Colaborador"].includes(p.role) || items.some((x) => x.seller !== p.id) || !["draft", "returned"].includes(c.reviewStatus))) throw Error("Esta venda n\xE3o pode ser enviada.");
  if (["approve", "return"].includes(action) && (!manager || c.reviewStatus !== "submitted")) throw Error("Somente a empresa pode validar uma venda enviada.");
  if (action === "return" && note.length < 5) throw Error("Informe o motivo da devolu\xE7\xE3o.");
  if (!["comment", "submit", "approve", "return"].includes(action)) throw Error("A\xE7\xE3o inv\xE1lida.");
  const next = structuredClone(data), status = action === "submit" ? "submitted" : action === "approve" ? "approved" : action === "return" ? "returned" : null, entry = { id: crypto.randomUUID(), action, message: note, by: p.id, author: p.name, at: (/* @__PURE__ */ new Date()).toISOString() };
  for (const original of items) {
    const item = next.contracts.find((x) => x.id === original.id);
    if (action === "approve") {
      const v = (body.participants || []).find((v2) => v2.id === item.id);
      if (!v) throw Error("Confirme os participantes de todos os produtos.");
      for (const key of ["seller", "dev", "partner"]) item[key] = v[key] || "";
      if (!item.seller) throw Error("Informe o vendedor respons\xE1vel.");
      validateParticipants(item, profiles, null);
      validateRules(item.rules);
      for (const [kind, key] of [["fee", "feePaidAt"], ["setup", "setupPaidAt"]]) {
        const date = v[key] || null;
        if (!date) continue;
        if (p.role !== "Administrador" && !(p.modules || []).includes("Receb\xEDveis")) throw Error("Confirmar recebimentos exige acesso a Receb\xEDveis.");
        if (!isDate(date) || date > today() || date < item.start) throw Error("Data de recebimento inv\xE1lida.");
        const invoice = next.invoices.find((i) => i.contractId === item.id && i.kind === kind && (kind === "fee" ? i.fee === 1 : i.part === 1) && !i.archived);
        if (!invoice) throw Error("Cobran\xE7a n\xE3o encontrada para este recebimento.");
        if (invoice.paidAt && invoice.paidAt !== date) throw Error("O recebimento j\xE1 foi confirmado.");
        invoice.paidAt = date;
      }
      item.status = "Ativo";
    }
    if (status) item.reviewStatus = status;
    if (action === "return" || action === "submit") item.status = "Pendente";
    item.reviewHistory = [...original.reviewHistory || [], entry];
  }
  protectPaid(data, next);
  return recordEntityHistory(data, next, p);
}
function documentInput(v) {
  const types = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };
  if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 180 || !types[v.contentType] || !Number.isInteger(v.size) || v.size < 1 || v.size > 10485760) throw Error("Envie PDF, JPG ou PNG de at\xE9 10 MB.");
  return { name: v.name.trim(), contentType: v.contentType, size: v.size, extension: types[v.contentType] };
}
function fileMatches(type, bytes) {
  if (type === "application/pdf") return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  if (type === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n);
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return false;
}
async function documentsReady(db2) {
  const [probe, bucket] = await Promise.all([db2.from("cm_documents").select("id").limit(1), db2.storage.getBucket("sale-documents")]);
  if (probe.error) {
    if (["42P01", "PGRST205", "42501"].includes(probe.error.code)) return false;
    throw Error("N\xE3o foi poss\xEDvel verificar a configura\xE7\xE3o de documentos.");
  }
  return !bucket.error && !!bucket.data && bucket.data.public === false;
}
async function handlePortal(db2, stored, p, profiles, input) {
  const context = saleContext(stored.data, p, input.contractId), { contract: c, saleId, manager } = context, ready = await documentsReady(db2);
  const mutate = async (next, action) => {
    if (input.version !== stored.version) throw Error("Os dados mudaram. Atualize a p\xE1gina antes de continuar.");
    validateIdentifiers(next);
    const { data, error } = await db2.from("cm_state").update({ data: next, version: stored.version + 1, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", 1).eq("version", stored.version).select("version").maybeSingle();
    if (error || !data) throw Error("N\xE3o foi poss\xEDvel salvar. Atualize os dados e tente novamente.");
    await db2.from("cm_audit").insert({ actor: p.id, action });
    return { version: data.version };
  };
  if (input.action === "portal-load") {
    let files = [];
    if (ready) {
      const { data, error } = await db2.from("cm_documents").select("id,name,content_type,size_bytes,status,uploaded_by,created_at").eq("company", c.company).eq("sale_id", saleId).in("status", ["pending", "ready", "archived"]).order("created_at", { ascending: false });
      if (error) throw Error("N\xE3o foi poss\xEDvel carregar os documentos.");
      files = data || [];
    }
    return { documentsReady: ready, documents: files, reviewStatus: c.reviewStatus || "approved", history: c.reviewHistory || [], changes: manager ? [...context.items.flatMap((item) => [...(item.history || []).map((h) => ({ ...h, source: "Contrato " + (item.code || item.id) })), ...stored.data.invoices.filter((i) => i.contractId === item.id).flatMap((i) => (i.history || []).map((h) => ({ ...h, source: (i.kind === "fee" ? "Fee " + i.fee : "Implementa\xE7\xE3o \xB7 parcela " + i.part) + " \xB7 " + (item.code || item.id) })))]), ...(stored.data.commissionHistory || []).filter((h) => stored.data.invoices.some((i) => context.items.some((item) => item.id === i.contractId) && h.id.startsWith(i.id + "-")) || (stored.data.extraCommissions || []).some((e) => context.items.some((item) => item.id === e.contractId) && h.id === e.id)).map((h) => ({ ...h, source: "Comiss\xE3o" }))] : [], canEdit: context.canEdit, manager };
  }
  if (input.action === "sale-review") {
    if (input.reviewAction === "submit") {
      if (!ready) throw Error("O administrador precisa executar o SQL de documentos antes do envio.");
      const { data, error } = await db2.from("cm_documents").select("id").eq("company", c.company).eq("sale_id", saleId).eq("status", "ready").limit(1);
      if (error || !data?.length) throw Error("Anexe pelo menos um contrato ou documento antes de enviar.");
    }
    return mutate(reviewSale(stored.data, p, input.contractId, input.reviewAction, input, profiles), "sale-" + input.reviewAction);
  }
  if (!ready) throw Error("Execute o SQL de configura\xE7\xE3o dos documentos no Supabase.");
  if (input.action === "document-begin") {
    if (!context.canEdit) throw Error("O envio de documentos est\xE1 dispon\xEDvel para a empresa e para vendas em rascunho ou devolvidas.");
    const v = documentInput(input.file || {});
    const { data: existing, error: countError } = await db2.from("cm_documents").select("id").eq("company", c.company).eq("sale_id", saleId).in("status", ["pending", "ready"]).limit(20);
    if (countError || existing?.length >= 20) throw Error("Limite de 20 documentos por venda.");
    const id = crypto.randomUUID(), path = c.company + "/" + saleId + "/" + id + "." + v.extension;
    const { error } = await db2.from("cm_documents").insert({ id, company: c.company, sale_id: saleId, uploaded_by: p.id, object_path: path, name: v.name, content_type: v.contentType, size_bytes: v.size, status: "pending" });
    if (error) throw Error("N\xE3o foi poss\xEDvel preparar o anexo.");
    const { data, error: signError } = await db2.storage.from("sale-documents").createSignedUploadUrl(path, { upsert: false });
    if (signError) {
      await db2.from("cm_documents").update({ status: "rejected" }).eq("id", id);
      throw Error("N\xE3o foi poss\xEDvel autorizar o envio do arquivo.");
    }
    return { id, url: data.signedUrl };
  }
  if (!safeIdentifier(input.documentId)) throw Error("Documento inv\xE1lido.");
  const { data: doc, error: docError } = await db2.from("cm_documents").select("*").eq("id", input.documentId).eq("company", c.company).eq("sale_id", saleId).maybeSingle();
  if (docError || !doc) throw Error("Documento n\xE3o autorizado.");
  if (input.action === "document-finish") {
    if (context.canEdit && doc.uploaded_by === p.id && doc.status === "ready") return { id: doc.id };
    if (!context.canEdit || doc.uploaded_by !== p.id || doc.status !== "pending") throw Error("Envio n\xE3o autorizado ou j\xE1 finalizado.");
    const { data: blob, error } = await db2.storage.from("sale-documents").download(doc.object_path);
    if (error || !blob) throw Error("O arquivo ainda n\xE3o foi recebido. Tente finalizar novamente.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length !== doc.size_bytes || !fileMatches(doc.content_type, bytes)) {
      await db2.from("cm_documents").update({ status: "rejected" }).eq("id", doc.id);
      await db2.storage.from("sale-documents").remove([doc.object_path]);
      throw Error("O conte\xFAdo do arquivo n\xE3o corresponde ao formato ou tamanho informado.");
    }
    const { error: updateError } = await db2.from("cm_documents").update({ status: "ready" }).eq("id", doc.id).eq("status", "pending");
    if (updateError) throw Error("N\xE3o foi poss\xEDvel finalizar o documento.");
    await db2.from("cm_audit").insert({ actor: p.id, action: "document-upload" });
    return { id: doc.id };
  }
  if (input.action === "document-download") {
    if (doc.status !== "ready") throw Error("Documento indispon\xEDvel.");
    const { data, error } = await db2.storage.from("sale-documents").createSignedUrl(doc.object_path, 60, { download: doc.name });
    if (error) throw Error("N\xE3o foi poss\xEDvel abrir o documento.");
    return { url: data.signedUrl };
  }
  if (input.action === "document-restore") {
    if (!context.canEdit || !manager && doc.uploaded_by !== p.id || doc.status !== "archived") throw Error("Sem permiss\xE3o para restaurar este documento.");
    const { error } = await db2.from("cm_documents").update({ status: "ready" }).eq("id", doc.id);
    if (error) throw Error("N\xE3o foi poss\xEDvel restaurar o documento.");
    await db2.from("cm_audit").insert({ actor: p.id, action: "document-restore" });
    return { id: doc.id };
  }
  if (input.action === "document-archive") {
    if (!context.canEdit || !manager && doc.uploaded_by !== p.id) throw Error("Sem permiss\xE3o para retirar este documento.");
    const { error } = await db2.from("cm_documents").update({ status: doc.status === "ready" ? "archived" : "rejected" }).eq("id", doc.id);
    if (error) throw Error("N\xE3o foi poss\xEDvel retirar o documento.");
    await db2.from("cm_audit").insert({ actor: p.id, action: "document-archive" });
    return { id: doc.id };
  }
  throw Error("A\xE7\xE3o inv\xE1lida.");
}
function rebuildDraft(data, p, input, build) {
  const { contract: c, items, saleId } = saleContext(data, p, input.contractId);
  if (!["Vendedor", "Colaborador"].includes(p.role) || items.some((x) => x.seller !== p.id || x.archived) || !["draft", "returned"].includes(c.reviewStatus)) throw Error("Esta venda n\xE3o pode ser corrigida pelo vendedor.");
  const d = input.sale;
  if (!d || d.company !== c.company || d.items?.length !== items.length) throw Error("Mantenha a empresa e os produtos da venda; corrija os detalhes dos itens existentes.");
  const ids = new Set(items.map((c2) => c2.id)), base = structuredClone(data);
  base.contracts = base.contracts.filter((x) => !ids.has(x.id));
  base.invoices = base.invoices.filter((x) => !ids.has(x.contractId));
  const requestId = c.portalRequestId || crypto.randomUUID(), next = build(base, p, { ...d, requestId }), added = next.contracts.filter((x) => x.portalRequestId === requestId && x.seller === p.id), mapping = /* @__PURE__ */ new Map();
  if (added.length !== items.length) throw Error("N\xE3o foi poss\xEDvel corrigir a venda.");
  added.forEach((x, i) => {
    mapping.set(x.id, items[i].id);
    x.id = items[i].id;
    x.code = items[i].code;
    x.saleId = saleId;
    if (x.product === items[i].product && x.setupWaived === items[i].setupWaived) {
      x.contractPolicy = items[i].contractPolicy || x.contractPolicy;
      x.loyaltyMonths = items[i].loyaltyMonths ?? x.loyaltyMonths;
    }
    x.reviewStatus = c.reviewStatus;
    x.reviewHistory = [...c.reviewHistory || [], { id: crypto.randomUUID(), action: "edit-draft", message: "Dados da venda corrigidos.", by: p.id, author: p.name, at: (/* @__PURE__ */ new Date()).toISOString() }];
  });
  for (const i of next.invoices) if (mapping.has(i.contractId)) i.contractId = mapping.get(i.contractId);
  validateIdentifiers(next);
  return recordEntityHistory(data, next, p);
}

// backend/settings.ts
function personalFields(v) {
  const text2 = (k, max) => {
    if (typeof v[k] !== "string" || v[k].trim().length > max) throw Error("Revise os dados pessoais.");
    return v[k].trim();
  };
  const full_name = text2("full_name", 180), cpf = text2("cpf", 14).replace(/\D/g, ""), contact_email = text2("contact_email", 254).toLowerCase(), phone = text2("phone", 30);
  if (full_name.length < 3 || cpf && !validCPF(cpf) || contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact_email)) throw Error("Revise nome, CPF e e-mail.");
  return { full_name, cpf, contact_email, phone, job_title_id: v.job_title_id || null, ...Object.fromEntries(["bank_name", "bank_agency", "bank_account", "bank_holder", "pix_key"].map((k) => [k, text2(k, 180)])) };
}
function validCPF(v) {
  if (!/^\d{11}$/.test(v) || /^(\d)\1+$/.test(v)) return false;
  return [9, 10].every((n) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(v[i]) * (n + 1 - i);
    return sum * 10 % 11 % 10 === Number(v[n]);
  });
}
async function handleSettings(db2, p, input) {
  const titles = await db2.from("cm_job_titles").select("id,name,active").order("name");
  if (titles.error) {
    if (["42P01", "PGRST205", "42501"].includes(titles.error.code)) {
      if (input.action !== "settings-load") throw Error("Execute o SQL de configura\xE7\xF5es no Supabase primeiro.");
      return { ready: false, profile: { full_name: p.name, contact_email: p.email }, jobs: [], loginEmail: p.email };
    }
    throw titles.error;
  }
  const own = await db2.from("cm_personal_profiles").select("*").eq("profile_id", p.id).maybeSingle();
  if (own.error) throw own.error;
  const row = own.data || {};
  if (input.action === "settings-load") {
    let photo = null;
    if (row.avatar_path) {
      const signed = await db2.storage.from("profile-photos").createSignedUrl(row.avatar_path, 300);
      photo = signed.data?.signedUrl || null;
    }
    return { ready: true, profile: { full_name: row.full_name || p.name, cpf: row.cpf || "", contact_email: row.contact_email || p.email, phone: row.phone || "", job_title_id: row.job_title_id || "", ...Object.fromEntries(["bank_name", "bank_agency", "bank_account", "bank_holder", "pix_key"].map((k) => [k, row[k] || ""])) }, jobs: titles.data, loginEmail: p.email, photo };
  }
  if (input.action === "job-save") {
    if (p.role !== "Administrador") throw Error("Somente administrador pode cadastrar cargos.");
    const name = String(input.name || "").trim();
    if (name.length < 2 || name.length > 100) throw Error("Informe um cargo de 2 a 100 caracteres.");
    const fields = { name, active: input.active !== false };
    const result = input.id ? await db2.from("cm_job_titles").update(fields).eq("id", input.id).select("id").single() : await db2.from("cm_job_titles").insert({ ...fields, created_by: p.id }).select("id").single();
    if (result.error) throw Error("N\xE3o foi poss\xEDvel salvar o cargo. Verifique se j\xE1 existe um cargo com este nome.");
    return { saved: true };
  }
  if (input.action === "settings-save") {
    const fields = personalFields(input.profile || {});
    if (fields.job_title_id && !titles.data.some((j) => j.id === fields.job_title_id && (j.active || row.job_title_id === j.id))) throw Error("Selecione um cargo dispon\xEDvel.");
    const result = await db2.rpc("cm_update_personal_profile", { person_id: p.id, fields });
    if (result.error) throw result.error;
    return { saved: true };
  }
  if (input.action === "photo-begin") {
    if (!["image/jpeg", "image/png"].includes(input.contentType) || !Number.isInteger(input.size) || input.size < 1 || input.size > 2097152) throw Error("Envie uma foto JPG ou PNG de at\xE9 2 MB.");
    const path = p.id + "/" + crypto.randomUUID() + (input.contentType === "image/png" ? ".png" : ".jpg");
    const saved = await db2.from("cm_personal_profiles").upsert({ profile_id: p.id, pending_avatar_path: path, pending_avatar_type: input.contentType, pending_avatar_size: input.size }, { onConflict: "profile_id" });
    if (saved.error) throw saved.error;
    const signed = await db2.storage.from("profile-photos").createSignedUploadUrl(path, { upsert: false });
    if (signed.error) throw Error("Configure o bucket privado de fotos usando o SQL fornecido.");
    return { url: signed.data.signedUrl };
  }
  if (input.action === "photo-finish") {
    if (!row.pending_avatar_path) throw Error("Nenhum envio pendente.");
    const file = await db2.storage.from("profile-photos").download(row.pending_avatar_path);
    if (file.error) throw Error("Envio incompleto. Tente novamente.");
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    if (bytes.length !== row.pending_avatar_size || !fileMatches(row.pending_avatar_type, bytes)) {
      await db2.storage.from("profile-photos").remove([row.pending_avatar_path]);
      throw Error("Arquivo de foto inv\xE1lido.");
    }
    const result = await db2.from("cm_personal_profiles").update({ avatar_path: row.pending_avatar_path, pending_avatar_path: null, pending_avatar_type: null, pending_avatar_size: null, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("profile_id", p.id);
    if (result.error) throw result.error;
    if (row.avatar_path) await db2.storage.from("profile-photos").remove([row.avatar_path]);
    return { saved: true };
  }
  throw Error("A\xE7\xE3o inv\xE1lida.");
}

// backend/admin.ts
async function handleAdmin(db2, p, input, issueInvite2) {
  const isSuper = p.is_superadmin === true || p.role === "Administrador" && (p.all_companies || p.all);
  if (!isSuper) throw Error("Acesso restrito \xE0 administra\xE7\xE3o da plataforma (SuperAdmin).");
  if (input.action === "admin-check") {
    return {
      superadmin: true,
      profile: { id: p.id, name: p.name, email: p.email }
    };
  }
  if (input.action === "admin-tenants-list") {
    const { data: tenants, error } = await db2.from("cm_tenants").select("*").order("created_at", { ascending: false });
    if (error) {
      if (["42P01", "PGRST205"].includes(error.code)) {
        return { ready: false, message: "Execute o script saas-tenants-teams.sql no Supabase.", tenants: [] };
      }
      throw error;
    }
    const { data: profileCounts } = await db2.from("cm_profiles").select("tenant_id, id, active");
    const counts = {};
    for (const row of profileCounts || []) {
      const tid = row.tenant_id || "00000000-0000-0000-0000-000000000001";
      counts[tid] = counts[tid] || { total: 0, active: 0 };
      counts[tid].total++;
      if (row.active) counts[tid].active++;
    }
    const list = (tenants || []).map((t) => ({
      ...t,
      usersCount: counts[t.id]?.total || 0,
      activeUsersCount: counts[t.id]?.active || 0
    }));
    return { ready: true, tenants: list };
  }
  if (input.action === "admin-tenant-save") {
    const v = input.tenant || {};
    const name = String(v.name || "").trim();
    const slug = String(v.slug || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    if (name.length < 2 || name.length > 150) throw Error("Informe o nome da empresa (2 a 150 caracteres).");
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(slug)) throw Error("Slug inv\xE1lido: use de 2 a 64 letras min\xFAsculas, n\xFAmeros e h\xEDfens.");
    const fields = {
      name,
      slug,
      legal_name: v.legal_name ? String(v.legal_name).trim() : null,
      document_cnpj: v.document_cnpj ? String(v.document_cnpj).replace(/\D/g, "") : null,
      plan: ["standard", "pro", "enterprise"].includes(v.plan) ? v.plan : "standard",
      active: v.active !== false,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    let saved;
    if (v.id) {
      const { data, error } = await db2.from("cm_tenants").update(fields).eq("id", v.id).select().single();
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await db2.from("cm_tenants").insert(fields).select().single();
      if (error) {
        if (error.code === "23505") throw Error("J\xE1 existe uma empresa com este identificador (slug).");
        throw error;
      }
      saved = data;
    }
    await db2.from("cm_audit").insert({ actor: p.id, action: "admin-tenant-save" });
    return { saved: true, tenant: saved };
  }
  if (input.action === "admin-tenant-owner-invite") {
    const tenantId = input.tenantId;
    if (!tenantId) throw Error("Identificador da empresa n\xE3o informado.");
    const { data: tenant, error: tenantErr } = await db2.from("cm_tenants").select("*").eq("id", tenantId).maybeSingle();
    if (tenantErr || !tenant) throw Error("Empresa cliente n\xE3o encontrada.");
    const email = String(input.email || "").trim().toLowerCase();
    const name = String(input.name || "").trim();
    if (!name || name.length < 2) throw Error("Informe o nome do administrador da empresa.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Error("E-mail do administrador inv\xE1lido.");
    const moduleNames2 = ["Vis\xE3o geral", "Empresas", "Contratos", "Receb\xEDveis", "Comiss\xF5es", "Produtos e regras", "Metas", "Usu\xE1rios e acessos"];
    const fields = {
      name,
      email,
      role: "Administrador",
      tenant_id: tenant.id,
      all_companies: true,
      companies: [],
      active: true,
      modules: moduleNames2
    };
    const { data: existing } = await db2.from("cm_profiles").select("*").eq("email", email).maybeSingle();
    let target;
    if (existing?.auth_id) throw Error("Este e-mail j\xE1 possui um usu\xE1rio ativo no sistema.");
    if (existing) {
      const { data, error } = await db2.from("cm_profiles").update(fields).eq("id", existing.id).select().single();
      if (error) throw error;
      target = data;
    } else {
      const { data, error } = await db2.from("cm_profiles").insert(fields).select().single();
      if (error) throw error;
      target = data;
    }
    const inviteResult = await issueInvite2(target, p.id);
    await db2.from("cm_audit").insert({ actor: p.id, action: "admin-tenant-owner-invite" });
    return inviteResult;
  }
  throw Error("A\xE7\xE3o administrativa inv\xE1lida.");
}

// backend/teams.ts
async function handleTeams(db2, p, input) {
  const tenantId = p.tenant_id || "00000000-0000-0000-0000-000000000001";
  const isManager = ["Administrador", "Gestor"].includes(p.role);
  if (input.action === "teams-list") {
    let teamsQuery = db2.from("cm_teams").select("*").eq("tenant_id", tenantId);
    if (!isManager) {
      const { data: myMemberships } = await db2.from("cm_team_members").select("team_id").eq("profile_id", p.id).eq("active", true);
      const teamIds = (myMemberships || []).map((m) => m.team_id);
      if (!teamIds.length) return { teams: [], members: [], teamProducts: [], rules: [] };
      teamsQuery = teamsQuery.in("id", teamIds);
    }
    const [teamsRes, membersRes, productsRes, rulesRes] = await Promise.all([
      teamsQuery.order("name"),
      db2.from("cm_team_members").select("*").eq("tenant_id", tenantId).eq("active", true),
      db2.from("cm_team_products").select("*").eq("tenant_id", tenantId),
      db2.from("cm_commission_rules").select("*").eq("tenant_id", tenantId)
    ]);
    if (teamsRes.error) {
      if (["42P01", "PGRST205"].includes(teamsRes.error.code)) {
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
  if (!isManager) throw Error("Sem permiss\xE3o para gerenciar times comerciais.");
  if (input.action === "team-save") {
    const t = input.team || {};
    const name = String(t.name || "").trim();
    const companyId = String(t.company_id || "").trim();
    if (name.length < 2 || name.length > 100) throw Error("Nome do time deve ter entre 2 e 100 caracteres.");
    if (!companyId) throw Error("Selecione a empresa vinculada ao time.");
    if (!p.all_companies && !p.companies.includes(companyId)) {
      throw Error("Voc\xEA n\xE3o tem acesso a esta empresa.");
    }
    const fields = {
      tenant_id: tenantId,
      company_id: companyId,
      name,
      active: t.active !== false
    };
    let result;
    if (t.id) {
      const { data, error } = await db2.from("cm_teams").update(fields).eq("id", t.id).eq("tenant_id", tenantId).select().single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await db2.from("cm_teams").insert(fields).select().single();
      if (error) throw error;
      result = data;
    }
    await db2.from("cm_audit").insert({ actor: p.id, action: "team-save" });
    return { saved: true, team: result };
  }
  if (input.action === "team-member-add") {
    const { teamId, profileId, role } = input;
    if (!teamId || !profileId) throw Error("Dados do membro inv\xE1lidos.");
    const validRoles = ["closer", "sdr", "leader", "bdr", "account_manager"];
    const memberRole = validRoles.includes(role) ? role : "closer";
    const { data: memberProfile } = await db2.from("cm_profiles").select("id, tenant_id").eq("id", profileId).maybeSingle();
    if (!memberProfile || memberProfile.tenant_id && memberProfile.tenant_id !== tenantId) {
      throw Error("Perfil n\xE3o encontrado no tenant.");
    }
    const { data, error } = await db2.from("cm_team_members").upsert({
      tenant_id: tenantId,
      team_id: teamId,
      profile_id: profileId,
      commercial_role: memberRole,
      active: true
    }, { onConflict: "team_id, profile_id" }).select().single();
    if (error) throw error;
    await db2.from("cm_audit").insert({ actor: p.id, action: "team-member-add" });
    return { saved: true, member: data };
  }
  if (input.action === "team-member-remove") {
    const { teamId, profileId } = input;
    const { error } = await db2.from("cm_team_members").update({ active: false }).eq("tenant_id", tenantId).eq("team_id", teamId).eq("profile_id", profileId);
    if (error) throw error;
    await db2.from("cm_audit").insert({ actor: p.id, action: "team-member-remove" });
    return { removed: true };
  }
  if (input.action === "team-products-set") {
    const { teamId, productIds } = input;
    if (!teamId || !Array.isArray(productIds)) throw Error("Dados de produtos do time inv\xE1lidos.");
    await db2.from("cm_team_products").delete().eq("tenant_id", tenantId).eq("team_id", teamId);
    if (productIds.length > 0) {
      const inserts = productIds.map((pid) => ({
        tenant_id: tenantId,
        team_id: teamId,
        product_id: pid
      }));
      const { error } = await db2.from("cm_team_products").insert(inserts);
      if (error) throw error;
    }
    await db2.from("cm_audit").insert({ actor: p.id, action: "team-products-set" });
    return { updated: true };
  }
  if (input.action === "commission-rule-save") {
    const r = input.rule || {};
    if (!r.product_id) throw Error("Produto n\xE3o informado.");
    const validRoles = ["closer", "sdr", "leader", "bdr", "account_manager", "dev", "partner"];
    const roleTarget = validRoles.includes(r.role_target) ? r.role_target : "closer";
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
    if (fields.first_fee_percent < 0 || fields.first_fee_percent > 100 || fields.next_fee_percent < 0 || fields.next_fee_percent > 100 || fields.setup_percent < 0 || fields.setup_percent > 100) {
      throw Error("Percentuais devem estar entre 0% e 100%.");
    }
    let saved;
    if (r.id) {
      const { data, error } = await db2.from("cm_commission_rules").update(fields).eq("id", r.id).eq("tenant_id", tenantId).select().single();
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await db2.from("cm_commission_rules").insert(fields).select().single();
      if (error) throw error;
      saved = data;
    }
    await db2.from("cm_audit").insert({ actor: p.id, action: "commission-rule-save" });
    return { saved: true, rule: saved };
  }
  if (input.action === "commission-rule-delete") {
    const { ruleId } = input;
    if (!ruleId) throw Error("Regra inv\xE1lida.");
    const { error } = await db2.from("cm_commission_rules").delete().eq("id", ruleId).eq("tenant_id", tenantId);
    if (error) throw error;
    await db2.from("cm_audit").insert({ actor: p.id, action: "commission-rule-delete" });
    return { removed: true };
  }
  throw Error("A\xE7\xE3o de times inv\xE1lida.");
}

// backend/demonstrations.ts
async function handleDemonstrations(db2, p, input) {
  const tenantId = p.tenant_id || "00000000-0000-0000-0000-000000000001";
  const isManager = ["Administrador", "Gestor"].includes(p.role);
  if (input.action === "demos-list") {
    let query = db2.from("cm_demonstrations").select("*").eq("tenant_id", tenantId);
    if (input.companyId && input.companyId !== "all") {
      query = query.eq("company_id", input.companyId);
    } else if (!p.all_companies) {
      query = query.in("company_id", p.companies);
    }
    if (!isManager && ["Vendedor", "Colaborador"].includes(p.role)) {
      query = query.or(`sdr_id.eq.${p.id},closer_id.eq.${p.id}`);
    }
    const { data: demos, error: demoErr } = await query.order("current_scheduled_date", { ascending: false });
    if (demoErr) throw demoErr;
    const demoIds = (demos || []).map((d) => d.id);
    const leadIds = [...new Set((demos || []).map((d) => d.lead_id).filter(Boolean))];
    const [leadsRes, reschedulesRes, commissionsRes] = await Promise.all([
      leadIds.length ? db2.from("cm_leads").select("*").in("id", leadIds) : Promise.resolve({ data: [] }),
      demoIds.length ? db2.from("cm_reschedule_logs").select("*").in("demonstration_id", demoIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
      demoIds.length ? db2.from("cm_sales_commissions").select("*").in("demonstration_id", demoIds) : Promise.resolve({ data: [] })
    ]);
    return {
      demos: demos || [],
      leads: leadsRes.data || [],
      reschedules: reschedulesRes.data || [],
      commissions: commissionsRes.data || []
    };
  }
  if (input.action === "demo-save") {
    const d = input.demo || {};
    const companyId = String(d.company_id || "").trim();
    if (!companyId) throw Error("Selecione a empresa vinculada \xE0 demonstra\xE7\xE3o.");
    if (!p.all_companies && !p.companies.includes(companyId)) throw Error("Voc\xEA n\xE3o tem acesso a esta empresa.");
    let leadId = d.lead_id;
    if (!leadId) {
      const companyName = String(d.company_name || "").trim();
      if (!companyName) throw Error("Informe o nome da empresa/lead.");
      const { data: newLead, error: leadErr } = await db2.from("cm_leads").insert({
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
    const scheduledDate = d.current_scheduled_date || d.first_scheduled_date || (/* @__PURE__ */ new Date()).toISOString();
    const fields = {
      tenant_id: tenantId,
      company_id: companyId,
      lead_id: leadId,
      sdr_id: d.sdr_id || null,
      closer_id: d.closer_id || p.id,
      product_id: d.product_id || null,
      status: d.status || "agendado",
      is_completed: d.is_completed === true,
      current_scheduled_date: scheduledDate,
      deal_value_mrr: Number(d.deal_value_mrr || 0),
      deal_value_setup: Number(d.deal_value_setup || 0),
      notes: d.notes || null,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    let result;
    if (d.id) {
      const { data, error } = await db2.from("cm_demonstrations").update(fields).eq("id", d.id).eq("tenant_id", tenantId).select().single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await db2.from("cm_demonstrations").insert({
        ...fields,
        first_scheduled_date: scheduledDate,
        reschedule_count: 0
      }).select().single();
      if (error) throw error;
      result = data;
    }
    await db2.from("cm_audit").insert({ actor: p.id, action: "demo-save" });
    return { saved: true, demo: result };
  }
  if (input.action === "demo-reschedule") {
    const { demoId, newDate, reason } = input;
    if (!demoId || !newDate) throw Error("Dados do reagendamento incompletos.");
    const { data: demo, error: fetchErr } = await db2.from("cm_demonstrations").select("*").eq("id", demoId).eq("tenant_id", tenantId).single();
    if (fetchErr || !demo) throw Error("Demonstra\xE7\xE3o n\xE3o encontrada.");
    await db2.from("cm_reschedule_logs").insert({
      demonstration_id: demoId,
      previous_date: demo.current_scheduled_date,
      new_date: newDate,
      reason: reason ? String(reason).trim() : null,
      actor_id: p.id
    });
    const { data: updated, error: updErr } = await db2.from("cm_demonstrations").update({
      current_scheduled_date: newDate,
      reschedule_count: (demo.reschedule_count || 0) + 1,
      status: "agendado",
      is_completed: false,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", demoId).select().single();
    if (updErr) throw updErr;
    await db2.from("cm_audit").insert({ actor: p.id, action: "demo-reschedule" });
    return { rescheduled: true, demo: updated };
  }
  if (input.action === "demo-status-update") {
    const { demoId, status, isCompleted, lossReason } = input;
    if (!demoId || !status) throw Error("Dados de status incompletos.");
    const { data: demo, error: fetchErr } = await db2.from("cm_demonstrations").select("*").eq("id", demoId).eq("tenant_id", tenantId).single();
    if (fetchErr || !demo) throw Error("Demonstra\xE7\xE3o n\xE3o encontrada.");
    const updates = {
      status,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (isCompleted !== void 0) {
      updates.is_completed = !!isCompleted;
      if (updates.is_completed && !demo.completed_date) {
        const completedAt = (/* @__PURE__ */ new Date()).toISOString();
        updates.completed_date = completedAt;
        const start = new Date(demo.first_scheduled_date).getTime();
        const finish = new Date(completedAt).getTime();
        updates.cycle_days = Math.max(0, Math.round((finish - start) / (1e3 * 60 * 60 * 24)));
      }
    }
    if (status === "perdido" && lossReason) {
      updates.loss_reason = String(lossReason).trim();
    }
    const { data: updated, error: updErr } = await db2.from("cm_demonstrations").update(updates).eq("id", demoId).select().single();
    if (updErr) throw updErr;
    await db2.from("cm_audit").insert({ actor: p.id, action: "demo-status-update" });
    return { updated: true, demo: updated };
  }
  if (input.action === "demo-close-sale") {
    const { demoId, mrr, setup, sdrCommission, closerCommission, contractId } = input;
    if (!demoId) throw Error("Identificador da demonstra\xE7\xE3o inv\xE1lido.");
    const { data: demo, error: fetchErr } = await db2.from("cm_demonstrations").select("*").eq("id", demoId).eq("tenant_id", tenantId).single();
    if (fetchErr || !demo) throw Error("Demonstra\xE7\xE3o n\xE3o encontrada.");
    const completedAt = demo.completed_date || (/* @__PURE__ */ new Date()).toISOString();
    const start = new Date(demo.first_scheduled_date).getTime();
    const finish = new Date(completedAt).getTime();
    const cycleDays = Math.max(0, Math.round((finish - start) / (1e3 * 60 * 60 * 24)));
    await db2.from("cm_demonstrations").update({
      status: "fechado",
      is_completed: true,
      completed_date: completedAt,
      cycle_days: cycleDays,
      deal_value_mrr: Number(mrr || 0),
      deal_value_setup: Number(setup || 0),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", demoId);
    const commissionPayload = {
      demonstration_id: demoId,
      contract_id: contractId || null,
      deal_value_mrr: Number(mrr || 0),
      deal_value_setup: Number(setup || 0),
      closed_date: (/* @__PURE__ */ new Date()).toISOString(),
      sdr_commission_amount: Number(sdrCommission || 0),
      closer_commission_amount: Number(closerCommission || 0),
      status_payment: "pendente"
    };
    const { data: commission, error: commErr } = await db2.from("cm_sales_commissions").upsert(commissionPayload, {
      onConflict: "demonstration_id"
    }).select().single();
    if (commErr) throw commErr;
    await db2.from("cm_audit").insert({ actor: p.id, action: "demo-close-sale" });
    return { closed: true, commission };
  }
  if (input.action === "demo-commission-status") {
    if (!isManager) throw Error("Apenas gestores ou administradores podem alterar o status do pagamento.");
    const { commissionId, statusPayment } = input;
    if (!commissionId || !["pendente", "aprovado", "pago", "cancelado"].includes(statusPayment)) {
      throw Error("Status de pagamento inv\xE1lido.");
    }
    const { data: updated, error: updErr } = await db2.from("cm_sales_commissions").update({
      status_payment: statusPayment
    }).eq("id", commissionId).select().single();
    if (updErr) throw updErr;
    await db2.from("cm_audit").insert({ actor: p.id, action: "demo-commission-status" });
    return { updated: true, commission: updated };
  }
  if (input.action === "demo-assign") {
    const { demoId, closerId, sdrId } = input;
    if (!demoId) throw Error("Demonstra\xE7\xE3o n\xE3o informada.");
    const { data: updated, error: updErr } = await db2.from("cm_demonstrations").update({
      closer_id: closerId || null,
      sdr_id: sdrId || null,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", demoId).select().single();
    if (updErr) throw updErr;
    await db2.from("cm_audit").insert({ actor: p.id, action: "demo-assign" });
    return { updated: true, demo: updated };
  }
  if (input.action === "webhook-logs-list") {
    if (!isManager) throw Error("Apenas administradores e gestores podem visualizar os logs de automa\xE7\xE3o.");
    const { data: logs, error: logsErr } = await db2.from("cm_webhook_logs").select("*").order("created_at", { ascending: false }).limit(input.limit || 50);
    if (logsErr) throw logsErr;
    return { logs: logs || [] };
  }
  throw Error("A\xE7\xE3o de demonstra\xE7\xF5es inv\xE1lida.");
}
async function handleCrmWebhook(db2, payload, secretHeader) {
  const EXPECTED_SECRET = Deno.env.get("CRM_WEBHOOK_SECRET") || "quantis_crm_secret_2026";
  const event = String(payload?.event || payload?.action || "").trim();
  const data = payload?.data || payload || {};
  const companyId = String(payload?.company_id || data?.company_id || "quantis").trim();
  const tenantId = String(payload?.tenant_id || data?.tenant_id || "00000000-0000-0000-0000-000000000001").trim();
  const crmDealId = String(data?.deal_id || data?.id || data?.crm_deal_id || "").trim();
  const recordLog = async (res) => {
    try {
      await db2.from("cm_webhook_logs").insert({
        tenant_id: tenantId,
        company_id: companyId,
        event: event || "unknown",
        deal_id: crmDealId || null,
        status_code: res.status || (res.ok ? 200 : 400),
        status_text: res.ok ? "success" : "error",
        payload,
        response: res,
        error_message: res.error || null,
        created_at: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (e) {
      console.error("Erro ao gravar cm_webhook_logs:", e);
    }
    return res;
  };
  if (secretHeader && secretHeader !== EXPECTED_SECRET) {
    return await recordLog({ ok: false, error: "Chave de webhook inv\xE1lida.", status: 401 });
  }
  if (!crmDealId && !data.phone && !data.email) {
    return await recordLog({ ok: false, error: "Identificador do lead/deal ausente no payload.", status: 400 });
  }
  let lead = null;
  if (data.email) {
    const { data: found } = await db2.from("cm_leads").select("*").eq("email", data.email.toLowerCase()).maybeSingle();
    lead = found;
  }
  if (!lead && data.phone) {
    const { data: found } = await db2.from("cm_leads").select("*").eq("phone", data.phone).maybeSingle();
    lead = found;
  }
  if (!lead) {
    const { data: newLead, error: leadErr } = await db2.from("cm_leads").insert({
      tenant_id: tenantId,
      company_id: companyId,
      company_name: data.company_name || data.title || "Lead CRM " + (data.contact_name || ""),
      contact_name: data.contact_name || data.name || null,
      phone: data.phone || null,
      email: data.email ? String(data.email).toLowerCase() : null,
      segment: data.segment || null
    }).select().single();
    if (leadErr) return await recordLog({ ok: false, error: leadErr.message, status: 500 });
    lead = newLead;
  }
  let sdrId = null;
  let closerId = null;
  if (data.sdr_email) {
    const { data: sdrProfile } = await db2.from("cm_profiles").select("id").eq("email", data.sdr_email.toLowerCase()).maybeSingle();
    if (sdrProfile) sdrId = sdrProfile.id;
  }
  if (data.closer_email) {
    const { data: closerProfile } = await db2.from("cm_profiles").select("id").eq("email", data.closer_email.toLowerCase()).maybeSingle();
    if (closerProfile) closerId = closerProfile.id;
  }
  let existingDemo = null;
  if (crmDealId) {
    const { data: found } = await db2.from("cm_demonstrations").select("*").eq("crm_deal_id", crmDealId).maybeSingle();
    existingDemo = found;
  }
  const scheduledDate = data.scheduled_at || data.current_scheduled_date || (/* @__PURE__ */ new Date()).toISOString();
  if (event === "demo_scheduled") {
    if (existingDemo) {
      return await recordLog({ ok: true, message: "Demonstra\xE7\xE3o j\xE1 cadastrada (idempotente).", demoId: existingDemo.id });
    }
    const { data: demo, error: demoErr } = await db2.from("cm_demonstrations").insert({
      tenant_id: tenantId,
      company_id: companyId,
      crm_deal_id: crmDealId || null,
      lead_id: lead.id,
      sdr_id: sdrId,
      closer_id: closerId,
      status: "agendado",
      is_completed: false,
      first_scheduled_date: scheduledDate,
      current_scheduled_date: scheduledDate,
      reschedule_count: 0,
      deal_value_mrr: Number(data.mrr || data.deal_value_mrr || 0),
      deal_value_setup: Number(data.setup || data.deal_value_setup || 0)
    }).select().single();
    if (demoErr) return await recordLog({ ok: false, error: demoErr.message, status: 500 });
    return await recordLog({ ok: true, action: "created", demoId: demo.id });
  }
  if (!existingDemo) {
    const { data: demo, error: demoErr } = await db2.from("cm_demonstrations").insert({
      tenant_id: tenantId,
      company_id: companyId,
      crm_deal_id: crmDealId || null,
      lead_id: lead.id,
      sdr_id: sdrId,
      closer_id: closerId,
      status: "agendado",
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
  if (event === "demo_rescheduled") {
    const newDate = data.new_date || data.scheduled_at || (/* @__PURE__ */ new Date()).toISOString();
    await db2.from("cm_reschedule_logs").insert({
      demonstration_id: existingDemo.id,
      previous_date: existingDemo.current_scheduled_date,
      new_date: newDate,
      reason: data.reason || "Remarca\xE7\xE3o via CRM DataCrazy"
    });
    await db2.from("cm_demonstrations").update({
      current_scheduled_date: newDate,
      reschedule_count: (existingDemo.reschedule_count || 0) + 1,
      status: "agendado",
      is_completed: false,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", existingDemo.id);
    return await recordLog({ ok: true, action: "rescheduled", demoId: existingDemo.id });
  }
  if (event === "demo_no_show") {
    await db2.from("cm_demonstrations").update({
      status: "aguardando_reagendamento",
      is_completed: false,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", existingDemo.id);
    return await recordLog({ ok: true, action: "no_show", demoId: existingDemo.id });
  }
  if (event === "demo_completed") {
    const completedAt = data.completed_at || (/* @__PURE__ */ new Date()).toISOString();
    const start = new Date(existingDemo.first_scheduled_date).getTime();
    const finish = new Date(completedAt).getTime();
    const cycleDays = Math.max(0, Math.round((finish - start) / (1e3 * 60 * 60 * 24)));
    await db2.from("cm_demonstrations").update({
      status: "realizado",
      is_completed: true,
      completed_date: completedAt,
      cycle_days: cycleDays,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", existingDemo.id);
    return await recordLog({ ok: true, action: "completed", demoId: existingDemo.id });
  }
  if (event === "deal_won") {
    const mrr = Number(data.mrr || data.deal_value_mrr || existingDemo.deal_value_mrr || 0);
    const setup = Number(data.setup || data.deal_value_setup || existingDemo.deal_value_setup || 0);
    const completedAt = existingDemo.completed_date || (/* @__PURE__ */ new Date()).toISOString();
    const start = new Date(existingDemo.first_scheduled_date).getTime();
    const finish = new Date(completedAt).getTime();
    const cycleDays = Math.max(0, Math.round((finish - start) / (1e3 * 60 * 60 * 24)));
    await db2.from("cm_demonstrations").update({
      status: "fechado",
      is_completed: true,
      completed_date: completedAt,
      cycle_days: cycleDays,
      deal_value_mrr: mrr,
      deal_value_setup: setup,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", existingDemo.id);
    await db2.from("cm_sales_commissions").upsert({
      demonstration_id: existingDemo.id,
      deal_value_mrr: mrr,
      deal_value_setup: setup,
      closed_date: (/* @__PURE__ */ new Date()).toISOString(),
      sdr_commission_amount: Number(data.sdr_commission_amount || 0),
      closer_commission_amount: Number(data.closer_commission_amount || 0),
      status_payment: "pendente"
    }, { onConflict: "demonstration_id" });
    return await recordLog({ ok: true, action: "won", demoId: existingDemo.id });
  }
  if (event === "deal_lost") {
    await db2.from("cm_demonstrations").update({
      status: "perdido",
      loss_reason: data.reason || "Perdido no CRM DataCrazy",
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", existingDemo.id);
    return await recordLog({ ok: true, action: "lost", demoId: existingDemo.id });
  }
  return await recordLog({ ok: true, message: "Evento recebido sem a\xE7\xE3o necess\xE1ria." });
}

// backend/index.ts
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
var db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
var site = "https://quantisgrowth.github.io/comissions/";
var collections = ["companies", "products", "contracts", "invoices", "goals", "extraCommissions"];
var sha = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");
var moduleNames = ["Vis\xE3o geral", "Empresas", "Demonstra\xE7\xF5es", "Contratos", "Receb\xEDveis", "Comiss\xF5es", "Produtos e regras", "Metas", "Usu\xE1rios e acessos"];
var modulesFor = (p) => p.role === "Administrador" ? moduleNames : (p.modules || (p.role === "Gestor" ? moduleNames.filter((m) => m !== "Usu\xE1rios e acessos") : ["Vendedor", "Colaborador", "Desenvolvedor"].includes(p.role) ? ["Vis\xE3o geral", "Demonstra\xE7\xF5es", "Contratos", "Comiss\xF5es"] : ["Comiss\xF5es"])).filter((m) => moduleNames.includes(m) && m !== "Usu\xE1rios e acessos");
var hasModule = (p, m) => modulesFor(p).includes(m);
var viewProfile = (p) => ({ id: p.id, name: p.name, email: p.email, role: p.role, all: p.all_companies, companies: p.companies, active: p.active, modules: modulesFor(p), activated: !!p.auth_id, tenant_id: p.tenant_id || "00000000-0000-0000-0000-000000000001", is_superadmin: !!p.is_superadmin });
function scopeState(data, p, profiles) {
  const s = structuredClone(data), access = (id) => p.all_companies || p.companies.includes(id);
  s.companies = s.companies.filter((c) => access(c.id));
  for (const key of collections.filter((k) => k !== "companies")) s[key] = (s[key] || []).filter((v) => access(v.company));
  const scopedIds = new Set(s.invoices.map((i) => i.id));
  const scopedExtra = new Set(s.extraCommissions.map((e) => e.id));
  const ownsEvent = (id) => scopedExtra.has(id) || [...scopedIds].some((key) => id.startsWith(key + "-"));
  for (const key of ["commissionPayments", "commissionPaymentDetails", "commissionEdits"]) s[key] = Object.fromEntries(Object.entries(s[key] || {}).filter(([id]) => ownsEvent(id)));
  s.commissionHistory = (s.commissionHistory || []).filter((e) => ownsEvent(e.id));
  s.users = profiles.filter((u) => p.role === "Administrador" || u.id === p.id || u.all_companies || u.companies.some(access)).map(viewProfile);
  s.users = s.users.map((u) => ({ ...u, payerCompanies: ["Administrador", "Gestor"].includes(u.role) && (u.role === "Administrador" || u.modules.includes("Comiss\xF5es")) ? s.companies.filter((c) => {
    const original = profiles.find((v) => v.id === u.id);
    return original?.active && (original.all_companies || original.companies.includes(c.id));
  }).map((c) => c.id) : [] }));
  if (p.role !== "Administrador") s.users = s.users.map((u) => ({ ...u, email: u.id === p.id ? u.email : "", all: u.id === p.id ? u.all : false, companies: u.companies.filter(access) }));
  if (["Colaborador", "Vendedor", "Desenvolvedor"].includes(p.role)) {
    s.contracts = s.contracts.filter((c) => [c.seller, c.dev, c.partner].includes(p.id));
    let ids = new Set(s.contracts.map((c) => c.id));
    s.invoices = s.invoices.filter((i) => ids.has(i.contractId));
    let invoiceIds = new Set(s.invoices.map((i) => i.id));
    s.extraCommissions = s.extraCommissions.filter((e) => e.person === p.id && ids.has(e.contractId));
    let ownKeys = new Set(s.extraCommissions.map((e) => e.id));
    for (const c of s.contracts) {
      for (const i of s.invoices.filter((i2) => i2.contractId === c.id)) {
        if (c.seller === p.id) ownKeys.add(i.id + "-seller");
        if (c.dev === p.id) for (const k of ["dev", "dev-setup", "dev-start", "dev-accept"]) ownKeys.add(i.id + "-" + k);
        if (c.partner === p.id) ownKeys.add(i.id + "-partner");
      }
      c.rules = { ...c.rules, first: c.seller === p.id ? c.rules.first : 0, next: c.seller === p.id ? c.rules.next : 0, setup: c.seller === p.id ? c.rules.setup : 0, devFirst: c.dev === p.id ? c.rules.devFirst : 0, devSetup: c.dev === p.id ? c.rules.devSetup : 0, partner: c.partner === p.id ? c.rules.partner : 0 };
      for (const key of ["seller", "dev", "partner"]) if (c[key] !== p.id) c[key] = "";
      delete c.history;
    }
    for (const key of ["commissionPayments", "commissionPaymentDetails", "commissionEdits"]) s[key] = Object.fromEntries(Object.entries(s[key] || {}).filter(([id]) => ownKeys.has(id)));
    s.commissionHistory = (s.commissionHistory || []).filter((e) => ownKeys.has(e.id));
    s.products = s.products.filter((v) => ["Vendedor", "Colaborador"].includes(p.role) || hasModule(p, "Produtos e regras") || s.contracts.some((c) => c.product === v.id)).map((v) => ({ id: v.id, name: v.name, company: v.company, type: v.type, baseMonthly: v.baseMonthly, baseSetup: v.baseSetup, contractPolicy: v.contractPolicy, billingMode: v.billingMode, billingMonths: v.billingMonths, archived: v.archived, version: v.version }));
    s.users = s.users.map((u) => u.id === p.id ? u : { id: u.id, name: u.name, role: "Colaborador", active: u.active, all: false, companies: [] });
  }
  delete s.settledCommissions;
  const mods = modulesFor(p);
  if (!mods.includes("Comiss\xF5es")) {
    s.extraCommissions = [];
    s.commissionHistory = [];
    for (const key of ["commissionPayments", "commissionPaymentDetails", "commissionEdits"]) s[key] = {};
    if (["Vendedor", "Colaborador", "Desenvolvedor"].includes(p.role)) for (const c of s.contracts) c.rules = {};
  }
  if (!mods.includes("Metas")) s.goals = [];
  if (!mods.some((m) => ["Vis\xE3o geral", "Contratos", "Receb\xEDveis", "Comiss\xF5es"].includes(m))) {
    s.contracts = [];
    s.invoices = [];
  }
  if (!mods.includes("Produtos e regras") && !mods.includes("Contratos")) s.products = s.products.filter((v) => s.contracts.some((c) => c.product === v.id)).map((v) => ({ id: v.id, name: v.name, company: v.company, type: v.type }));
  return s;
}
function mergeState(old, incoming, p, profiles = []) {
  if (!["Administrador", "Gestor"].includes(p.role)) throw Error("Somente leitura.");
  if (!incoming || JSON.stringify(incoming).length > 4e6) throw Error("Dados inv\xE1lidos.");
  const access = (id) => p.all_companies || p.companies.includes(id);
  let result = structuredClone(old);
  const usedCodes = new Set((old.contracts || []).map((c) => c.code));
  const oldContracts = new Map((old.contracts || []).map((c) => [String(c.id), c]));
  for (const c of incoming.contracts || []) {
    const existing = oldContracts.get(String(c.id));
    if (existing) {
      c.code = existing.code;
      continue;
    }
    const year = String(c.start || (/* @__PURE__ */ new Date()).toISOString()).slice(0, 4);
    let n = 1;
    while (usedCodes.has("CTR-" + year + "-" + String(n).padStart(4, "0"))) n++;
    c.code = "CTR-" + year + "-" + String(n).padStart(4, "0");
    usedCodes.add(c.code);
  }
  for (const key of collections) {
    const permission = { companies: "Empresas", products: "Produtos e regras", contracts: "Contratos", invoices: "Receb\xEDveis", goals: "Metas", extraCommissions: "Comiss\xF5es" };
    if (key === "invoices" && !hasModule(p, "Receb\xEDveis") && hasModule(p, "Contratos")) {
      const oldIds = new Set(old.contracts.map((c) => c.id));
      const additions = (incoming.invoices || []).filter((i) => !oldIds.has(i.contractId));
      if (additions.some((i) => !access(i.company) || !incoming.contracts.some((c) => c.id === i.contractId && c.company === i.company))) throw Error("Cobran\xE7a inv\xE1lida.");
      result.invoices = [...old.invoices, ...additions.map((i) => ({ ...i, paidAt: null }))];
      continue;
    }
    if (!hasModule(p, permission[key])) {
      if (JSON.stringify(incoming[key] || []) !== JSON.stringify(scopeState(old, p, [])[key] || [])) throw Error("M\xF3dulo sem permiss\xE3o de edi\xE7\xE3o.");
      continue;
    }
    if (!Array.isArray(incoming[key])) throw Error("Dados incompletos.");
    if (key === "companies") {
      if (p.role === "Administrador") result[key] = incoming[key];
      continue;
    }
    if (incoming[key].some((v) => !v.company || !access(v.company))) throw Error("Empresa n\xE3o autorizada.");
    let original = new Map((old[key] || []).map((v) => [String(v.id), v]));
    for (const value of incoming[key]) {
      const existing = original.get(String(value.id));
      if (existing && !access(existing.company)) throw Error("ID de outra empresa.");
    }
    result[key] = [...(old[key] || []).filter((v) => !access(v.company)), ...incoming[key]];
  }
  const contracts = new Map(result.contracts.map((c) => [String(c.id), c]));
  const companyIds = new Set(result.companies.map((c) => c.id));
  const products = new Map(result.products.map((c) => [String(c.id), c]));
  for (const key of collections.filter((k) => k !== "companies")) for (const v of result[key]) if (!companyIds.has(v.company)) throw Error("Empresa inv\xE1lida.");
  for (const c of result.contracts) {
    const prod = products.get(String(c.product));
    if (!prod || prod.company !== c.company) throw Error("Produto fora da empresa.");
  }
  for (const i of result.invoices) {
    const c = contracts.get(String(i.contractId));
    if (!c || c.company !== i.company) throw Error("Cobran\xE7a fora do contrato.");
  }
  for (const e of result.extraCommissions) {
    const c = contracts.get(String(e.contractId));
    const i = result.invoices.find((i2) => i2.id === e.invoiceId);
    if (!c || !i || c.company !== e.company || i.contractId !== c.id) throw Error("Comiss\xE3o fora do contrato.");
  }
  const owned = new Set(result.invoices.filter((i) => access(i.company)).map((i) => i.id));
  const extra = new Set(result.extraCommissions.filter((e) => access(e.company)).map((e) => e.id));
  const ownsKey = (key) => extra.has(key) || [...owned].some((id) => key.startsWith(id + "-"));
  for (const key of ["commissionPayments", "commissionPaymentDetails", "commissionEdits"]) {
    if (!hasModule(p, "Comiss\xF5es")) continue;
    const submitted = incoming[key] || {};
    if (Object.keys(submitted).some((k) => !ownsKey(k))) throw Error("Comiss\xE3o de outra empresa.");
    result[key] = { ...Object.fromEntries(Object.entries(old[key] || {}).filter(([k]) => !ownsKey(k))), ...submitted };
  }
  if (hasModule(p, "Comiss\xF5es")) result.commissionHistory = [...(old.commissionHistory || []).filter((v) => !ownsKey(v.id)), ...(incoming.commissionHistory || []).filter((v) => ownsKey(v.id))];
  delete result.users;
  return validateTransition(old, result, p, profiles);
}
function sellerSale(old, p, d) {
  if (!["Vendedor", "Colaborador"].includes(p.role) || !hasModule(p, "Contratos")) throw Error("Sem permiss\xE3o para lan\xE7ar vendas.");
  const validDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!p.companies.includes(d.company) || typeof d.client !== "string" || !d.client.trim() || d.client.length > 200 || !validDate(d.date) || !validDate(d.due) || d.due < d.date || !Array.isArray(d.items) || !d.items.length || d.items.length > 30) throw Error("Revise empresa, cliente, datas e produtos.");
  if (d.requestId && !safeIdentifier(d.requestId)) throw Error("Identificador de envio inv\xE1lido.");
  if (d.requestId && old.contracts.some((c) => c.portalRequestId === d.requestId && c.seller === p.id)) return structuredClone(old);
  const next = structuredClone(old), saleId = crypto.randomUUID(), round = (n) => Math.round(n * 100) / 100, addMonth = (value, n) => {
    let date = /* @__PURE__ */ new Date(value + "T12:00:00Z"), day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + n);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
    return date.toISOString().slice(0, 10);
  };
  for (const item of d.items) {
    if (item.setupWaived !== void 0 && typeof item.setupWaived !== "boolean" || item.setupWaived && item.setupPaidAt) throw Error("Revise a condi\xE7\xE3o e o recebimento da implementa\xE7\xE3o.");
    const prod = old.products.find((v) => v.id === item.product && v.company === d.company && !v.archived);
    if (!prod || ![item.value, item.setup].every((n2) => typeof n2 === "number" && Number.isFinite(n2) && n2 >= 0 && n2 <= 1e8) || !Number.isInteger(item.parts) || item.parts < 1 || item.parts > 60 || item.setup > 0 && Math.round(item.setup * 100) < item.parts) throw Error("Produto, valor ou parcelas inv\xE1lidos.");
    for (const key of ["feePaidAt", "setupPaidAt"]) if (item[key] && (!validDate(item[key]) || item[key] > today() || item[key] < d.date)) throw Error("Revise as datas de recebimento: devem estar entre a venda e hoje.");
    if (item.setupPaidAt && item.setup <= 0) throw Error("N\xE3o h\xE1 implementa\xE7\xE3o para registrar recebimento.");
    const year = d.date.slice(0, 4);
    let n = 1;
    while (next.contracts.some((c2) => c2.code === "CTR-" + year + "-" + String(n).padStart(4, "0"))) n++;
    let id = Date.now() * 1e3 + next.contracts.length;
    while (next.contracts.some((c2) => c2.id === id)) id++;
    validateRules(prod.rules);
    const billing = billingPolicy(prod);
    const c = { id, code: "CTR-" + year + "-" + String(n).padStart(4, "0"), saleId, company: d.company, client: d.client.trim(), product: prod.id, plan: prod.name, monthly: round(item.value), setup: round(item.setup), seller: p.id, dev: "", partner: "", start: d.date, firstDue: d.due, nextFeeDue: d.nextFeeDue || termsMonth(d.due, 1), billingDay: Number(d.billingDay || String(d.nextFeeDue || d.due).slice(-2)), ...contractSnapshot(prod, !!item.setupWaived), status: "Pendente", reviewStatus: "draft", portalRequestId: d.requestId || null, reviewHistory: [], billingMode: billing.mode, billingMonths: billing.mode === "fixed" ? billing.months : null, cycles: billing.months, setupParts: item.parts, reportedFeePaidAt: item.feePaidAt || null, reportedSetupPaidAt: item.setupPaidAt || null, fee: 1, paid: false, started: false, accepted: false, schedule: true, version: prod.version, rules: { first: 0, next: 0, setup: 0, devFirst: 0, devSetup: 0, partner: 0, months: 6, ...prod.rules } };
    if (!termsDate(c.nextFeeDue) || c.nextFeeDue <= c.firstDue || !Number.isInteger(c.billingDay) || c.billingDay < 1 || c.billingDay > 31 || feeDueDate(c, 2) !== c.nextFeeDue) throw Error("Revise o pr\xF3ximo vencimento e o dia da cobran\xE7a.");
    next.contracts.push(c);
    for (let j = 0; j < billing.months; j++) next.invoices.push({ id: crypto.randomUUID(), company: d.company, contractId: id, kind: "fee", fee: j + 1, amount: c.monthly, due: feeDueDate(c, j + 1), paidAt: null, reportedPaidAt: j === 0 ? item.feePaidAt || null : null });
    if (c.setup > 0 && !c.setupWaived) {
      const total = Math.round(c.setup * 100), part = Math.floor(total / item.parts);
      for (let j = 0; j < item.parts; j++) next.invoices.push({ id: crypto.randomUUID(), company: d.company, contractId: id, kind: "setup", part: j + 1, fee: 0, amount: (part + (j === item.parts - 1 ? total - part * item.parts : 0)) / 100, due: addMonth(d.due, j), paidAt: null, reportedPaidAt: j === 0 ? item.setupPaidAt || null : null });
    }
  }
  return next;
}
async function issueInvite(target, actor) {
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((v) => v.toString(16).padStart(2, "0")).join("");
  const { error: revokeError } = await db.from("cm_invites").update({ status: "revoked" }).eq("profile_id", target.id).eq("status", "pending");
  if (revokeError) throw revokeError;
  const expires = new Date(Date.now() + 864e5).toISOString();
  const { error } = await db.from("cm_invites").insert({ token_hash: await sha(raw), profile_id: target.id, expires_at: expires, created_by: actor });
  if (error) throw error;
  return { url: site + "#invite=" + raw, expires, profile: viewProfile(target) };
}
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "", allowOrigin = origin && !origin.startsWith("null") ? origin : "https://quantisgrowth.github.io", headers = { "Access-Control-Allow-Origin": allowOrigin, "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "M\xE9todo inv\xE1lido" }, 405);
  try {
    const input = await req.json();
    if (input.action === "accept") {
      const result = await acceptInvite(db, input);
      return reply(result.body, result.status);
    }
    if (input.action === "crm-webhook" || req.headers.get("x-webhook-secret")) {
      const secret = req.headers.get("x-webhook-secret") || input.secret || null;
      const result = await handleCrmWebhook(db, input.payload || input, secret);
      return reply(result, result.status || 200);
    }
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) return reply({ error: "Entre novamente." }, 401);
    const { data: p } = await db.from("cm_profiles").select("*").eq("auth_id", user.id).eq("active", true).maybeSingle();
    if (!p) return reply({ error: "Acesso n\xE3o autorizado." }, 403);
    if (input.action?.startsWith("admin-")) return reply(await handleAdmin(db, p, input, issueInvite));
    if (["teams-list", "team-save", "team-member-add", "team-member-remove", "team-products-set", "commission-rules-list", "commission-rule-save", "commission-rule-delete"].includes(input.action)) return reply(await handleTeams(db, p, input));
    if (input.action === "demos-list" || input.action?.startsWith("demo-")) return reply(await handleDemonstrations(db, p, input));
    if (["settings-load", "settings-save", "photo-begin", "photo-finish", "job-save"].includes(input.action)) return reply(await handleSettings(db, p, input));
    const needsProfiles = ["load", "save", "profile", "invite", "seller-sale", "sale-review"].includes(input.action);
    const [stateResult, profilesResult] = await Promise.all([db.from("cm_state").select("*").eq("id", 1).single(), needsProfiles ? db.from("cm_profiles").select("*") : Promise.resolve({ data: [] })]);
    const { data: stored, error: storedError } = stateResult;
    if (storedError) throw storedError;
    const profiles = profilesResult.data || [];
    if (input.action === "load") {
      const expanded = extendRecurring(stored.data);
      if (expanded) {
        const saved = await db.from("cm_state").update({ data: expanded, version: stored.version + 1, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", 1).eq("version", stored.version).select("version").maybeSingle();
        if (saved.error || !saved.data) throw Error("Os dados mudaram. Atualize novamente.");
        stored.data = expanded;
        stored.version = saved.data.version;
      }
      validateIdentifiers(stored.data);
      return reply({ state: scopeState(stored.data, p, profiles || []), profile: viewProfile(p), version: stored.version });
    }
    if (input.action === "update-draft") {
      if (input.version !== stored.version) return reply({ error: "Os dados mudaram. Atualize antes de corrigir a venda." }, 409);
      const next = rebuildDraft(stored.data, p, input, sellerSale);
      const { data: updated, error } = await db.from("cm_state").update({ data: next, version: stored.version + 1, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", 1).eq("version", stored.version).select("version").maybeSingle();
      if (error || !updated) throw Error("Conflito ao salvar. Atualize e tente novamente.");
      await db.from("cm_audit").insert({ actor: p.id, action: "update-draft" });
      return reply({ version: updated.version });
    }
    if (["portal-load", "sale-review", "document-begin", "document-finish", "document-download", "document-archive", "document-restore"].includes(input.action)) return reply(await handlePortal(db, stored, p, profiles || [], input));
    if (input.action === "seller-sale") {
      const result = await createSellerDraft(db, p, input.sale, stored, sellerSale);
      return reply({ ...result, state: scopeState(result.state, p, profiles), profile: viewProfile(p) });
    }
    if (input.action === "commission-schedule") {
      if (!["Administrador", "Gestor"].includes(p.role) || !hasModule(p, "Comiss\xF5es")) throw Error("Sem permiss\xE3o para configurar pagamentos.");
      if (!p.all_companies && !p.companies.includes(input.company)) throw Error("Empresa n\xE3o autorizada.");
      if (input.version !== stored.version) throw Error("Os dados mudaram. Atualize antes de configurar.");
      const next = structuredClone(stored.data), company = next.companies.find((c) => c.id === input.company);
      if (!company) throw Error("Empresa inv\xE1lida.");
      const before = { day: company.commissionPayDay ?? null, dates: company.commissionPayDates || {} };
      company.commissionPayDay = input.day === null ? null : input.day;
      company.commissionPayDates = { ...company.commissionPayDates || {} };
      if (input.month) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw Error("Compet\xEAncia inv\xE1lida.");
        if (input.date) company.commissionPayDates[input.month] = input.date;
        else delete company.commissionPayDates[input.month];
      }
      validateCommissionCalendar(company);
      company.history = [...company.history || [], { action: "commission-schedule", by: p.id, at: (/* @__PURE__ */ new Date()).toISOString(), before, after: { day: company.commissionPayDay, dates: company.commissionPayDates } }];
      const { data: updated, error } = await db.from("cm_state").update({ data: next, version: stored.version + 1, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", 1).eq("version", stored.version).select("version").maybeSingle();
      if (error || !updated) throw Error("N\xE3o foi poss\xEDvel salvar o calend\xE1rio. Atualize os dados.");
      await db.from("cm_audit").insert({ actor: p.id, action: "commission-schedule" });
      return reply({ version: updated.version });
    }
    if (input.action === "save") {
      if (input.version !== stored.version) return reply({ error: "Os dados mudaram em outro dispositivo. Recarregue antes de continuar." }, 409);
      const next = mergeState(stored.data, input.state, p, profiles || []);
      const { data: updated, error } = await db.from("cm_state").update({ data: next, version: stored.version + 1, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", 1).eq("version", stored.version).select("version").maybeSingle();
      if (error) throw error;
      if (!updated) return reply({ error: "Conflito de edi\xE7\xE3o. Recarregue a p\xE1gina." }, 409);
      await db.from("cm_audit").insert({ actor: p.id, action: "save" });
      return reply({ version: updated.version, histories: { contracts: Object.fromEntries(next.contracts.filter((c) => p.all_companies || p.companies.includes(c.company)).map((c) => [c.id, c.history || []])), invoices: Object.fromEntries(next.invoices.filter((i) => p.all_companies || p.companies.includes(i.company)).map((i) => [i.id, i.history || []])) }, paymentDetails: scopeState(next, p, profiles || []).commissionPaymentDetails, codes: Object.fromEntries(next.contracts.filter((c) => p.all_companies || p.companies.includes(c.company)).map((c) => [c.id, c.code])) });
    }
    if (p.role !== "Administrador") return reply({ error: "Somente administrador." }, 403);
    if (input.action === "invite-renew") {
      if (typeof input.profileId !== "string") throw Error("Usu\xE1rio inv\xE1lido.");
      const { data: target, error } = await db.from("cm_profiles").select("*").eq("id", input.profileId).maybeSingle();
      if (error) throw error;
      if (!target) throw Error("Usu\xE1rio n\xE3o encontrado.");
      if (!target.active) throw Error("Ative o usu\xE1rio antes de gerar o convite.");
      if (target.auth_id) throw Error("Este usu\xE1rio j\xE1 ativou o acesso. N\xE3o \xE9 necess\xE1rio outro convite.");
      const result = await issueInvite(target, p.id);
      await db.from("cm_audit").insert({ actor: p.id, action: "invite-renew" });
      return reply(result);
    }
    if (input.action === "profile" || input.action === "invite") {
      const v = input.profile || {}, validRoles = ["Administrador", "Gestor", "Colaborador", "Vendedor", "Desenvolvedor"];
      if (!v.name?.trim() || !validRoles.includes(v.role) || !Array.isArray(v.companies)) throw Error("Perfil inv\xE1lido.");
      const ids = new Set(stored.data.companies.map((c) => c.id));
      if (v.companies.some((id) => !ids.has(id))) throw Error("Empresa inv\xE1lida.");
      const all = v.role === "Administrador" || !["Vendedor", "Desenvolvedor"].includes(v.role) && !!v.all;
      if (!Array.isArray(v.modules) || v.modules.some((m) => !moduleNames.includes(m)) || v.role !== "Administrador" && v.modules.includes("Usu\xE1rios e acessos")) throw Error("M\xF3dulos inv\xE1lidos.");
      if (!all && !v.companies.length) throw Error("Selecione uma empresa.");
      if (v.id === p.id && (!v.active || v.role !== "Administrador")) throw Error("Seu acesso deve permanecer ativo.");
      const fields = { name: v.name.trim(), role: v.role, all_companies: all, companies: all ? [] : v.companies, active: v.active !== false, modules: v.role === "Administrador" ? moduleNames : v.modules };
      let target;
      if (input.action === "profile") {
        const { data, error } = await db.from("cm_profiles").update(fields).eq("id", v.id).select().single();
        if (error) throw error;
        target = data;
      } else {
        const email = String(v.email || "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Error("E-mail inv\xE1lido.");
        const existing = (profiles || []).find((u) => u.email === email);
        if (existing?.auth_id) throw Error("Este usu\xE1rio j\xE1 possui acesso.");
        if (existing) {
          const { data, error } = await db.from("cm_profiles").update(fields).eq("id", existing.id).select().single();
          if (error) throw error;
          target = data;
        } else {
          const { data, error } = await db.from("cm_profiles").insert({ ...fields, email }).select().single();
          if (error) throw error;
          target = data;
        }
      }
      if (input.action === "profile") return reply({ profile: viewProfile(target) });
      return reply(await issueInvite(target, p.id));
    }
    return reply({ error: "A\xE7\xE3o inv\xE1lida." }, 400);
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : "Falha na opera\xE7\xE3o." }, 400);
  }
});
