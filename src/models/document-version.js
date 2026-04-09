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
    versionLabel: {
      type: String,
      trim: true
    },
    content: {
      type: String,
      default: ''
    },
    savedAt: {
      type: Date,
      default: Date.now
    },
    createdById: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    isMajor: {
      type: Boolean,
      default: true
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

documentVersionSchema.plugin(publicIdPlugin, { prefix: 'ver' });
documentVersionSchema.index({ docType: 1, docId: 1, savedAt: -1 });
documentVersionSchema.index({ projectId: 1, savedAt: -1 });

export const DocumentVersion =
  mongoose.models.DocumentVersion ??
  mongoose.model('DocumentVersion', documentVersionSchema);

