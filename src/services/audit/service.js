import { AuditLog } from '../../models/index.js';

export const createAuditLog = async ({
  scope = 'project',
  projectId = null,
  actorId,
  action,
  targetType,
  targetId,
  metadata = {},
  session
}) => {
  const [log] = await AuditLog.create(
    [
      {
        scope,
        projectId,
        actorId,
        action,
        targetType,
        targetId,
        metadata
      }
    ],
    session ? { session } : {}
  );

  return log;
};

export const listProjectAudit = ({ projectId, limit = 40 }) =>
  AuditLog.find({
    scope: 'project',
    projectId
  })
    .populate('actorId', 'publicId username displayName')
    .sort({ createdAt: -1 })
    .limit(limit);

export const serializeAuditLog = (log) => ({
  id: log.publicId,
  scope: log.scope,
  action: log.action,
  targetType: log.targetType,
  targetId: log.targetId,
  actor: log.actorId
    ? {
        userId: log.actorId.publicId,
        username: log.actorId.username ?? null,
        displayName: log.actorId.displayName
      }
    : null,
  metadata: log.metadata ?? {},
  createdAt: log.createdAt
});
