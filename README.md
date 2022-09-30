# dirsniff

Identify directory structures, a bit like how `file` identifies files.

`node dirsniff.js [-v] [-m=N] [-d] path1 path2 ...`

Commandline switches:

- `-v` : Verbose mode. When directory is not identified print a summary of its contents. Off by default.
- `-m=N` : Maximum mumber of times to explore deeper when directory is not identified. Defaults to `1`.
- `-d` : Explore into dot directories (hidden direcories on *nix systems). Off by default.

Identifies directory structures of various programming languages and IDEs.
Identifies directories containing mostly files of the same of similar type such as media and office files.

# Examples

* `node dirsniff ~`  
    Attempts to identify all directories in your home *nix home directory.

* `node dirsniff foobar`  
    Attempts to identify just the `foobar` directory.
