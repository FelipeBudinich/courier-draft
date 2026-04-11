import { buildUserInboxReadModel } from '../inbox/inbox-read-model.js';

export const buildDashboardSummary = async ({ user }) => {
  const inbox = await buildUserInboxReadModel({
    user,
    filter: 'all',
    page: 1,
    pageSize: 10
  });

  return {
    invites: inbox.invites,
    activity: inbox.activityPreview,
    unreadSummary: inbox.summary.unread,
    pendingInviteCount: inbox.summary.pendingInviteCount,
    activeProjectIds: inbox.activeProjectIds
  };
};
