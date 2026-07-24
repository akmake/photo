// Talks to the local Python engine (sidecar) over localhost.
// Images never leave the machine. In the browser dev harness images travel as
// data URLs; in the packaged Electron app they'll travel as local file paths.
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

export interface AiToolResult {
  image: string; // data URL of the processed image
  meta?: Record<string, number>;
}

// Uniform call for any AI tool: POST /tools/{id}/apply.
export async function applyAiTool(
  toolId: string,
  imageUrlOrData: string,
  params: Record<string, number>,
): Promise<AiToolResult> {
  const image = imageUrlOrData.startsWith('data:')
    ? imageUrlOrData
    : await urlToDataURL(imageUrlOrData);
  const r = await fetch(`${ENGINE}/tools/${toolId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, params }),
  });
  if (!r.ok) throw new Error(`engine ${r.status}`);
  return r.json();
}
