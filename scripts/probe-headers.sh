#!/bin/bash
SDK=/tmp/wasi-sdk-33.0-x86_64-linux; SR=$SDK/share/wasi-sysroot; CXX=$SDK/bin/clang++
cd /tmp/pchtest
CAND="cassert cctype cerrno cfloat climits clocale cmath csetjmp cstdarg cstddef cstdio cstdlib cstring ctime cwchar cwctype cfenv cinttypes cstdint cuchar complex algorithm bitset deque exception fstream functional iomanip ios iosfwd iostream istream iterator limits list locale map memory new numeric ostream queue set sstream stack stdexcept streambuf string typeinfo utility valarray vector array atomic chrono condition_variable forward_list future initializer_list mutex random ratio regex scoped_allocator system_error thread tuple typeindex type_traits unordered_map unordered_set shared_mutex any charconv execution filesystem memory_resource optional string_view variant barrier bit compare concepts coroutine latch numbers ranges semaphore source_location span stop_token syncstream version expected flat_map flat_set mdspan print"
for STD in c++11 c++14; do
  OK=""
  for h in $CAND; do
    echo "#include <$h>" > p.cpp
    if $CXX -fsyntax-only -x c++ --target=wasm32-wasip1 --sysroot=$SR -fwasm-exceptions -std=$STD p.cpp 2>/dev/null; then OK="$OK $h"; fi
  done
  echo "$OK" > ok-$STD.txt
  echo "$STD: $(echo $OK | wc -w) headers"
done
