// Portable <bits/stdc++.h> shim for the judge runtime.
//
// `<bits/stdc++.h>` is a libstdc++-internal convenience header. It ships with
// GNU g++ but is absent under libc++ (e.g. MSYS2 clang64 `g++`) and MSVC, so a
// submission that includes it fails to compile there with
// "bits/stdc++.h: No such file or directory".
//
// The judge adds this directory to the compiler include path (`-I`) so that any
// `#include <bits/stdc++.h>` resolves to this file regardless of toolchain. We
// pull in every standard header, each guarded by `__has_include` so the shim
// itself never fails on a toolchain that is missing an optional header.
//
// Do NOT add submission-specific helpers here: this header must stay a faithful
// "include everything standard" stand-in so behaviour matches a real g++.

#ifndef JUDGE_RUNTIME_BITS_STDCXX_H
#define JUDGE_RUNTIME_BITS_STDCXX_H

#if defined(__has_include)
#define JUDGE_TRY_INCLUDE(header) __has_include(header)
#else
#define JUDGE_TRY_INCLUDE(header) 1
#endif

// C++ standard library headers.
#if JUDGE_TRY_INCLUDE(<algorithm>)
#include <algorithm>
#endif
#if JUDGE_TRY_INCLUDE(<any>)
#include <any>
#endif
#if JUDGE_TRY_INCLUDE(<array>)
#include <array>
#endif
#if JUDGE_TRY_INCLUDE(<atomic>)
#include <atomic>
#endif
#if JUDGE_TRY_INCLUDE(<bitset>)
#include <bitset>
#endif
#if JUDGE_TRY_INCLUDE(<charconv>)
#include <charconv>
#endif
#if JUDGE_TRY_INCLUDE(<chrono>)
#include <chrono>
#endif
#if JUDGE_TRY_INCLUDE(<complex>)
#include <complex>
#endif
#if JUDGE_TRY_INCLUDE(<condition_variable>)
#include <condition_variable>
#endif
#if JUDGE_TRY_INCLUDE(<deque>)
#include <deque>
#endif
#if JUDGE_TRY_INCLUDE(<exception>)
#include <exception>
#endif
#if JUDGE_TRY_INCLUDE(<execution>)
#include <execution>
#endif
#if JUDGE_TRY_INCLUDE(<filesystem>)
#include <filesystem>
#endif
#if JUDGE_TRY_INCLUDE(<forward_list>)
#include <forward_list>
#endif
#if JUDGE_TRY_INCLUDE(<fstream>)
#include <fstream>
#endif
#if JUDGE_TRY_INCLUDE(<functional>)
#include <functional>
#endif
#if JUDGE_TRY_INCLUDE(<future>)
#include <future>
#endif
#if JUDGE_TRY_INCLUDE(<initializer_list>)
#include <initializer_list>
#endif
#if JUDGE_TRY_INCLUDE(<iomanip>)
#include <iomanip>
#endif
#if JUDGE_TRY_INCLUDE(<ios>)
#include <ios>
#endif
#if JUDGE_TRY_INCLUDE(<iosfwd>)
#include <iosfwd>
#endif
#if JUDGE_TRY_INCLUDE(<iostream>)
#include <iostream>
#endif
#if JUDGE_TRY_INCLUDE(<istream>)
#include <istream>
#endif
#if JUDGE_TRY_INCLUDE(<iterator>)
#include <iterator>
#endif
#if JUDGE_TRY_INCLUDE(<limits>)
#include <limits>
#endif
#if JUDGE_TRY_INCLUDE(<list>)
#include <list>
#endif
#if JUDGE_TRY_INCLUDE(<locale>)
#include <locale>
#endif
#if JUDGE_TRY_INCLUDE(<map>)
#include <map>
#endif
#if JUDGE_TRY_INCLUDE(<memory>)
#include <memory>
#endif
#if JUDGE_TRY_INCLUDE(<memory_resource>)
#include <memory_resource>
#endif
#if JUDGE_TRY_INCLUDE(<mutex>)
#include <mutex>
#endif
#if JUDGE_TRY_INCLUDE(<new>)
#include <new>
#endif
#if JUDGE_TRY_INCLUDE(<numeric>)
#include <numeric>
#endif
#if JUDGE_TRY_INCLUDE(<optional>)
#include <optional>
#endif
#if JUDGE_TRY_INCLUDE(<ostream>)
#include <ostream>
#endif
#if JUDGE_TRY_INCLUDE(<queue>)
#include <queue>
#endif
#if JUDGE_TRY_INCLUDE(<random>)
#include <random>
#endif
#if JUDGE_TRY_INCLUDE(<ratio>)
#include <ratio>
#endif
#if JUDGE_TRY_INCLUDE(<regex>)
#include <regex>
#endif
#if JUDGE_TRY_INCLUDE(<scoped_allocator>)
#include <scoped_allocator>
#endif
#if JUDGE_TRY_INCLUDE(<set>)
#include <set>
#endif
#if JUDGE_TRY_INCLUDE(<shared_mutex>)
#include <shared_mutex>
#endif
#if JUDGE_TRY_INCLUDE(<sstream>)
#include <sstream>
#endif
#if JUDGE_TRY_INCLUDE(<stack>)
#include <stack>
#endif
#if JUDGE_TRY_INCLUDE(<stdexcept>)
#include <stdexcept>
#endif
#if JUDGE_TRY_INCLUDE(<streambuf>)
#include <streambuf>
#endif
#if JUDGE_TRY_INCLUDE(<string>)
#include <string>
#endif
#if JUDGE_TRY_INCLUDE(<string_view>)
#include <string_view>
#endif
#if JUDGE_TRY_INCLUDE(<system_error>)
#include <system_error>
#endif
#if JUDGE_TRY_INCLUDE(<thread>)
#include <thread>
#endif
#if JUDGE_TRY_INCLUDE(<tuple>)
#include <tuple>
#endif
#if JUDGE_TRY_INCLUDE(<typeindex>)
#include <typeindex>
#endif
#if JUDGE_TRY_INCLUDE(<typeinfo>)
#include <typeinfo>
#endif
#if JUDGE_TRY_INCLUDE(<unordered_map>)
#include <unordered_map>
#endif
#if JUDGE_TRY_INCLUDE(<unordered_set>)
#include <unordered_set>
#endif
#if JUDGE_TRY_INCLUDE(<utility>)
#include <utility>
#endif
#if JUDGE_TRY_INCLUDE(<valarray>)
#include <valarray>
#endif
#if JUDGE_TRY_INCLUDE(<vector>)
#include <vector>
#endif

