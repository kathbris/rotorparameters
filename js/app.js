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
  return { R2, X2, R1, X1, Xm, Vll, f, p, points };
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

function plotResults(curves, params) {
  const { speeds_rpm, torque, I_line, slips, n_sync_rpm } = curves;
  const { R2, X2 } = params;
  // Torque vs speed
  const torqueTrace = {
    x: speeds_rpm,
    y: torque,
    type: 'scatter',
    mode: 'lines',
    line: { color: '#38bdf8', width: 3 },
    name: `Torque (R2=${R2.toFixed(2)}Ω, X2=${X2.toFixed(2)}Ω)`
  };
  const layoutTorque = {
    title: 'Torque vs Speed',
    xaxis: { title: 'Speed (rpm)', range: [0, n_sync_rpm], gridcolor: '#334155' },
    yaxis: { title: 'Torque (N·m)', gridcolor: '#334155' },
    paper_bgcolor: '#1e293b',
    plot_bgcolor: '#0f172a',
    font: { color: '#e2e8f0' },
    margin: { t: 40, r: 20, b: 60, l: 60 }
  };
  Plotly.newPlot('torquePlot', [torqueTrace], layoutTorque, {displayModeBar: true});

  // Current vs slip (or speed)
  const currentTrace = {
    x: slips,
    y: I_line,
    type: 'scatter',
    mode: 'lines',
    line: { color: '#22c55e', width: 3 },
    name: 'Line current'
  };
  const layoutCurrent = {
    title: 'Stator Line Current vs Slip',
    xaxis: { title: 'Slip s', range: [0, 1], gridcolor: '#334155' },
    yaxis: { title: 'Current (A)', gridcolor: '#334155' },
    paper_bgcolor: '#1e293b',
    plot_bgcolor: '#0f172a',
    font: { color: '#e2e8f0' },
    margin: { t: 40, r: 20, b: 60, l: 60 }
  };
  Plotly.newPlot('currentPlot', [currentTrace], layoutCurrent, {displayModeBar: true});
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
  updateSliderLabels();
}

function updateSliderLabels() {
  const r2 = parseFloat(document.getElementById('r2').value);
  const x2 = parseFloat(document.getElementById('x2').value);
  document.getElementById('r2_val').textContent = `${r2.toFixed(2)} Ω`;
  document.getElementById('x2_val').textContent = `${x2.toFixed(2)} Ω`;
}

window.addEventListener('DOMContentLoaded', () => {
  updateSliderLabels();
  document.getElementById('r2').addEventListener('input', updateSliderLabels);
  document.getElementById('x2').addEventListener('input', updateSliderLabels);
  document.getElementById('simulate').addEventListener('click', simulate);
  document.getElementById('reset').addEventListener('click', () => { resetDefaults(); simulate(); });
  // Initial run
  simulate();
});
