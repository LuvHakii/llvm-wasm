#include "clang/Basic/DiagnosticFrontend.h"
#include "clang/Basic/TargetOptions.h"
#include "clang/CodeGen/CodeGenAction.h"
#include "clang/Driver/Action.h"
#include "clang/Driver/Compilation.h"
#include "clang/Driver/Driver.h"
#include "clang/Driver/Job.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/CompilerInvocation.h"
#include "clang/Frontend/TextDiagnosticBuffer.h"
#include "clang/Frontend/TextDiagnosticPrinter.h"
#include "clang/Options/Options.h"
#include "llvm/Option/ArgList.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/ErrorHandling.h"
#include "llvm/Support/Process.h"
#include "llvm/Support/Signals.h"
#include "llvm/Support/TargetSelect.h"
#include "llvm/Support/raw_ostream.h"

using namespace clang;
using namespace clang::driver;
using namespace clang::options;

static void backendError(void *data, const char *message, bool crash) {
  auto &diags = *static_cast<DiagnosticsEngine *>(data);
  diags.Report(diag::err_fe_error_backend) << message;
  llvm::sys::RunInterruptHandlers();
  llvm::sys::Process::Exit(crash ? 70 : 1);
}

int main(int argc, const char **argv) {
  if (argc < 2) {
    llvm::errs() << "usage: clang-x86-asm <source-path> <compiler-options...>\n";
    return 1;
  }
  LLVMInitializeX86TargetInfo();
  LLVMInitializeX86Target();
  LLVMInitializeX86TargetMC();
  LLVMInitializeX86AsmPrinter();
  LLVMInitializeX86AsmParser();

  DiagnosticOptions dopts;
  dopts.setShowColors(ShowColorsKind::Off);
  auto *printer = new TextDiagnosticPrinter(llvm::errs(), dopts);
  DiagnosticsEngine diags(DiagnosticIDs::create(), dopts, printer);
  Driver driver(argv[0], "x86_64-unknown-linux-gnu", diags);
  auto reject = [&]() {
    diags.Report(diags.getCustomDiagID(DiagnosticsEngine::Error,
        "the assembly viewer owns target, source, stage and output"));
    return 1;
  };
  bool perr = false;
  auto opts = driver.ParseArgStrings(llvm::ArrayRef(argv + 2, argc - 2),
                                     false, perr);
  if (perr) return 1;
  for (const auto *arg : opts) {
    const auto &option = arg->getOption();
    if (option.matches(OPT_Action_Group) || option.matches(OPT_INPUT) ||
        option.matches(OPT_o) || option.matches(OPT_x) ||
        option.matches(OPT_target) || option.matches(OPT_m32) ||
        option.matches(OPT_mx32) || option.matches(OPT_Xclang) ||
        option.matches(OPT_Xclangas) || option.matches(OPT_Xassembler) ||
        option.matches(OPT_Xlinker) || option.matches(OPT_Wa_COMMA) ||
        option.matches(OPT_Wl_COMMA) || option.matches(OPT_cc1) ||
        option.matches(OPT_cc1as) || option.matches(OPT_driver_mode)) return reject();
    if ((option.matches(OPT_march_EQ) || option.matches(OPT_mtune_EQ)) &&
        llvm::StringRef(arg->getValue()) == "native") {
      diags.Report(diags.getCustomDiagID(DiagnosticsEngine::Error,
          "Native CPU detection is unavailable in the browser; choose an explicit CPU"));
      return 1;
    }
  }

  llvm::SmallVector<const char *, 32> args{argv[0], "--driver-mode=g++", "-masm=intel"};
  args.append(argv + 2, argv + argc);
  args.append({"--target=x86_64-unknown-linux-gnu", "-S", "-nostdinc",
               "-isystem", "/x86-asm/include/c++/v1",
               "-isystem", "/x86-asm/clang/include",
               "-isystem", "/x86-asm/include",
               "-gdwarf-4", "-gline-directives-only",
               "-x", "c++", argv[1], "-o", "/x86-asm/output.s"});
  std::unique_ptr<Compilation> comp(driver.BuildCompilation(args));
  if (!comp || diags.hasErrorOccurred()) return 1;
  const auto &jobs = comp->getJobs();
  if (jobs.size() != 1) return reject();
  const auto &command = *jobs.begin();
  const auto &cc1 = command.getArguments();
  if (command.getSource().getKind() != Action::BackendJobClass ||
      cc1.empty() || llvm::StringRef(cc1.front()) != "-cc1") return reject();

  DiagnosticOptions popts;
  auto *buffer = new TextDiagnosticBuffer;
  DiagnosticsEngine parseDiags(DiagnosticIDs::create(), popts, buffer);
  auto inv = std::make_shared<CompilerInvocation>();
  bool success = CompilerInvocation::CreateFromArgs(
      *inv, llvm::ArrayRef(cc1).drop_front(), parseDiags, argv[0]);
  inv->getDiagnosticOpts().setShowColors(ShowColorsKind::Off);
  CompilerInstance compiler(inv);
  compiler.createVirtualFileSystem(llvm::vfs::getRealFileSystem(), buffer);
  compiler.createDiagnostics();
  buffer->FlushDiagnostics(compiler.getDiagnostics());
  if (!success) return 1;
  const auto &frontend = compiler.getFrontendOpts();
  if (compiler.getTargetOpts().Triple != "x86_64-unknown-linux-gnu" ||
      frontend.ProgramAction != frontend::EmitAssembly ||
      frontend.Inputs.size() != 1 || !frontend.Inputs[0].isFile() ||
      frontend.Inputs[0].getFile() != argv[1] ||
      frontend.Inputs[0].getKind().getLanguage() != Language::CXX ||
      frontend.OutputFile != "/x86-asm/output.s") return reject();

  llvm::install_fatal_error_handler(backendError, &compiler.getDiagnostics());
  if (!frontend.LLVMArgs.empty()) {
    llvm::SmallVector<const char *, 16> llvmArgs{"clang (LLVM option parsing)"};
    for (const auto &arg : frontend.LLVMArgs) llvmArgs.push_back(arg.c_str());
    llvmArgs.push_back(nullptr);
    success = llvm::cl::ParseCommandLineOptions(
        llvmArgs.size() - 1, llvmArgs.data(), "", &llvm::errs(),
        &compiler.getVirtualFileSystem());
  }
  if (success) {
    EmitAssemblyAction action;
    success = compiler.ExecuteAction(action);
  }
  llvm::remove_fatal_error_handler();
  return success && !compiler.getDiagnostics().hasErrorOccurred() ? 0 : 1;
}
