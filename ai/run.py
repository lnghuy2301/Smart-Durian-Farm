import os
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
if not python.is_file():
    sys.exit("Create ai/.venv and install ai/requirements.lock.txt first. See ai/README.md.")
sys.exit(subprocess.call([str(python), "-m", "uvicorn", "src.server:app", "--host", "127.0.0.1", "--port", "8001"], cwd=root))
