import { createRoot } from 'react-dom/client';
import AdminApp from './components/AdminApp.jsx';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles.css';

const path = window.location.pathname.replace(/\/+$/, '');
const isAdmin = path === '/admin' || path.endsWith('/admin');

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>{isAdmin ? <AdminApp /> : <App />}</ErrorBoundary>,
);
