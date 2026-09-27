// Stable VK Callback API entrypoint.
// Student traffic is handled by the canonical cross-channel CJM in vk-entry.js;
// teacher/admin traffic falls through to vk-legacy.js unchanged.
export { default } from './vk-entry.js';
