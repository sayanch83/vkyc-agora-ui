import { Component, State, h } from '@stencil/core';

const API = () => (window as any).__VKYC_API__ || 'http://localhost:3001/api/v1';

@Component({ tag: 'vkyc-config', styleUrl: 'vkyc-config.css', shadow: true })
export class VkycConfig {
  @State() saved = false;
  @State() loading = true;
  @State() saving = false;
  @State() form: Record<string,string> = {
    name: '', mobile: '', appId: '', product: 'Personal Loan',
    amount: '300000', pan: '', dob: '', father: '', address: '',
    aadhaarOffset: '-1',
  };

  async componentWillLoad() {
    try {
      const res = await fetch(API() + '/demo-config');
      const data = await res.json();
      if (data.success) {
        const a = data.config.applicant;
        this.form = {
          name: a.name, mobile: a.mobile, appId: a.appId,
          product: a.product, amount: String(a.amount), pan: a.pan,
          dob: a.dob, father: a.father, address: a.address,
          aadhaarOffset: String(a.aadhaarOffset),
        };
      }
    } catch(e) {}
    this.loading = false;
  }

  private set(field: string, val: string): void {
    this.form = { ...this.form, [field]: val };
  }

  private async save() {
    this.saving = true;
    try {
      await fetch(API() + '/demo-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicant: { ...this.form, amount: parseInt(this.form.amount) || 0, aadhaarOffset: parseInt(this.form.aadhaarOffset) || -1 }
        })
      });
      this.saved = true;
      setTimeout(() => this.saved = false, 3000);
    } catch(e) { alert('Save failed — check API connection'); }
    this.saving = false;
  }

  private async reset() {
    if (!confirm('Reset to default demo data?')) return;
    await fetch(API() + '/demo-config/reset', { method: 'POST' });
    await this.componentWillLoad();
  }

  render() {
    if (this.loading) return <div class="loading">Loading config…</div>;

    const inp = (label: string, field: string, type = 'text', hint = '') => (
      <div class="field">
        <label class="field-label">{label}</label>
        {hint && <div class="field-hint">{hint}</div>}
        <input
          class="field-input" type={type} value={this.form[field]}
          onInput={(e) => this.set(field, (e.target as HTMLInputElement).value)}
        />
      </div>
    );

    return (
      <div class="config-wrap">
        <header class="config-header">
          <div class="brand">
            <div class="brand-mark"><span class="bv">V</span><span class="bk">KYC</span></div>
            <div>
              <div class="brand-name">Demo Config Panel</div>
              <div class="brand-sub">Sales Team · Pre-demo Setup</div>
            </div>
          </div>
        </header>

        <div class="config-body">
          <div class="config-card">
            <div class="card-title">⚙️ Applicant Details</div>
            <div class="card-sub">Set these to match the PAN card you will show during the demo. OCR match scores will then be accurate.</div>

            <div class="field-grid">
              {inp('Full Name (as on PAN card)', 'name', 'text', 'Must match PAN card exactly for OCR match')}
              {inp('Mobile Number', 'mobile')}
              {inp('Application ID', 'appId')}
              {inp('PAN Number', 'pan', 'text', 'Enter actual PAN — OCR will validate against this')}
              {inp('Date of Birth (DD/MM/YYYY)', 'dob')}
              {inp("Father's Name (as on PAN card)", 'father', 'text', 'Must match PAN card for OCR match')}
              {inp('Address', 'address')}
            </div>

            <div class="field-grid field-grid--3">
              <div class="field">
                <label class="field-label">Product</label>
                <select class="field-input" onInput={(e) => this.set('product', (e.target as HTMLSelectElement).value)}>
                  {['Personal Loan','Home Loan','Car Loan','Business Loan','Credit Card','Two-Wheeler Loan'].map(p =>
                    <option value={p} selected={this.form.product === p}>{p}</option>
                  )}
                </select>
              </div>
              {inp('Loan Amount (₹)', 'amount', 'number')}
              <div class="field">
                <label class="field-label">Aadhaar eKYC Date</label>
                <div class="field-hint">How old is the eKYC?</div>
                <select class="field-input" onInput={(e) => this.set('aadhaarOffset', (e.target as HTMLSelectElement).value)}>
                  <option value="-1" selected={this.form.aadhaarOffset==='-1'}>Yesterday (fresh)</option>
                  <option value="-30" selected={this.form.aadhaarOffset==='-30'}>1 month ago</option>
                  <option value="-180" selected={this.form.aadhaarOffset==='-180'}>6 months ago</option>
                  <option value="-365" selected={this.form.aadhaarOffset==='-365'}>1 year ago</option>
                  <option value="-548" selected={this.form.aadhaarOffset==='-548'}>1.5 years ago</option>
                  <option value="-730" selected={this.form.aadhaarOffset==='-730'}>2 years ago (expired)</option>
                </select>
              </div>
            </div>

            <div class="config-actions">
              <button class="btn-reset" onClick={() => this.reset()}>↺ Reset to Default</button>
              <button class={`btn-save ${this.saving?'btn-save--loading':''}`} onClick={() => this.save()} disabled={this.saving}>
                {this.saving ? '⏳ Saving…' : this.saved ? '✅ Saved!' : '💾 Save Config'}
              </button>
            </div>

            {this.saved && (
              <div class="save-banner">
                ✅ Config saved — agent and applicant will use this data on next load
              </div>
            )}
          </div>

          <div class="config-card config-card--info">
            <div class="card-title">📋 How to use</div>
            <ol class="how-list">
              <li>Fill in the applicant details matching your PAN card</li>
              <li>Click <strong>Save Config</strong></li>
              <li>Open <code>?role=agent</code> in a new window (hard refresh)</li>
              <li>Open <code>?role=applicant</code> on the mobile (hard refresh)</li>
              <li>Run the demo — OCR scores will match your PAN card</li>
            </ol>
            <div class="info-note">⚠️ Config resets when Railway restarts. Save again before each demo session if needed.</div>
          </div>
        </div>
      </div>
    );
  }
}
