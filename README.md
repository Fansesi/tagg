# Tagg

Tagg uses a local decision model to suggest tags for file content. It sends content and candidate tags to a local `llama.cpp` server, then returns the tags that meet the configured confidence threshold.

Tagg is available as:

- A command-line tool for tagging files and scripts.
- An Obsidian plugin for tagging Markdown notes.
- A Thunderbird extension for tagging messages.

The model runs locally. Tagg does not upload your files or bundle a Python interpreter or model.

## Requirements

All integrations require:

- Python 3.10 or newer.
- A running `llama.cpp` server with the Tagg-compatible `systemone` endpoint. Note that you may need a later version of `llama.cpp`.
- A model that can evaluate the JSON requests sent to that endpoint. 

Additional requirements depend on the integration:

- CLI: Python package installation.
- Obsidian: Obsidian 1.4.10 or newer, desktop edition.
- Thunderbird: Thunderbird 115 or newer, Python 3.10 or newer, and the Tagg native-messaging host registered with Thunderbird (use `scripts/install-thunderbird-host.sh`)

## Install

Download the latest release from GitHub Releases. Release assets are provided for each integration.

### CLI

Install the Python wheel with pip:

```sh
python3 -m pip install tagg-*.whl
```

Or install it as a standalone tool with [uv](https://docs.astral.sh/uv/):

```sh
uv tool install tagg-*.whl
```

### Obsidian

1. Download the `obsidian-tagg-*.zip` release asset.
2. Extract it to `<vault>/.obsidian/plugins/obsidian-tagg/`.
3. Enable **Tagg** in Obsidian's community plugins settings.
4. Open Tagg settings and configure the Python executable and model endpoint if the defaults do not apply.

The plugin uses existing tags in the vault as candidate tags. It can tag the active note or all Markdown files inside selected folders.

### Thunderbird

1. Download and install the `thunderbird-tagg-*.xpi` release asset in Thunderbird.
2. Extract `thunderbird-native-host-*.tar.gz`.
3. Register the extracted native host with the installer from a source checkout:

```sh
./scripts/install-thunderbird-host.sh /path/to/extracted
```

Set `TAGG_PYTHON=/path/to/python` before running the installer when `python3` is not the required interpreter.
4. Restart Thunderbird and configure the extension from its settings page.

The native host installer currently supports Linux and macOS. Windows requires platform-specific native-messaging registration.

## CLI usage

Start the model server, then run Tagg with one or more files and candidate tags:

```sh
tagg \
  --paths notes/example.md \
  --tags work personal research \
  --url http://127.0.0.1:9931/v1/systemone
```

The command prints a JSON object mapping each file to its selected tags. Useful options include:

- `--num-tags-per-file N` to select more than one tag.
- `--threshold VALUE` to require a higher or lower confidence.
- `--max-bytes N` to limit how much of each file is read.
- `--start-server --model MODEL` to let Tagg start and stop `llama serve` for the run.
- `--verbose` and `--log-file PATH` for diagnostics.

Run `tagg --help` for the complete option list.

## Privacy and Limitations

Tagg sends file or message content to the local endpoint configured by you. Keep the endpoint local if content must remain on your machine. The model, `llama.cpp`, and Python runtime are not included in the release assets.

The integrations are desktop applications. The Obsidian and Thunderbird extensions do not support mobile or web-only environments.