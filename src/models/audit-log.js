import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

const auditLogSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      default: null,
      index: true
    },
    scope: {
      type: String,
      enum: ['account', 'project'],
      default: 'project',
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
auditLogSchema.index({ scope: 1, projectId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });

export const AuditLog =
  mongoose.models.AuditLog ?? mongoose.model('AuditLog', auditLogSchema);
