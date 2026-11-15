# Copyright (c) 2026 Hexphase. SPDX-License-Identifier: MIT
"""Real executable boundary checks. GPU decode is deliberately not simulated."""
import os, pathlib, subprocess, sys, tempfile
binary = sys.argv[1]
def run(*args):
    return subprocess.run([binary,*args],capture_output=True,timeout=3)
r=run('--help'); assert r.returncode==0 and not r.stdout and b'--input' in r.stderr
for args in [[],['--input','/tmp/no-bv-fifo','--width','591'],['--input','/tmp/no-bv-fifo','--height','0'],['--input','/tmp/no-bv-fifo','--width','999999999999'],['--unknown'],['--input','a','--width','592oops']]:
    r=run(*args); assert r.returncode!=0 and not r.stdout,(args,r)
with tempfile.TemporaryDirectory() as tmp:
    path=pathlib.Path(tmp)/'input';path.write_bytes(b'not a fifo')
    r=run('--input',str(path)); assert r.returncode!=0 and not r.stdout and b'FIFO' in r.stderr
    link=pathlib.Path(tmp)/'link';link.symlink_to(path)
    r=run('--input',str(link));assert r.returncode!=0 and not r.stdout
print('executable argument, FIFO and stdout isolation checks passed')
