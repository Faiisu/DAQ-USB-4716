/* ── Socket.IO Client Setup & Listeners ── */

import { appendLog, updateStats, updateChip } from './ui.js';

export function initSockets() {
  const socket = io({
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
  });

  socket.on('connect', () => {
    appendLog('Connected to DAQ GUI server', 'info');
    updateChip(false);
  });

  socket.on('disconnect', reason => {
    appendLog(`Disconnected: ${reason}`, 'warn');
    updateChip(false, 'OFFLINE');
  });

  socket.on('reconnect', () => {
    appendLog('Reconnected to server', 'info');
  });

  socket.on('log', data => {
    appendLog(data.msg, data.level, data.ts);
  });

  socket.on('stats', data => {
    updateStats(data);
  });

  socket.on('live_data', data => {
    if (typeof window.pushLiveData === 'function') {
      window.pushLiveData(data);
    } else {
      console.warn("Received live_data but pushLiveData is not defined", data);
    }
  });

  return socket;
}
