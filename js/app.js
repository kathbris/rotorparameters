// Utility: complex numbers using simple object {re, im}
function c(re, im=0) { return { re, im }; }
function cAdd(a, b) { return c(a.re + b.re, a.im + b.im); }
function cSub(a, b) { return c(a.re - b.re, a.im - b.im); }
function cMul(a, b) { return c(a.re*b.re - a.im*b.im, a.re*b.im + a.im*b.re); }
function cDiv(a, b) {
  const denom = b.re*b.re + b.im*b.im;
  return c((a.re*b.re + a.im*b.im)/denom, (a.im*b.re - a.re*b.im)/denom);
}
function cMag(a) { return Math.sqrt(a.re*a.re + a.im*a.im); }
function cInv(a) { const denom = a.re*a.re + a.im*a.im; return c(a.re/denom, -a.im/denom); }
function cPar(a, b) { // parallel: 1 / (1/a + 1/b)
  return cInv( cAdd(cInv(a), cInv(b)) );
}

function toFixedSig(n, digits=3) {
  if (!isFinite(n)) return "–";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

// NEMA rotor presets (R2, X2) updated to match locked-rotor resistance guidance
// Values reflect typical locked-rotor resistances (approx): A=0.5, B=0.6, C=1.0, D=2.0
const nemaPresets = {
  'NEMA_A': { R2: 0.4, X2: 0.4 },
  'NEMA_B': { R2: 0.5, X2: 0.6 },
  'NEMA_C': { R2: .9, X2: 0.5 },
  'NEMA_D': { R2: 3, X2: 0.1 },
  'WOUND': { R2: 0.05, X2: 0.2 }
};

function applyNemaPreset(name) {
  const preset = nemaPresets[name];
  if (!preset) return;
  const r2El = document.getElementById('r2');
  const x2El = document.getElementById('x2');
  r2El.value = preset.R2;
  x2El.value = preset.X2;
  // Show rotor sliders only for wound rotor preset
  const rotorControls = Array.from(document.querySelectorAll('.rotor_control'));
  if (rotorControls.length > 0) {
    if (name === 'WOUND') {
      rotorControls.forEach(el => { el.style.display = ''; const input = el.querySelector('input'); if (input) input.disabled = false; });
    } else {
      rotorControls.forEach(el => { el.style.display = 'none'; const input = el.querySelector('input'); if (input) input.disabled = true; });
    }
  }
  updateSliderLabels();
  // simulate with the preset and log starting torque for quick verification
  try {
    const params = getParams();
    params.R2 = preset.R2; params.X2 = preset.X2;
    const curves = computeCurves(params);
    const T_start = curves.torque[curves.torque.length - 1];
    console.debug(`Applied NEMA preset ${name}: starting torque ≈ ${toFixedSig(T_start,2)} N·m`);
  } catch (e) { console.debug('Applied NEMA preset but failed to compute start torque:', e); }
  simulate();
}

function getParams() {
  // Read inputs
  const R2 = parseFloat(document.getElementById('r2').value);
  const X2 = parseFloat(document.getElementById('x2').value);
  const R1 = parseFloat(document.getElementById('r1').value);
  const X1 = parseFloat(document.getElementById('x1').value);
  const Xm = parseFloat(document.getElementById('xm').value);
  const Vll = parseFloat(document.getElementById('vline').value);
  const f = parseFloat(document.getElementById('freq').value);
  const p = parseInt(document.getElementById('poles').value);
  const points = parseInt(document.getElementById('points').value);
  // percent slider: 0..150 (0% = no-load, 100% = reference at 33% of Tmax)
  const percent_loaded = parseFloat(document.getElementById('percent_loaded').value);
  return { R2, X2, R1, X1, Xm, Vll, f, p, points, percent_loaded };
}

function computeCurves(params) {
  const { R2, X2, R1, X1, Xm, Vll, f, p, points } = params;
  const Vph = Vll / Math.sqrt(3); // Y-connected assumed
  const w_sync = 4 * Math.PI * f / p; // mechanical rad/s
  const n_sync_rpm = 120 * f / p; // rpm

  const slips = [];
  const speeds_rpm = [];
  const torque = [];
  const I_line = [];
  const Pag_arr = [];
  const P_input_arr = [];

  const s_min = 1e-4; // avoid singularity at s=0
  const s_max = 1.0;  // starting
  for (let i=0; i<points; i++) {
    const s = s_min + (s_max - s_min) * (i / (points-1));
    // impedances (per phase)
    const Zs = c(R1, X1); // stator series
    const Zr = c(R2 / s, X2); // rotor branch
    const Zm = c(0, Xm); // magnetizing reactance
    const Zpar = cPar(Zr, Zm);
    const Ztot = cAdd(Zs, Zpar);

    const I = cDiv( c(Vph, 0), Ztot ); // line current (per phase)
    const V_par = cMul(I, Zpar); // voltage across parallel
    const I2 = cDiv(V_par, Zr); // rotor branch current

    const Pag = 3 * (cMag(I2)**2) * (R2/s); // air-gap power (W)
    const T = Pag / w_sync; // torque (N·m)

    // Input electrical real power (total) approximated as 3*V_phase*Re(I)
    const P_input = 3 * Vph * I.re;

    const n_rpm = n_sync_rpm * (1 - s);

    slips.push(s);
    speeds_rpm.push(n_rpm);
    torque.push(T);
    I_line.push(cMag(I)); // line current magnitude (Y-connected)
    Pag_arr.push(Pag);
    P_input_arr.push(P_input);
  }
  // Find breakdown torque and slip
  let Tmax = -Infinity, s_at_Tmax = NaN;
  for (let i=0; i<torque.length; i++) {
    if (torque[i] > Tmax) { Tmax = torque[i]; s_at_Tmax = slips[i]; }
  }

  const istart = I_line[I_line.length - 1]; // s=1 at end
  const inoload = I_line[0]; // s≈0 at start

  return { slips, speeds_rpm, torque, I_line, Pag_arr, P_input_arr, n_sync_rpm, Tmax, s_at_Tmax, istart, inoload };
}

function getTorqueAtSpeed(speed, curves) {
  // Linear interpolation to find torque at given speed
  const { speeds_rpm, torque } = curves;
  
  // Clamp speed to valid range
  const minSpeed = Math.min(...speeds_rpm);
  const maxSpeed = Math.max(...speeds_rpm);
  if (speed < minSpeed || speed > maxSpeed) {
    return null;
  }
  
  // Find surrounding indices
  let idx = 0;
  for (let i = 0; i < speeds_rpm.length - 1; i++) {
    if ((speeds_rpm[i] <= speed && speed <= speeds_rpm[i + 1]) ||
        (speeds_rpm[i] >= speed && speed >= speeds_rpm[i + 1])) {
      idx = i;
      break;
    }
  }
  
  const s1 = speeds_rpm[idx];
  const s2 = speeds_rpm[idx + 1];
  const t1 = torque[idx];
  const t2 = torque[idx + 1];
  
  // Linear interpolation
  const t = t1 + (t2 - t1) * (speed - s1) / (s2 - s1);
  return t;
}

// Find speed (rpm) at which torque crosses targetTorque using linear
// interpolation on the computed torque curve. Returns null if not found.
function getSpeedAtTorque(targetTorque, curves) {
  const { speeds_rpm, torque } = curves;
  // Find an interval where torque crosses targetTorque
  for (let i = 0; i < torque.length - 1; i++) {
    const t1 = torque[i];
    const t2 = torque[i + 1];
    // Check if target is between t1 and t2 (either increasing or decreasing)
    if ((t1 <= targetTorque && targetTorque <= t2) || (t1 >= targetTorque && targetTorque >= t2)) {
      const s1 = speeds_rpm[i];
      const s2 = speeds_rpm[i + 1];
      // Avoid division by zero
      if (t2 === t1) return (s1 + s2) / 2;
      const frac = (targetTorque - t1) / (t2 - t1);
      const speed = s1 + (s2 - s1) * frac;
      return speed;
    }
  }
  return null;
}

function getCurrentAtSpeed(speed, curves, n_sync_rpm) {
  // Convert speed to slip, then find current at that slip
  const slip = 1 - (speed / n_sync_rpm);
  const { slips, I_line } = curves;
  
  // Clamp slip to valid range
  const minSlip = Math.min(...slips);
  const maxSlip = Math.max(...slips);
  if (slip < minSlip || slip > maxSlip) {
    return null;
  }
  
  // Find surrounding indices
  let idx = 0;
  for (let i = 0; i < slips.length - 1; i++) {
    if ((slips[i] <= slip && slip <= slips[i + 1]) ||
        (slips[i] >= slip && slip >= slips[i + 1])) {
      idx = i;
      break;
    }
  }
  
  const s1 = slips[idx];
  const s2 = slips[idx + 1];
  const i1 = I_line[idx];
  const i2 = I_line[idx + 1];
  
  // Linear interpolation
  const current = i1 + (i2 - i1) * (slip - s1) / (s2 - s1);
  return current;
}

// Interpolate total input electrical power at a given speed
function getInputAtSpeed(speed, curves) {
  const slip = 1 - (speed / curves.n_sync_rpm);
  const { slips, P_input_arr } = curves;
  const minSlip = Math.min(...slips);
  const maxSlip = Math.max(...slips);
  if (slip < minSlip || slip > maxSlip) return null;
  let idx = 0;
  for (let i = 0; i < slips.length - 1; i++) {
    if ((slips[i] <= slip && slip <= slips[i + 1]) || (slips[i] >= slip && slip >= slips[i + 1])) { idx = i; break; }
  }
  const s1 = slips[idx], s2 = slips[idx+1];
  const p1 = P_input_arr[idx], p2 = P_input_arr[idx+1];
  if (s2 === s1) return p1;
  return p1 + (p2 - p1) * (slip - s1) / (s2 - s1);
}

function plotResults(curves, params) {
  const { speeds_rpm, torque, I_line, slips, n_sync_rpm } = curves;
  const style = getComputedStyle(document.documentElement);
  const accent = (style.getPropertyValue('--accent') || '#b31b1b').trim();
  const accent2 = (style.getPropertyValue('--accent-2') || '#ef4444').trim();
  const textColor = (style.getPropertyValue('--text') || '#0f172a').trim();
  const gridColor = (style.getPropertyValue('--card-border') || '#e6e9ef').trim();
  const bgColor = (style.getPropertyValue('--card') || '#ffffff').trim();
  const { R2, X2, speed_noload, speed_fullload } = params;
  
  // Calculate torque at marked speed points
  const T_noload = getTorqueAtSpeed(speed_noload, curves);
  const T_fullload = getTorqueAtSpeed(speed_fullload, curves);
  
  // Torque vs speed
  const torqueTrace = {
    x: speeds_rpm,
    y: torque,
    type: 'scatter',
    mode: 'lines',
    line: { color: accent, width: 3 },
    name: `Torque (R2=${R2.toFixed(2)}Ω, X2=${X2.toFixed(2)}Ω)`
  };
  
  // Traces array - add markers only if they're valid
  const traces = [torqueTrace];
  
  if (T_noload !== null) {
    const noloadMarker = {
      x: [speed_noload],
      y: [T_noload],
      type: 'scatter',
      mode: 'markers',
      marker: { color: accent2, size: 10 },
      name: `No-load Speed (${speed_noload.toFixed(0)} rpm)`
    };
    traces.push(noloadMarker);
  }
  
  if (T_fullload !== null) {
    const fullloadMarker = {
      x: [speed_fullload],
      y: [T_fullload],
      type: 'scatter',
      mode: 'markers',
      marker: { color: textColor, size: 10 },
      name: `Loaded Speed (${speed_fullload.toFixed(0)} rpm)`
    };
    traces.push(fullloadMarker);
  }
  
  const layoutTorque = {
    title: 'Torque vs Speed',
    xaxis: { title: 'Speed (rpm)', range: [0, n_sync_rpm], gridcolor: gridColor, zerolinecolor: gridColor },
    yaxis: { title: 'Torque (N·m)', gridcolor: gridColor, zerolinecolor: gridColor },
    paper_bgcolor: bgColor,
    plot_bgcolor: bgColor,
    font: { color: textColor },
    margin: { t: 40, r: 20, b: 60, l: 60 }
  };
  // If full-load speed is below breakdown (peak) speed, show STALLED overlay
  const speed_at_Tmax = n_sync_rpm * (1 - curves.s_at_Tmax);
  if (!isNaN(speed_at_Tmax) && isFinite(speed_fullload) && speed_fullload < speed_at_Tmax) {
    // Add a translucent overlay and a prominent annotation
    layoutTorque.shapes = [
      {
        type: 'rect', xref: 'paper', yref: 'paper',
        x0: 0, x1: 1, y0: 0, y1: 1,
        fillcolor: 'rgba(255,0,0,0.06)', line: {width: 0}
      }
    ];
    layoutTorque.annotations = [
      {
        xref: 'paper', yref: 'paper', x: 0.5, y: 0.5,
        text: `<b style="font-size:24px; color:${accent}">STALLED</b>`,
        showarrow: false,
        bgcolor: 'rgba(0,0,0,0.4)'
      }
    ];
  }
  Plotly.newPlot('torquePlot', traces, layoutTorque, {displayModeBar: true, responsive: true});

  // Current vs slip (or speed)
  const currentTrace = {
    x: slips,
    y: I_line,
    type: 'scatter',
    mode: 'lines',
    line: { color: accent2, width: 3 },
    name: 'Line current'
  };
  
  // Calculate current at marked speed points
  const I_noload = getCurrentAtSpeed(speed_noload, curves, n_sync_rpm);
  const s_noload = 1 - (speed_noload / n_sync_rpm);
  
  const I_fullload = getCurrentAtSpeed(speed_fullload, curves, n_sync_rpm);
  const s_fullload = 1 - (speed_fullload / n_sync_rpm);
  
  // Traces for current plot
  const currentTraces = [currentTrace];
  
  if (I_noload !== null) {
      const noloadCurrentMarker = {
        x: [s_noload],
        y: [I_noload],
        type: 'scatter',
        mode: 'markers',
        marker: { color: accent, size: 10 },
        name: `No-load (${speed_noload.toFixed(0)} rpm)`
      };
    currentTraces.push(noloadCurrentMarker);
  }
  
  if (I_fullload !== null) {
      const fullloadCurrentMarker = {
        x: [s_fullload],
        y: [I_fullload],
        type: 'scatter',
        mode: 'markers',
        marker: { color: textColor, size: 10 },
        name: `Loaded Speed (${speed_fullload.toFixed(0)} rpm)`
      };
    currentTraces.push(fullloadCurrentMarker);
  }
  
  const layoutCurrent = {
    title: 'Stator Line Current vs Slip',
    xaxis: { title: 'Slip s', range: [1, 0], gridcolor: gridColor, zerolinecolor: gridColor },
    yaxis: { title: 'Current (A)', gridcolor: gridColor, zerolinecolor: gridColor },
    paper_bgcolor: bgColor,
    plot_bgcolor: bgColor,
    font: { color: textColor },
    margin: { t: 40, r: 20, b: 60, l: 60 }
  };
  Plotly.newPlot('currentPlot', currentTraces, layoutCurrent, {displayModeBar: true, responsive: true});
}

function updateSummary(curves, params) {
  const { Tmax, s_at_Tmax, istart, inoload } = curves;
  const { speed_fullload } = params;
  const n_sync_rpm = curves.n_sync_rpm;
  
  // Calculate current at loaded speed
  const I_fullload = getCurrentAtSpeed(speed_fullload, curves, n_sync_rpm);
  // Calculate torque at loaded speed and convert to horsepower
  const T_fullload = getTorqueAtSpeed(speed_fullload, curves);
  let hp = NaN;
  if (T_fullload !== null && isFinite(speed_fullload)) {
    const omega = 2 * Math.PI * (speed_fullload / 60); // rad/s
    const watts = T_fullload * omega;
    hp = watts / 745.699872; // convert W to hp
  }
  
  // Breakdown torque and slip
  const tmaxEl = document.getElementById('tmax');
  if (tmaxEl) tmaxEl.textContent = toFixedSig(Tmax, 2);
  const sTmaxEl = document.getElementById('s_tmax');
  if (sTmaxEl) sTmaxEl.textContent = toFixedSig(s_at_Tmax, 4);

  // Rated torque (100% => 33% of Tmax by definition)
  const ratedTorque = 0.33 * Tmax;
  const ratedEl = document.getElementById('rated_torque');
  if (ratedEl) ratedEl.textContent = isFinite(ratedTorque) ? toFixedSig(ratedTorque, 2) : '–';

  // Starting torque as percent of rated
  const t_start = curves.torque[curves.torque.length - 1];
  const tStartPctEl = document.getElementById('t_start_pct');
  const pct = (isFinite(ratedTorque) && ratedTorque !== 0) ? (100 * t_start / ratedTorque) : NaN;
  if (tStartPctEl) tStartPctEl.textContent = isFinite(pct) ? toFixedSig(pct, 1) : '–';

  // Currents / loaded power (unchanged)
  document.getElementById('istart').textContent = toFixedSig(istart, 1);
  document.getElementById('inl').textContent = toFixedSig(inoload, 1);
  document.getElementById('iloaded').textContent = I_fullload !== null ? toFixedSig(I_fullload, 1) : '–';
  const hpEl = document.getElementById('hp_loaded');
  if (hpEl) hpEl.textContent = (isFinite(hp) ? toFixedSig(hp, 2) : '–');

  // Speed regulation = (No-load - Full-load) / Full-load * 100%
  const regEl = document.getElementById('speed_reg');
  const speed_noload = params.speed_noload;
  let reg = NaN;
  if (isFinite(speed_noload) && isFinite(speed_fullload) && speed_fullload !== 0) {
    reg = ((speed_noload - speed_fullload) / speed_fullload) * 100;
  }
  if (regEl) regEl.textContent = isFinite(reg) ? toFixedSig(reg, 2) : '–';

  // Efficiency at loaded speed = P_shaft / P_input
  const effEl = document.getElementById('efficiency');
  let eff = NaN;
  if (isFinite(speed_fullload) && speed_fullload !== 0) {
    const T_f = getTorqueAtSpeed(speed_fullload, curves);
    const omega_m = 2 * Math.PI * (speed_fullload / 60);
    const P_shaft = (T_f !== null) ? (T_f * omega_m) : NaN;
    const P_in = getInputAtSpeed(speed_fullload, curves);
    if (isFinite(P_shaft) && isFinite(P_in) && P_in > 1e-9) {
      eff = (P_shaft / P_in) * 100;
    }
  }
  if (effEl) effEl.textContent = isFinite(eff) ? toFixedSig(eff, 1) + '%' : '–';
}

function simulate() {
  // Get params (includes percent_loaded and speed_noload)
  const paramsPartial = getParams();
  // First compute torque curve to determine Tmax and reference speed
  const curves = computeCurves(paramsPartial);

  // Determine loaded speed from percent slider
  const percent = paramsPartial.percent_loaded;
  let speed_fullload = NaN;
  // Reference torque is 33% of Tmax
  const refTorque = 0.33 * curves.Tmax;

  // Compute auto no-load speed: speed where torque = 0.5% of Tmax
  const noLoadTarget = 0.05 * curves.Tmax; // 0.5% of peak torque
  let speed_noload = getSpeedAtTorque(noLoadTarget, curves);
  if (speed_noload === null || !isFinite(speed_noload)) {
    // fallback to ~99.5% sync
    speed_noload = Math.round(curves.n_sync_rpm * 0.995);
  }

  if (percent === 0) {
    // At 0% -> no-load speed
    speed_fullload = speed_noload;
  } else {
    const targetTorque = (percent / 100) * refTorque;
    // If targetTorque is effectively zero (tiny Tmax), fallback to heuristic
    if (targetTorque <= 0) {
      speed_fullload = Math.round(curves.n_sync_rpm * 0.98);
    } else {
      const s = getSpeedAtTorque(targetTorque, curves);
      if (s !== null) {
        speed_fullload = s;
      } else {
        // fallback: keep near synchronous speed (safe)
        speed_fullload = Math.round(curves.n_sync_rpm * 0.98);
      }
    }
  }

  // Ensure loaded speed never exceeds no-load speed
  if (isFinite(speed_noload) && isFinite(speed_fullload)) {
    speed_fullload = Math.min(speed_fullload, speed_noload);
  }

  // Prepare final params for plotting/summary (include computed speed_noload)
  const params = Object.assign({}, paramsPartial, { speed_fullload, speed_noload });

  // Update UI displays: percent label and rpm outputs
  const pctEl = document.getElementById('percent_loaded_val');
  if (pctEl) pctEl.textContent = `${Math.round(paramsPartial.percent_loaded)}%`;
  const rpmOut = document.getElementById('speed_fullload_rpm');
  if (rpmOut) rpmOut.textContent = Math.round(speed_fullload);
  const nlOut = document.getElementById('speed_noload_rpm');
  if (nlOut) nlOut.textContent = Math.round(params.speed_noload);

  plotResults(curves, params);
  updateSummary(curves, params);
}

function resetDefaults() {
  // Default NEMA preset
  const defaultPreset = 'NEMA_B';
  const presetEl = document.querySelector(`input[name='nema_design'][value='${defaultPreset}']`);
  if (presetEl) presetEl.checked = true;
  applyNemaPreset(defaultPreset);

  document.getElementById('r1').value = 0.5;
  document.getElementById('x1').value = 1.5;
  document.getElementById('xm').value = 30;
  document.getElementById('vline').value = 460;
  document.getElementById('freq').value = 60;
  document.getElementById('poles').value = 4;
  document.getElementById('points').value = 800;
  document.getElementById('percent_loaded').value = 100;
  updateSliderLabels();
}

// Removed obsolete updateSpeedDefaults() helper to avoid stale defaults

function updateSliderLabels() {
  const r2 = parseFloat(document.getElementById('r2').value);
  const x2 = parseFloat(document.getElementById('x2').value);
  document.getElementById('r2_val').textContent = `${r2.toFixed(2)} Ω`;
  document.getElementById('x2_val').textContent = `${x2.toFixed(2)} Ω`;
  // Keep slider background/fill synced whenever labels change programmatically
  updateRangeFills();
}

function updateRangeFill(el) {
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max) || 100;
  const val = parseFloat(el.value);
  const pct = ((val - min) / (max - min)) * 100;
  const style = getComputedStyle(document.documentElement);
  const accent = (style.getPropertyValue('--accent') || '#b31b1b').trim();
  const track = '#e5e7eb';
  // Compose gradient using percentage
  el.style.background = `linear-gradient(90deg, ${accent} 0%, ${accent} ${pct}%, ${track} ${pct}%, ${track} 100%)`;
}

