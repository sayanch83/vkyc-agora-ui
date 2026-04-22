import { Component, State, h } from '@stencil/core';
import { AUDITOR_CHECK_SECTIONS } from '../../utils/constants';

// Stub cases already decided — only show approved/rejected in auditor queue
const MOCK_STUBS = [
  { id:'8a7b3c4d-002', extId:'1di972671sad779879365345e', name:'Advait Lachake', status:'completed', callType:'VCIP', kycType:'digi-kyc', mobile:'8003929453', date:'13/04/2026', time:'11:51 AM–11:53 AM', liveness:{passed:true,score:91.7}, panFaceMatch:91, aadhaarFaceMatch:85, locationPass:true, consentOk:true, aadhaarFresh:true, ocrOk:true, officerName:'Agent Kumar', officerId:'AGT001', duration:'2m 15s', remarks:'All checks passed.', questionnaire:[{q:'What is your date of birth?',a:'pass'},{q:'According to your Aadhaar, what is your name?',a:'pass'}] },
  { id:'8a7b3c4d-003', extId:'1di972671g1', name:'Neha Verma', status:'rejected', callType:'VCIP', kycType:'digi-kyc', mobile:'9811234567', date:'13/04/2026', time:'11:32 AM–11:35 AM', liveness:{passed:true,score:88.1}, panFaceMatch:62, aadhaarFaceMatch:58, locationPass:false, consentOk:true, aadhaarFresh:true, ocrOk:false, officerName:'Agent Priya', officerId:'AGT002', duration:'3m 45s', remarks:'Face match below threshold. DOB mismatch.', questionnaire:[{q:'What is your date of birth?',a:'fail'},{q:'According to your Aadhaar, what is your name?',a:'fail'}] },
];

@Component({ tag:'vkyc-auditor', styleUrl:'vkyc-auditor.css', shadow:true })
export class VkycAuditor {
  @State() cases = [...MOCK_STUBS];
  @State() activeCase: typeof MOCK_STUBS[0]|null = null;
  @State() filterStatus = 'all';
  @State() search = '';
  @State() expanded: string[] = ['acceptance','risk','identity'];
  @State() auditRemarks = '';
  @State() busy = false;
  @State() toast: {msg:string;type:string}|null = null;
  @State() recordingUrl: string|null = null;
  @State() recordingLoading = false;

  private delay(ms:number) { return new Promise(r=>setTimeout(r,ms)); }

  async componentWillLoad() {
    await this.loadCases();
  }

  private async loadCases() {
    try {
      const API = (window as any).__VKYC_API__ || 'http://localhost:3001/api/v1';

      // Load stub names from queue config
      let stubs = [...MOCK_STUBS];
      try {
        const cfgRes = await fetch(API + '/demo-config');
        const cfgData = await cfgRes.json();
        if (cfgData.success && cfgData.config?.queue) {
          stubs = MOCK_STUBS.map((s, i) => ({
            ...s,
            name: cfgData.config.queue[i]?.name || s.name,
          }));
        }
      } catch(e) {}

      // Load real session result — only add to queue if agent made a decision
      try {
        const resRes = await fetch(API + '/session-result');
        const resData = await resRes.json();
        if (resData.success && resData.result) {
          const r = resData.result;
          const now = new Date(r.decidedAt || Date.now());
          const date = now.toLocaleDateString('en-IN', {day:'2-digit', month:'2-digit', year:'numeric'});
          const time = now.toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'});
          const liveCase = {
            id: r.caseId || 'KYC-DEMO-001',
            extId: 'LIVE-' + Date.now().toString(36).toUpperCase(),
            name: r.applicantName || 'Unknown',
            status: r.decision === 'approved' ? 'pending' : 'rejected', // pending = awaiting auditor review
            callType: 'VCIP', kycType: 'digi-kyc',
            mobile: '—', date, time: time + ' (today)',
            liveness: { passed: true, score: r.livenessScore || 0 },
            panFaceMatch: 85, aadhaarFaceMatch: 82,
            locationPass: true, consentOk: true, aadhaarFresh: true, ocrOk: true,
            officerName: r.officerName || 'Agent Kumar',
            officerId: r.officerId || 'AGT001',
            duration: '—', remarks: r.remarks || '',
            questionnaire: [{q:'What is your date of birth?',a:'pass'},{q:'According to your Aadhaar, what is your name?',a:'pass'}]
          };
          // Only add if approved by agent — rejected cases skip auditor
          if (r.decision === 'approved') {
            this.cases = [liveCase, ...stubs];
          } else {
            this.cases = stubs;
          }
          console.log('[Auditor] Session result loaded:', r.applicantName, r.decision);
          return;
        }
      } catch(e) {}

      // No session result — show only stubs
      this.cases = stubs;
    } catch(e) {
      console.warn('[Auditor] Could not load cases:', e);
      this.cases = [...MOCK_STUBS];
    }
  }

