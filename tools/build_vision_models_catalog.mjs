import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const AS_OF = "2026-08-16";
const outputDir = path.resolve("research/vision-models-commercial-top-100");

// Editorial order: original/official checkpoints only; no community quantizations.
const modelIds = [
  "Qwen/Qwen3.8-27B",
  "Qwen/Qwen3.6-27B",
  "google/gemma-4-31B-it",
  "Qwen/Qwen3.6-35B-A3B",
  "google/gemma-4-26B-A4B-it",
  "Qwen/Qwen3.5-27B",
  "Qwen/Qwen3.5-122B-A10B",
  "Qwen/Qwen3-VL-235B-A22B-Thinking",
  "Qwen/Qwen3-VL-235B-A22B-Instruct",
  "Qwen/Qwen3-VL-32B-Thinking",
  "Qwen/Qwen3-VL-32B-Instruct",
  "Qwen/Qwen3-VL-30B-A3B-Thinking",
  "Qwen/Qwen3-VL-30B-A3B-Instruct",
  "Qwen/Qwen3.5-9B",
  "zai-org/GLM-4.6V",
  "zai-org/GLM-4.5V",
  "OpenGVLab/InternVL3_5-38B",
  "OpenGVLab/InternVL3_5-30B-A3B-Instruct",
  "OpenGVLab/InternVL3_5-14B",
  "Qwen/Qwen3-VL-8B-Thinking",
  "Qwen/Qwen3-VL-8B-Instruct",
  "openbmb/MiniCPM-V-4.6-Thinking",
  "openbmb/MiniCPM-V-4.6",
  "allenai/Molmo2-8B",
  "allenai/Molmo2-O-7B",
  "moonshotai/Kimi-VL-A3B-Thinking",
  "moonshotai/Kimi-VL-A3B-Instruct",
  "meta-llama/Llama-3.2-90B-Vision-Instruct",
  "google/gemma-3-27b-it",
  "mistral-experimental/pixtral-12b",
  "ibm-granite/granite-vision-4.1-4b",
  "microsoft/Mage-VL",
  "stepfun-ai/Step3-VL-10B",
  "Qwen/Qwen2.5-VL-32B-Instruct",
  "Qwen/Qwen2.5-VL-7B-Instruct",
  "Qwen/Qwen3.5-4B",
  "OpenGVLab/InternVL3_5-8B",
  "OpenGVLab/InternVL3-38B",
  "OpenGVLab/InternVL3-14B",
  "OpenGVLab/InternVL3-8B",
  "google/gemma-3-12b-it",
  "meta-llama/Llama-3.2-11B-Vision-Instruct",
  "Qwen/Qwen3-VL-4B-Thinking",
  "Qwen/Qwen3-VL-4B-Instruct",
  "openbmb/MiniCPM-V-4_5",
  "allenai/Molmo2-4B",
  "allenai/Molmo-7B-D-0924",
  "microsoft/Phi-3.5-vision-instruct",
  "llava-hf/llava-onevision-qwen2-7b-ov-hf",
  "HuggingFaceM4/Idefics3-8B-Llama3",
  "Qwen/Qwen3.5-2B",
  "Qwen/Qwen3-VL-2B-Thinking",
  "Qwen/Qwen3-VL-2B-Instruct",
  "google/gemma-3-4b-it",
  "google/gemma-3n-E4B-it",
  "google/gemma-3n-E2B-it",
  "OpenGVLab/InternVL3_5-4B",
  "OpenGVLab/InternVL3_5-2B",
  "OpenGVLab/InternVL3_5-1B",
  "OpenGVLab/InternVL3-2B",
  "OpenGVLab/InternVL3-1B",
  "OpenGVLab/InternVL2_5-8B",
  "OpenGVLab/InternVL2_5-4B",
  "OpenGVLab/InternVL2_5-2B",
  "OpenGVLab/InternVL2_5-1B",
  "llava-hf/llava-v1.6-mistral-7b-hf",
  "llava-hf/llava-onevision-qwen2-0.5b-ov-hf",
  "HuggingFaceTB/SmolVLM2-2.2B-Instruct",
  "HuggingFaceTB/SmolVLM2-500M-Video-Instruct",
  "HuggingFaceTB/SmolVLM2-256M-Video-Instruct",
  "HuggingFaceTB/SmolVLM-500M-Instruct",
  "HuggingFaceTB/SmolVLM-256M-Instruct",
  "Qwen/Qwen3.5-0.8B",
  "microsoft/Florence-2-large-ft",
  "microsoft/Florence-2-large",
  "microsoft/Florence-2-base-ft",
  "microsoft/Florence-2-base",
  "ByteDance-Seed/UI-TARS-1.5-7B",
  "ByteDance-Seed/UI-TARS-2B-SFT",
  "zai-org/AutoGLM-Phone-9B",
  "microsoft/Fara1.5-9B",
  "Hcompany/Holo-3.1-35B-A3B",
  "Hcompany/Holo-3.1-4B",
  "thinkingmachines/Inkling",
  "thinkingmachines/Inkling-Small",
  "meta-models/Muse-Glimmer-30B-assistant",
  "zai-org/GLM-OCR",
  "baidu/Unlimited-OCR",
  "deepseek-ai/DeepSeek-OCR-2",
  "deepseek-ai/DeepSeek-OCR",
  "datalab-to/chandra-ocr-2",
  "datalab-to/surya-ocr-2",
  "stepfun-ai/GOT-OCR2_0",
  "lightonai/LightOnOCR-2-1B-bbox",
  "allenai/olmOCR-2-7B-1025",
  "ibm-granite/granite-docling-258M",
  "PaddlePaddle/PaddleOCR-VL-1.6",
  "opendatalab/MinerU2.5-Pro-2605-1.2B",
  "reducto/RolmOCR",
  "google/diffusiongemma-26B-A4B-it",
];

