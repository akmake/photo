import { useState } from 'react';
import type { PreflightIssue } from './preflightEngine';

interface Props {
  issues: PreflightIssue[];
  onNavigate(issue: PreflightIssue): void;
  onClose(): void;
}

export default function PreflightPanel({ issues, onNavigate, onClose }: Props) {
  const [filter, setFilter] = useState<'all' | PreflightIssue['severity']>('all');
  const shown = filter === 'all' ? issues : issues.filter((issue) => issue.severity === filter);
  const blockers = issues.filter((issue) => issue.severity === 'blocker').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;

  return (
    <div className="preflight-overlay" data-surface="studio" role="dialog" aria-modal="true" aria-label="בדיקת דפוס">
      <header>
        <div>
          <strong>בדיקת דפוס מלאה</strong>
          <span>{blockers ? `${blockers} תקלות חוסמות` : 'אין תקלות חוסמות'} · {warnings} אזהרות</span>
        </div>
        <button onClick={onClose}>חזרה לעורך</button>
      </header>
      <div className="preflight-summary">
        <article className={blockers ? 'bad' : 'good'}>
          <strong>{blockers}</strong><span>חוסמות יצוא</span>
        </article>
        <article className={warnings ? 'warn' : 'good'}>
          <strong>{warnings}</strong><span>דורשות בדיקה</span>
        </article>
        <article>
          <strong>{issues.filter((issue) => issue.severity === 'info').length}</strong><span>מידע</span>
        </article>
      </div>
      <div className="preflight-filters">
        {([
          ['all', 'הכול'],
          ['blocker', 'חוסמות'],
          ['warning', 'אזהרות'],
          ['info', 'מידע'],
        ] as const).map(([value, label]) => (
          <button key={value} className={filter === value ? 'on' : ''} onClick={() => setFilter(value)}>
            {label}
          </button>
        ))}
      </div>
      <main className="preflight-list">
        {shown.map((issue) => (
          <button key={issue.id} className={`preflight-issue ${issue.severity}`} onClick={() => onNavigate(issue)}>
            <span className="issue-severity">
              {issue.severity === 'blocker' ? 'חוסם' : issue.severity === 'warning' ? 'אזהרה' : 'מידע'}
            </span>
            <span className="issue-copy">
              <strong>{issue.title}</strong>
              <small>{issue.detail}</small>
            </span>
            <span className="issue-target">
              {issue.target === 'spread' ? 'מעבר לכפולה' : issue.target === 'cover' ? 'פתיחת כריכה' : issue.target === 'profile' ? 'פתיחת פרופיל' : 'פתיחת אישור'}
            </span>
          </button>
        ))}
        {!shown.length && (
          <div className="preflight-clear">
            <strong>הכול נקי במסנן הזה</strong>
            <span>לא נמצאו בעיות נוספות.</span>
          </div>
        )}
      </main>
    </div>
  );
}
