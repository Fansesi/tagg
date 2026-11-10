## Development

The Python package is managed by the root `pyproject.toml`. The Obsidian plugin has its own npm project under `src/obsidian-tagg`.

To build a release plugin directory, run the npm command inside the Node container used for plugin development:

```sh
npm --prefix src/obsidian-tagg run build:release
```

The output is written to `dist/obsidian-tagg`. Copy that directory to `<vault>/.obsidian/plugins/obsidian-tagg/`.

The plugin bundles the Python source under `python/tagg` and runs it with `python -m tagg`. It uses a configured Python executable when provided, otherwise it tries `python3`, `python`, and `py -3` on Windows. Python itself is not bundled, and `uv` is only a development/install option.

Candidate tags are collected automatically from the vault through Obsidian's metadata cache. Use the `Excluded Tags` setting for a comma-separated list of tags that should not be offered to the model; entries may be written with or without a leading `#`.
