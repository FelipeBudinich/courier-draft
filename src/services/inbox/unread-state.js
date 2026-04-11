import { badRequest } from '../../config/errors.js';
import { InboxReadState } from '../../models/index.js';

const VALID_ITEM_PREFIXES = ['act_', 'pmm_'];
const MAX_TRACKED_READ_ITEMS = 500;

const isValidInboxItemId = (itemId) =>
  VALID_ITEM_PREFIXES.some((prefix) => String(itemId ?? '').startsWith(prefix));

const normalizeTrackedReadIds = (readItemIds) =>
  Array.from(
    new Set((readItemIds ?? []).filter((itemId) => isValidInboxItemId(itemId)))
  ).slice(-MAX_TRACKED_READ_ITEMS);

const ensureReadState = async ({ userId }) =>
  InboxReadState.findOneAndUpdate(
    {
      userId
    },
    {
      $setOnInsert: {
        userId,
        lastReadAllAt: null,
        readItemIds: []
      }
    },
    {
      upsert: true,
      new: true
    }
  );

export const getInboxReadState = async ({ userId }) => {
  const readState = await InboxReadState.findOne({
    userId
  }).lean();

  return {
    userId,
    lastReadAllAt: readState?.lastReadAllAt ?? null,
    readItemIds: normalizeTrackedReadIds(readState?.readItemIds ?? [])
  };
};

export const isInboxItemRead = ({ readState, itemId, occurredAt }) => {
  if (!itemId) {
    return false;
  }

  if ((readState?.readItemIds ?? []).includes(itemId)) {
    return true;
  }

  if (!occurredAt || !readState?.lastReadAllAt) {
    return false;
  }

  return new Date(occurredAt) <= new Date(readState.lastReadAllAt);
};

export const markInboxItemRead = async ({ userId, itemId }) => {
  if (!isValidInboxItemId(itemId)) {
    throw badRequest('Inbox item id is invalid.');
  }

  const readState = await ensureReadState({ userId });
  const nextIds = normalizeTrackedReadIds([...(readState.readItemIds ?? []), itemId]);

  await InboxReadState.updateOne(
    {
      _id: readState._id
    },
    {
      $set: {
        readItemIds: nextIds
      }
    }
  );

  return {
    itemId
  };
};

export const markAllInboxItemsRead = async ({ userId, readAt = new Date() }) => {
  const readState = await ensureReadState({ userId });
  const nextReadAllAt =
    readState.lastReadAllAt && readState.lastReadAllAt > readAt
      ? readState.lastReadAllAt
      : readAt;

  await InboxReadState.updateOne(
    {
      _id: readState._id
    },
    {
      $set: {
        lastReadAllAt: nextReadAllAt,
        readItemIds: []
      }
    }
  );

  return {
    lastReadAllAt: nextReadAllAt
  };
};

export const clearInboxItemRead = async ({ userId, itemId }) => {
  if (!isValidInboxItemId(itemId)) {
    return;
  }

  await InboxReadState.updateOne(
    {
      userId
    },
    {
      $pull: {
        readItemIds: itemId
      }
    }
  );
};
