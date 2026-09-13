// ============================================================
// ResQLink — hybrid priority + offline LocationService + HeartRateService
// Priority = Emergency Severity (primary) + supporting sensors.
// GPS failure never downgrades CRITICAL. HR is supporting only.
// ============================================================
let state = { user:null, severity:null, lastResult:null, lastSOSId:null };
const $ = id => document.getElementById(id);
const nowISO = () => new Date().toISOString();
const uid = p => p + '-' + Math.floor(10000 + Math.random()*89999);

function go(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $(id).classList.add('active');
  const map={'screen-register':1,'screen-role':2,'screen-emergency':3,'screen-assess':4,'screen-rescuer':4,'screen-mesh':4,'screen-session':4};
  document.querySelectorAll('#stepper .step').forEach(el=>{
    el.classList.toggle('active', +el.dataset.s === (map[id]||1));
  });
  window.scrollTo({top:0,behavior:'smooth'});
}

// ---------- 1. Registration ----------
function registerUser(){
  const v = {
    name:$('f-name').value.trim(), age:+$('f-age').value,
    email:$('f-email').value.trim(), phone:$('f-phone').value.trim(),
    gender:$('f-gender').value, blood:$('f-blood').value,
    econtact:$('f-econtact').value.trim(), medical:$('f-medical').value.trim(),
    victimId: 'V-' + Math.floor(1000+Math.random()*9000), at: nowISO()
  };
  let err='';
  if(v.name.length<2) err='Please enter your full name.';
  else if(!v.age||v.age<1||v.age>120) err='Please enter a valid age.';
  else if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) err='Please enter a valid email.';
  else if(v.phone.replace(/\D/g,'').length<7) err='Please enter a valid phone number.';
  else if(!v.econtact) err='Please add an emergency contact.';
  $('regErr').textContent=err;
  if(err) return;
  state.user=v; localStorage.setItem('resqlink_user',JSON.stringify(v));
  enterApp();
}
function enterApp(){
  $('helloName').textContent=state.user.name.split(' ')[0];
  $('userChip').textContent='👤 '+state.user.name;
  $('userChip').classList.remove('hidden');
  go('screen-role');
}
function logout(){ go('screen-register'); }
function pickRole(r){ r==='victim' ? go('screen-emergency') : openRescuer(); }
// show/hide "Other" free-text box under each dropdown
function toggleOther(selId, boxId){
  const v=$(selId).value;
  $(boxId).classList.toggle('hidden', v!=='other');
  if(v==='other') $(boxId).focus();
}
function otherText(id){ const el=$(id); return el?el.value.trim():''; }
// keyword scoring for free-text "Other": severe words push score up
function scoreOtherText(txt, high, mid){
  if(!txt) return mid;
  const t=txt.toLowerCase();
  const severe=['unconscious','trapped','bleed','severe','fracture','chest','breath','crush','collapse','stuck','multiple','critical','emergency'];
  const mild=['safe','fine','ok','minor','stable','walking','active','good'];
  if(severe.some(w=>t.includes(w))) return high;
  if(mild.some(w=>t.includes(w))) return 2;
  return mid;
}
function pickSeverity(s){
  state.severity=s;
  $('chosenSev').textContent = s==='CRITICAL'?'🔴 CRITICAL':s==='HIGH'?'🟠 HIGH':'🟢 NORMAL';
  $('chosenSev').style.background = s==='CRITICAL'?'#dc2626':s==='HIGH'?'#ea580c':'#16a34a';
  $('chosenSev').style.color='#fff';
  go('screen-assess');
  readLiveSensors();
  LocationService.requestFix(true);
  // SOS activated -> start offline movement monitoring (battery-safe, sensors only, no network).
  try{
    if(typeof MovementSensorManager!=='undefined'){
      MovementSensorManager.start();
      const so=$('mvSos'); if(so) so.textContent='ACTIVE (monitoring)';
    }
  }catch(e){}
}
async function readLiveSensors(){
  const parts=[];
  parts.push(navigator.onLine?'🌐 online':'📵 offline (mesh mode)');
  if(navigator.connection) parts.push('~'+(navigator.connection.effectiveType||'unknown'));
  try{
    if(navigator.getBattery){
      const b=await navigator.getBattery();
      const pct=Math.round(b.level*100);
      if(!$('p-batt').value || $('p-batt').value==='34') $('p-batt').value=pct;
      parts.push('🔋 '+pct+'%'+(b.charging?' ⚡':''));
    }
  }catch(e){}
  $('liveSensors').textContent='📡 Live: '+parts.join(' • ');
}

