import { App, Menu, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, TFolder, Vault, parseFrontMatterTags } from 'obsidian';
import { spawn } from 'child_process';
import path from 'path';
import process from 'process';

interface TaggSettings {
  pythonPath: string;
  serverUrl: string;
  excludedTags: string;
  maxCandidateTags: number | null;
  model: string;
  threshold: number;
  numTagsPerFile: number;
  askSeparately: boolean;
  startServer: boolean;
}

interface TaggFileResult {
  tags?: string[];
  error?: string;
}

interface TaggBatchResult {
  [path: string]: TaggFileResult;
}

interface TaggProgressEvent {
  event: 'progress';
  path: string;
  completed: number;
  total: number;
}

const DEFAULT_SETTINGS: TaggSettings = {
  pythonPath: '',
  serverUrl: 'http://127.0.0.1:9931/v1/systemone',
  excludedTags: '',
  maxCandidateTags: null,
  model: 'model',
  threshold: 0.1,
  numTagsPerFile: 1,
  askSeparately: false,
  startServer: false,
};

export default class TaggPlugin extends Plugin {
  settings!: TaggSettings;
  private activeRun = false;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: 'tag-active-file',
      name: 'Tag active note with tagg',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === 'md') {
          if (!checking) {
            void this.tagFiles([file]);
          }
          return true;
        }
        return false;
      },
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
        if (file instanceof TFolder) {
          this.addFolderMenuItem(menu, [file]);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on('files-menu', (menu: Menu, files: TAbstractFile[]) => {
        const folders = files.filter((file): file is TFolder => file instanceof TFolder);
        if (folders.length > 0) {
          this.addFolderMenuItem(menu, folders);
        }
      })
    );

    this.addSettingTab(new TaggSettingTab(this.app, this));
  }

  private addFolderMenuItem(menu: Menu, folders: TFolder[]) {
    menu.addItem((item) => {
      item
        .setTitle('Tag Markdown files with tagg')
        .setIcon('tags')
        .onClick(() => {
          const files = this.collectMarkdownFiles(folders);
          void this.tagFiles(files);
        });
    });
  }

  private collectMarkdownFiles(folders: TFolder[]): TFile[] {
    const files = new Map<string, TFile>();
    for (const folder of folders) {
      Vault.recurseChildren(folder, (file: TAbstractFile) => {
        if (file instanceof TFile && file.extension === 'md') {
          files.set(file.path, file);
        }
      });
    }
    return Array.from(files.values());
  }

  private getFullPath(file: TFile): string {
    const adapter = this.app.vault.adapter as { getFullPath?: (path: string) => string };
    return adapter.getFullPath ? adapter.getFullPath(file.path) : file.path;
  }

  private getPythonWorkingDirectory(): string {
    const adapter = this.app.vault.adapter as { getFullPath?: (path: string) => string };
    const pluginPath = path.join(String(this.manifest.dir ?? ''), 'python');
    return adapter.getFullPath ? adapter.getFullPath(pluginPath) : pluginPath;
  }

  private getPythonCommands(): Array<{ executable: string; args: string[] }> {
    const configuredPath = this.settings.pythonPath.trim();
    if (configuredPath.length > 0) {
      return [{ executable: configuredPath, args: [] }];
    }

    const commands = [] as Array<{ executable: string; args: string[] }>;
    commands.push({ executable: 'python3', args: [] });
    commands.push({ executable: 'python', args: [] });
    if (process.platform === 'win32') {
      commands.push({ executable: 'py', args: ['-3'] });
    }
    return commands;
  }

  private getCandidateTags(): string[] {
    const excludedTags = new Set(
      this.settings.excludedTags
        .split(',')
        .map((tag) => tag.trim().replace(/^#+/, ''))
        .filter((tag) => tag.length > 0)
    );

    const vaultTags = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      for (const tag of cache?.tags ?? []) {
        vaultTags.add(tag.tag);
      }
      for (const tag of parseFrontMatterTags(cache?.frontmatter) ?? []) {
        vaultTags.add(tag);
      }
    }

    const candidateTags = Array.from(vaultTags)
      .map((tag) => tag.replace(/^#+/, ''))
      .filter((tag) => tag.length > 0 && !excludedTags.has(tag));

    for (let index = candidateTags.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [candidateTags[index], candidateTags[swapIndex]] = [candidateTags[swapIndex], candidateTags[index]];
    }

    return this.settings.maxCandidateTags === null
      ? candidateTags
      : candidateTags.slice(0, this.settings.maxCandidateTags);
  }

  private buildArgs(paths: string[], candidateTags: string[]): string[] {
    const args = [
      '-m',
      'tagg',
      '--paths',
      ...paths,
      '--url',
      this.settings.serverUrl,
      '--tags',
      ...candidateTags,
      '--model',
      this.settings.model,
      '--threshold',
      String(this.settings.threshold),
      '--num-tags-per-file',
      String(this.settings.numTagsPerFile),
    ];

    if (this.settings.askSeparately) {
      args.push('--ask-separately');
    }
    if (this.settings.startServer) {
      args.push('--start-server');
    }
    return args;
  }

  private async tagFiles(files: TFile[]) {
    if (this.activeRun) {
      new Notice('Tagg is already processing files.');
      return;
    }
    if (files.length === 0) {
      new Notice('No Markdown files found.');
      return;
    }
    const candidateTags = this.getCandidateTags();
    if (candidateTags.length === 0) {
      new Notice('No vault tags are available after exclusions.');
      return;
    }

    this.activeRun = true;
    const startedAt = Date.now();
    const status = this.addStatusBarItem();
    let completed = 0;
    const updateStatus = (message: string) => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      status.setText(`tagg: ${message} | ${elapsed}s`);
    };
    updateStatus(`waiting 0/${files.length}`);
    new Notice(`Tagg is evaluating ${files.length} Markdown file${files.length === 1 ? '' : 's'}...`);

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
          frontmatter.tags = Array.from(new Set([...existingList, ...assignedTags]));
        });
        assignedCount += assignedTags.length;
        completed = Math.max(completed, files.indexOf(file) + 1);
        updateStatus(`writing ${completed}/${files.length}`);
      }

      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      status.setText(`tagg: complete | ${elapsed}s`);
      new Notice(`Tagg finished: ${assignedCount} tag${assignedCount === 1 ? '' : 's'} assigned${errorCount ? `, ${errorCount} file${errorCount === 1 ? '' : 's'} failed` : ''}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      status.setText(`tagg: failed | ${elapsed}s`);
      new Notice(`Tagg failed after ${completed}/${files.length} files: ${message}`);
      console.error('Tagg error:', error);
    } finally {
      this.activeRun = false;
      window.setTimeout(() => status.remove(), 5000);
    }
  }

  private runCli(
    paths: string[],
    total: number,
    candidateTags: string[],
    onProgress: (event: TaggProgressEvent) => void
  ): Promise<TaggBatchResult> {
    const commands = this.getPythonCommands();
    const attempt = (index: number): Promise<TaggBatchResult> => {
      const command = commands[index];
      return new Promise((resolve, reject) => {
        const child = spawn(command.executable, [...command.args, ...this.buildArgs(paths, candidateTags)], {
          cwd: this.getPythonWorkingDirectory(),
          windowsHide: true,
        });
      let stdout = '';
      let stderrBuffer = '';
      const stderrDiagnostics: string[] = [];
      let settled = false;

      const fail = (error: Error) => {
        if (!settled) {
          settled = true;
          if (error.message.includes('ENOENT') && index + 1 < commands.length) {
            void attempt(index + 1).then(resolve, reject);
          } else {
            reject(error);
          }
        }
      };

      child.stdout.on('data', (data: Buffer | string) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data: Buffer | string) => {
        stderrBuffer += data.toString();
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() || '';
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as TaggProgressEvent;
            if (event.event === 'progress' && event.total === total) {
              onProgress(event);
            } else {
              stderrDiagnostics.push(line);
            }
          } catch {
            stderrDiagnostics.push(line);
            console.debug('Tagg CLI:', line);
          }
        }
      });
      child.on('error', fail);
      child.on('close', (code) => {
        if (settled) {
          return;
        }
        if (code !== 0) {
          if (stderrBuffer.trim().length > 0) {
            stderrDiagnostics.push(stderrBuffer.trim());
          }
          const diagnostics = stderrDiagnostics.join('\n');
          fail(new Error(`CLI exited with code ${code}${diagnostics ? `: ${diagnostics}` : ''}`));
          return;
        }
        try {
          settled = true;
          resolve(JSON.parse(stdout) as TaggBatchResult);
        } catch (error) {
          fail(new Error(`Failed to parse CLI output: ${error instanceof Error ? error.message : String(error)}`));
        }
        });
      });
    };

    return attempt(0).catch((error) => {
      if (error instanceof Error && error.message.includes('ENOENT')) {
        throw new Error('No Python interpreter found. Configure a Python executable in Tagg settings.');
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
}

class TaggSettingTab extends PluginSettingTab {
  plugin: TaggPlugin;

  constructor(app: App, plugin: TaggPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Tagg Settings' });

    new Setting(containerEl)
      .setName('Python Executable')
      .setDesc('Optional executable path. If empty, Tagg tries python3, python, then py -3 on Windows.')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.pythonPath)
          .onChange(async (val) => {
            this.plugin.settings.pythonPath = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('llama.cpp systemone endpoint.')
      .addText((text) =>
        text.setValue(this.plugin.settings.serverUrl).onChange(async (value) => {
          this.plugin.settings.serverUrl = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Excluded Tags')
      .setDesc('Comma-separated tags to exclude. The leading # is optional.')
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.excludedTags)
          .onChange(async (val) => {
            this.plugin.settings.excludedTags = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Maximum Candidate Tags')
      .setDesc('Optional positive integer. Tags are shuffled before this limit is applied.')
      .addText((text) =>
        text
          .setPlaceholder('Unlimited')
          .setValue(this.plugin.settings.maxCandidateTags === null ? '' : String(this.plugin.settings.maxCandidateTags))
          .onChange(async (value) => {
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

    new Setting(containerEl)
      .setName('Model')
      .addText((text) =>
        text.setValue(this.plugin.settings.model).onChange(async (value) => {
          this.plugin.settings.model = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Threshold')
      .setDesc('Minimum confidence from 0 to 1.')
      .addText((text) =>
        text.setValue(String(this.plugin.settings.threshold)).onChange(async (value) => {
          const threshold = Number(value);
          if (Number.isFinite(threshold) && threshold >= 0 && threshold <= 1) {
            this.plugin.settings.threshold = threshold;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Tags per file')
      .addText((text) =>
        text.setValue(String(this.plugin.settings.numTagsPerFile)).onChange(async (value) => {
          const count = Number(value);
          if (Number.isInteger(count) && count > 0) {
            this.plugin.settings.numTagsPerFile = count;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Ask separately')
      .setDesc('Ask the model repeatedly for additional tags.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.askSeparately).onChange(async (value) => {
          this.plugin.settings.askSeparately = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Start server')
      .setDesc('Start and stop llama.cpp for each batch.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.startServer).onChange(async (value) => {
          this.plugin.settings.startServer = value;
          await this.plugin.saveSettings();
        })
      );
  }
}