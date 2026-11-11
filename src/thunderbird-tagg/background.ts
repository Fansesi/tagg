declare const browser: any;

export {};

const NATIVE_HOST = 'tagg_native_host';
const LOG_PREFIX = '[Tagg]';
const DEFAULT_SETTINGS = {
  url: 'http://127.0.0.1:9931/v1/systemone',
  model: 'model',
  threshold: 0.1,
  numTags: 1,
  maxCandidates: 100,
  excludedTags: '',
  askSeparately: false,
};

type Settings = typeof DEFAULT_SETTINGS;
type MailMessage = { id: number; tags?: string[] };
type MailTag = { key: string; tag: string };
type MessagePart = { contentType?: string; body?: string; parts?: MessagePart[] };

function log(message: string, details?: unknown): void {
  if (details === undefined) {
    console.log(`${LOG_PREFIX} ${message}`);
  } else {
    console.log(`${LOG_PREFIX} ${message}`, details);
  }
}

function logError(message: string, error?: unknown): void {
  console.error(`${LOG_PREFIX} ${message}`, error);
}

log('Background script loaded.', {
  nativeHost: NATIVE_HOST,
  manifestVersion: browser.runtime.getManifest?.().manifest_version,
});

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, '');
}

function excludedTags(settings: Settings): Set<string> {
  return new Set(settings.excludedTags.split(',').map(normalizeTag).filter(Boolean));
}

function collectText(part: MessagePart): string {
  const nested = (part.parts ?? []).map(collectText).filter(Boolean).join('\n');
  if (part.contentType?.toLowerCase().startsWith('text/plain') && part.body) {
    return part.body;
  }
  return nested;
}

async function loadSettings(): Promise<Settings> {
  const settings = { ...DEFAULT_SETTINGS, ...(await browser.storage.local.get(DEFAULT_SETTINGS)) };
  log('Settings loaded.', {
    url: settings.url,
    model: settings.model,
    threshold: settings.threshold,
    numTags: settings.numTags,
    maxCandidates: settings.maxCandidates,
    excludedTags: settings.excludedTags,
    askSeparately: settings.askSeparately,
  });
  return settings;
}

async function getSelectedMessages(tabId: number): Promise<MailMessage[]> {
  log('Requesting selected messages.', { tabId });
  const selection = await browser.mailTabs.getSelectedMessages(tabId);
  const messages = (selection.messages ?? []) as MailMessage[];
  log('Selected messages received.', {
    tabId,
    count: messages.length,
    ids: messages.map((message) => message.id),
  });
  return messages;
}

async function getTargetMessages(tabId: number): Promise<MailMessage[]> {
  const getDisplayedMessage = browser.messageDisplay?.getDisplayedMessage;
  if (typeof getDisplayedMessage === 'function') {
    log('Requesting the message displayed in the reading pane.', { tabId });
    try {
      const displayed = await getDisplayedMessage.call(browser.messageDisplay, tabId);
      if (displayed) {
        log('Displayed message received.', { id: displayed.id });
        return [displayed as MailMessage];
      }
      log('No message is displayed; falling back to selected messages.');
    } catch (error) {
      logError('Could not read the displayed message; falling back to selection.', error);
    }
  } else {
    log('Displayed-message API unavailable; falling back to selected messages.');
  }
  return getSelectedMessages(tabId);
}

