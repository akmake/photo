// Talks to the local Python engine (sidecar) over localhost.
// Images never leave the machine.
const ENGINE = 'http://127.0.0.1:8756';

export async function checkEngine(): Promise<boolean> {
  try {
    const r = await fetch(`${ENGINE}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

async function urlToDataURL(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

export interface SkinResult {
  image: string; // data URL of the processed image
  skinCoverage: number; // 0..1 fraction detected as skin
}

export async function smoothSkin(
  imageUrl: string,
  strength: number,
): Promise<SkinResult> {
  const dataUrl = await urlToDataURL(imageUrl);
  const r = await fetch(`${ENGINE}/tools/skin-smooth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl, strength }),
  });
  if (!r.ok) throw new Error(`engine ${r.status}`);
  return r.json();
}
