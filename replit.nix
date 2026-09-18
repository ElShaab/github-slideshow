{ pkgs }: {
  deps = [
    pkgs.nodejs_22
    # better-sqlite3 ships prebuilt binaries; these are only needed if npm
    # has to compile it from source.
    pkgs.python3
    pkgs.gnumake
    pkgs.gcc
  ];
}
