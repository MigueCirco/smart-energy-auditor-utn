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

function getCurrentTier(consumptionKWh, tiers = []) {
  const normalized = Array.isArray(tiers) ? tiers : Object.values(tiers || {});
  if (!normalized.length) return null;

  const sorted = normalized
    .map((tier, index) => ({ ...tier, index }))
    .sort((a, b) => toNumber(a.fromKWh ?? a.minKWh ?? a.from, 0) - toNumber(b.fromKWh ?? b.minKWh ?? b.from, 0));

  return sorted.find((tier) => {
    const from = toNumber(tier.fromKWh ?? tier.minKWh ?? tier.from, 0);
    const to = tier.toKWh ?? tier.maxKWh ?? tier.to;
    return consumptionKWh >= from && (to === null || to === undefined || consumptionKWh <= Number(to));
  }) || sorted[sorted.length - 1];
}

function calculateEstimatedBill(consumptionKWh, profile, tier) {
  const energyRate = toNumber(profile?.energyChargeARSperKWh ?? profile?.energyCharge, 0);
  const grossEnergy = consumptionKWh * energyRate;
  const subsidyRateRaw = toNumber(profile?.subsidy?.percentage ?? profile?.subsidy?.rate ?? 0, 0);
  const subsidyRate = subsidyRateRaw > 1 ? subsidyRateRaw / 100 : subsidyRateRaw;
  const subsidy = profile?.subsidy?.enabled ? grossEnergy * subsidyRate : 0;
  const networkCharge = toNumber(tier?.chargeARS ?? tier?.fixedChargeARS ?? tier?.networkChargeARS ?? tier?.amountARS, 0);
  const otherCharges = Object.values(profile?.otherCharges || {}).reduce((sum, charge) => sum + toNumber(typeof charge === "object" ? charge.amountARS ?? charge.value : charge, 0), 0);
  const subtotal = grossEnergy - subsidy + networkCharge + otherCharges;
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
      <div class="bill-line"><span class="label">Subsidio estimado</span><strong>${hasProfile ? `-${money.format(bill.subsidy)}` : "sin dato"}</strong></div>
      <div class="bill-line"><span class="label">Cargo de red</span><strong>${moneyOrFallback(bill.networkCharge)}</strong></div>
      <div class="bill-line"><span class="label">Otros cargos fijos</span><strong>${moneyOrFallback(bill.otherCharges)}</strong></div>
      <div class="bill-line"><span class="label">Subtotal aproximado</span><strong>${moneyOrFallback(bill.subtotal)}</strong></div>
      <div class="bill-line total"><span>Total aproximado</span><strong>${moneyOrFallback(bill.total)}</strong></div>
    </div>`;
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
