# lsp-bench

A tool for benchmarking a language server by hammering
it with generated requests.

### Usage

```
lsp-bench [files] -- [command to start language server]
```

Run `lsp-bench` with no arguments for more options.

### Usage with CodeQL

```
lsp-bench somefile.ql -- codeql execute language-server --check-errors=ON_CHANGE
```
