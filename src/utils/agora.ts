// src/utils/agora.ts
// Agora RTC for video/audio
// Signalling via BroadcastChannel (same device) + API long-poll (cross device)

const APP_ID = '15d6681ab3b049ad91ecc585cc645551';

let _AgoraRTC: any = null;

async function getAgoraRTC(): Promise<any> {
  if (_AgoraRTC) return _AgoraRTC;
  await new Promise<void>((resolve, reject) => {
    if (document.querySelector('script[data-agora-rtc]')) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://download.agora.io/sdk/release/AgoraRTC_N-4.20.0.js';
    s.setAttribute('data-agora-rtc', '1');
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Agora RTC SDK'));
    document.head.appendChild(s);
  });
  _AgoraRTC = (window as any).AgoraRTC;
  _AgoraRTC.setLogLevel(3);
  return _AgoraRTC;
}

// ── Signal: BroadcastChannel (same device) + sessionStorage flag ──────────────
// Works instantly on same device across tabs/windows.
// For cross-device: applicant writes signal to sessionStorage key via API,
// agent polls the API every 2s.
const SIGNAL_CHANNEL       = 'vkyc-signal';        // applicant → agent
const SIGNAL_AGENT_CHANNEL = 'vkyc-agent-signal';  // agent → applicant
const API_BASE = () => (window as any).__VKYC_API__ || 'http://localhost:3001/api/v1';

export class VkycSignal {
  private bc: BroadcastChannel | null = null;
  private bcAgent: BroadcastChannel | null = null; // listens for agent→applicant
  private pollTimer: any = null;
  onMessage: (data: any) => void = () => {};
  onAgentMessage: (data: any) => void = () => {}; // applicant listens to agent commands

  // Applicant: send signal via BroadcastChannel + API
  async send(data: object): Promise<void> {
    console.log('[Signal] Sending:', data);
    // 1. BroadcastChannel — works instantly on same device
    try {
      const bc = new BroadcastChannel(SIGNAL_CHANNEL);
      bc.postMessage(data);
      bc.close();
      console.log('[Signal] BroadcastChannel sent');
    } catch(e) { console.warn('[Signal] BroadcastChannel failed:', e); }

    // 2. Store in sessionStorage for same-browser fallback
    try {
      sessionStorage.setItem('vkyc_signal', JSON.stringify({...data, ts: Date.now()}));
      console.log('[Signal] sessionStorage written');
    } catch(e) {}

    // 3. POST to API for cross-device signalling
    try {
      await fetch(API_BASE() + '/signal', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(data)
      });
      console.log('[Signal] API signal posted');
    } catch(e) { console.warn('[Signal] API post failed (expected if API not running):', e); }
  }

  // Agent: listen via BroadcastChannel + poll API
  startListening(): void {
    console.log('[Signal] Agent starting to listen…');

    // BroadcastChannel — instant for same device
    try {
      this.bc = new BroadcastChannel(SIGNAL_CHANNEL);
      this.bc.onmessage = (evt) => {
        console.log('[Signal] BroadcastChannel received:', evt.data);
        this.onMessage(evt.data);
      };
      console.log('[Signal] BroadcastChannel listener active');
    } catch(e) { console.warn('[Signal] BroadcastChannel not available:', e); }

    // Poll API every 2s for cross-device
    this.pollTimer = setInterval(async () => {
      try {
        const res = await fetch(API_BASE() + '/signal');
        if (!res.ok) return;
        const data = await res.json();
        if (data?.type === 'applicant-ready') {
          console.log('[Signal] API poll received:', data);
          this.onMessage(data);
          // Clear after receiving so it doesn't fire again
          await fetch(API_BASE() + '/signal', { method: 'DELETE' });
        }
      } catch(e) {} // API may not be running — silent fail
    }, 2000);
  }

  // Agent → Applicant: send command (code, flip, etc.)
  sendToApplicant(data: object): void {
    console.log('[Signal] Agent→Applicant:', data);
    try {
      const bc = new BroadcastChannel(SIGNAL_AGENT_CHANNEL);
      bc.postMessage(data);
      bc.close();
    } catch(e) { console.warn('[Signal] Agent→Applicant BC failed:', e); }
    // Also post to API for cross-device
    fetch(API_BASE() + '/agent-signal', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(data)
    }).catch(()=>{});
  }

  // Applicant: listen for agent commands
  listenForAgent(): void {
    // BroadcastChannel for same device
    try {
      this.bcAgent = new BroadcastChannel(SIGNAL_AGENT_CHANNEL);
      this.bcAgent.onmessage = (evt) => {
        console.log('[Signal] Agent command received:', evt.data);
        this.onAgentMessage(evt.data);
      };
    } catch(e) {}

    // Poll API every 1.5s for new agent commands using queue pattern
    let lastCmdId = 0;
    setInterval(async () => {
      try {
        const res = await fetch(API_BASE() + '/agent-signal?after=' + lastCmdId);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.commands?.length) {
          for (const cmd of data.commands) {
            if (cmd.id > lastCmdId) {
              lastCmdId = cmd.id;
              console.log('[Signal] Agent command from API:', cmd);
              this.onAgentMessage(cmd);
            }
          }
        }
      } catch(e) {}
    }, 1500);
  }

  stop(): void {
    this.bc?.close(); this.bc = null;
    this.bcAgent?.close(); this.bcAgent = null;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }
}

