/* App.tsx — Root Application with Router, Layout, and Role-Based Access */

import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
    LayoutDashboard, Users, Calendar, Shield, ScrollText,
    UserPlus, Camera, AlertTriangle, ShieldAlert, DoorOpen, Lock
} from 'lucide-react';
import { emergencyApi } from './api/client';
import { MOCK_ENABLED } from './api/mock';
import { ConfirmHost } from './components/ui/ConfirmDialog';
import { ToastHost } from './components/ui/Toast';
import type { SystemState } from './api/types';

import {
    Dashboard, InsightsDashboard, UsersPage, SchedulePage, PermissionsPage,
    EventsPage, GuestsPage, CameraHealthPage, EmergencyPage, RoomsPage,
    LoginPage, AdminsPage, DoorSimulationPage,
} from './pages';

type UserRole = 'admin' | 'teacher';

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

function Sidebar({ role }: { role: UserRole }) {
    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="sidebar-logo">LS</div>
                <div>
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

function PageTitle() {
    const location = useLocation();
    const titles: Record<string, string> = {
        '/': 'Security Dashboard',
        '/feed': 'Camera Feed',
        '/events': 'Event Log Center',
        '/cameras': 'Camera & Network Health',
        '/rooms': 'Room Management',
        '/doors': 'Door Simulation',
        '/users': 'User Management',
        '/schedule': 'Access Schedules',
        '/permissions': 'Permission Matrix',
        '/guests': 'Guest Access',
        '/emergency': 'Emergency Control',
        '/admins': 'Admin Accounts',
    };
    return <>{titles[location.pathname] || 'LabSecure AI v2'}</>;
}

/** Wraps a page with access check — if teacher, show restricted */
function Guarded({ children, role }: { children: React.ReactNode; role: UserRole }) {
    if (role === 'teacher') return <AccessRestricted />;
    return <>{children}</>;
}

function AppContent() {
    const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('admin_token'));
    const [role, setRole] = useState<UserRole>((localStorage.getItem('admin_role') as UserRole) || 'admin');
    const [emergency, setEmergency] = useState<SystemState | null>(null);

    useEffect(() => {
        if (!isAuthenticated) return;
        const check = () => emergencyApi.status().then(setEmergency).catch(() => { });
        check();
        const interval = setInterval(check, 60000);
        return () => clearInterval(interval);
    }, [isAuthenticated]);

    const handleLogout = () => {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_role');
        setIsAuthenticated(false);
    };

    if (!isAuthenticated) {
        return <LoginPage onLoginSuccess={() => {
            setRole((localStorage.getItem('admin_role') as UserRole) || 'admin');
            setIsAuthenticated(true);
        }} />;
    }

    return (
        <div className="app-layout">
            <Sidebar role={role} />
            <main className="main-content">
                {emergency?.emergency_lock && (
                    <div className="emergency-banner">
                        <AlertTriangle size={16} />
                        EMERGENCY LOCKDOWN ACTIVE — All access revoked
                    </div>
                )}
                <header className="top-bar">
                    <div className="top-bar-left">
                        <h1 className="top-bar-title"><PageTitle /></h1>
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
                        <span className={`badge ${role === 'teacher' ? 'badge-warning' : 'badge-success'}`}>
                            {role === 'teacher' ? '👩‍🏫 Teacher' : '🔑 Admin'}
                        </span>
                        <span className="badge badge-success">
                            <span className="status-dot online" />
                            System Online
                        </span>
                        <button className="btn btn-ghost btn-sm" onClick={handleLogout} style={{ color: 'var(--color-danger)' }}>
                            Logout
                        </button>
                    </div>
                </header>
                <div className="page-content">
                    <Routes>
                        <Route path="/" element={<Guarded role={role}><InsightsDashboard /></Guarded>} />
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
                    </Routes>
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
