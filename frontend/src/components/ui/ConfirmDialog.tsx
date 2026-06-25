/* ConfirmDialog.tsx — Reusable promise-based confirm popup.
   Usage:  if (await confirmDialog({ title, message })) { ...do it... }
   Mount <ConfirmHost /> once at the app root. */

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

export type ConfirmOptions = {
    title?: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
};

type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

let pushConfirm: ((p: Pending) => void) | null = null;

/** Open the confirm popup. Resolves true on confirm, false on cancel/dismiss. */
export function confirmDialog(opts: ConfirmOptions = {}): Promise<boolean> {
    return new Promise((resolve) => {
        if (pushConfirm) pushConfirm({ ...opts, resolve });
        else resolve(window.confirm(opts.message || opts.title || 'Are you sure?'));
    });
}

export function ConfirmHost() {
    const [pending, setPending] = useState<Pending | null>(null);

    useEffect(() => {
        pushConfirm = (p) => setPending(p);
        return () => { pushConfirm = null; };
    }, []);

    useEffect(() => {
        if (!pending) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close(false);
            if (e.key === 'Enter') close(true);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pending]);

    if (!pending) return null;

    const close = (value: boolean) => {
        pending.resolve(value);
        setPending(null);
    };

    const danger = pending.danger ?? true;

    return (
        <div className="modal-overlay" onClick={() => close(false)}>
            <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
                <div className="modal-body" style={{ textAlign: 'center', paddingTop: 28 }}>
                    <div className={`confirm-icon ${danger ? 'danger' : 'info'}`}>
                        <AlertTriangle size={26} />
                    </div>
                    <h2 className="confirm-title">{pending.title || 'Are you sure?'}</h2>
                    {pending.message && <p className="confirm-message">{pending.message}</p>}
                </div>
                <div className="modal-footer" style={{ justifyContent: 'center' }}>
                    <button className="btn btn-secondary" onClick={() => close(false)}>
                        {pending.cancelLabel || 'Cancel'}
                    </button>
                    <button
                        className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
                        onClick={() => close(true)}
                        autoFocus
                    >
                        {pending.confirmLabel || 'Delete'}
                    </button>
                </div>
            </div>
        </div>
    );
}
