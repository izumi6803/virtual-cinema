import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles.css';

const AdminApp = lazy(() => import('./components/AdminApp.jsx'));

const path = window.location.pathname.replace(/\/+$/, '');
const isAdmin = path === '/admin' || path.endsWith('/admin');

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <Suspense fallback={<div className="boot">Đang mở…</div>}>
      {isAdmin ? <AdminApp /> : <App />}
    </Suspense>
  </ErrorBoundary>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
