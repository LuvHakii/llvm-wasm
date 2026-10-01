#ifndef _LIBSTDCXX_SHIM
#define _LIBSTDCXX_SHIM
#include <functional>
#include <limits>
#include <type_traits>
#define _GLIBCXX_VISIBILITY(V)
#define _GLIBCXX_BEGIN_NAMESPACE_VERSION
#define _GLIBCXX_END_NAMESPACE_VERSION
#define _GLIBCXX_NODISCARD
#define _GLIBCXX_STD_C std
#define _GLIBCXX_THROW_OR_ABORT(E) (throw (E))
#define _GLIBCXX_DEBUG_ASSERT(C)
#define _GLIBCXX_DEBUG_ONLY(S)
#define __N(S) S
#define __try try
#define __catch(X) catch (X)
#define __throw_exception_again throw
namespace std { namespace tr1 { using namespace std; } }
namespace __gnu_cxx {
template<bool C, class T, class F> struct __conditional_type { typedef T __type; };
template<class T, class F> struct __conditional_type<false, T, F> { typedef F __type; };
template<class T> struct __numeric_traits {
	static const T __min = std::numeric_limits<T>::min();
	static const T __max = std::numeric_limits<T>::max();
};
}
#endif