// ============================================================
// 2. LocationService — OFFLINE GNSS (no maps/internet needed)
// States: PERMISSION_REQUIRED, DISABLED, SEARCHING, FIX_AVAILABLE,
// HIGH_ACCURACY, LOW_ACCURACY, SIGNAL_LOST, USING_LAST_KNOWN, UNAVAILABLE
// ============================================================
const LocationService = {
  state:'SEARCHING', watchId:null, fix:null, lastKnown:null, simMode:false,
  accLabel(a){ if(a==null) return '—'; if(a<=10) return `±${a} m • Excellent`; if(a<=30) return `±${a} m • Good`; if(a<=100) return `±${a} m • Fair`; return `±${a} m • Poor`; },
  calcConfidence(acc, ageSec, hasFix){
    if(!hasFix) return 'UNAVAILABLE';
    if(ageSec>120 || (acc!=null&&acc>200)) return 'LOW';
    if(acc!=null&&acc<=15&&ageSec<=30) return 'HIGH';
    if(acc!=null&&acc<=60&&ageSec<=90) return 'MEDIUM';
    return 'LOW';
  },
  ageSec(){ if(!this.fix||!this.fix.timestamp) return null; return Math.round((Date.now()-new Date(this.fix.timestamp).getTime())/1000); },
  render(){
    const f=this.fix, el=$('locState');
    el.className='loc-state '+this.state;
    const labels={PERMISSION_REQUIRED:'🔒 LOCATION_PERMISSION_REQUIRED',DISABLED:'⚙️ LOCATION_DISABLED',SEARCHING:'📍 SEARCHING…',FIX_AVAILABLE:'📍 GPS FIX AVAILABLE',HIGH_ACCURACY:'📍 GPS ACTIVE • HIGH ACCURACY',LOW_ACCURACY:'📍 GPS FIX • LOW ACCURACY',SIGNAL_LOST:'⚠️ SIGNAL_LOST — using last known',USING_LAST_KNOWN:'⚠️ LAST KNOWN LOCATION',UNAVAILABLE:'⚠️ LOCATION UNAVAILABLE',SIM:'🧪 SIMULATED LOCATION (DEMO)'};
    el.textContent=labels[this.state]||this.state;
    $('locLat').textContent=f&&f.latitude!=null?Number(f.latitude).toFixed(5)+'°':'—';
    $('locLon').textContent=f&&f.longitude!=null?Number(f.longitude).toFixed(5)+'°':'—';
    $('locAcc').textContent=this.accLabel(f?f.accuracy:null);
    $('locQual').textContent=f&&f.accuracy!=null?(f.accuracy<=10?'Excellent':f.accuracy<=30?'Good':f.accuracy<=100?'Fair':'Poor'):'—';
    $('locConf').textContent=f?f.confidence:'—';
    const a=this.ageSec();
    $('locAge').textContent=f&&f.timestamp?(a<3?'just now':a+'s ago')+' • '+new Date(f.timestamp).toLocaleTimeString():'—';
    const msgs={PERMISSION_REQUIRED:'Location permission is required to include your position in an SOS. SOS still works without it.',DISABLED:'Location services disabled. Enable GPS — SOS can still be sent.',SEARCHING:'Searching for GPS satellites. Keep phone in open area if possible. Status: waiting for fix.',FIX_AVAILABLE:'GPS fix available. Attach to SOS.',HIGH_ACCURACY:'Good GPS fix, recent timestamp → HIGH confidence.',LOW_ACCURACY:'Poor/old fix → LOW confidence. Still attached, not shown as exact.',SIGNAL_LOST:'GPS signal lost. Using last known location — labelled LAST_KNOWN, never as current.',USING_LAST_KNOWN:'Fresh GPS unavailable → last known attached, source=LAST_KNOWN.',UNAVAILABLE:'GPS unavailable. SOS can still be sent through the offline network; location updates when fix returns.',SIM:'DEMO coordinates — never confused with real GPS.'};
    $('locMsg').textContent=msgs[this.state]||'';
  },
  storeFix(lat,lon,acc,alt,spd,brg,source){
    const fix={latitude:lat,longitude:lon,accuracy:acc,altitude:alt??null,speed:spd??null,bearing:brg??null,
      timestamp:nowISO(),source:source||'GNSS'};
    const age=0;
    fix.confidence=this.calcConfidence(acc,age,true);
    this.fix=fix; this.lastKnown=fix;
    try{localStorage.setItem('resqlink_lastloc',JSON.stringify(fix));}catch(e){}
    this.state = source==='LAST_KNOWN'?'USING_LAST_KNOWN':(acc!=null&&acc<=20?'HIGH_ACCURACY':acc!=null&&acc<=100?'FIX_AVAILABLE':'LOW_ACCURACY');
    this.render();
  },
  requestFix(silent){
    if(this.simMode){this.render();return;}
    if(!navigator.geolocation){this.state='UNAVAILABLE';this.loadLastKnown()||this.render();return;}
    this.state='SEARCHING';this.render();
    navigator.geolocation.getCurrentPosition(
      p=>{const c=p.coords;this.storeFix(c.latitude,c.longitude,c.accuracy!=null?Math.round(c.accuracy):null,c.altitude??null,c.speed??null,c.heading??null,'GNSS');},
      err=>{
        if(err&&err.code===1){this.state='PERMISSION_REQUIRED';}
        else{ // try last known, else unavailable — NEVER fake coords, NEVER block SOS
          if(!this.loadLastKnown()){this.state='UNAVAILABLE';this.fix={latitude:null,longitude:null,accuracy:null,altitude:null,speed:null,bearing:null,timestamp:null,confidence:'UNAVAILABLE',source:'UNAVAILABLE'};}
        }
        this.render();
      },
      {enableHighAccuracy:true,timeout:9000,maximumAge:30000});
  },
  loadLastKnown(){
    try{const s=localStorage.getItem('resqlink_lastloc');if(!s)return false;
      const f=JSON.parse(s);if(f.latitude==null)return false;
      f.source='LAST_KNOWN';f.confidence=this.calcConfidence(f.accuracy,999,true)==='HIGH'?'MEDIUM':'LOW';
      this.fix=f;this.state='USING_LAST_KNOWN';return true;}catch(e){return false;}
  },
  startTracking(){
    if(!navigator.geolocation||this.watchId!=null)return;
    this.watchId=navigator.geolocation.watchPosition(
      p=>{const c=p.coords;this.storeFix(c.latitude,c.longitude,c.accuracy!=null?Math.round(c.accuracy):null,c.altitude??null,c.speed??null,c.heading??null,'GNSS');},
      ()=>{this.state='SIGNAL_LOST';this.render();},
      {enableHighAccuracy:true,timeout:12000,maximumAge:10000});
  },
  stopTracking(){ if(this.watchId!=null){navigator.geolocation.clearWatch(this.watchId);this.watchId=null;} },
  toggleSim(){ this.simMode=!this.simMode; $('locSim').classList.toggle('hidden',!this.simMode);
    if(this.simMode){this.state='SIM';this.render();} else {this.state='SEARCHING';this.render();} },
  applySim(){
    const lat=+$('sim-lat').value, lon=+$('sim-lon').value, acc=+$('sim-acc').value||10;
    this.storeFix(lat,lon,acc,null,null,null,'SIM'); this.state='SIM'; this.render();
  },
  payload(){
    if(this.fix&&this.fix.latitude!=null) return {...this.fix};
    if(this.loadLastKnown()) return {...this.fix};
    return {latitude:null,longitude:null,accuracy:null,altitude:null,speed:null,bearing:null,timestamp:null,confidence:'UNAVAILABLE',source:'UNAVAILABLE'};
  }
};

