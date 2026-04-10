import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

const derivedBodySchema = new Schema(
  {
    blocks: {
      type: [Schema.Types.Mixed],
      default: []
    },
    cachedSlugline: {
      type: String,
      default: null
    },
    characterRefs: {
      type: [String],
      default: []
    },
    locationRefs: {
      type: [String],
      default: []
    }
  },
  {
    _id: false
  }
);

const sceneSchema = new Schema(
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
      required: true,
      index: true
    },
    outlineNodeId: {
      type: Schema.Types.ObjectId,
      ref: 'OutlineNode'
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    documentSchemaVersion: {
      type: Number,
      default: 1
    },
    structuredBody: {
      type: derivedBodySchema,
      default: () => ({})
    },
    headDocument: {
      type: Schema.Types.Mixed,
      default: null
    },
    headRevision: {
      type: Number,
      default: 0
    },
    headContent: {
      type: String,
      default: ''
    },
    headUpdatedAt: {
      type: Date,
      default: Date.now
    },
    updatedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    latestMajorVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'DocumentVersion'
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

sceneSchema.plugin(publicIdPlugin, { prefix: 'scn' });
sceneSchema.index({ projectId: 1, scriptId: 1 });
sceneSchema.index({ scriptId: 1, updatedAt: -1 });

export const Scene = mongoose.models.Scene ?? mongoose.model('Scene', sceneSchema);