function updateRangeFills() {
  const ranges = document.querySelectorAll('input[type="range"]');
  ranges.forEach(updateRangeFill);
}

window.addEventListener('DOMContentLoaded', () => {
  updateSliderLabels();

  // Apply currently selected NEMA preset (will show/hide rotor controls)
  const selectedPreset = document.querySelector('input[name="nema_design"]:checked');
  if (selectedPreset) applyNemaPreset(selectedPreset.value);
  // Wire up NEMA preset radio change
  document.querySelectorAll('input[name="nema_design"]').forEach(r => r.addEventListener('change', (e) => {
    applyNemaPreset(e.target.value);
  }));

  // Auto-update chart on slider/input changes
  document.getElementById('r2').addEventListener('input', () => {
    updateSliderLabels();
    updateRangeFill(document.getElementById('r2'));
    simulate();
  });
  document.getElementById('x2').addEventListener('input', () => {
    updateSliderLabels();
    updateRangeFill(document.getElementById('x2'));
    simulate();
  });
  const freqEl = document.getElementById('freq'); if (freqEl) freqEl.addEventListener('input', simulate);
  const polesEl = document.getElementById('poles'); if (polesEl) polesEl.addEventListener('input', simulate);
  const r1El = document.getElementById('r1'); if (r1El) r1El.addEventListener('input', simulate);
  const x1El = document.getElementById('x1'); if (x1El) x1El.addEventListener('input', simulate);
  const xmEl = document.getElementById('xm'); if (xmEl) xmEl.addEventListener('input', simulate);
  const vlineEl = document.getElementById('vline'); if (vlineEl) vlineEl.addEventListener('input', simulate);
  const pointsEl = document.getElementById('points'); if (pointsEl) pointsEl.addEventListener('input', simulate);
  // no direct user input for no-load speed anymore; it's auto-calculated
  const percentSlider = document.getElementById('percent_loaded');
  if (percentSlider) {
    percentSlider.addEventListener('input', () => { updateSliderLabels(); updateRangeFill(percentSlider); simulate(); });
  }
  
  const simulateBtn = document.getElementById('simulate'); if (simulateBtn) simulateBtn.addEventListener('click', simulate);
  // Reset button removed; keep `resetDefaults` available for developers.
  // Plot toggle buttons (minimize/maximize)
  const toggleTorque = document.getElementById('toggle_torque');
  const toggleRotor = document.getElementById('toggle_rotor_current');
  if (toggleTorque) {
    toggleTorque.addEventListener('click', () => {
      const plotEl = document.getElementById('plot_torque');
      if (!plotEl) return;
      plotEl.classList.toggle('minimized');
      const btn = toggleTorque;
      btn.textContent = plotEl.classList.contains('minimized') ? '+' : '–';
      if (!plotEl.classList.contains('minimized')) {
        // Resizing plotly when restoring
        try { Plotly.Plots.resize(document.getElementById('torquePlot')); } catch(e){}
      }
    });
  }
  if (toggleRotor) {
    toggleRotor.addEventListener('click', () => {
      const plotEl = document.getElementById('plot_rotor_current');
      if (!plotEl) return;
      plotEl.classList.toggle('minimized');
      const btn = toggleRotor;
      btn.textContent = plotEl.classList.contains('minimized') ? '+' : '–';
      if (!plotEl.classList.contains('minimized')) {
        try { Plotly.Plots.resize(document.getElementById('rotorCurrentPlot')); } catch(e){}
      }
    });
  }
  // Make plots responsive to window resize (debounced)
  function debounce(fn, wait = 150) {
    let t = null;
    return function(...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...args); }, wait);
    };
  }
  const handleResize = debounce(() => {
    try { const el = document.getElementById('torquePlot'); if (el) Plotly.Plots.resize(el); } catch(e){}
    try { const el2 = document.getElementById('currentPlot'); if (el2) Plotly.Plots.resize(el2); } catch(e){}
    try { const el3 = document.getElementById('rotorCurrentPlot'); if (el3) Plotly.Plots.resize(el3); } catch(e){}
  }, 120);
  window.addEventListener('resize', handleResize);

  // Initial run
  // Ensure all range fills are initialized before first simulate
  updateRangeFills();
  simulate();
});
