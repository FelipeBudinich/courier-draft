import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

const activityEventSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    actorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    type: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    payload: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

activityEventSchema.plugin(publicIdPlugin, { prefix: 'act' });
activityEventSchema.index({ projectId: 1, createdAt: -1 });

export const ActivityEvent =
  mongoose.models.ActivityEvent ??
  mongoose.model('ActivityEvent', activityEventSchema);

