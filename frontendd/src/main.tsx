import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Clear auth tokens on page reload/close to enforce sign in
window.addEventListener('beforeunload', () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_role');
});

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
