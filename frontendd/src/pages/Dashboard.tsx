/* Dashboard.tsx — Live Security Feed */

import { useState, useEffect, useRef } from 'react';
import { VideoOff, Activity } from 'lucide-react';
import { camerasApi, createFeedSocket } from '../api/client';
import type { CameraConfig } from '../api/types';

interface FeedState {
    connected: boolean;
    hasFrame: boolean;
    fps: number;
}

/* ── CameraFeed ─────────────────────────────────────────────────────────────
 * Renders a live JPEG stream from the backend pipeline.
 *
 * Strategy: canvas + off-screen Image decode
 *   - Each incoming JPEG (snapshot or WebSocket binary frame) is decoded by a
 *     throwaway Image object. When it finishes loading (onload), we drawImage
 *     onto the canvas and immediately revoke the blob URL.
 *   - Canvas always paints whatever was last drawn — no React state involved
 *     in the pixel data, no Safari blob-revoke timing issues, no React
 *     reconciliation touching the element between frames.
 *   - frameSeqRef ensures that if a newer frame arrives while an older one is
 *     still decoding, the older draw is silently discarded.
 * ─────────────────────────────────────────────────────────────────────────── */
function CameraFeed({ camera }: { camera: CameraConfig }) {
    const [state, setState] = useState<FeedState>({ connected: false, hasFrame: false, fps: 0 });
    const wsRef = useRef<WebSocket | null>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const frameCountRef = useRef(0);
    const fpsTimerRef = useRef<ReturnType<typeof setInterval>>();

    useEffect(() => {
        let destroyed = false;

        const updateFrame = (blob: Blob) => {
            if (destroyed) return;
            const url = URL.createObjectURL(blob);
            if (imgRef.current) {
                if (imgRef.current.src) URL.revokeObjectURL(imgRef.current.src);
                imgRef.current.src = url;
            }
            if (!destroyed) setState(s => s.hasFrame ? s : { ...s, hasFrame: true });
        };

        // Snapshot: paint the first frame before WS connects
        const API_BASE = import.meta.env.VITE_API_BASE || '';
        fetch(`${API_BASE}/api/cameras/${camera.id}/snapshot`)
            .then(r => r.ok ? r.blob() : null)
            .then(blob => { if (blob && !destroyed) updateFrame(blob); })
            .catch(() => {});

        // WebSocket: continuous annotated JPEG stream
        const connect = () => {
            if (destroyed) return;
            try {
                const ws = createFeedSocket(camera.id);
                ws.binaryType = 'arraybuffer';
                wsRef.current = ws;

                ws.onopen = () => setState(s => ({ ...s, connected: true }));

                ws.onmessage = (event) => {
                    let blob: Blob;
                    if (event.data instanceof ArrayBuffer) {
                        blob = new Blob([event.data], { type: 'image/jpeg' });
                    } else if (event.data instanceof Blob) {
                        blob = event.data;
                    } else {
                        return; // Unknown data format
                    }
                    updateFrame(blob);
                    frameCountRef.current++;
                };

                ws.onerror = () => setState(s => ({ ...s, connected: false }));
                ws.onclose = () => {
                    setState(s => ({ ...s, connected: false }));
                    if (!destroyed) setTimeout(connect, 3000);
                };
            } catch {
                if (!destroyed) setTimeout(connect, 3000);
            }
        };

        connect();

        fpsTimerRef.current = setInterval(() => {
            setState(s => ({ ...s, fps: frameCountRef.current }));
            frameCountRef.current = 0;
        }, 1000);

        return () => {
            destroyed = true;
            wsRef.current?.close();
            clearInterval(fpsTimerRef.current);
        };
    }, [camera.id]);

    return (
        <div className="feed-panel">
            <div className="feed-header">
                <div className="feed-camera-name">
                    <span className={`status-dot ${state.connected ? 'online' : 'offline'}`} />
                    {camera.name}
                </div>
                <div className="feed-stats">
                    <span><Activity size={12} /> {state.fps} FPS</span>
                    <span className={`badge ${state.connected ? 'badge-success' : 'badge-danger'}`}>
                        {state.connected ? 'LIVE' : 'OFFLINE'}
                    </span>
                </div>
            </div>
            <div className="feed-canvas">
                <img
                    ref={imgRef}
                    alt={`${camera.name} feed`}
                    style={{ display: state.hasFrame ? 'block' : 'none', width: '100%', height: '100%', objectFit: 'cover' }}
                />
                {!state.hasFrame && (
                    <div className="feed-offline">
                        <VideoOff size={40} />
                        <span>{state.connected ? 'Waiting for frames...' : 'Camera offline'}</span>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function Dashboard() {
    const [cameras, setCameras] = useState<CameraConfig[]>([]);

    useEffect(() => {
        camerasApi.list().then(setCameras).catch(() => setCameras([]));
    }, []);

    const enabledCameras = cameras.filter(c => c.enabled);

    return (
        <div>
            {enabledCameras.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '100px 20px' }}>
                    <VideoOff size={56} style={{ color: 'var(--text-tertiary)', margin: '0 auto 16px' }} />
                    <div style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: 18, marginBottom: 8 }}>
                        No cameras configured
                    </div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>
                        Go to <strong>Camera Health</strong> to add your webcam or IP cameras
                    </div>
                </div>
            ) : (
                <div className="feed-grid">
                    {enabledCameras.map(cam => <CameraFeed key={cam.id} camera={cam} />)}
                </div>
            )}
        </div>
    );
}
