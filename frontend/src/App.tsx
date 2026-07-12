/* App.tsx — Root Application with Router, Layout, and Role-Based Access */

import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import {
    LayoutDashboard, Users, Calendar, Shield, ScrollText,
    UserPlus, Camera, AlertTriangle, ShieldAlert, DoorOpen, Lock, Menu
} from 'lucide-react';
import { emergencyApi } from './api/client';
import { MOCK_ENABLED } from './api/mock';
import { ConfirmHost, confirmDialog } from './components/ui/ConfirmDialog';
import { ToastHost } from './components/ui/Toast';
import { clearSession, getStoredRole, isSessionValid } from './api/authSession';
import type { SystemState } from './api/types';

import {
    Dashboard, InsightsDashboard, UsersPage, SchedulePage, PermissionsPage,
    EventsPage, GuestsPage, CameraHealthPage, EmergencyPage, RoomsPage,
    LoginPage, AdminsPage, DoorSimulationPage, DoorRoomPage,
} from './pages';

type UserRole = 'admin' | 'teacher';

function useIsNarrow() {
    const [narrow, setNarrow] = useState(() =>
        typeof window !== 'undefined' && window.matchMedia('(max-width: 520px)').matches
    );
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 520px)');
        const handler = () => setNarrow(mq.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);
    return narrow;
}

// Pages teachers can access
const TEACHER_ALLOWED_PATHS = ['/schedule'];

const navItems = [
    {
        section: 'Monitoring', items: [
            { path: '/', label: 'Dashboard', icon: LayoutDashboard },
            { path: '/feed', label: 'Camera Feed', icon: Camera },
            { path: '/doors', label: 'Door Simulation', icon: Lock },
            { path: '/events', label: 'Event Log', icon: ScrollText },
            { path: '/cameras', label: 'Camera Health', icon: Camera },
        ]
    },
    {
        section: 'Management', items: [
            { path: '/rooms', label: 'Rooms', icon: DoorOpen },
            { path: '/users', label: 'Users', icon: Users },
            { path: '/schedule', label: 'Schedules', icon: Calendar },
            { path: '/permissions', label: 'Permissions', icon: Shield },
            { path: '/guests', label: 'Guest Access', icon: UserPlus },
        ]
    },
    {
        section: 'System', items: [
            { path: '/emergency', label: 'Emergency Control', icon: ShieldAlert },
            { path: '/admins', label: 'Admin Accounts', icon: Shield },
        ]
    },
];

function AccessRestricted() {
    return (
        <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '80px 20px', textAlign: 'center',
        }}>
            <div style={{
                width: 80, height: 80, borderRadius: '50%',
                background: 'var(--color-danger-bg)', color: 'var(--color-danger)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 24,
            }}>
                <Lock size={36} />
            </div>
            <h2 style={{ margin: '0 0 8px', color: 'var(--text-main)', fontSize: 22 }}>
                Access Restricted
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, maxWidth: 400, margin: 0, lineHeight: 1.5 }}>
                You don't have permission to view this section.
                Please contact an administrator if you need access.
            </p>
        </div>
    );
}

function Sidebar({ role, isOpen, onClose }: { role: UserRole; isOpen: boolean; onClose: () => void }) {
    return (
        <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
            <div className="sidebar-header">
                <div className="sidebar-logo">LS</div>
                <div style={{ flex: 1 }}>
                    <div className="sidebar-title">LabSecure AI</div>
                    <div className="sidebar-subtitle">v2.0 — Telematics Lab</div>
                </div>
            </div>
            <nav className="sidebar-nav">
                {navItems.map(section => {
                    const items = section.items.filter(
                        item => role !== 'teacher' || TEACHER_ALLOWED_PATHS.includes(item.path)
                    );
                    if (items.length === 0) return null;
                    return (
                        <div key={section.section}>
                            <div className="nav-section-label">{section.section}</div>
                            {items.map(item => (
                                <NavLink
                                    key={item.path}
                                    to={item.path}
                                    end={item.path === '/'}
                                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                                    onClick={onClose}
                                >
                                    <item.icon />
                                    {item.label}
                                </NavLink>
                            ))}
                        </div>
                    );
                })}
            </nav>
        </aside>
    );
}

function PageTitle({ compact }: { compact?: boolean }) {
    const location = useLocation();
    const doorRoomMatch = location.pathname.match(/^\/doors\/([^/]+)$/);
    const titles: Record<string, string> = {
        '/': compact ? 'Dashboard' : 'Security Dashboard',
        '/feed': 'Camera Feed',
        '/events': compact ? 'Events' : 'Event Log Center',
        '/cameras': compact ? 'Cameras' : 'Camera & Network Health',
        '/rooms': compact ? 'Rooms' : 'Room Management',
        '/doors': 'Door Simulation',
        '/users': compact ? 'Users' : 'User Management',
        '/schedule': compact ? 'Schedules' : 'Access Schedules',
        '/permissions': compact ? 'Permissions' : 'Permission Matrix',
        '/guests': 'Guest Access',
        '/emergency': compact ? 'Emergency' : 'Emergency Control',
        '/admins': compact ? 'Admins' : 'Admin Accounts',
    };
    if (doorRoomMatch) {
        return <>Room Door</>;
    }
    return <>{titles[location.pathname] || 'LabSecure AI v2'}</>;
}

/** Wraps a page with access check — if teacher, show restricted */
function Guarded({ children, role }: { children: React.ReactNode; role: UserRole }) {
    if (role === 'teacher') return <AccessRestricted />;
    return <>{children}</>;
}