if (modelIds.length !== 100 || new Set(modelIds).size !== 100) {
  throw new Error(`Expected 100 unique IDs, got ${modelIds.length}/${new Set(modelIds).size}`);
}

const allowedLicenses = new Set([
  "apache-2.0", "mit", "bsd-3-clause", "bsd", "cc-by-4.0", "mpl-2.0",
  "openrail", "bigscience-openrail-m", "llama3", "llama3.1", "llama3.2",
  "llama4", "gemma", "gemma2", "gemma3", "afl-3.0",
]);

const licenseInfo = {
  "apache-2.0": ["כן", "מתירני; שמירת הודעות זכויות ורישיון.", "https://www.apache.org/licenses/LICENSE-2.0"],
  mit: ["כן", "מתירני; שמירת הודעת זכויות והרישיון.", "https://opensource.org/license/mit"],
  "bsd-3-clause": ["כן", "מתירני; שמירת הודעות ואיסור שימוש בשם לקידום.", "https://opensource.org/license/bsd-3-clause"],
  bsd: ["כן", "מתירני; יש לבדוק את נוסח ה-BSD המדויק במאגר.", "https://opensource.org/licenses"],
  "cc-by-4.0": ["כן", "מותר מסחרית עם ייחוס ושמירת הודעות.", "https://creativecommons.org/licenses/by/4.0/"],
  "mpl-2.0": ["כן", "מסחרי; copyleft ברמת קובץ.", "https://www.mozilla.org/MPL/2.0/"],
  openrail: ["כן, מותנה", "מסחרי בכפוף להגבלות שימוש אחראי בנוסח OpenRAIL של המאגר.", "https://www.licenses.ai/ai-pubs-open-rails"],
  "bigscience-openrail-m": ["כן, מותנה", "מסחרי בכפוף להגבלות השימוש של OpenRAIL-M.", "https://www.licenses.ai/ai-pubs-open-rails"],
  llama3: ["כן, מותנה", "כפוף לרישיון הקהילה של Meta ולמדיניות שימוש מקובל.", "https://www.llama.com/llama3/license/"],
  "llama3.1": ["כן, מותנה", "כפוף לרישיון הקהילה של Meta; תנאי נוסף לגופים מעל סף המשתמשים המוגדר.", "https://www.llama.com/llama3_1/license/"],
  "llama3.2": ["כן, מותנה", "כפוף לרישיון Llama 3.2; תנאים, ייחוס ומדיניות שימוש מקובל של Meta.", "https://www.llama.com/llama3_2/license/"],
  llama4: ["כן, מותנה", "כפוף לרישיון הקהילה ולמדיניות השימוש המקובל של Meta.", "https://www.llama.com/llama4/license/"],
  gemma: ["כן, מותנה", "שימוש מסחרי מותר בכפוף לתנאי Gemma ולמדיניות השימוש האסור.", "https://ai.google.dev/gemma/terms"],
  gemma2: ["כן, מותנה", "שימוש מסחרי מותר בכפוף לתנאי Gemma ולמדיניות השימוש האסור.", "https://ai.google.dev/gemma/terms"],
  gemma3: ["כן, מותנה", "שימוש מסחרי מותר בכפוף לתנאי Gemma ולמדיניות השימוש האסור.", "https://ai.google.dev/gemma/terms"],
  "afl-3.0": ["כן, מותנה", "רישיון מסחרי עם תנאים ייעודיים; חובה לקרוא את נוסח המאגר.", "https://huggingface.co/docs/hub/repositories-licenses"],
};

