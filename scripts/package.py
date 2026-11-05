#!/usr/bin/env python3
"""Gera ZIP dos arquivos versionados, sem segredos, builds ou o próprio pacote."""
from pathlib import Path
import hashlib
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
target = root / "releases" / "senhabaixa-redesign.zip"
target.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(filter(None, paths)):
        path = Path(name)
        if path.parts[0] in {"releases", ".git", "node_modules"} or name.endswith(".tsbuildinfo"):
            continue
        if path.name.startswith(".env") and path.name != ".env.example":
            raise SystemExit("Arquivo de ambiente não deve estar versionado: " + name)
        archive.write(root / name, "senhabaixa/" + name)
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
print(f"{target.name}: {target.stat().st_size} bytes")
print("SHA256:", hashlib.sha256(target.read_bytes()).hexdigest())
