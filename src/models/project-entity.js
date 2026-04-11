import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

const entityAliasSchema = new Schema(
  {
    display: {
      type: String,
      required: true,
      trim: true
    },
    normalizedKey: {
      type: String,
      required: true,
      trim: true
    }
  },
  {
    _id: false
  }
);

const projectEntitySchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ['character', 'location'],
      required: true
    },
    canonicalName: {
      type: String,
      required: true,
      trim: true
    },
    normalizedKey: {
      type: String,
      required: true,
      trim: true
    },
    aliases: {
      type: [entityAliasSchema],
      default: []
    },
    mergedIntoId: {
      type: Schema.Types.ObjectId,
      ref: 'ProjectEntity'
    },
    latestStats: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

projectEntitySchema.plugin(publicIdPlugin, { prefix: 'ent' });
projectEntitySchema.index({ projectId: 1, type: 1, canonicalName: 1 });
projectEntitySchema.index(
  { projectId: 1, type: 1, normalizedKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      mergedIntoId: null
    }
  }
);
projectEntitySchema.index({ projectId: 1, mergedIntoId: 1 });

export const ProjectEntity =
  mongoose.models.ProjectEntity ??
  mongoose.model('ProjectEntity', projectEntitySchema);
