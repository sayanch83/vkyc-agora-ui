import { Component, State, h, Fragment, Element } from '@stencil/core';
import { VkycCall } from '../../utils/agora';
import { CONSENT_ITEMS, APPLICANT_STEPS } from '../../utils/constants';
import type { ConsentMap, CheckStatus } from '../../utils/constants';

/**
 * vkyc-applicant
 * Theme: #0d1b3e navy header · #f5f0eb warm beige bg · #ffffff cards · #00897b teal CTA
 * UX improvements over original:
 *  - Camera preview shows from step 1 (matches original)
 *  - Replaced captcha with clean step flow
 *  - 6 granular consents instead of 1 combined
 *  - Progress bar across top
 *  - Friendly copy, clear instructions
 *  - Countdown + liveness before agent connect
 *  - Warm completion screen with reference ID
 */
@Component({ tag: 'vkyc-applicant', styleUrl: 'vkyc-applicant.css', shadow: true })
export class VkycApplicant {

  @State() step: string = 'welcome';
  @State() caseId: string = 'KYC-A7B3X2C'; // set from URL param or default
  @State() consents: ConsentMap = {};
  @State() acceptAll: boolean = false;
  @State() consentTimestamps: Record<string, string> = {};
  @State() checks: Record<string, CheckStatus> = { camera:'pending', mic:'pending', net:'pending', location:'pending' };
  @State() allChecksPassed = false;
  @State() queuePos = 3;
  @State() waitMins = 6;
  private queueTimer: any = null;
  @State() countdown = 15;
  @State() livenessPhase: 'idle'|'counting'|'opening'|'capturing'|'analysing'|'pass'|'fail' = 'idle';
  @State() livenessScore: number|null = null;
  @State() sessionSubStep: string = 'face';
  @State() sessionSecs = 0;
  @State() codeConfirmed = false;
  @State() panCaptured = false;
  @State() sigCaptured = false;
  @State() agentDone = false;
  @State() referenceId = '';
  @State() micOn = true;
  @State() camOn = true;
  @State() showReschedule = false;
  @State() selectedSlot: string|null = null;
  @State() selectedDate: string|null = null;
  @State() rescheduled = false;
  @State() toast: {msg:string;type:string}|null = null;

  @Element() el!: HTMLElement;
  private spokenCode = this.genCode();
  private cdTimer: any = null;
  private call: VkycCall|null = null;
  @State() remoteUid: number|null = null;
  @State() callError = '';

  private _cachedSlots: Array<{date:string;label:string;slots:Array<{time:string;available:boolean}>}>|null = null;
  private generateSlots(): Array<{date:string;label:string;slots:Array<{time:string;available:boolean}>}> {
    if(this._cachedSlots) return this._cachedSlots;
    const result = [];
    const today = new Date();
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // All slots 10:00 AM to 5:00 PM in 30-min increments
    const allSlots: Array<{time:string;hour:number;min:number}> = [];
    for(let h=10; h<17; h++) {
      for(const m of [0,30]) {
        if(h===16&&m===30) break; // stop at 5:00 PM
        const ampm = h < 12 ? 'AM' : 'PM';
        const h12 = h <= 12 ? h : h - 12;
        const hStr = String(h12).padStart(2,'0');
        const mStr = String(m).padStart(2,'0');
        allSlots.push({ time:`${hStr}:${mStr} ${ampm}`, hour:h, min:m });
      }
    }

    let daysAdded = 0;
    let offset = 1;
    while(daysAdded < 5) {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      offset++;
      const dow = date.getDay();
      if(dow === 0 || dow === 6) continue; // skip weekends
      const label = `${days[dow]}, ${date.getDate()} ${months[date.getMonth()]}`;
      const dateStr = date.toISOString().slice(0,10);

      // Randomly mark ~40% of slots as unavailable (booked)
      const slots = allSlots.map(s => ({
        time: s.time,
        available: Math.random() > 0.4,
      }));
      // Always ensure at least 3 available
      let avail = slots.filter(s=>s.available).length;
      if(avail < 3) {
        let fixed = 0;
        for(let i=0;i<slots.length&&fixed<3-avail;i++) {
          if(!slots[i].available) { slots[i].available=true; fixed++; }
        }
      }
      result.push({ date: dateStr, label, slots });
      daysAdded++;
    }
    this._cachedSlots = result;
    return result;
  }

