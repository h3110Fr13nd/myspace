import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

export interface CollabUser {
  name: string;
  color: string;
  avatarUrl?: string;
  userId?: string;
}

export interface CollabPresenceState {
  activeViewers: number;
  mode: 'solo' | 'collab';
  peers: Array<{ userId: string; userName: string; color: string }>;
  isConnectedToDO: boolean;
  forcedLive: boolean;
}

export class AdaptiveCollabManager {
  documentId: string;
  user: CollabUser;
  ydoc: Y.Doc;
  provider: HocuspocusProvider | null = null;
  heartbeatInterval: any = null;
  stateListeners: Array<(state: CollabPresenceState) => void> = [];

  activeViewers: number = 1;
  mode: 'solo' | 'collab' = 'solo';
  peers: Array<{ userId: string; userName: string; color: string }> = [];
  forcedLive: boolean = false;
  soloGraceTimer: any = null;
  private started: boolean = false;

  constructor(documentId: string, user: CollabUser) {
    this.documentId = documentId;
    this.user = user;
    // Constructing the manager is pure + SSR-safe; side effects (heartbeat) are
    // deferred to start() so React can own the lifecycle. See useCollaboration().
    this.ydoc = new Y.Doc();
  }

  /**
   * Begins presence polling. Idempotent, and safe to call from a mount effect.
   */
  public start() {
    if (this.started) return;
    this.started = true;
    // Presence polling relies on the browser fetch/DOM APIs; never start it during SSR.
    if (typeof window !== 'undefined') {
      this.startPresenceHeartbeat();
    }
  }

  public subscribe(listener: (state: CollabPresenceState) => void) {
    this.stateListeners.push(listener);
    listener(this.getState());
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    const s = this.getState();
    this.stateListeners.forEach((l) => l(s));
  }

  public getState(): CollabPresenceState {
    return {
      activeViewers: this.activeViewers,
      mode: this.mode,
      forcedLive: this.forcedLive,
      peers: this.peers,
      isConnectedToDO: Boolean(this.provider && (this.provider as any).isConnected),
    };
  }

  private async checkPresence() {
    try {
      const res = await fetch('/api/v1/collab/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceId: this.documentId,
          userId: this.user.userId || `user:${this.user.name.toLowerCase().replace(/\s+/g, '-')}`,
          userName: this.user.name,
          color: this.user.color,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        this.activeViewers = data.activeViewers || 1;
        this.peers = data.peers || [];

        // JIT Upgrade/Downgrade Rule:
        if (data.collabRecommended || this.forcedLive) {
          if (this.soloGraceTimer) {
            clearTimeout(this.soloGraceTimer);
            this.soloGraceTimer = null;
          }
          if (this.mode !== 'collab') {
            this.upgradeToDurableObject(data.collabUrl);
          }
        } else if (this.mode === 'collab' && !this.forcedLive) {
          // If alone, wait 45s grace period before disconnecting from DO to save GB-s
          if (!this.soloGraceTimer) {
            this.soloGraceTimer = setTimeout(() => {
              this.downgradeToSoloMode();
              this.soloGraceTimer = null;
            }, 45000);
          }
        }

        this.notify();
      }
    } catch {
      // Offline fallback: keep working in local solo mode without crashing
    }
  }

  private startPresenceHeartbeat() {
    this.checkPresence();
    this.heartbeatInterval = setInterval(() => this.checkPresence(), 20000); // 20s heartbeat
  }

  private upgradeToDurableObject(endpointUrl: string) {
    if (this.provider) return;

    this.mode = 'collab';
    try {
      this.provider = new HocuspocusProvider({
        url: endpointUrl || 'ws://127.0.0.1:1234',
        name: this.documentId,
        document: this.ydoc,
        onConnect: () => {
          this.notify();
        },
        onDisconnect: () => {
          this.notify();
        },
      });

      this.provider.setAwarenessField('user', {
        name: this.user.name,
        color: this.user.color,
      });
    } catch (err) {
      console.warn('[Collab:DO] Error establishing WebSocket provider:', err);
    }
    this.notify();
  }

  private downgradeToSoloMode() {
    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }
    this.mode = 'solo';
    this.notify();
  }

  public toggleLiveSession() {
    this.forcedLive = !this.forcedLive;
    if (this.forcedLive) {
      this.checkPresence();
    } else if (this.activeViewers <= 1) {
      this.downgradeToSoloMode();
    }
    this.notify();
  }

  public destroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.soloGraceTimer) {
      clearTimeout(this.soloGraceTimer);
      this.soloGraceTimer = null;
    }
    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }
    this.started = false;
    this.mode = 'solo';
    this.stateListeners = [];
  }
}

export function getRandomColor(): string {
  const colors = [
    '#00f2fe', '#4facfe', '#667eea', '#764ba2', '#ff0844', '#ffb199',
    '#f83600', '#f9d423', '#0ba360', '#3cba92', '#c084fc', '#38bdf8',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}
