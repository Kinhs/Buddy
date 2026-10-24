// Tauri bridge: exposes the window.buddy API the renderer talks to.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

window.buddy = {
  onEvent: (cb) => listen('event', (e) => cb(e.payload)),
  onAsk: (cb) => listen('ask', (e) => cb(e.payload)),
  onAskClosed: (cb) => listen('ask-closed', (e) => cb(e.payload)),
  onSkin: (cb) => listen('skin', (e) => cb(e.payload)),
  answer: (id, result) => invoke('answer', { id, result }),
  resize: (width, height) => invoke('resize', { width, height }),
  menu: (skin) => invoke('menu', { skin }),
};
