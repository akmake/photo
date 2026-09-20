import { Link, useNavigate } from 'react-router-dom';
import { BRAND } from './brand';
import { useAuth } from './auth';

export function Nav() {
  const { me, signOut } = useAuth();
  const nav = useNavigate();
  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <Link to="/" className="brand">
          <span className="brand-badge" />
          {BRAND}
        </Link>
        <div className="nav-links">
          <a href="/#features">יכולות</a>
          <a href="/#pricing">מחירים</a>
          {me ? (
            <>
              <Link to="/portal">האזור שלי</Link>
              <button className="btn btn-ghost" onClick={() => { signOut(); nav('/'); }}>יציאה</button>
            </>
          ) : (
            <>
              <Link to="/login">כניסה</Link>
              <Link to="/register" className="btn btn-primary">התחלה</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap row">
        <div className="brand"><span className="brand-badge" />{BRAND}</div>
        <div>© {new Date().getFullYear()} {BRAND}. כל הזכויות שמורות.</div>
      </div>
    </footer>
  );
}