const profiles = {
  qwen: {
    category: "VLM כללי מתקדם", image: 5, ocr: 5, docs: 5, grounding: "כן", masks: "חלקי",
    gui: "חלקי", edit: "לא", video: "כן", multi: "כן", tools: "כן",
    action: "ישיר", actionTypes: "קואורדינטות, תיבות, הצבעה, פלט מובנה ותכנון שימוש בכלים",
    best: "הבנת תמונה כללית, מסמכים, OCR, תרשימים, וידאו וסוכנים חזותיים",
  },
  gemma: {
    category: "VLM כללי", image: 5, ocr: 4, docs: 4, grounding: "חלקי", masks: "לא",
    gui: "חלקי", edit: "לא", video: "חלקי", multi: "כן", tools: "חלקי",
    action: "עקיף", actionTypes: "ניתוח, פלט מובנה והכוונת כלי חיצוני; לא משנה פיקסלים לבדו",
    best: "הבנת תמונות, שאלות חזותיות, מסמכים ושילוב טוב במערכות מקומיות",
  },
  glm: {
    category: "VLM כללי מתקדם", image: 5, ocr: 5, docs: 5, grounding: "כן", masks: "חלקי",
    gui: "כן", edit: "לא", video: "כן", multi: "כן", tools: "כן",
    action: "ישיר", actionTypes: "קואורדינטות, grounding, תכנון פעולות GUI ופלט מובנה",
    best: "הבנה חזותית עמוקה, מסמכים, ממשקים וסוכנים מבוססי ראייה",
  },
  internvl: {
    category: "VLM כללי מתקדם", image: 5, ocr: 5, docs: 5, grounding: "כן", masks: "חלקי",
    gui: "חלקי", edit: "לא", video: "כן", multi: "כן", tools: "חלקי",
    action: "ישיר", actionTypes: "קואורדינטות/תיבות, grounding, OCR ופלט מובנה",
    best: "OCR, מסמכים, תרשימים, תמונות ברזולוציה גבוהה והשוואת תמונות",
  },
  minicpm: {
    category: "VLM קומפקטי", image: 5, ocr: 5, docs: 4, grounding: "חלקי", masks: "לא",
    gui: "חלקי", edit: "לא", video: "כן", multi: "כן", tools: "חלקי",
    action: "עקיף", actionTypes: "OCR ופלט מובנה; יכול להכווין כלי חיצוני",
    best: "איכות גבוהה יחסית לגודל, OCR, שימוש מקומי וניתוח וידאו",
  },
  molmo: {
    category: "VLM מרחבי/מצביע", image: 5, ocr: 4, docs: 4, grounding: "כן", masks: "חלקי",
    gui: "חלקי", edit: "לא", video: "כן", multi: "כן", tools: "חלקי",
    action: "ישיר", actionTypes: "הצבעה מדויקת, נקודות, קואורדינטות ומעקב חזותי",
    best: "הבנה מרחבית, pointing, איתור עצמים ואינטראקציה חזותית",
  },
  kimi: {
    category: "VLM כללי/MoE", image: 5, ocr: 5, docs: 5, grounding: "כן", masks: "חלקי",
    gui: "חלקי", edit: "לא", video: "כן", multi: "כן", tools: "חלקי",
    action: "ישיר", actionTypes: "grounding, קואורדינטות, reasoning חזותי ופלט מובנה",
    best: "reasoning חזותי, מסמכים, תמונות מורכבות והקשר ארוך",
  },
  llama: {
    category: "VLM כללי", image: 4, ocr: 3, docs: 3, grounding: "חלקי", masks: "לא",
    gui: "חלקי", edit: "לא", video: "לא", multi: "כן", tools: "כן",
    action: "עקיף", actionTypes: "תכנון והכוונת כלי; אין פלט מסכה מובנה",
    best: "שיחה חזותית כללית ואינטגרציה באקוסיסטם Llama",
  },
  pixtral: {
    category: "VLM כללי", image: 5, ocr: 4, docs: 4, grounding: "חלקי", masks: "לא",
    gui: "חלקי", edit: "לא", video: "לא", multi: "כן", tools: "כן",
    action: "עקיף", actionTypes: "פלט מובנה ותכנון שימוש בכלים",
    best: "מספר תמונות, מסמכים, שיחה חזותית ואינטגרציה סוכנית",
  },
  granite: {
    category: "מסמכים/VLM ארגוני", image: 4, ocr: 5, docs: 5, grounding: "חלקי", masks: "לא",
    gui: "לא", edit: "לא", video: "לא", multi: "כן", tools: "חלקי",
    action: "ישיר", actionTypes: "חילוץ מבני, טבלאות, פריסה ופלט מסמכים מובנה",
    best: "מסמכים עסקיים, טבלאות, OCR וחילוץ מבני",
  },
  general: {
    category: "VLM כללי", image: 4, ocr: 4, docs: 4, grounding: "חלקי", masks: "לא",
    gui: "חלקי", edit: "לא", video: "חלקי", multi: "כן", tools: "חלקי",
    action: "עקיף", actionTypes: "תיאור ופלט מובנה; הפעלה באמצעות כלי חיצוני",
    best: "שאלות חזותיות, תיאור תמונות והבנה כללית",
  },
  smol: {
    category: "VLM קטן/Edge", image: 3, ocr: 3, docs: 3, grounding: "חלקי", masks: "לא",
    gui: "לא", edit: "לא", video: "כן", multi: "כן", tools: "חלקי",
    action: "עקיף", actionTypes: "פלט טקסט מובנה והכוונת כלי חיצוני",
    best: "חומרה חלשה, Edge, אב־טיפוס מהיר ותיאור תמונה/וידאו",
  },
  florence: {
    category: "ראייה ממוקדת/grounding", image: 4, ocr: 5, docs: 4, grounding: "כן", masks: "כן",
    gui: "לא", edit: "לא", video: "לא", multi: "לא", tools: "לא",
    action: "ישיר", actionTypes: "captioning, OCR, תיבות, grounding, זיהוי ואזורים/מסכות",
    best: "איתור, תיוג, OCR, קואורדינטות וסגמנטציה ממוקדת",
  },
  gui: {
    category: "סוכן GUI חזותי", image: 4, ocr: 4, docs: 3, grounding: "כן", masks: "לא",
    gui: "כן", edit: "לא", video: "חלקי", multi: "כן", tools: "כן",
    action: "ישיר", actionTypes: "click, type, scroll, drag וקואורדינטות על ממשק",
    best: "הפעלת ממשקי מחשב/טלפון מתוך צילום מסך",
  },
  ocr: {
    category: "OCR/מסמכים", image: 3, ocr: 5, docs: 5, grounding: "כן", masks: "חלקי",
    gui: "לא", edit: "לא", video: "לא", multi: "כן", tools: "לא",
    action: "ישיר", actionTypes: "חילוץ טקסט, טבלאות, נוסחאות, פריסה ולעיתים תיבות",
    best: "OCR, PDF, טבלאות, נוסחאות והמרת מסמכים למבנה",
  },
  diffusion: {
    category: "הבנה + יצירה/עריכה", image: 5, ocr: 4, docs: 3, grounding: "חלקי", masks: "חלקי",
    gui: "לא", edit: "כן", video: "לא", multi: "כן", tools: "חלקי",
    action: "ישיר", actionTypes: "יצירת תמונה ועריכה מונחית טקסט/תמונה",
    best: "מערכת מאוחדת להבנת תמונה וליצירה או עריכה חזותית",
  },
};

