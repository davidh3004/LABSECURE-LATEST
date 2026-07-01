/* Emergency.tsx — Kill Switch Control Panel */

import { useState, useEffect } from 'react';
import { ShieldAlert, ShieldOff, AlertTriangle, Clock, User } from 'lucide-react';
import { emergencyApi } from '../api/client';
import type { SystemState } from '../api/types';

export default function EmergencyPage() {
    const [state, setState] = useState<SystemState | null>(null);
    const [loading, setLoading] = useState(false);
    const [confirmAction, setConfirmAction] = useState<'activate' | 'deactivate' | null>(null);

    const load = () => emergencyApi.status().then(setState).catch(() => { });
    useEffect(() => { load(); const i = setInterval(load, 60000); return () => clearInterval(i); }, []);

    const handleActivate = async () => {
        setLoading(true);
        try {
            await emergencyApi.activate('admin');
            load();
        } finally {
            setLoading(false);
            setConfirmAction(null);
        }
    };

    const handleDeactivate = async () => {
        setLoading(true);
        try {
            await emergencyApi.deactivate('admin');
            load();
        } finally {
            setLoading(false);
            setConfirmAction(null);
        }
    };

    const isLocked = state?.emergency_lock || false;

    return (
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
            {/* Status Card */}
            <div className="card mb-6" style={{
                borderColor: isLocked ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)',
                boxShadow: isLocked ? 'var(--shadow-danger-glow)' : '0 0 30px rgba(16, 185, 129, 0.15)',
            }}>
                <div className="card-body" style={{ textAlign: 'center', padding: 48 }}>
                    <div style={{
                        width: 80, height: 80, margin: '0 auto 20px',
                        borderRadius: '50%',
                        background: isLocked ? 'var(--color-danger-bg)' : 'var(--color-success-bg)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        {isLocked ? (
                            <ShieldAlert size={40} style={{ color: 'var(--color-danger)' }} />
                        ) : (
                            <ShieldOff size={40} style={{ color: 'var(--color-success)' }} />
                        )}
                    </div>

                    <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>
                        {isLocked ? '🔴 EMERGENCY LOCKDOWN ACTIVE' : '🟢 Normal Operation'}
                    </h2>
                    <p style={{ color: 'var(--text-secondary)', maxWidth: 400, margin: '0 auto 24px' }}>
                        {isLocked
                            ? 'The lab is locked. All access permissions are revoked regardless of schedule.'
                            : 'The lab is operating normally. Access is controlled by schedules and permissions.'}
                    </p>

                    {isLocked && state?.emergency_activated_at && (
                        <div className="flex items-center justify-center gap-4" style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                            <span className="flex items-center gap-2">
                                <User size={14} /> Activated by: {state.emergency_activated_by || 'Unknown'}
                            </span>
                            <span className="flex items-center gap-2">
                                <Clock size={14} /> {new Date(state.emergency_activated_at).toLocaleString()}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Action Button */}
            <div className="text-center mb-6">
                {isLocked ? (
                    <button className="emergency-btn deactivate" disabled={loading}
                        onClick={() => setConfirmAction('deactivate')}>
                        <ShieldOff size={20} style={{ marginRight: 8 }} />
                        {loading ? 'Restoring...' : 'Deactivate Lockdown'}
                    </button>
                ) : (
                    <button className="emergency-btn activate" disabled={loading}
                        onClick={() => setConfirmAction('activate')}>
                        <ShieldAlert size={20} style={{ marginRight: 8 }} />
                        {loading ? 'Activating...' : 'Activate Emergency Lockdown'}
                    </button>
                )}
            </div>

            {/* Warning */}
            <div className="card" style={{ borderColor: 'rgba(245, 158, 11, 0.3)' }}>
                <div className="card-body">
                    <div className="flex items-center gap-3" style={{ marginBottom: 12 }}>
                        <AlertTriangle size={18} style={{ color: 'var(--color-warning)' }} />
                        <strong style={{ color: 'var(--color-warning)' }}>Important</strong>
                    </div>
                    <ul style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 2, paddingLeft: 18 }}>
                        <li>Emergency lockdown immediately denies <strong>all</strong> access attempts</li>
                        <li>Active guests and scheduled access windows are overridden</li>
                        <li>An event with <strong>critical</strong> severity is logged</li>
                        <li>All cameras continue recording during lockdown</li>
                        <li>Only administrators can activate or deactivate lockdown</li>
                    </ul>
                </div>
            </div>

            {/* Confirmation Modal */}
            {confirmAction && (
                <div className="modal-overlay" onClick={() => setConfirmAction(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
                        <div className="modal-header">
                            <h2 className="modal-title" style={{
                                color: confirmAction === 'activate' ? 'var(--color-danger)' : 'var(--color-success)',
                            }}>
                                {confirmAction === 'activate' ? '⚠️ Confirm Lockdown' : '✅ Confirm Restoration'}
                            </h2>
                        </div>
                        <div className="modal-body">
                            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                {confirmAction === 'activate'
                                    ? 'This will immediately lock the lab and revoke ALL access permissions. Are you absolutely sure?'
                                    : 'This will restore normal access control based on schedules and permissions. Proceed?'}
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
                            <button className={`btn ${confirmAction === 'activate' ? 'btn-danger' : 'btn-primary'}`}
                                onClick={confirmAction === 'activate' ? handleActivate : handleDeactivate}>
                                {confirmAction === 'activate' ? 'Yes, Lock the Lab' : 'Yes, Restore Access'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
