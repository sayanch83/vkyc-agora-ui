// src/utils/agora.ts
// Agora Web SDK 4.x wrapper — shared by vkyc-agent and vkyc-applicant
// Loads Agora SDK dynamically so it doesn't need to be bundled

const APP_ID = '15d6681ab3b049ad91ecc585cc645551';

export interface AgoraTrack {
  play: (el: string | HTMLElement) => void;
  stop: () => void;
  close: () => void;
  setEnabled: (enabled: boolean) => void;
}

let _AgoraRTC: any = null;

// Load Agora SDK from CDN once
async function getAgoraRTC(): Promise<any> {
  if (_AgoraRTC) return _AgoraRTC;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-agora]');
    if (existing) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://download.agora.io/sdk/release/AgoraRTC_N-4.20.0.js';
    s.setAttribute('data-agora', '1');
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Agora SDK'));
    document.head.appendChild(s);
  });
  _AgoraRTC = (window as any).AgoraRTC;
  _AgoraRTC.setLogLevel(3); // warn only
  return _AgoraRTC;
}

export class VkycCall {
  private client: any = null;
  private localAudioTrack: any = null;
  private localVideoTrack: any = null;
  public remoteUsers: Map<any, { video: any; audio: any }> = new Map();

  // Callbacks
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
      const entry = this.remoteUsers.get(user.uid);
      if (mediaType === 'video') {
        entry.video = user.videoTrack;
      }
      if (mediaType === 'audio') {
        entry.audio = user.audioTrack;
        user.audioTrack.play();
      }
      // Fire with whichever tracks exist
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

    // Join without token (Testing mode in Agora console)
    await this.client.join(APP_ID, channelName, null, uid);

    // Create and publish local tracks
    [this.localAudioTrack, this.localVideoTrack] =
      await AgoraRTC.createMicrophoneAndCameraTracks();

    await this.client.publish([this.localAudioTrack, this.localVideoTrack]);
  }

  // Play local video into a DOM element
  playLocal(el: HTMLElement | string): void {
    if (this.localVideoTrack) this.localVideoTrack.play(el);
  }

  // Play remote video into a DOM element
  playRemote(uid: any, el: HTMLElement | string): void {
    const entry = this.remoteUsers.get(uid);
    if (entry?.video) entry.video.play(el);
  }

  async setMic(enabled: boolean): Promise<void> {
    if (this.localAudioTrack) await this.localAudioTrack.setEnabled(enabled);
  }

  async setCam(enabled: boolean): Promise<void> {
    if (this.localVideoTrack) await this.localVideoTrack.setEnabled(enabled);
  }

  async leave(): Promise<void> {
    this.localAudioTrack?.stop();
    this.localAudioTrack?.close();
    this.localVideoTrack?.stop();
    this.localVideoTrack?.close();
    this.remoteUsers.clear();
    if (this.client) await this.client.leave();
    this.client = null;
  }
}
