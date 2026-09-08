from pathlib import Path
import sys, re, json
sys.path.insert(0, str(Path(__file__).parent / 'deps'))
from bidi.algorithm import get_display
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from pypdf import PdfReader

root = Path(__file__).resolve().parents[2]
source = Path(__file__).with_name('report-source.md')
out = root / 'output/pdf/skin-cleanup-research-he.pdf'
out.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('ArialHE', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialHEBold', 'C:/Windows/Fonts/arialbd.ttf'))
c = canvas.Canvas(str(out), pagesize=(595.28,841.89))
c.setTitle('מחקר: ניקוי עור אוטומטי ברמה מקצועית')
c.setAuthor('Research for Yosef')
W,H=595.28,841.89
left,right=49,546
sections=source.read_text(encoding='utf-8').split('\n---\n')
def wrap(txt,font,size):
    lines=[]; current=''
    for word in txt.split():
        trial=(current+' '+word).strip()
        if pdfmetrics.stringWidth(get_display(trial),font,size)>right-left and current:
            lines.append(current); current=word
        else: current=trial
    if current: lines.append(current)
    return lines
links=[]
for idx, section in enumerate(sections,1):
    c.setFillColor(HexColor('#147d83')); c.rect(right-44,H-43,44,4,fill=1,stroke=0)
    c.setFont('ArialHE',9); c.setFillColor(HexColor('#667782'))
    c.drawString(left,H-42,'PHOTO / RESEARCH'); c.drawRightString(right,31,f'{idx} / {len(sections)}')
    y=H-77
    for block in section.split('\n\n'):
        for para in block.split('\n'):
            if not para.strip(): continue
            url=None
            match=re.fullmatch(r'\[(.*)\]\((https?://.*)\)',para)
            if match:
                txt,url=match.groups(); size=8.2; leading=11.2; font='ArialHE'; col='#147d83'
                links.append({'label':txt,'url':url,'page':idx})
            elif para.startswith('# '): txt=para[2:];size=23;leading=29;font='ArialHEBold';col='#133444'
            elif para.startswith('## '): txt=para[3:];size=12;leading=19;font='ArialHEBold';col='#147d83'
            else: txt=para;size=10.7;leading=16;font='ArialHE';col='#203440'
            lines=wrap(txt,font,size)
            c.setFont(font,size); c.setFillColor(HexColor(col))
            for line in lines:
                if y<57: raise RuntimeError(f'Page {idx} overflow at {txt[:50]}')
                c.drawRightString(right,y,get_display(line,base_dir='R'))
                if url:c.linkURL(url,(left,y-2,right,y+size),relative=0,thickness=0)
                y-=leading
        y-=8
    print(f'page {idx}: bottom={y:.1f}')
    c.showPage()
c.save()
pdf=PdfReader(out)
assert len(pdf.pages)==len(sections)
assert all(len(p.extract_text())>400 for p in pdf.pages)
Path(__file__).with_name('claim-source-ledger.json').write_text(json.dumps({'access_date':'2026-09-07','sources':links,'provenance':'Primary papers, author repositories, official Adobe documentation and first-party professional tutorials. Parent spot checks: turn20view0-2, turn21view0-2. Earlier parent evidence: turn19view0-2, turn12view1-2, turn14search12-13.','gaps':{'weights':'Download and runtime not verified for candidates','ICCV2025':'Full PDF returned 403 twice; primary indexed content only','quality':'No candidate tested on user image during research','causality':'Artifact mechanisms are hypotheses, not isolated causal measurements of project code'},'search_log':['Professional healing, frequency separation and dodge-and-burn first-party tutorials; read Adobe, Retouching Academy, PHLEARN and Pratik Naik','Author paper and code searches for AutoRetouch, BPFRe, RetouchFormer, ABPN/ModelScope and BeautyGRPO; follow-up raw inference and loader code','CGFR primary full text; ICCV 2025 spectral method primary indexed text; PatchMatch author page','Parent verification of RetouchFormer repository/loader and BeautyGRPO paper/base card; followed official successor link to RetouchGPT'],'stopping_reason':'Main decision slots supported; remaining gaps require checkpoint access and subsequent image evaluation, not further broad discovery.'},ensure_ascii=False,indent=2),encoding='utf-8')
print(out)
print(f'pages={len(pdf.pages)}, links={sum(len(p.get("/Annots",[])) for p in pdf.pages)}, bytes={out.stat().st_size}')
