"""Build a clean, allowlisted preview. Never copy a working tree or its Git history."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import zipfile

ROOT=Path(__file__).resolve().parent
FILES='''README.md EXTENSION.md LICENSE UPSTREAM_README.md ENGINE_SOURCE.md BOT_SKILL.md
RELEASE_NOTES.md SUBMISSION_EN.md .env.example .gitignore
study.py handoff.py ink.py nebius.py external.py service.py utils.py prompts.py collab_sketch.py
gen_sketch.py chat_and_edit.py chat_interface.py environment.yml mac_environment.yml
requirements-study.txt requirements-deploy.txt
check_study.py check_extension.py check_sheet.mjs check_library.mjs check_outbox.mjs
check_ink.py check_nebius.py check_transport.py check_deploy.py package_release.py'''.split()
FOLDERS=('extension','deploy','templates','repo_images','public')
STATIC=('study.mjs','scenarios.mjs','init_canvas.png','cur_canvas_user.png','cur_canvas_agent.png')

def main():
    version=json.loads((ROOT/'extension/manifest.json').read_text())['version']
    files=[ROOT/p for p in FILES]+[ROOT/'static'/p for p in STATIC]
    files += [p for folder in FOLDERS for p in (ROOT/folder).rglob('*') if p.is_file() and 'downloads' not in p.parts]
    # Published inputs are explicit. Private storage and the inherited .env never enter a release.
    blocked={'.env','HANDOFF.MD','data','evidence','.git','.venv','__pycache__'}
    secrets=[]
    if (ROOT/'.env').exists():
        for line in (ROOT/'.env').read_text().splitlines():
            key,sep,value=line.partition('=');value=value.strip().strip('\"\'')
            if sep and re.search(r'KEY|TOKEN|SECRET',key) and len(value)>=20:secrets.append(value)
    for p in files:
        assert p.is_file() and not p.is_symlink(),f'Missing/linked release input: {p.name}'
        assert not (set(p.relative_to(ROOT).parts)&blocked)
        if p.suffix in {'.md','.py','.mjs','.js','.html','.css','.json','.yml','.txt'} or p.name=='.env.example':
            text=p.read_text()
            assert not re.search(r'/(?:Users|home)/[\w-]+/|(?:gh[pousr]_|sk-proj-)[A-Za-z0-9]{20}',text),f'Private data marker: {p.name}'
            assert not any(value in text for value in secrets),f'Configured secret found: {p.name}'
            if p.name=='.env.example':assert not re.search(r'(?m)^NEBIUS_API_KEY=.+$',text)
    out=ROOT/'dist';out.mkdir(exist_ok=True)
    dest=out/f'jiebi-{version}'
    if dest.exists():
        # Keep previous artifacts rather than erasing them silently.
        dest=out/f'jiebi-{version}-{__import__("time").time_ns()}'
    dest.mkdir()
    for p in files:
        target=dest/p.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
    def archive(folder,target):
        with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
            for p in sorted(folder.rglob('*')):
                if p.is_file():z.write(p,str(Path(folder.name)/p.relative_to(folder)))
    downloads=dest/'public/downloads';downloads.mkdir()
    extension_zip=downloads/f'jiebi-extension-{version}.zip';archive(dest/'extension',extension_zip)
    checksums={str(p.relative_to(dest)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(dest.rglob('*')) if p.is_file()}
    (dest/'SHA256SUMS').write_text(''.join(f'{v}  {k}\n' for k,v in checksums.items()))
    source_zip=out/(dest.name+'-source.zip');archive(dest,source_zip)
    print(json.dumps({'directory':str(dest),'source':str(source_zip),'extension':str(extension_zip),'files':len(checksums)},indent=2))

if __name__=='__main__':main()
