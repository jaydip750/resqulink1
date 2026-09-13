// ============================================================
// ResQLink Movement Module — OFFLINE smartphone-based movement &
// prolonged-inactivity detection using built-in motion sensors.
// NO internet, NO cloud, NO GPS, NO camera. Pure local math.
// Sensors: DeviceMotionEvent accelerationIncludingGravity (+ rotationRate as gyro fallback).
// Wording: "possible fall-like", "prolonged inactivity detected" — NEVER medical claims.
// Phase path: accel -> score -> inactivity timer -> SOS packet -> gyro fall -> priority support.
// ============================================================

const MovementConfig = {
  // --- sampling / battery (start ONLY after SOS, stop on cancel/close) ---
  SAMPLE_THROTTLE_MS: 200,        // ~5 Hz: battery-efficient, enough for activity
  WINDOW_MS: 2000,                // sliding window for meaningful-movement decision
  SMOOTH_ALPHA: 0.2,              // EMA smoothing of linear magnitude
  // --- noise vs motion (prototype thresholds: calibrate with real-world tests) ---
  NOISE_FLOOR: 0.25,              // m/s^2 linear: below = sensor noise, NEVER resets timer
  MOVE_THRESH: 0.6,               // meaningful movement threshold (hysteresis floor)
  HIGH_THRESH: 2.5,               // HIGH_MOVEMENT threshold
  SUDDEN_THRESH: 6.0,             // SUDDEN_MOVEMENT spike threshold (linear mag delta)
  GYRO_ORIENT_THRESH: 1.2,        // rad/s: orientation-change hint for fall-like
  FALL_QUIET_MS: 8000,            // low movement after spike+turn => possible fall-like
  // --- inactivity (MOST IMPORTANT): configurable, easy to change ---
  INACTIVITY_THRESHOLD_SECONDS: 300, // 5 min real use; test mode may override to 60
  // --- score bands 0..100 (prototype, not medical) ---
  // 0-10 stationary, 11-30 low, 31-60 moderate, 61-80 high, 81-100 very high
};

