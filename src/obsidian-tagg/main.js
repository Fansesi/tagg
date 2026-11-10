var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TaggPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_child_process = require("child_process");
var DEFAULT_SETTINGS = {
  pythonPath: "python3",
  runnerArguments: "",
  cliScriptPath: "/absolute/path/to/tagg.py",
  serverUrl: "http://127.0.0.1:9931/v1/systemone",
  candidateTags: "systems-programming, posix, benchmarking, cuda, documentation, python",
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
  getCandidateTags() {
    return this.settings.candidateTags.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  }
  buildArgs(paths) {
    const runnerArguments = this.settings.runnerArguments.trim().split(/\s+/).filter((argument) => argument.length > 0);
    const commandArguments = this.settings.cliScriptPath.trim().length > 0 ? [this.settings.cliScriptPath] : [];
    const args = [
      ...runnerArguments,
      ...commandArguments,
      "--paths",
      ...paths,
      "--url",
      this.settings.serverUrl,
      "--tags",
      ...this.getCandidateTags(),
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
      const result = await this.runCli(paths, files.length, (event) => {
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
  runCli(paths, total, onProgress) {
    return new Promise((resolve, reject) => {
      const child = (0, import_child_process.spawn)(this.settings.pythonPath, this.buildArgs(paths), {
        windowsHide: true
      });
      let stdout = "";
      let stderrBuffer = "";
      const stderrDiagnostics = [];
      let settled = false;
      const fail = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
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
    new import_obsidian.Setting(containerEl).setName("Python Executable").setDesc("Executable, such as python3 or uv.").addText(
      (text) => text.setValue(this.plugin.settings.pythonPath).onChange(async (val) => {
        this.plugin.settings.pythonPath = val;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Runner Arguments").setDesc('Optional arguments before the script, such as "run tagg" for uv.').addText(
      (text) => text.setValue(this.plugin.settings.runnerArguments).onChange(async (val) => {
        this.plugin.settings.runnerArguments = val;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("CLI Script Path").setDesc("Script path; leave empty when using a console command such as uv run tagg.").addText(
      (text) => text.setValue(this.plugin.settings.cliScriptPath).onChange(async (val) => {
        this.plugin.settings.cliScriptPath = val;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Server URL").setDesc("llama.cpp systemone endpoint.").addText(
      (text) => text.setValue(this.plugin.settings.serverUrl).onChange(async (value) => {
        this.plugin.settings.serverUrl = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Candidate Tags").setDesc("Comma-separated list of candidate tags.").addTextArea(
      (text) => text.setValue(this.plugin.settings.candidateTags).onChange(async (val) => {
        this.plugin.settings.candidateTags = val;
        await this.plugin.saveSettings();
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