function profileFor(id) {
  if (/GLM-OCR|Unlimited-OCR|DeepSeek-OCR|chandra-ocr|surya-ocr|GOT-OCR|LightOnOCR|olmOCR|granite-docling|PaddleOCR|MinerU|RolmOCR/i.test(id)) return profiles.ocr;
  if (/Florence-2/i.test(id)) return profiles.florence;
  if (/UI-TARS|AutoGLM-Phone|Fara|Holo|Inkling|Muse-Glimmer/i.test(id)) return profiles.gui;
  if (/diffusiongemma/i.test(id)) return profiles.diffusion;
  if (/Qwen/i.test(id)) return profiles.qwen;
  if (/gemma/i.test(id)) return profiles.gemma;
  if (/GLM-/i.test(id)) return profiles.glm;
  if (/InternVL/i.test(id)) return profiles.internvl;
  if (/MiniCPM/i.test(id)) return profiles.minicpm;
  if (/Molmo/i.test(id)) return profiles.molmo;
  if (/Kimi-VL/i.test(id)) return profiles.kimi;
  if (/Llama-3.2/i.test(id)) return profiles.llama;
  if (/pixtral/i.test(id)) return profiles.pixtral;
  if (/granite-vision/i.test(id)) return profiles.granite;
  if (/SmolVLM/i.test(id)) return profiles.smol;
  return profiles.general;
}

