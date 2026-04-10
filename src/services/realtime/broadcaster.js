import { roomHelpers } from '../../sockets/rooms.js';

let ioRef = null;

const getCollabNamespace = () => ioRef?.of('/collab') ?? null;

export const registerRealtimeServer = (io) => {
  ioRef = io;
};

export const emitToUserRoom = (userPublicId, eventName, payload) => {
  const collab = getCollabNamespace();
  if (!collab) {
    return;
  }

  collab.to(roomHelpers.user(userPublicId)).emit(eventName, payload);
};

export const emitToProjectRoom = (projectPublicId, eventName, payload) => {
  const collab = getCollabNamespace();
  if (!collab) {
    return;
  }

  collab.to(roomHelpers.project(projectPublicId)).emit(eventName, payload);
};

export const evictUserFromProjectRooms = async ({
  userPublicId,
  projectPublicId
}) => {
  const collab = getCollabNamespace();
  if (!collab) {
    return;
  }

  collab
    .in(roomHelpers.user(userPublicId))
    .socketsLeave(roomHelpers.project(projectPublicId));

  const sockets = await collab.in(roomHelpers.user(userPublicId)).fetchSockets();

  for (const socket of sockets) {
    socket.data.joinedProjectIds?.delete?.(projectPublicId);

    const trackedRooms = socket.data.projectScopedRooms;
    if (!trackedRooms) {
      continue;
    }

    for (const [roomName, scopedProjectId] of trackedRooms.entries()) {
      if (scopedProjectId !== projectPublicId) {
        continue;
      }

      socket.leave(roomName);
      trackedRooms.delete(roomName);
    }
  }
};
