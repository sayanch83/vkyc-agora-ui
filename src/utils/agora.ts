// src/utils/agora.ts
// Agora RTC for video/audio call
// Signalling: BroadcastChannel (same device) + API polling (cross device)

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

const SIGNAL_CHANNEL       = 'vkyc-signal';        // applicant → agent
const SIGNAL_AGENT_CHANNEL = 'vkyc-agent-signal';  // agent → applicant
const API_BASE = () => (window as any).__VKYC_API__ || 'http://localhost:3001/api/v1';

// ── Signal ────────────────────────────────────────────────────────────────────
export class VkycSignal {
  private bc: BroadcastChannel | null = null;
  private bcAgent: BroadcastChannel | null = null;
  private pollTimer: any = null;
  private agentPollTimer: any = null;
  onMessage: (data: any) => void = () => {};
  onAgentMessage: (data: any) => void = () => {};

  // Applicant → Agent signal
  async send(data: object): Promise<void> {
    console.log('[Signal] Sending to agent:', data);
    try {
      const bc = new BroadcastChannel(SIGNAL_CHANNEL);
      bc.postMessage(data);
      bc.close();
      console.log('[Signal] BroadcastChannel sent');
    } catch(e) { console.warn('[Signal] BC send failed:', e); }

    try {
      sessionStorage.setItem('vkyc_signal', JSON.stringify({...data, ts: Date.now()}));
    } catch(e) {}

    try {
      await fetch(API_BASE() + '/signal', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(data)
      });
      console.log('[Signal] API posted');
    } catch(e) { console.warn('[Signal] API post failed:', e); }
  }

  // Agent listens for applicant-ready signal
  startListening(): void {
    console.log('[Signal] Agent starting BroadcastChannel listener');
    try {
      this.bc = new BroadcastChannel(SIGNAL_CHANNEL);
      this.bc.onmessage = (evt) => {
        console.log('[Signal] BC received:', evt.data);
        this.onMessage(evt.data);
      };
    } catch(e) { console.warn('[Signal] BC not available:', e); }

    let lastTs = 0;
    this.pollTimer = setInterval(async () => {
      try {
        const res = await fetch(API_BASE() + '/signal');
        if (!res.ok) return;
        const data = await res.json();
        if (data?.type === 'applicant-ready' && data.ts !== lastTs) {
          lastTs = data.ts || Date.now();
          console.log('[Signal] API poll received:', data);
          this.onMessage(data);
        }
      } catch(e) {}
    }, 2000);
  }

  // Agent → Applicant: send command
  sendToApplicant(data: object): void {
    console.log('[Signal] Agent→Applicant BC:', data);
    try {
      const bc = new BroadcastChannel(SIGNAL_AGENT_CHANNEL);
      bc.postMessage(data);
      bc.close();
    } catch(e) {}

    fetch(API_BASE() + '/agent-signal', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(data)
    }).catch(()=>{});
  }

  // Applicant listens for agent commands
  listenForAgent(): void {
    console.log('[Signal] Applicant starting agent command listener');
    try {
      this.bcAgent = new BroadcastChannel(SIGNAL_AGENT_CHANNEL);
      this.bcAgent.onmessage = (evt) => {
        console.log('[Signal] Agent command via BC:', evt.data);
        this.onAgentMessage(evt.data);
      };
      console.log('[Signal] Agent BC listener active on:', SIGNAL_AGENT_CHANNEL);
    } catch(e) { console.warn('[Signal] Agent BC failed:', e); }

    let lastCmdId = 0;
    this.agentPollTimer = setInterval(async () => {
      try {
        const res = await fetch(API_BASE() + '/agent-signal?after=' + lastCmdId);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.commands?.length) {
          for (const cmd of data.commands) {
            if (cmd.id > lastCmdId) {
              lastCmdId = cmd.id;
              console.log('[Signal] Agent command via API:', cmd);
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
    if (this.agentPollTimer) { clearInterval(this.agentPollTimer); this.agentPollTimer = null; }
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
      if (mediaType === 'audio') {
        entry.audio = user.audioTrack;
        user.audioTrack.play();
      }
      if (mediaType === 'video') {
        entry.video = user.videoTrack;
        // Only fire callback when we have a video track
        this.onRemoteJoined(user.uid, entry.video, entry.audio);
      }
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

  // Play video track natively using a <video> element we control
  private playTrackInElement(track: any, container: HTMLElement, label: string): void {
    try {
      // Get the raw MediaStreamTrack from Agora
      const mediaTrack: MediaStreamTrack = track.getMediaStreamTrack();
      const stream = new MediaStream([mediaTrack]);

      // Find or create a <video> element inside the container
      let vid = container.querySelector('video') as HTMLVideoElement;
      if (!vid) {
        vid = document.createElement('video');
        vid.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;background:#000;';
        vid.autoplay = true;
        vid.muted = true; // local: mute to avoid echo; remote: we handle audio separately
        vid.playsInline = true;
        container.appendChild(vid);
      }
      vid.srcObject = stream;
      vid.play().catch(e => console.warn('[RTC] vid.play failed:', e));
      console.log('[RTC]', label, 'playing natively');
    } catch(e) {
      // Fallback to Agora play if native fails
      console.warn('[RTC] Native play failed, falling back to Agora:', e);
      try { track.play(container); } catch(e2) {}
    }
  }

  // Play local video — retry until element exists in DOM
  async playLocalWhenReady(getEl: () => HTMLElement | null, retries = 40): Promise<void> {
    for (let i = 0; i < retries; i++) {
      const el = getEl();
      if (el && this.localVideoTrack) {
        this.playTrackInElement(this.localVideoTrack, el, 'Local');
        return;
      }
      await new Promise(r => setTimeout(r, 200));
    }
    console.warn('[RTC] Could not find local video element after retries');
  }

  // Play remote video — retry until element exists and track is set
  async playRemoteWhenReady(uid: any, getEl: () => HTMLElement | null, retries = 40): Promise<void> {
    for (let i = 0; i < retries; i++) {
      const el = getEl();
      const entry = this.remoteUsers.get(uid);
      if (el && entry?.video) {
        // Remote audio is already playing via audioTrack.play() in user-published
        // For video, use native approach - unmuted since it's remote
        try {
          const mediaTrack: MediaStreamTrack = entry.video.getMediaStreamTrack();
          const stream = new MediaStream([mediaTrack]);
          let vid = el.querySelector('video') as HTMLVideoElement;
          if (!vid) {
            vid = document.createElement('video');
            vid.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;background:#000;';
            vid.autoplay = true;
            vid.muted = false;
            vid.playsInline = true;
            el.appendChild(vid);
          }
          vid.srcObject = stream;
          vid.muted = false;
          vid.play().catch(e => {
            console.warn('[RTC] Remote vid.play failed, trying muted:', e);
            vid.muted = true;
            vid.play().catch(()=>{});
          });
          console.log('[RTC] Remote video playing natively for uid:', uid);
          return;
        } catch(e) {
          console.warn('[RTC] Remote native play failed:', e);
          try { entry.video.play(el); return; } catch(e2) {}
        }
      }
      await new Promise(r => setTimeout(r, 200));
    }
    console.warn('[RTC] Could not play remote video after retries');
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

  // Switch between front and rear camera (mobile)
  private currentFacing: 'user' | 'environment' = 'user';
  private selfEl: HTMLElement | null = null; // reference to self-view element for replay

  async switchCamera(selfEl?: HTMLElement | null): Promise<void> {
    if (selfEl) this.selfEl = selfEl;
    const AgoraRTC = await getAgoraRTC();
    this.currentFacing = this.currentFacing === 'user' ? 'environment' : 'user';
    console.log('[RTC] Switching camera to:', this.currentFacing);
    try {
      // Unpublish and close old track
      if (this.localVideoTrack) {
        await this.client.unpublish([this.localVideoTrack]);
        this.localVideoTrack.stop();
        this.localVideoTrack.close();
      }
      // Create new track with opposite facing mode
      this.localVideoTrack = await AgoraRTC.createCameraVideoTrack({
        facingMode: this.currentFacing
      });
      // Publish to channel so remote sees new camera
      await this.client.publish([this.localVideoTrack]);
      // Replay into self-view element natively
      const el = this.selfEl;
      if (el && this.localVideoTrack) {
        this.playTrackInElement(this.localVideoTrack, el, 'Switched camera local');
      }
    } catch(e) {
      console.error('[RTC] Camera switch failed:', e);
      throw e;
    }
  }

  async leave(): Promise<void> {
    this.localAudioTrack?.stop(); this.localAudioTrack?.close();
    this.localVideoTrack?.stop(); this.localVideoTrack?.close();
    this.remoteUsers.clear();
    if (this.client) await this.client.leave();
    this.client = null;
  }
}