/** Redirect teachers away from pages they cannot access */
function TeacherRouteGuard({ role, children }: { role: UserRole; children: React.ReactNode }) {
    const location = useLocation();
    if (role === 'teacher' && !TEACHER_ALLOWED_PATHS.includes(location.pathname)) {
        return <Navigate to="/schedule" replace />;
    }
    return <>{children}</>;
}

function AppContent() {
    const navigate = useNavigate();
    const [isAuthenticated, setIsAuthenticated] = useState(isSessionValid);
    const [role, setRole] = useState<UserRole>(getStoredRole);
    const [emergency, setEmergency] = useState<SystemState | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const isNarrow = useIsNarrow();

    const expireSession = useCallback(() => {
        clearSession();
        setIsAuthenticated(false);
    }, []);

    useEffect(() => {
        if (!isAuthenticated) return;

        const checkExpiry = () => {
            if (!isSessionValid()) expireSession();
        };

        checkExpiry();
        const interval = setInterval(checkExpiry, 30000);
        return () => clearInterval(interval);
    }, [isAuthenticated, expireSession]);

    useEffect(() => {
        if (!isAuthenticated) return;
        const check = () => emergencyApi.status().then(setEmergency).catch(() => { });
        check();
        const interval = setInterval(check, 60000);
        return () => clearInterval(interval);
    }, [isAuthenticated]);

    const handleLogout = async () => {
        const confirmed = await confirmDialog({
            title: 'Log out?',
            message: 'Are you sure you want to end your session?',
            confirmLabel: 'Log out',
            cancelLabel: 'Stay signed in',
            danger: true,
        });
        if (!confirmed) return;
        clearSession();
        setIsAuthenticated(false);
    };

    if (!isAuthenticated) {
        return <LoginPage onLoginSuccess={(_token, loginRole) => {
            setRole(loginRole as UserRole);
            setIsAuthenticated(true);
            if (loginRole === 'teacher') {
                navigate('/schedule', { replace: true });
            }
        }} />;
    }

    return (
        <div className="app-layout">
            {isSidebarOpen && (
                <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)} />
            )}
            <Sidebar role={role} isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
            <main className="main-content">
                {emergency?.emergency_lock && (
                    <div className="emergency-banner">
                        <AlertTriangle size={16} />
                        EMERGENCY LOCKDOWN ACTIVE — All access revoked
                    </div>
                )}
                <header className="top-bar">
                    <div className="top-bar-left" style={{ display: 'flex', alignItems: 'center' }}>
                        <button className="menu-toggle-btn" onClick={() => setIsSidebarOpen(true)} aria-label="Open menu">
                            <Menu size={22} />
                        </button>
                        <h1 className="top-bar-title"><PageTitle compact={isNarrow} /></h1>
                    </div>
                    <div className="top-bar-right" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        {MOCK_ENABLED && (
                            <select
                                value={role}
                                onChange={(e) => {
                                    const next = e.target.value as UserRole;
                                    localStorage.setItem('admin_role', next);
                                    setRole(next);
                                }}
                                title="Mock mode: switch role"
                                style={{
                                    padding: '4px 8px', borderRadius: 6, fontSize: 13,
                                    border: '1px dashed var(--color-primary)', background: 'var(--bg-card)',
                                    color: 'var(--text-main)', cursor: 'pointer',
                                }}
                            >
                                <option value="admin">🔑 Admin (mock)</option>
                                <option value="teacher">👩‍🏫 Teacher (mock)</option>
                            </select>
                        )}
                        <span className={`badge top-bar-role-badge ${role === 'teacher' ? 'badge-warning' : 'badge-success'}`}>
                            {role === 'teacher' ? '👩‍🏫 Teacher' : '🔑 Admin'}
                        </span>
                        <span className="badge badge-success top-bar-status-badge">
                            <span className="status-dot online" />
                            System Online
                        </span>
                        <button className="btn btn-ghost btn-sm top-bar-logout" onClick={handleLogout} style={{ color: 'var(--color-danger)' }}>
                            Logout
                        </button>
                    </div>
                </header>
                <div className="page-content">
                    <TeacherRouteGuard role={role}>
                    <Routes>
                        <Route path="/" element={
                            role === 'teacher'
                                ? <Navigate to="/schedule" replace />
                                : <Guarded role={role}><InsightsDashboard /></Guarded>
                        } />
                        <Route path="/feed" element={<Guarded role={role}><Dashboard /></Guarded>} />
                        <Route path="/rooms" element={<Guarded role={role}><RoomsPage /></Guarded>} />
                        <Route path="/users" element={<Guarded role={role}><UsersPage /></Guarded>} />
                        <Route path="/schedule" element={<SchedulePage role={role} />} />
                        <Route path="/permissions" element={<Guarded role={role}><PermissionsPage /></Guarded>} />
                        <Route path="/events" element={<Guarded role={role}><EventsPage /></Guarded>} />
                        <Route path="/guests" element={<Guarded role={role}><GuestsPage /></Guarded>} />
                        <Route path="/cameras" element={<Guarded role={role}><CameraHealthPage /></Guarded>} />
                        <Route path="/emergency" element={<Guarded role={role}><EmergencyPage /></Guarded>} />
                        <Route path="/admins" element={<Guarded role={role}><AdminsPage /></Guarded>} />
                        <Route path="/doors" element={<Guarded role={role}><DoorSimulationPage /></Guarded>} />
                        <Route path="/doors/:roomId" element={<Guarded role={role}><DoorRoomPage /></Guarded>} />
                    </Routes>
                    </TeacherRouteGuard>
                </div>
            </main>
        </div>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <AppContent />
            <ConfirmHost />
            <ToastHost />
        </BrowserRouter>
    );
}