// Pure, unit-testable analyzer. No DOM, no network.
class MovementAnalyzer {
  constructor(cfg = {}) {
    this.cfg = { ...MovementConfig, ...cfg };
    this.reset();
  }
  reset() {
    this.gravity = { x: 9.81 * 0 + 0, y: 0, z: 9.81 }; // low-pass estimate, init upright
    this.smooth = 0;               // EMA of linear magnitude
    this.window = [];              // [{t, lin}] sliding window
    this.lastT = null;
    this.inactivityTimerSec = 0;
    this.inactivityDetected = false;
    this.lastMovementT = null;
    this.state = 'STATIONARY';
    this.score = 0;
    this.suddenEvents = [];        // [{t, mag}]
    this.pendingFall = null;       // {spikeT, turnSeen}
    this.possibleFallLikeEvent = false;
    this.lastRaw = 0; this.lastLin = 0;
    this.gyroAvailable = false;
  }
  // One sample: ax,ay,az in m/s^2 (incl. gravity), optional gyro rad/s {x,y,z}, t ms.
  // Returns MovementStatus snapshot (serializable for SOS packet).
  push(ax, ay, az, gyro, t = Date.now()) {
    const c = this.cfg;
    if (![ax, ay, az].every(Number.isFinite)) return this.status(t);
    // Gravity removal: low-pass on each axis (fallback when LINEAR_ACCELERATION absent).
    const a = 0.9;
    this.gravity.x = a * this.gravity.x + (1 - a) * ax;
    this.gravity.y = a * this.gravity.y + (1 - a) * ay;
    this.gravity.z = a * this.gravity.z + (1 - a) * az;
    const lx = ax - this.gravity.x, ly = ay - this.gravity.y, lz = az - this.gravity.z;
    const lin = Math.sqrt(lx * lx + ly * ly + lz * lz); // gravity-free movement metric
    this.lastRaw = Math.sqrt(ax * ax + ay * ay + az * az);
    this.lastLin = lin;
    // Smooth (EMA) for stable score.
    this.smooth = this.smooth === 0 ? lin : c.SMOOTH_ALPHA * lin + (1 - c.SMOOTH_ALPHA) * this.smooth;
    // Sliding window keeps only recent samples.
    this.window.push({ t, lin });
    while (this.window.length && t - this.window[0].t > c.WINDOW_MS) this.window.shift();
    // Time delta for inactivity timer.
    const dt = this.lastT == null ? 0 : Math.max(0, (t - this.lastT) / 1000);
    this.lastT = t;
    // Meaningful movement? max in window must clear MOVE_THRESH (hysteresis vs NOISE_FLOOR).
    const wmax = this.window.reduce((m, s) => Math.max(m, s.lin), 0);
    const meaningful = wmax >= c.MOVE_THRESH;
    if (meaningful) {
      this.inactivityTimerSec = 0;
      this.inactivityDetected = false;   // movement again => clear flag, restart timer
      this.lastMovementT = t;
    } else {
      this.inactivityTimerSec += dt;     // noise below threshold does NOT reset
      if (this.inactivityTimerSec >= c.INACTIVITY_THRESHOLD_SECONDS) this.inactivityDetected = true;
    }
    // Score 0..100 from smoothed linear (calibratable curve).
    this.score = Math.max(0, Math.min(100, Math.round((this.smooth / 4) * 100)));
    // Sudden spike detection (delta on raw linear).
    if (lin >= c.SUDDEN_THRESH) {
      this.suddenEvents.push({ t, mag: +lin.toFixed(2) });
      if (this.suddenEvents.length > 20) this.suddenEvents.shift();
      this.pendingFall = { spikeT: t, turnSeen: false, mag: lin };
    }
    // Gyroscope: orientation-change hint (graceful if absent).
    if (gyro && [gyro.x, gyro.y, gyro.z].every(Number.isFinite)) {
      this.gyroAvailable = true;
      const g = Math.sqrt(gyro.x ** 2 + gyro.y ** 2 + gyro.z ** 2);
      if (this.pendingFall && g >= c.GYRO_ORIENT_THRESH) this.pendingFall.turnSeen = true;
    }
    // Possible fall-like: spike (+turn if gyro) followed by quiet window.
    if (this.pendingFall && t - this.pendingFall.spikeT >= 1500) {
      const quiet = wmax < c.MOVE_THRESH;
      const windowOk = t - this.pendingFall.spikeT <= c.FALL_QUIET_MS + 4000;
      if (quiet && windowOk && (this.pendingFall.turnSeen || !this.gyroAvailable)) {
        // Accelerometer-only path is allowed but labelled accordingly (see status()).
        this.possibleFallLikeEvent = true;
      }
      if (t - this.pendingFall.spikeT > c.FALL_QUIET_MS + 4000 || this.possibleFallLikeEvent) {
        if (!this.possibleFallLikeEvent) this.pendingFall = t - this.pendingFall.spikeT > 12000 ? null : this.pendingFall;
        else this.pendingFall = null;
      }
    }
    // Classify state (order matters: inactivity first, then sudden/fall hints).
    this.state = this.classify(wmax);
    return this.status(t);
  }
  classify(wmax) {
    const c = this.cfg;
    if (this.inactivityDetected) return 'PROLONGED_INACTIVITY';
    if (this.possibleFallLikeEvent && wmax < c.MOVE_THRESH) return 'POSSIBLE_FALL_LIKE_EVENT';
    if (wmax >= c.SUDDEN_THRESH) return 'SUDDEN_MOVEMENT';
    if (this.score >= 61) return 'HIGH_MOVEMENT';
    if (this.score >= 31) return 'MOVING';
    if (this.score >= 11) return 'LOW_MOVEMENT';
    return 'STATIONARY';
  }
  status(t = Date.now()) {
    return {
      movementState: this.state,
      movementScore: this.score,
      inactivityDetected: this.inactivityDetected,
      inactivityDurationSeconds: Math.round(this.inactivityTimerSec),
      possibleFallLikeEvent: this.possibleFallLikeEvent,
      lastMovementTimestamp: this.lastMovementT,
      sensorAvailability: { accelerometer: true, gyroscope: this.gyroAvailable ? 'available' : 'unavailable-or-idle' },
      confidence: this.window.length < 5 ? 'LOW (warming up)' : this.inactivityDetected ? 'MEDIUM (supporting only)' : 'MEDIUM',
      _debug: { raw: +this.lastRaw.toFixed(2), linear: +this.lastLin.toFixed(2), smoothed: +this.smooth.toFixed(2) },
      generatedAt: new Date(t).toISOString(),
    };
  }
  // Auto-map sensor inactivity duration -> existing manual dropdown value (gt30/10to30/lt10/active).
  static durationToDropdown(sec, hasMoved) {
    if (hasMoved) return 'active';
    if (sec >= 30 * 60) return 'gt30';
    if (sec >= 10 * 60) return '10to30';
    return 'lt10';
  }
}