async function tagSelectedMessages(tabId: number): Promise<void> {
  log('Starting tagging workflow.', { tabId });
  const settings = await loadSettings();
  const selected = await getTargetMessages(tabId);
  if (selected.length === 0) {
    log('Stopping: no messages are selected.');
    throw new Error('No messages selected.');
  }

  log('Requesting Thunderbird tag catalog.');
  const tagApi = browser.messages.tags?.list;
  log('Selecting Thunderbird tag API.', {
    api: typeof tagApi === 'function' ? 'messages.tags.list' : 'unavailable',
  });
  if (typeof tagApi !== 'function') {
    throw new Error(
      'Thunderbird messages.tags.list() is unavailable. Reinstall the rebuilt extension with Manifest V2 and restart Thunderbird.',
    );
  }
  const catalog = (await tagApi.call(browser.messages.tags)) as MailTag[];
  const excluded = excludedTags(settings);
  const candidates = catalog
    .map((tag) => ({ ...tag, normalized: normalizeTag(tag.tag) }))
    .filter((tag) => tag.normalized && !excluded.has(tag.normalized))
    .slice(0, settings.maxCandidates);
  log('Candidate tags prepared.', {
    catalogCount: catalog.length,
    excluded: Array.from(excluded),
    candidateCount: candidates.length,
    candidates: candidates.map((tag) => tag.normalized),
  });
  if (candidates.length === 0) {
    log('Stopping: no candidate tags remain.');
    throw new Error('No message tags are available after exclusions.');
  }

  const messages = await Promise.all(selected.map(async (message) => {
    log('Requesting full message content.', { id: message.id });
    const full = await browser.messages.getFull(message.id) as MessagePart;
    const content = collectText(full);
    log('Message content received.', { id: message.id, contentLength: content.length });
    return { id: String(message.id), content };
  }));
  log('Sending native-host request.', {
    host: NATIVE_HOST,
    messageCount: messages.length,
    messageIds: messages.map((message) => message.id),
    candidateCount: candidates.length,
    endpoint: settings.url,
  });
  let response: any;
  try {
    response = await browser.runtime.sendNativeMessage(NATIVE_HOST, {
      version: 1,
      messages,
      tags: candidates.map((tag) => tag.normalized),
      url: settings.url,
      model: settings.model,
      num_tags: settings.numTags,
      threshold: settings.threshold,
      ask_separately: settings.askSeparately,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError('Native-host request failed.', error);
    throw new Error(
      `Native host '${NATIVE_HOST}' is unavailable. Run scripts/install-thunderbird-host.sh first. (${message})`,
    );
  }
  log('Native-host response received.', {
    hasError: Boolean(response?.error),
    resultCount: Array.isArray(response?.results) ? response.results.length : 0,
    results: response?.results?.map((result: any) => ({
      id: result.id,
      tags: result.tags,
      error: result.error,
    })),
  });
  if (response?.error) {
    logError('Native host returned a request-level error.', response.error);
    throw new Error(response.error);
  }

  const tagByName = new Map(candidates.map((tag) => [tag.normalized, tag]));
  const failures: string[] = [];
  for (const result of response.results ?? []) {
    if (result.error) {
      logError('Native host returned a message-level error.', result);
      failures.push(`${result.id}: ${result.error}`);
      continue;
    }
    const original = selected.find((message) => String(message.id) === result.id);
    const tagKeys = (result.tags ?? [])
      .map(normalizeTag)
      .map((tag: string) => tagByName.get(tag)?.key)
      .filter(Boolean);
    if (original && tagKeys.length > 0) {
      log('Applying tags to message.', { id: original.id, tags: tagKeys });
      await browser.messages.update(original.id, {
        tags: Array.from(new Set([...(original.tags ?? []), ...tagKeys])),
      });
    } else {
      log('No applicable tags returned for message.', {
        id: result.id,
        returnedTags: result.tags ?? [],
      });
    }
  }
  if (failures.length > 0) {
    logError('Tagging completed with message-level failures.', failures);
    throw new Error(`${failures.length} message(s) failed: ${failures.join('; ')}`);
  }
  log('Tagging workflow completed.', { messageCount: selected.length });
}

async function runForTab(tabId: number): Promise<void> {
  log('Tag command invoked.', { tabId });
  try {
    await tagSelectedMessages(tabId);
    log('Showing success notification.');
    await browser.notifications.create({
      type: 'basic',
      title: 'Tagg',
      message: 'Selected messages tagged successfully.',
    });
  } catch (error) {
    logError('Tag command failed.', error);
    await browser.notifications.create({
      type: 'basic',
      title: 'Tagg failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

browser.runtime.onInstalled.addListener(() => {
  log('Extension installed or updated; creating message menu.');
  try {
    const result = browser.menus.create({
      id: 'tagg-selected-messages',
      title: 'Tag displayed message with Tagg',
      contexts: ['message_list'],
    });
    if (result && typeof result.then === 'function') {
      void result.then(() => log('Message menu created.')).catch((error: unknown) => {
        logError('Failed to create message menu.', error);
      });
    } else {
      log('Message menu creation requested.');
    }
  } catch (error) {
    logError('Failed to create message menu.', error);
  }
});

browser.menus.onClicked.addListener((info: { menuItemId: string; tabId: number }) => {
  log('Menu click received.', info);
  if (info.menuItemId === 'tagg-selected-messages') {
    void runForTab(info.tabId);
  }
});

browser.messageDisplayAction.onClicked.addListener((tab: { id?: number }) => {
  log('Reading-pane Tagg button clicked.', tab);
  if (tab.id !== undefined) {
    void runForTab(tab.id);
  } else {
    logError('Reading-pane button click did not include a tab id.', tab);
  }
});