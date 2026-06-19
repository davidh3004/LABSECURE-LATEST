/* FaceCapture.tsx — Lightweight face enrollment (camera preview + manual capture)
 *
 * Face-api.js models removed — they took 10+ seconds to load on CPU and the
 * client-side detection was unreliable, locking the capture button.
 * The backend (InsightFace) handles all real face validation on submit.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, Check, Loader2, RotateCcw } from 'lucide-react';
import { camerasApi, createFeedSocket } from '../api/client';

interface FaceCaptureProps {
    onCapture: (photo: Blob, descriptor: Float32Array) => void;
    onSkip: () => void;
    multiAngle?: boolean;
}

interface AngleCapture {
    label: string;
    instruction: string;
    emoji: string;
    captured: boolean;
    photo: Blob | null;
}

const ANGLES: Omit<AngleCapture, 'captured' | 'photo'>[] = [
    { label: 'Center', instruction: 'Look straight at the camera', emoji: '😐' },
    { label: 'Left',   instruction: 'Slightly glance to your left', emoji: '👈' },
    { label: 'Right',  instruction: 'Slightly glance to your right', emoji: '👉' },
    { label: 'Up',     instruction: 'Raise your chin a little', emoji: '👆' },
    { label: 'Down',   instruction: 'Lower your chin a little', emoji: '👇' },
];

export default function FaceCapture({ onCapture, onSkip, multiAngle = true }: FaceCaptureProps) {
    const videoRef  = useRef<HTMLVideoElement | null>(null);
    const imgRef    = useRef<HTMLImageElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const [cameraReady, setCameraReady]     = useState(false);
    const [capturing, setCapturing]         = useState(false);
    const [flashActive, setFlashActive]     = useState(false);
    const [error, setError]                 = useState<string | null>(null);
    const [enrollmentComplete, setEnrollmentComplete] = useState(false);

    const [backendCameras, setBackendCameras] = useState<any[]>([]);
    const [selectedCamera, setSelectedCamera] = useState<string>('local');
    const [backendFrameUrl, setBackendFrameUrl] = useState<string | null>(null);

    const [angles, setAngles] = useState<AngleCapture[]>(
        ANGLES.map(a => ({ ...a, captured: false, photo: null }))
    );
    const [currentAngleIdx, setCurrentAngleIdx] = useState(0);

    const capturedCount = angles.filter(a => a.captured).length;
    const allCaptured   = capturedCount === angles.length;
    const progress      = capturedCount / angles.length;
    const currentAngle  = angles[currentAngleIdx];

    // 1. Fetch backend cameras list on mount
    useEffect(() => {
        camerasApi.list().then(list => {
            // Filter or just include all
            setBackendCameras(list);
        }).catch(() => { });
    }, []);

    // 2. Start local webcam (only if selectedCamera === 'local')
    useEffect(() => {
        if (selectedCamera !== 'local') {
            setCameraReady(false);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
                    audio: false,
                });
                if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
                streamRef.current = stream;
                if (videoRef.current) videoRef.current.srcObject = stream;
                setCameraReady(true);
            } catch (err: any) {
                if (!cancelled) setError(`Camera error: ${err.message}`);
            }
        })();
        return () => {
            cancelled = true;
            streamRef.current?.getTracks().forEach(t => t.stop());
        };
    }, [selectedCamera]);

    // 3. Start backend stream (only if selectedCamera !== 'local')
    useEffect(() => {
        if (selectedCamera === 'local') {
            setBackendFrameUrl(null);
            return;
        }
        setCameraReady(false);
        const ws = createFeedSocket(selectedCamera);
        
        ws.onopen = () => setCameraReady(true);
        ws.onmessage = (event) => {
            const blob = new Blob([event.data], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            setBackendFrameUrl(prev => {
                if (prev) URL.revokeObjectURL(prev);
                return url;
            });
        };
        ws.onerror = () => setError('Failed to connect to backend camera feed');
        ws.onclose = () => setCameraReady(false);

        return () => {
            ws.close();
            setBackendFrameUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
        };
    }, [selectedCamera]);

    const triggerFlash = () => {
        setFlashActive(true);
        setTimeout(() => setFlashActive(false), 180);
    };

    // Capture a JPEG snapshot from the live video frame
    const capturePhoto = useCallback((): Promise<Blob | null> => {
        const video = videoRef.current;
        const img   = imgRef.current;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;

        if (selectedCamera === 'local') {
            if (!video || video.readyState < 2) return Promise.resolve(null);
            canvas.width  = video.videoWidth;
            canvas.height = video.videoHeight;
            // Mirror horizontally to match display
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0);
        } else {
            if (!img || !img.complete) return Promise.resolve(null);
            canvas.width  = img.naturalWidth;
            canvas.height = img.naturalHeight;
            ctx.drawImage(img, 0, 0);
        }
        
        return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    }, [selectedCamera]);

    // Multi-angle: capture current angle and advance
    const handleAngleCapture = useCallback(async () => {
        setCapturing(true);
        try {
            const photo = await capturePhoto();
            if (!photo) { setError('Could not grab frame. Try again.'); setCapturing(false); return; }
            triggerFlash();
            const newAngles = [...angles];
            newAngles[currentAngleIdx] = { ...newAngles[currentAngleIdx], captured: true, photo };
            setAngles(newAngles);
            if (currentAngleIdx < angles.length - 1) setCurrentAngleIdx(currentAngleIdx + 1);
        } catch { setError('Capture failed. Please try again.'); }
        setCapturing(false);
    }, [angles, currentAngleIdx, capturePhoto]);

    // Single-angle capture
    const handleSingleCapture = useCallback(async () => {
        setCapturing(true);
        try {
            const photo = await capturePhoto();
            if (!photo) { setError('Could not grab frame. Try again.'); setCapturing(false); return; }
            triggerFlash();
            // Descriptor is a dummy zero array — backend extracts the real 512-dim embedding from the photo
            onCapture(photo, new Float32Array(128));
        } catch { setError('Capture failed. Please try again.'); }
        setCapturing(false);
    }, [capturePhoto, onCapture]);

    // Finish multi-angle: send the center (first captured) photo to backend
    const handleFinishMultiAngle = useCallback(() => {
        // Use the first captured photo as the primary enrollment image.
        // The backend InsightFace engine extracts the 512-dim embedding.
        const firstCapture = angles.find(a => a.captured && a.photo);
        if (!firstCapture?.photo) return;
        setEnrollmentComplete(true);
        setTimeout(() => onCapture(firstCapture.photo!, new Float32Array(128)), 500);
    }, [angles, onCapture]);

    const handleRecaptureAngle = useCallback((idx: number) => {
        const newAngles = [...angles];
        newAngles[idx] = { ...newAngles[idx], captured: false, photo: null };
        setAngles(newAngles);
        setCurrentAngleIdx(idx);
    }, [angles]);

    // ── Render ────────────────────────────────────────────────
    if (error) {
        return (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ color: 'var(--color-danger)', marginBottom: 16 }}>{error}</div>
                <button className="btn btn-secondary" onClick={() => setError(null)} style={{ marginRight: 8 }}>
                    <RotateCcw size={14} /> Retry
                </button>
                <button className="btn btn-secondary" onClick={onSkip}>Skip</button>
            </div>
        );
    }

    if (enrollmentComplete) {
        return (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{
                    width: 80, height: 80, borderRadius: '50%',
                    background: 'var(--color-success-bg)', color: 'var(--color-success)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 20px',
                }}>
                    <Check size={40} />
                </div>
                <h3 style={{ margin: '0 0 8px', color: 'var(--text-main)' }}>Enrollment Complete!</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                    {capturedCount} angle{capturedCount !== 1 ? 's' : ''} captured. Processing on server…
                </p>
            </div>
        );
    }

    return (
        <div>
            {/* Multi-angle step indicator */}
            {multiAngle && (
                <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                            {capturedCount}/{angles.length}
                        </span>
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                            <div style={{
                                width: `${progress * 100}%`, height: '100%', borderRadius: 3,
                                background: allCaptured
                                    ? 'var(--color-success)'
                                    : 'linear-gradient(90deg, var(--color-primary), #8b5cf6)',
                                transition: 'width 0.4s ease',
                            }} />
                        </div>
                    </div>

                    {/* Angle pills */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                        {angles.map((angle, i) => (
                            <button
                                key={angle.label}
                                onClick={() => angle.captured ? handleRecaptureAngle(i) : setCurrentAngleIdx(i)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                                    border: i === currentAngleIdx && !angle.captured
                                        ? '2px solid var(--color-primary)' : '2px solid transparent',
                                    background: angle.captured
                                        ? 'var(--color-success-bg)' : i === currentAngleIdx
                                            ? 'var(--color-primary-bg)' : 'var(--bg-tertiary)',
                                    color: angle.captured
                                        ? 'var(--color-success)' : i === currentAngleIdx
                                            ? 'var(--color-primary)' : 'var(--text-tertiary)',
                                    cursor: 'pointer', transition: 'all 0.2s ease',
                                }}
                            >
                                {angle.captured ? <Check size={12} /> : <span>{angle.emoji}</span>}
                                {angle.label}
                                {angle.captured && <RotateCcw size={10} style={{ marginLeft: 2, opacity: 0.6 }} />}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Instruction banner */}
            {multiAngle && !allCaptured && (
                <div style={{
                    textAlign: 'center', marginBottom: 10, padding: '10px 16px',
                    background: 'var(--color-primary-bg)', borderRadius: 10,
                    color: 'var(--color-primary)', fontSize: 14, fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                    <span style={{ fontSize: 20 }}>{currentAngle.emoji}</span>
                    {currentAngle.instruction}
                </div>
            )}

            {/* Camera Selector Dropdown */}
            {backendCameras.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                    <select 
                        className="form-select" 
                        value={selectedCamera} 
                        onChange={e => { setSelectedCamera(e.target.value); setError(null); }}
                        style={{ width: '100%', padding: '8px 12px', borderRadius: 8 }}
                    >
                        <option value="local">💻 Local Webcam (Loads in Browser)</option>
                        {backendCameras.map(cam => (
                            <option key={cam.id} value={cam.id}>🎥 Backend: {cam.name || cam.id}</option>
                        ))}
                    </select>
                    {selectedCamera === 'local' && (
                        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, marginLeft: 4 }}>
                            Windows only allows one app to lock the camera. If this fails, select a Backend option.
                        </p>
                    )}
                </div>
            )}

            {/* Camera viewport */}
            <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000', aspectRatio: '4/3', maxHeight: 360 }}>
                {selectedCamera === 'local' ? (
                    <video
                        ref={videoRef}
                        autoPlay playsInline muted
                        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
                    />
                ) : (
                    <img
                        ref={imgRef}
                        src={backendFrameUrl || ''}
                        alt="Backend camera stream"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                )}

                {/* Oval guide drawn with CSS (no canvas needed) */}
                {cameraReady && (
                    <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        pointerEvents: 'none',
                    }}>
                        <div style={{
                            width: '55%', paddingBottom: '70%',
                            border: `3px dashed rgba(99, 179, 237, 0.7)`,
                            borderRadius: '50%',
                            boxShadow: '0 0 0 2000px rgba(0,0,0,0.35)',
                        }} />
                    </div>
                )}

                {/* Flash overlay */}
                {flashActive && (
                    <div style={{
                        position: 'absolute', inset: 0, background: 'white',
                        opacity: 0.75, pointerEvents: 'none',
                    }} />
                )}

                {/* Camera loading state */}
                {!cameraReady && (
                    <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'var(--text-secondary)', gap: 8,
                    }}>
                        <Loader2 size={24} className="spin" />
                        <span>Starting camera…</span>
                    </div>
                )}

                {/* Hint label */}
                {cameraReady && (
                    <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        padding: '8px 12px', background: 'rgba(0,0,0,0.55)',
                        color: '#cbd5e1', fontSize: 12, textAlign: 'center',
                    }}>
                        Center your face in the oval, then capture
                    </div>
                )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 12, marginTop: 16, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={onSkip}>Skip</button>

                {multiAngle ? (
                    allCaptured ? (
                        <button className="btn btn-primary" onClick={handleFinishMultiAngle} style={{ minWidth: 180 }}>
                            <Check size={16} /> Complete Enrollment ({capturedCount} angles)
                        </button>
                    ) : (
                        <button
                            className="btn btn-primary"
                            onClick={handleAngleCapture}
                            disabled={!cameraReady || capturing}
                            style={{ minWidth: 180 }}
                        >
                            {capturing
                                ? <><Loader2 size={16} className="spin" /> Capturing…</>
                                : <><Camera size={16} /> Capture {currentAngle?.label} ({capturedCount + 1}/{angles.length})</>
                            }
                        </button>
                    )
                ) : (
                    <button
                        className="btn btn-primary"
                        onClick={handleSingleCapture}
                        disabled={!cameraReady || capturing}
                        style={{ minWidth: 160 }}
                    >
                        {capturing
                            ? <><Loader2 size={16} className="spin" /> Capturing…</>
                            : <><Camera size={16} /> Capture Face</>
                        }
                    </button>
                )}
            </div>
        </div>
    );
}
