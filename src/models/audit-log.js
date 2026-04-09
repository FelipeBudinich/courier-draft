import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

const auditLogSchema = new Schema(
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
    action: {
      type: String,
      required: true
    },
    targetType: {
      type: String,
      required: true
    },
    targetId: {
      type: String,
      required: true
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

auditLogSchema.plugin(publicIdPlugin, { prefix: 'aud' });
auditLogSchema.index({ projectId: 1, createdAt: -1 });

export const AuditLog =
  mongoose.models.AuditLog ?? mongoose.model('AuditLog', auditLogSchema);

