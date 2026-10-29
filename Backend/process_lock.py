"""Host-local transaction serialization on Linux, macOS and Windows."""
import errno
import os
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def process_lock(name):
    if Path(name).name != name:
        raise ValueError('Lock name must be a filename')
    # Keep the same /tmp filename as previous Linux deployments so old and new
    # workers share a lock during a rolling update. Never remove an active lock.
    with (Path(tempfile.gettempdir()) / name).open('a+b') as stream:
        if os.name == 'nt':
            import msvcrt
            stream.seek(0, os.SEEK_END)
            if stream.tell() == 0:
                stream.write(b'\0')
                stream.flush()
            while True:
                stream.seek(0)
                try:
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError as error:
                    if error.errno not in {errno.EACCES, errno.EAGAIN, errno.EDEADLK}:
                        raise
                    time.sleep(0.05)
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
