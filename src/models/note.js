import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

const anchorSchema = new Schema(
  {
    sceneId: {
      type: String,
      required: true,
      trim: true
    },
    blockId: {
      type: String,
      required: true,
      trim: true
    },
    startOffset: {
      type: Number,
      required: true,
      min: 0
    },
    endOffset: {
      type: Number,
      required: true,
      min: 0
    },
    selectedText: {
      type: String,
      default: ''
    },
    contextBefore: {
      type: String,
      default: ''
    },
    contextAfter: {
      type: String,
      default: ''
    },
    createdFromSceneHeadRevision: {
      type: Number,
      default: 0
    }
  },
  {
    _id: false
  }
);

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
    blockId: {
      type: String,
      default: null
    },
    authorUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    containerType: {
      type: String,
      enum: ['project', 'script', 'act', 'beat', 'scene'],
      default: 'project'
    },
    containerId: {
      type: Schema.Types.ObjectId,
      required: true
    },
    anchor: {
      type: anchorSchema,
      default: null
    },
    isDetached: {
      type: Boolean,
      default: false
    },
    detachedAt: {
      type: Date,
      default: null
    },
    headText: {
      type: String,
      default: ''
    },
    headRevision: {
      type: Number,
      default: 1
    },
    headUpdatedAt: {
      type: Date,
      default: Date.now
    },
    updatedByUserId: {
      type: Schema.Types.ObjectId
    },
    currentMajorVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'DocumentVersion'
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
noteSchema.index({ projectId: 1, authorUserId: 1 });
noteSchema.index({ projectId: 1, containerType: 1, containerId: 1 });
noteSchema.index({ projectId: 1, isDetached: 1 });

export const Note = mongoose.models.Note ?? mongoose.model('Note', noteSchema);
