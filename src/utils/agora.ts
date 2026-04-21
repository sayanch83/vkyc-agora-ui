// src/utils/agora.ts
// Simple, reliable Agora RTC wrapper

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
    s.onerror = () => reject(new Error('Failed to load Agora SDK'));
    document.head.appendChild(s);
  });
  _AgoraRTC = (window as any).AgoraRTC;
  _AgoraRTC.setLogLevel(3);
  return _AgoraRTC;
}

const SIGNAL_CHANNEL       = 'vkyc-signal';
const SIGNAL_AGENT_CHANNEL = 'vkyc-agent-signal';
const API_BASE = () => (window as any).__VKYC_API__ || 'http://localhost:3001/api/v1';

// ── Signal ────────────────────────────────────────────────────────────────────
export class VkycSignal {
  private bc: BroadcastChannel | null = null;
  private bcAgent: BroadcastChannel | null = null;
  private pollTimer: any = null;
  private agentPollTimer: any = null;
  onMessage: (data: any) => void = () => {};
  onAgentMessage: (data: any) => void = () => {};

  async send(data: object): Promise<void> {
    try { const bc = new BroadcastChannel(SIGNAL_CHANNEL); bc.postMessage(data); bc.close(); } catch(e) {}
    try {
      await fetch(API_BASE() + '/signal', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
      });
    } catch(e) {}
  }

  startListening(): void {
    try {
      this.bc = new BroadcastChannel(SIGNAL_CHANNEL);
      this.bc.onmessage = (evt) => this.onMessage(evt.data);
    } catch(e) {}
    let lastTs = 0;
    this.pollTimer = setInterval(async () => {
      try {
        const res = await fetch(API_BASE() + '/signal');
        if (!res.ok) return;
        const data = await res.json();
        if (data?.type === 'applicant-ready' && data.ts !== lastTs) {
          lastTs = data.ts || Date.now(); this.onMessage(data);
        }
      } catch(e) {}
    }, 2000);
  }

  sendToApplicant(data: object): void {
    try { const bc = new BroadcastChannel(SIGNAL_AGENT_CHANNEL); bc.postMessage(data); bc.close(); } catch(e) {}
    fetch(API_BASE() + '/agent-signal', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
    }).catch(()=>{});
  }

  listenForAgent(): void {
    try {
      this.bcAgent = new BroadcastChannel(SIGNAL_AGENT_CHANNEL);
      this.bcAgent.onmessage = (evt) => this.onAgentMessage(evt.data);
    } catch(e) {}
    let lastCmdId = 0;
    this.agentPollTimer = setInterval(async () => {
      try {
        const res = await fetch(API_BASE() + '/agent-signal?after=' + lastCmdId);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.commands?.length) {
          for (const cmd of data.commands) {
            if (cmd.id > lastCmdId) { lastCmdId = cmd.id; this.onAgentMessage(cmd); }
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

// ── RTC ───────────────────────────────────────────────────────────────────────
export class VkycCall {
  private client: any = null;
  private localAudioTrack: any = null;
  private localVideoTrack: any = null;
  private localEl: HTMLElement | null = null;
  private remoteVideoTracks: Map<any, any> = new Map();
  private currentFacing: 'user' | 'environment' = 'user';

  onRemoteJoined: (uid: any) => void = () => {};
  onRemoteLeft:   (uid: any) => void = () => {};
  onError:        (msg: string) => void = () => {};

  // Play a track into a container using native <video> element
  private playInto(track: any, container: HTMLElement, muted = true): void {
    if (!track || !container) return;
    try {
      // Remove any existing video element Agora may have injected
      container.querySelectorAll('video').forEach(v => v.remove());
      const vid = document.createElement('video');
      vid.autoplay = true;
      vid.playsInline = true;
      vid.muted = muted;
      vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#111;';
      const ms = new MediaStream([track.getMediaStreamTrack()]);
      vid.srcObject = ms;
      container.style.position = 'relative';
      container.appendChild(vid);
      vid.play().catch(() => {});
      console.log('[RTC] playInto success, muted:', muted);
    } catch(e) {
      console.warn('[RTC] playInto failed, trying Agora fallback:', e);
      try { track.play(container); } catch(e2) { console.error('[RTC] Agora fallback also failed:', e2); }
    }
  }

  async join(channelName: string, uid: number): Promise<void> {
    const AgoraRTC = await getAgoraRTC();
    this.client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

    this.client.on('user-published', async (user: any, mediaType: string) => {
      await this.client.subscribe(user, mediaType);
      if (mediaType === 'audio' && user.audioTrack) {
        user.audioTrack.play();
      }
      if (mediaType === 'video' && user.videoTrack) {
        this.remoteVideoTracks.set(user.uid, user.videoTrack);
        this.onRemoteJoined(user.uid);
      }
    });

    this.client.on('user-unpublished', (user: any, mediaType: string) => {
      if (mediaType === 'video') {
        this.remoteVideoTracks.delete(user.uid);
        this.onRemoteLeft(user.uid);
      }
    });
    this.client.on('user-left', (user: any) => {
      this.remoteVideoTracks.delete(user.uid);
      this.onRemoteLeft(user.uid);
    });

    await this.client.join(APP_ID, channelName, null, uid);

    // Create tracks
    [this.localAudioTrack, this.localVideoTrack] =
      await AgoraRTC.createMicrophoneAndCameraTracks(
        {},
        { facingMode: this.currentFacing }
      );
    await this.client.publish([this.localAudioTrack, this.localVideoTrack]);
    console.log('[RTC] Joined and published');
  }

  // Play local video into container — call after join()
  playLocal(container: HTMLElement): void {
    this.localEl = container;
    this.playInto(this.localVideoTrack, container, true);
  }

  // Play remote video into container for a given uid
  playRemote(uid: any, container: HTMLElement): void {
    const track = this.remoteVideoTracks.get(uid);
    if (track) {
      this.playInto(track, container, false);
    }
  }

  // Switch front/rear camera
  async switchCamera(): Promise<void> {
    const AgoraRTC = await getAgoraRTC();
    this.currentFacing = this.currentFacing === 'user' ? 'environment' : 'user';
    try {
      if (this.localVideoTrack) {
        await this.client.unpublish([this.localVideoTrack]);
        this.localVideoTrack.stop();
        this.localVideoTrack.close();
      }
      this.localVideoTrack = await AgoraRTC.createCameraVideoTrack({ facingMode: this.currentFacing });
      await this.client.publish([this.localVideoTrack]);
      if (this.localEl) this.playInto(this.localVideoTrack, this.localEl, true);
      console.log('[RTC] Camera switched to:', this.currentFacing);
    } catch(e) { console.error('[RTC] switchCamera failed:', e); throw e; }
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
    this.remoteVideoTracks.clear();
    if (this.client) await this.client.leave();
    this.client = null; this.localEl = null;
  }
}
