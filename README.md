## Development

The Python package is managed by the root `pyproject.toml`. The Obsidian plugin has its own npm project under `src/obsidian-tagg`.

To build a release plugin directory, run the npm command inside the Node container used for plugin development:

```sh
npm --prefix src/obsidian-tagg run build:release
```

The output is written to `dist/obsidian-tagg`. Copy that directory to `<vault>/.obsidian/plugins/obsidian-tagg/`.

The plugin bundles the Python source under `python/tagg` and runs it with `python -m tagg`. It uses a configured Python executable when provided, otherwise it tries `python3`, `python`, and `py -3` on Windows. Python itself is not bundled, and `uv` is only a development/install option.

Candidate tags are collected automatically from the vault through Obsidian's metadata cache. Use the `Excluded Tags` setting for a comma-separated list of tags that should not be offered to the model; entries may be written with or without a leading `#`.

## Thunderbird prototype

The Thunderbird implementation is a desktop WebExtension plus a native-messaging companion host. Thunderbird cannot execute Python directly from an XPI, so the extension sends selected message content to the host. The host contains the `tagg` Python source and uses the user's installed Python runtime; no Python interpreter or llama.cpp model is bundled.

The current prototype supports:

- Tagging the message currently displayed in the reading pane from the message context menu.
- Falling back to selected messages when no message is currently displayed.
- Existing Thunderbird tags as model candidates.
- Excluded tags, candidate limits, tag thresholds, and multiple tags per message.
- Native-messaging JSON framing with per-message errors.

To build the Thunderbird release with the repository's Node container:

```sh
docker run --rm -it \
	-u "$(id -u):$(id -g)" \
	-v "$PWD":/app \
	-w /app \
	node:20-alpine npm --prefix src/thunderbird-tagg install

docker run --rm -it \
	-u "$(id -u):$(id -g)" \
	-v "$PWD":/app \
	-w /app \
	node:20-alpine npm --prefix src/thunderbird-tagg run build:release
```

The output is written to `dist/thunderbird-tagg`. Register the native host before using the extension:

```sh
./scripts/install-thunderbird-host.sh
```

The installer copies the host to a stable user directory, writes the absolute launcher path into the native-messaging manifest, and registers it in the standard Linux or macOS Mozilla host directory. Set `TAGG_PYTHON=/path/to/python` when the required interpreter is not available as `python3`. Restart Thunderbird after registering the host, then install the extension from the generated release directory as an XPI.

The native host expects Python 3.10 or newer and an already-running llama.cpp endpoint. Windows host registration still needs a platform-specific installer; the generated `native-host` directory contains the Python host and manifest inputs for that installer.
