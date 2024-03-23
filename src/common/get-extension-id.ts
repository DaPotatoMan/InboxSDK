import browser from 'webextension-polyfill';

export default function getExtensionId(): string | null {
  try {
    return browser.runtime.id;
  } catch (error) {
    console.error('Failed to get extension id');
  }

  return null;
}
