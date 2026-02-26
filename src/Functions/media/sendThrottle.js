const lastSentAt = {
  gifs: 0,
  avatar: 0,
  banners: 0
};

function canSendByType(tipo, tempoSegundos) {
  const type = String(tipo || "");
  if (!(type in lastSentAt)) return true;

  const intervalMs = Math.max(1, Number(tempoSegundos || 60)) * 1000;
  const now = Date.now();
  return now - lastSentAt[type] >= intervalMs;
}

function markSentByType(tipo) {
  const type = String(tipo || "");
  if (!(type in lastSentAt)) return;
  lastSentAt[type] = Date.now();
}

module.exports = {
  canSendByType,
  markSentByType
};