  componentWillLoad() {
    // Read caseId from URL: ?caseId=KYC-A7B3X2C
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('caseId');
      if (id) this.caseId = id;
    }
  }

  private genCode() {
    return Array.from({length:6}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join('');
  }
  private startQueueSimulation() {
    // Simulate queue: every 4 seconds reduce position by 1, waitMins by 2
    this.queueTimer = setInterval(()=>{
      if(this.queuePos > 1) {
        this.queuePos = this.queuePos - 1;
        this.waitMins = Math.max(1, this.waitMins - 2);
      } else if(this.queuePos === 1) {
        this.queuePos = 0;
        this.waitMins = 0;
        clearInterval(this.queueTimer);
      }
    }, 4000);
  }

  private delay(ms:number) { return new Promise(r=>setTimeout(r,ms)); }
  private fmt(s:number) { return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
  private toast$(msg:string, type='info') { this.toast={msg,type}; setTimeout(()=>{this.toast=null;},3500); }
  private allConsented() { return CONSENT_ITEMS.every(c=>this.consents[c.id]); }

  private toggleAcceptAll(checked: boolean) {
    this.acceptAll = checked;
    const ts = new Date().toISOString();
    if (checked) {
      const all: ConsentMap = {};
      const allTs: Record<string,string> = {};
      CONSENT_ITEMS.forEach(c => { all[c.id] = true; allTs[c.id] = ts; });
      this.consents = all;
      this.consentTimestamps = allTs;
    } else {
      this.consents = {};
      this.consentTimestamps = {};
    }
  }

  private async runChecks() {
    const run = async (k:string, fn:()=>Promise<boolean>) => {
      this.checks={...this.checks,[k]:'checking'}; await this.delay(700);
      this.checks={...this.checks,[k]:await fn()?'pass':'fail'};
    };
    await run('net', async()=>navigator.onLine);
    await run('camera', async()=>{ try{const s=await navigator.mediaDevices.getUserMedia({video:true,audio:false});s.getTracks().forEach(t=>t.stop());return true;}catch{return false;} });
    await run('mic', async()=>{ try{const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop());return true;}catch{return false;} });
    await run('location', async()=>{ try{await new Promise<void>((res,rej)=>navigator.geolocation.getCurrentPosition(()=>res(),()=>rej(),{timeout:5000}));return true;}catch{return false;} });
    this.allChecksPassed = Object.values(this.checks).every(v=>v==='pass'||v==='warn');
  }

  private startCountdown() {
    clearInterval(this.queueTimer);
    this.step='liveness'; this.countdown=10; this.livenessPhase='counting';
    this.cdTimer = setInterval(async()=>{
      this.countdown=this.countdown-1;
      if(this.countdown<=0){ clearInterval(this.cdTimer); await this.runLiveness(); }
    },1000);
  }

  private async runLiveness() {
    this.livenessPhase='opening'; await this.delay(1000);
    this.livenessPhase='capturing'; await this.delay(3000);
    this.livenessPhase='analysing'; await this.delay(2200);
    const s=Math.floor(Math.random()*12)+87; this.livenessScore=s;
    this.livenessPhase = s>=75?'pass':'fail';
    if(s>=75){ await this.delay(1500); this.step='session'; await this.startAgoraCall(); }
  }

  private async startAgoraCall() {
    // Start session timer
    let t=0;
    const tim = setInterval(()=>{t++;this.sessionSecs=t;},1000);

    try {
      this.call = new VkycCall();
      // Applicant always joins as UID 1
      this.call.onRemoteJoined = (uid, videoTrack) => {
        this.remoteUid = uid;
        setTimeout(() => {
          const el = this.el.shadowRoot?.querySelector('#agora-agent');
          if (el && videoTrack) videoTrack.play(el as HTMLElement);
        }, 200);
      };
      this.call.onRemoteLeft = () => {
        this.remoteUid = null;
      };
      this.call.onError = (msg) => {
        this.callError = msg;
      };

      await this.call.join(this.caseId, 1);

      // Play own video
      setTimeout(() => {
        const el = this.el.shadowRoot?.querySelector('#agora-self');
        if (el) this.call!.playLocal(el as HTMLElement);
      }, 200);

    } catch (e: any) {
      this.callError = e.message;
      // Continue without video in fallback mode
    }

    // Store timer ref for cleanup
    (this as any)._sessionTimer = tim;
  }


  private simulate() {
    let t=0; const tim=setInterval(()=>{t++;this.sessionSecs=t;},1000);
    setTimeout(()=>{this.sessionSubStep='code';},6000);
    setTimeout(()=>{this.codeConfirmed=true;this.sessionSubStep='pan';this.toast$('Agent confirmed your spoken code ✓','success');},14000);
    setTimeout(()=>{this.panCaptured=true;this.sessionSubStep='waiting';this.toast$('Agent captured your PAN card ✓','success');},22000);
    setTimeout(()=>{clearInterval(tim);this.referenceId='VKP-'+Math.random().toString(36).substr(2,8).toUpperCase();this.agentDone=true;setTimeout(()=>{this.step='complete';},2500);},30000);
  }

  private visibleSteps() { return APPLICANT_STEPS.filter(s=>s.id!=='aadhaar'); }
  private stepIdx() { return this.visibleSteps().findIndex(s=>s.id===this.step); }

  /* ── PROGRESS BAR ──────────────────────────────────────────────────────── */
  private renderProgress() {
    const idx = this.stepIdx();
    const steps = this.visibleSteps();
    if(idx<=0||this.step==='complete') return null;
    const pct = Math.round((idx/(steps.length-1))*100);
    return (
      <div class="progress-wrap">
        <div class="progress-steps">
          {steps.map((s,i)=>(
            <div class={`ps ${i<idx?'ps--done':''} ${i===idx?'ps--active':''}`}>
              <div class="ps-dot">{i<idx?'✓':s.icon}</div>
              <span class="ps-label">{s.label}</span>
            </div>
          ))}
        </div>
        <div class="progress-bar"><div class="progress-fill" style={{width:`${pct}%`}} /></div>
      </div>
    );
  }

  /* ── WELCOME ────────────────────────────────────────────────────────────── */
  private renderWelcome() {
    return (
      <div class="card animate-in">
        <div class="card-left">
          <div class="camera-preview">
            <div class="camera-oval-hint">Position your face here</div>
            <div class="camera-label">📷 Camera Preview</div>
          </div>
        </div>
        <div class="card-right">
          <div class="welcome-brand">Video KYC</div>
          <h2 class="welcome-title">Complete your KYC in minutes</h2>
          <p class="welcome-sub">Secure · RBI Regulated · Takes about 5 minutes</p>

          <div class="checklist-preview">
            {['Keep your PAN card physically in hand','Ensure you are in a well-lit, quiet room','No other person should be visible on screen','Stable internet connection required'].map(t=>(
              <div class="cl-item"><span class="cl-tick">✓</span><span>{t}</span></div>
            ))}
          </div>

          <button class="btn-primary" onClick={()=>{ this.step='consent'; this.runChecks(); }}>
            Begin Video KYC
          </button>
          <p class="rbi-note">By proceeding you agree this session will be recorded as required by RBI regulations.</p>
        </div>
      </div>
    );
  }

  /* ── CONSENT ─────────────────────────────────────────────────────────────── */
  private renderConsent() {
    const done = Object.values(this.consents).filter(Boolean).length;
    return (
      <div class="card card--tall animate-in">
        <div class="card-left card-left--checks">
          <div class="side-title">System Checks</div>
          {[['camera','📷','Camera'],['mic','🎤','Microphone'],['net','📶','Internet'],['location','📍','Location']].map(([k,icon,label])=>(
            <div class={`check-row check-row--${this.checks[k]}`}>
              <span class="check-icon">{icon}</span>
              <span class="check-label">{label}</span>
              <span class="check-badge">
                {this.checks[k]==='pass'?'✓':this.checks[k]==='checking'?'…':this.checks[k]==='fail'?'✗':'○'}
              </span>
            </div>
          ))}
          <div class="consent-prog-wrap">
            <div class="consent-prog-label">{done}/6 consents accepted</div>
            <div class="consent-prog-bar"><div class="consent-prog-fill" style={{width:`${(done/6)*100}%`}} /></div>
          </div>
        </div>
        <div class="card-right card-right--scroll">
          <h2 class="section-title">Your Consents</h2>
          <p class="section-sub">Please read and accept each consent individually. All 6 are mandatory under RBI V-CIP guidelines.</p>
          <div class="consent-list">
            {CONSENT_ITEMS.map((c,i)=>(
              <label class={`consent-item ${this.consents[c.id]?'consent-item--on':''}`} key={c.id}>
                <div class="consent-num">{i+1}</div>
                <div class={`consent-box ${this.consents[c.id]?'consent-box--on':''}`}>
                  {this.consents[c.id]&&<span>✓</span>}
                </div>
                <input type="checkbox" checked={!!this.consents[c.id]}
                  onChange={e=>{ const v=(e.target as HTMLInputElement).checked; this.consents={...this.consents,[c.id]:v}; if(v)this.consentTimestamps={...this.consentTimestamps,[c.id]:new Date().toISOString()}; }}
                />
                <div class="consent-body">
                  <span class="consent-text">{c.text}</span>
                  {this.consents[c.id]&&<span class="consent-ts">{new Date(this.consentTimestamps[c.id]).toLocaleTimeString('en-IN')}</span>}
                </div>
              </label>
            ))}
          </div>
          <label class="accept-all-row">
            <div class={`accept-all-box ${this.acceptAll?'accept-all-box--on':''}`}>
              {this.acceptAll && <span>✓</span>}
            </div>
            <input type="checkbox" checked={this.acceptAll}
              onChange={e => this.toggleAcceptAll((e.target as HTMLInputElement).checked)} />
            <span class="accept-all-text">I have read and accept all the above consents</span>
          </label>
          <button class={`btn-primary ${!this.allConsented()?'btn-primary--off':''}`} disabled={!this.allConsented()}
            onClick={()=>{ this.step='queue'; this.startQueueSimulation(); }}>
            Accept All &amp; Continue
          </button>
        </div>
      </div>
    );
  }


  /* ── QUEUE ───────────────────────────────────────────────────────────────── */
  private renderQueue() {
    return (
      <Fragment>
      <div class="card animate-in">
        <div class="card-left card-left--illus">
          <div class="queue-bubble">{this.queuePos}</div>
          <div class="illus-title">Your Queue Position</div>
          <div class="illus-sub">Estimated wait: <strong>{this.waitMins} minutes</strong></div>
          <div class="queue-dots">
            {Array.from({length:5},(_,i)=><div class={`qdot ${i<this.queuePos?'qdot--filled':''}`} />)}
          </div>
        </div>
        <div class="card-right">
          <h2 class="section-title">You're in the Queue</h2>
          <p class="section-sub">A KYC officer will connect with you shortly. Please stay on this page.</p>

          <div class="info-box info-box--blue">
            <div class="info-box-icon">ℹ️</div>
            <div>
              <strong>What happens next:</strong> When you click <em>Join Now</em>, a liveness check will begin in 10 seconds. Once complete, you'll be redirected to a live KYC officer.
            </div>
          </div>

          <div class="ready-list">
            <div class="ready-title">Please ensure you're ready:</div>
            {['PAN card physically in hand','Well-lit room, plain background','No other person visible on screen','Blank paper and pen for signature'].map(t=>(
              <div class="ready-item"><span class="ready-tick">✓</span>{t}</div>
            ))}
          </div>

          <button
            class={`btn-primary btn-primary--large ${this.queuePos > 0 ? 'btn-primary--off' : ''}`}
            disabled={this.queuePos > 0}
            onClick={()=>this.startCountdown()}
          >
            Join Session
          </button>

          {!this.rescheduled ? (
            <button class="btn-ghost" onClick={()=>{this.showReschedule=true;this.selectedDate=null;this.selectedSlot=null;this._cachedSlots=null;}}>
              Reschedule for Later
            </button>
          ) : (
            <div class="reschedule-confirmed">
              ✓ Rescheduled for <strong>{this.selectedSlot}</strong>
              <button class="reschedule-cancel" onClick={()=>{this.rescheduled=false;this.selectedSlot=null;}}>Change</button>
            </div>
          )}
        </div>
      </div>

      {/* Reschedule modal */}
      {this.showReschedule&&(
        <div class="modal-backdrop" onClick={()=>{this.showReschedule=false;}}>
          <div class="reschedule-modal" onClick={e=>e.stopPropagation()}>
            <div class="rm-header">
              <div class="rm-title">Reschedule Video KYC</div>
              <div class="rm-sub">Select a convenient date and time slot within the next 5 working days</div>
              <button class="rm-close" onClick={()=>{this.showReschedule=false;}}>✕</button>
            </div>
            <div class="rm-body">
              {/* Step 1 — Date picker */}
              <div class="rm-step-label">Step 1 — Select a date</div>
              <div class="rm-cal">
                {this.generateSlots().map(day=>(
                  <button
                    class={`rm-date-card ${this.selectedDate===day.date?'rm-date-card--on':''}`}
                    onClick={()=>{this.selectedDate=day.date; this.selectedSlot=null;}}
                  >
                    <div class="rm-date-dow">{day.label.split(',')[0]}</div>
                    <div class="rm-date-num">{day.label.split(' ')[1]}</div>
                    <div class="rm-date-mon">{day.label.split(' ')[2]}</div>
                    <div class="rm-date-avail">{day.slots.filter(s=>s.available).length} slots</div>
                  </button>
                ))}
              </div>

              {/* Step 2 — Time slots for selected date */}
              {this.selectedDate&&(()=>{
                const day = this.generateSlots().find(d=>d.date===this.selectedDate);
                if(!day) return null;
                return (
                  <div class="rm-time-section animate-in">
                    <div class="rm-step-label">Step 2 — Pick a time on {day.label}</div>
                    <div class="rm-time-grid">
                      {day.slots.map(slot=>{
                        const key = `${day.label} · ${slot.time}`;
                        return (
                          <button
                            class={`rm-slot ${!slot.available?'rm-slot--disabled':''} ${this.selectedSlot===key?'rm-slot--on':''}`}
                            disabled={!slot.available}
                            onClick={()=>{if(slot.available)this.selectedSlot=key;}}
                          >
                            {slot.time}
                            {!slot.available&&<span class="rm-slot-tag">Booked</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div class="rm-footer">
              <button class="btn-ghost" style={{margin:'0'}} onClick={()=>{this.showReschedule=false;}}>Cancel</button>
              <button
                class={`btn-primary ${!this.selectedSlot?'btn-primary--off':''}`}
                style={{margin:'0', flex:'1'}}
                disabled={!this.selectedSlot}
                onClick={()=>{this.rescheduled=true;this.showReschedule=false;this.toast$(`Rescheduled for ${this.selectedSlot}`,'success');}}
              >
                Confirm Slot
              </button>
            </div>
          </div>
        </div>
      )}
      </Fragment>
    );
  }

  /* ── LIVENESS ────────────────────────────────────────────────────────────── */
  private renderLiveness() {
    const pct = ((10-this.countdown)/10)*100;
    const circ = 2*Math.PI*54;
    const ringColor = this.livenessPhase==='pass'?'#00897b':this.livenessPhase==='fail'?'#d32f2f':'#0d2b6b';
    const phaseMsg: Record<string,string> = {
      counting: `Liveness check starts in ${this.countdown} second${this.countdown!==1?'s':''}`,
      opening: 'Opening camera…',
      capturing: 'Please remain still and look at the camera',
      analysing: 'Analysing liveness…',
      pass: 'Liveness check passed — connecting you to a KYC officer…',
      fail: 'Liveness check failed. Please retry.',
    };
    return (
      <div class="card animate-in">
        <div class="card-left card-left--dark">
          {this.livenessPhase==='counting'?(
            <Fragment>
              <div class="countdown-ring">
                <svg width="120" height="120" style={{transform:'rotate(-90deg)'}}>
                  <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="8"/>
                  <circle cx="60" cy="60" r="54" fill="none" stroke="#00897b" stroke-width="8"
                    stroke-dasharray={`${circ}`} stroke-dashoffset={`${circ*(1-pct/100)}`} stroke-linecap="round"
                    style={{transition:'stroke-dashoffset 0.9s ease'}}/>
                </svg>
                <div class="countdown-center">
                  <span class="countdown-num">{this.countdown}</span>
                  <small>sec</small>
                </div>
              </div>
              <div class="liveness-hints">
                <div class="lh-item">👤 Face clearly visible</div>
                <div class="lh-item">💡 Good lighting</div>
                <div class="lh-item">🚫 No one else visible</div>
              </div>
            </Fragment>
          ):(
            <Fragment>
              <div class="liveness-cam-box" style={{borderColor:ringColor}}>
                  {(this.livenessPhase==='pass'||this.livenessPhase==='fail')&&(
                  <div class={`liveness-overlay ${this.livenessPhase==='pass'?'liveness-overlay--pass':'liveness-overlay--fail'}`}>
                    {this.livenessPhase==='pass'?'✓':'✗'}
                  </div>
                )}
              </div>
              <div class="liveness-bar-wrap">
                <div class="liveness-bar-fill" style={{
                  width:({opening:'15%',capturing:'55%',analysing:'82%',pass:'100%',fail:'100%'} as Record<string,string>)[this.livenessPhase]||'0%',
                  background:ringColor
                }} />
              </div>
            </Fragment>
          )}
        </div>
        <div class="card-right">
          <h2 class="section-title">Automated Liveness Check</h2>
          <div class={`phase-msg phase-msg--${this.livenessPhase}`}>{phaseMsg[this.livenessPhase]}</div>
          <div class="liveness-flow">
            {[
              {label:'Liveness Check', done:this.livenessPhase==='pass'||this.livenessPhase==='fail'},
              {label:'Connect to Agent', done:this.livenessPhase==='pass'},
            ].map((s,i)=>(
              <Fragment>
                <div class={`lf-step ${s.done?'lf-step--done':''}`}>
                  <div class="lf-dot">{s.done?'✓':i+1}</div>
                  <div class="lf-label">{s.label}</div>
                </div>
                {i<1&&<div class="lf-arrow">→</div>}
              </Fragment>
            ))}
          </div>
          {this.livenessPhase==='fail'&&(
            <button class="btn-primary" onClick={()=>{ this.livenessPhase='idle'; this.livenessScore=null; this.countdown=15; this.step='queue'; }}>
              Go Back &amp; Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ── SESSION — pure passive, controls for mic/cam/disconnect ──────────────── */
  private renderSession() {
    const stepLabel: Record<string,string> = {
      face:    'Face verification in progress — please look at the camera',
      code:    'Spoken Code — Please say the characters shown below one by one',
      pan:     'PAN Card — Please hold your PAN card clearly to the camera',
      waiting: 'Almost done — officer is completing your KYC',
    };
    return (
      <div class="session-fullscreen animate-in">
        {/* Left — Officer feed (Agora remote) */}
        <div class="session-half session-half--left">
          <div class="session-name-tag">Officer · KYC Agent</div>
          {this.remoteUid===null&&(
            <div class="session-half-inner">
              <div class="officer-placeholder">
                <div class="officer-avatar">KYC</div>
                <div class="officer-label">{this.callError?'Camera unavailable':'Waiting for officer…'}</div>
              </div>
            </div>
          )}
          <div id="agora-agent" class="agora-video-box agora-video-box--fullhalf"/>
          <div class="session-controls-bar">
            <div class="rec-pill"><span class="rec-dot"/>REC</div>
            <div class="session-time">{this.fmt(this.sessionSecs)}</div>
          </div>
        </div>

        {/* Right — Customer feed (Agora local) */}
        <div class="session-half session-half--right">
          <div class="session-name-tag session-name-tag--right">You</div>
          <div id="agora-self" class="agora-video-box agora-video-box--fullhalf"/>
          <div class="session-half-inner" style={{position:'absolute',inset:'0',pointerEvents:'none'}}>
            {this.agentDone&&(
              <div class="session-done-overlay">
                <div class="session-done-icon">✓</div>
                <div>KYC Completed</div>
              </div>
            )}
          </div>

          {/* Step info bar — only show for non-face steps */}
          {!this.agentDone&&this.sessionSubStep!=='face'&&(
            <div class="session-step-bar">
              <div class="ssb-label">{stepLabel[this.sessionSubStep]}</div>
              {this.sessionSubStep==='code'&&(
                <div class="ssb-code-row">
                  {this.spokenCode.split('').map(ch=><div class="ssb-char">{ch}</div>)}
                </div>
              )}
              {this.codeConfirmed&&this.sessionSubStep!=='face'&&(
                <div class="ssb-check">✓ Code confirmed</div>
              )}
              {this.panCaptured&&this.sessionSubStep==='waiting'&&(
                <div class="ssb-check">✓ PAN verified</div>
              )}
            </div>
          )}

          {/* Applicant controls — mic, camera, disconnect */}
          <div class="session-applicant-controls">
            <button class={`appl-ctrl ${!this.micOn?'appl-ctrl--off':''}`} onClick={()=>{this.micOn=!this.micOn;this.call?.setMic(this.micOn);}}>
              <span class="appl-ctrl-icon">{this.micOn?'🎤':'🔇'}</span>
              <span class="appl-ctrl-label">{this.micOn?'Mute':'Unmute'}</span>
            </button>
            <button class={`appl-ctrl ${!this.camOn?'appl-ctrl--off':''}`} onClick={()=>{this.camOn=!this.camOn;this.call?.setCam(this.camOn);}}>
              <span class="appl-ctrl-icon">{this.camOn?'📷':'📵'}</span>
              <span class="appl-ctrl-label">{this.camOn?'Camera':'Cam Off'}</span>
            </button>
            <button class="appl-ctrl appl-ctrl--end" onClick={()=>{ if(this.call){this.call.leave();this.call=null;} clearInterval((this as any)._sessionTimer); this.step='complete'; this.referenceId='VKP-'+Math.random().toString(36).substr(2,8).toUpperCase(); }}>
              <span class="appl-ctrl-icon">📵</span>
              <span class="appl-ctrl-label">Disconnect</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── COMPLETE ─────────────────────────────────────────────────────────────── */
  private renderComplete() {
    return (
      <div class="card animate-in">
        <div class="card-left card-left--success">
          <div class="complete-check">✓</div>
          <div class="complete-side-title">All Done!</div>
          <div class="complete-side-sub">Your KYC session has been submitted for auditor review</div>
        </div>
        <div class="card-right">
          <h2 class="section-title">Video KYC Completed</h2>
          <p class="section-sub">Your session has been successfully recorded and submitted. You will be notified once the auditor reviews and approves it.</p>

          <div class="ref-card">
            <div class="ref-label">Your Reference ID</div>
            <div class="ref-id">{this.referenceId}</div>
            <div class="ref-note">Save this for tracking your KYC status</div>
          </div>

          <div class="complete-timeline">
            <div class="ct-step ct-done">✅ Session Recorded</div>
            <div class="ct-step ct-done">✅ Identity Verified</div>
            <div class="ct-step ct-pending">📋 Auditor Review — In Progress</div>
            <div class="ct-step ct-pending">📱 SMS Notification on Approval</div>
          </div>
          <p class="rbi-note" style={{marginTop:'20px'}}>Typical processing time: 2–4 business hours. This V-CIP was conducted under RBI Master Direction on KYC.</p>
        </div>
      </div>
    );
  }

  render() {
    return (
      <div class="vkyc-applicant">
        {/* Header */}
        <header class="vkyc-header">
          <div class="header-inner">
            <div class="brand">
              <div class="brand-mark"><span class="bv">V</span><span class="bk">KYC</span></div>
              <div class="brand-text">
                <div class="brand-name">Video KYC</div>
                <div class="brand-sub">RBI Regulated</div>
              </div>
            </div>
            <div class="header-secure">🔒 Bank-grade Security</div>
          </div>
        </header>

        {/* Progress */}
        {this.step!=='welcome'&&this.step!=='session'&&this.step!=='complete'&&this.renderProgress()}

        {/* Content */}
        <main class={`vkyc-main ${this.step==='session'?'vkyc-main--full':''}`}>
          {this.step==='welcome'   && this.renderWelcome()}
          {this.step==='consent'   && this.renderConsent()}
          {/* aadhaar eKYC step removed — status pre-checked by calling system */}
          {this.step==='queue'     && this.renderQueue()}
          {this.step==='liveness'  && this.renderLiveness()}
          {this.step==='session'   && this.renderSession()}
          {this.step==='complete'  && this.renderComplete()}
        </main>

        {this.toast&&<div class={`toast toast--${this.toast.type}`}>{this.toast.msg}</div>}
      </div>
    );
  }
}
