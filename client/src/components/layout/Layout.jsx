import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Navbar />

      <main className="flex-grow pt-16">
        <Outlet />
      </main>

      <footer className="bg-slate-900 text-slate-400 py-6 border-t border-slate-800 text-sm">
        <div className="container mx-auto px-4 text-center">
          <p>© {new Date().getFullYear()} כל הזכויות שמורות.</p>
        </div>
      </footer>
    </div>
  );
}
