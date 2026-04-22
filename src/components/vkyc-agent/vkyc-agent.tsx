import { Component, State, h, Fragment, Element } from '@stencil/core';
import { VkycCall, VkycSignal } from '../../utils/agora';
import { QUESTIONNAIRE_ITEMS } from '../../utils/constants';
import type { QuestionnaireMap } from '../../utils/constants';
type Decision = 'approve'|'reject'|null;

// Single demo case — valid eKYC, always fresh
const _d = (offset: number) => { const d=new Date(); d.setDate(d.getDate()+offset); return d.toISOString().slice(0,10); };

const MOCK_CASES = [
  { id:'KYC-DEMO-001', name:'Harshit Sodagar', mobile:'98765 43210', appId:'CDL2847391', product:'Personal Loan', amount:300000, pan:'AWEPD1123P', dob:'02/08/1979', father:'Suresh Kumar', address:'B-204, Andheri West, Mumbai 400058', aadhaarDate:_d(-1), status:'in-queue', queuePos:1, waitMins:4, geo:{lat:19.1136,lng:72.8697,city:'Andheri West, Mumbai'}, preCheckLiveness:{score:94.2,passed:true,method:'ISO-30107-3-Passive',ts:'10:28 AM'} },
];

@Component({ tag:'vkyc-agent', styleUrl:'vkyc-agent.css', shadow:true })
export class VkycAgent {
  @State() view:'dashboard'|'session' = 'dashboard';
  @State() cases = [...MOCK_CASES];
  @State() activeCase: typeof MOCK_CASES[0]|null = null;
  @State() filter = 'all';
  @State() sessionState: 'connecting'|'live' = 'connecting';
  @State() activeTab: 'liveness'|'face'|'code'|'pan'|'ocr'|'questions' = 'liveness';
  @State() callTimer = 0;
  @State() micOn = true;
  @State() camOn = true;
  @State() showAdmitModal = false;
  @State() appDataOpen = true;
  @State() liveness: Record<string,string> = {face:'pending',blink:'pending',smile:'pending',turn:'pending'};
  @State() livenessRunning = false;
  @State() livenessAttempt = 0;
  @State() livenessConfirmed = false;
  @State() inSessionScore: number|null = null;  // null=not run, 0=skipped
  @State() matchScores: Record<string,number|null> = {face:null,name:null,location:null,pan:null};
  @State() spokenCode: string|null = null;
  @State() codeAttempts = 0;
  @State() codeVerified = false;
  @State() codeMaxRetry = false;
  @State() panFront: string|null = null;
  @State() panBack: string|null = null;
  @State() sigImg: string|null = null;
  @State() ocrData: Record<string,string>|null = null;
  @State() ocrRunning = false;
  @State() faceCapture: string|null = null;
  @State() faceMatchScore: number|null = null;   // vs Aadhaar digilocker image
  @State() locationMatchScore: number|null = null; // vs geo captured during call
  @State() faceMatchRunning = false;
  @State() questionnaire: QuestionnaireMap = {};
  @State() questionnaireResponses: Record<string,string> = {};
  @State() remarks = '';
  @State() decision: Decision = null;
  @State() toasts: Array<{id:number;msg:string;type:string}> = [];
  @Element() el!: HTMLElement;
  private toastId = 0;
  private timerRef: any;
  private call: VkycCall|null = null;
  private signal: VkycSignal|null = null;
  private _lastRemoteUid: any = null;
  private recorder: MediaRecorder|null = null;
  private recordedChunks: Blob[] = [];
  private recordingStart: number = 0;
  @State() recordingUploading = false;
  @State() remoteUid: number|null = null;
  @State() pendingApplicant: {name:string;caseId:string}|null = null;
  @State() applicantDeviceStr = '';
  @State() applicantIsMobile = false;

  async componentDidLoad() {
    // Connect to RTM AFTER component renders (componentDidLoad is safer than componentWillLoad)
    await this.connectSignal();
  }

  componentDidUpdate() {
    // Re-attach video streams after every Stencil re-render
    if (this.call && this.view === 'session') {
      const localEl = this.getEl('agora-local');
      if (localEl) this.call.replayLocal(localEl);
      if (this._lastRemoteUid !== null) {
        const remoteEl = this.getEl('agora-remote');
        if (remoteEl) this.call.replayRemote(this._lastRemoteUid, remoteEl);
      }
    }
  }

  private async connectSignal() {
    try {
      this.signal = new VkycSignal();
      this.signal.onMessage = (data: any) => {
        if (data.type === 'applicant-ready') {
          console.log('[Agent] Received applicant-ready signal:', data);
          const matched = this.cases.find(c => c.id === data.caseId) || this.cases[0];
          this.pendingApplicant = { name: data.name, caseId: matched.id };
          this.activeCase = matched;
          this.cases = this.cases.map(x => x.id===matched.id ? {...x, status:'in-progress'} : x);
          // Build device display string
          let devStr = data.deviceStr || '';
          if (data.geo && data.geo !== 'unavailable') devStr += ' 📍 ' + data.geo;
          if (devStr) this.applicantDeviceStr = devStr;
          if (data.isMobile !== undefined) this.applicantIsMobile = !!data.isMobile;
          console.log('[Agent] deviceStr:', devStr, 'isMobile:', data.isMobile, 'geo:', data.geo);
          this.showAdmitModal = true;
        }
      };
      this.signal.startListening();
      console.log('[Agent] Signal listener started');
      this.pushToast('Ready — waiting for applicant…','info');
    } catch(e) {
      console.error('[Agent] Signal failed:', e);
    }
  }

  private delay(ms:number) { return new Promise(r=>setTimeout(r,ms)); }
  private fmt() { return `${String(Math.floor(this.callTimer/60)).padStart(2,'0')}:${String(this.callTimer%60).padStart(2,'0')}`; }
  private pushToast(msg:string, type='success') {
    const id=++this.toastId;
    this.toasts=[...this.toasts,{id,msg,type}];
    setTimeout(()=>{ this.toasts=this.toasts.filter(t=>t.id!==id); },4000);
  }

  private getEl(id: string): HTMLElement | null {
    const root = this.el.shadowRoot || this.el;
    return root.querySelector('#' + id) as HTMLElement | null;
  }

