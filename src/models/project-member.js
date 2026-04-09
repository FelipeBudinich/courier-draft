import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

const projectMemberSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    role: {
      type: String,
      enum: ['owner', 'editor', 'reviewer'],
      required: true
    },
    invitedById: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

projectMemberSchema.plugin(publicIdPlugin, { prefix: 'pmm' });
projectMemberSchema.index({ projectId: 1, userId: 1 }, { unique: true });
projectMemberSchema.index({ projectId: 1, role: 1 });
projectMemberSchema.index({ userId: 1, updatedAt: -1 });

export const ProjectMember =
  mongoose.models.ProjectMember ??
  mongoose.model('ProjectMember', projectMemberSchema);

