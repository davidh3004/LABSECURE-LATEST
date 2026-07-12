/* CameraFeed.tsx — Live JPEG stream from backend pipeline */

import { useState, useEffect, useRef } from 'react';
import { VideoOff, Activity } from 'lucide-react';
import { createFeedSocket } from '../api/client';
import type { CameraConfig } from '../api/types';

interface FeedState {
    connected: boolean;
    hasFrame: boolean;
    fps: number;
}

interface CameraFeedProps {
    camera: CameraConfig;
    compact?: boolean;
}

export default function CameraFeed({ camera, compact = false }: CameraFeedProps) {
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

        const API_BASE = import.meta.env.VITE_API_BASE || '';
        fetch(`${API_BASE}/api/cameras/${camera.id}/snapshot`)
            .then(r => r.ok ? r.blob() : null)
            .then(blob => { if (blob && !destroyed) updateFrame(blob); })
            .catch(() => {});

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
                        return;
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
        <div className="feed-panel" style={compact ? { height: '100%' } : undefined}>
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
            <div className="feed-canvas" style={compact ? { minHeight: 280 } : undefined}>
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
