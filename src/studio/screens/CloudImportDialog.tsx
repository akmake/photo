import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cloudFolder, cloudStatus, connectCloud, disconnectCloud,
} from '../../api';
import type {
  CloudEntry, CloudProvider, CloudProviderStatus,
} from '../../api';
import { IcChevron, IcCloud, IcFolder } from '../../design/Icons';

const NAMES: Record<CloudProvider, string> = {
  google: 'Google Drive',
  dropbox: 'Dropbox',
};

type Crumb = { id?: string; name: string };

export default function CloudImportDialog({
  provider,
  onClose,
  onImport,
}: {
  provider: CloudProvider;
  onClose: () => void;
  onImport: (entries: CloudEntry[]) => Promise<void>;
}) {
  const [connection, setConnection] = useState<CloudProviderStatus | null>(null);
  const [entries, setEntries] = useState<CloudEntry[]>([]);
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ name: NAMES[provider] }]);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const status = (await cloudStatus())[provider];
    setConnection(status);
    return status;
  }, [provider]);

  const loadFolder = useCallback(async (id?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await cloudFolder(provider, id);
      setEntries(result.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'לא ניתן לקרוא את התיקייה');
    } finally {
      setLoading(false);
    }
  }, [provider]);

  const checkConnection = useCallback(async () => {
    setChecking(true);
    setConnection(null);
    setError(null);
    try {
      const status = await loadStatus();
      if (status.connected) await loadFolder();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'לא ניתן לבדוק את החיבור');
    } finally {
      setChecking(false);
    }
  }, [loadFolder, loadStatus]);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const url = await connectCloud(provider);
      const opened = window.open(url, '_blank');
      if (!opened) throw new Error('הדפדפן חסם את חלון החיבור. יש לאפשר חלונות קופצים ולנסות שוב.');
      opened.opener = null;
      const until = Date.now() + 5 * 60_000;
      while (Date.now() < until) {
        await new Promise((resolve) => window.setTimeout(resolve, 1400));
        const status = await loadStatus();
        if (status.connected) {
          await loadFolder();
          return;
        }
      }
      setError('החיבור לא הושלם. אפשר לנסות שוב.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'החיבור נכשל');
    } finally {
      setConnecting(false);
    }
  }, [loadFolder, loadStatus, provider]);

  const openFolder = useCallback((entry: CloudEntry) => {
    setCrumbs((current) => [...current, { id: entry.id, name: entry.name }]);
    void loadFolder(entry.id);
  }, [loadFolder]);

  const jump = useCallback((index: number) => {
    const next = crumbs.slice(0, index + 1);
    setCrumbs(next);
    void loadFolder(next[index].id);
  }, [crumbs, loadFolder]);

  const images = useMemo(() => entries.filter((entry) => entry.kind === 'image'), [entries]);
  const browsing = connection?.connected === true;

  const runImport = useCallback(async () => {
    setImporting(true);
    setError(null);
    try {
      await onImport(images);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הייבוא נכשל');
    } finally {
      setImporting(false);
    }
  }, [images, onClose, onImport]);

  const disconnect = useCallback(async () => {
    await disconnectCloud(provider);
    setConnection({ configured: true, connected: false });
    setEntries([]);
    setCrumbs([{ name: NAMES[provider] }]);
  }, [provider]);

  return (
    <div className="scrim" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !importing) onClose();
    }}>
      <section className={`dialog cloud-dialog ${browsing ? '' : 'cloud-dialog-compact'}`} role="dialog" aria-modal="true" aria-label={`ייבוא מהענן: ${NAMES[provider]}`}>
        <header className="dialog-head">
          <IcCloud size={20} />
          <h2><span>ייבוא מהענן</span><bdi dir="ltr">{NAMES[provider]}</bdi></h2>
          <button className="dialog-x" onClick={onClose} disabled={importing} aria-label="סגירה">×</button>
        </header>

        {checking ? (
          <div className="cloud-message" aria-live="polite">
            <IcCloud size={28} />
            <strong>בודק את החיבור…</strong>
          </div>
        ) : !connection ? (
          <div className="cloud-message cloud-message-failed">
            <strong>לא הצלחנו להגיע למנוע המקומי של TEZA</strong>
            <p>הייבוא מהענן זמין רק כשהמנוע המקומי פועל. אפשר להפעיל מחדש את TEZA ולנסות שוב.</p>
            {error && <p className="cloud-message-detail">{error}</p>}
            <button className="btn btn-primary" onClick={checkConnection}>נסה שוב</button>
          </div>
        ) : !connection.configured ? (
          <div className="cloud-message">
            <strong>הייבוא מהענן עדיין אינו פעיל בהתקנה הזאת</strong>
            <p>זו הגדרת התקנה של TEZA, ולא בעיה בחשבון שלך. לאחר שהחיבור יוגדר, כפתור ההתחברות יופיע כאן.</p>
            <button className="btn" onClick={onClose}>סגור</button>
          </div>
        ) : !connection.connected ? (
          <div className="cloud-message">
            <strong>מחברים פעם אחת, ומייבאים בכל פרויקט</strong>
            <p>TEZA תבקש הרשאת קריאה בלבד. שום קובץ בענן לא יימחק או ישתנה.</p>
            <button className="btn btn-primary" onClick={connect} disabled={connecting}>
              <IcCloud size={16} />
              {connecting ? 'ממתין לאישור…' : `חבר את ${NAMES[provider]}`}
            </button>
            {error && <p className="cloud-message-detail">{error}</p>}
          </div>
        ) : (
          <>
            <nav className="cloud-crumbs" aria-label="מיקום בענן">
              {crumbs.map((crumb, index) => (
                <span key={`${crumb.id ?? 'root'}-${index}`}>
                  {index > 0 && <IcChevron size={13} />}
                  <button onClick={() => jump(index)} disabled={loading || importing}>{crumb.name}</button>
                </span>
              ))}
            </nav>
            <div className="cloud-list">
              {error && <p className="cm-error cloud-list-error">{error}</p>}
              {loading ? (
                <p className="pf-note">קורא את התיקייה…</p>
              ) : entries.length === 0 ? (
                <p className="pf-note">אין כאן תיקיות או תמונות נתמכות.</p>
              ) : entries.map((entry) => (
                entry.kind === 'folder' ? (
                  <button className="cloud-row cloud-folder" key={entry.id} onClick={() => openFolder(entry)}>
                    <IcFolder size={18} />
                    <b>{entry.name}</b>
                    <IcChevron size={15} />
                  </button>
                ) : (
                  <div className="cloud-row" key={entry.id}>
                    <span className="cloud-file-dot" />
                    <b dir="ltr">{entry.name}</b>
                    <small className="mono">{entry.size ? `${(entry.size / 1_048_576).toFixed(1)} MB` : ''}</small>
                  </div>
                )
              ))}
            </div>
            <footer className="dialog-foot cloud-foot">
              <button className="cloud-disconnect" onClick={disconnect} disabled={loading || importing}>נתק חשבון</button>
              <span>{images.length.toLocaleString('he-IL')} תמונות בתיקייה</span>
              <button className="btn btn-primary" onClick={runImport} disabled={!images.length || loading || importing}>
                {importing ? 'מייבא…' : 'ייבא את התיקייה'}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
