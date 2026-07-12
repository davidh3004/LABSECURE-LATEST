/* Dashboard.tsx — Live Security Feed */

import { useState, useEffect } from 'react';
import { VideoOff } from 'lucide-react';
import { camerasApi } from '../api/client';
import CameraFeed from '../components/CameraFeed';
import type { CameraConfig } from '../api/types';

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