// DOM/sensor lifecycle manager. Battery-safe: listens ONLY while monitoring.
const MovementSensorManager = {
  analyzer: new MovementAnalyzer(),
  monitoring: false, _handler: null, _lastSample: 0, _uiTimer: null,
  _permState: 'unknown', // granted | denied | not-needed | unavailable
  support() { return typeof window !== 'undefined' && 'DeviceMotionEvent' in window; },
  async start(opts = {}) {
    if (opts.thresholdSeconds) this.analyzer.cfg.INACTIVITY_THRESHOLD_SECONDS = opts.thresholdSeconds;
    if (this.monitoring) return true;
    if (!this.support()) { this._permState = 'unavailable'; this.renderMsg('Motion sensors unavailable on this device/browser — manual inactivity stays.'); return false; }
    // iOS 13+ needs explicit permission via user gesture (Start button = gesture, OK).
    try {
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission();
        this._permState = r === 'granted' ? 'granted' : 'denied';
        if (r !== 'granted') { this.renderMsg('Motion permission denied — manual inactivity stays.'); return false; }
      } else this._permState = 'not-needed';
    } catch (e) { this._permState = 'denied'; this.renderMsg('Motion permission error — manual inactivity stays.'); return false; }
    this.monitoring = true;
    this._lastSample = 0;
    this._handler = (e) => {
      const now = performance.now();
      if (now - this._lastSample < this.analyzer.cfg.SAMPLE_THROTTLE_MS) return; // throttle ~5Hz
      this._lastSample = now;
      const acc = e.accelerationIncludingGravity || e.acceleration;
      if (!acc || acc.x == null) return;
      const rr = e.rotationRate || null;
      this.analyzer.push(acc.x, acc.y, acc.z,
        rr ? { x: rr.alpha || 0, y: rr.beta || 0, z: rr.gamma || 0 } : null, Date.now());
    };
    window.addEventListener('devicemotion', this._handler);
    this.renderMsg('Monitoring movement locally (offline)… keep phone on you.');
    this._uiTimer = setInterval(() => this.render(), 1000);
    this.render();
    return true;
  },
  stop(reason = 'stopped') {
    this.monitoring = false;
    if (this._handler) window.removeEventListener('devicemotion', this._handler);
    this._handler = null;
    if (this._uiTimer) clearInterval(this._uiTimer);
    this._uiTimer = null;
    this.renderMsg('Monitoring ' + reason + '. Listeners released (battery safe).');
    this.render();
  },
  snapshot() { return this.analyzer.status(); },
  // Push sensor result into existing manual dropdown WITHOUT deleting manual option.
  // Same pattern as heart-rate auto-fill: live mode updates the note every tick
  // and flips the dropdown the moment the auto bucket changes (gt30/10to30/lt10/active).
  syncToDropdown(live = false) {
    const s = this.snapshot();
    const dd = document.getElementById('p-inactivity');
    if (!dd) return s;
    const auto = MovementAnalyzer.durationToDropdown(s.inactivityDurationSeconds, s.movementScore >= 31);
    if (this.monitoring && this.analyzer.window.length >= 5) {
      if (!live || dd.value !== auto) dd.value = auto; // live: only touch DOM on change
      const note = document.getElementById('moveSyncNote');
      if (note) { note.textContent = `↳ ${live ? 'LIVE auto-fill' : 'auto'} from accelerometer: ${s.movementState} score ${s.movementScore} inactivity ${s.inactivityDurationSeconds}s → dropdown “${auto}” — same value used in priority`; note.classList.remove('hidden'); }
    }
    return s;
  },
  render() {
    const s = this.snapshot();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('mvState', (this.monitoring ? (s.movementState === 'PROLONGED_INACTIVITY' ? '🟠 ' : '🟢 ') : '⏸ ') + s.movementState);
    set('mvScore', s.movementScore + ' / 100');
    set('mvInact', s.inactivityDetected ? 'YES — prolonged inactivity detected' : 'No');
    const d = s.inactivityDurationSeconds;
    set('mvDur', String(Math.floor(d / 60)).padStart(2, '0') + ':' + String(d % 60).padStart(2, '0') + ` (${d}s)`);
    set('mvFall', s.possibleFallLikeEvent ? 'YES — possible fall-like event detected' : 'No');
    set('mvRaw', `raw ${s._debug.raw} • linear ${s._debug.linear} • smooth ${s._debug.smoothed} • win ${this.analyzer.window.length} • thr ${this.analyzer.cfg.INACTIVITY_THRESHOLD_SECONDS}s • perm ${this._permState}`);
    const dot = document.getElementById('mvDot');
    if (dot) dot.style.background = !this.monitoring ? '#64748b' : s.movementState === 'PROLONGED_INACTIVITY' || s.possibleFallLikeEvent ? '#f59e0b' : '#22c55e';
    // Real-time victim-assessment sync (like heart-rate auto-fill): every 1s tick
    // pushes the live state into the inactivity dropdown + note above.
    try { if (this.monitoring) this.syncToDropdown(true); } catch (e) {}
  },
  renderMsg(m) { const el = document.getElementById('mvMsg'); if (el) el.textContent = m; },
};