  private async fetchRecording() {
    this.recordingLoading = true;
    this.recordingUrl = null;
    try {
      const API = (window as any).__VKYC_API__ || 'http://localhost:3001/api/v1';
      const res = await fetch(API + '/recording');
      const data = await res.json();
      if (data.success && data.recording?.data) {
        // Convert base64 back to blob URL
        const byteStr = atob(data.recording.data);
        const ab = new ArrayBuffer(byteStr.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
        const blob = new Blob([ab], { type: data.recording.mimeType || 'video/webm' });
        this.recordingUrl = URL.createObjectURL(blob);
      }
    } catch(e) { console.warn('[Auditor] Recording fetch failed:', e); }
    this.recordingLoading = false;
  }
  private showToast(msg:string,type='info') { this.toast={msg,type}; setTimeout(()=>{this.toast=null;},3500); }

  private toggleSection(id:string) {
    this.expanded = this.expanded.includes(id) ? this.expanded.filter(s=>s!==id) : [...this.expanded,id];
  }

  private checkStatus(c: typeof MOCK_STUBS[0], id:string): boolean|null {
    return ({consent:c.consentOk,recording:c.consentOk,location:c.locationPass,liveness:c.liveness.passed,aadhaar:c.aadhaarFresh,pan_face:c.panFaceMatch>=70,adh_face:c.aadhaarFaceMatch>=70,ocr:c.ocrOk,questions:c.questionnaire.every(q=>q.a==='pass')} as Record<string,boolean>)[id]??null;
  }

  private async decide(type:'approve'|'reject') {
    if(!this.activeCase) return;
    if(type==='reject'&&!this.auditRemarks) { this.showToast('Remarks required for rejection','error'); return; }
    this.busy=true; await this.delay(700); this.busy=false;
    this.cases=this.cases.map(c=>c.id===this.activeCase!.id?{...c,status:type==='approve'?'completed':'rejected',remarks:this.auditRemarks}:c);
    this.showToast(type==='approve'?'KYC Approved by Auditor ✓':'KYC Rejected',type==='approve'?'success':'error');
    this.activeCase=null;
  }

  private statusCfg(s:string) {
    return ({
      pending:   {bg:'#fef3c7',color:'#d97706',  label:'⏳ Pending Audit'},
      completed: {bg:'#dcfce7',color:'#166534',  label:'✅ Approved'},
      approved:  {bg:'#dcfce7',color:'#166534',  label:'✅ Approved'},
      rejected:  {bg:'#fee2e2',color:'#991b1b',  label:'✗ Rejected'},
    } as any)[s]||{bg:'#f1f5f9',color:'#475569',label:s};
  }

  /* ── QUEUE ─────────────────────────────────────────────────── */
  private renderQueue() {
    const sc = this.statusCfg.bind(this);
    const filtered = this.cases.filter(c=>{
      const ms = this.filterStatus==='all'||c.status===this.filterStatus;
      const mq = !this.search||c.name.toLowerCase().includes(this.search.toLowerCase())||c.id.includes(this.search)||c.extId.includes(this.search);
      return ms&&mq;
    });
    const counts:{[k:string]:number}={all:this.cases.length,pending:this.cases.filter(c=>c.status==='pending').length,completed:this.cases.filter(c=>c.status==='completed').length,rejected:this.cases.filter(c=>c.status==='rejected').length};

    return (
      <div class="queue-view animate-in">
        <div class="queue-head">
          <div>
            <h1 class="queue-title">Audit Queue</h1>
            <p class="queue-sub">Review completed V-CIP sessions and provide final compliance approval</p>
          </div>
          <div class="auditor-chip">
            <div class="aud-av">SR</div>
            <div>
              <div class="aud-name">Sr. Auditor Reddy</div>
              <div class="aud-id">AUD001 · Compliance</div>
            </div>
          </div>
        </div>

        <div class="stat-strip">
          {[
            {l:'Pending Review',v:counts['pending'],  c:'#d97706',bg:'#fef3c7'},
            {l:'Approved',      v:counts['completed'],c:'#00897b',bg:'#dcfce7'},
            {l:'Rejected',      v:counts['rejected'], c:'#d32f2f',bg:'#fee2e2'},
            {l:'Total',         v:counts['all'],      c:'#0d2b6b',bg:'#dbeafe'},
          ].map(s=>(
            <div class="stat-card" style={{background:s.bg}}>
              <div class="stat-val" style={{color:s.c}}>{s.v}</div>
              <div class="stat-lbl" style={{color:s.c}}>{s.l}</div>
            </div>
          ))}
        </div>

        <div class="toolbar">
          <div class="search-box">
            <span class="search-icon">🔍</span>
            <input class="search-input" placeholder="Search by name or reference ID…" value={this.search} onInput={e=>{this.search=(e.target as HTMLInputElement).value;}} />
          </div>
          <button class="refresh-btn" onClick={()=>this.loadCases()} title="Refresh queue">🔄 Refresh</button>
          <div class="filter-chips">
            {['all','pending','completed','rejected'].map(f=>(
              <button class={`chip ${this.filterStatus===f?'chip--on':''}`} onClick={()=>{this.filterStatus=f;}}>
                {f.charAt(0).toUpperCase()+f.slice(1)} <span class="chip-num">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>

        <div class="case-table">
          <div class="tbl-head">
            <span style={{flex:'0 0 165px'}}>Reference ID</span>
            <span style={{flex:'2'}}>Customer</span>
            <span style={{flex:'1'}}>Liveness</span>
            <span style={{flex:'1'}}>PAN Match</span>
            <span style={{flex:'1'}}>Aadhaar Match</span>
            <span style={{flex:'1'}}>Status</span>
            <span style={{flex:'1'}}>Date · Time</span>
            <span style={{flex:'0 0 90px'}}>Action</span>
          </div>
          {filtered.length===0&&<div class="tbl-empty">No cases match the current filter</div>}
          {filtered.map(c=>{
            const cfg=sc(c.status);
            return (
              <div class="tbl-row">
                <div style={{flex:'0 0 165px'}}>
                  <div class="ref-id">{c.id.slice(0,20)}…</div>
                  <div class="ext-id">{c.extId.slice(0,16)}…</div>
                </div>
                <div style={{flex:'2'}}>
                  <div class="c-name">{c.name}</div>
                  <div class="c-meta">{c.mobile} · {c.kycType}</div>
                </div>
                <div style={{flex:'1'}}>
                  <span class={`lp ${c.liveness.passed?'lp--pass':'lp--fail'}`}>{c.liveness.passed?'✓':'✗'} {c.liveness.score}%</span>
                </div>
                <div style={{flex:'1'}}>
                  <span class={`sp ${c.panFaceMatch>=80?'sp--ok':'sp--warn'}`}>{c.panFaceMatch}%</span>
                </div>
                <div style={{flex:'1'}}>
                  {c.aadhaarFaceMatch?<span class={`sp ${c.aadhaarFaceMatch>=80?'sp--ok':'sp--warn'}`}>{c.aadhaarFaceMatch}%</span>:<span class="c-meta">N/A</span>}
                </div>
                <div style={{flex:'1'}}>
                  <span class="sbadge" style={{background:cfg.bg,color:cfg.color}}>{cfg.label}</span>
                </div>
                <div style={{flex:'1'}}>
                  <div class="c-name" style={{fontSize:'12px'}}>{c.date}</div>
                  <div class="c-meta">{c.time}</div>
                </div>
                <div style={{flex:'0 0 90px'}}>
                  <button class="btn-review" onClick={()=>{this.activeCase=c;this.auditRemarks=c.remarks||'';}}>
                    Review →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ── REVIEW ────────────────────────────────────────────────── */
  private renderReview() {
    const c=this.activeCase!;
    const allOk=AUDITOR_CHECK_SECTIONS.every(sec=>sec.checks.every(ch=>this.checkStatus(c,ch.id)!==false));

    return (
      <div class="review-view animate-in">
        {/* Top bar */}
        <div class="review-bar">
          <button class="back-btn" onClick={()=>{this.activeCase=null;}}>← Back</button>
          <div class="review-bar-info">
            <span class="review-name">{c.name}</span>
            <span class="review-ref">{c.id}</span>
            <span class="sbadge" style={{background:this.statusCfg(c.status).bg,color:this.statusCfg(c.status).color}}>{this.statusCfg(c.status).label}</span>
          </div>
          <div class="review-officer-info">
            Officer: <strong>{c.officerName}</strong> ({c.officerId}) · {c.duration}
          </div>
        </div>

        <div class="review-body">
          {/* LEFT — recording + details */}
          <div class="review-left">
            {/* Recording area — real video player */}
            <div class="recording-area">
              {this.recordingLoading&&(
                <div class="recording-loading">
                  <div class="rl-spinner"/>
                  <span>Loading session recording…</span>
                </div>
              )}
              {!this.recordingLoading&&this.recordingUrl&&(
                <div class="recording-player">
                  <video
                    src={this.recordingUrl}
                    controls
                    style={{width:'100%',height:'100%',objectFit:'contain',background:'#000',borderRadius:'8px'}}
                  />
                  <div class="recording-label">📹 Session Recording · {c.duration} · {c.date}</div>
                </div>
              )}
              {!this.recordingLoading&&!this.recordingUrl&&(
                <div class="recording-unavailable">
                  <div class="ru-icon">📹</div>
                  <div class="ru-title">No recording available</div>
                  <div class="ru-sub">Recording is uploaded at end of session. Complete a live session first.</div>
                  <button class="ru-retry" onClick={()=>this.fetchRecording()}>🔄 Check Again</button>
                </div>
              )}
            </div>

            {/* Metrics grid */}
            <div class="metrics-grid">
              {[
                {icon:'👁',label:'Liveness Score',val:`${c.liveness.score}%`,ok:c.liveness.passed,note:'ISO 30107-3'},
                {icon:'🪪',label:'PAN Face Match',val:`${c.panFaceMatch}%`,ok:c.panFaceMatch>=80,note:c.panFaceMatch>=80?'Pass':'Review'},
                {icon:'🔐',label:'Aadhaar Face Match',val:c.aadhaarFaceMatch?`${c.aadhaarFaceMatch}%`:'N/A',ok:c.aadhaarFaceMatch>=80,note:c.aadhaarFaceMatch>=80?'Pass':'Review'},
                {icon:'📍',label:'Location Match',val:c.locationPass?'Verified':'Mismatch',ok:c.locationPass,note:c.locationPass?'Geo-tagged':'Check required'},
              ].map(m=>(
                <div class="metric-card">
                  <div class="mc-icon">{m.icon}</div>
                  <div class="mc-val" style={{color:m.ok?'#00897b':'#d32f2f'}}>{m.val}</div>
                  <div class="mc-label">{m.label}</div>
                  <div class={`mc-note ${m.ok?'mc-note--ok':'mc-note--warn'}`}>{m.note}</div>
                </div>
              ))}
            </div>

            {/* Auditor remarks */}
            {c.status==='pending'&&(
              <div class="remarks-section">
                <div class="remarks-label">Auditor Remarks</div>
                <textarea class="remarks-field" rows={3} placeholder="Record your observations and decision rationale (required for rejection)…" value={this.auditRemarks}
                  onInput={e=>{this.auditRemarks=(e.target as HTMLTextAreaElement).value;}} />
              </div>
            )}
            {c.status!=='pending'&&c.remarks&&(
              <div class="remarks-section">
                <div class="remarks-label">Auditor Remarks</div>
                <div class="remarks-readonly">{c.remarks}</div>
              </div>
            )}
          </div>

          {/* RIGHT — compliance checks */}
          <div class="review-right">
            <div class="checks-head">Compliance Checks</div>
            <div class={`overall-badge ${allOk?'overall-badge--ok':'overall-badge--warn'}`}>
              {allOk?'✅ All checks passed':'⚠️ Some checks need attention'}
            </div>

            {AUDITOR_CHECK_SECTIONS.map(sec=>{
              const open=this.expanded.includes(sec.id);
              const secOk=sec.checks.every(ch=>this.checkStatus(c,ch.id)!==false);
              return (
                <div class="check-section">
                  <div class="cs-header" onClick={()=>this.toggleSection(sec.id)}>
                    <div class="cs-title">
                      <span class={`cs-icon ${secOk?'cs-icon--ok':'cs-icon--warn'}`}>{secOk?'✓':'⚠'}</span>
                      {sec.label}
                    </div>
                    <span class="cs-arrow">{open?'▲':'▼'}</span>
                  </div>
                  {open&&(
                    <div class="cs-items animate-in">
                      {sec.checks.map(ch=>{
                        const st=this.checkStatus(c,ch.id);
                        return (
                          <div class="ci-row">
                            <span class={`ci-dot ${st===true?'ci-dot--ok':st===false?'ci-dot--fail':'ci-dot--na'}`}>{st===true?'✓':st===false?'✗':'—'}</span>
                            <span class="ci-label">{ch.label}</span>
                            <span class={`ci-badge ${st===true?'cib--ok':st===false?'cib--fail':'cib--na'}`}>{st===true?'Pass':st===false?'Fail':'N/A'}</span>
                          </div>
                        );
                      })}
                      {sec.id==='identity'&&(
                        <div class="ci-detail">
                          <div class="ci-detail-title">Questions &amp; Responses</div>
                          {c.questionnaire.map(q=>(
                            <div class="ci-detail-row">
                              <span class="ci-detail-q">{q.q}</span>
                              <span class={`q-ans q-ans--${q.a}`}>{q.a.toUpperCase()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Officer card */}
            <div class="officer-card">
              <div class="oc-title">Authorised Officer</div>
              <div class="oc-row">
                <div class="oc-av">{c.officerName.split(' ').map(w=>w[0]).join('').slice(0,2)}</div>
                <div>
                  <div class="oc-name">{c.officerName}</div>
                  <div class="oc-id">{c.officerId} · Session: {c.duration}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Pinned footer — Approve / Reject — matching original layout */}
        {c.status==='pending'&&(
          <div class="review-footer">
            <button class="footer-back" onClick={()=>{this.activeCase=null;}}>Back</button>
            <div class="footer-actions">
              <button class={`btn-reject ${this.busy?'btn-dis':''}`} disabled={this.busy} onClick={()=>this.decide('reject')}>
                {this.busy?'Processing…':'Reject'}
              </button>
              <button class={`btn-approve ${this.busy?'btn-dis':''}`} disabled={this.busy} onClick={()=>this.decide('approve')}>
                {this.busy?'Processing…':'Approve'}
              </button>
            </div>
          </div>
        )}
        {c.status!=='pending'&&(
          <div class="review-footer">
            <button class="footer-back" onClick={()=>{this.activeCase=null;}}>← Back to Queue</button>
            <div class={`decision-banner decision-banner--${c.status}`}>
              <span>{c.status==='completed'||c.status==='approved'?'✅ Approved by Auditor':'✗ Rejected by Auditor'}</span>
              {c.remarks&&<small>{c.remarks}</small>}
            </div>
          </div>
        )}
      </div>
    );
  }

  render() {
    return (
      <div class="vkyc-auditor">
        <header class="aud-header">
          <div class="aud-header-inner">
            <div class="brand">
              <div class="brand-mark"><span class="bv">V</span><span class="bk">KYC</span></div>
              <div class="brand-text">
                <div class="brand-name">Auditor Portal</div>
                <div class="brand-sub">RBI V-CIP · Compliance Review</div>
              </div>
            </div>
          </div>
        </header>

        <main class="aud-main">
          {!this.activeCase && this.renderQueue()}
          {this.activeCase  && this.renderReview()}
        </main>

        {this.toast&&<div class={`toast toast--${this.toast.type}`}>{this.toast.msg}</div>}
      </div>
    );
  }
}
