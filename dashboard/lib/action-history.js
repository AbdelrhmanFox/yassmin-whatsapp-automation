/** In-memory control action log (shared across warm serverless invocations on the same instance). */
const actionHistory = [];
const MAX_ITEMS = 50;

function pushHistoryItem(item) {
  actionHistory.unshift(item);
  if (actionHistory.length > MAX_ITEMS) actionHistory.pop();
}

function listHistory() {
  return actionHistory;
}

module.exports = { pushHistoryItem, listHistory, MAX_ITEMS };
