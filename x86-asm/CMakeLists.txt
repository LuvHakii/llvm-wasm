set(LLVM_LINK_COMPONENTS X86CodeGen X86AsmParser X86Desc X86Info Support)
add_clang_executable(clang-x86-asm main.cpp)
target_include_directories(clang-x86-asm PRIVATE "${LLVM_MAIN_SRC_DIR}/../clang/include" "${LLVM_BINARY_DIR}/tools/clang/include")
clang_target_link_libraries(clang-x86-asm PRIVATE clangDriver clangFrontend clangCodeGen)
