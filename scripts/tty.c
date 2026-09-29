#include <errno.h>
#include <stdarg.h>
#include <sys/ioctl.h>

__attribute__((import_module("tty"), import_name("tcgets"))) int __tty_tcgets(int fd, void *termios);
__attribute__((import_module("tty"), import_name("tcsets"))) int __tty_tcsets(int fd, int action, const void *termios);
__attribute__((import_module("tty"), import_name("winsize"))) int __tty_winsize(int fd, void *winsize);

int __real_ioctl(int fd, int req, ...);

int __wrap_ioctl(int fd, int req, ...) {
	va_list ap;
	va_start(ap, req);
	void *arg = va_arg(ap, void *);
	va_end(ap);
	int r;
	switch (req) {
	case TCGETS:
		r = __tty_tcgets(fd, arg);
		break;
	case TCSETS:
	case TCSETSW:
	case TCSETSF:
		r = __tty_tcsets(fd, req - TCSETS, arg);
		break;
	case TIOCGWINSZ:
		r = __tty_winsize(fd, arg);
		break;
	default:
		return __real_ioctl(fd, req, arg);
	}
	if (r < 0) {
		errno = ENOTTY;
		return -1;
	}
	return 0;
}
