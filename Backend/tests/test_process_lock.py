"""Nonce serialization must protect multiple worker processes on one host."""
import os
import subprocess
import sys
import uuid
from pathlib import Path


def test_process_lock_serializes_workers(tmp_path):
    counter = tmp_path / 'counter'
    counter.write_text('0')
    backend = Path(__file__).resolve().parents[1]
    lock = f'ticketpro-test-{uuid.uuid4().hex}.lock'
    source = '''
import sys,time
from pathlib import Path
from process_lock import process_lock
counter=Path(sys.argv[1])
for _ in range(15):
    with process_lock(sys.argv[2]):
        value=int(counter.read_text())
        time.sleep(0.002)
        counter.write_text(str(value+1))
'''
    env = {**os.environ, 'PYTHONPATH': str(backend)}
    children = [subprocess.Popen([sys.executable, '-c', source, str(counter), lock], env=env) for _ in range(4)]
    try:
        assert all(child.wait(timeout=20) == 0 for child in children)
        assert counter.read_text() == '60'
    finally:
        for child in children:
            if child.poll() is None:
                child.kill()
                child.wait()
