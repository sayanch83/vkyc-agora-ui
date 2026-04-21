import { Component, State, h } from '@stencil/core';

@Component({ tag:'vkyc-app', styleUrl:'vkyc-app.css', shadow:true })
export class VkycApp {
  @State() role: 'home'|'applicant'|'agent'|'auditor' = 'home';

  componentWillLoad() {
    // Auto-detect role from URL: ?role=agent or ?role=applicant
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const r = params.get('role') as any;
      if (r === 'agent' || r === 'applicant' || r === 'auditor') {
        this.role = r;
      }
    }
  }

  render() {
    if(this.role==='applicant') return <vkyc-applicant />;
    if(this.role==='agent')     return <vkyc-agent />;
    if(this.role==='auditor')   return <vkyc-auditor />;

    return (
      <div class="launcher">
        <header class="launcher-header">
          <div class="brand">
            <div class="brand-mark"><span class="bv">V</span><span class="bk">KYC</span></div>
            <div class="brand-text">
              <div class="brand-name">Video KYC Platform</div>
              <div class="brand-sub">RBI V-CIP Compliant</div>
            </div>
          </div>
        </header>

        <div class="launcher-body">
          <div class="hero">
            <h1 class="hero-title">Complete V-CIP Verification Platform</h1>
            <p class="hero-sub">Applicant · Officer · Auditor — RBI Master Direction on KYC Compliant · ISO 30107-3 Liveness</p>
          </div>

          <div class="role-grid">
            <button class="role-card" onClick={()=>{this.role='applicant';}}>
              <div class="rc-icon">👤</div>
              <div class="rc-name">Applicant</div>
              <div class="rc-desc">Customer-facing Video KYC journey with liveness and live officer session</div>
              <div class="rc-steps">Consent → Aadhaar → Liveness → Session</div>
              <div class="rc-arrow">→</div>
            </button>

            <button class="role-card role-card--agent" onClick={()=>{this.role='agent';}}>
              <div class="rc-icon">🎧</div>
              <div class="rc-name">KYC Officer</div>
              <div class="rc-desc">Agent dashboard, live session tools, liveness confirmation and decision</div>
              <div class="rc-steps">Queue → Verify → Capture → Decide</div>
              <div class="rc-arrow">→</div>
            </button>

            <button class="role-card role-card--auditor" onClick={()=>{this.role='auditor';}}>
              <div class="rc-icon">🔎</div>
              <div class="rc-name">Auditor</div>
              <div class="rc-desc">Compliance review of completed sessions with recording and final approval</div>
              <div class="rc-steps">Review → Checks → Approve / Reject</div>
              <div class="rc-arrow">→</div>
            </button>
          </div>

          <p class="launcher-footer">
            Session recordings stored for 5 years · All data encrypted at rest and in transit · Powered by Lentra
          </p>
        </div>
      </div>
    );
  }
}
