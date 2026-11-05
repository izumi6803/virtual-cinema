import AdminView from './AdminView.jsx';
import AuthScreen from './AuthScreen.jsx';
import { useAuth } from '../lib/auth.js';

export default function AdminApp() {
  const auth = useAuth();

  if (auth.loading) return <div className="boot">Đang mở quản trị…</div>;
  if (!auth.user) return <AuthScreen auth={auth} admin />;

  if (auth.user.role !== 'admin') {
    return (
      <main className="admin admin--center">
        <div className="admin-login">
          <p className="eyebrow">
            <span className="eyebrow__dot" />
            Virtual Cinema · Quản trị
          </p>
          <h1>Không có quyền</h1>
          <p className="admin-login__lede">
            Tài khoản {auth.user.email} không phải quản trị viên. Đăng xuất và dùng tài khoản admin
            được cấp.
          </p>
          <button type="button" className="btn btn--primary" onClick={auth.logout}>
            Đăng xuất
          </button>
        </div>
      </main>
    );
  }

  return <AdminView auth={auth} />;
}
