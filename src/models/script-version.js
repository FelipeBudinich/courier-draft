import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

const snapshotRefSchema = new Schema(
  {
    docType: {
      type: String,
      enum: ['scene', 'note'],
      required: true
    },
    docId: {
      type: Schema.Types.ObjectId,
      required: true
    },
    versionId: {
      type: Schema.Types.ObjectId,
      ref: 'DocumentVersion',
      required: true
    }
  },
  {
    _id: false
  }
);

const scriptVersionSchema = new Schema(
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
    majorSaveSequence: {
      type: Number,
      required: true
    },
    versionLabel: {
      type: String,
      trim: true,
      required: true
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    scopeType: {
      type: String,
      enum: ['script', 'scene', 'note'],
      default: 'script'
    },
    scopeRefId: {
      type: Schema.Types.ObjectId,
      default: null
    },
    snapshotRefs: {
      type: [snapshotRefSchema],
      default: []
    },
    summary: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

scriptVersionSchema.plugin(publicIdPlugin, { prefix: 'svr' });
scriptVersionSchema.index(
  { scriptId: 1, majorSaveSequence: 1 },
  { unique: true }
);
scriptVersionSchema.index({ scriptId: 1, createdAt: -1 });

export const ScriptVersion =
  mongoose.models.ScriptVersion ??
  mongoose.model('ScriptVersion', scriptVersionSchema);
