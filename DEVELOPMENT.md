# Development

This document covers contributor setup, local builds, tests, and publishing releases. For installation and usage, see [README.md](README.md).

## Repository layout

- `src/tagg`: Python CLI and shared inference code.
- `src/obsidian-tagg`: Obsidian plugin source and npm project.
- `src/thunderbird-tagg`: Thunderbird extension, options page, and native host source.
- `scripts`: release builders and the Thunderbird native-host installer.
- `tests`: Python tests.

## Local setup

The Python package requires Python 3.10 or newer and is managed with [uv](https://docs.astral.sh/uv/):

```sh
uv sync
uv run tagg --help
```

The extension projects use npm lockfiles. Node dependencies are installed inside the Node 20 Alpine container used by the release workflow:

```sh
docker run --rm -it \
  -u "$(id -u):$(id -g)" \
  -v "$PWD":/app \
  -w /app \
  node:20-alpine npm --prefix src/obsidian-tagg ci

docker run --rm -it \
  -u "$(id -u):$(id -g)" \
  -v "$PWD":/app \
  -w /app \
  node:20-alpine npm --prefix src/thunderbird-tagg ci
```

## Tests

Run the Python test suite with:

```sh
uv run python -m unittest discover -s tests -v
```

## Build releases locally

Build the Obsidian release directory:

```sh
docker run --rm -it \
  -u "$(id -u):$(id -g)" \
  -v "$PWD":/app \
  -w /app \
  node:20-alpine npm --prefix src/obsidian-tagg run build:release
```

The output is written to `dist/obsidian-tagg`.

Build the Thunderbird release directory:

```sh
docker run --rm -it \
  -u "$(id -u):$(id -g)" \
  -v "$PWD":/app \
  -w /app \
  node:20-alpine npm --prefix src/thunderbird-tagg run build:release
```

The output is written to `dist/thunderbird-tagg`. It contains the extension files and a `native-host` directory. Register that host with:

```sh
./scripts/install-thunderbird-host.sh dist/thunderbird-tagg
```

The installer copies the host to a stable user directory, writes its absolute path into the native-messaging manifest, and registers the manifest for Linux or macOS.

Build the Python distribution with:

```sh
uv build
```

The wheel and source archive are written to `dist/`.

## GitHub Releases

The workflow in `.github/workflows/release.yml` runs for tags beginning with `v`. It runs the tests, builds the Python distribution, builds both extension release directories in Node 20 Alpine, and publishes these assets:

- Python wheel and source archive.
- Obsidian plugin ZIP.
- Thunderbird XPI.
- Thunderbird native-host archive.