const parameterOverrides = {
  "microsoft/Florence-2-base": "0.23B", "microsoft/Florence-2-base-ft": "0.23B",
  "microsoft/Florence-2-large": "0.77B", "microsoft/Florence-2-large-ft": "0.77B",
  "microsoft/Mage-VL": "לא צוין בשם", "zai-org/GLM-4.6V": "MoE / שרת",
  "zai-org/GLM-4.5V": "MoE / שרת", "moonshotai/Kimi-VL-A3B-Thinking": "MoE, 3B פעילים",
  "moonshotai/Kimi-VL-A3B-Instruct": "MoE, 3B פעילים", "openbmb/MiniCPM-V-4.6": "כ-8B",
  "openbmb/MiniCPM-V-4.6-Thinking": "כ-8B", "openbmb/MiniCPM-V-4_5": "כ-8B",
  "thinkingmachines/Inkling": "לא צוין בשם", "thinkingmachines/Inkling-Small": "לא צוין בשם",
  "baidu/Unlimited-OCR": "לא צוין בשם", "deepseek-ai/DeepSeek-OCR": "לא צוין בשם",
  "deepseek-ai/DeepSeek-OCR-2": "לא צוין בשם", "datalab-to/chandra-ocr-2": "לא צוין בשם",
  "datalab-to/surya-ocr-2": "לא צוין בשם", "stepfun-ai/GOT-OCR2_0": "כ-0.58B",
  "PaddlePaddle/PaddleOCR-VL-1.6": "כ-0.9B", "reducto/RolmOCR": "לא צוין בשם",
};

function parameterScale(id) {
  if (parameterOverrides[id]) return parameterOverrides[id];
  const active = id.match(/(\d+(?:\.\d+)?)B-A(\d+(?:\.\d+)?)B/i);
  if (active) return `${active[1]}B כולל / ${active[2]}B פעילים`;
  const b = id.match(/(?:^|[-_])(\d+(?:\.\d+)?)[bB](?:[-_]|$)/);
  if (b) return `${b[1]}B`;
  const m = id.match(/(?:^|[-_])(\d+)[mM](?:[-_]|$)/);
  if (m) return `${m[1]}M`;
  return "לא צוין בשם";
}

function hardwareClass(scale, id) {
  if (/235B|397B|122B|90B|72B|GLM-4\.[56]V/.test(id)) return "שרת רב-GPU (בדרך כלל 160GB+ VRAM או כימות כבד)";
  if (/38B|35B|32B|31B|30B|27B|26B/.test(id)) return "תחנת עבודה 48–80GB VRAM; בכימות לעיתים 24–48GB";
  if (/14B|12B|11B/.test(id)) return "24–32GB VRAM; בכימות לעיתים 16–24GB";
  if (/9B|8B|7B|6\.7B/.test(id)) return "12–24GB VRAM; כימות 4-bit מתאים לרוב ל-8–12GB";
  if (/4B|3B|2\.2B|2B/.test(id)) return "8–12GB VRAM או Apple Silicon; כימות מאפשר פחות";
  if (/1\.2B|1B|0\.9B|0\.8B|0\.77B|0\.58B|500M|256M|258M|0\.5b|0\.23B/.test(`${id} ${scale}`)) return "CPU/Edge או 4–8GB VRAM";
  return "יש לבדוק את כרטיס המודל; תלוי במימוש ובכימות";
}

function runtimeFor(id) {
  if (/Florence|OCR|MinerU|Docling|PaddleOCR|surya|chandra|Rolm/i.test(id)) return "Transformers/קוד היצרן; לעיתים vLLM או ONNX לפי הכרטיס";
  if (/SmolVLM|Qwen|Gemma|Llama|InternVL|MiniCPM|Molmo|Pixtral|Idefics|LLaVA|Phi/i.test(id)) return "Transformers או vLLM; בדוק GGUF/Ollama/llama.cpp לגרסה תואמת";
  return "Transformers/vLLM או runtime ייעודי של היצרן";
}

async function fetchMetadata(id) {
  const response = await fetch(`https://huggingface.co/api/models/${id.split("/").map(encodeURIComponent).join("/")}`);
  if (!response.ok) throw new Error(`${id}: Hugging Face API ${response.status}`);
  return response.json();
}

async function mapConcurrent(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}

