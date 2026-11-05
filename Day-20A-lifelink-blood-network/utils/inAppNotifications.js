const InAppNotification = require('../models/InAppNotification');

async function createInAppNotification(data, session) {
  try {
    const options = session ? { session } : {};
    const [notification] = await InAppNotification.create([data], options);
    return notification;
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }
}

function dispatchInAppNotification(work, label) {
  Promise.resolve().then(work).catch((error) => {
    console.error(`${label} in-app notification failed.`, error.code || error.name || 'NotificationError');
  });
}

module.exports = { createInAppNotification, dispatchInAppNotification };
