export const createCollabClient = ({ namespace = '/collab' } = {}) => {
  if (!window.io) {
    throw new Error('Socket.IO client script is not available.');
  }

  return window.io(namespace, {
    transports: ['websocket', 'polling']
  });
};