// ============================================================
// 3. HeartRateService — rear camera + flash PPG, fully offline
// Pipeline: frames -> red avg (ROI) -> detrend -> smooth ->
// peak detect -> median IBI -> BPM + quality. + simulation mode.
// ============================================================
const HeartRateService = {
  running:false, stream:null, track:null, torchOn:false,
  samples:[], startT:0, timer:null, raf:null, lastFrameT:0,
  result:{bpm:null,signalQuality:0,label:'---',mode:'REAL'},
  async start(){
    // RESET every time Start is pressed — fresh measurement
    this.samples=[]; this.result={bpm:0,signalQuality:0,label:'---',mode:'REAL'};
    $('hrBpm').textContent='0'; $('p-hr').value=0;
    const sync=$('hrSyncNote'); if(sync){sync.textContent='↳ measuring… value reset to 0, will auto-fill on complete';sync.classList.remove('hidden');}
    if($('hrQBar')){$('hrQBar').style.width='0%';}
    if($('hrQLabel')){$('hrQLabel').textContent='---';}
    if($('hrProgBar')){$('hrProgBar').style.width='0%';}
    const simVal=+$('hrSimBpm').value||0;
    if(simVal>0){this.startSim(simVal);return;}
    // REAL camera mode — camera OPENS here, permission requested now
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
      $('hrMsg').textContent='Camera API unavailable here (needs HTTPS/localhost + real phone). Use simulation mode for demo.';
      $('hrPerm').textContent='🔒 Camera: unsupported in this browser.';
      return;
    }
    // must be secure context (localhost or https) for camera
    if(!window.isSecureContext){
      $('hrMsg').textContent='Camera needs a secure context (open via http://localhost:8000, not file://). Use simulation meanwhile.';
      $('hrPerm').textContent='🔒 Camera: blocked — not a secure context.';
      return;
    }
    try{
      $('hrMsg').textContent='Requesting camera permission — please tap Allow…';
      $('hrPerm').textContent='🔒 Camera: requesting permission…';
      $('hrState').textContent='Waiting for camera permission…';
      this.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:640},height:{ideal:480}},audio:false});
      $('hrPerm').textContent='🔒 Camera: granted ✓ — rear camera live below. Flash turns ON automatically.';
      // SHOW live camera preview immediately
      $('hrCamWrap').classList.remove('hidden');
      const v=$('hrVideo'); v.srcObject=this.stream; v.muted=true;
      await v.play();
      // torch ON
      this.track=this.stream.getVideoTracks()[0];
      try{
        const caps=this.track.getCapabilities&&this.track.getCapabilities();
        if(caps&&caps.torch){await this.track.applyConstraints({advanced:[{torch:true}]});this.torchOn=true;}
      }catch(e){}
      if(!this.torchOn){$('hrMsg').textContent='Flash unavailable on this device — hold fingertip over lens in bright light, keep still for 30s. Camera preview is live below.';}
      else{$('hrMsg').textContent='✅ Camera + flash ON. Now: cover lens+flash fully with fingertip, keep still for 30 seconds.';}
      this.beginCapture(false,0);
    }catch(err){
      if(err&&err.name==='NotAllowedError'){$('hrMsg').textContent='Camera permission DENIED. Tap Start again and choose Allow — measurement cannot run without camera.';$('hrPerm').textContent='🔒 Camera: denied ✕ — allow it in the browser prompt.';}
      else if(err&&err.name==='NotFoundError'){$('hrMsg').textContent='No rear camera found on this device. Use simulation mode.';$('hrPerm').textContent='🔒 Camera: not found.';}
      else{$('hrMsg').textContent='Camera permission is required for heart-rate estimation. '+(err&&err.name||'');$('hrPerm').textContent='🔒 Camera: error — '+(err&&err.name||'unknown');}
      $('hrState').textContent='Camera not started — permission required';
    }
  },
  startSim(targetBpm){
    this.stopTracks();
    $('hrCamWrap').classList.remove('hidden'); // show panel so progress is visible even in sim
    $('hrPerm').textContent='🧪 Simulation — no camera needed.';
    $('hrMsg').textContent='🧪 SIMULATION MODE (DEMO) — synthetic PPG at ~'+targetBpm+' BPM through the real pipeline. Keep still anyway for realism.';
    this.beginCapture(true,targetBpm);
  },
  beginCapture(isSim,targetBpm){
    this.running=true;this.samples=[];this.startT=performance.now();
    $('hrStartBtn').textContent='⏺ Measuring… (30s)';$('hrStartBtn').disabled=true;
    $('hrState').textContent=isSim?'SIMULATING… keep finger still for demo':'STEP 2/3: fingertip ON lens+flash — hold still…';
    if($('hrProgBar')){$('hrProgBar').style.width='0%';}
    if($('hrProgTxt')){$('hrProgTxt').textContent='0s / 30s — keep finger still';}
    const canvas=$('ppgCanvas'),ctx=canvas.getContext('2d');
    const v=$('hrVideo');
    const proc=document.createElement('canvas');proc.width=64;proc.height=48;
    const pctx=proc.getContext('2d',{willReadFrequently:true});
    let simPhase=0;
    const tick=()=>{
      if(!this.running)return;
      const el=(performance.now()-this.startT)/1000;
      let red,t;
      if(isSim){ // synthetic PPG: pulse sine + noise, sampled ~30Hz
        simPhase+= (targetBpm/60)*2*Math.PI/30;
        red=170+22*Math.sin(simPhase)+6*Math.sin(simPhase*2.3)+ (Math.random()*4-2);
        t=el;
        this.samples.push({t,red});
      }else{
        if(v.readyState>=2){
          pctx.drawImage(v,0,0,64,48);
          const d=pctx.getImageData(16,12,32,24).data;
          let r=0,g=0,b=0,n=d.length/4;
          for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];}
          r/=n;g/=n;b/=n;
          // finger check: red-dominant = GOOD_SIGNAL
          if(!(r>80&&r>g*1.05&&r>b*1.05)){
            $('hrState').textContent='LOW_SIGNAL — cover camera completely with fingertip';
          }else if(this.fingerBad()){$('hrState').textContent='TOO_MUCH_MOVEMENT — keep finger still';}
          else{$('hrState').textContent='GOOD_SIGNAL — keep still… '+Math.floor(el)+'s / 30s';}
          this.samples.push({t:el,red:r,r,g,b});
        }
      }
      this.drawWave(ctx,canvas);
      if($('hrProgBar')){$('hrProgBar').style.width=Math.min(100,el/30*100)+'%';}
      if($('hrProgTxt')){$('hrProgTxt').textContent=Math.floor(el)+'s / 30s — keep finger still, don\'t move';}
      // live BPM preview every 2s after 8s
      if(el>8&&this.samples.length>100){const est=this.compute(true);if(est.bpm){$('hrBpm').textContent=est.bpm;$('hrQLabel').textContent=est.label;$('hrQBar').style.width=est.q+'%';}}
      if(el>=30){this.finish();return;}
      this.timer=setTimeout(()=>requestAnimationFrame(tick), isSim?33:66);
    };
    tick();
  },
  fingerBad(){ // excessive frame-to-frame variation
    const s=this.samples;if(s.length<6)return false;
    const last=s.slice(-6).map(x=>x.red);
    const m=last.reduce((a,b)=>a+b,0)/last.length;
    const v=last.reduce((a,b)=>a+(b-m)*(b-m),0)/last.length;
    return Math.sqrt(v)>18;
  },
  drawWave(ctx,canvas){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#0f172a';ctx.fillRect(0,0,canvas.width,canvas.height);
    const s=this.samples.slice(-150);if(s.length<2)return;
    const vals=s.map(x=>x.red),mn=Math.min(...vals),mx=Math.max(...vals),rg=(mx-mn)||1;
    ctx.strokeStyle='#22c55e';ctx.lineWidth=2;ctx.beginPath();
    s.forEach((p,i)=>{const x=i/(s.length-1)*canvas.width;const y=canvas.height-6-((p.red-mn)/rg)*(canvas.height-12);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
    ctx.stroke();
  },
  // --- signal processing: detrend -> smooth -> peak detect -> median IBI ---
  compute(preview){
    const s=this.samples.filter(x=>isFinite(x.red));if(s.length<60)return{bpm:null};
    // detrend: subtract moving average (window ~15)
    const W=15,det=[];
    for(let i=0;i<s.length;i++){let a=0,c=0;for(let j=Math.max(0,i-W);j<=Math.min(s.length-1,i+W);j++){a+=s[j].red;c++;}det.push(s[i].red-a/c);}
    // smooth (moving avg 3)
    const sm=det.map((_,i)=>{let a=0,c=0;for(let j=Math.max(0,i-1);j<=Math.min(det.length-1,i+1);j++){a+=det[j];c++;}return a/c;});
    const dt=s.length>1?(s[s.length-1].t-s[0].t)/s.length:1/30;
    const fs=1/Math.max(dt,0.01);
    // peak detect: local max, min distance 0.4s (150bpm max), amplitude gate
    const minDist=Math.floor(0.4*fs),std=Math.sqrt(sm.reduce((a,b)=>a+b*b,0)/sm.length)||1;
    const peaks=[];
    for(let i=1;i<sm.length-1;i++){
      if(sm[i]>sm[i-1]&&sm[i]>=sm[i+1]&&sm[i]>std*0.5){
        if(!peaks.length||i-peaks[peaks.length-1]>=minDist)peaks.push(i);
      }
    }
    if(peaks.length<3)return{bpm:null};
    const ibis=[];
    for(let i=1;i<peaks.length;i++){const d=(s[peaks[i]].t-s[peaks[i-1]].t);if(d>0.35&&d<2.0)ibis.push(d);}
    if(ibis.length<2)return{bpm:null};
    ibis.sort((a,b)=>a-b);
    const med=ibis[Math.floor(ibis.length/2)];
    const bpm=Math.round(60/med);
    // Valid human range for camera PPG; normal resting band is 60–80 BPM
    if(bpm<40||bpm>180)return{bpm:null};
    // quality: periodicity + count + amplitude
    const mean=ibis.reduce((a,b)=>a+b,0)/ibis.length;
    const sd=Math.sqrt(ibis.reduce((a,b)=>a+(b-mean)*(b-mean),0)/ibis.length);
    const cv=sd/mean;
    let q=Math.round(95-cv*160+Math.min(peaks.length,40));
    q=Math.max(5,Math.min(100,q));
    if(preview&&q<30)return{bpm:null};
    const label=q>=81?'Excellent':q>=61?'Good':q>=31?'Fair':'Poor';
    return{bpm,q,label,beats:peaks.length,n:s.length};
  },
  async finish(){
    this.running=false;$('hrStartBtn').disabled=false;$('hrStartBtn').textContent='📷 Start measurement';
    const est=this.compute(false);
    const dur=Math.round((performance.now()-this.startT)/1000);
    if($('hrProgBar')){$('hrProgBar').style.width='100%';}
    if($('hrProgTxt')){$('hrProgTxt').textContent='Done — you can lift your finger. Flash is OFF.';
    }
    if(est.bpm&&est.q>=30){
      this.result={bpm:est.bpm,signalQuality:est.q,label:est.label,measurementDuration:dur,validSamples:est.n,detectedBeats:est.beats,timestamp:nowISO(),estimated:true,mode:+$('hrSimBpm').value>0?'SIM':'REAL'};
      $('hrBpm').textContent=est.bpm;$('hrQLabel').textContent=est.label+` • ${dur}s • ${est.beats} beats`;$('hrQBar').style.width=est.q+'%';
      $('hrState').textContent='COMPLETE — estimated '+est.bpm+' BPM ('+est.label+'). You can lift your finger.';
      // AUTO-SYNC: same measured value straight into victim assessment field
      $('p-hr').value=est.bpm;
      const sync=$('hrSyncNote');
      if(sync){sync.textContent=`↳ auto-filled from camera: ${est.bpm} BPM (${est.label}, ${this.result.mode}, ${dur}s) — same value used in priority`;sync.classList.remove('hidden');}
      $('hrMsg').textContent=(this.result.mode==='SIM'?'🧪 DEMO result auto-filled into assessment. ':'STEP 3/3 done — value auto-filled into assessment above. ')+'Camera-based estimate — not a medical diagnosis.';
    }else{
      this.result={bpm:null,signalQuality:0,label:'Poor',mode:'REAL'};
      $('hrState').textContent='FAILED — poor signal. You can lift your finger.';
      $('hrMsg').textContent='Unable to obtain a reliable reading. Next try: press Start again, cover camera+flash fully with fingertip, keep still full 30s. No value invented.';
    }
    this.stopTracks();
  },
  stopTracks(){
    try{if(this.track&&this.torchOn){this.track.applyConstraints({advanced:[{torch:false}]}).catch(()=>{});} }catch(e){}
    this.torchOn=false;
    try{if(this.stream){this.stream.getTracks().forEach(t=>t.stop());} }catch(e){}
    this.stream=null;
    try{const v=$('hrVideo');v.pause();v.srcObject=null;}catch(e){}
    $('hrPerm').textContent='🔒 Camera: released (torch OFF). Press Start to open it again.';
  },
  stop(){ this.running=false;clearTimeout(this.timer);$('hrStartBtn').disabled=false;$('hrStartBtn').textContent='📷 Start measurement';this.stopTracks();$('hrState').textContent='Stopped by user — you can lift your finger. Torch OFF';if($('hrProgTxt')){$('hrProgTxt').textContent='Stopped.';} },
  useInSOS(){
    if(this.result.bpm){$('p-hr').value=this.result.bpm;
      const sync=$('hrSyncNote');
      if(sync){sync.textContent=`↳ auto-filled from camera: ${this.result.bpm} BPM (${this.result.label}, ${this.result.mode}) — same value used in priority`;sync.classList.remove('hidden');}
      $('hrMsg').textContent='✓ '+this.result.bpm+' BPM ('+this.result.mode+') in assessment field — same value used for priority + SOS packet.';
    }else{$('hrMsg').textContent='No valid estimate yet — measure first (or enter manually). Null stays null, never guessed.';}
  }
};

// ---------- 4. Priority engine (8 params / 100) ----------
function scoreAll(){
  // Auto-fill inactivity from offline accelerometer BEFORE scoring (manual stays if sensors absent).
  let autoMove=null;
  try{
    if(typeof MovementSensorManager!=='undefined' && MovementSensorManager.monitoring){
      autoMove=MovementSensorManager.syncToDropdown();
    }
  }catch(e){}
  const s=state.severity;
  const sevScore = s==='CRITICAL'?40 : s==='HIGH'?25 : 10;
  const condMap={unconscious:12,fracture:9,stable:6,safe:2,other:6};
  let cond=$('p-condition').value;
  let cScore=condMap[cond];
  let condNote='';
  if(cond==='other'){ condNote=otherText('p-condition-other'); cScore=scoreOtherText(condNote,12,6); cond='other: '+condNote; }
  const inaMap={gt30:10,'10to30':7,lt10:3,active:0,other:5};
  let ina=$('p-inactivity').value;
  let iScore=inaMap[ina];
  let inaNote='';
  if(ina==='other'){ inaNote=otherText('p-inactivity-other'); iScore=scoreOtherText(inaNote,10,5); ina='other: '+inaNote; }
  const comMap={none:10,weak:7,moderate:4,good:1,other:5};
  let com=$('p-comms').value;
  let comScore=comMap[com];
  let comNote='';
  if(com==='other'){ comNote=otherText('p-comms-other'); comScore=scoreOtherText(comNote,10,5); com='other: '+comNote; }
  // location: manual context refined by real GPS confidence (supporting only)
  const locMap={isolated:8,rural:5,urban:2,other:5};
  let loc=$('p-location').value;
  let lScore=locMap[loc]??5;
  let locNote='';
  if(loc==='other'){ locNote=otherText('p-location-other'); lScore=scoreOtherText(locNote,8,5); loc='other: '+locNote; }
  const lp=LocationService.payload();
  if(lp.confidence==='UNAVAILABLE'){lScore=Math.max(2,lScore-2);} // never punish missing GPS harshly
  const wait=Math.max(0,+$('p-wait').value||0);
  const wScore= wait>60?8 : wait>=30?5 : wait>=10?3 : 1;
  const hr=+$('p-hr').value||null;
  // Normal resting band 60–80 BPM (supporting factor only, never primary)
  const hrAb= hr==null||hr===0?1 : (hr>=60&&hr<=80)?1 : (hr>=50&&hr<=100)?3 : 6;
  const batt=+($('p-batt').value); const bScore= batt<15?6 : batt<40?4 : batt<70?2 : 0;
  const total=sevScore+cScore+iScore+comScore+lScore+wScore+hrAb+bScore;
  return {sevScore,cScore,iScore,comScore,lScore,wScore,hrAb,bScore,total,
    move:autoMove, // offline accelerometer snapshot (supporting evidence, may be null on desktop)
    meta:{cond,ina,com,loc,wait,hr,batt,group:+$('p-group').value||1}};
}
function confidence(userSev, sensorOnly){
  const userScore = userSev==='CRITICAL'?90 : userSev==='HIGH'?60 : 25;
  const diff = Math.abs(userScore-sensorOnly);
  let pct = Math.round(100 - diff*0.6);
  pct=Math.max(45,Math.min(98,pct));
  let label,msg;
  if(userSev==='CRITICAL' && sensorOnly>=60){label='HIGH';msg='✅ Sensors match critical claim. Dispatch immediately.';}
  else if(userSev==='CRITICAL' && sensorOnly<40){label='MEDIUM — VERIFY';msg='⚠️ Critical claimed but sensors look calm. Keep priority, flag for quick verification (possible false input).';}
  else if(userSev==='NORMAL' && sensorOnly>=55){label='MEDIUM — ESCALATED ⬆';msg='⬆️ User said NORMAL but sensors show risk. Priority auto-increased.';}
  else if(diff<=15){label='HIGH';msg='✅ User input and sensors agree.';}
  else if(diff<=35){label='MEDIUM';msg='🔍 Partial match — monitor, re-assess in 10 min.';}
  else{label='MEDIUM — VERIFY';msg='⚠️ Mismatch — trust severity first, verify via relay nodes.';}
  return {pct,label,msg};
}
function calculatePriority(){
  if(!state.severity){alert('Pick an emergency level first');go('screen-emergency');return;}
  const r=scoreAll();
  const sensorRaw=r.cScore+r.iScore+r.comScore+r.lScore+r.wScore+r.hrAb+r.bScore;
  const sensorOnly=Math.round(sensorRaw/60*100);
  const conf=confidence(state.severity,sensorOnly);
  let final = r.total>=70?'CRITICAL':r.total>=40?'HIGH':'NORMAL';
  let escalated=false;
  if(state.severity==='NORMAL' && sensorOnly>=55 && final==='NORMAL'){final='HIGH';escalated=true;}
  // Movement is SUPPORTING ONLY: severity stays primary. CRITICAL + normal movement
  // => keep priority, mark "manual condition and sensor activity do not strongly correlate".
  let moveNote='';
  if(r.move){
    if(state.severity==='CRITICAL' && r.move.movementScore>=31 && !r.move.inactivityDetected){
      moveNote=' 📵 Manual CRITICAL but phone moving normally — manual condition and sensor activity do not strongly correlate (verify, keep priority).';
    }else if(state.severity==='HIGH' && r.move.inactivityDetected){
      moveNote=' 🧍 Prolonged inactivity detected ('+r.move.inactivityDurationSeconds+'s) supports HIGH urgency.';
    }else if(state.severity==='NORMAL' && r.move.inactivityDetected){
      moveNote=' ⬆️ Prolonged inactivity detected despite NORMAL claim — supporting escalation evidence.';
    }
    if(r.move.possibleFallLikeEvent) moveNote+=' ⚠️ Possible fall-like event detected (indicator only).';
  }
  conf.msg+=moveNote;
  // GPS failure must NEVER downgrade a CRITICAL SOS (rule)
  const result={...r,final,conf,sensorOnly,sev:state.severity,at:Date.now()};
  saveSOS(result);
  renderResult(result,escalated);
}
function buildPacket(r,loc,hrr){
  const mv=r.move||(typeof MovementSensorManager!=='undefined'?MovementSensorManager.snapshot():null);
  return {
    packetId: state.lastSOSId, packetType:'SOS', victimId: state.user.victimId,
    emergencyLevel: r.sev, condition: r.meta.cond.toUpperCase(), victimCount: r.meta.group,
    location:{latitude:loc.latitude,longitude:loc.longitude,accuracy:loc.accuracy,altitude:loc.altitude,speed:loc.speed,bearing:loc.bearing,timestamp:loc.timestamp,confidence:loc.confidence,source:loc.source},
    movementStatus: r.meta.ina.toUpperCase(), waitingMinutes: r.meta.wait,
    movement: mv?{
      state: mv.movementState, score: mv.movementScore,
      inactivityDetected: mv.inactivityDetected, inactivityDurationSeconds: mv.inactivityDurationSeconds,
      possibleFallLikeEvent: mv.possibleFallLikeEvent
    }:null,
    heartRate: hrr.bpm, heartRateEstimated: hrr.bpm!=null, heartRateSignalQuality: hrr.signalQuality, heartRateMode: hrr.mode||'MANUAL',
    battery: r.meta.batt, communicationRisk: r.meta.com.toUpperCase(),
    priority: r.final, priorityScore: r.total, priorityConfidence: r.conf.pct,
    timestamp: nowISO(), hopCount:0, sourceDevice:'PHONE-'+state.user.victimId, destination:'RESCUE_CENTER'
  };
}
function renderResult(r,escalated){
  $('resultCard').classList.remove('hidden');
  const b=$('rBadge'); b.textContent=(r.final==='CRITICAL'?'🔴 ':r.final==='HIGH'?'🟠 ':'🟢 ')+r.final+(escalated?' ⬆':'');
  b.className='priority-badge '+r.final;
  $('rScore').textContent=r.total;
  $('rConf').textContent=r.conf.pct+'% ('+r.conf.label+')';
  $('rConfBar').firstElementChild.style.width=r.conf.pct+'%';
  $('rMsg').innerHTML=`User said <b>${r.sev}</b> → sensor evidence <b>${r.sensorOnly}/100</b>. ${r.conf.msg}`;
  const rows=[
    ['🚨 Emergency severity (highest weight)',r.sevScore,40,'#ef4444'],
    ['🏥 Physical condition / medical',r.cScore,12,'#dc2626'],
    ['🧍 Prolonged inactivity'+(r.move?' (auto: '+r.move.movementState+' '+r.move.movementScore+'/100, '+r.move.inactivityDurationSeconds+'s)':' (manual)'),r.iScore,10,'#f97316'],
    ['📡 Communication / relay risk',r.comScore,10,'#8b5cf6'],
    ['📍 Location context + GPS confidence ('+(LocationService.fix?LocationService.fix.confidence:'—')+')',r.lScore,8,'#2563eb'],
    ['⏱️ Waiting time ('+r.meta.wait+' min)',r.wScore,8,'#0ea5e9'],
    ['❤️ Heart-rate '+(r.meta.hr??'—')+' bpm (supporting, normal 60–80)',r.hrAb,6,'#ec4899'],
    ['🔋 Battery '+r.meta.batt+'% (supporting, capped)',r.bScore,6,'#16a34a'],
  ];
  $('rBreakdown').innerHTML=rows.map(([k,v,m,c])=>
    `<div class="b-row"><span>${k}</span><b>${v}/${m}</b><div class="b-bar"><span style="width:${Math.round(v/m*100)}%;background:${c}"></span></div></div>`).join('');
  const loc=LocationService.payload();
  const hrr=HeartRateService.result.bpm?HeartRateService.result:{bpm:r.meta.hr,signalQuality:0,mode:'MANUAL'};
  $('packetPreview').textContent=JSON.stringify(buildPacket(r,loc,hrr),null,2);
  refreshVictimStatus();
  $('resultCard').scrollIntoView({behavior:'smooth'});
}

// ---------- 5. SOS store + rescuer Accept/Deny + victim status sync ----------
function getQueue(){ try{return JSON.parse(localStorage.getItem('resqlink_sos')||'[]');}catch(e){return[];} }
function setQueue(q){ localStorage.setItem('resqlink_sos',JSON.stringify(q.slice(0,30))); }
function saveSOS(r){
  state.lastSOSId=uid('SOS');
  const loc=LocationService.payload();
  const hrr=HeartRateService.result.bpm?HeartRateService.result:{bpm:r.meta.hr,signalQuality:0,mode:'MANUAL'};
  const q=getQueue();
  q.unshift({id:state.lastSOSId,packetId:state.lastSOSId,victimId:state.user.victimId,
    name:state.user.name,phone:state.user.phone,age:state.user.age,
    sev:r.sev,final:r.final,score:r.total,conf:r.conf.pct,confLabel:r.conf.label,
    wait:r.meta.wait,hr:hrr.bpm,hrMode:hrr.mode||'MANUAL',
    move:r.move?{state:r.move.movementState,score:r.move.movementScore,
      inact:r.move.inactivityDetected,dur:r.move.inactivityDurationSeconds,
      fall:r.move.possibleFallLikeEvent}:null,
    loc:{lat:loc.latitude,lon:loc.longitude,acc:loc.accuracy,conf:loc.confidence,src:loc.source,ts:loc.timestamp},
    status:'PENDING',at:new Date().toLocaleString(),ts:Date.now()});
  setQueue(q);
}
function seedDemo(){
  const demo=[
    {id:'SOS-10231',packetId:'SOS-10231',victimId:'V-1001',name:'Aarav P. (trapped, basement)',phone:'+91 98XXXXXX01',age:24,sev:'CRITICAL',final:'CRITICAL',score:88,conf:94,confLabel:'HIGH',wait:45,hr:122,hrMode:'SIM',loc:{lat:18.1517,lon:74.5777,acc:8,conf:'HIGH',src:'GNSS',ts:nowISO()},status:'PENDING',at:'2 min ago',ts:Date.now()-120000},
    {id:'SOS-10232',packetId:'SOS-10232',victimId:'V-1002',name:'Sneha K. (lost, forest)',phone:'+91 98XXXXXX02',age:19,sev:'HIGH',final:'HIGH',score:62,conf:81,confLabel:'HIGH',wait:70,hr:96,hrMode:'MANUAL',loc:{lat:18.1601,lon:74.5812,acc:25,conf:'MEDIUM',src:'GNSS',ts:nowISO()},status:'PENDING',at:'9 min ago',ts:Date.now()-540000},
    {id:'SOS-10233',packetId:'SOS-10233',victimId:'V-1003',name:'Rahul M. (safe, needs pickup)',phone:'+91 98XXXXXX03',age:31,sev:'NORMAL',final:'NORMAL',score:28,conf:90,confLabel:'HIGH',wait:12,hr:78,hrMode:'MANUAL',loc:{lat:null,lon:null,acc:null,conf:'UNAVAILABLE',src:'UNAVAILABLE',ts:null},status:'PENDING',at:'15 min ago',ts:Date.now()-900000},
  ];
  setQueue([...getQueue(),...demo]);
  openRescuer();
}
function locLine(v){
  if(!v.loc||v.loc.lat==null) return '⚠ LOCATION UNAVAILABLE — SOS still valid';
  const tag=v.loc.src==='LAST_KNOWN'?'⚠ LAST KNOWN LOCATION':v.loc.src==='SIM'?'🧪 DEMO LOCATION':v.loc.src==='GNSS'?'CURRENT GPS LOCATION':v.loc.src;
  return `📍 ${Number(v.loc.lat).toFixed(4)}°, ${Number(v.loc.lon).toFixed(4)}° ±${v.loc.acc??'?'}m • ${tag} • loc-conf ${v.loc.conf}`;
}
function openRescuer(){
  go('screen-rescuer');
  const f=$('qFilter')?$('qFilter').value:'ALL';
  let q=[...getQueue()].sort((a,b)=>b.score-a.score);
  if(f==='PENDING')q=q.filter(x=>x.status==='PENDING');
  else if(f==='CRITICAL')q=q.filter(x=>x.final==='CRITICAL');
  else if(f==='ACCEPTED')q=q.filter(x=>x.status==='ACCEPTED');
  else if(f==='DENIED')q=q.filter(x=>x.status==='DENIED');
  const pend=q.filter(x=>x.status==='PENDING').length;
  $('queue').innerHTML=(`<div class="tiny">Showing <b>${q.length}</b> victim(s) • <b>${pend}</b> waiting • sorted by priority score • You: <b>${MeshService.avail}</b></div>`)+
    (q.length?q.map(v=>`
    <div class="q-card ${v.final}">
      <div class="q-top"><span>${v.final==='CRITICAL'?'🔴':v.final==='HIGH'?'🟠':'🟢'} ${v.name}</span><span>${v.score}/100 ${v.status==='PENDING'?'⏳':v.status==='ACCEPTED'?'✅':v.status==='DENIED'?'❌':'🙈'}</span></div>
      <div class="q-meta">🚨 ${v.etype||v.sev} • Claimed <b>${v.sev}</b> → Assigned <b>${v.final}</b> • Conf ${v.conf}% (${v.confLabel})<br/>💬 “${v.msg||'—'}” • via ${v.hops!=null?v.hops+'-hop mesh':'mesh'} • TTL ${v.ttl??'—'}<br/>📞 ${v.phone} • Age ${v.age} • ⏱ ${v.wait} min • ❤️ ${v.hr??'—'} BPM (${v.hrMode||'MANUAL'}, normal 60–80)<br/>${v.move?`🧍 ${v.move.state} ${v.move.score}/100${v.move.inact?` • inactivity ${v.move.dur}s`:''}${v.move.fall?' • possible fall-like':''}<br/>`:''}${locLine(v)}<br/>🆔 ${v.packetId} • ${v.at} • Status: <b>${v.status}</b>${v.note?' • “'+v.note+'”':''}${v.session?' • Session '+v.session:''}</div>
      ${v.status==='PENDING'?`<div class="q-actions"><button class="accept" onclick="respondSOS('${v.id}',true)">✓ Accept</button><button class="deny" onclick="respondSOS('${v.id}',false)">✕ Decline</button><button class="navigate" onclick="ignoreSOS('${v.id}')">🙈 Ignore</button></div>`:''}
      <div class="q-actions"><button class="navigate" onclick="MeshService.openSession('${v.id}')">💬 Chat</button><button class="navigate" onclick="alert('🧭 Opening offline route to ${v.packetId}…')">Navigate</button></div>
    </div>`).join(''):`<p class="muted">No victims in this filter. Send an SOS as victim, or load demo victims.</p>`);
}
function respondSOS(id,accept){
  const q=getQueue();const v=q.find(x=>x.id===id);if(!v)return;
  v.status=accept?'ACCEPTED':'DENIED';
  v.note=accept?'Help is on the way. Stay where you are.':'Busy on another rescue — your SOS was re-broadcast to other rescuers.';
  v.respondedAt=new Date().toLocaleString();
  if(accept){v.session=v.session||('RSQ-'+Math.floor(10000+Math.random()*89999));MeshService.log('RESCUE',`Rescuer accepted ${v.packetId} → session ${v.session}`);MeshService.enqueue({t:'RESCUE_ACCEPT',id:v.id});}
  else{MeshService.log('RESCUE',`Rescuer denied ${v.packetId} — SOS stays ACTIVE for others`);MeshService.enqueue({t:'RESCUE_DENY',id:v.id});}
  setQueue(q);openRescuer();refreshVictimStatus();
}
function ignoreSOS(id){
  const q=getQueue();const v=q.find(x=>x.id===id);if(!v)return;
  v.status='IGNORED'; // no response sent; SOS still ACTIVE in mesh for others
  MeshService.log('RESCUE',`Ignored ${v.packetId} — no response, still propagating`);
  setQueue(q);openRescuer();
}
function refreshVictimStatus(){
  if(!state.lastSOSId)return;
  const v=getQueue().find(x=>x.id===state.lastSOSId);
  const el=$('victimStatus');if(!el)return;
  if(!v){el.className='status-banner pending';el.innerHTML='⏳ SOS sent — waiting for rescuer… <button class="ghost-btn dark sm" onclick="refreshVictimStatus()">↻ Check status</button>';return;}
  if(v.status==='ACCEPTED'){el.className='status-banner accepted';el.innerHTML=`✅ <b>Rescuer ACCEPTED your request!</b> ${v.note||''} (${v.respondedAt||''}) Session: ${v.session||''} <button class="ghost-btn dark sm" onclick="MeshService.openSession('${v.id}')">💬 Chat</button>`;}
  else if(v.status==='DENIED'){el.className='status-banner denied';el.innerHTML=`❌ <b>Rescuer declined (“unavailable”).</b> ${v.note||''} Your SOS stays live — searching other rescuers.`;}
  else{el.className='status-banner pending';el.innerHTML='⏳ <b>Waiting for rescuer…</b> SOS live in mesh queue (accept / deny / ignore by each rescuer). <button class="ghost-btn dark sm" onclick="refreshVictimStatus()">↻ Check status</button>';}
}
setInterval(()=>{ if(state.lastSOSId && $('resultCard') && !$('resultCard').classList.contains('hidden')) refreshVictimStatus(); },3000);

// ============================================================
// 6. MeshService — BLE-mesh SIMULATION (app-level store-forward)
// Real phones: platform BLE APIs. Browser demo: simulated nodes +
// flooding with TTL, duplicate cache, RSSI, relay priority, logs,
// offline queue + sync, rescue sessions + chat.
// ============================================================
const MeshService = {
  nodeId:null, avail:'AVAILABLE', online:false,
  cache:new Set(), stats:{rx:0,fwd:0,relay:0}, syncQ:[],
  init(){
    let n=null; try{n=localStorage.getItem('resqlink_node');}catch(e){}
    if(!n){n='NODE-'+Math.random().toString(16).slice(2,6).toUpperCase();try{localStorage.setItem('resqlink_node',n);}catch(e){}}
    this.nodeId=n; const el=$('myNode'); if(el)el.textContent=n;
    this.renderStatus();
    try{ if($('nodeList')) this.renderNodes(); }catch(e){}
  },
  log(tag,msg){
    const el=$('meshLog'); const line=`[${tag}] ${new Date().toLocaleTimeString()} ${msg}`;
    if(el){el.textContent=line+'\n'+el.textContent.slice(0,3000);}
  },
  rssiBand(r){ if(r>-60)return 'Very nearby'; if(r>-75)return 'Nearby'; if(r>-90)return 'Far/weak'; return 'Edge'; },
  RESQ_UUID:'12345678-1234-5678-1234-56789abcdef0', // demo ResQLink service; use same on all phones for real mesh
  realNodes:[], btAvailable:null, ignoredCount:0,
  simNodes(){
    // Fallback DEMO neighbours when real BLE unavailable (laptop/permission denied)
    const base=[['A82F',-54,'RELAY'],['B712',-67,'AVAILABLE'],['C91D',-72,'AVAILABLE'],['D44A',-81,'RELAY'],['E208',-88,'BUSY'],['F77C',-63,'AVAILABLE'],['G310',-79,'RELAY']];
    return base.map(([s,rssi,role],i)=>({id:'NODE-'+s,rssi,band:this.rssiBand(rssi),role,batt:40+((i*13)%55),real:false}));
  },
  nearby(){ return [...this.realNodes, ...this.simNodes().slice(0, this.realNodes.length?2:7)]; },
  renderNodes(){
    const real=this.realNodes, simCount=this.realNodes.length?2:7;
    const sim=this.simNodes().slice(0,simCount);
    let h='';
    if(real.length){
      h+=`<div class="tiny" style="color:#15803d;font-weight:700">● ${real.length} REAL Bluetooth device(s) found nearby:</div>`;
      h+=real.map(n=>`<div class="q-card"><div class="q-top"><span>📲 ${n.id}</span><span>${n.rssi} dBm (REAL)</span></div><div class="q-meta">${n.band} • ${n.role} • ${n.name||'BLE device'} • ${n.uuidMatch?'UUID: RESQLINK ✓ ResQLink node':'non-ResQLink — ignored for mesh'} • ${new Date(n.seen).toLocaleTimeString()}</div></div>`).join('');
    }
    h+=`<div class="tiny">${real.length?'Other ResQLink relays (SIM, for multi-hop demo):':'No real BLE access — showing DEMO relays (press Scan on phone Chrome for real):'}</div>`;
    h+=sim.map(n=>`<div class="q-card"><div class="q-top"><span>📲 ${n.id}</span><span>${n.rssi} dBm (SIM)</span></div><div class="q-meta">${n.band} • ${n.role} • 🔋${n.batt}% • Relay ${n.role!=='BUSY'?'available':'busy'} • UUID: RESQLINK-SVC ✓ SIM</div></div>`).join('');
    h+=`<div class="tiny">Headphones/watches ${this.ignoredCount?`(${this.ignoredCount} ignored)`:'hidden'} — only ResQLink UUID nodes relay SOS. No MAC exposed, temp IDs only. My node: <b>${this.nodeId||'—'}</b></div>`;
    $('nodeList').innerHTML=h;
  },
  async scan(){
    this.renderNodes();
    $('nodeList').innerHTML=`<div class="tiny">🔍 Scanning REAL Bluetooth… (allow permission, keep BT ON, use Chrome on phone via http://localhost:8000)</div>`+$('nodeList').innerHTML;
    // 1. Web Bluetooth support check
    if(!navigator.bluetooth){
      this.log('BLE','Web Bluetooth NOT supported here (Firefox/file://). Showing SIM relays. Use Chrome + localhost for real scan.');
      this.btAvailable=false; this.renderNodes(); this.renderStatus(); return;
    }
    try{
      if(navigator.bluetooth.getAvailability) this.btAvailable=await navigator.bluetooth.getAvailability();
    }catch(e){}
    // 2. Try passive LE scan (Chrome Android/Win with flag) for REAL RSSI + names
    if(navigator.bluetooth.requestLEScan){
      try{
        this.log('BLE','Requesting REAL LE scan (8s)… allow Bluetooth permission.');
        const scan=await navigator.bluetooth.requestLEScan({acceptAllAdvertisements:true});
        const found=new Map(); let ignored=0;
        const onAdv=e=>{
          const uuids=(e.uuids||[]).join(',').toLowerCase();
          const isResQ=uuids.includes(this.RESQ_UUID.toLowerCase());
          const name=e.device&&e.device.name?e.device.name:'BLE device';
          // ResQLink nodes OR any BLE for realism, but mark non-ResQLink as ignored in count
          if(!isResQ){ignored++; this.ignoredCount=ignored; return;}
          found.set(e.device.id||name, {id:'NODE-'+(e.device.id||'UNK').slice(-4).toUpperCase(), name, rssi:e.rssi??-70, band:this.rssiBand(e.rssi??-70), role:'AVAILABLE', uuidMatch:true, real:true, seen:Date.now()});
        };
        navigator.bluetooth.addEventListener('advertisementreceived', onAdv);
        await new Promise(r=>setTimeout(r,8000));
        try{scan.stop();}catch(e){}
        navigator.bluetooth.removeEventListener('advertisementreceived', onAdv);
        this.realNodes=[...found.values()];
        this.log('BLE',`REAL scan done: ${this.realNodes.length} ResQLink node(s), ${ignored} other BLE ignored (headphones etc.)`);
        this.renderNodes(); this.renderStatus(); return;
      }catch(err){
        this.log('BLE','LE scan blocked/denied ('+(err&&err.name||err)+') — falling back to device picker.');
      }
    }
    // 3. Fallback: device picker = 100% REAL device user selects
    try{
      this.log('BLE','Open picker — select a NEARBY phone/device to add as REAL node.');
      const dev=await navigator.bluetooth.requestDevice({acceptAllDevices:true, optionalServices:[this.RESQ_UUID]});
      const id='NODE-'+(dev.id||'REAL').slice(-4).toUpperCase();
      this.realNodes.push({id, name:dev.name||'Real BLE device', rssi:-65, band:this.rssiBand(-65), role:'AVAILABLE', uuidMatch:false, real:true, seen:Date.now()});
      this.log('BLE',`REAL device added: ${dev.name||id} — shown as REAL above.`);
    }catch(err){
      this.log('BLE','Picker cancelled ('+(err&&err.name||'cancelled')+'). SIM relays kept for demo.');
    }
    this.renderNodes(); this.renderStatus();
  },
  setAvail(v){ this.avail=v; this.log('MESH',`Availability → ${v}`); this.renderStatus(); if($('queue'))openRescuer(); },
  toggleNet(){ this.online=!this.online; $('netLabel').textContent=this.online?'Online (cloud sync)':'Offline (mesh)'; this.log('SYNC',this.online?'Internet restored — gateway mode':'Offline — BLE mesh only'); this.renderStatus(); if(this.online)this.syncNow(); },
  enqueue(e){ this.syncQ.push({...e,at:nowISO()}); this.renderStatus(); },
  syncNow(){
    if(!this.online){this.log('SYNC',`Offline — ${this.syncQ.length} event(s) queued locally`);return;}
    const n=this.syncQ.length; this.syncQ=[];
    this.log('SYNC',`Uploaded ${n} event(s) → backend (SOS_CREATED/ACCEPTED/DENIED/…)`);
    this.renderStatus();
  },
  renderStatus(){
    const el=$('meshStatus'); if(!el)return;
    const bt=this.btAvailable===false?'UNAVAILABLE (SIM)':this.btAvailable===true?(this.realNodes.length?`ON • ${this.realNodes.length} REAL`:'ON • SIM fallback'):'ON (SIM/untested)';
    el.innerHTML=`Bluetooth: <b>${bt}</b> • Mesh: <b>ACTIVE</b> (${this.nodeId||'—'}) • Nearby: <b>${this.nearby().length}</b> (${this.realNodes.length} real) • RX <b>${this.stats.rx}</b> • Forwarded <b>${this.stats.fwd}</b> • Internet: <b>${this.online?'ONLINE':'OFFLINE'}</b> • Sync queue: <b>${this.syncQ.length}</b> • Role: <b>${this.avail}</b>`;
  },
  broadcast(){
    if(!state.lastResult){alert('Calculate priority first');return;}
    const now=Date.now();
    const lastT=+localStorage.getItem('resqlink_lastbc')||0;
    if(now-lastT<15000){alert('Rate limit: wait a few seconds between broadcasts (anti-spam).');return;}
    localStorage.setItem('resqlink_lastbc',now);
    const r=state.lastResult;
    const etype=$('sos-type').value, msg=$('sos-msg').value.trim()||'Need help';
    const packet={protocolVersion:1,packetId:state.lastSOSId,messageType:'SOS',victimId:state.user.victimId,ttl:10,hopCount:0,priority:r.final,emergencyType:etype,message:msg.slice(0,60),battery:r.meta.batt,timestamp:nowISO(),nonce:Math.random().toString(36).slice(2),expiresAt:new Date(Date.now()+2*3600e3).toISOString(),relayPath:[this.nodeId||'ME']};
    this.cache.add(packet.packetId);
    this.log('MESH',`Broadcast ${packet.packetId} [${etype}/${r.final}] TTL=10`);
    // Simulate multi-hop: victim → real nodes first (if any) → relays → rescuer
    const realHop=this.realNodes.length?this.realNodes[0].id:'NODE-A82F';
    const hops=[this.nodeId||'ME',realHop,'NODE-C91D','RESCUER'];
    let ttl=10;
    hops.forEach((h,i)=>{ if(i===0)return; ttl--; packet.hopCount=i; packet.ttl=ttl; packet.relayPath.push(h);
      this.stats.rx++; if(ttl>0)this.stats.fwd++; });
    this.log('MESH',`Path: ${packet.relayPath.join(' → ')} • hops=${packet.hopCount} TTL left=${ttl} • duplicates suppressed by packetId`);
    // attach mesh info to stored SOS
    const q=getQueue(); const v=q.find(x=>x.id===state.lastSOSId);
    if(v){v.etype=etype;v.msg=msg;v.ttl=ttl;v.hops=packet.hopCount;v.status='PENDING';setQueue(q);}
    $('meshPath').textContent=`📡 ${packet.packetId}: ${packet.relayPath.join(' → ')} • ${packet.hopCount} hops • TTL ${ttl} • “${msg}” — rescuers now see Accept/Deny/Ignore`;
    this.enqueue({t:'SOS_CREATED',id:packet.packetId});
    this.renderStatus(); refreshVictimStatus();
    if($('queue'))openRescuer();
  },
  cancelSOS(){
    const q=getQueue();const v=q.find(x=>x.id===state.lastSOSId);if(!v)return;
    v.status='CANCELLED';setQueue(q);this.log('MESH',`SOS_CANCEL ${v.packetId}`);this.enqueue({t:'SOS_CANCELLED',id:v.id});refreshVictimStatus();
    try{ if(typeof MovementSensorManager!=='undefined'){MovementSensorManager.stop('SOS cancelled'); const so=$('mvSos'); if(so)so.textContent='CANCELLED';} }catch(e){}
  },
  markSafe(){
    const q=getQueue();const v=q.find(x=>x.id===state.lastSOSId);if(!v)return;
    v.status='RESOLVED';setQueue(q);this.log('RESCUE',`Victim marked SAFE — ${v.packetId} RESOLVED`);this.enqueue({t:'RESCUE_COMPLETED',id:v.id});refreshVictimStatus();
    try{ if(typeof MovementSensorManager!=='undefined'){MovementSensorManager.stop('rescue closed'); const so=$('mvSos'); if(so)so.textContent='CLOSED';} }catch(e){}
  },
  openSession(id){
    const q=getQueue();const v=q.find(x=>x.id===(id||state.lastSOSId));if(!v){alert('No SOS yet');return;}
    v.session=v.session||('RSQ-'+Math.floor(10000+Math.random()*89999));setQueue(q);
    $('sessId').textContent=v.session;
    $('sessInfo').textContent=`${v.packetId} • ${v.name} ↔ ${this.nodeId} • ${v.final} • E2E concept (AES-GCM in native app; demo plaintext)`;
    go('screen-session'); this.renderChat(v);
  },
  renderChat(v){
    let chats=[]; try{chats=JSON.parse(localStorage.getItem('resqlink_chat_'+v.id)||'[]');}catch(e){}
    $('chatBox').innerHTML=chats.length?chats.map(c=>`<div class="chat-msg ${c.me?'me':''}"><b>${c.me?'Me':v.name}:</b> ${c.text}<br/><small>${c.at}</small></div>`).join(''):`<p class="tiny">No messages yet. Say hi — victim ↔ rescuer via mesh.</p>`;
    $('chatBox').scrollTop=99999;
  },
  sendChat(){
    const t=$('chatIn').value.trim();if(!t)return;
    const sid=$('sessId').textContent;
    const q=getQueue();const v=q.find(x=>x.session===sid)||q.find(x=>x.id===state.lastSOSId);if(!v)return;
    let chats=[]; try{chats=JSON.parse(localStorage.getItem('resqlink_chat_'+v.id)||'[]');}catch(e){}
    chats.push({me:true,text:t.replace(/</g,'&lt;'),at:new Date().toLocaleTimeString()});
    localStorage.setItem('resqlink_chat_'+v.id,JSON.stringify(chats));
    $('chatIn').value='';this.renderChat(v);this.enqueue({t:'CHAT',id:v.id});
  },
  setSessStatus(s){
    const sid=$('sessId').textContent;const q=getQueue();const v=q.find(x=>x.session===sid);if(!v)return;
    v.status=s==='COMPLETED'?'RESOLVED':v.status;v.note=(v.note||'')+` [${s}]`;
    setQueue(q);this.log('RESCUE',`${sid} → ${s}`);this.enqueue({t:s,id:v.id});
    alert(s==='COMPLETED'?'✅ Rescue marked COMPLETED':'📍 Rescuer ARRIVED (simulated)');
  }
};

// ---------- init ----------
(function(){
  $('resetBtn').onclick=()=>{localStorage.clear();location.reload();};
  const u=localStorage.getItem('resqlink_user');
  if(u){try{state.user=JSON.parse(u);enterApp();}catch(e){}}
  LocationService.render(); MeshService.init();
})();
