const BASE_URL = "https://smart-energy-auditor-929f3-default-rtdb.firebaseio.com";
const DEVICE_ID = "sea_001";
const BILLING_URL = `${BASE_URL}/devices/${DEVICE_ID}/config/billing.json`;
const PROFILES_URL = `${BASE_URL}/tariffProfiles.json`;
const LIVE_URL = `${BASE_URL}/devices/${DEVICE_ID}/live.json`;

const PROFILE_LABELS = {
  edet_residential_t1r_n3: "Casa residencial T1R - N3",
  edet_residential_t1r_n2: "Casa residencial T1R - N2",
  edet_business_t1g_ri: "Empresa / comercio T1G - RI",
};

const INITIAL_CONSUMPTION = {
  edet_residential_t1r_n3: 392,
  edet_residential_t1r_n2: 1024,
  edet_business_t1g_ri: 409,
};

const state = {
  billing: null,
  profiles: {},
  live: null,
  selectedProfileId: null,
  failedRequests: new Set(),
};

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const number = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

const $ = (id) => document.getElementById(id);
const valueOrFallback = (value, suffix = "") => value === null || value === undefined || value === "" ? "sin dato" : `${value}${suffix}`;
const toNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

async function fetchJSON(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Firebase respondió ${response.status} en ${url}`);
  state.failedRequests.delete(url);
  return response.json();
}

function markFirebaseError(url, message) {
  state.failedRequests.add(url);
  showError(message);
  updateConnectionStatus();
}

async function loadBilling() {
  try {
    state.billing = await fetchJSON(BILLING_URL) || {};
    state.selectedProfileId = state.selectedProfileId || state.billing.activeProfileId || null;
    updateConnectionStatus();
  } catch (error) {
    markFirebaseError(BILLING_URL, `No se pudo leer la configuración de facturación: ${error.message}`);
  }
}

async function loadTariffProfiles() {
  try {
    state.profiles = await fetchJSON(PROFILES_URL) || {};
    updateConnectionStatus();
  } catch (error) {
    markFirebaseError(PROFILES_URL, `No se pudieron leer los perfiles tarifarios: ${error.message}`);
  }
}

async function loadLiveData() {
  try {
    state.live = await fetchJSON(LIVE_URL) || {};
    updateConnectionStatus();
  } catch (error) {
    state.live = null;
    markFirebaseError(LIVE_URL, `No se pudieron leer los datos en tiempo real: ${error.message}`);
  }
  renderLivePanel();
  renderAlerts();
}

function getActiveProfile() {
  return state.profiles?.[state.selectedProfileId] || null;
}

function normalizeTiers(tiers = []) {
  return (Array.isArray(tiers) ? tiers : Object.values(tiers || {}))
    .map((tier, index) => ({ ...tier, index }))
    .sort((a, b) => toNumber(a.fromKWh ?? a.minKWh ?? a.from, 0) - toNumber(b.fromKWh ?? b.minKWh ?? b.from, 0));
}

function getTierName(tier) {
  return tier?.name || tier?.label || tier?.category || tier?.id || (tier ? `Tramo ${tier.index + 1 || ""}` : "sin dato");
}

function getTierLimit(tier) {
  const rawTo = tier?.toKWh ?? tier?.maxKWh ?? tier?.to;
  return rawTo === null || rawTo === undefined ? Infinity : toNumber(rawTo, 0);
}

function getCurrentTier(consumptionKWh, tiers = []) {
  const sorted = normalizeTiers(tiers);
  if (!sorted.length) return null;

  return sorted.find((tier) => {
    const from = toNumber(tier.fromKWh ?? tier.minKWh ?? tier.from, 0);
    const to = tier.toKWh ?? tier.maxKWh ?? tier.to;
    return consumptionKWh >= from && (to === null || to === undefined || consumptionKWh <= Number(to));
  }) || sorted[sorted.length - 1];
}

function getNextTier(currentTier, tiers) {
  const sorted = normalizeTiers(tiers);
  if (!currentTier || !sorted.length) return null;

  const currentIndex = sorted.findIndex((tier) =>
    tier === currentTier ||
    tier.id === currentTier.id ||
    getTierName(tier) === getTierName(currentTier) ||
    tier.index === currentTier.index
  );

  return currentIndex >= 0 && currentIndex < sorted.length - 1 ? sorted[currentIndex + 1] : null;
}

const SUBSIDY_DISCOUNT_ALIASES = [
  "discountARSperKWh",
  "discountArsPerKwh",
  "discountARSpKWh",
  "discountARSPerKWh",
  "discountARSPerKwh",
  "discountArsPerKWh",
  "discountARSperKwh",
  "discountARSPerkWh",
  "discountARSperkWh",
];

function detectSubsidyDiscount(subsidy = {}) {
  const detectedField = SUBSIDY_DISCOUNT_ALIASES.find((field) => subsidy[field] !== undefined && subsidy[field] !== null && subsidy[field] !== "");
  return {
    detectedField: detectedField || null,
    discountARSperKWh: detectedField ? Math.abs(toNumber(subsidy[detectedField], 0)) : 0,
  };
}

function getSubsidyDetails(consumptionKWh, profile) {
  const subsidyConfig = profile?.subsidy || {};
  const { detectedField, discountARSperKWh } = detectSubsidyDiscount(subsidyConfig);
  const limitKWh = toNumber(subsidyConfig.limitKWh, 0);
  const enabled = Boolean(subsidyConfig.enabled);
  const subsidizedKWh = enabled && discountARSperKWh > 0 && limitKWh > 0
    ? Math.min(consumptionKWh, limitKWh)
    : 0;
  const amount = subsidizedKWh * discountARSperKWh;

  return {
    enabled,
    detectedField,
    discountARSperKWh,
    limitKWh,
    subsidizedKWh,
    amount,
    applies: enabled && amount > 0,
  };
}

function calculateEstimatedBill(consumptionKWh, profile, tier) {
  const energyRate = toNumber(profile?.energyChargeARSperKWh ?? profile?.energyCharge, 0);
  const grossEnergy = consumptionKWh * energyRate;
  const subsidy = getSubsidyDetails(consumptionKWh, profile);
  const networkCharge = toNumber(tier?.chargeARS ?? tier?.fixedChargeARS ?? tier?.networkChargeARS ?? tier?.amountARS, 0);
  const otherCharges = Object.values(profile?.otherCharges || {}).reduce((sum, charge) => sum + toNumber(typeof charge === "object" ? charge.amountARS ?? charge.value : charge, 0), 0);
  const subtotal = grossEnergy - subsidy.amount + networkCharge + otherCharges;
  return { grossEnergy, subsidy, networkCharge, otherCharges, subtotal, total: subtotal };
}

function renderProfileSelector() {
  const selector = $("profileSelector");
  const available = state.billing?.frontSelection?.availableProfiles || Object.keys(state.profiles || {});
  selector.innerHTML = "";

  available.forEach((profileId) => {
    const option = document.createElement("option");
    option.value = profileId;
    option.textContent = PROFILE_LABELS[profileId] || profileId;
    selector.appendChild(option);
  });

  if (!available.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "sin dato";
    selector.appendChild(option);
    selector.disabled = true;
  } else {
    selector.disabled = false;
  }

  state.selectedProfileId = state.selectedProfileId || available[0] || null;
  selector.value = state.selectedProfileId || "";
  selector.addEventListener("change", () => {
    state.selectedProfileId = selector.value;
    $("projectionPanel").innerHTML = "";
    $("consumptionInput").value = INITIAL_CONSUMPTION[state.selectedProfileId] ?? 0;
    renderAll();
  });
}

function renderTierCard() {
  const profile = getActiveProfile();
  const consumption = toNumber($("consumptionInput").value, 0);
  const tier = getCurrentTier(consumption, profile?.networkChargeTiers);
  const from = toNumber(tier?.fromKWh ?? tier?.minKWh ?? tier?.from, 0);
  const rawTo = tier?.toKWh ?? tier?.maxKWh ?? tier?.to;
  const to = rawTo === null || rawTo === undefined ? Infinity : toNumber(rawTo, from);
  const span = Number.isFinite(to) ? Math.max(to - from, 1) : Math.max(consumption - from, 1);
  const progress = Math.min(Math.max(((consumption - from) / span) * 100, 0), 100);
  const remaining = Number.isFinite(to) ? Math.max(to - consumption, 0) : null;
  const level = progress >= 95 ? "critical" : progress >= 80 ? "warning" : "";

  $("tierCard").innerHTML = `
    <h2>Categoría tarifaria</h2>
    <p class="metric-large">${valueOrFallback(tier?.name || tier?.label || tier?.category || tier?.id || `Tramo ${tier?.index + 1 || ""}`)}</p>
    <dl class="data-list">
      <div><dt>Rango de kWh</dt><dd>${number.format(from)} - ${Number.isFinite(to) ? number.format(to) : "sin límite"}</dd></div>
      <div><dt>Consumo acumulado</dt><dd>${number.format(consumption)} kWh</dd></div>
      <div><dt>kWh restantes</dt><dd>${remaining === null ? "sin límite" : `${number.format(remaining)} kWh`}</dd></div>
      <div><dt>Avance del tramo</dt><dd>${number.format(progress)}%</dd></div>
    </dl>
    <div class="progress-track"><div class="progress-bar ${level}" style="width:${progress}%"></div></div>
  `;
}


function calculateProjection(consumptionKWh, currentTier, profile, elapsedDays, totalDays) {
  const safeElapsedDays = Math.max(toNumber(elapsedDays, 1), 1);
  const safeTotalDays = Math.max(toNumber(totalDays, safeElapsedDays), 1);
  const tiers = profile?.networkChargeTiers || [];
  const nextTier = getNextTier(currentTier, tiers);
  const upperLimit = getTierLimit(currentTier);
  const hasUpperLimit = Number.isFinite(upperLimit);
  const consumptionDaily = consumptionKWh / safeElapsedDays;
  const projectedConsumption = consumptionDaily * safeTotalDays;
  const remainingKWh = hasUpperLimit ? Math.max(upperLimit - consumptionKWh, 0) : null;
  const daysUntilChange = remainingKWh !== null && consumptionDaily > 0 ? remainingKWh / consumptionDaily : null;
  const projectedTier = getCurrentTier(projectedConsumption, tiers);
  const willExceed = hasUpperLimit && projectedConsumption > upperLimit;
  const status = willExceed && daysUntilChange !== null && daysUntilChange <= Math.max(safeTotalDays - safeElapsedDays, 0)
    ? "critical"
    : willExceed ? "warning" : "ok";

  return {
    currentTier,
    nextTier,
    upperLimit,
    hasUpperLimit,
    remainingKWh,
    consumptionDaily,
    projectedConsumption,
    projectedTier,
    willExceed,
    daysUntilChange,
    status,
  };
}

function calculateSavingsScenario(consumptionKWh, profile, elapsedDays, totalDays, reductionPercent) {
  const currentTier = getCurrentTier(consumptionKWh, profile?.networkChargeTiers);
  const baseProjection = calculateProjection(consumptionKWh, currentTier, profile, elapsedDays, totalDays);
  const reduction = Math.min(Math.max(toNumber(reductionPercent, 0), 0), 100);
  const savedKWh = baseProjection.projectedConsumption * (reduction / 100);
  const reducedConsumption = Math.max(baseProjection.projectedConsumption - savedKWh, 0);
  const baseTier = getCurrentTier(baseProjection.projectedConsumption, profile?.networkChargeTiers);
  const reducedTier = getCurrentTier(reducedConsumption, profile?.networkChargeTiers);
  const baseBill = calculateEstimatedBill(baseProjection.projectedConsumption, profile || {}, baseTier || {});
  const reducedBill = calculateEstimatedBill(reducedConsumption, profile || {}, reducedTier || {});

  return {
    reductionPercent: reduction,
    savedKWh,
    baseConsumption: baseProjection.projectedConsumption,
    reducedConsumption,
    baseTier,
    reducedTier,
    baseCost: baseBill.total,
    reducedCost: reducedBill.total,
    savingsARS: Math.max(baseBill.total - reducedBill.total, 0),
    avoidedTierChange: getTierName(baseTier) !== getTierName(reducedTier),
  };
}

function renderEstimatedBill() {
  const profile = getActiveProfile();
  const consumption = toNumber($("consumptionInput").value, 0);
  const tier = getCurrentTier(consumption, profile?.networkChargeTiers);
  const bill = calculateEstimatedBill(consumption, profile || {}, tier || {});
  const hasProfile = Boolean(profile);
  const moneyOrFallback = (value) => hasProfile ? money.format(value) : "sin dato";
  $("estimatedBill").innerHTML = `
    <h2>Estimación económica</h2>
    <p class="calculation-warning">Estimación orientativa basada en perfiles tarifarios cargados desde facturas de referencia. No reemplaza la liquidación oficial de la distribuidora.</p>
    <div class="bill-lines">
      <div class="bill-line"><span class="label">Cargo de energía bruto</span><strong>${moneyOrFallback(bill.grossEnergy)}</strong></div>
      <div class="bill-line"><span class="label">Subsidio estimado</span><strong>${hasProfile ? `-${money.format(bill.subsidy.amount)}` : "sin dato"}</strong></div>
      <div class="bill-line"><span class="label">Detalle subsidio</span><strong>${hasProfile && bill.subsidy.applies ? `${number.format(bill.subsidy.subsidizedKWh)} kWh × ${money.format(bill.subsidy.discountARSperKWh)}/kWh` : "No aplica"}</strong></div>
      <div class="bill-line"><span class="label">Cargo de red</span><strong>${moneyOrFallback(bill.networkCharge)}</strong></div>
      <div class="bill-line"><span class="label">Otros cargos fijos</span><strong>${moneyOrFallback(bill.otherCharges)}</strong></div>
      <div class="bill-line"><span class="label">Subtotal aproximado</span><strong>${moneyOrFallback(bill.subtotal)}</strong></div>
      <div class="bill-line total"><span>Total aproximado</span><strong>${moneyOrFallback(bill.total)}</strong></div>
    </div>
    <details class="diagnostics-panel">
      <summary>Diagnóstico de subsidio</summary>
      <dl class="data-list diagnostics-list">
        <div><dt>activeProfileId</dt><dd>${valueOrFallback(state.selectedProfileId)}</dd></div>
        <div><dt>Campo detectado</dt><dd>${hasProfile ? valueOrFallback(bill.subsidy.detectedField, "") : "sin dato"}</dd></div>
        <div><dt>Descuento usado</dt><dd>${hasProfile ? `${number.format(bill.subsidy.discountARSperKWh)} $/kWh` : "sin dato"}</dd></div>
        <div><dt>limitKWh usado</dt><dd>${hasProfile ? `${number.format(bill.subsidy.limitKWh)} kWh` : "sin dato"}</dd></div>
        <div><dt>kWh subsidiados</dt><dd>${hasProfile ? `${number.format(bill.subsidy.subsidizedKWh)} kWh` : "sin dato"}</dd></div>
      </dl>
    </details>`;
}


function getDefaultTotalDays(profile) {
  const periodType = profile?.periodType || profile?.billingPeriod || state.billing?.periodType;
  return periodType === "monthly" ? 30 : 60;
}


function renderProjectionPanel() {
  const profile = getActiveProfile();
  const consumption = toNumber($('consumptionInput').value, 0);
  const currentTier = getCurrentTier(consumption, profile?.networkChargeTiers);
  const hasExistingInputs = Boolean($('elapsedDaysInput'));
  const defaultTotalDays = getDefaultTotalDays(profile);
  const elapsedDays = hasExistingInputs ? toNumber($('elapsedDaysInput').value, Math.ceil(defaultTotalDays / 2)) : Math.ceil(defaultTotalDays / 2);
  const totalDays = hasExistingInputs ? toNumber($('totalDaysInput').value, defaultTotalDays) : defaultTotalDays;
  const reductionPercent = hasExistingInputs ? toNumber($('reductionInput').value, 10) : 10;
  const projection = calculateProjection(consumption, currentTier, profile || {}, elapsedDays, totalDays);
  const savings = calculateSavingsScenario(consumption, profile || {}, elapsedDays, totalDays, reductionPercent);
  const currentName = getTierName(currentTier);
  const nextName = projection.nextTier ? getTierName(projection.nextTier) : 'Última categoría';
  const statusMessage = projection.status === 'critical'
    ? 'La proyección indica que superarías la categoría actual antes del cierre del período.'
    : projection.status === 'warning'
      ? `Al ritmo actual, podrías pasar a ${nextName} en aproximadamente ${number.format(projection.daysUntilChange || 0)} días.`
      : `Con el ritmo actual, se estima cerrar el período dentro de la categoría ${currentName}.`;

  $('projectionPanel').innerHTML = `
    <div class="card-title-row">
      <h2>Proyección y alertas de escala</h2>
      <span class="projection-status ${projection.status}">${projection.status === 'ok' ? 'Normal' : projection.status === 'warning' ? 'Advertencia' : 'Riesgo crítico'}</span>
    </div>

    <div class="projection-controls">
      <label class="field-label" for="elapsedDaysInput">Días transcurridos del período</label>
      <input id="elapsedDaysInput" type="number" min="1" step="1" inputmode="numeric" value="${Math.max(elapsedDays, 1)}" />
      <label class="field-label" for="totalDaysInput">Días totales del período</label>
      <input id="totalDaysInput" type="number" min="1" step="1" inputmode="numeric" value="${Math.max(totalDays, 1)}" />
      <label class="field-label" for="reductionInput">Reducción esperada (%)</label>
      <input id="reductionInput" type="number" min="0" max="100" step="1" inputmode="decimal" value="${savings.reductionPercent}" />
    </div>

    <div class="projection-grid">
      <div class="projection-box"><span>Categoría actual</span><strong>${currentName}</strong></div>
      <div class="projection-box"><span>Próxima categoría</span><strong>${nextName}</strong></div>
      <div class="projection-box"><span>kWh restantes antes de cambiar</span><strong>${projection.remainingKWh === null ? 'sin límite' : `${number.format(projection.remainingKWh)} kWh`}</strong></div>
      <div class="projection-box"><span>Consumo diario promedio</span><strong>${number.format(projection.consumptionDaily)} kWh/día</strong></div>
    </div>

    <div class="alert ${projection.status}">${statusMessage}</div>

    <div class="savings-grid">
      <div class="bill-line"><span class="label">Consumo proyectado sin ahorro</span><strong>${number.format(savings.baseConsumption)} kWh</strong></div>
      <div class="bill-line"><span class="label">Costo proyectado sin ahorro</span><strong>${money.format(savings.baseCost)}</strong></div>
      <div class="bill-line"><span class="label">Consumo proyectado con reducción</span><strong>${number.format(savings.reducedConsumption)} kWh</strong></div>
      <div class="bill-line"><span class="label">Costo proyectado con reducción</span><strong>${money.format(savings.reducedCost)}</strong></div>
      <div class="bill-line total"><span>Ahorro económico aproximado</span><strong>${money.format(savings.savingsARS)}</strong></div>
    </div>

    ${savings.avoidedTierChange ? `<div class="alert ok">Cambio de categoría evitado: bajarías de ${getTierName(savings.baseTier)} a ${getTierName(savings.reducedTier)} con la reducción simulada.</div>` : ''}
    <p class="projection-note">La proyección depende del consumo registrado hasta el momento y puede variar si cambian los hábitos de uso o las condiciones de medición.</p>
  `;

  ['elapsedDaysInput', 'totalDaysInput', 'reductionInput'].forEach((id) => $(id).addEventListener('input', renderProjectionPanel));
}

function renderAlerts() {
  const profile = getActiveProfile();
  const consumption = toNumber($("consumptionInput").value, 0);
  const tier = getCurrentTier(consumption, profile?.networkChargeTiers);
  const from = toNumber(tier?.fromKWh ?? tier?.minKWh ?? tier?.from, 0);
  const to = tier?.toKWh ?? tier?.maxKWh ?? tier?.to;
  const progress = to === null || to === undefined ? 0 : ((consumption - from) / Math.max(toNumber(to) - from, 1)) * 100;
  const alerts = [];

  if (progress >= 95) alerts.push(["critical", "Alerta crítica: el consumo supera el 95% del tramo actual."]);
  else if (progress >= 80) alerts.push(["warning", "Advertencia: el consumo supera el 80% del tramo actual."]);
  else alerts.push(["ok", "Consumo dentro de un margen normal del tramo actual."]);

  const pf = state.live?.pf;
  if (profile?.powerFactorPenalty?.enabled) {
    if (pf === null || pf === undefined) alerts.push(["info", "Factor de potencia: sin dato en tiempo real."]);
    else if (Number(pf) < 0.92) alerts.push(["warning", `Advertencia: bajo factor de potencia (${number.format(pf)}).`]);
  } else if (pf === null || pf === undefined) {
    alerts.push(["info", "Factor de potencia: sin dato en tiempo real."]);
  }

  $("alertsList").innerHTML = alerts.map(([type, text]) => `<div class="alert ${type}">${text}</div>`).join("");
}

function renderLivePanel() {
  const fields = [
    ["vrms", "Vrms", " V"], ["irms", "Irms", " A"], ["p_w", "Potencia activa", " W"], ["s_va", "Potencia aparente", " VA"],
    ["pf", "Factor de potencia", ""], ["frequency_hz", "Frecuencia", " Hz"], ["thd_v_pct", "THD tensión", "%"], ["thd_i_pct", "THD corriente", "%"],
    ["timestamp", "Timestamp", ""], ["server_ms", "Server ms", ""],
  ];
  $("livePanel").innerHTML = fields.map(([key, label, suffix]) => `
    <div class="live-item"><span class="live-label">${label}</span><span class="live-value">${valueOrFallback(state.live?.[key], suffix)}</span></div>
  `).join("");
}

function renderConnectionPanel() {
  const profile = getActiveProfile();
  $("activeProfileId").textContent = valueOrFallback(state.billing?.activeProfileId);
  $("userType").textContent = valueOrFallback(profile?.userType || profile?.customerType);
  $("tariffCode").textContent = valueOrFallback(profile?.tariffCode || profile?.code);
}

function renderAll() {
  renderConnectionPanel();
  renderTierCard();
  renderEstimatedBill();
  renderProjectionPanel();
  renderAlerts();
  renderLivePanel();
}

function updateConnectionStatus() {
  const ok = state.failedRequests.size === 0;
  $("firebaseStatus").textContent = ok ? "conectado" : "error de conexión";
  const badge = $("connectionBadge");
  badge.textContent = ok ? "Firebase conectado" : "Error Firebase";
  badge.className = `status-badge ${ok ? "status-ok" : "status-error"}`;
}

function showError(message) {
  const banner = $("errorBanner");
  banner.textContent = message;
  banner.classList.remove("hidden");
}

async function init() {
  $("consumptionInput").addEventListener("input", renderAll);
  await Promise.all([loadBilling(), loadTariffProfiles()]);
  renderProfileSelector();
  $("consumptionInput").value = INITIAL_CONSUMPTION[state.selectedProfileId] ?? 0;
  renderAll();
  await loadLiveData();
  window.setInterval(loadLiveData, 10000);
}

document.addEventListener("DOMContentLoaded", init);
