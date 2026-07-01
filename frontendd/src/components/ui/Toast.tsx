/* Toast.tsx — App-wide toast notifications.
   Usage:  toast.success('Camera saved');  toast.error('Failed to save');
   Mount <ToastHost /> once at the app root. */

import { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';
type ToastItem = { id: number; type: ToastType; message: string };

let pushToast: ((t: Omit<ToastItem, 'id'>) => void) | null = null;
let counter = 0;

function emit(type: ToastType, message: string) {
    if (pushToast) pushToast({ type, message });
}

export const toast = {
    success: (message: string) => emit('success', message),
    error: (message: string) => emit('error', message),
    info: (message: string) => emit('info', message),
};

const ICONS: Record<ToastType, typeof CheckCircle> = {
    success: CheckCircle,
    error: AlertCircle,
    info: Info,
};

export function ToastHost() {
    const [items, setItems] = useState<ToastItem[]>([]);

    useEffect(() => {
        pushToast = (t) => {
            const id = ++counter;
            setItems((prev) => [...prev, { ...t, id }]);
            setTimeout(() => {
                setItems((prev) => prev.filter((i) => i.id !== id));
            }, 3500);
        };
        return () => { pushToast = null; };
    }, []);

    const dismiss = (id: number) => setItems((prev) => prev.filter((i) => i.id !== id));

    if (items.length === 0) return null;

    return (
        <div className="toast-container">
            {items.map((item) => {
                const Icon = ICONS[item.type];
                return (
                    <div key={item.id} className={`toast toast-${item.type}`} role="status" aria-live="polite">
                        <Icon size={18} className="toast-icon" />
                        <span className="toast-message">{item.message}</span>
                        <button className="toast-close" onClick={() => dismiss(item.id)} aria-label="Dismiss">
                            <X size={14} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