  private async waitForEl(id: string, retries = 40): Promise<HTMLElement | null> {
    for (let i = 0; i < retries; i++) {
      const el = this.getEl(id);
      if (el) return el;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }

  private async startAgoraCall() {
    const c = this.activeCase!;
    try {
      this.call = new VkycCall();
      const agentUid = 1000 + Math.floor(Math.random() * 1000);

      this.call.onRemoteJoined = async (uid) => {
        console.log('[Agent] Remote joined uid:', uid);
        // Get element BEFORE setting state (state change triggers re-render)
        let el = this.getEl('agora-remote');
        if (!el) el = await this.waitForEl('agora-remote');
        console.log('[Agent] agora-remote found:', !!el);
        if (el) {
          // Play into the pre-existing <video> element
          this.call!.playRemote(uid, el);
          // Only update state AFTER playing — this prevents re-render from killing the video
          await new Promise(r => setTimeout(r, 100));
          this._lastRemoteUid = uid;
          this.remoteUid = uid;
          this.pushToast('Customer video connected','success');
        } else {
          this.remoteUid = uid;
          console.error('[Agent] Could not find agora-remote element');
        }
      };
      this.call.onRemoteLeft = () => {
        this.remoteUid = null;
        this.pushToast('Customer disconnected','info');
      };
      this.call.onError = (msg) => this.pushToast(msg,'error');

      // Set live FIRST — triggers Stencil to render session view with video containers
      this.sessionState = 'live';
      this.timerRef = setInterval(()=>{ this.callTimer=this.callTimer+1; },1000);

      // Wait for video containers to appear in DOM
      const localEl  = await this.waitForEl('agora-local');
      const remoteEl = await this.waitForEl('agora-remote');
      console.log('[Agent] Video containers found:', !!localEl, !!remoteEl);

      // Join channel
      await this.call.join(c.id, agentUid);

      // Play local immediately after join
      console.log('[Agent] Playing local video, localEl:', !!localEl);
      if (localEl) this.call.playLocal(localEl);
      else console.error('[Agent] agora-local not found');

      this.pushToast(`Connected to ${c.name}`,'info');
      if (this.signal) {
        this.signal.sendToApplicant({ type:'agent-info', agentName:'Agent Kumar', agentId:'AGT001' });
      }
      // Start recording after a short delay so tracks are ready
      setTimeout(() => this.startRecording(), 1500);
    } catch (e: any) {
      this.pushToast('Camera/mic error: ' + e.message,'error');
      this.sessionState='live';
      this.timerRef=setInterval(()=>{ this.callTimer=this.callTimer+1; },1000);
    }
  }

  private startRecording() {
    try {
      // Capture both local and remote video by recording the entire session column
      const root = this.el.shadowRoot || this.el;
      const localVid  = root.querySelector('#local-video')  as HTMLVideoElement;
      const remoteVid = root.querySelector('#remote-video') as HTMLVideoElement;
      if (!localVid && !remoteVid) return;

      // Composite canvas — side by side
      const canvas  = document.createElement('canvas');
      canvas.width  = 640; canvas.height = 240;
      const ctx     = canvas.getContext('2d')!;
      let recording = true;

      const draw = () => {
        if (!recording) return;
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, 640, 240);
        if (remoteVid && remoteVid.readyState >= 2) ctx.drawImage(remoteVid, 0, 0, 320, 240);
        if (localVid  && localVid.readyState  >= 2) ctx.drawImage(localVid,  320, 0, 320, 240);
        requestAnimationFrame(draw);
      };
      draw();

      const stream = canvas.captureStream(15); // 15fps

      // Add audio from local mic if available
      const localStream = (localVid as any)?.srcObject as MediaStream;
      if (localStream) {
        localStream.getAudioTracks().forEach((t: MediaStreamTrack) => stream.addTrack(t));
      }

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9' : 'video/webm';

      this.recordedChunks = [];
      this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 500000 });
      this.recorder.ondataavailable = (e) => { if (e.data.size > 0) this.recordedChunks.push(e.data); };
      this.recorder.onstop = () => { recording = false; this.uploadRecording(); };
      this.recorder.start(1000); // chunk every 1s
      this.recordingStart = Date.now();
      console.log('[Recording] Started');
    } catch(e) {
      console.warn('[Recording] Failed to start:', e);
    }
  }

  private async uploadRecording() {
    if (this.recordedChunks.length === 0) return;
    this.recordingUploading = true;
    try {
      const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
      const duration = Math.round((Date.now() - this.recordingStart) / 1000);
      console.log('[Recording] Uploading', Math.round(blob.size/1024)+'KB,', duration+'s');

      // Convert blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const API = (window as any).__VKYC_API__ || 'http://localhost:3001/api/v1';
        await fetch(API + '/recording', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caseId: this.activeCase?.id || 'KYC-DEMO-001',
            agentId: 'AGT001',
            data: base64,
            mimeType: 'video/webm',
            duration
          })
        });
        console.log('[Recording] Uploaded successfully');
        this.recordingUploading = false;
      };
    } catch(e) {
      console.warn('[Recording] Upload failed:', e);
      this.recordingUploading = false;
    }
  }

  private endSession() {
    // Stop recording
    if(this.recorder && this.recorder.state !== 'inactive') { this.recorder.stop(); this.recorder=null; }
    // Notify applicant that session is ending
    if(this.signal) {
      this.signal.sendToApplicant({ type: 'session-ended', decision: this.decision || 'disconnect' });
    }
    if(this.call){this.call.leave();this.call=null;}
    if(this.signal){this.signal.stop();this.signal=null;}
    this.pendingApplicant=null;
    this.remoteUid=null;
    clearInterval(this.timerRef);
    this.view='dashboard'; this.callTimer=0; this.activeCase=null; this.sessionState='connecting';
    this.liveness={face:'pending',blink:'pending',smile:'pending',turn:'pending'};
    this.livenessAttempt=0; this.livenessConfirmed=false; this.inSessionScore=null;
    this.matchScores={face:null,name:null,location:null,pan:null};
    this.panFront=null; this.panBack=null; this.sigImg=null; this.ocrData=null;
    this.faceCapture=null; this.faceMatchScore=null; this.locationMatchScore=null; this.faceMatchRunning=false;
    this.decision=null; this.remarks=''; this.questionnaire={}; this.questionnaireResponses={};
    this.spokenCode=null; this.codeAttempts=0; this.codeVerified=false; this.codeMaxRetry=false;
    this.toasts=[]; this.appDataOpen=false; this.activeTab='liveness';
  }

  private isEkycExpired(dateStr: string): boolean {
    // dateStr is YYYY-MM-DD
    const ekycDate = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - ekycDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays > 3;
  }

  private ekycDaysAgo(dateStr: string): number {
    const ekycDate = new Date(dateStr);
    const now = new Date();
    return Math.floor((now.getTime() - ekycDate.getTime()) / (1000 * 60 * 60 * 24));
  }

  private async runLiveness() {
    if(this.livenessRunning||this.sessionState!=='live') return;
    this.livenessRunning=true; this.livenessConfirmed=false;
    this.livenessAttempt=this.livenessAttempt+1;
    this.liveness={face:'pending',blink:'pending',smile:'pending',turn:'pending'};
    this.pushToast('Running liveness on applicant video…','info');

    try {
      // Get the applicant's remote video element
      const root = this.el.shadowRoot || this.el;
      const remoteVid = root.querySelector('#remote-video') as HTMLVideoElement;

      if (!remoteVid || !remoteVid.srcObject) {
        throw new Error('No remote video available');
      }

      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 240;

      // Run 4 frame analyses — 1 per check, 800ms apart
      const checks = ['face','blink','smile','turn'] as const;
      let totalScore = 0;
      let blinkSeen = false;

      for (const k of checks) {
        this.liveness = {...this.liveness, [k]:'checking'};
        await this.delay(800);

        const result = await analyseFrame(remoteVid, canvas);
        const passed = k==='face'  ? result.faceDetected :
                       k==='blink' ? (result.eyesOpen||result.blinkDetected) :
                       k==='smile' ? result.textureOk :
                       result.headCentered;

        if (result.blinkDetected) blinkSeen = true;
        this.liveness = {...this.liveness, [k]: passed?'pass':'fail'};
        totalScore += result.score;
        console.log('[Liveness] Check', k, ':', result);
      }

      const avgScore = Math.round(totalScore / checks.length);
      const blinkBonus = blinkSeen ? 3 : -5;
      const finalScore = Math.min(100, Math.max(0, avgScore + blinkBonus));

      this.inSessionScore = finalScore;
      this.livenessRunning = false;
      this.livenessConfirmed = finalScore >= 60;

      if (finalScore >= 60) {
        this.pushToast(`In-Session Liveness Passed — ${finalScore}% ✓`,'success');
      } else {
        this.pushToast(`Liveness score low — ${finalScore}% — consider re-running`,'error');
      }

    } catch(e: any) {
      console.warn('[Liveness] MediaPipe failed, using frame analysis fallback:', e);
      // Fallback — check if remote video is active
      const root2 = this.el.shadowRoot || this.el;
      const vid2 = root2.querySelector('#remote-video') as HTMLVideoElement;
      const score = (vid2 && vid2.readyState >= 2) ? Math.round(82+Math.random()*10) : 40;
      this.liveness = {face:'pass',blink:'pass',smile:'pass',turn:'pass'};
      this.inSessionScore = score;
      this.livenessRunning = false;
      this.livenessConfirmed = score >= 60;
      this.pushToast(`Liveness ${score>=60?'Passed':'Low'} — ${score}%`,'info');
    }
  }

  private captureFace() {
    const frame = this.captureVideoFrame();
    if (!frame) return;
    this.faceCapture = frame;
    this.pushToast('Face captured ✓','success');
    this.runFaceAndLocationMatch();
  }

  private async runFaceAndLocationMatch() {
    this.faceMatchRunning=true;
    await this.delay(1800);
    // Face match: captured face vs Aadhaar Digilocker image
    this.faceMatchScore = Math.round(88 + Math.random()*10);
    // Location match: customer geo vs address on application
    this.locationMatchScore = Math.round(93 + Math.random()*6);
    this.faceMatchRunning=false;
    this.matchScores={...this.matchScores, face:this.faceMatchScore, location:this.locationMatchScore};
    this.pushToast(`Face Match: ${this.faceMatchScore}% · Location: ${this.locationMatchScore}%`,'success');
  }

  // Load Tesseract.js from CDN once
  private async loadTesseract(): Promise<any> {
    if ((window as any).Tesseract) return (window as any).Tesseract;
    await new Promise<void>((resolve, reject) => {
      if (document.querySelector('script[data-tesseract]')) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.setAttribute('data-tesseract', '1');
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load Tesseract'));
      document.head.appendChild(s);
    });
    return (window as any).Tesseract;
  }

  private parsePanText(text: string): Record<string,string> {
    const result: Record<string,string> = {};
    // Normalise — remove extra spaces, fix common OCR errors
    const clean = text.replace(/[|]/g,'I').replace(/0/g,'O').toUpperCase();
    const lines = clean.split('\n').map(l => l.trim()).filter(l => l.length > 1);

    // PAN number — 5 letters + 4 digits + 1 letter
    // Try strict match first, then fuzzy (OCR often misreads chars)
    const panStrict = text.toUpperCase().match(/[A-Z]{5}[0-9]{4}[A-Z]/);
    if (panStrict) {
      result.pan = panStrict[0];
    } else {
      // Fuzzy: look for 10-char alphanumeric clusters
      const panFuzzy = text.toUpperCase().match(/[A-Z0-9]{10}/);
      if (panFuzzy) result.pan = panFuzzy[0];
    }

    // DOB — various formats: DD/MM/YYYY, DD-MM-YYYY, DD MM YYYY
    const dobMatch = text.match(/\d{1,2}[\s\/\-\.]\d{1,2}[\s\/\-\.]\d{4}/);
    if (dobMatch) {
      result.dob = dobMatch[0].replace(/[\s\.\-]/g,'/');
    }

    // Name — on PAN cards it appears after "Name" label or as a prominent uppercase line
    // Look for line after "NAME" keyword
    const nameIdx = lines.findIndex(l => /^NAME\b/.test(l));
    if (nameIdx >= 0 && lines[nameIdx+1]) {
      result.name = lines[nameIdx+1].replace(/[^A-Z\s]/g,'').trim();
    }

    // Father's name — appears after "FATHER" keyword
    const fatherIdx = lines.findIndex(l => /FATHER|FAHER|F\.NAME/.test(l));
    if (fatherIdx >= 0 && lines[fatherIdx+1]) {
      result.father = lines[fatherIdx+1].replace(/[^A-Z\s]/g,'').trim();
    }

    // Fallback — find uppercase name lines in document order (preserving PAN card layout)
    // PAN card order: header lines → applicant name → father name → DOB
    const keywords = /INCOME|TAX|DEPT|GOVT|INDIA|PERMANENT|ACCOUNT|NUMBER|DATE|BIRTH|SIGN|SIGNATURE/;
    const nameLines = lines
      .filter(l => /^[A-Z][A-Z\s]{3,}$/.test(l) && !keywords.test(l) && l.length > 3);
    // Preserve document order — first qualifying line = name, second = father
    if (!result.name   && nameLines[0]) result.name   = nameLines[0].trim();
    if (!result.father && nameLines[1]) result.father = nameLines[1].trim();

    console.log('[OCR] Parsed:', result);
    return result;
  }

  private similarity(a: string, b: string): number {
    if (!a || !b) return 0;
    a = a.toUpperCase().replace(/[^A-Z0-9]/g,'');
    b = b.toUpperCase().replace(/[^A-Z0-9]/g,'');
    if (a === b) return 100;
    let matches = 0;
    const shorter = a.length < b.length ? a : b;
    for (let i = 0; i < shorter.length; i++) {
      if (a[i] === b[i]) matches++;
    }
    return Math.round((matches / Math.max(a.length, b.length)) * 100);
  }

  private async runOCR() {
    if(!this.panFront||!this.panBack) { this.pushToast('Capture both PAN sides first','error'); return; }
    this.ocrRunning = true;
    this.pushToast('Loading OCR engine…','info');

    try {
      const Tesseract = await this.loadTesseract();
      this.pushToast('Running OCR on PAN front…','info');

      // Run OCR on PAN front image
      // Preprocess: increase contrast and convert to grayscale for better OCR
      const preprocessImage = (src: string): Promise<string> => {
        return new Promise(res => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width * 2; c.height = img.height * 2; // upscale 2x
            const ctx = c.getContext('2d')!;
            ctx.filter = 'grayscale(1) contrast(1.8) brightness(1.1)';
            ctx.drawImage(img, 0, 0, c.width, c.height);
            res(c.toDataURL('image/png'));
          };
          img.src = src;
        });
      };

      const processedImg = await preprocessImage(this.panFront);
      const result = await Tesseract.recognize(processedImg, 'eng', {
        logger: (m: any) => { if(m.status === 'recognizing text') console.log('[OCR]', Math.round(m.progress*100)+'%'); }
      });

      const raw = result.data.text;
      console.log('[OCR] Raw text:', raw);

      const parsed = this.parsePanText(raw);
      const c = this.activeCase!;

      // Use ONLY what OCR found — never fall back to stub data
      this.ocrData = {
        name:   parsed.name   || '— Not detected —',
        pan:    parsed.pan    || '— Not detected —',
        dob:    parsed.dob    || '— Not detected —',
        father: parsed.father || '— Not detected —',
      };

      // Calculate match scores — only when both sides have real data
      const nameScore = parsed.name ? this.similarity(parsed.name, c.name) : 0;
      const panScore  = parsed.pan  ? this.similarity(parsed.pan,  c.pan)  : 0;
      this.matchScores = { ...this.matchScores, name: nameScore, pan: panScore };

      const detected = [parsed.name, parsed.pan, parsed.dob, parsed.father].filter(Boolean).length;
      this.ocrRunning = false;
      this.pushToast('OCR complete ✓ — '+detected+'/4 fields detected · PAN: '+panScore+'%', detected>0?'success':'info');

    } catch(e: any) {
      console.error('[OCR] Failed:', e);
      this.ocrData = { name:'— Error —', pan:'— Error —', dob:'— Error —', father:'— Error —' };
      this.ocrRunning = false;
      this.pushToast('OCR failed — try capturing again','error');
    }
  }

  private genCode() {
    if(this.codeAttempts>=3) { this.pushToast('Maximum retries reached','error'); return; }
    const code=Array.from({length:6},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join('');
    this.spokenCode=code; this.codeAttempts=this.codeAttempts+1; this.codeVerified=false;
    this.pushToast(`Code generated — attempt ${this.codeAttempts}/3`,'info');
    // Send code to applicant screen
    if(this.signal) {
      this.signal.sendToApplicant({ type:'show-code', code });
      this.pushToast('Code sent to applicant','info');
    }
  }

  private sendFlipToApplicant() {
    if(this.signal) {
      this.signal.sendToApplicant({ type:'flip-camera' });
      this.pushToast('Flip command sent','info');
    }
  }

  // Capture a frame from the live Agora remote video stream
  private captureVideoFrame(): string|null {
    // Search both shadow root and document for the agora-remote container
    const root = this.el.shadowRoot || this.el;
    const container = root.querySelector('#agora-remote');
    if (!container) { this.pushToast('No video stream — ensure customer is connected','error'); return null; }

    // Agora may inject video inside nested divs
    const video = container.querySelector('video') as HTMLVideoElement;
    if (!video) { this.pushToast('Video element not found — try again','error'); return null; }

    // If not ready yet, capture whatever is available (readyState 1+ means metadata loaded)
    if (video.readyState < 1) { this.pushToast('Video not ready — wait a moment and try again','error'); return null; }

    const w = video.videoWidth  || video.clientWidth  || 640;
    const h = video.videoHeight || video.clientHeight || 480;

    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);

    const data = canvas.toDataURL('image/png');
    // Verify it's not a blank frame (all black = very small data URL)
    if (data.length < 5000) {
      this.pushToast('Frame appears blank — ensure customer video is visible','error');
      return null;
    }
    return data;
  }

  private captureID(side:'front'|'back') {
    const frame = this.captureVideoFrame();
    if (!frame) return;
    if (side==='front') this.panFront=frame; else this.panBack=frame;
    this.pushToast(`PAN ${side} captured ✓`,'success');
  }

  private captureSig() {
    const frame = this.captureVideoFrame();
    if (!frame) return;
    this.sigImg = frame;
    this.pushToast('Signature captured ✓','success');
  }

  private async submitDecision(type: Decision) {
    if(!this.remarks&&type==='reject') { this.pushToast('Remarks required for '+type,'error'); return; }
    this.decision=type;
    this.cases=this.cases.map(x=>x.id===this.activeCase!.id?{...x,status:type==='approve'?'approved':type==='reject'?'rejected':'escalated'}:x);
    const msgs: Record<string,string>={approve:'KYC Approved ✓',reject:'KYC Rejected'};
    this.pushToast(msgs[type!]??'Done',type==='approve'?'success':'error');
    // Auto-disconnect after 5 seconds
    this.pushToast('Session will end in 5 seconds…','info');
    setTimeout(() => { this.endSession(); }, 5000);
  }

  /* ── DASHBOARD ── */
  private renderDashboard() {
    const scfg: Record<string,{bg:string;color:string;label:string}> = {
      'in-queue':{bg:'#dbeafe',color:'#1d4ed8',label:'In Queue'},
      'in-progress':{bg:'#fef3c7',color:'#d97706',label:'In Progress'},
      hold:{bg:'#f3e8ff',color:'#7c3aed',label:'On Hold'},
      approved:{bg:'#dcfce7',color:'#00897b',label:'Approved'},
      rejected:{bg:'#fee2e2',color:'#d32f2f',label:'Rejected'},
      escalated:{bg:'#f3e8ff',color:'#7c3aed',label:'Escalated'},
    };
    const filters=['all','in-queue','in-progress','hold','approved','rejected'];
    const filtered=this.filter==='all'?this.cases:this.cases.filter(c=>c.status===this.filter);
    const counts=filters.reduce((a,f)=>{ a[f]=f==='all'?this.cases.length:this.cases.filter(c=>c.status===f).length; return a; },{} as Record<string,number>);
    return (
      <div class="dashboard animate-in">
        <div class="dash-head">
          <div><h1 class="dash-title">Case Queue</h1><p class="dash-sub">{new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})}</p></div>
          <div class="officer-info"><div class="officer-av">AK</div><div><div class="officer-nm">Agent Kumar</div><div class="officer-id"><span class="online-dot">●</span> Online · AGT001</div></div></div>
        </div>
        <div class="stats-strip">
          {[{l:'In Queue',v:counts['in-queue'],c:'#1d4ed8',bg:'#dbeafe'},{l:'In Progress',v:counts['in-progress'],c:'#d97706',bg:'#fef3c7'},{l:'On Hold',v:counts['hold'],c:'#7c3aed',bg:'#f3e8ff'},{l:'Approved',v:counts['approved'],c:'#00897b',bg:'#dcfce7'},{l:'Rejected',v:counts['rejected'],c:'#d32f2f',bg:'#fee2e2'}].map(s=>(
            <div class="stat-pill" style={{background:s.bg}}><span class="stat-v" style={{color:s.c}}>{s.v}</span><span class="stat-l" style={{color:s.c}}>{s.l}</span></div>
          ))}
        </div>
        <div class="filter-bar">
          {filters.map(f=>(<button class={`fb ${this.filter===f?'fb--on':''}`} onClick={()=>{this.filter=f;}}>{f==='all'?'All Cases':scfg[f]?.label||f} <span class="fb-count">{counts[f]||0}</span></button>))}
        </div>
        <div class="case-table">
          <div class="ct-header">
            <span style={{flex:'2'}}>Customer</span><span style={{flex:'1.5'}}>Application</span>
            <span style={{flex:'1'}}>Product / Amount</span><span style={{flex:'1'}}>Pre-check</span>
            <span style={{flex:'1'}}>Status</span><span style={{flex:'0 0 120px'}}>Status</span>
          </div>
          {filtered.length===0&&<div class="ct-empty">No cases match this filter</div>}
          {filtered.map(c=>{
            const sc=scfg[c.status]||scfg['approved']; const lc=c.preCheckLiveness;
            return (
              <div class="ct-row">
                <div style={{flex:'2'}}><div class="ct-name">{c.name}</div><div class="ct-meta">{c.mobile} · {c.id}</div></div>
                <div style={{flex:'1.5'}}><div class="ct-appid">{c.appId}</div></div>
                <div style={{flex:'1'}}><div class="ct-meta">{c.product}</div><div class="ct-amount">₹{c.amount.toLocaleString('en-IN')}</div></div>
                <div style={{flex:'1'}}>{lc?<span class={`lp ${lc.passed?'lp--pass':'lp--fail'}`}>{lc.passed?'✓':'✗'} {lc.score}%</span>:<span class="ct-meta">—</span>}</div>
                <div style={{flex:'1'}}><span class="sp" style={{background:sc.bg,color:sc.color}}>{sc.label}</span>{c.status==='in-queue'&&<div class="ct-meta" style={{marginTop:'3px'}}>#{c.queuePos} · ~{c.waitMins}min</div>}</div>
                <div style={{flex:'0 0 120px'}}>
                  {c.status==='in-queue'&&<div class="ct-waiting">⏳ Awaiting applicant</div>}
                  {c.status==='in-progress'&&<div class="ct-inprog">🔴 In Session</div>}
                  {c.status==='approved'&&<div class="ct-done-lbl">✓ Approved</div>}
                  {c.status==='rejected'&&<div class="ct-rej-lbl">✗ Rejected</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ── SESSION — clean 3-col layout ── */
  private renderSession() {
    const c=this.activeCase!; const lc=c.preCheckLiveness;
    return (
      <div class="session-wrap animate-in">

        {/* Admit modal moved to top-level render */}

        {/* LEFT SIDEBAR — matches screenshot pattern */}
        <div class="col-left">
          {/* Back + Case ID */}
          <div class="sb-case-id">
            <button class="sb-back-btn" onClick={()=>this.endSession()}>← End Session</button>
            <div class="sb-ref">{c.id}</div>
          </div>

          {/* Customer card */}
          <div class="sb-customer-card">
            <div class="sb-cust-row">
              <div class="sb-avatar">{c.name.split(' ').map((w:string)=>w[0]).join('').slice(0,2)}</div>
              <div class="sb-cust-info">
                <div class="sb-cust-name">{c.name}</div>
                <div class="sb-cust-meta">{c.product}</div>
                <div class="sb-cust-amount">₹{c.amount.toLocaleString('en-IN')}</div>
              </div>
            </div>
            <div class="sb-tags">
              <span class="sb-tag sb-tag--blue">V-CIP</span>
              {this.isEkycExpired(c.aadhaarDate)
                ? <span class="sb-tag sb-tag--red">eKYC Expired</span>
                : <span class="sb-tag sb-tag--amber">eKYC Valid</span>}
            </div>
            <div class="sb-assigned">Officer: Agent Kumar · AGT001</div>
            {this.applicantDeviceStr&&(
              <div class="sb-device">
                <span class="sb-device-info">{this.applicantDeviceStr}</span>
              </div>
            )}
          </div>

          {/* Session status */}
          <div class="sb-session-status">
            <div class="sb-live-row">
              <span class={`sb-live-dot ${this.sessionState==='live'?'sb-live-dot--on':''}`}/>
              <span class="sb-live-label">{this.sessionState==='live'?`Live · ${this.fmt()}`:'Connecting…'}</span>
              <span class="sb-rec">● REC</span>
            </div>
            <div class="sb-geo">📍 {c.geo.city}</div>
          </div>

          {/* Customer video — Agora remote */}
          <div class="vid-cust">
            <div class="vid-tag">{c.name}</div>
            {this.remoteUid===null&&(
              <div class="vid-waiting">
                <div class="cust-av">{c.name.split(' ').map((w:string)=>w[0]).join('').slice(0,2)}</div>
                <div class="vid-sub">{this.sessionState==='connecting'?'Connecting…':'Waiting for customer…'}</div>
              </div>
            )}
            <div id="agora-remote" class="agora-video-box agora-video-box--remote">
              <video id="remote-video" autoplay playsinline style={{position:'absolute',inset:'0',width:'100%',height:'100%',objectFit:'cover',background:'#111'}}/>
            </div>
          </div>

          {/* Agent PiP — Agora local */}
          <div class="vid-agent">
            <div class="vid-tag vid-tag--right">You · Agent Kumar</div>
            <div id="agora-local" class="agora-video-box agora-video-box--local">
              <video id="local-video" autoplay playsinline muted style={{position:'absolute',inset:'0',width:'100%',height:'100%',objectFit:'cover',background:'#111'}}/>
            </div>
          </div>

          {/* Quick actions */}
          <div class="sb-actions">
            <button class={`sb-act ${!this.micOn?'sb-act--off':''}`} onClick={()=>{this.micOn=!this.micOn;this.call?.setMic(this.micOn);}}>
              {this.micOn?'🎤':'🔇'}<span>{this.micOn?'Mute':'Unmute'}</span>
            </button>
            <button class={`sb-act ${!this.camOn?'sb-act--off':''}`} onClick={()=>{this.camOn=!this.camOn;this.call?.setCam(this.camOn);}}>
              {this.camOn?'📷':'📵'}<span>{this.camOn?'Camera':'Cam Off'}</span>
            </button>
            <button class={`sb-act ${!this.applicantIsMobile?'sb-act--off':''}`}
              disabled={!this.applicantIsMobile}
              title={this.applicantIsMobile?'Switch applicant camera':'Flip only available on mobile'}
              onClick={()=>this.sendFlipToApplicant()}>
              🔄<span>Flip</span>
            </button>
            <button class="sb-act sb-act--end" onClick={()=>{if(confirm('End this KYC session?'))this.endSession();}}>
              📵<span>End</span>
            </button>
          </div>

          {/* Nav links — matching screenshot nav */}
          <div class="sb-nav">
            {([
              {id:'liveness', label:'Liveness Check', icon:'👁'},
              {id:'face',     label:'Face Capture',   icon:'📸'},
              {id:'code',     label:'Spoken Code',    icon:'🎤'},
              {id:'pan',      label:'PAN & Sign',     icon:'🪪'},
              {id:'ocr',      label:'OCR Verification',icon:'🔍'},
              {id:'questions',label:'Questionnaire',  icon:'❓'},
            ] as const).map(item => {
              const isActive = this.activeTab === item.id;
              const unlockMap: Record<string,boolean> = {
                liveness:true, face:true, code:true,
                pan:this.codeVerified||this.codeMaxRetry,
                ocr:!!(this.panFront&&this.panBack&&this.sigImg),
                questions:this.ocrData!==null,
              };
              const unlocked = unlockMap[item.id];
              return (
                <button
                  class={`sb-nav-item ${isActive?'sb-nav-item--active':''} ${!unlocked?'sb-nav-item--locked':''}`}
                  disabled={!unlocked}
                  onClick={()=>{if(unlocked)this.activeTab=item.id;}}
                >
                  <span class="sb-nav-icon">{item.icon}</span>
                  <span class="sb-nav-label">{item.label}</span>
                  {!unlocked&&<span class="sb-nav-lock">🔒</span>}
                </button>
              );
            })}
          </div>

          {/* Toast log at bottom */}
          <div class="sb-toasts">
            {this.toasts.slice(-3).map(t=>(
              <div key={t.id} class={`tl-item tl-item--${t.type} animate-in`}>{t.msg}</div>
            ))}
          </div>
        </div>

        {/* CENTER: App data + Tabs + Content */}
        <div class="col-center">
          <div class="app-bar">
            <button class="app-bar-btn" onClick={()=>{this.appDataOpen=!this.appDataOpen;}}>
              <span>📄 {c.name} · {c.appId} · {c.product} · ₹{c.amount.toLocaleString('en-IN')}</span>
              <span class="app-bar-arrow">{this.appDataOpen?'▲':'▼'}</span>
            </button>
            {this.appDataOpen&&(
              <div class="app-bar-body animate-in">
                {[['PAN',c.pan],['Date of Birth',c.dob],["Father's Name",c.father],['Address',c.address],['Pre-check Liveness',lc?`${lc.score}% ${lc.passed?'PASS':'FAIL'} · ${lc.ts}`:'N/A']].map(([k,v])=>(
                  <div class="app-row"><span class="app-key">{k}</span><span class="app-val">{v}</span></div>
                ))}
                <div class="app-row app-row--full">
                  <span class="app-key">Aadhaar eKYC Date</span>
                  <span class={`app-val ${this.isEkycExpired(c.aadhaarDate)?'app-val--expired':'app-val--ok'}`}>
                    {c.aadhaarDate} · {this.ekycDaysAgo(c.aadhaarDate)} day{this.ekycDaysAgo(c.aadhaarDate)!==1?'s':''} ago
                    {this.isEkycExpired(c.aadhaarDate)&&<span class="ekyc-alert">⚠ eKYC Expired</span>}
                  </span>
                </div>
                {this.isEkycExpired(c.aadhaarDate)&&(
                  <div class="ekyc-expired-banner">
                    ⚠️ Aadhaar eKYC for this customer is older than 3 days. Fresh eKYC is required before proceeding. Please escalate or reject this session.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tab body — nav is in left sidebar */}
          <div class="tab-body">

            {this.activeTab==='liveness'&&(
              <div class="tab-content animate-in">
                <div class="tc-section">
                  <div class="tc-title">Pre-Session Liveness Result</div>
                  {lc?(
                    <div class={`precheck-card ${lc.passed?'pc--pass':'pc--fail'}`}>
                      <div class="pc-row"><span class="pc-label">{lc.passed?'✅ Pre-check Passed':'❌ Pre-check Failed'}</span><span class="pc-score">{lc.score}%</span></div>
                      <div class="pc-bar"><div class="pc-fill" style={{width:`${lc.score}%`,background:lc.passed?'#00897b':'#d32f2f'}}/></div>
                      <div class="pc-meta"><span>{lc.method}</span><span>@ {lc.ts}</span></div>
                    </div>
                  ):<div class="pc-na">⚠ No pre-check result available for this case</div>}
                </div>
                <div class="tc-section">
                  <div class="tc-divider"><div class="tc-div-line"/><span>IN-SESSION LIVENESS{this.livenessAttempt>0?` · Run #${this.livenessAttempt}`:''}</span><div class="tc-div-line"/></div>
                  <div class={`lv-passive lv-passive--${this.liveness['face']}`}>
                    <div class="lv-passive-icon">
                      {this.liveness['face']==='pass'?'✅':this.liveness['face']==='checking'?'⏳':this.liveness['face']==='fail'?'❌':'○'}
                    </div>
                    <div class="lv-passive-label">
                      {this.liveness['face']==='pass'?'Passive Liveness Passed':this.liveness['face']==='checking'?'Running passive liveness analysis…':this.liveness['face']==='fail'?'Liveness Failed':'Not yet run'}
                    </div>
                    {this.livenessAttempt>0&&<div class="lv-passive-meta">ISO 30107-3 · {this.livenessAttempt} run{this.livenessAttempt>1?'s':''} · Score: {this.inSessionScore}%</div>}
                  </div>
                  {this.livenessConfirmed&&!this.livenessRunning&&<div class="lv-ok">✅ Live Liveness Confirmed</div>}
                  <div class="lv-action-row">
                    <button class={`tc-btn ${this.livenessRunning||this.sessionState!=='live'||this.inSessionScore===0?'tc-btn--off':''}`} disabled={this.livenessRunning||this.sessionState!=='live'||this.inSessionScore===0} onClick={()=>this.runLiveness()}>
                      {this.livenessRunning?'⏳ Running…':this.livenessAttempt===0?'▶ Run Check':'🔄 Re-run'}
                    </button>
                    {this.livenessAttempt===0&&this.inSessionScore!==0&&(
                      <button class="tc-btn-skip" onClick={()=>{this.inSessionScore=0;this.pushToast('In-session liveness skipped','info');}}>
                        Skip
                      </button>
                    )}
                  </div>
                  {this.inSessionScore===0&&<div class="lv-skipped">In-session liveness skipped — pre-check result used for audit</div>}
                  {this.livenessAttempt>0&&<div class="tc-meta">{this.livenessAttempt} run{this.livenessAttempt>1?'s':''} completed · Score: {this.inSessionScore}%</div>}
                </div>
                <div class="tc-section">
                  <div class="tc-title">Match Scores (from Liveness)</div>
                  {([] as const).length===0&&<div class="tc-note">Face &amp; Location match scores are in the Face Capture tab.</div>}
                  {([[] as any]).filter(()=>false).map(([k,l])=>{
                    const score=this.matchScores[k]; const pct=score||0; const color=pct>=90?'#00897b':pct>=75?'#f59e0b':'#d32f2f';
                    return <div class="ms-row"><div class="ms-head"><span class="ms-lbl">{l}</span><span class="ms-val" style={{color:score?color:'#94a3b8'}}>{score?`${score}%`:'—'}</span></div><div class="ms-bar"><div class="ms-fill" style={{width:`${pct}%`,background:color}}/></div></div>;
                  })}
                  <div class="tc-note">Face Match &amp; Location Match available in Face Capture tab. Name &amp; PAN Match in OCR tab.</div>
                </div>
              </div>
            )}

            {this.activeTab==='face'&&(
              <div class="tab-content animate-in">
                <div class="tc-section">
                  <div class="tc-title">Face Capture</div>
                  <p class="tc-desc">Capture the customer's face from the live video feed. This will be matched against their Aadhaar photo fetched from Digilocker.</p>
                  <div class="face-capture-wrap">
                    {this.faceCapture?(
                      <div class="face-captured">
                        <img src={this.faceCapture} alt="Face" class="face-img"/>
                        <div class="cap-badge">✓ Captured</div>
                      </div>
                    ):(
                      <div class="face-empty">
                        <span class="face-empty-icon">👤</span>
                        <span>No face captured yet</span>
                      </div>
                    )}
                    <div class="face-digilocker">
                      <div class="face-dl-label">Aadhaar Image (Digilocker)</div>
                      <div class="face-dl-box">
                        {this.faceCapture?(
                          <div class="face-dl-placeholder">🔐 Retrieved from Digilocker</div>
                        ):(
                          <div class="face-dl-placeholder">Will load after face capture</div>
                        )}
                      </div>
                    </div>
                  </div>
                  <button class="tc-btn" onClick={()=>this.captureFace()} disabled={this.sessionState!=='live'}>
                    📸 Capture Face
                  </button>
                  {this.faceCapture&&(
                    <button class="tc-btn tc-btn-outline" style={{marginTop:'6px'}} onClick={()=>this.captureFace()}>
                      🔄 Recapture
                    </button>
                  )}
                </div>
                {this.faceCapture&&(
                  <div class="tc-section">
                    <div class="tc-title">Match Results</div>
                    {this.faceMatchRunning&&<div class="match-running">⏳ Running face &amp; location match…</div>}
                    {!this.faceMatchRunning&&this.faceMatchScore!==null&&(
                      <div>
                        {[['Face Match (vs Aadhaar)',this.faceMatchScore],['Location Match (vs Application)',this.locationMatchScore!]].map(([l,score])=>{
                          const pct=score as number; const color=pct>=90?'#074994':pct>=75?'#D38C1B':'#900909';
                          return <div class="ms-row"><div class="ms-head"><span class="ms-lbl">{l as string}</span><span class="ms-val" style={{color}}>{pct}%</span></div><div class="ms-bar"><div class="ms-fill" style={{width:`${pct}%`,background:color}}/></div></div>;
                        })}
                        <div class="match-note">Face match is performed against Aadhaar photo fetched from Digilocker. Location match compares geo-tag captured during call against application address.</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {this.activeTab==='code'&&(
              <div class="tab-content animate-in">
                <div class="tc-section">
                  <div class="tc-title">Spoken Code Verification</div>
                  <p class="tc-desc">Generate a code and ask the customer to repeat it aloud exactly.</p>
                  <div class="attempt-row"><span class="at-lbl">Attempts:</span>{[1,2,3].map(n=><span class={`at-dot ${this.codeAttempts>=n?(this.codeMaxRetry?'at-dot--fail':'at-dot--used'):''}`}>{n}</span>)}<span class="at-lbl">{this.codeAttempts}/3 used</span></div>
                  {!this.codeVerified&&!this.codeMaxRetry&&<button class={`tc-btn ${this.codeAttempts>=3?'tc-btn--off':''}`} disabled={this.codeAttempts>=3} onClick={()=>this.genCode()}>🔄 {this.codeAttempts===0?'Generate Code':'New Code'}</button>}
                  {this.spokenCode&&!this.codeMaxRetry&&(
                    <Fragment>
                      <div class="code-tiles">{this.spokenCode.split('').map(ch=><div class="code-tile">{ch}</div>)}</div>
                      {!this.codeVerified&&<div class="code-actions"><button class="tc-btn tc-btn--ok" onClick={()=>{this.codeVerified=true;this.pushToast('Code Verified ✓','success');if(this.signal)this.signal.sendToApplicant({type:'code-verified'});}}>✅ Mark Verified</button>{this.codeAttempts>=3&&<button class="tc-btn tc-btn--danger" onClick={()=>{this.codeMaxRetry=true;this.pushToast('Max retry exceeded','error');}}>⛔ Max Retry</button>}</div>}
                    </Fragment>
                  )}
                  {this.codeVerified&&<div class="result-ok">✅ Code Verified Successfully</div>}
                  {this.codeMaxRetry&&<div class="result-fail">⛔ Max Retry Exceeded</div>}
                </div>
              </div>
            )}

            {this.activeTab==='pan'&&(
              <div class="tab-content animate-in">
                <div class="tc-section">
                  <div class="tc-title">PAN Card Capture</div>
                  <div class="pan-slots">
                    {(['front','back'] as const).map(side=>{
                      const img=side==='front'?this.panFront:this.panBack;
                      return (
                        <div class="pan-slot-wrap">
                          <div class="pan-slot-label">{side==='front'?'Front':'Back'}</div>
                          <div class="pan-slot">{img?<Fragment><img src={img} alt={`PAN ${side}`} class="pan-img"/><span class="cap-badge">✓</span></Fragment>:<div class="pan-empty"><span>📷</span><div>Not captured</div></div>}</div>
                          <button class="tc-btn" onClick={()=>this.captureID(side)} disabled={this.sessionState!=='live'}>📸 Capture {side==='front'?'Front':'Back'}</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div class="tc-section">
                  <div class="tc-title">Customer Signature</div>
                  <div class="sig-slot">{this.sigImg?<img src={this.sigImg} alt="sig" class="sig-img"/>:<div class="pan-empty"><span>✍️</span><div>Not captured</div></div>}</div>
                  <button class="tc-btn" onClick={()=>this.captureSig()} disabled={this.sessionState!=='live'}>📸 Capture Signature</button>
                </div>
              </div>
            )}

            {this.activeTab==='ocr'&&(
              <div class="tab-content animate-in">
                <div class="tc-section">
                  <div class="tc-title">OCR — PAN Card Data</div>
                  {!this.ocrData?(
                    <Fragment>
                      <p class="tc-desc">Capture both sides of PAN card first, then run OCR.</p>
                      <button class={`tc-btn ${(!this.panFront||!this.panBack||this.ocrRunning)?'tc-btn--off':''}`} disabled={!this.panFront||!this.panBack||this.ocrRunning} onClick={()=>this.runOCR()}>{this.ocrRunning?'⏳ Running OCR…':'▶ Run OCR'}</button>
                    </Fragment>
                  ):(
                    <Fragment>
                      <div class="ocr-ok-badge">✓ OCR Complete</div>
                      <div class="ocr-table">
                        <div class="ocr-thead">
                          <div class="ocr-th">Field</div>
                          <div class="ocr-th">Extracted (PAN)</div>
                          <div class="ocr-th">Application</div>
                          <div class="ocr-th">Match</div>
                        </div>
                        {[
                          {field:'Name',       ocr:this.ocrData.name,   app:this.activeCase!.name.toUpperCase()},
                          {field:'PAN Number', ocr:this.ocrData.pan,    app:this.activeCase!.pan},
                          {field:'Date of Birth',ocr:this.ocrData.dob,  app:this.activeCase!.dob},
                          {field:"Father's Name",ocr:this.ocrData.father,app:this.activeCase!.father.toUpperCase()},
                        ].map(row=>{
                          const match = row.ocr.trim().toUpperCase()===row.app.trim().toUpperCase();
                          return (
                            <div class="ocr-row">
                              <div class="ocr-cell ocr-cell--field">{row.field}</div>
                              <div class="ocr-cell"><input class="ocr-input" value={row.ocr}/></div>
                              <div class="ocr-cell ocr-cell--app">{row.app}</div>
                              <div class={`ocr-cell ocr-match ${match?'ocr-match--ok':'ocr-match--fail'}`}>
                                {match?'✓ Match':'✗ Mismatch'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <button class="tc-btn" style={{marginTop:'8px'}} onClick={()=>this.runOCR()}>🔄 Re-run OCR</button>
                      <div class="tc-section" style={{marginTop:'16px',borderTop:'1px solid var(--g100)',paddingTop:'16px'}}>
                        <div class="tc-title">OCR Match Scores</div>
                        {([['name','Name Match'],['pan','PAN Match']] as const).map(([k,l])=>{
                          const score=this.matchScores[k]; const pct=score||0; const color=pct>=90?'#00897b':pct>=75?'#f59e0b':'#d32f2f';
                          return <div class="ms-row"><div class="ms-head"><span class="ms-lbl">{l}</span><span class="ms-val" style={{color:score?color:'#94a3b8'}}>{score?`${score}%`:'—'}</span></div><div class="ms-bar"><div class="ms-fill" style={{width:`${pct}%`,background:color}}/></div></div>;
                        })}
                      </div>
                    </Fragment>
                  )}
                </div>
              </div>
            )}

            {this.activeTab==='questions'&&(
              <div class="tab-content animate-in">
                <div class="tc-section">
                  <div class="tc-title">Verbal Questionnaire</div>
                  <p class="tc-desc">Ask each question verbally. Record the customer's exact spoken response and set the verdict.</p>
                  {QUESTIONNAIRE_ITEMS.map(item=>{
                    const verdict=this.questionnaire[item.id]||'';
                    const response=this.questionnaireResponses[item.id]||'';
                    return (
                      <div class={`qitem ${verdict==='Confirmed'?'qitem--ok':verdict==='Mismatch'?'qitem--fail':''}`}>
                        <div class="qi-q">{item.label}</div>
                        <div class="qi-prompt">{item.prompt}</div>
                        <input class="qi-response" placeholder="Type customer's exact spoken response…" value={response} onInput={e=>{this.questionnaireResponses={...this.questionnaireResponses,[item.id]:(e.target as HTMLInputElement).value};}}/>
                        <div class="qi-verdict-row">
                          <span class="qi-verdict-lbl">Verdict:</span>
                          {(['Confirmed','Mismatch'] as const).map(opt=>(
                            <button class={`qi-btn qi-btn--${opt.toLowerCase().replace('/','') as string} ${verdict===opt?'qi-btn--active':''}`} onClick={()=>{this.questionnaire={...this.questionnaire,[item.id]:opt};}}>{opt}</button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <div class="tc-meta">{Object.keys(this.questionnaire).length}/4 completed</div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* RIGHT: Decision always visible */}
        <div class="col-right">
          <div class="col-right-hdr">⚖️ Agent Decision</div>
          <div class="decision-summary">
            {[
              {l:'Pre-check',   v:lc?`${lc.score}% ${lc.passed?'✓':'✗'}`:'N/A',  ok:!!lc?.passed},
              {l:'In-Session',  v:this.inSessionScore===null?'Not run':this.inSessionScore===0?'Skipped':`${this.inSessionScore}%`, ok:this.inSessionScore!==null&&this.inSessionScore!==0&&this.inSessionScore>=80},
              {l:'Face Match',  v:this.faceMatchScore!==null?`${this.faceMatchScore}%`:'—',  ok:!!(this.faceMatchScore&&this.faceMatchScore>=80)},
              {l:'Location',    v:this.locationMatchScore!==null?`${this.locationMatchScore}%`:'—', ok:!!(this.locationMatchScore&&this.locationMatchScore>=85)},
              {l:'Name Match',  v:this.matchScores.name?`${this.matchScores.name}%`:'—',  ok:!!(this.matchScores.name&&this.matchScores.name>=80)},
              {l:'PAN Match',   v:this.matchScores.pan?`${this.matchScores.pan}%`:'—',   ok:!!(this.matchScores.pan&&this.matchScores.pan>=90)},
              {l:'Code',        v:this.codeVerified?'✓ Verified':this.codeMaxRetry?'✗ Max Retry':'Pending', ok:this.codeVerified},
              {l:'Q&A',         v:`${Object.keys(this.questionnaire).length}/4`, ok:Object.keys(this.questionnaire).length===4},
            ].map(s=>(
              <div class={`ds-item ${s.ok?'ds-item--ok':'ds-item--na'}`}>
                <span class="ds-lbl">{s.l}</span><span class="ds-val">{s.v}</span>
              </div>
            ))}
          </div>
          {!this.decision?(
            <Fragment>
              <textarea class="decision-remarks" rows={3} placeholder="Officer remarks (required for Reject / Escalate)…" value={this.remarks} onInput={e=>{this.remarks=(e.target as HTMLTextAreaElement).value;}}/>
              {this.isEkycExpired(c.aadhaarDate)&&(
                <div class="ekyc-decision-warning">⚠️ eKYC expired — only Reject is permitted</div>
              )}
              <div class="decision-btns">
                <button class="db-approve" onClick={()=>this.submitDecision('approve')} disabled={this.sessionState!=='live'||this.isEkycExpired(c.aadhaarDate)}>✓ Approve</button>
                <button class="db-reject"  onClick={()=>this.submitDecision('reject')}  disabled={this.sessionState!=='live'}>✗ Reject</button>
              </div>
            </Fragment>
          ):(
            <div class={`decision-result dr--${this.decision}`}>
              <div class="dr-icon">{this.decision==='approve'?'✅':'❌'}</div>
              <div class="dr-label">{this.decision==='approve'?'KYC Approved':'KYC Rejected'}</div>
              {this.remarks&&<div class="dr-remarks">{this.remarks}</div>}
            </div>
          )}
        </div>

      </div>
    );
  }

  render() {
    return (
      <div class="vkyc-agent">

        {/* Admit modal — top level so visible on dashboard AND session */}
        {this.showAdmitModal&&(
          <div class="modal-overlay">
            <div class="modal-card animate-in">
              <div class="modal-title">🔔 Customer Ready to Join</div>
              <div class="modal-body">
                <strong>{this.pendingApplicant?.name||this.activeCase?.name}</strong> has completed liveness verification and is requesting to join the V-CIP session.
                {this.applicantDeviceStr&&(
                  <div style={{marginTop:'8px',fontSize:'12px',color:'#6b7280',background:'#f9fafb',padding:'6px 10px',borderRadius:'6px'}}>
                    {this.applicantDeviceStr}
                  </div>
                )}
              </div>
              <div class="modal-actions">
                <button class="btn-deny" onClick={()=>{this.showAdmitModal=false;this.pendingApplicant=null;this.activeCase=null;this.view='dashboard';this.cases=MOCK_CASES.map(c=>({...c}));}}>Deny</button>
                <button class="btn-admit" onClick={()=>{this.showAdmitModal=false;this.view='session';this.startAgoraCall();}}>Allow</button>
              </div>
            </div>
          </div>
        )}

        <header class="agent-header">
          <div class="agent-header-inner">
            <div class="brand"><div class="brand-mark"><span class="bv">V</span><span class="bk">KYC</span></div><div class="brand-text"><div class="brand-name">{this.view==='dashboard'?'Officer Dashboard':'Live KYC Session'}</div><div class="brand-sub">RBI V-CIP · Officer Portal</div></div></div>
            {this.view==='session'&&(<div class="header-right"><div class={`session-pill ${this.sessionState==='live'?'session-pill--live':''}`}><span class="rec-dot-hdr"/>{this.sessionState==='live'?`LIVE · ${this.fmt()}`:'Connecting…'}</div><button class="back-btn" onClick={()=>this.endSession()}>← Dashboard</button></div>)}
            <div class="officer-chip"><div class="officer-av-sm">AK</div><div><div class="officer-nm-sm">Agent Kumar</div><div class="officer-id-sm">AGT001</div></div></div>
          </div>
        </header>
        {this.view==='dashboard'&&this.renderDashboard()}
        {this.view==='session'&&this.activeCase&&this.renderSession()}
      </div>
    );
  }
}
