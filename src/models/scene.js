import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

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
    structuredBody: {
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
    headContent: {
      type: String,
      default: ''
    },
    headUpdatedAt: {
      type: Date,
      default: Date.now
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
