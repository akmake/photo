import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Lock, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('idle');

  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('loading');
    const success = await login(email, password);
    if (success) {
      navigate('/admin');
    } else {
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-gray-200 p-8">

        <div className="text-center mb-8">
          <div className="bg-slate-900 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 text-white">
            <Lock size={20} />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">כניסה למורשים בלבד</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">אימייל</label>
            <input
              type="email"
              required
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-slate-200 focus:border-slate-900 outline-none transition text-left"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">סיסמה</label>
            <input
              type="password"
              required
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-slate-200 focus:border-slate-900 outline-none transition text-left"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button
            disabled={status === 'loading'}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white py-3 rounded-lg font-bold transition flex justify-center items-center gap-2"
          >
            {status === 'loading' ? 'מבצע כניסה...' : (
              <>כניסה למערכת <ArrowRight size={18} /></>
            )}
          </button>

          {status === 'error' && (
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg text-center">
              פרטי הזיהוי שגויים או שאין הרשאה מתאימה.
            </div>
          )}
        </form>

        <div className="mt-8 text-center">
          <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-slate-900 transition">
            חזרה לדף הבית
          </button>
        </div>

      </div>
    </div>
  );
}
