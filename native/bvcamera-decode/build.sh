#!/bin/sh
# Copyright (c) 2026 Hexphase. SPDX-License-Identifier: MIT
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
mkdir -p build
case "${1:---test}" in
 --test)
  compiler=${CC:-clang}
  "$compiler" -std=gnu11 -Wall -Wextra -Werror -g -fsanitize=address,undefined frame.c tests/frame_test.c -o build/frame-test
  build/frame-test
  "$compiler" -std=gnu11 -Wall -Wextra -Werror -g -fsanitize=address,undefined -Ivendor/intel-mediasdk frame.c tests/io_test.c -o build/io-test
  build/io-test
  "$compiler" -std=gnu11 -Wall -Wextra -Werror -O2 -Ivendor/intel-mediasdk main.c frame.c -o build/bvcamera-decode-host
  python3 tests/process_test.py "$PWD/build/bvcamera-decode-host"
  ;;
 --linux)
  # Pass the absolute path to a separately obtained Zig executable. No global install.
  : "${ZIG:?Set ZIG to an official, checksum-verified Zig 0.14.1 executable}"
  "$ZIG" cc -target x86_64-linux-gnu.2.17 -std=gnu11 -O2 -Wall -Wextra -Werror -Ivendor/intel-mediasdk main.c frame.c -ldl -o build/bvcamera-decode
  python3 verify-elf.py build/bvcamera-decode
  ;;
 *) printf '%s\n' 'Usage: ./build.sh --test | ZIG=/absolute/path/to/zig ./build.sh --linux' >&2;exit 2;;
esac
