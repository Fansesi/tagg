var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TaggPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_child_process = require("child_process");
var import_path = __toESM(require("path"));
var import_process = __toESM(require("process"));
var DEFAULT_SETTINGS = {
  pythonPath: "",
  serverUrl: "http://127.0.0.1:9931/v1/systemone",
  excludedTags: "",
  maxCandidateTags: null,
  model: "model",
  threshold: 0.1,
  numTagsPerFile: 1,
  askSeparately: false,
  startServer: false
};
var TaggPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.activeRun = false;
  }
  async onload() {
    await this.loadSettings();
    this.addCommand({
      id: "tag-active-file",
      name: "Tag active note with tagg",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === "md") {
          if (!checking) {
            void this.tagFiles([file]);
          }
          return true;
        }
        return false;
      }
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof import_obsidian.TFolder) {
          this.addFolderMenuItem(menu, [file]);
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("files-menu", (menu, files) => {
        const folders = files.filter((file) => file instanceof import_obsidian.TFolder);
        if (folders.length > 0) {
          this.addFolderMenuItem(menu, folders);
        }
      })
    );
    this.addSettingTab(new TaggSettingTab(this.app, this));
  }
  addFolderMenuItem(menu, folders) {
    menu.addItem((item) => {
      item.setTitle("Tag Markdown files with tagg").setIcon("tags").onClick(() => {
        const files = this.collectMarkdownFiles(folders);
        void this.tagFiles(files);
      });
    });
  }
  collectMarkdownFiles(folders) {
    const files = /* @__PURE__ */ new Map();
    for (const folder of folders) {
      import_obsidian.Vault.recurseChildren(folder, (file) => {
        if (file instanceof import_obsidian.TFile && file.extension === "md") {
          files.set(file.path, file);
        }
      });
    }
    return Array.from(files.values());
  }
  getFullPath(file) {
    const adapter = this.app.vault.adapter;
    return adapter.getFullPath ? adapter.getFullPath(file.path) : file.path;
  }
  getPythonWorkingDirectory() {
    const adapter = this.app.vault.adapter;
    const pluginPath = import_path.default.join(String(this.manifest.dir ?? ""), "python");
    return adapter.getFullPath ? adapter.getFullPath(pluginPath) : pluginPath;
  }
  getPythonCommands() {
    const configuredPath = this.settings.pythonPath.trim();
    if (configuredPath.length > 0) {
      return [{ executable: configuredPath, args: [] }];
    }
    const commands = [];
    commands.push({ executable: "python3", args: [] });
    commands.push({ executable: "python", args: [] });
    if (import_process.default.platform === "win32") {
      commands.push({ executable: "py", args: ["-3"] });
    }
    return commands;
  }
  getCandidateTags() {
    const excludedTags = new Set(
      this.settings.excludedTags.split(",").map((tag) => tag.trim().replace(/^#+/, "")).filter((tag) => tag.length > 0)
    );
    const vaultTags = /* @__PURE__ */ new Set();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      for (const tag of cache?.tags ?? []) {
        vaultTags.add(tag.tag);
      }
      for (const tag of (0, import_obsidian.parseFrontMatterTags)(cache?.frontmatter) ?? []) {
        vaultTags.add(tag);
      }
    }
    const candidateTags = Array.from(vaultTags).map((tag) => tag.replace(/^#+/, "")).filter((tag) => tag.length > 0 && !excludedTags.has(tag));
    for (let index = candidateTags.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [candidateTags[index], candidateTags[swapIndex]] = [candidateTags[swapIndex], candidateTags[index]];
    }
    return this.settings.maxCandidateTags === null ? candidateTags : candidateTags.slice(0, this.settings.maxCandidateTags);
  }
  buildArgs(paths, candidateTags) {
    const args = [
      "-m",
      "tagg",
      "--paths",
      ...paths,
      "--url",
      this.settings.serverUrl,
      "--tags",
      ...candidateTags,
      "--model",
      this.settings.model,
      "--threshold",
      String(this.settings.threshold),
      "--num-tags-per-file",
      String(this.settings.numTagsPerFile)
    ];
    if (this.settings.askSeparately) {
      args.push("--ask-separately");
    }
    if (this.settings.startServer) {
      args.push("--start-server");
    }
    return args;
  }
  async tagFiles(files) {
    if (this.activeRun) {
      new import_obsidian.Notice("Tagg is already processing files.");
      return;
    }
    if (files.length === 0) {
      new import_obsidian.Notice("No Markdown files found.");
      return;
    }
    const candidateTags = this.getCandidateTags();
    if (candidateTags.length === 0) {
      new import_obsidian.Notice("No vault tags are available after exclusions.");
      return;
    }
    this.activeRun = true;
    const startedAt = Date.now();
    const status = this.addStatusBarItem();
    let completed = 0;
    const updateStatus = (message) => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1e3);
      status.setText(`tagg: ${message} | ${elapsed}s`);
    };
    updateStatus(`waiting 0/${files.length}`);
    new import_obsidian.Notice(`Tagg is evaluating ${files.length} Markdown file${files.length === 1 ? "" : "s"}...`);
    const paths = files.map((file) => this.getFullPath(file));
    try {
      const result = await this.runCli(paths, files.length, candidateTags, (event) => {
        completed = event.completed;
        updateStatus(`evaluating ${completed}/${event.total}`);
      });
      let assignedCount = 0;
      let errorCount = 0;
      for (const file of files) {
        const fileResult = result[this.getFullPath(file)];
        if (!fileResult) {
          errorCount += 1;
          continue;
        }
        if (fileResult.error) {
          errorCount += 1;
          continue;
        }
        const assignedTags = Array.isArray(fileResult.tags) ? fileResult.tags : [];
        if (assignedTags.length === 0) {
          completed = Math.max(completed, files.indexOf(file) + 1);
          updateStatus(`writing ${completed}/${files.length}`);
          continue;
        }
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          const existing = frontmatter.tags || [];
          const existingList = Array.isArray(existing) ? existing : [existing];
          frontmatter.tags = Array.from(/* @__PURE__ */ new Set([...existingList, ...assignedTags]));
        });
        assignedCount += assignedTags.length;
        completed = Math.max(completed, files.indexOf(file) + 1);
        updateStatus(`writing ${completed}/${files.length}`);
      }
      const elapsed = Math.floor((Date.now() - startedAt) / 1e3);
      status.setText(`tagg: complete | ${elapsed}s`);
      new import_obsidian.Notice(`Tagg finished: ${assignedCount} tag${assignedCount === 1 ? "" : "s"} assigned${errorCount ? `, ${errorCount} file${errorCount === 1 ? "" : "s"} failed` : ""}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const elapsed = Math.floor((Date.now() - startedAt) / 1e3);
      status.setText(`tagg: failed | ${elapsed}s`);
      new import_obsidian.Notice(`Tagg failed after ${completed}/${files.length} files: ${message}`);
      console.error("Tagg error:", error);
    } finally {
      this.activeRun = false;
      window.setTimeout(() => status.remove(), 5e3);
    }
  }
  runCli(paths, total, candidateTags, onProgress) {
    const commands = this.getPythonCommands();
    const attempt = (index) => {
      const command = commands[index];
      return new Promise((resolve, reject) => {
        const child = (0, import_child_process.spawn)(command.executable, [...command.args, ...this.buildArgs(paths, candidateTags)], {
          cwd: this.getPythonWorkingDirectory(),
          windowsHide: true
        });
        let stdout = "";
        let stderrBuffer = "";
        const stderrDiagnostics = [];
        let settled = false;
        const fail = (error) => {
          if (!settled) {
            settled = true;
            if (error.message.includes("ENOENT") && index + 1 < commands.length) {
              void attempt(index + 1).then(resolve, reject);
            } else {
              reject(error);
            }
          }
        };
        child.stdout.on("data", (data) => {
          stdout += data.toString();
        });
        child.stderr.on("data", (data) => {
          stderrBuffer += data.toString();
          const lines = stderrBuffer.split(/\r?\n/);
          stderrBuffer = lines.pop() || "";
          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              if (event.event === "progress" && event.total === total) {
                onProgress(event);
              } else {
                stderrDiagnostics.push(line);
              }
            } catch {
              stderrDiagnostics.push(line);
              console.debug("Tagg CLI:", line);
            }
          }
        });
        child.on("error", fail);
        child.on("close", (code) => {
          if (settled) {
            return;
          }
          if (code !== 0) {
            if (stderrBuffer.trim().length > 0) {
              stderrDiagnostics.push(stderrBuffer.trim());
            }
            const diagnostics = stderrDiagnostics.join("\n");
            fail(new Error(`CLI exited with code ${code}${diagnostics ? `: ${diagnostics}` : ""}`));
            return;
          }
          try {
            settled = true;
            resolve(JSON.parse(stdout));
          } catch (error) {
            fail(new Error(`Failed to parse CLI output: ${error instanceof Error ? error.message : String(error)}`));
          }
        });
      });
    };
    return attempt(0).catch((error) => {
      if (error instanceof Error && error.message.includes("ENOENT")) {
        throw new Error("No Python interpreter found. Configure a Python executable in Tagg settings.");
      }
      throw error;
    });
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var TaggSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Tagg Settings" });
    new import_obsidian.Setting(containerEl).setName("Python Executable").setDesc("Optional executable path. If empty, Tagg tries python3, python, then py -3 on Windows.").addText(
      (text) => text.setValue(this.plugin.settings.pythonPath).onChange(async (val) => {
        this.plugin.settings.pythonPath = val;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Server URL").setDesc("llama.cpp systemone endpoint.").addText(
      (text) => text.setValue(this.plugin.settings.serverUrl).onChange(async (value) => {
        this.plugin.settings.serverUrl = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Excluded Tags").setDesc("Comma-separated tags to exclude. The leading # is optional.").addTextArea(
      (text) => text.setValue(this.plugin.settings.excludedTags).onChange(async (val) => {
        this.plugin.settings.excludedTags = val;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Maximum Candidate Tags").setDesc("Optional positive integer. Tags are shuffled before this limit is applied.").addText(
      (text) => text.setPlaceholder("Unlimited").setValue(this.plugin.settings.maxCandidateTags === null ? "" : String(this.plugin.settings.maxCandidateTags)).onChange(async (value) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          this.plugin.settings.maxCandidateTags = null;
          await this.plugin.saveSettings();
          return;
        }
        const maxCandidateTags = Number(trimmed);
        if (Number.isInteger(maxCandidateTags) && maxCandidateTags > 0) {
          this.plugin.settings.maxCandidateTags = maxCandidateTags;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Model").addText(
      (text) => text.setValue(this.plugin.settings.model).onChange(async (value) => {
        this.plugin.settings.model = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Threshold").setDesc("Minimum confidence from 0 to 1.").addText(
      (text) => text.setValue(String(this.plugin.settings.threshold)).onChange(async (value) => {
        const threshold = Number(value);
        if (Number.isFinite(threshold) && threshold >= 0 && threshold <= 1) {
          this.plugin.settings.threshold = threshold;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Tags per file").addText(
      (text) => text.setValue(String(this.plugin.settings.numTagsPerFile)).onChange(async (value) => {
        const count = Number(value);
        if (Number.isInteger(count) && count > 0) {
          this.plugin.settings.numTagsPerFile = count;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Ask separately").setDesc("Ask the model repeatedly for additional tags.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.askSeparately).onChange(async (value) => {
        this.plugin.settings.askSeparately = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Start server").setDesc("Start and stop llama.cpp for each batch.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.startServer).onChange(async (value) => {
        this.plugin.settings.startServer = value;
        await this.plugin.saveSettings();
      })
    );
  }
};
