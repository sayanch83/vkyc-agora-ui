// src/utils/agora.ts
// Agora Web SDK 4.x (RTC) + RTM SDK for signalling
// RTC = video/audio call
// RTM = messaging to signal "applicant is ready"

const APP_ID = '15d6681ab3b049ad91ecc585cc645551';
const RTM_CHANNEL = 'vkyc-signal'; // shared signalling channel

let _AgoraRTC: any = null;
let _AgoraRTM: any = null;

async function loadScript(src: string, attr: string): Promise<void> {
  if (document.querySelector(`script[${attr}]`)) return;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.setAttribute(attr, '1');
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load: ' + src));
    document.head.appendChild(s);
  });
}

async function getAgoraRTC(): Promise<any> {
  if (_AgoraRTC) return _AgoraRTC;
  await loadScript('https://download.agora.io/sdk/release/AgoraRTC_N-4.20.0.js', 'data-agora-rtc');
  _AgoraRTC = (window as any).AgoraRTC;
  _AgoraRTC.setLogLevel(3);
  return _AgoraRTC;
}

async function getAgoraRTM(): Promise<any> {
  if (_AgoraRTM) return _AgoraRTM;
  await loadScript('https://download.agora.io/sdk/release/agora-rtm-sdk-1.5.1.js', 'data-agora-rtm');
  _AgoraRTM = (window as any).AgoraRTM;
  return _AgoraRTM;
}

// ── RTM Signal client (for applicant→agent messaging) ──────────────────────
export class VkycSignal {
  private client: any = null;
  private channel: any = null;
  onMessage: (data: any) => void = () => {};

  async connect(uid: string): Promise<void> {
    const AgoraRTM = await getAgoraRTM();
    this.client = AgoraRTM.createInstance(APP_ID);
    await this.client.login({ uid });
    this.channel = this.client.createChannel(RTM_CHANNEL);
    this.channel.on('ChannelMessage', (msg: any) => {
      try { this.onMessage(JSON.parse(msg.text)); } catch {}
    });
    await this.channel.join();
  }

  async send(data: object): Promise<void> {
    if (!this.channel) return;
    await this.channel.sendMessage({ text: JSON.stringify(data) });
  }

  async disconnect(): Promise<void> {
    try { await this.channel?.leave(); await this.client?.logout(); } catch {}
    this.client = null; this.channel = null;
  }
}

// ── RTC Video call ─────────────────────────────────────────────────────────
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
