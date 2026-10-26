import os
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
if not python.is_file():
    sys.exit("Install ai/requirements.lock.txt in ai/.venv first.")
sys.exit(subprocess.call([str(python), "-m", "pytest", "-q"], cwd=root))
