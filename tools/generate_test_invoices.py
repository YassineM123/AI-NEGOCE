from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen.canvas import Canvas
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "invoices-test"
OUT.mkdir(parents=True, exist_ok=True)
FONT = Path("C:/Windows/Fonts/arial.ttf")
FONT_B = Path("C:/Windows/Fonts/arialbd.ttf")
pdfmetrics.registerFont(TTFont("Arial", str(FONT)))
pdfmetrics.registerFont(TTFont("Arial-Bold", str(FONT_B)))

def money(v): return f"{v:,.3f}".replace(",", " ")

def pdf_invoice():
    path = OUT / "01_facture_classique_A4.pdf"
    c = Canvas(str(path), pagesize=A4)
    w, h = A4
    navy, blue, pale = colors.HexColor("#17365D"), colors.HexColor("#2F75B5"), colors.HexColor("#EAF2F8")
    c.setFillColor(navy); c.rect(0, h-92, w, 92, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("Arial-Bold", 20); c.drawString(42, h-52, "STE RAVINO SARL")
    c.setFont("Arial", 8); c.drawString(42, h-69, "FOURNISSEUR FICTIF - TEST UNIQUEMENT")
    c.setFont("Arial-Bold", 25); c.drawRightString(w-42, h-55, "FACTURE")
    c.setFillColor(colors.HexColor("#8B1E1E")); c.setFont("Arial-Bold", 8)
    c.drawCentredString(w/2, h-108, "DOCUMENT DE TEST - SANS VALEUR COMPTABLE")
    c.setFillColor(colors.black); c.setFont("Arial", 9)
    for i, t in enumerate(["15 rue du Lac, Tunis", "MF : 1234567/A/M/000", "Devise : TND"]): c.drawString(42, h-137-i*15, t)
    c.setFillColor(pale); c.roundRect(w-225, h-180, 183, 58, 6, fill=1, stroke=0)
    c.setFillColor(navy); c.setFont("Arial-Bold", 9)
    c.drawString(w-213, h-140, "Facture N° : F001-2026-0091")
    c.drawString(w-213, h-156, "Date : 22/10/2026")
    c.drawString(w-213, h-172, "Bon de commande : Aucun")
    y = h-225; cols=[42,105,300,350,410,465,553]
    c.setFillColor(navy); c.rect(42,y,511,24,fill=1,stroke=0); c.setFillColor(colors.white); c.setFont("Arial-Bold",7.5)
    heads=["Réf.","Désignation","Qté","P.U. HT","Remise","TVA","Total HT"]
    for x,t in zip(cols,heads): c.drawString(x+4,y+8,t)
    rows=[("RA4-ECO","Ramette papier A4 Eco",50,9.5,"0%","7%",475.0),("TON-PRO","Toner Ravi Pro",4,185.0,"0%","19%",740.0)]
    c.setFont("Arial",8); y-=26
    for row in rows:
        c.setFillColor(colors.HexColor("#F7F9FB") if int(y)%2 else colors.white); c.rect(42,y,511,25,fill=1,stroke=0); c.setFillColor(colors.black)
        vals=[row[0],row[1],str(row[2]),money(row[3]),row[4],row[5],money(row[6])]
        for x,t in zip(cols,vals): c.drawString(x+4,y+8,t)
        y-=27
    c.setStrokeColor(colors.HexColor("#CBD5E1")); c.line(42,y+25,553,y+25)
    c.setFont("Arial",8); c.drawString(42,y-5,"Récapitulatif TVA : Base 475.000 à 7% = 33.250 | Base 740.000 à 19% = 140.600")
    ty=y-58; c.setFillColor(pale); c.roundRect(350,ty-70,203,82,6,fill=1,stroke=0); c.setFillColor(navy)
    totals=[("Total HT",1215.0),("Total TVA",173.85),("Timbre",1.0),("NET À PAYER",1389.85)]
    for i,(lab,val) in enumerate(totals):
        c.setFont("Arial-Bold" if i==3 else "Arial", 10 if i==3 else 9); c.drawString(365,ty-i*19,lab); c.drawRightString(538,ty-i*19,money(val)+" TND")
    c.setFillColor(colors.HexColor("#667085")); c.setFont("Arial",7); c.drawCentredString(w/2,38,"Données entièrement fictives - Aucun paiement ne doit être effectué")
    c.save(); return path

def font(size,bold=False): return ImageFont.truetype(str(FONT_B if bold else FONT),size)

def compact_png():
    path=OUT/"02_facture_services_compacte.png"; im=Image.new("RGB",(1600,1100),"white"); d=ImageDraw.Draw(im)
    d.rectangle((35,35,1565,1065),outline="#111827",width=4); d.text((70,62),"DIGITEC SERVICES SUARL",font=font(35,1),fill="#111827")
    d.text((70,108),"FOURNISSEUR FICTIF - TEST UNIQUEMENT | MF 1748290/B/A/000 | Centre Urbain Nord, Tunis",font=font(17),fill="#374151")
    d.text((800,65),"FACTURE DE SERVICES",font=font(38,1),anchor="ma",fill="#111827")
    d.text((800,145),"DOCUMENT DE TEST - SANS VALEUR COMPTABLE",font=font(17,1),anchor="ma",fill="#B91C1C")
    d.rectangle((70,190,1530,270),fill="#F3F4F6",outline="#111827",width=2)
    d.text((90,210),"Facture N° : DS-2026/1048",font=font(22,1),fill="#111827"); d.text((610,210),"Date : 20/10/2026",font=font(22),fill="#111827"); d.text((1060,210),"Devise : TND",font=font(22),fill="#111827")
    d.text((90,245),"Bon de commande : Sans bon de commande",font=font(17),fill="#374151")
    x=[70,210,760,870,1020,1160,1300,1530]; y=320; rh=72
    headers=["Référence","Désignation","Qté","P.U. HT","Remise","TVA","Total HT"]
    for a,b,t in zip(x,x[1:],headers): d.rectangle((a,y,b,y+rh),fill="#111827",outline="white"); d.text(((a+b)//2,y+36),t,font=font(17,1),anchor="mm",fill="white")
    rows=[("CLD-12","Hébergement cloud annuel","12","45.000","0%","19%","540.000"),("SUP-08","Support technique","8","60.000","10%","19%","432.000"),("FORM-01","Formation utilisateurs","1","350.000","0%","13%","350.000")]
    for r,row in enumerate(rows,1):
        yy=y+r*rh
        for a,b,t in zip(x,x[1:],row): d.rectangle((a,yy,b,yy+rh),fill="#FFFFFF" if r%2 else "#F9FAFB",outline="#9CA3AF"); d.text(((a+b)//2,yy+36),t,font=font(17),anchor="mm",fill="#111827")
    yy=650; d.rectangle((910,yy,1530,885),fill="#F3F4F6",outline="#111827",width=2)
    for i,(lab,val) in enumerate([("Total HT","1 322.000 TND"),("Total TVA","230.180 TND"),("Timbre","1.000 TND"),("NET À PAYER","1 553.180 TND")]):
        d.text((950,yy+35+i*52),lab,font=font(23,i==3),fill="#111827"); d.text((1490,yy+35+i*52),val,font=font(23,i==3),anchor="ra",fill="#111827")
    d.text((70,1015),"Données synthétiques pour validation OCR - Ne pas comptabiliser",font=font(17,1),fill="#B91C1C")
    im.save(path,optimize=True); return path

def photo_jpg():
    path=OUT/"03_facture_bon_livraison_photo.jpg"; base=Image.new("RGB",(1450,1950),"#F5F0E4"); d=ImageDraw.Draw(base)
    d.rectangle((55,55,1395,1895),fill="#FCFAF2",outline="#456B4A",width=5)
    d.rectangle((55,55,1395,230),fill="#456B4A"); d.text((95,92),"COMPTOIR DU SAHEL SARL",font=font(42,1),fill="white"); d.text((95,155),"FOURNISSEUR FICTIF - TEST UNIQUEMENT",font=font(20,1),fill="#E8F5E9")
    d.text((1350,105),"FACTURE",font=font(50,1),anchor="ra",fill="white")
    d.text((725,270),"DOCUMENT DE TEST - SANS VALEUR COMPTABLE",font=font(21,1),anchor="ma",fill="#A33A2B")
    info=["Route de Mahdia km 4, Sfax","MF : 0987654/C/N/000","Facture N° : CS-2610-078","Date : 18/10/2026","Devise : TND","Bon de livraison : BL-2026-871"]
    for i,t in enumerate(info): d.text((95 if i<2 else 800,330+(i if i<2 else i-2)*46),t,font=font(23,i==2),fill="#243529")
    y=600; x=[85,220,690,790,960,1070,1180,1365]; heads=["Réf.","Désignation","Qté","P.U. HT","Rem.","TVA","Total HT"]
    for a,b,t in zip(x,x[1:],heads): d.rectangle((a,y,b,y+70),fill="#DDE8D8",outline="#456B4A",width=2); d.text(((a+b)//2,y+35),t,font=font(18,1),anchor="mm",fill="#243529")
    rows=[("HUI-1L","Huile d'olive 1 L","24","18.750","0%","7%","450.000"),("CART-R","Carton emballage renforcé","100","1.200","5%","19%","114.000"),("TRP-SF","Transport régional","1","35.000","0%","19%","35.000")]
    for r,row in enumerate(rows,1):
        yy=y+r*88
        for a,b,t in zip(x,x[1:],row): d.rectangle((a,yy,b,yy+88),fill="#FCFAF2",outline="#92A68E",width=2); d.text(((a+b)//2,yy+44),t,font=font(18),anchor="mm",fill="#243529")
    d.rectangle((800,1050,1365,1390),fill="#EDF2E9",outline="#456B4A",width=3)
    for i,(lab,val) in enumerate([("Total HT","599.000 TND"),("Total TVA","59.810 TND"),("Timbre","1.000 TND"),("NET À PAYER","659.810 TND")]): d.text((845,1100+i*75),lab,font=font(27,i==3),fill="#243529"); d.text((1320,1100+i*75),val,font=font(27,i==3),anchor="ra",fill="#243529")
    d.ellipse((115,1450,430,1700),outline="#6B8E6E",width=8); d.text((272,1570),"LIVRÉ\nTEST",font=font(31,1),anchor="mm",align="center",fill="#6B8E6E")
    d.text((725,1815),"Données fictives - Ne pas payer / Ne pas comptabiliser",font=font(20,1),anchor="ma",fill="#A33A2B")
    base=base.rotate(1.2,resample=Image.Resampling.BICUBIC,expand=True,fillcolor="#D8D5CF").filter(ImageFilter.GaussianBlur(.15)); base.save(path,quality=90,dpi=(220,220)); return path

files=[pdf_invoice(),compact_png(),photo_jpg()]
answer={"fixtures":[{"file":files[0].name,"invoiceNumber":"F001-2026-0091","date":"2026-10-22","currency":"TND","totals":{"ht":1215.000,"vat":173.850,"stamp":1.000,"ttc":1389.850}},{"file":files[1].name,"invoiceNumber":"DS-2026/1048","date":"2026-10-20","currency":"TND","totals":{"ht":1322.000,"vat":230.180,"stamp":1.000,"ttc":1553.180}},{"file":files[2].name,"invoiceNumber":"CS-2610-078","date":"2026-10-18","currency":"TND","totals":{"ht":599.000,"vat":59.810,"stamp":1.000,"ttc":659.810}}]}
(OUT/"valeurs_attendues.json").write_text(json.dumps(answer,ensure_ascii=False,indent=2),encoding="utf-8")
print("\n".join(str(p) for p in files+[OUT/"valeurs_attendues.json"]))