// Test-mode simulator (no sensors needed): feeds synthetic accel through the REAL analyzer.
const MovementTest = {
  run(kind) {
    const A = MovementSensorManager.analyzer;
    const t0 = Date.now();
    const feed = (sec, fn) => { for (let i = 0; i < sec * 5; i++) { const [x, y, z] = fn(i / 5); A.push(x, y, z, null, t0 + (sec * 0 + i) * 200); } };
    if (kind === 'still') feed(10, () => [0.05, -0.03, 9.81]);
    if (kind === 'walk') feed(10, (t) => [0.9 * Math.sin(t * 6), 0.5 * Math.sin(t * 6 + 1), 9.81 + 0.7 * Math.sin(t * 6 + 2)]);
    if (kind === 'shake') feed(6, (t) => [3.2 * Math.sin(t * 25), 2.4 * Math.sin(t * 22), 9.81 + 2.8 * Math.sin(t * 27)]);
    if (kind === 'fall') { feed(3, (t) => [0.4 * Math.sin(t * 5), 0.3, 9.81]); A.push(7.5, 1.0, 3.0, { x: 2.0, y: 0.5, z: 0.3 }, t0 + 4000); feed(12, () => [0.04, -0.02, 9.81]); }
    MovementSensorManager.render(); MovementSensorManager.syncToDropdown();
  },
};

// Node export for quick logic tests (browser ignores).
try { if (typeof module !== 'undefined') module.exports = { MovementConfig, MovementAnalyzer }; } catch (e) {}
