import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BRAND } from '../brand';
import { api, assetUrl } from '../api';

type Img = { id: number; thumb_url: string | null; preview_url: string | null; selected: boolean; note: string };

// The secure page the photographer sends to the client. No account — a link and,
// if set, an access code. The client marks selections; they flow back to the app.
export default function ClientGallery() {
  const { token = '' } = useParams();
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [images, setImages] = useState<Img[]>([]);
  const [err, setErr] = useState('');
  const [opened, setOpened] = useState(false);

  async function open(withCode?: string) {
    setErr('');
    try {
      const r = await api.openGallery(token, withCode);
      setTitle(r.title);
      setClient(r.client_name);
      setImages(r.images);
      setOpened(true);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('קוד')) { setNeedCode(true); setErr(withCode ? msg : ''); }
      else setErr(msg);
    }
  }

  useEffect(() => { open(); /* try without code first */ }, [token]);

  async function toggle(im: Img) {
    const next = !im.selected;
    setImages((list) => list.map((x) => (x.id === im.id ? { ...x, selected: next } : x)));
    try { await api.selectImage(token, im.id, next, im.note, code || undefined); }
    catch { setImages((list) => list.map((x) => (x.id === im.id ? { ...x, selected: im.selected } : x))); }
  }

  if (!opened && needCode) {
    return (
      <div className="gate">
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 20 }}><span className="brand-badge" />{BRAND}</div>
        <div className="authcard">
          <h1>גלריה פרטית</h1>
          <p className="muted">הזן את קוד הגישה שקיבלת מהצלם.</p>
          {err && <div className="error">{err}</div>}
          <div className="field"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="קוד גישה" style={{ textAlign: 'center', letterSpacing: 4 }} /></div>
          <button className="btn btn-primary btn-block btn-lg" onClick={() => open(code)}>כניסה</button>
        </div>
      </div>
    );
  }

  if (!opened) {
    return <div className="gate">{err ? <div className="error">{err}</div> : 'טוען…'}</div>;
  }

  const chosen = images.filter((i) => i.selected).length;

  return (
    <div className="wrap">
      <div className="client-head">
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 14 }}><span className="brand-badge" />{BRAND}</div>
        <h1>{title || 'הגלריה שלך'}</h1>
        <p>{client ? `שלום ${client}, ` : ''}בחר/י את התמונות האהובות — {chosen} נבחרו</p>
      </div>
      <div className="grid-photos">
        {images.map((im) => (
          <div key={im.id} className={`photo ${im.selected ? 'selected' : ''}`} onClick={() => toggle(im)}>
            {assetUrl(im.thumb_url || im.preview_url)
              ? <img src={assetUrl(im.thumb_url || im.preview_url)} alt="" loading="lazy" />
              : null}
            <div className="pick">{im.selected ? '✓' : ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