// C standard library headers (C++ <cxxx> wrappers).
#if JUDGE_TRY_INCLUDE(<cassert>)
#include <cassert>
#endif
#if JUDGE_TRY_INCLUDE(<cctype>)
#include <cctype>
#endif
#if JUDGE_TRY_INCLUDE(<cerrno>)
#include <cerrno>
#endif
#if JUDGE_TRY_INCLUDE(<cfenv>)
#include <cfenv>
#endif
#if JUDGE_TRY_INCLUDE(<cfloat>)
#include <cfloat>
#endif
#if JUDGE_TRY_INCLUDE(<cinttypes>)
#include <cinttypes>
#endif
#if JUDGE_TRY_INCLUDE(<climits>)
#include <climits>
#endif
#if JUDGE_TRY_INCLUDE(<clocale>)
#include <clocale>
#endif
#if JUDGE_TRY_INCLUDE(<cmath>)
#include <cmath>
#endif
#if JUDGE_TRY_INCLUDE(<csetjmp>)
#include <csetjmp>
#endif
#if JUDGE_TRY_INCLUDE(<csignal>)
#include <csignal>
#endif
#if JUDGE_TRY_INCLUDE(<cstdarg>)
#include <cstdarg>
#endif
#if JUDGE_TRY_INCLUDE(<cstddef>)
#include <cstddef>
#endif
#if JUDGE_TRY_INCLUDE(<cstdint>)
#include <cstdint>
#endif
#if JUDGE_TRY_INCLUDE(<cstdio>)
#include <cstdio>
#endif
#if JUDGE_TRY_INCLUDE(<cstdlib>)
#include <cstdlib>
#endif
#if JUDGE_TRY_INCLUDE(<cstring>)
#include <cstring>
#endif
#if JUDGE_TRY_INCLUDE(<ctime>)
#include <ctime>
#endif
#if JUDGE_TRY_INCLUDE(<cuchar>)
#include <cuchar>
#endif
#if JUDGE_TRY_INCLUDE(<cwchar>)
#include <cwchar>
#endif
#if JUDGE_TRY_INCLUDE(<cwctype>)
#include <cwctype>
#endif

#undef JUDGE_TRY_INCLUDE

#endif  // JUDGE_RUNTIME_BITS_STDCXX_H
