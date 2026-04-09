import mongoose from 'mongoose';

import { publicIdPlugin } from './plugins/public-id.js';

const { Schema } = mongoose;

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
    aliases: {
      type: [String],
      default: []
    },
    mergedIntoId: {
      type: Schema.Types.ObjectId,
      ref: 'ProjectEntity'
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

projectEntitySchema.plugin(publicIdPlugin, { prefix: 'ent' });
projectEntitySchema.index({ projectId: 1, type: 1, canonicalName: 1 });

export const ProjectEntity =
  mongoose.models.ProjectEntity ??
  mongoose.model('ProjectEntity', projectEntitySchema);

