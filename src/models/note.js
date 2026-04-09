import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

const noteSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    scriptId: {
      type: Schema.Types.ObjectId,
      ref: 'Script',
      index: true
    },
    sceneId: {
      type: Schema.Types.ObjectId,
      ref: 'Scene',
      index: true
    },
    authorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    containerType: {
      type: String,
      enum: ['project', 'script', 'scene'],
      default: 'project'
    },
    containerId: {
      type: Schema.Types.ObjectId
    },
    body: {
      type: String,
      default: ''
    },
    isDetached: {
      type: Boolean,
      default: false
    },
    latestMajorVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'DocumentVersion'
    },
    headUpdatedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

noteSchema.plugin(publicIdPlugin, { prefix: 'nte' });
noteSchema.index({ projectId: 1, updatedAt: -1 });
noteSchema.index({ projectId: 1, scriptId: 1 });
noteSchema.index({ projectId: 1, sceneId: 1 });

export const Note = mongoose.models.Note ?? mongoose.model('Note', noteSchema);

