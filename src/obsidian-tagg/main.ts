import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { execFile } from 'child_process';

interface AutoTaggerSettings {
  pythonPath: string;
  cliScriptPath: string;
  serverUrl: string;
  candidateTags: string;
}

const DEFAULT_SETTINGS: AutoTaggerSettings = {
  pythonPath: 'python3',
  cliScriptPath: '/absolute/path/to/autotagger.py',
  serverUrl: 'http://127.0.0.1:8080/v1/systemone',
  candidateTags: 'systems-programming, posix, benchmarking, cuda, documentation, python',
};

export default class AutoTaggerPlugin extends Plugin {
  settings: AutoTaggerSettings;

  async onload() {
    await this.loadSettings();

    // Register command in Obsidian Command Palette (Ctrl+P)
    this.addCommand({
      id: 'tag-active-file',
      name: 'Run JEV Auto-Tagger on active note',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === 'md') {
          if (!checking) {
            this.tagCurrentFile(file);
          }
          return true;
        }
        return false;
      },
    });

    // Add settings page
    this.addSettingTab(new AutoTaggerSettingTab(this.app, this));
  }

  async tagCurrentFile(file: TFile) {
    new Notice(`Evaluating tags for ${file.basename}...`);

    // Resolve system path of vault file
    const adapter = this.app.vault.adapter as any;
    const fullPath = adapter.getFullPath ? adapter.getFullPath(file.path) : file.path;

    const tagsArray = this.settings.candidateTags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const args = [
      this.settings.cliScriptPath,
      '--paths', fullPath,
      '--url', this.settings.serverUrl,
      '--tags', ...tagsArray,
    ];

    execFile(this.settings.pythonPath, args, async (error, stdout, stderr) => {
      if (error) {
        new Notice(`Auto-Tagger execution failed: ${error.message}`);
        console.error('AutoTagger Stderr:', stderr);
        return;
      }

      try {
        const result = JSON.parse(stdout);
        const assignedTags: string[] = result[fullPath] || [];

        if (assignedTags.length === 0) {
          new Notice('JEV Model finished: No candidate tags met the confidence threshold.');
          return;
        }

        // Write tags directly to YAML frontmatter
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          const existing = frontmatter.tags || [];
          const existingList = Array.isArray(existing) ? existing : [existing];
          const merged = Array.from(new Set([...existingList, ...assignedTags]));
          frontmatter.tags = merged;
        });

        new Notice(`Assigned tags: ${assignedTags.join(', ')}`);
      } catch (parseErr) {
        new Notice('Failed to parse CLI output.');
        console.error('Parse error:', parseErr, 'Raw output:', stdout);
      }
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class AutoTaggerSettingTab extends PluginSettingTab {
  plugin: AutoTaggerPlugin;

  constructor(app: App, plugin: AutoTaggerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Auto Tagger (JEV) Settings' });

    new Setting(containerEl)
      .setName('Python Executable')
      .setDesc('Path to python binary.')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.pythonPath)
          .onChange(async (val) => {
            this.plugin.settings.pythonPath = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('CLI Script Path')
      .setDesc('Absolute path to autotagger.py.')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.cliScriptPath)
          .onChange(async (val) => {
            this.plugin.settings.cliScriptPath = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Candidate Tags')
      .setDesc('Comma-separated list of candidate tags.')
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.candidateTags)
          .onChange(async (val) => {
            this.plugin.settings.candidateTags = val;
            await this.plugin.saveSettings();
          })
      );
  }
}