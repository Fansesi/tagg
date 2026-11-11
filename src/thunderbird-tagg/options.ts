declare const browser: any;

export {};

const DEFAULT_SETTINGS = {
  url: 'http://127.0.0.1:9931/v1/systemone',
  model: 'model',
  threshold: 0.1,
  numTags: 1,
  maxCandidates: 100,
  excludedTags: '',
  askSeparately: false,
};

const form = document.querySelector<HTMLFormElement>('#settings-form')!;
const statusOutput = document.querySelector<HTMLOutputElement>('#status')!;

async function restore(): Promise<void> {
  const settings = { ...DEFAULT_SETTINGS, ...(await browser.storage.local.get(DEFAULT_SETTINGS)) };
  for (const [name, value] of Object.entries(settings)) {
    const input = form.elements.namedItem(name) as HTMLInputElement | null;
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = String(value);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(form);
  void browser.storage.local.set({
    url: String(data.get('url')),
    model: String(data.get('model')),
    threshold: Number(data.get('threshold')),
    numTags: Number(data.get('numTags')),
    maxCandidates: Number(data.get('maxCandidates')),
    excludedTags: String(data.get('excludedTags') ?? ''),
    askSeparately: data.get('askSeparately') === 'on',
  }).then(() => {
    statusOutput.value = 'Saved.';
  });
});

void restore();