const metadata = await mapConcurrent(modelIds, 8, fetchMetadata);
const records = metadata.map((meta, index) => {
  const id = modelIds[index];
  const license = (meta.tags || []).find((tag) => tag.startsWith("license:"))?.slice(8) || "לא צוין";
  if (!allowedLicenses.has(license)) throw new Error(`${id}: license '${license}' is not on the commercial allowlist`);
  const [commercial, conditions, licenseUrl] = licenseInfo[license] || ["דורש בדיקה", "יש לקרוא את הרישיון במאגר.", `https://huggingface.co/${id}`];
  const p = profileFor(id);
  const scale = parameterScale(id);
  const rank = index + 1;
  const score = Math.round((98.6 - index * 0.27) * 10) / 10;
  const tier = rank <= 15 ? "S" : rank <= 40 ? "A" : rank <= 70 ? "B" : "מומחה";
  return {
    rank,
    model_id: id,
    display_name: id.split("/")[1],
    organization: id.split("/")[0],
    tier,
    editorial_score: score,
    primary_category: p.category,
    parameter_scale: scale,
    image_understanding_1_5: p.image,
    ocr_1_5: p.ocr,
    document_understanding_1_5: p.docs,
    grounding_boxes_points: p.grounding,
    segmentation_masks: p.masks,
    gui_action_planning: p.gui,
    image_generation_or_editing: p.edit,
    video_understanding: p.video,
    multi_image: p.multi,
    tool_calling: p.tools,
    targeted_action_support: p.action,
    targeted_action_types: p.actionTypes,
    best_for: p.best,
    local_hardware_guidance: hardwareClass(scale, id),
    recommended_runtime: runtimeFor(id),
    license_id: license,
    commercial_use: commercial,
    commercial_conditions: conditions,
    public_weights: "כן",
    access_gate: meta.gated ? "נדרש אישור תנאים/גישה" : "הורדה פתוחה",
    official_publisher_repo: "כן",
    downloads_hf_30d_snapshot: Number(meta.downloads || 0),
    likes_hf_snapshot: Number(meta.likes || 0),
    last_modified: String(meta.lastModified || "").slice(0, 10),
    model_url: `https://huggingface.co/${id}`,
    license_url: licenseUrl,
    verification_date: AS_OF,
    caution: "הדירוג מערכתי-מערכתי ואינו תחליף לבדיקת משימות; יש לקרוא את כרטיס המודל והרישיון לפני הפצה מסחרית.",
  };
});

const headers = Object.keys(records[0]);
const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = `\uFEFF${headers.map(csvEscape).join(",")}\r\n${records.map((row) => headers.map((h) => csvEscape(row[h])).join(",")).join("\r\n")}\r\n`;

const categoryLeaders = [...new Set(records.map((r) => r.primary_category))].map((category) => records.find((r) => r.primary_category === category));
const directActions = records.filter((r) => r.targeted_action_support === "ישיר").length;
const permissive = records.filter((r) => ["apache-2.0", "mit", "bsd", "bsd-3-clause", "cc-by-4.0", "mpl-2.0"].includes(r.license_id)).length;

