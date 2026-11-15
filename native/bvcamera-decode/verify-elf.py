# Copyright (c) 2026 Hexphase. SPDX-License-Identifier: MIT
"""Fail closed on an accidentally packaged macOS/ARM/too-new-glibc binary."""
import hashlib, pathlib, re, struct, sys
p=pathlib.Path(sys.argv[1]);data=p.read_bytes()
if data[:6]!=b'\x7fELF\x02\x01' or struct.unpack_from('<H',data,18)[0]!=62:
    raise SystemExit('expected little-endian Linux ELF64 x86_64')
versions={tuple(map(int,x.split(b'.'))) for x in re.findall(rb'GLIBC_([0-9]+\.[0-9]+(?:\.[0-9]+)?)\x00',data)}
if not versions or max(versions)>(2,17):raise SystemExit(f'unsupported glibc symbol requirements: {versions}')
print(f'{p}: ELF64 x86_64; maximum GLIBC_{".".join(map(str,max(versions)))}; {len(data)} bytes; SHA256 {hashlib.sha256(data).hexdigest()}')
