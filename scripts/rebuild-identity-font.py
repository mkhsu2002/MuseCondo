import sys,subprocess,hashlib,fontTools
from pathlib import Path
from fontTools.ttLib import TTFont
assert fontTools.__version__=='4.68.0'
source_path=Path(sys.argv[1]);output_path=Path(sys.argv[2])
assert hashlib.sha256(source_path.read_bytes()).hexdigest()=='864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f'
subprocess.run([sys.executable,'-m','fontTools.varLib.instancer',str(source_path),'wght=400','--output',str(output_path)],check=True)
source=TTFont(source_path,recalcTimestamp=False)
font=TTFont(output_path,recalcTimestamp=False)
values={1:'MuseCondo TC',2:'Regular',3:'MuseCondoTC-Regular-v1',4:'MuseCondo TC Regular',6:'MuseCondoTC-Regular',16:'MuseCondo TC',17:'Regular',25:'MuseCondoTC'}
for record in font['name'].names:
 if record.nameID in values:record.string=values[record.nameID].encode(record.getEncoding())
font['head'].created=source['head'].created
font['head'].modified=source['head'].modified
font.save(output_path)
actual=hashlib.sha256(output_path.read_bytes()).hexdigest()
assert actual=='d20595e7a607df9dc31a2efcd055665cbda1c8be6a8369cc06be4a77218325e5',actual
print({'sha256':actual,'bytes':output_path.stat().st_size})