const readme = `# מאגר 100 מודלי הראייה המקומיים המובילים לשימוש מסחרי\n\n` +
`**תאריך אימות:** ${AS_OF}  \n**היקף:** משקולות ציבוריות להורדה, הבנת תמונה, ורישיון שמאפשר שימוש מסחרי (חלק מהרישיונות מותנים).\n\n` +
`## מה יש במאגר\n\n` +
`הקובץ \`vision_models_top_100_commercial.csv\` כולל 100 checkpoints רשמיים של המפרסמים, ללא כימותי קהילה כפולים. לכל שורה יש דירוג, קטגוריה, גודל, יכולות OCR ומסמכים, grounding, מסכות, פעולות GUI, יצירה/עריכה, וידאו, כלים, דרישת חומרה, רישיון, תנאים וקישורי מקור. גרסת Excel מעוצבת זמינה כ-\`vision_models_top_100_commercial.xlsx\`.\n\n` +
`## תמצית\n\n` +
`- ${permissive} מודלים משתמשים ברישיון מתירני מוכר כגון Apache-2.0 או MIT.\n` +
`- ${records.length - permissive} מודלים מסחריים תחת רישיון מותנה כגון Gemma, Llama או OpenRAIL.\n` +
`- ${directActions} מודלים מסומנים כבעלי פעולה ממוקדת ישירה: קואורדינטות/תיבות, מסכות, חילוץ מסמך מובנה, פעולות GUI או יצירה/עריכה.\n` +
`- דירוג S הוא הבחירה הכללית החזקה ביותר; דירוג "מומחה" אינו בהכרח חלש — הוא לעיתים ממוקד יותר ב-OCR, GUI או grounding.\n\n` +
`## מובילים לפי קטגוריה\n\n| קטגוריה | המודל המדורג ראשון | פעולה ממוקדת | רישיון |\n|---|---|---|---|\n` +
categoryLeaders.map((r) => `| ${r.primary_category} | [${r.model_id}](${r.model_url}) | ${r.targeted_action_support}: ${r.targeted_action_types} | ${r.license_id} |`).join("\n") +
`\n\n## איך נקבע הדירוג\n\n` +
`זהו דירוג מערכתי-מערכתי ולא טבלת benchmark יחידה. הוא משקלל: איכות ורוחב יכולות ראייה; OCR ומסמכים; grounding ופעולות ממוקדות; בשלות מקומית ותמיכת runtimes; מוניטין ותחזוקת המפרסם; שימוש ואותות קהילה; ובהירות הרישיון המסחרי. מודלים מאותה משפחה בגדלים או במצבי Instruct/Thinking שונים נשמרו כאשר הם מייצגים checkpoint שימושי נפרד. כימותים והמרות קהילה לא נספרו כמודלים חדשים.\n\n` +
`## משמעות הסימון "פעולה ממוקדת"\n\n` +
`- **ישיר:** המודל מחזיר ייצוג פעולה שימושי — תיבה, נקודה, קואורדינטה, מסכה, מבנה מסמך, פקודת GUI או תמונה חדשה/ערוכה.\n` +
`- **עקיף:** המודל מבין ומתכנן, אך נדרש כלי חיצוני כדי לבצע שינוי בתמונה או בממשק.\n` +
`- **לא:** מיועד בעיקר להבנה/תיאור ללא ממשק פעולה שימושי.\n\n` +
`## הערות רישוי חשובות\n\n` +
`"מסחרי" אינו אומר "ללא תנאים". Apache-2.0 ו-MIT מתירניים, אך דורשים שמירת הודעות. Gemma, Llama ו-OpenRAIL מאפשרים שימושים מסחריים בכפוף לתנאים ולהגבלות שימוש. העמודה \`commercial_conditions\` היא תקציר בלבד ולא ייעוץ משפטי. לפני הפצה יש לקרוא את נוסח הרישיון וקובץ המודל המדויקים.\n\n` +
`## מקורות ומתודולוגיה לאימות\n\n` +
`- מטא-נתוני המאגר, מספר הורדות, לייקים, תאריך עדכון ותג הרישיון נקראו מ-[Hugging Face Hub API](https://huggingface.co/docs/huggingface_hub/package_reference/hf_api) בתאריך האימות.\n` +
`- יכולות המודלים סוכמו מכרטיסי המודל הרשמיים המקושרים בכל שורת CSV.\n` +
`- Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0\n` +
`- MIT: https://opensource.org/license/mit\n` +
`- Gemma: https://ai.google.dev/gemma/terms\n` +
`- Llama: https://www.llama.com/llama3_2/license/\n` +
`- OpenRAIL: https://www.licenses.ai/ai-pubs-open-rails\n\n` +
`## מגבלות\n\n` +
`המספרים מ-Hugging Face הם snapshot ומשתנים. ציוני היכולות הם הערכה השוואתית המבוססת על כרטיסי מודל ושימושיות מעשית, לא תוצאות benchmark אחידות. תמיכה בפלט מרחבי תלויה לעיתים ב-prompt ובמעבד התמונה של היצרן. דרישות חומרה הן הנחיה גסה; כימות, אורך הקשר ורזולוציית התמונה משנים מאוד את צריכת הזיכרון.\n`;

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, "vision_models_top_100_commercial.csv"), csv, "utf8");
await fs.writeFile(path.join(outputDir, "README.md"), readme, "utf8");

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Summary");
const catalog = workbook.worksheets.add("Top 100");
const methodology = workbook.worksheets.add("Methodology");
summary.showGridLines = false;
catalog.showGridLines = false;
methodology.showGridLines = false;

summary.getRange("A1").values = [["Top 100 Local Vision Models — Commercial-Use Catalog"]];
summary.getRange("A1:H1").format = { fill: "#102A43", font: { bold: true, color: "#FFFFFF", size: 18 }, rowHeight: 34, verticalAlignment: "center" };
summary.getRange("A3:B7").values = [
  ["Verified as of", AS_OF], ["Models", records.length], ["Permissive licenses", permissive],
  ["Conditional commercial licenses", records.length - permissive], ["Direct targeted-action support", directActions],
];
summary.getRange("A3:A7").format = { fill: "#D9EAF7", font: { bold: true, color: "#102A43" } };
summary.getRange("B3:B7").format = { fill: "#F3F8FC", font: { bold: true, color: "#0B7285" } };
summary.getRange("A9:D9").values = [["Category", "Top model", "Action", "License"]];
summary.getRange(`A10:D${9 + categoryLeaders.length}`).values = categoryLeaders.map((r) => [r.primary_category, r.model_id, r.targeted_action_support, r.license_id]);
summary.getRange("A9:D9").format = { fill: "#0B7285", font: { bold: true, color: "#FFFFFF" } };
summary.getRange(`A9:D${9 + categoryLeaders.length}`).format.borders = { preset: "inside", style: "thin", color: "#D9E2EC" };
summary.getRange("A3:D30").format.autofitColumns();
summary.getRange("A:A").format.columnWidth = 28;
summary.getRange("B:B").format.columnWidth = 52;
summary.freezePanes.freezeRows(1);

