import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

const documentVersionSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    docType: {
      type: String,
      enum: ['scene', 'note'],
      required: true
    },
    docId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true
    },
    scriptId: {
      type: Schema.Types.ObjectId,
      ref: 'Script',
      default: null
    },
    scriptVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'ScriptVersion',
      default: null
    },
    snapshotType: {
      type: String,
      enum: ['major', 'restore'],
      default: 'major'
    },
    versionSequence: {
      type: Number,
      required: true
    },
    versionLabel: {
      type: String,
      trim: true
    },
    contentSnapshot: {
      type: Schema.Types.Mixed,
      required: true
    },
    savedAt: {
      type: Date,
      default: Date.now
    },
    savedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    restoredFromVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'DocumentVersion',
      default: null
    },
    headRevisionAtSave: {
      type: Number,
      default: 0
    },
    contentHash: {
      type: String,
      required: true,
      trim: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

documentVersionSchema.plugin(publicIdPlugin, { prefix: 'ver' });
documentVersionSchema.index(
  { docType: 1, docId: 1, versionSequence: 1 },
  { unique: true }
);
documentVersionSchema.index({ docType: 1, docId: 1, savedAt: -1 });
documentVersionSchema.index({ projectId: 1, savedAt: -1 });
documentVersionSchema.index({ scriptVersionId: 1 });

export const DocumentVersion =
  mongoose.models.DocumentVersion ??
  mongoose.model('DocumentVersion', documentVersionSchema);