// ── RTC Video call ─────────────────────────────────────────────────────────────
export class VkycCall {
  private client: any = null;
  private localAudioTrack: any = null;
  private localVideoTrack: any = null;
  public remoteUsers: Map<any, { video: any; audio: any }> = new Map();

  onRemoteJoined:  (uid: any, videoTrack: any, audioTrack: any) => void = () => {};
  onRemoteLeft:    (uid: any) => void = () => {};
  onError:         (msg: string) => void = () => {};

  async join(channelName: string, uid: number): Promise<void> {
    const AgoraRTC = await getAgoraRTC();
    this.client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

    this.client.on('user-published', async (user: any, mediaType: string) => {
      await this.client.subscribe(user, mediaType);
      if (!this.remoteUsers.has(user.uid)) {
        this.remoteUsers.set(user.uid, { video: null, audio: null });
      }
      const entry = this.remoteUsers.get(user.uid)!;
      if (mediaType === 'video') { entry.video = user.videoTrack; }
      if (mediaType === 'audio') { entry.audio = user.audioTrack; user.audioTrack.play(); }
      this.onRemoteJoined(user.uid, entry.video, entry.audio);
    });

    this.client.on('user-unpublished', (user: any) => {
      this.remoteUsers.delete(user.uid);
      this.onRemoteLeft(user.uid);
    });
    this.client.on('user-left', (user: any) => {
      this.remoteUsers.delete(user.uid);
      this.onRemoteLeft(user.uid);
    });

    await this.client.join(APP_ID, channelName, null, uid);
    [this.localAudioTrack, this.localVideoTrack] =
      await AgoraRTC.createMicrophoneAndCameraTracks();
    await this.client.publish([this.localAudioTrack, this.localVideoTrack]);
  }

  playLocal(el: HTMLElement): void {
    if (this.localVideoTrack) this.localVideoTrack.play(el);
  }

  async setMic(enabled: boolean): Promise<void> {
    if (this.localAudioTrack) await this.localAudioTrack.setEnabled(enabled);
  }

  async setCam(enabled: boolean): Promise<void> {
    if (this.localVideoTrack) await this.localVideoTrack.setEnabled(enabled);
  }

  async leave(): Promise<void> {
    this.localAudioTrack?.stop(); this.localAudioTrack?.close();
    this.localVideoTrack?.stop(); this.localVideoTrack?.close();
    this.remoteUsers.clear();
    if (this.client) await this.client.leave();
    this.client = null;
  }
}
