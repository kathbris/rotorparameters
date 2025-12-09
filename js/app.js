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
  const speed_noload = parseFloat(document.getElementById('speed_noload').value);
  const speed_fullload = parseFloat(document.getElementById('speed_fullload').value);
  return { R2, X2, R1, X1, Xm, Vll, f, p, points, speed_noload, speed_fullload };
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

    const n_rpm = n_sync_rpm * (1 - s);

    slips.push(s);
    speeds_rpm.push(n_rpm);
    torque.push(T);
    I_line.push(cMag(I)); // line current magnitude (Y-connected)
  }

  // Find breakdown torque and slip
  let Tmax = -Infinity, s_at_Tmax = NaN;
  for (let i=0; i<torque.length; i++) {
    if (torque[i] > Tmax) { Tmax = torque[i]; s_at_Tmax = slips[i]; }
  }

  const istart = I_line[I_line.length - 1]; // s=1 at end
  const inoload = I_line[0]; // s≈0 at start

  return { slips, speeds_rpm, torque, I_line, n_sync_rpm, Tmax, s_at_Tmax, istart, inoload };
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

function plotResults(curves, params) {
  const { speeds_rpm, torque, I_line, slips, n_sync_rpm } = curves;
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
    line: { color: '#38bdf8', width: 3 },
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
      marker: { color: '#f59e0b', size: 10 },
      name: `No-load (${speed_noload.toFixed(0)} rpm)`
    };
    traces.push(noloadMarker);
  }
  
  if (T_fullload !== null) {
    const fullloadMarker = {
      x: [speed_fullload],
      y: [T_fullload],
      type: 'scatter',
      mode: 'markers',
      marker: { color: '#ef44e4ff', size: 10 },
      name: `Full-load (${speed_fullload.toFixed(0)} rpm)`
    };
    traces.push(fullloadMarker);
  }
  
  const layoutTorque = {
    title: 'Torque vs Speed',
    xaxis: { title: 'Speed (rpm)', range: [0, n_sync_rpm], gridcolor: '#334155' },
    yaxis: { title: 'Torque (N·m)', gridcolor: '#334155' },
    paper_bgcolor: '#1e293b',
    plot_bgcolor: '#0f172a',
    font: { color: '#e2e8f0' },
    margin: { t: 40, r: 20, b: 60, l: 60 }
  };
  Plotly.newPlot('torquePlot', traces, layoutTorque, {displayModeBar: true});

  // Current vs slip (or speed)
  const currentTrace = {
    x: slips,
    y: I_line,
    type: 'scatter',
    mode: 'lines',
    line: { color: '#22c55e', width: 3 },
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
      marker: { color: '#f59e0b', size: 10 },
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
      marker: { color: '#ef44e4ff', size: 10 },
      name: `Full-load (${speed_fullload.toFixed(0)} rpm)`
    };
    currentTraces.push(fullloadCurrentMarker);
  }
  
  const layoutCurrent = {
    title: 'Stator Line Current vs Slip',
    xaxis: { title: 'Slip s', range: [1, 0], gridcolor: '#334155' },
    yaxis: { title: 'Current (A)', gridcolor: '#334155' },
    paper_bgcolor: '#1e293b',
    plot_bgcolor: '#0f172a',
    font: { color: '#e2e8f0' },
    margin: { t: 40, r: 20, b: 60, l: 60 }
  };
  Plotly.newPlot('currentPlot', currentTraces, layoutCurrent, {displayModeBar: true});
}

function updateSummary(curves) {
  const { Tmax, s_at_Tmax, istart, inoload } = curves;
  document.getElementById('tmax').textContent = toFixedSig(Tmax, 2);
  document.getElementById('s_tmax').textContent = toFixedSig(s_at_Tmax, 4);
  document.getElementById('istart').textContent = toFixedSig(istart, 1);
  document.getElementById('inl').textContent = toFixedSig(inoload, 1);
}

function simulate() {
  const params = getParams();
  const curves = computeCurves(params);
  plotResults(curves, params);
  updateSummary(curves);
}

function resetDefaults() {
  document.getElementById('r2').value = 0.3;
  document.getElementById('x2').value = 0.5;
  document.getElementById('r1').value = 0.5;
  document.getElementById('x1').value = 1.5;
  document.getElementById('xm').value = 30;
  document.getElementById('vline').value = 460;
  document.getElementById('freq').value = 60;
  document.getElementById('poles').value = 4;
  document.getElementById('points').value = 800;
  updateSpeedDefaults();
  updateSliderLabels();
}

function updateSpeedDefaults() {
  // Calculate sync speed from frequency and poles
  const f = parseFloat(document.getElementById('freq').value);
  const p = parseInt(document.getElementById('poles').value);
  const n_sync = 120 * f / p;
  
  // Set defaults: no-load at 98% sync, full-load at 90% sync
  document.getElementById('speed_noload').value = Math.round(n_sync * 0.98);
  document.getElementById('speed_fullload').value = Math.round(n_sync * 0.95);
}

function updateSliderLabels() {
  const r2 = parseFloat(document.getElementById('r2').value);
  const x2 = parseFloat(document.getElementById('x2').value);
  document.getElementById('r2_val').textContent = `${r2.toFixed(2)} Ω`;
  document.getElementById('x2_val').textContent = `${x2.toFixed(2)} Ω`;
}

window.addEventListener('DOMContentLoaded', () => {
  updateSpeedDefaults();
  updateSliderLabels();
  document.getElementById('r2').addEventListener('input', updateSliderLabels);
  document.getElementById('x2').addEventListener('input', updateSliderLabels);
  document.getElementById('freq').addEventListener('change', updateSpeedDefaults);
  document.getElementById('poles').addEventListener('change', updateSpeedDefaults);
  document.getElementById('simulate').addEventListener('click', simulate);
  document.getElementById('reset').addEventListener('click', () => { resetDefaults(); simulate(); });
  // Initial run
  simulate();
});