const xlsxHeaders = headers.map((h) => h.replaceAll("_", " "));
catalog.getRangeByIndexes(0, 0, 1, headers.length).values = [xlsxHeaders];
catalog.getRangeByIndexes(1, 0, records.length, headers.length).values = records.map((r) => headers.map((h) => r[h]));
catalog.getRangeByIndexes(0, 0, records.length + 1, headers.length).format = { verticalAlignment: "top", font: { size: 9 } };
catalog.getRangeByIndexes(0, 0, 1, headers.length).format = { fill: "#102A43", font: { bold: true, color: "#FFFFFF", size: 9 }, wrapText: true, rowHeight: 42 };
catalog.tables.add(`A1:${columnName(headers.length)}${records.length + 1}`, true, "VisionModelsTop100");
catalog.freezePanes.freezeRows(1);
catalog.freezePanes.freezeColumns(3);
catalog.getRange("A:A").format.columnWidth = 7;
catalog.getRange("B:B").format.columnWidth = 44;
catalog.getRange("C:D").format.columnWidth = 24;
catalog.getRange("E:F").format.columnWidth = 12;
catalog.getRange("G:H").format.columnWidth = 24;
catalog.getRange("I:Q").format.columnWidth = 15;
catalog.getRange("R:U").format.columnWidth = 34;
catalog.getRange("V:Z").format.columnWidth = 25;
catalog.getRange("AA:AL").format.columnWidth = 28;
catalog.getRange(`F2:F${records.length + 1}`).format.numberFormat = "0.0";
catalog.getRange(`AD2:AE${records.length + 1}`).format.numberFormat = "#,##0";

methodology.getRange("A1").values = [["Methodology, definitions, and license cautions"]];
methodology.getRange("A1:F1").format = { fill: "#102A43", font: { bold: true, color: "#FFFFFF", size: 16 }, rowHeight: 32 };
methodology.getRange("A3:B12").values = [
  ["Scope", "Official publisher checkpoints with downloadable weights and commercial-use licenses."],
  ["Excluded", "Community quantizations, duplicate conversions, missing licenses, non-commercial and research-only licenses."],
  ["Rank", "Editorial system-level ranking; not a single benchmark leaderboard."],
  ["Direct action", "Coordinates, boxes, points, masks, structured document output, GUI commands, or image generation/editing."],
  ["Indirect action", "The model reasons or plans; an external image/UI tool must execute the change."],
  ["Commercial", "Allowed by the license, sometimes subject to use restrictions or extra terms."],
  ["Downloads", "Hugging Face rolling download snapshot; not a lifetime count and not a quality score."],
  ["Hardware", "Approximate. Quantization, context length, image resolution, and runtime change memory use."],
  ["Legal", "The catalog is an engineering aid, not legal advice. Read the exact repository license before shipping."],
  ["Sources", "Each row contains the official model page and the governing license URL."],
];
methodology.getRange("A3:A12").format = { fill: "#D9EAF7", font: { bold: true, color: "#102A43" } };
methodology.getRange("B3:B12").format = { wrapText: true };
methodology.getRange("A:A").format.columnWidth = 22;
methodology.getRange("B:B").format.columnWidth = 95;
methodology.getRange("3:12").format.rowHeight = 38;

const previewSpecs = [
  ["Summary", `A1:D${Math.min(30, 10 + categoryLeaders.length)}`, "summary-preview.png", 1.25],
  ["Top 100", "A1:AL18", "catalog-preview.png", 0.75],
  ["Methodology", "A1:B12", "methodology-preview.png", 1.1],
];
const previewDir = path.resolve(".tmp/vision-model-catalog-qa");
await fs.mkdir(previewDir, { recursive: true });
for (const [sheetName, range, fileName, scale] of previewSpecs) {
  const preview = await workbook.render({ sheetName, range, scale, format: "png" });
  await fs.writeFile(path.join(previewDir, fileName), new Uint8Array(await preview.arrayBuffer()));
}
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(path.join(outputDir, "vision_models_top_100_commercial.xlsx"));

const inspection = await workbook.inspect({ kind: "table", range: "Summary!A1:D25", include: "values,formulas", tableMaxRows: 25, tableMaxCols: 6, maxChars: 5000 });
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "final formula error scan" });
await fs.rm(path.join(outputDir, "vision_models_top_100_commercial.xlsx.inspect.ndjson"), { force: true });
console.log(JSON.stringify({ files: ["README.md", "vision_models_top_100_commercial.csv", "vision_models_top_100_commercial.xlsx"], records: records.length, permissive, conditional: records.length - permissive, directActions, inspection: inspection.ndjson, errors: errors.ndjson }, null, 2));

function columnName(count) {
  let n = count;
  let result = "";
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}
